import path from "path";
import React from "react";
import blessed from "neo-blessed";
import { createBlessedRenderer } from "react-blessed";
import { App } from "./app";
import { Cluster, ClusterConfig, DockerBackend } from "./cluster";
import { ReplaySubject } from "rxjs";
import { RecipeBook } from "./recipes";

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

export const cli = async (): Promise<void> => {
  // Set up our backend
  const logger = {
    logs$: new ReplaySubject<string>(),
    log: (msg: string) => {
      logger.logs$.next(msg);
    },
  };

  process.on("unhandledRejection", (err) => {
    logger.log((err ?? "").toString());
    // @ts-expect-error no type
    if (err?.stack) {
      // @ts-expect-error no type
      logger.log(err.stack);
    }
  });

  const recipeBook = new RecipeBook();
  await recipeBook.loadRecipesFromDirectory(
    path.join(__dirname, "..", "recipes")
  );
  const cluster = new Cluster(clusterConfig, new DockerBackend(logger), logger);

  // Create all policies by default for now
  for (const recipe of recipeBook.getRecipes()) {
    cluster.addAgentGroup(recipe);
  }

  // Creating our screen
  const screen = blessed.screen({
    autoPadding: true,
    smartCSR: true,
    title: "fbi",
  });

  // Adding a way to quit the program
  screen.key(["escape", "q", "C-c"], async () => {
    try {
      await cluster.shutdown();
    } finally {
      process.exit(0);
    }
  });

  // Rendering the React app using our screen
  render(
    <App
      cluster={cluster}
      logs$={logger.logs$}
      log={logger.log}
      recipeBook={recipeBook}
    />,
    screen
  );
};
