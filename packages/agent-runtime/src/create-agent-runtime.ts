import {
  agentModelSchema,
  type AgentHost,
  type AgentModel,
  type AgentRuntime,
} from "@peerly/agent-protocol";
import { randomUUID } from "node:crypto";
import type { Models } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { ZodType } from "zod";

import { AgentDefinitionService } from "./agent-definition-service.js";
import { AgentRuntimeOperationError } from "./agent-runtime-operation-error.js";
import { FileAgentDefinitionRepository } from "./file-agent-definition-repository.js";
import { PiAgentRuntime } from "./pi-agent-runtime.js";

export interface CreateAgentRuntimeOptions {
  dataDirectory: string;
  defaultModel?: AgentModel;
  generateId?: () => string;
  now?: () => string;
  models?: Models;
  host?: AgentHost;
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

  return new PiAgentRuntime(
    service,
    options.dataDirectory,
    options.models ?? builtinModels(),
    options.host ?? standaloneHost(),
  );
}

function standaloneHost(): AgentHost {
  return {
    async publishReply() {
      return {
        messageId: `standalone_${randomUUID()}`,
        createdAt: new Date().toISOString(),
      };
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
