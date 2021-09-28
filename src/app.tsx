import React, {
  useCallback,
  useEffect,
  useState,
  useRef,
  Component,
} from "react";
import { Cluster } from "./cluster";
import { Observable } from "rxjs";
import { Widgets } from "neo-blessed";

// Rendering a simple centered box
export const App: React.FC<{
  cluster: Cluster;
  logs$: Observable<string>;
  log: (msg: string) => void;
}> = ({ cluster, logs$, log }) => {
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

  const logsRef = useRef<Widgets.Log>(null);
  useEffect(() => {
    const subscription = logs$.subscribe((log) => logsRef.current?.add(log));
    return () => {
      subscription.unsubscribe();
    };
  }, [logs$]);

  return (
    <box top="center" left="center" width="100%" height="100%">
      <box
        label="Cluster Controls"
        top={0}
        left={0}
        right={0}
        width="100%"
        height={5}
        border={{ type: "line" }}
        style={{ border: { fg: "blue" } }}
      >
        {currentState}
        <button mouse onPress={handleSetupClick}>
          Setup
        </button>
        <button mouse top={2} onPress={handleShutdownClick}>
          Shutdown
        </button>
      </box>
      <box top={5} left={0} right={0} width="100%" height="100%-5">
        <box
          label="Recipes"
          top={0}
          left={0}
          width="50%"
          height="100%"
          border={{ type: "line" }}
          style={{ border: { fg: "blue" } }}
        >
          Recipes
        </box>
        <log
          label="Logs"
          top={0}
          right={0}
          width="50%"
          height="100%"
          border={{ type: "line" }}
          style={{
            border: { fg: "blue" },
            scrollbar: { fg: "green" },
          }}
          scrollOnInput
          mouse
          scrollable
          ref={logsRef}
        />
      </box>
    </box>
  );
};
