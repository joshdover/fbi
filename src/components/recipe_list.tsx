import React, { useCallback, useState } from "react";
import { AgentGroupStatus, ResolvedAgentPolicy } from "../cluster/agent_group";
import { range } from "../utils";

interface Props {
  recipes: Record<
    string,
    { policy: ResolvedAgentPolicy; status: AgentGroupStatus }
  >;
  configureAgentGroupPolicy(id: string): void;
  scaleAgentGroup(id: string, size: number): void;
}

export const RecipeList: React.FC<Props> = ({
  recipes,
  configureAgentGroupPolicy,
  scaleAgentGroup,
}) => {
  return (
    <layout width="100%-2" height="100%-2" layout="inline">
      {Object.entries(recipes).map(([recipeId, { policy, status }], idx) => (
        <Recipe
          id={recipeId}
          // @ts-expect-error not sure what's up here
          key={idx}
          policy={policy}
          status={status}
          configureAgentGroupPolicy={() => configureAgentGroupPolicy(recipeId)}
          scaleAgentGroup={(size: number) => scaleAgentGroup(recipeId, size)}
        />
      ))}
    </layout>
  );
};

const Recipe: React.FC<{
  id: string;
  policy: ResolvedAgentPolicy;
  status: AgentGroupStatus;
  configureAgentGroupPolicy(): void;
  scaleAgentGroup(size: number): void;
}> = ({ id, policy, status, configureAgentGroupPolicy, scaleAgentGroup }) => {
  const [expanded, setExpanded] = useState(false);
  const toggleExpanded = useCallback(
    () => setExpanded(!expanded),
    [expanded, setExpanded]
  );
  const count = status.size;

  const scaleUp = useCallback(() => {
    scaleAgentGroup(count + 1);
  }, [scaleAgentGroup, count]);

  const scaleDown = useCallback(() => {
    scaleAgentGroup(count - 1);
  }, [scaleAgentGroup, count]);

  const policyButtonProps = {
    width: 17,
    right: 0,
    align: "center" as const,
    border: "line" as const,
  };

  // Implement padding manually since align="center" isn't working on this?
  const sizeWidth = 7;
  const sizeString = status.size.toString();
  const numSpacesNeeded = Math.floor((sizeWidth - sizeString.length) / 2);
  const sizeStringPadded = `${range(numSpacesNeeded)
    .map(() => " ")
    .join("")}${sizeString}`;

  return (
    <box width="100%" height={expanded ? 8 : 3}>
      <box width="100%" height={3}>
        <button
          width={1}
          left={1}
          top={1}
          content={expanded ? "˅" : ">"}
          mouse
          // @ts-expect-error same
          onPress={toggleExpanded}
        />
        <button
          mouse
          // @ts-expect-error same
          onPress={toggleExpanded}
          content={id}
          width="100%-5"
          left={3}
          top={1}
        />
        {status.policy === "not_created" || status.policy === "creating" ? (
          <button
            mouse
            // @ts-expect-error same
            onPress={configureAgentGroupPolicy}
            {...policyButtonProps}
            align="center"
            content="Setup policy"
          />
        ) : null}
        {status.policy === "creating" ? (
          <box
            {...policyButtonProps}
            style={{ fg: "grey", border: { fg: "grey" } }}
            content="Creating..."
          />
        ) : null}
        {status.policy === "error" ? (
          <box {...policyButtonProps} content="Error, see logs" />
        ) : null}
        {status.policy === "created" ? (
          <layout width={17} right={0} height="100%">
            <button
              mouse
              width={5}
              height="100%"
              align="center"
              valign="middle"
              // @ts-expect-error same
              onPress={scaleDown}
              content="-"
              style={{ fg: "black", bg: "lightgrey" }}
            />
            <box
              width={sizeWidth}
              height="100%"
              valign="middle"
              content={sizeStringPadded}
              style={{ bg: "black" }}
            />
            <button
              mouse
              width={5}
              height="100%"
              align="center"
              valign="middle"
              // @ts-expect-error same
              onPress={scaleUp}
              content="+"
              style={{ fg: "black", bg: "lightgrey" }}
            />
          </layout>
        ) : null}
      </box>
      {expanded ? (
        <box top={3} height={6}>
          <layout height="100%" width="100%">
            <CollapsibleLine />
            <text width="100%">{`Policy Name: ${policy.name}`}</text>
            <text width="100%">{`Integrations: ${policy.integrations
              .map((i) => i.package)
              .join(", ")}`}</text>
            <text width="100%">{`Namespace: ${policy.namespace}`}</text>
            <CollapsibleLine />
          </layout>
        </box>
      ) : null}
    </box>
  );
};

const CollapsibleLine = () => (
  <line
    width="100%"
    height={1}
    orientation="horizontal"
    type="line"
    style={{
      border: {
        type: "line",
        fg: "blue",
      },
    }}
  />
);
