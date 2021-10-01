import { AgentConfig } from "./agent_group";

export interface PackageResponse {
  name: string;
  version: string;
  title: string;
  data_streams: PackageDataStream[];
  policy_templates?: PolicyTemplate[];
}

interface PackageDataStream {
  type: "logs" | "metrics";
  dataset: string;
  ingest_pipeline: "string";
  package: string;
  path: string;
  streams: Array<{
    enabled: boolean;
    input: string;
    template_path: string;
    title: string;
    vars?: PolicyTemplateInputVar[];
  }>;
}

interface PolicyTemplate {
  name: string;
  description: string;
  title: string;
  multiple: boolean;
  inputs: PolicyTemplateInput[];
}

interface PolicyTemplateInput {
  type: string;
  title: string;
  description: string;
  name: string;
  vars?: PolicyTemplateInputVar[];
}

interface PolicyTemplateInputVar<
  T extends string | boolean | unknown = unknown
> {
  default?: T;
  required: boolean;
  multi: boolean;
  name: string;
  title: string;
  type: "text" | "password" | "bool" | "yaml";
}

export interface PackagePolicy {
  name: string;
  description: string;
  namespace: string;
  policy_id: string;
  enabled: boolean;
  package: {
    name: string;
    title: string;
    version: string;
  };
  output_id: string;
  inputs: PackagePolicyInput[];
}

interface PackagePolicyInput {
  type: string;
  policy_template?: string;
  enabled: boolean;
  keep_enabled?: boolean;
  vars?: PackagePolicyInputConfigRecord;
  config?: Record<string, { type?: string; value?: any }>;
  streams: PackagePolicyInputStream[];
}

interface PackagePolicyInputStream {
  id: string;
  enabled: boolean;
  keep_enabled?: boolean;
  data_stream: {
    dataset: string;
    type: string;
    elasticsearch?: {
      privileges?: {
        indices?: string[];
      };
    };
  };
  vars?: PackagePolicyInputConfigRecord;
  config?: Record<string, { type?: string; value?: any }>;
}

type PackagePolicyInputConfigRecord = Record<
  string,
  { type?: string; value?: any; frozen?: boolean }
>;

export const getPackagePolicyName = (
  agentConfigId: string,
  integration: AgentConfig["policy"]["integrations"][number]
): string => {
  return integration.name ?? `fbi-${agentConfigId}-${integration.package}`;
};

export const generateDefaultPackagePolicy = (
  response: PackageResponse,
  agentConfigId: string,
  agentPolicyId: string,
  integration: AgentConfig["policy"]["integrations"][number]
): PackagePolicy => {
  const {
    name: pkgName,
    version,
    title,
    policy_templates,
    data_streams,
  } = response;

  const packagePolicy: PackagePolicy = {
    name: getPackagePolicyName(agentConfigId, integration),
    description: integration.description ?? "",
    enabled: true,
    package: {
      title,
      name: pkgName,
      version,
    },
    namespace: integration.namespace ?? "default",
    output_id: integration.output_id ?? "default",
    inputs: generateInputsFromPolicyTemplates(
      policy_templates ?? [],
      data_streams
    ),
    policy_id: agentPolicyId,
  };

  return packagePolicy;
};

const generateInputsFromPolicyTemplates = (
  templates: PolicyTemplate[],
  dataStreams: PackageDataStream[]
): PackagePolicyInput[] => {
  return templates.flatMap((template) => {
    return template.inputs.map((templateInput) => {
      const dataStreamsFiltered = dataStreams
        .filter((ds) => ds.streams.find((s) => s.input === templateInput.type))
        .map((ds) => ({
          ...ds,
          streams: ds.streams.filter((s) => s.input === templateInput.type),
        }));

      const streams: PackagePolicyInputStream[] = dataStreamsFiltered.map(
        (dataStream) =>
          ({
            enabled: dataStream.streams.some((s) => s.enabled !== false),
            data_stream: {
              dataset: dataStream.dataset,
              type: dataStream.type,
            },
            vars: dataStream.streams.reduce((acc, stream) => {
              return {
                ...acc,
                ...Object.fromEntries(
                  (stream.vars ?? []).map((varDef) => [
                    varDef.name,
                    {
                      type: varDef.type,
                      value: varDef.default,
                    },
                  ])
                ),
              };
            }, {} as PackagePolicyInputConfigRecord),
          } as PackagePolicyInputStream)
      );

      return {
        enabled: streams.some((s) => s.enabled),
        policy_template: template.name,
        type: templateInput.type,
        vars: Object.fromEntries(
          (templateInput.vars ?? []).map((varDef) => [
            varDef.name,
            {
              type: varDef.type,
              value: varDef.default,
            },
          ])
        ) as PackagePolicyInputConfigRecord,
        streams,
      };
    });
  });
};
