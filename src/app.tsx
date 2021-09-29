import React, { useCallback, useEffect, useState, useRef } from "react";
import { Cluster } from "./cluster";
import { Observable } from "rxjs";
import { Widgets } from "neo-blessed";
import { RecipeList } from "./components/recipe_list";
import { RecipeBook } from "./recipes";
import { ClusterStatus } from "./cluster/cluster";

interface Props {
  cluster: Cluster;
  logs$: Observable<string>;
  log: (msg: string) => void;
  recipeBook: RecipeBook;
}

export const App: React.FC<Props> = ({ cluster, logs$, log, recipeBook }) => {
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

  const [clusterStatus, setClusterStatus] = useState<
    ClusterStatus | undefined
  >();
  useEffect(() => {
    const subscription = cluster
      .getStatus$()
      .subscribe((s) => setClusterStatus(s));
    return () => {
      subscription.unsubscribe();
    };
  }, [cluster]);

  const backendStatus = `Backend: ${clusterStatus?.backend}`;
  const fleetServerStatus = `Fleet Server: ${clusterStatus?.fleetServer}`;

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
        <box height="100%-2" left={0} top={0} width={40}>
          <box width="100%" height={1} top={0} left={0}>
            {backendStatus}
          </box>
          <box width="100%" height={1} top={1} left={0}>
            {fleetServerStatus}
          </box>
        </box>
        <button
          height="100%-2"
          left={40}
          top={0}
          width={20}
          mouse
          onPress={handleSetupClick}
        >
          Setup
        </button>
        <button
          height="100%-2"
          left={60}
          top={0}
          width={20}
          mouse
          onPress={handleShutdownClick}
        >
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
          <RecipeList
            scaleAgentGroup={cluster.scaleAgentGroup.bind(cluster)}
            recipes={recipeBook
              .getRecipes()
              .map((r) => ({ agentConfig: r, count: 0 }))}
          />
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
