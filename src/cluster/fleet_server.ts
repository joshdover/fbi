import { BehaviorSubject, Observable, ReplaySubject } from "rxjs";
import { Container, ContainerBackend } from ".";
import { ComponentStatus } from "./cluster";
import { StackClient } from "./types";
import { unenrollAgentForHostname } from "./unenroll";

export class FleetServer {
  #status$ = new BehaviorSubject<ComponentStatus>("stopped");
  #logs$ = new ReplaySubject<string>();
  #backend: ContainerBackend;
  #esClient: StackClient;
  #kibanaClient: StackClient;
  #esHost: string;
  #serviceToken?: string;
  #container?: Container;

  constructor(
    backend: ContainerBackend,
    esClient: StackClient,
    esHost: string,
    kibanaClient: StackClient
  ) {
    this.#backend = backend;
    this.#esClient = esClient;
    this.#esHost = esHost;
    this.#kibanaClient = kibanaClient;
  }

  public getStatus$(): Observable<ComponentStatus> {
    return this.#status$.asObservable();
  }

  public getLogs$(): Observable<string> {
    return this.#logs$.asObservable();
  }

  public async setup(): Promise<void> {
    this.#status$.next("starting");

    const serviceToken = await this.#createServiceToken();

    this.#container = await this.#backend.launchContainer({
      image: "docker.elastic.co/beats/elastic-agent:8.0.0-SNAPSHOT",
      ports: ["8220"],
      hostname: "fleet-server",
      env: {
        FLEET_SERVER_ENABLE: "true",
        FLEET_SERVER_ELASTICSEARCH_HOST: this.#esHost,
        FLEET_SERVER_SERVICE_TOKEN: serviceToken,
        FLEET_SERVER_INSECURE_HTTP: "1",
      },
    });

    // TODO: Poll Fleet API for agent status of Fleet Server
    this.#status$.next("running");
  }

  public async shutdown(): Promise<void> {
    await this.#container?.stop();
    this.#container = undefined;
    this.#status$.next("stopped");

    await unenrollAgentForHostname(
      "fleet-server",
      this.#kibanaClient,
      this.#logs$.next
    );
  }

  async #createServiceToken(): Promise<string> {
    const resp = await this.#esClient<{ token: { value: string } }>(
      "POST",
      `/_security/service/elastic/fleet-server/credential/token`
    );
    return resp.token.value;
  }
}
