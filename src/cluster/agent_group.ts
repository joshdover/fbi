import { updatedDiff } from "deep-object-diff";
import path from "path";
import { randomBytes } from "crypto";
import { BehaviorSubject, Observable, ReplaySubject } from "rxjs";
import { Container, ContainerBackend } from ".";
import { range } from "../utils";
import {
  generateDefaultPackagePolicy,
  getPackagePolicyName,
  PackagePolicy,
  PackageResponse,
} from "./package_policy";
import { StackClient } from "./types";
import { unenrollAgentForHostname } from "./unenroll";

const allowedDockerChars = /[a-zA-Z0-9_.]/;
export interface AgentConfig {
  id: string;
  container: {
    image: string;
    env: Record<string, string>;
  };
  policy: {
    integrations: Array<{
      package: string;

      name?: string;
      description?: string;
      namespace?: string;
      output_id?: string;
    }>;

    name?: string;
    description?: string;
    namespace?: string;
    monitoring?: ("metrics" | "logs")[];
    unenrollment_timeout_s?: number;
    is_managed?: boolean;
  };
}

export type ResolvedAgentPolicy = Required<AgentConfig["policy"]>;

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

  public get resolvedPolicy(): ResolvedAgentPolicy {
    const configPolicy = this.#config.policy;
    const policyName = configPolicy.name ?? `fbi-${this.#config.id}`;
    return {
      name: policyName,
      description:
        configPolicy.description ??
        `Policy created by FBI ${this.#config.id} recipe`,
      namespace: configPolicy.namespace ?? "default",
      monitoring: configPolicy.monitoring ?? ["metrics", "logs"],
      unenrollment_timeout_s: configPolicy.unenrollment_timeout_s ?? 600,
      is_managed: configPolicy.is_managed ?? false,
      integrations: configPolicy.integrations,
    };
  }

  async #configurePolicy(): Promise<void> {
    const resolvedPolicy = this.resolvedPolicy;
    const { items: existingPolicies } = await this.#kibanaClient<{
      items: Array<{
        name: string;
        id: string;
        package_policies?: Array<{ id: string }>;
      }>;
    }>(
      "GET",
      `/api/fleet/agent_policies?perPage=1&kuery=name:"${resolvedPolicy.name}"`
    );

    // Remap field names
    const expectedAgentPolicy = {
      name: resolvedPolicy.name,
      description: resolvedPolicy.description,
      namespace: resolvedPolicy.namespace,
      monitoring_enabled: resolvedPolicy.monitoring,
      unenroll_timeout: resolvedPolicy.unenrollment_timeout_s,
      is_managed: resolvedPolicy.is_managed,
    };

    const existingAgentPolicy = existingPolicies[0];
    let agentPolicyId = existingAgentPolicy?.id;

    if (!agentPolicyId) {
      // Create an agent policy
      this.#logs$.next(`Creating new agent policy [${resolvedPolicy.name}]`);
      const {
        item: { id },
      } = await this.#kibanaClient<{ item: { id: string } }>(
        "POST",
        "/api/fleet/agent_policies",
        expectedAgentPolicy
      );

      agentPolicyId = id;
    } else {
      // Naive diff that works because we specify defaults for every field
      const diff = updatedDiff(existingAgentPolicy, expectedAgentPolicy);
      if (Object.keys(diff).length > 0) {
        this.#logs$.next(
          `Updating agent policy [${
            existingAgentPolicy.name
          }], diff: ${JSON.stringify(diff, undefined, 2)}`
        );

        await this.#kibanaClient(
          "PUT",
          `/api/fleet/agent_policies/${agentPolicyId}`,
          expectedAgentPolicy
        );
      }
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
    const existingPackagePolicies = existingAgentPolicy?.package_policies
      ? await Promise.all(
          existingAgentPolicy.package_policies.map((packagePolicyId) =>
            this.#kibanaClient<{ item: PackagePolicy & { id: string } }>(
              "GET",
              `/api/fleet/package_policies/${packagePolicyId}`
            ).then((r) => r.item)
          )
        )
      : [];

    // Note: this doesn't support multiple integrations of the same package
    const expectedPackagesPolicyNames = this.#config.policy.integrations.map(
      (i) => getPackagePolicyName(this.#config.id, i)
    );
    const policiesToRemove = existingPackagePolicies.filter(
      (p) => !expectedPackagesPolicyNames.includes(p.name)
    );

    if (policiesToRemove.length > 0) {
      this.#logs$.next(
        `Removing unneeded policies: [${policiesToRemove
          .map((p) => p.id)
          .join(", ")}]`
      );
      await this.#kibanaClient("POST", "/api/fleet/package_policies/delete", {
        packagePolicyIds: policiesToRemove.map((p) => p.id),
        force: true,
      });
    }

    for (const integration of this.#config.policy.integrations) {
      // Find latest version
      const { response } = await this.#kibanaClient<{
        response: PackageResponse;
      }>("GET", `/api/fleet/epm/packages/${integration.package}`);

      const expectedPackagePolicy = generateDefaultPackagePolicy(
        response,
        this.#config.id,
        agentPolicyId,
        integration
      );

      const existingPackagePolicy =
        existingAgentPolicy &&
        existingPackagePolicies.find(
          (p) => p.name === expectedPackagePolicy.name
        );

      if (existingPackagePolicy) {
        // Naive diff that works because we specify defaults for every field
        const diff = updatedDiff(existingPackagePolicy, expectedPackagePolicy);

        if (Object.keys(diff).length > 0) {
          this.#logs$.next(
            `Updating package policy [${
              existingPackagePolicy.name
            }], diff: ${JSON.stringify(diff, undefined, 2)}`
          );

          await this.#kibanaClient(
            "PUT",
            `/api/fleet/package_policies/${existingPackagePolicy.id}`,
            expectedPackagePolicy
          );
        }
      } else {
        this.#logs$.next(
          `Creating new package policy [${expectedPackagePolicy.name}]`
        );
        await this.#kibanaClient(
          "POST",
          "/api/fleet/package_policies",
          expectedPackagePolicy
        );
      }
    }

    this.#enrollmentToken = enrollmentToken;
    this.#agentPolicyId = agentPolicyId;
  }

  async #addAgent(): Promise<void> {
    const randomId = randomBytes(6)
      .toString("base64")
      .split("")
      .filter((s) => s.match(allowedDockerChars))
      .join("");

    const container = await this.#backend.launchContainer({
      name: `fbi-recipe-${this.#config.id}-${randomId}`,
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
    this.#logs$.next(`Enrolling agent in container [${container.shortId}]`);
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
