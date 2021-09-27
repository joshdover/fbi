import { Cluster, DockerBackend } from "./cluster";
import { ClusterConfig } from "./cluster/cluster";

const logger = { log: console.log };
const clusterConfig: ClusterConfig = {
  superuser: {
    username: "elastic",
    password: "changeme",
  },

  elasticsearch: {
    host: "http://192.168.178.38:9200",
  },
  kibana: {
    host: "http://192.168.178.38:5601",
  },
};

export const runDockerTest = async () => {
  const backend = new DockerBackend(logger);
  const cluster = new Cluster(clusterConfig, backend, logger);
  logger.log("Setup...");
  await cluster.setup();

  // logger.log("Waiting 5s until spinning up agents...");
  // await new Promise((resolve) => setTimeout(resolve, 5_000));

  try {
    logger.log("Add a group");
    await cluster.addAgentGroup();
    await cluster.scaleAgentGroup("nginx", 20);
    // logger.log("Waiting 30s until shutting down...");
    // await new Promise((resolve) => setTimeout(resolve, 30_000));
  } finally {
    // await cluster.shutdown();
  }
};
