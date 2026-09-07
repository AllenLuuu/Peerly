import type { Models } from "@earendil-works/pi-ai";
import {
  agentIdSchema,
  createAgentInputSchema,
  createAgentSessionInputSchema,
  deleteAgentSessionInputSchema,
  sendAgentMessageInputSchema,
  updateAgentInputSchema,
  type AgentRuntime,
  type AgentRuntimeEventStream,
  type AgentSession,
  type CreateAgentInput,
  type CreateAgentSessionInput,
  type DeleteAgentSessionInput,
  type RuntimeAgentDefinition,
  type SendAgentMessageInput,
  type SendMessageOptions,
  type UpdateAgentInput,
} from "@peerly/agent-protocol";
import type { ZodType } from "zod";

import type { AgentDefinitionService } from "./agent-definition-service.js";
import { AgentRunCoordinator } from "./agent-run-coordinator.js";
import { AgentRuntimeOperationError } from "./agent-runtime-operation-error.js";
import { PiMessageRunner } from "./pi-message-runner.js";
import { PiSessionStore } from "./pi-session-store.js";

export class PiAgentRuntime implements AgentRuntime {
  private readonly sessions: PiSessionStore;
  private readonly runs: AgentRunCoordinator;
  private closed = false;
  private closePromise: Promise<void> | undefined;

  constructor(
    private readonly definitions: AgentDefinitionService,
    dataDirectory: string,
    models: Models,
  ) {
    this.sessions = new PiSessionStore(dataDirectory);
    this.runs = new AgentRunCoordinator(
      new PiMessageRunner(this.definitions, this.sessions, models),
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
    await this.definitions.delete(agentId);
    this.runs.cancelAgent(agentId);
  }

  async createSession(input: CreateAgentSessionInput): Promise<AgentSession> {
    this.assertOpen();
    const parsed = parseInput(createAgentSessionInputSchema, input);
    await this.getEnabledAgent(parsed.agentId);
    return this.sessions.create(parsed.agentId);
  }

  async listSessions(agentId: string): Promise<AgentSession[]> {
    this.assertOpen();
    const parsedAgentId = parseInput(agentIdSchema, agentId);
    await this.definitions.get(parsedAgentId);
    return this.sessions.list(parsedAgentId);
  }

  async deleteSession(input: DeleteAgentSessionInput): Promise<void> {
    this.assertOpen();
    const parsed = parseInput(deleteAgentSessionInputSchema, input);
    await this.definitions.get(parsed.agentId);
    return this.sessions.delete(parsed.agentId, parsed.sessionId);
  }

  sendMessage(
    input: SendAgentMessageInput,
    options: SendMessageOptions = {},
  ): AgentRuntimeEventStream {
    this.assertOpen();
    return this.runs.sendMessage(parseInput(sendAgentMessageInputSchema, input), options);
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

  private async getEnabledAgent(agentId: string): Promise<RuntimeAgentDefinition> {
    const agent = await this.definitions.get(agentId);
    if (!agent.enabled) {
      throw new AgentRuntimeOperationError("AGENT_DISABLED", `Agent ${agentId} is disabled`);
    }
    return agent;
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
