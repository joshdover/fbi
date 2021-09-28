import React from "react";
import blessed from "neo-blessed";
import { createBlessedRenderer } from "react-blessed";
import { App } from "./app";
import { Cluster, ClusterConfig, DockerBackend } from "./cluster";
import { BehaviorSubject } from "rxjs";

const render = createBlessedRenderer(blessed);

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

export const cli = (): void => {
  // Set up our backend
  const logger = {
    logs: ["init log 2"] as string[],
    logs$: new BehaviorSubject("init log"),
    log: (msg: string) => {
      logger.logs.push(msg);
      logger.logs$.next(msg);
    },
  };

  process.on("unhandledRejection", (err) => {
    logger.log((err ?? "").toString());
  });

  const cluster = new Cluster(clusterConfig, new DockerBackend(logger), logger);

  // Creating our screen
  const screen = blessed.screen({
    autoPadding: true,
    smartCSR: true,
    title: "fbi",
  });

  // Adding a way to quit the program
  screen.key(["escape", "q", "C-c"], () => {
    return process.exit(0);
  });

  // Rendering the React app using our screen
  render(
    <App cluster={cluster} logs$={logger.logs$} log={logger.log} />,
    screen
  );
};
