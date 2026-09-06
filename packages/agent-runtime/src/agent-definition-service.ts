import { randomUUID } from "node:crypto";

import type {
  AgentModel,
  CreateAgentInput,
  RuntimeAgentDefinition,
  UpdateAgentInput,
} from "@peerly/agent-protocol";

import type { AgentDefinitionRepository } from "./agent-definition-repository.js";
import { AgentRuntimeOperationError } from "./agent-runtime-operation-error.js";

export interface AgentDefinitionServiceOptions {
  defaultModel?: AgentModel;
  generateId?: () => string;
  now?: () => string;
}

export class AgentDefinitionService {
  private mutationQueue: Promise<void> = Promise.resolve();
  private readonly defaultModel: AgentModel | undefined;
  private readonly generateId: () => string;
  private readonly now: () => string;

  constructor(
    private readonly repository: AgentDefinitionRepository,
    options: AgentDefinitionServiceOptions = {},
  ) {
    this.defaultModel = options.defaultModel;
    this.generateId = options.generateId ?? (() => `agent_${randomUUID()}`);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async create(input: CreateAgentInput): Promise<RuntimeAgentDefinition> {
    return this.mutate(async () => {
      const id = input.id ?? this.generateId();
      if (await this.repository.exists(id)) {
        throw new AgentRuntimeOperationError(
          "AGENT_ALREADY_EXISTS",
          `Agent '${id}' already exists`,
        );
      }

      const model = input.model ?? this.defaultModel;
      if (!model) {
        throw new AgentRuntimeOperationError(
          "MODEL_REQUIRED",
          "A model must be provided or configured as the runtime default",
        );
      }

      const timestamp = this.now();
      const agent: RuntimeAgentDefinition = {
        id,
        name: input.name,
        instructions: input.instructions,
        model,
        enabled: input.enabled ?? true,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await this.repository.create(agent);
      return agent;
    });
  }

  async get(id: string): Promise<RuntimeAgentDefinition> {
    const agent = await this.repository.findById(id);
    if (!agent) {
      throw new AgentRuntimeOperationError("AGENT_NOT_FOUND", `Agent '${id}' was not found`);
    }
    return agent;
  }

  async list(): Promise<RuntimeAgentDefinition[]> {
    const agents = await this.repository.list();
    return agents.toSorted(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    );
  }

  async update(id: string, input: UpdateAgentInput): Promise<RuntimeAgentDefinition> {
    return this.mutate(async () => {
      const current = await this.get(id);
      const updated: RuntimeAgentDefinition = {
        id: current.id,
        name: input.name ?? current.name,
        instructions: input.instructions ?? current.instructions,
        model: input.model ?? current.model,
        enabled: input.enabled ?? current.enabled,
        createdAt: current.createdAt,
        updatedAt: this.now(),
      };
      await this.repository.update(updated);
      return updated;
    });
  }

  async delete(id: string): Promise<void> {
    await this.mutate(async () => {
      await this.get(id);
      await this.repository.softDelete(id, this.now());
    });
  }

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
