import React, { useCallback, useEffect, useState, useRef } from "react";
import { Cluster } from "./cluster";
import { Observable } from "rxjs";
import { Widgets } from "neo-blessed";
import { RecipeList } from "./components/recipe_list";
import { RecipeBook } from "./recipes";
import { ClusterStatus, ComponentStatus } from "./cluster/cluster";

interface Props {
  cluster: Cluster;
  logs$: Observable<string>;
  recipeBook: RecipeBook;
}

export const App: React.FC<Props> = ({ cluster, logs$ }) => {
  const logsRef = useRef<Widgets.Log>(null);
  useEffect(() => {
    const subscription = logs$.subscribe((log) => {
      logsRef.current?.add(log);
    });
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

  const controlPanelHeight = 8;

  const availableButton =
    clusterStatus?.backend == "stopped" &&
    clusterStatus?.fleetServer == "stopped"
      ? "setup"
      : clusterStatus?.backend == "running" &&
        clusterStatus?.fleetServer == "running"
      ? "shutdown"
      : "none";

  const handleSetupClick = useCallback(async () => {
    if (availableButton !== "setup") return;
    await cluster.setup();
  }, [cluster, availableButton]);
  const handleShutdownClick = useCallback(async () => {
    if (availableButton !== "shutdown") return;
    await cluster.shutdown();
  }, [cluster, availableButton]);

  return (
    <box top="center" left="center" width="100%" height="100%">
      <box
        label="Cluster Controls"
        top={0}
        left={0}
        right={0}
        width="100%"
        height={controlPanelHeight}
        border={{ type: "line" }}
        style={{ border: { fg: "blue" } }}
      >
        <box height="100%-3" left={2} top={1} width={40}>
          <ComponentStatusBadge label="Elasticsearch" status={"running"} />
          <ComponentStatusBadge label="Kibana" status={"running"} top={1} />
          <ComponentStatusBadge
            label="Network"
            status={clusterStatus?.backend}
            top={2}
          />
          <ComponentStatusBadge
            label="Fleet Server"
            status={clusterStatus?.fleetServer}
            top={3}
          />
        </box>
        <box height="100%-3" width={40} right={2} top={0}>
          <button
            height={3}
            left={0}
            top={0}
            width="100%"
            border={{ type: "line" }}
            style={{
              fg: availableButton === "setup" ? "white" : "grey",
              border: { fg: availableButton === "setup" ? "white" : "grey" },
            }}
            align="center"
            mouse
            // @ts-expect-error unsure how to fix this without forking the types
            onPress={handleSetupClick}
            content="Setup"
          />
          <button
            height={3}
            left={0}
            top={3}
            width="100%"
            border={{ type: "line" }}
            style={{
              fg: availableButton === "shutdown" ? "white" : "grey",
              border: { fg: availableButton === "shutdown" ? "white" : "grey" },
            }}
            align="center"
            mouse
            // @ts-expect-error same
            onPress={handleShutdownClick}
            content="Shutdown"
          />
        </box>
      </box>
      <box
        top={controlPanelHeight}
        left={0}
        right={0}
        width="100%"
        height={`100%-${controlPanelHeight}`}
      >
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
            configureAgentGroupPolicy={cluster.configureAgentGroupPolicy.bind(
              cluster
            )}
            recipes={clusterStatus?.agentGroups ?? {}}
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

const ComponentStatusBadge: React.FC<{
  label: string;
  status?: ComponentStatus;
  top?: number;
}> = ({ label, status, top }) => {
  const statusColor =
    status == "stopped"
      ? "red"
      : status == "starting"
      ? "yellow"
      : status == "running"
      ? "green"
      : status == "error"
      ? "red"
      : "gray";

  const statusText = ` ${status?.toUpperCase() ?? "unknown"}`.toUpperCase();

  return (
    <box width="100%" height={1} top={top ?? 0} left={0}>
      <text
        width={9}
        height={1}
        top={0}
        left={0}
        style={{ bg: statusColor, fg: "#000000" }}
        align="center"
        content={statusText}
      />
      <box width="100%-10" height={1} top={0} left={11}>
        {label}
      </box>
    </box>
  );
};
