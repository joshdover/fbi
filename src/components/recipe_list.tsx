import React, { useCallback, useState } from "react";
import { AgentConfig } from "../cluster/cluster";

interface RecipeState {
  agentConfig: AgentConfig;
  count: number;
}

interface Props {
  recipes: RecipeState[];
  scaleAgentGroup(id: string, size: number): void;
}

export const RecipeList: React.FC<Props> = ({ recipes, scaleAgentGroup }) => {
  return (
    <>
      {recipes.map((r) => (
        <Recipe
          recipe={r}
          key={r.agentConfig.id}
          scaleAgentGroup={(size: number) =>
            scaleAgentGroup(r.agentConfig.id, size)
          }
        />
      ))}
    </>
  );
};

const Recipe: React.FC<{
  recipe: RecipeState;
  scaleAgentGroup(size: number): void;
}> = ({ recipe, scaleAgentGroup }) => {
  const [count, setCount] = useState(recipe.count);

  const paddedCount = count.toString().length === 1 ? ` ${count}` : `${count}`;

  const scaleUp = useCallback(() => {
    scaleAgentGroup(count + 1);
    setCount(count + 1);
  }, [scaleAgentGroup, count]);

  const scaleDown = useCallback(() => {
    scaleAgentGroup(count - 1);
    setCount(count - 1);
  }, [scaleAgentGroup, count]);

  return (
    <box width="100%-2" height={1}>
      <box width="100%-5" height={1} left={0}>
        {recipe.agentConfig.id}
      </box>
      <button mouse width={1} height={1} right={4} onPress={scaleUp}>
        +
      </button>
      <box width={3} height={1} right={1}>
        {paddedCount}
      </box>
      <button mouse width={1} height={1} right={0} onPress={scaleDown}>
        -
      </button>
    </box>
  );
};
