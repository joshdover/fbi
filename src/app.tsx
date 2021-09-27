import React, {
  useCallback,
  useEffect,
  useState,
  useRef,
  Component,
} from "react";
import { Cluster } from "./cluster";

// Rendering a simple centered box
export const App: React.FC<{
  cluster: Cluster;
  logs: string[];
  log: (msg: string) => void;
}> = ({ cluster, logs, log }) => {
  const [currentState, setCurrentState] = useState("boot");
  const handleSetupClick = useCallback(async () => {
    log("starting setup");
    await cluster.setup();
    setCurrentState("setup");
    log("done with setup");
  }, [cluster]);
  const handleShutdownClick = useCallback(async () => {
    await cluster.shutdown();
    setCurrentState("shutdown");
  }, [cluster]);

  return (
    <box label="FBI" top="center" left="center" width="99%" height="99%">
      <box
        label="Status"
        top="2%"
        left="1%"
        width="30%"
        height="96%"
        border={{ type: "line" }}
        style={{ border: { fg: "blue" } }}
      >
        {currentState}
      </box>
      <box
        label="Controls"
        top="2%"
        left="32%"
        width="30%"
        height="96%"
        border={{ type: "line" }}
        style={{ border: { fg: "blue" } }}
      >
        <button mouse onPress={handleSetupClick}>
          Setup
        </button>
        <button mouse top={2} onPress={handleShutdownClick}>
          Shutdown
        </button>
      </box>
      <log
        label="Logs"
        top="2%"
        left="63%"
        width="30%"
        height="96%"
        border={{ type: "line" }}
        style={{ border: { fg: "blue" } }}
        scrollOnInput
        mouse
        scrollable
      >
        {logs.join("\n")}
      </log>
    </box>
  );
};
