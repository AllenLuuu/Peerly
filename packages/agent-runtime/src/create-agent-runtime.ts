import {
  agentIdSchema,
  agentModelSchema,
  createAgentInputSchema,
  updateAgentInputSchema,
  type AgentModel,
  type AgentRuntime,
  type CreateAgentInput,
  type RuntimeAgentDefinition,
  type UpdateAgentInput,
} from "@peerly/agent-protocol";
import type { ZodType } from "zod";

import { AgentDefinitionService } from "./agent-definition-service.js";
import { AgentRuntimeOperationError } from "./agent-runtime-operation-error.js";
import { FileAgentDefinitionRepository } from "./file-agent-definition-repository.js";

export interface CreateAgentRuntimeOptions {
  dataDirectory: string;
  defaultModel?: AgentModel;
  generateId?: () => string;
  now?: () => string;
}

export async function createAgentRuntime(
  options: CreateAgentRuntimeOptions,
): Promise<AgentRuntime> {
  const repository = new FileAgentDefinitionRepository(options.dataDirectory);
  await repository.initialize();

  const defaultModel = options.defaultModel
    ? parseInput(agentModelSchema, options.defaultModel)
    : undefined;
  const service = new AgentDefinitionService(repository, {
    ...(defaultModel ? { defaultModel } : {}),
    ...(options.generateId ? { generateId: options.generateId } : {}),
    ...(options.now ? { now: options.now } : {}),
  });

  return {
    async createAgent(input: CreateAgentInput): Promise<RuntimeAgentDefinition> {
      return service.create(parseInput(createAgentInputSchema, input));
    },
    async listAgents(): Promise<RuntimeAgentDefinition[]> {
      return service.list();
    },
    async getAgent(id: string): Promise<RuntimeAgentDefinition> {
      return service.get(parseInput(agentIdSchema, id));
    },
    async updateAgent(id: string, input: UpdateAgentInput): Promise<RuntimeAgentDefinition> {
      return service.update(
        parseInput(agentIdSchema, id),
        parseInput(updateAgentInputSchema, input),
      );
    },
    async deleteAgent(id: string): Promise<void> {
      return service.delete(parseInput(agentIdSchema, id));
    },
  };
}

function parseInput<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AgentRuntimeOperationError("VALIDATION_ERROR", "Invalid Agent Runtime input", {
      issues: result.error.issues,
    });
  }
  return result.data;
}
