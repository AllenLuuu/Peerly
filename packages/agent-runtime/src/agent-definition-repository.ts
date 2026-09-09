import type { RuntimeAgentDefinition } from "@peerly/agent-protocol";

export interface AgentDefinitionRepository {
  exists(id: string): Promise<boolean>;
  findById(id: string): Promise<RuntimeAgentDefinition | undefined>;
  list(): Promise<RuntimeAgentDefinition[]>;
  create(agent: RuntimeAgentDefinition): Promise<void>;
  update(agent: RuntimeAgentDefinition): Promise<void>;
  delete(id: string): Promise<void>;
}
