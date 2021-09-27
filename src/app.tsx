import React, { Component } from "react";

// Rendering a simple centered box
export class App extends Component {
  render(): JSX.Element {
    return (
      <box
        top="center"
        left="center"
        width="50%"
        height="50%"
        border={{ type: "line" }}
        style={{ border: { fg: "blue" } }}
      >
        Hello World!
      </box>
    );
  }
}
