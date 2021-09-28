import { Container, ContainerBackend, ContainerOptions } from ".";
import Docker, { ContainerCreateOptions } from "dockerode";
import { mkdtemp, writeFile } from "fs/promises";
import path from "path";
import os from "os";
import { Logger } from "../types";

const TEMP_DIR = os.tmpdir();

export class DockerBackend implements ContainerBackend {
  public readonly dockerApi = new Docker({
    socketPath: "/var/run/docker.sock",
    protocol: "http",
  });
  public network?: Docker.Network;
  private readonly containers = new Map<string, DockerContainer>();

  constructor(private readonly logger: Logger) {}

  public async setup(): Promise<void> {
    this.network = await this.dockerApi.createNetwork({
      Name: "fbi",
    });
  }

  public async cleanup(): Promise<void> {
    await this.network?.remove();
  }

  public async launchContainer(options: ContainerOptions): Promise<Container> {
    const container = new DockerContainer(this, options, this.logger);
    await container.launch();
    this.containers.set("x", container);
    return container;
  }
}

class DockerContainer implements Container {
  private container?: Docker.Container;

  constructor(
    private readonly backend: DockerBackend,
    private readonly options: ContainerOptions,
    private readonly logger: Logger
  ) {}

  public async launch() {
    this.logger.log("setup from DockerContainer");
    // Setup temp files to mount
    const tempDir = await mkdtemp(path.join(TEMP_DIR, "fbi-"));
    const initBinds = Object.entries(this.options.mounts ?? {}).reduce(
      (acc, [localPath, containerPath]) => {
        return [...acc, `${path.resolve(localPath)}:${containerPath}`];
      },
      [] as string[]
    );
    const binds = await Object.entries(this.options.files ?? {}).reduce(
      async (acc, [fileName, fileContents], idx) => {
        const accRes = await acc;
        const tempFileName = path.join(tempDir, idx.toString());
        await writeFile(tempFileName, fileContents);
        return [...accRes, `${tempFileName}:${fileName}`];
      },
      Promise.resolve(initBinds)
    );

    const options: ContainerCreateOptions = {
      Image: this.options.image,
      Env: Object.entries(this.options.env ?? {}).map(
        ([key, val]) => `${key}=${val}`
      ),
      ExposedPorts: (this.options.ports ?? []).reduce(
        (acc, port) => ({ ...acc, [port]: {} }),
        {}
      ),
      Hostname: this.options.hostname,
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

    this.container = await this.backend.dockerApi.createContainer(options);
    await this.container.start();

    this.logger.log(`Container [${this.container.id}] started.`);

    await this.backend.network?.connect({ Container: this.container.id });
    this.logger.log(`Container [${this.container.id}] connected to network.`);
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

  public exec({ env, cmd }: { env?: Record<string, string>; cmd: string[] }) {
    if (!this.container) {
      throw new Error(`Cannot exec before container is started!`);
    }
    const container = this.container; // make TS happy

    // eslint-disable-next-line no-async-promise-executor
    return new Promise<string>(async (resolve, reject) => {
      const Env = Object.entries(env ?? {}).reduce(
        (acc, [key, val]) => [...acc, `${key}=${val}`],
        [] as string[]
      );
      const execution = await container.exec({ Cmd: cmd, Env });
      const result = await execution.start({ Tty: false, stdin: false });
      result.on("data", (d) => this.logger.log(`Exec output: ${d}`));
      result.on("done", resolve);
      result.on("error", reject);
    });
  }
}
