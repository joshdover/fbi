import React from "react";
import blessed from "neo-blessed";
import { createBlessedRenderer } from "react-blessed";
import { App } from "./app";

const render = createBlessedRenderer(blessed);

export const cli = (): void => {
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
  render(<App />, screen);
};
