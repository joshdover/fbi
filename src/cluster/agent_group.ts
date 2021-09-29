import path from "path";
import { BehaviorSubject, Observable, ReplaySubject } from "rxjs";
import { Container, ContainerBackend } from ".";
import {
  generateDefaultPackagePolicy,
  PackageResponse,
} from "./package_policy";
import { StackClient } from "./types";
import { unenrollAgentForHostname } from "./unenroll";

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

export interface AgentGroupStatus {
  policy: "not_created" | "creating" | "created" | "error";
  size: number;
}

export class AgentGroup {
  readonly #config: AgentConfig;
  readonly #backend: ContainerBackend;
  readonly #kibanaClient: StackClient;
  readonly #containers: Container[] = [];
  #agentPolicyId?: string;
  #enrollmentToken?: string;

  #status$ = new BehaviorSubject<AgentGroupStatus>({
    policy: "not_created",
    size: 0,
  });
  #logs$ = new ReplaySubject<string>();

  constructor(
    config: AgentConfig,
    backend: ContainerBackend,
    kibanaClient: StackClient
  ) {
    this.#config = config;
    this.#backend = backend;
    this.#kibanaClient = kibanaClient;
  }

  public get id(): string {
    return this.#config.id;
  }

  public getStatus$(): Observable<AgentGroupStatus> {
    return this.#status$.asObservable();
  }

  public getLogs$(): Observable<string> {
    return this.#logs$.asObservable();
  }

  public async configurePolicy(): Promise<void> {
    try {
      this.#updateStatus({ policy: "creating" });
      await this.#configurePolicy();
      this.#updateStatus({ policy: "created" });
    } catch (e: any) {
      this.#logs$.next(
        `Error while creating policy [${this.#config.id}]: ${
          e?.stack ?? e.toString()
        }`
      );
      this.#updateStatus({ policy: "error" });
    }
  }

  public async scale(size: number): Promise<void> {
    if (size !== 0 && (!this.#agentPolicyId || !this.#enrollmentToken)) {
      throw new Error(
        `this.#configurePolicy must be called first on group [${
          this.#config.id
        }]`
      );
    }

    const diff = size - this.#containers.length;
    if (diff > 0) {
      await Promise.all(range(diff).map(() => this.#addAgent()));
    } else if (diff < 0) {
      await Promise.all(range(diff).map(() => this.#removeAgent()));
    }
  }

  #updateStatus(updatedFields: Partial<AgentGroupStatus>): void {
    this.#status$.next({
      ...this.#status$.value,
      ...updatedFields,
    });
  }

  async #configurePolicy(): Promise<void> {
    const { items: existingPolicies } = await this.#kibanaClient<{
      items: Array<{
        name: string;
        id: string;
        package_policies: Array<{ id: string }>;
      }>;
    }>("GET", "/api/fleet/agent_policies?perPage=1000");

    const existingPolicy = existingPolicies.find(
      ({ name }) => name === `fbi-${this.#config.id}`
    );
    let agentPolicyId = existingPolicy?.id;

    if (!agentPolicyId) {
      // Create an agent policy
      const {
        item: { id },
      } = await this.#kibanaClient<{ item: { id: string } }>(
        "POST",
        "/api/fleet/agent_policies",
        {
          name: `fbi-${this.#config.id}`,
          namespace: "default",
          description: `Policy created by FBI ${this.#config.id} recipe`,
          monitoring_enabled: ["metrics", "logs"],
        }
      );

      agentPolicyId = id;
    }

    // Get the enrollment token (should already be created)
    const { list: enrollmentTokens } = await this.#kibanaClient<{
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
      await this.#kibanaClient("POST", "/api/fleet/package_policies/delete", {
        packagePolicyIds: existingPolicy?.package_policies,
        force: true,
      });
    }

    for (const { package: packageName } of this.#config.policy.integrations) {
      // Find latest version
      const { response } = await this.#kibanaClient<{
        response: PackageResponse;
      }>("GET", `/api/fleet/epm/packages/${packageName}`);

      const packagePolicy = generateDefaultPackagePolicy(
        response,
        this.#config.id,
        agentPolicyId
      );

      await this.#kibanaClient("POST", "/api/fleet/package_policies", {
        ...packagePolicy,
        force: true,
      });
    }

    this.#enrollmentToken = enrollmentToken;
    this.#agentPolicyId = agentPolicyId;
  }

  async #addAgent(): Promise<void> {
    const container = await this.#backend.launchContainer({
      image: this.#config.container.image,
      env: this.#config.container.env,
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
    this.#containers.push(container);
    this.#updateStatus({
      size: this.#containers.length,
    });

    // install and enroll agent
    this.#logs$.next(`Enrolling agent in container [${container.id}]`);
    await container.exec({
      env: {
        FLEET_ENROLL: "1",
        FLEET_URL: "http://fleet-server:8220",
        FLEET_ENROLLMENT_TOKEN: this.#enrollmentToken!,
        FLEET_INSECURE: "true",
      },
      cmd: ["/elastic-agent-tar/elastic-agent", "container"],
    });
  }

  async #removeAgent(): Promise<void> {
    if (this.#containers.length === 0) {
      return;
    }

    const container = this.#containers.pop();
    const containerId = container!.id;
    await container!.stop();

    await unenrollAgentForHostname(
      containerId.substring(0, 12), // Docker uses the first 12 digits of container id as hostname
      this.#kibanaClient,
      this.#logs$.next,
      this.#agentPolicyId
    );

    this.#updateStatus({
      size: this.#containers.length,
    });
  }
}

const range = (x: number): number[] => {
  const r = [];
  for (let i = Math.abs(x); i > 0; i--) {
    r.push(i);
  }
  return r;
};
