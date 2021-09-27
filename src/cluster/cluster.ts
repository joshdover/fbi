import dedent from "dedent";
import { ContainerBackend, Container } from "./backends";
import { Logger } from "./types";

export class Cluster {
  private esContainer?: Container;
  private kibanaContainer?: Container;
  constructor(
    private readonly backend: ContainerBackend,
    private readonly logger?: Logger
  ) {}

  public async setup() {
    // Start ES
    this.esContainer = await this.backend.launchContainer({
      image: "docker.elastic.co/elasticsearch/elasticsearch:7.15.0",
      files: {
        "/usr/share/elasticsearch/config/elasticsearch.yml": dedent(`
        xpack.security.authc.api_key.enabled: true
        http.host: 0.0.0.0
        `),
      },
    });

    // Start Kibana
    this.kibanaContainer = await this.backend.launchContainer({
      image: "docker.elastic.co/kibana/kibana:7.15.0",
      files: {
        "/usr/share/kibana/config/kibana.yml": dedent(`
        server.host: 0.0.0.0
        `),
      },
    });

    // Start Fleet Server
  }

  public async shutdown() {
    await this.esContainer?.stop();
  }
}
