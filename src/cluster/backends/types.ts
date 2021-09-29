import { Observable } from "rxjs";
import { ComponentStatus } from "../cluster";

export interface Container {
  id: string;
  stop(): Promise<void>;
  exec(options: {
    env: Record<string, string>;
    cmd: string[];
  }): Promise<string>;
}

export interface ContainerOptions {
  image: string;
  hostname?: string;
  /** Mount files from strings, useful for yaml configs */
  files?: Record<string, string>;
  /** Mount files from host into container */
  mounts?: Record<string, string>;
  env?: Record<string, string>;
  ports?: string[];
}

export interface ContainerBackend {
  setup(): Promise<void>;
  cleanup(): Promise<void>;
  getStatus$(): Observable<ComponentStatus>;
  launchContainer(options: ContainerOptions): Promise<Container>;
}
