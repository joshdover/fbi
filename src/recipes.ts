import fs from "fs/promises";
import path from "path";
import yaml from "js-yaml";
import { AgentConfig } from "./cluster/agent_group";

export class RecipeBook {
  private readonly recipes = new Map<string, AgentConfig>();

  public async loadRecipesFromDirectory(dirPath: string): Promise<void> {
    for (const fileName of await fs.readdir(dirPath)) {
      const fileContents = await fs.readFile(path.join(dirPath, fileName), {
        encoding: "utf-8",
      });
      const agentConfig = yaml.load(fileContents) as AgentConfig;
      // TODO: add validation
      this.recipes.set(agentConfig.id, agentConfig);
    }
  }

  public getRecipes(): AgentConfig[] {
    return [...this.recipes.values()];
  }
}
