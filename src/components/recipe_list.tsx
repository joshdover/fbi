import React, { useCallback, useState } from "react";
import { AgentGroupStatus } from "../cluster/cluster";

interface Props {
  recipes: Record<string, AgentGroupStatus>;
  configureAgentGroupPolicy(id: string): void;
  scaleAgentGroup(id: string, size: number): void;
}

export const RecipeList: React.FC<Props> = ({
  recipes,
  configureAgentGroupPolicy,
  scaleAgentGroup,
}) => {
  return (
    <>
      {Object.entries(recipes).map(([recipeId, status], idx) => (
        <box height={1} top={idx} key={recipeId}>
          <Recipe
            id={recipeId}
            status={status}
            configureAgentGroupPolicy={() =>
              configureAgentGroupPolicy(recipeId)
            }
            scaleAgentGroup={(size: number) => scaleAgentGroup(recipeId, size)}
          />
        </box>
      ))}
    </>
  );
};

const Recipe: React.FC<{
  id: string;
  status: AgentGroupStatus;
  configureAgentGroupPolicy(): void;
  scaleAgentGroup(size: number): void;
}> = ({ id, status, configureAgentGroupPolicy, scaleAgentGroup }) => {
  const count = status.size;
  const paddedCount = count.toString().length === 1 ? ` ${count}` : `${count}`;

  const scaleUp = useCallback(() => {
    scaleAgentGroup(count + 1);
  }, [scaleAgentGroup, count]);

  const scaleDown = useCallback(() => {
    scaleAgentGroup(count - 1);
  }, [scaleAgentGroup, count]);

  return (
    <box width="100%-2" height={1}>
      <box width="100%-5" height={1} left={0}>
        {id}
      </box>
      {status.policy === "not_created" ? (
        <button
          mouse
          height={1}
          width={13}
          right={0}
          onPress={configureAgentGroupPolicy}
        >
          Create policy
        </button>
      ) : null}
      {status.policy === "creating" ? (
        <box height={1} width={11} right={0}>
          Creating...
        </box>
      ) : null}
      {status.policy === "error" ? (
        <box height={1} width={15} right={0}>
          Error, see logs
        </box>
      ) : null}
      {status.policy === "created" ? (
        <>
          <button mouse width={1} height={1} right={4} onPress={scaleUp}>
            +
          </button>
          <box width={3} height={1} right={1}>
            {paddedCount}
          </box>
          <button mouse width={1} height={1} right={0} onPress={scaleDown}>
            -
          </button>
        </>
      ) : null}
    </box>
  );
};
