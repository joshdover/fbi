import { Container, ContainerBackend, ContainerOptions } from ".";
import Docker, { ContainerCreateOptions } from "dockerode";
import { mkdtemp, writeFile } from "fs/promises";
import path from "path";
import os from "os";
import { Logger } from "../types";

const TEMP_DIR = os.tmpdir();

export class DockerBackend implements ContainerBackend {
  private readonly dockerApi = new Docker({
    socketPath: "/var/run/docker.sock",
    protocol: "http",
  });
  private readonly containers = new Map<string, DockerContainer>();

  constructor(private readonly logger: Logger) {}

  public async launchContainer(options: ContainerOptions): Promise<Container> {
    const container = new DockerContainer(this.dockerApi, options, this.logger);
    await container.launch();
    this.containers.set("x", container);
    return container;
  }
}

class DockerContainer implements Container {
  private container?: Docker.Container;

  constructor(
    private readonly dockerApi: Docker,
    private readonly options: ContainerOptions,
    private readonly logger: Logger
  ) {}

  public async launch() {
    this.logger.log("setup from DockerContainer");
    // Setup temp files to mount
    const tempDir = await mkdtemp(path.join(TEMP_DIR, "fbi-"));
    const binds = await Object.entries(this.options.files || {}).reduce(
      async (acc, [fileName, fileContents], idx) => {
        const accRes = await acc;
        const tempFileName = path.join(tempDir, idx.toString());
        await writeFile(tempFileName, fileContents);
        return [...accRes, `${tempFileName}:${fileName}`];
      },
      Promise.resolve([] as string[])
    );

    const options: ContainerCreateOptions = {
      Image: this.options.image,
      HostConfig: {
        Binds: binds,
      },
    };

    this.logger.log(
      `Starting container with options: ${JSON.stringify(
        options,
        undefined,
        2
      )}`
    );

    this.container = await this.dockerApi.createContainer(options);
    await this.container.start();

    this.logger.log(`Container [${this.container.id}] started.`);
  }

  public async stop() {
    if (!this.container) {
      this.logger.log(`Cannot stop container that isn't started.`);
      return;
    }

    this.logger.log(`Stopping container [${this.container.id}]`);
    await this.container.stop();
    this.logger.log(`Stopped container [${this.container.id}]`);
    this.logger.log(`Removing container [${this.container.id}]`);
    await this.container.remove();
    this.logger.log(`Removed container [${this.container.id}]`);
  }
}
