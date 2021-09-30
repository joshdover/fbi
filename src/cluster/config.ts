import yaml from "js-yaml";
import fs from "fs/promises";
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

export const readConfig = async (): Promise<ClusterConfig> => {
  const configYaml = await fs.readFile(
    path.join(__dirname, "..", "..", "config", "fbi.yml"),
    { encoding: "utf-8" }
  );
  const parsedConfig: any = yaml.load(configYaml);

  if (!parsedConfig.elasticsearch?.host || !parsedConfig.kibana?.host) {
    throw new Error(
      `kibana.host and elasticsearch.host must be specified in config/fbi.yml`
    );
  }

  return {
    superuser: {
      username: "elastic",
      password: "changeme",
      ...(parsedConfig.superuser || {}),
    },

    kibana: parsedConfig.kibana!,
    elasticsearch: parsedConfig.elasticsearch!,
  };
};
