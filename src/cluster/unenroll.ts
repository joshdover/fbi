import { StackClient } from "./types";

export const unenrollAgentForHostname = async (
  hostname: string,
  kibanaClient: StackClient,
  log: (msg: string) => void,
  expectedAgentPolicyId?: string
): Promise<void> => {
  const agentsResponse = await kibanaClient<{
    total: number;
    list: Array<{
      id: string;
      policy_id: string;
    }>;
  }>(
    "GET",
    `/api/fleet/agents?perPage=1&kuery=local_metadata.host.hostname:"${hostname}"`
  );

  if (agentsResponse.total > 1) {
    log(
      `Warning: multiple agents with hostname [${hostname}], skipping unenrollment`
    );
  } else if (agentsResponse.total === 1) {
    const agent = agentsResponse.list[0]!;
    if (expectedAgentPolicyId && agent.policy_id !== expectedAgentPolicyId) {
      log(
        `Warning: unexpected policy id [${agent.policy_id}] for agent hostname [${hostname}], skipping unenrollment`
      );
    } else {
      await kibanaClient(
        "POST",
        `/api/fleet/agents/${agentsResponse.list[0].id}/unenroll`,
        { revoke: true, force: true }
      );
    }
  }
};
