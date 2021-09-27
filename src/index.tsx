import React from "react";
import blessed from "neo-blessed";
import { createBlessedRenderer } from "react-blessed";
import { App } from "./app";
import { Cluster, DockerBackend } from "./cluster";

const render = createBlessedRenderer(blessed);

export const cli = (): void => {
  // Set up our backend
  const logger = {
    logs: ["init log 2"] as string[],
    log: (msg: string) => logger.logs.push(msg),
  };

  process.on("unhandledRejection", (err) => {
    logger.log((err ?? "").toString());
  });

  const cluster = new Cluster(new DockerBackend(logger), logger);

  // Creating our screen
  const screen = blessed.screen({
    autoPadding: true,
    smartCSR: true,
    title: "react-blessed hello world",
  });

  // Adding a way to quit the program
  screen.key(["escape", "q", "C-c"], () => {
    return process.exit(0);
  });

  // Rendering the React app using our screen
  render(<App cluster={cluster} logs={logger.logs} log={logger.log} />, screen);
};
