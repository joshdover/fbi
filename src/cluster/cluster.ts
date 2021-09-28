import fetch from "node-fetch";
import { ContainerBackend, Container } from "./backends";
import { Logger } from "./types";
import path from "path";

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
  };
  policy: {
    integrations: { package: string }[];
  };
}

interface AgentGroup {
  config: AgentConfig;
  agentPolicyId: string;
  enrollmentToken: string;
  containers: Container[];
}

export class Cluster {
  private fleetServer?: Container;
  private agentGroups = new Map<string, AgentGroup>();

  constructor(
    private readonly config: ClusterConfig,
    private readonly backend: ContainerBackend,
    private readonly logger?: Logger
  ) {}

  public async setup(): Promise<void> {
    await this.backend.setup();
    const serviceToken = await this.createFleetServerServiceToken();

    // Start Fleet Server
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
  }

  public async shutdown(): Promise<void> {
    for (const agentGroup of this.agentGroups.values()) {
      await this.scaleAgentGroup(agentGroup.config.id, 0);
    }
    await this.fleetServer?.stop();
    await this.backend.cleanup();
  }

  public async addAgentGroup(agentConfig: AgentConfig): Promise<void> {
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
      const {
        response: { version, title },
      } = await this.makeKibanaRequest<{
        response: { version: string; title: string };
      }>("GET", `/api/fleet/epm/packages/${packageName}`);

      await this.makeKibanaRequest("POST", "/api/fleet/package_policies", {
        enabled: true,
        package: {
          title,
          name: packageName,
          version,
        },
        namespace: "default",
        output_id: "default",
        inputs: [],
        policy_id: agentPolicyId,
        name: `fbi-${agentConfig.id}-${packageName}`,
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

    const diff = size - agentGroup.containers.length;
    if (diff > 0) {
      await Promise.all(
        range(diff).map(() => this.addAgentToGroup(agentGroup))
      );
    } else if (diff < 0) {
      await Promise.all(
        range(diff).map(() => this.removeAgentFromGroup(agentGroup))
      );
    }
  }

  private async addAgentToGroup(agentGroup: AgentGroup) {
    const container = await this.backend.launchContainer({
      image: agentGroup.config.container.image,
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

    // install and enroll agent
    await container.exec({
      env: {
        FLEET_ENROLL: "1",
        FLEET_URL: "http://fleet-server:8220",
        FLEET_ENROLLMENT_TOKEN: agentGroup.enrollmentToken,
        FLEET_INSECURE: "true",
      },
      cmd: ["/elastic-agent-tar/elastic-agent", "container"],
    });

    // add container to group
    agentGroup.containers.push(container);
  }

  private async removeAgentFromGroup(agentGroup: AgentGroup) {
    const container = agentGroup.containers.pop();
    await container?.stop();
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
  for (let i = x; i > 0; i--) {
    r.push(i);
  }
  return r;
};
