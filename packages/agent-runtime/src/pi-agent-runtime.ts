import type { Models } from "@earendil-works/pi-ai";
import {
  agentIdSchema,
  createAgentInputSchema,
  deliverAgentMessageInputSchema,
  updateAgentInputSchema,
  type AgentHost,
  type AgentRuntime,
  type AgentRuntimeEventStream,
  type CreateAgentInput,
  type DeliverAgentMessageInput,
  type DeliverMessageOptions,
  type RuntimeAgentDefinition,
  type UpdateAgentInput,
} from "@peerly/agent-protocol";
import type { ZodType } from "zod";

import type { AgentDefinitionService } from "./agent-definition-service.js";
import { AgentRunCoordinator } from "./agent-run-coordinator.js";
import { AgentRuntimeOperationError } from "./agent-runtime-operation-error.js";
import { ConversationSessionIndex } from "./conversation-session-index.js";
import { PiMessageRunner } from "./pi-message-runner.js";
import { PiSessionStore } from "./pi-session-store.js";

export class PiAgentRuntime implements AgentRuntime {
  private readonly sessions: PiSessionStore;
  private readonly runs: AgentRunCoordinator;
  private readonly deletingAgents = new Set<string>();
  private closed = false;
  private closePromise: Promise<void> | undefined;

  constructor(
    private readonly definitions: AgentDefinitionService,
    dataDirectory: string,
    models: Models,
    host: AgentHost,
  ) {
    this.sessions = new PiSessionStore(dataDirectory);
    this.runs = new AgentRunCoordinator(
      new PiMessageRunner(
        this.definitions,
        this.sessions,
        new ConversationSessionIndex(dataDirectory, this.sessions),
        models,
        host,
      ),
    );
  }

  async createAgent(input: CreateAgentInput): Promise<RuntimeAgentDefinition> {
    this.assertOpen();
    return this.definitions.create(parseInput(createAgentInputSchema, input));
  }

  async listAgents(): Promise<RuntimeAgentDefinition[]> {
    this.assertOpen();
    return this.definitions.list();
  }

  async getAgent(id: string): Promise<RuntimeAgentDefinition> {
    this.assertOpen();
    return this.definitions.get(parseInput(agentIdSchema, id));
  }

  async updateAgent(id: string, input: UpdateAgentInput): Promise<RuntimeAgentDefinition> {
    this.assertOpen();
    return this.definitions.update(
      parseInput(agentIdSchema, id),
      parseInput(updateAgentInputSchema, input),
    );
  }

  async deleteAgent(id: string): Promise<void> {
    this.assertOpen();
    const agentId = parseInput(agentIdSchema, id);
    if (this.deletingAgents.has(agentId)) {
      throw new AgentRuntimeOperationError("AGENT_NOT_FOUND", `Agent '${agentId}' was not found`);
    }
    await this.definitions.get(agentId);
    this.deletingAgents.add(agentId);
    try {
      await this.runs.cancelAgent(agentId);
      await this.sessions.closeAgent(agentId);
      await this.definitions.delete(agentId);
    } finally {
      this.deletingAgents.delete(agentId);
    }
  }

  deliverMessage(
    input: DeliverAgentMessageInput,
    options: DeliverMessageOptions = {},
  ): AgentRuntimeEventStream {
    this.assertOpen();
    const parsed = parseInput(deliverAgentMessageInputSchema, input);
    if (this.deletingAgents.has(parsed.agentId)) {
      throw new AgentRuntimeOperationError(
        "AGENT_NOT_FOUND",
        `Agent '${parsed.agentId}' was not found`,
      );
    }
    return this.runs.deliverMessage(parsed, options);
  }

  close(): Promise<void> {
    if (!this.closePromise) {
      this.closed = true;
      this.closePromise = this.runs
        .close()
        .then(() => this.sessions.close())
        .then(() => undefined);
    }
    return this.closePromise;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new AgentRuntimeOperationError("RUNTIME_CLOSED", "Agent Runtime is closed");
    }
  }
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
