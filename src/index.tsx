import React, {Component} from 'react';
import blessed from 'neo-blessed';
import {createBlessedRenderer} from 'react-blessed';
import { App } from './app';

const render = createBlessedRenderer(blessed);

export const cli = () => {
  // Creating our screen
  const screen = blessed.screen({
    autoPadding: true,
    smartCSR: true,
    title: 'react-blessed hello world'
  });

  // Adding a way to quit the program
  screen.key(['escape', 'q', 'C-c'], (ch, key) => {
    return process.exit(0);
  });

  // Rendering the React app using our screen
  const component = render(<App />, screen);
}
