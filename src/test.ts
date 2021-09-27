import { Cluster, DockerBackend } from "./cluster";

export const runDockerTest = async () => {
  const logger = { log: console.log };
  const backend = new DockerBackend(logger);
  const cluster = new Cluster(backend, logger);
  logger.log("Setup...");
  await cluster.setup();
  await cluster.shutdown();
};
