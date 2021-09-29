import fetch from "node-fetch";
import { ContainerBackend, Container } from "./backends";
import { Logger } from "./types";
import path from "path";
import { BehaviorSubject, Observable } from "rxjs";
import {
  generateDefaultPackagePolicy,
  PackageResponse,
} from "./package_policy";

export interface ClusterConfig {
  superuser: {
    username: string;
    password: string;
  };

  elasticsearch: {
    host: string;
  };
  kibana: {
    host: string;
  };
}

export interface AgentConfig {
  id: string;
  container: {
    image: string;
    env: Record<string, string>;
  };
  policy: {
    integrations: { package: string }[];
  };
}

interface AgentGroup {
  config: AgentConfig;
  containers: Container[];
  agentPolicyId?: string;
  enrollmentToken?: string;
}

type ResolvedAgentGroup = Required<AgentGroup>;

export type ComponentStatus = "stopped" | "starting" | "running" | "error";

export interface AgentGroupStatus {
  policy: "not_created" | "creating" | "created" | "error";
  size: number;
}

export interface ClusterStatus {
  backend: ComponentStatus;
  fleetServer: ComponentStatus;
  agentGroups: Record<string, AgentGroupStatus>;
}
export class Cluster {
  private fleetServer?: Container;
  private agentGroups = new Map<string, AgentGroup>();
  private readonly status$ = new BehaviorSubject<ClusterStatus>({
    backend: "stopped",
    fleetServer: "stopped",
    agentGroups: {},
  });

  constructor(
    private readonly config: ClusterConfig,
    private readonly backend: ContainerBackend,
    private readonly logger: Logger
  ) {}

  public async setup(): Promise<void> {
    this.updateStatus({ backend: "starting" });
    await this.backend.setup();
    this.updateStatus({ backend: "running" });

    // Start Fleet Server
    this.updateStatus({ fleetServer: "starting" });
    const serviceToken = await this.createFleetServerServiceToken();
    this.fleetServer = await this.backend.launchContainer({
      image: "docker.elastic.co/beats/elastic-agent:8.0.0-SNAPSHOT",
      ports: ["8220"],
      hostname: "fleet-server",
      env: {
        FLEET_SERVER_ENABLE: "true",
        FLEET_SERVER_ELASTICSEARCH_HOST: this.config.elasticsearch.host,
        FLEET_SERVER_SERVICE_TOKEN: serviceToken,
        FLEET_SERVER_INSECURE_HTTP: "1",
      },
    });
    // TODO: poll Fleet API for agent status of Fleet Server
    this.updateStatus({ fleetServer: "running" });
  }

  public async shutdown(): Promise<void> {
    for (const agentGroup of this.agentGroups.values()) {
      if (agentGroup.containers.length) {
        await this.scaleAgentGroup(agentGroup.config.id, 0);
      }
    }
    await this.fleetServer?.stop();
    this.updateStatus({ fleetServer: "stopped" });
    await this.backend.cleanup();
    this.updateStatus({ backend: "stopped" });
  }

  public getStatus$(): Observable<ClusterStatus> {
    return this.status$.asObservable();
  }

  private updateStatus(updatedFields: Partial<ClusterStatus>) {
    this.status$.next({
      ...this.status$.value,
      ...updatedFields,
    });
  }

  private updateAgentGroupStatus(
    id: string,
    updatedFields: Partial<AgentGroupStatus>
  ) {
    const prevStatus = this.status$.value;
    this.status$.next({
      ...prevStatus,
      agentGroups: {
        ...prevStatus.agentGroups,
        [id]: {
          ...prevStatus.agentGroups[id],
          ...updatedFields,
        },
      },
    });
  }

  public addAgentGroup(agentConfig: AgentConfig): void {
    this.agentGroups.set(agentConfig.id, {
      config: agentConfig,
      agentPolicyId: undefined,
      containers: [],
      enrollmentToken: undefined,
    });
    this.updateAgentGroupStatus(agentConfig.id, {
      policy: "not_created",
      size: 0,
    });
  }

  public async configureAgentGroupPolicy(id: string): Promise<void> {
    const agentGroup = this.agentGroups.get(id);
    if (!agentGroup) {
      throw new Error(`Must call Cluster.addAgentGroup first`);
    }
    if (agentGroup.agentPolicyId !== undefined) {
      return;
    }
    this.updateAgentGroupStatus(id, { policy: "creating" });
    try {
      await this.configureAgentPolicy(agentGroup);
    } catch (e: any) {
      this.logger.log(
        `Error while creating policy: ${e.stack ?? e.toString()}`
      );
      this.updateAgentGroupStatus(id, { policy: "error" });
      return;
    }
    this.updateAgentGroupStatus(id, { policy: "created" });
  }

  private async configureAgentPolicy(agentGroup: AgentGroup): Promise<void> {
    const agentConfig = agentGroup.config;
    const { items: existingPolicies } = await this.makeKibanaRequest<{
      items: Array<{
        name: string;
        id: string;
        package_policies: Array<{ id: string }>;
      }>;
    }>("GET", "/api/fleet/agent_policies?perPage=1000");

    const existingPolicy = existingPolicies.find(
      ({ name }) => name === `fbi-${agentConfig.id}`
    );
    let agentPolicyId = existingPolicy?.id;

    if (!agentPolicyId) {
      // Create an agent policy
      const {
        item: { id },
      } = await this.makeKibanaRequest<{ item: { id: string } }>(
        "POST",
        "/api/fleet/agent_policies",
        {
          name: `fbi-${agentConfig.id}`,
          namespace: "default",
          description: `Policy created by FBI ${agentConfig.id} recipe`,
          monitoring_enabled: ["metrics", "logs"],
        }
      );

      agentPolicyId = id;
    }

    // Get the enrollment token (should already be created)
    const { list: enrollmentTokens } = await this.makeKibanaRequest<{
      list: Array<{ api_key: string; policy_id: string }>;
    }>("GET", "/api/fleet/enrollment-api-keys");
    const enrollmentToken = enrollmentTokens.find(
      ({ policy_id }) => policy_id === agentPolicyId
    )?.api_key;

    if (!enrollmentToken) {
      throw new Error(
        `No enrollment token found for agent policy [${agentPolicyId}]`
      );
    }

    // Add integrations to policy
    if (existingPolicy?.package_policies?.length) {
      await this.makeKibanaRequest(
        "POST",
        "/api/fleet/package_policies/delete",
        {
          packagePolicyIds: existingPolicy?.package_policies,
          force: true,
        }
      );
    }

    for (const { package: packageName } of agentConfig.policy.integrations) {
      // Find latest version
      const { response } = await this.makeKibanaRequest<{
        response: PackageResponse;
      }>("GET", `/api/fleet/epm/packages/${packageName}`);

      const packagePolicy = generateDefaultPackagePolicy(
        response,
        agentConfig.id,
        agentPolicyId
      );

      await this.makeKibanaRequest("POST", "/api/fleet/package_policies", {
        ...packagePolicy,
        force: true,
      });
    }

    this.agentGroups.set(agentConfig.id, {
      config: agentConfig,
      agentPolicyId,
      containers: [],
      enrollmentToken,
    });
  }

  public async scaleAgentGroup(id: string, size: number): Promise<void> {
    const agentGroup = this.agentGroups.get(id);
    if (!agentGroup) {
      throw new Error(`Unknown agent group [${id}]`);
    }
    if (!agentGroup.agentPolicyId || !agentGroup.enrollmentToken) {
      throw new Error(
        `Cluster.configureAgentGroupPolicy must be called before scaleAgentGroup`
      );
    }

    const diff = size - agentGroup.containers.length;
    if (diff > 0) {
      await Promise.all(
        range(diff).map(() =>
          this.addAgentToGroup(agentGroup as ResolvedAgentGroup)
        )
      );
    } else if (diff < 0) {
      await Promise.all(
        range(diff).map(() => this.removeAgentFromGroup(agentGroup))
      );
    }
  }

  private async addAgentToGroup(agentGroup: ResolvedAgentGroup) {
    const container = await this.backend.launchContainer({
      image: agentGroup.config.container.image,
      env: agentGroup.config.container.env,
      mounts: {
        [path.join(
          __dirname,
          "..",
          "..",
          "elastic_agent",
          "elastic-agent-8.0.0-SNAPSHOT-linux-x86_64"
        )]: "/elastic-agent-tar",
      },
    });

    // add container to group
    agentGroup.containers.push(container);
    this.updateAgentGroupStatus(agentGroup.config.id, {
      size: agentGroup.containers.length,
    });

    // install and enroll agent
    this.logger.log(`Enrolling agent in container [${container.id}]`);
    await container.exec({
      env: {
        FLEET_ENROLL: "1",
        FLEET_URL: "http://fleet-server:8220",
        FLEET_ENROLLMENT_TOKEN: agentGroup.enrollmentToken,
        FLEET_INSECURE: "true",
      },
      cmd: ["/elastic-agent-tar/elastic-agent", "container"],
    });
  }

  private async removeAgentFromGroup(agentGroup: AgentGroup) {
    const container = agentGroup.containers.pop();
    await container?.stop();
    // TODO force unenroll agent
    this.updateAgentGroupStatus(agentGroup.config.id, {
      size: agentGroup.containers.length,
    });
  }

  private async createFleetServerServiceToken() {
    const resp = await this.makeEsRequest<{ token: { value: string } }>(
      "POST",
      `/_security/service/elastic/fleet-server/credential/token`
    );
    return resp.token.value;
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

const range = (x: number): number[] => {
  const r = [];
  for (let i = Math.abs(x); i > 0; i--) {
    r.push(i);
  }
  return r;
};
