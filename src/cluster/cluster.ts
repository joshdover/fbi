import fetch from "node-fetch";
import { ContainerBackend } from "./backends";
import { Logger } from "./types";
import {
  BehaviorSubject,
  combineLatest,
  map,
  Observable,
  switchMap,
} from "rxjs";
import { AgentConfig, AgentGroup, AgentGroupStatus } from "./agent_group";
import { FleetServer } from "./fleet_server";
import { ClusterConfig } from "./config";

export type ComponentStatus = "stopped" | "starting" | "running" | "error";

export interface ClusterStatus {
  backend: ComponentStatus;
  fleetServer: ComponentStatus;
  agentGroups: Record<string, AgentGroupStatus>;
}

export class Cluster {
  private fleetServer: FleetServer;
  private agentGroups$ = new BehaviorSubject<Record<string, AgentGroup>>({});

  constructor(
    private readonly config: ClusterConfig,
    private readonly backend: ContainerBackend,
    private readonly logger: Logger
  ) {
    this.fleetServer = new FleetServer(
      this.backend,
      this.makeEsRequest.bind(this),
      config.elasticsearch.host,
      this.makeKibanaRequest.bind(this)
    );
    this.fleetServer.getLogs$().subscribe((log) => this.logger.log(log));
  }

  public async setup(): Promise<void> {
    await this.backend.setup();

    // Start Fleet Server
    await this.fleetServer.setup();
  }

  public async shutdown(): Promise<void> {
    for (const agentGroup of Object.values(this.agentGroups$.value)) {
      await agentGroup.scale(0);
    }

    await this.fleetServer.shutdown();
    await this.backend.cleanup();
  }

  public getStatus$(): Observable<ClusterStatus> {
    const agentStatuses$ = this.agentGroups$.pipe(
      switchMap((agentGroups) =>
        combineLatest(
          Object.values(agentGroups).map((ag) =>
            ag
              .getStatus$()
              .pipe(map((ags) => [ag.id, ags] as [string, AgentGroupStatus]))
          )
        )
      ),
      map((agentGroupsArr) => Object.fromEntries(agentGroupsArr))
    );

    return combineLatest([
      this.backend.getStatus$(),
      this.fleetServer.getStatus$(),
      agentStatuses$,
    ]).pipe(
      map(([backend, fleetServer, agentGroups]) => ({
        backend,
        fleetServer,
        agentGroups,
      }))
    );
  }

  public addAgentGroup(agentConfig: AgentConfig): void {
    const agentGroup = new AgentGroup(
      agentConfig,
      this.backend,
      this.makeKibanaRequest.bind(this)
    );

    // TODO improve logging obs
    agentGroup.getLogs$().subscribe((log) => this.logger.log(log));

    this.agentGroups$.next({
      ...this.agentGroups$.value,
      [agentConfig.id]: agentGroup,
    });
  }

  public async configureAgentGroupPolicy(id: string): Promise<void> {
    const agentGroup = this.agentGroups$.value[id];
    if (!agentGroup) {
      throw new Error(`Must call Cluster.addAgentGroup first`);
    }
    await agentGroup.configurePolicy();
  }

  public async scaleAgentGroup(id: string, size: number): Promise<void> {
    const agentGroup = this.agentGroups$.value[id];
    if (!agentGroup) {
      throw new Error(`Unknown agent group [${id}]`);
    }
    await agentGroup.scale(size);
  }

  private async makeKibanaRequest<T = unknown>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const resp = await fetch(`${this.config.kibana.host}${path}`, {
      method,
      body: body ? JSON.stringify(body) : undefined,
      headers: {
        ...this.getSuperuserAuthHeader(),
        "content-type": "application/json",
        "kbn-xsrf": "x",
      },
    });

    const respBody = await resp.json();

    if (resp.status >= 400) {
      throw new Error(
        `Got ${
          resp.status
        } error response on ${method} ${path}: ${JSON.stringify(respBody)}`
      );
    }

    return respBody as T;
  }

  private async makeEsRequest<T = unknown>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const resp = await fetch(`${this.config.elasticsearch.host}${path}`, {
      method,
      body: body ? JSON.stringify(body) : undefined,
      headers: {
        ...this.getSuperuserAuthHeader(),
        "content-type": "application/json",
      },
    });
    const respBody = await resp.json();
    return respBody as T;
  }

  private getSuperuserAuthHeader() {
    const base64Cred = Buffer.from(
      `${this.config.superuser.username}:${this.config.superuser.password}`,
      "utf-8"
    ).toString("base64");
    return {
      Authorization: `Basic ${base64Cred}`,
    };
  }
}
