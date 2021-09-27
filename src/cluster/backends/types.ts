export interface Container {
  stop(): Promise<void>;
}

export interface ContainerOptions {
  image: string;
  files?: Record<string, string>;
}

export interface ContainerBackend {
  launchContainer(options: ContainerOptions): Promise<Container>;
}
