import { join } from "node:path";

import { AgentHarness, BACKGROUND_CONTEXT, type AgentMessage } from "@earendil-works/pi-agent-core";
import { contentText, type AssistantMessage, type Models } from "@earendil-works/pi-ai";
import {
  createNodeSqliteFactory,
  SqliteSessionRepo,
} from "@earendil-works/pi-session-backend-sqlite-node";
import {
  agentIdSchema,
  createAgentInputSchema,
  createAgentSessionInputSchema,
  deleteAgentSessionInputSchema,
  sendAgentMessageInputSchema,
  updateAgentInputSchema,
  type AgentReply,
  type AgentRuntime,
  type AgentSession,
  type CreateAgentInput,
  type CreateAgentSessionInput,
  type DeleteAgentSessionInput,
  type RuntimeAgentDefinition,
  type SendAgentMessageInput,
  type UpdateAgentInput,
} from "@peerly/agent-protocol";
import type { ZodType } from "zod";

import type { AgentDefinitionService } from "./agent-definition-service.js";
import { agentSessionsDirectory } from "./agent-paths.js";
import { AgentRuntimeOperationError } from "./agent-runtime-operation-error.js";

const MAIN_LANE = "main";

export class PiAgentRuntime implements AgentRuntime {
  private readonly sessionRepositories = new Map<string, SqliteSessionRepo>();
  private closed = false;
  private closePromise: Promise<void> | undefined;

  constructor(
    private readonly definitions: AgentDefinitionService,
    private readonly dataDirectory: string,
    private readonly models: Models,
  ) {}

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
    return this.definitions.delete(parseInput(agentIdSchema, id));
  }

  async createSession(input: CreateAgentSessionInput): Promise<AgentSession> {
    this.assertOpen();
    const parsed = parseInput(createAgentSessionInputSchema, input);
    await this.getEnabledAgent(parsed.agentId);
    const session = await this.getSessionRepository(parsed.agentId).create({}, BACKGROUND_CONTEXT);
    const publicSession = toAgentSession(parsed.agentId, session.metadata);
    await session.close(BACKGROUND_CONTEXT);
    return publicSession;
  }

  async listSessions(agentId: string): Promise<AgentSession[]> {
    this.assertOpen();
    const parsedAgentId = parseInput(agentIdSchema, agentId);
    await this.definitions.get(parsedAgentId);
    const metadata = await this.getSessionRepository(parsedAgentId).list(
      undefined,
      BACKGROUND_CONTEXT,
    );
    return metadata.map((session) => toAgentSession(parsedAgentId, session));
  }

  async deleteSession(input: DeleteAgentSessionInput): Promise<void> {
    this.assertOpen();
    const parsed = parseInput(deleteAgentSessionInputSchema, input);
    await this.definitions.get(parsed.agentId);
    const repository = this.getSessionRepository(parsed.agentId);
    const metadata = await this.findSession(repository, parsed.sessionId);
    await repository.delete(metadata, BACKGROUND_CONTEXT);
  }

  async sendMessage(input: SendAgentMessageInput): Promise<AgentReply> {
    this.assertOpen();
    const parsed = parseInput(sendAgentMessageInputSchema, input);
    const agent = await this.getEnabledAgent(parsed.agentId);
    const model = this.models.getModel(agent.model.provider, agent.model.modelId);
    if (!model) {
      throw new AgentRuntimeOperationError(
        "MODEL_NOT_FOUND",
        `Model ${agent.model.provider}/${agent.model.modelId} was not found`,
        { provider: agent.model.provider, modelId: agent.model.modelId },
      );
    }

    const repository = this.getSessionRepository(parsed.agentId);
    const metadata = await this.findSession(repository, parsed.sessionId);
    const session = await repository.open(metadata, BACKGROUND_CONTEXT);
    let harness: Awaited<ReturnType<typeof AgentHarness.create>>["harness"] | undefined;

    try {
      ({ harness } = await AgentHarness.create(
        {
          session,
          models: this.models,
          model,
          systemPrompt: agent.instructions,
        },
        BACKGROUND_CONTEXT,
      ));
      const lane = await harness.lane(MAIN_LANE, BACKGROUND_CONTEXT);
      const configuredModel = await lane.getModel(BACKGROUND_CONTEXT);
      if (
        configuredModel?.provider !== agent.model.provider ||
        configuredModel.id !== agent.model.modelId
      ) {
        await lane.setModel(
          { provider: agent.model.provider, modelId: agent.model.modelId },
          BACKGROUND_CONTEXT,
        );
      }

      let finalAssistantMessage: AssistantMessage | undefined;
      const unsubscribe = harness.events.on("message_end", (event) => {
        if (isAssistantMessage(event.message)) {
          finalAssistantMessage = event.message;
        }
      });

      try {
        const result = await lane.prompt(parsed.content, undefined, BACKGROUND_CONTEXT);
        if (!result.ok) {
          throw new AgentRuntimeOperationError("PROVIDER_ERROR", result.error.message);
        }
        if (result.value.status !== "completed") {
          const failureMessage =
            "error" in result.value
              ? result.value.error?.message
              : `Agent run ended with status ${result.value.status}`;
          throw new AgentRuntimeOperationError(
            "PROVIDER_ERROR",
            failureMessage ?? `Agent run ended with status ${result.value.status}`,
          );
        }
      } finally {
        unsubscribe();
      }

      if (!finalAssistantMessage) {
        throw new AgentRuntimeOperationError(
          "INTERNAL_ERROR",
          "Agent run completed without an assistant response",
        );
      }
      return { content: contentText(finalAssistantMessage.content) };
    } catch (error) {
      if (error instanceof AgentRuntimeOperationError) {
        throw error;
      }
      throw new AgentRuntimeOperationError("PROVIDER_ERROR", errorMessage(error), {
        cause: errorMessage(error),
      });
    } finally {
      if (harness) {
        await harness.close(BACKGROUND_CONTEXT);
      } else {
        await session.close(BACKGROUND_CONTEXT);
      }
    }
  }

  close(): Promise<void> {
    if (!this.closePromise) {
      this.closed = true;
      this.closePromise = Promise.all(
        [...this.sessionRepositories.values()].map((repository) =>
          repository.close(BACKGROUND_CONTEXT),
        ),
      ).then(() => undefined);
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

  private getSessionRepository(agentId: string): SqliteSessionRepo {
    let repository = this.sessionRepositories.get(agentId);
    if (!repository) {
      const directory = agentSessionsDirectory(this.dataDirectory, agentId);
      repository = new SqliteSessionRepo({
        directory,
        databasePath: join(directory, "sessions.sqlite"),
        databaseFactory: createNodeSqliteFactory(),
      });
      this.sessionRepositories.set(agentId, repository);
    }
    return repository;
  }

  private async findSession(
    repository: SqliteSessionRepo,
    sessionId: string,
  ): Promise<Awaited<ReturnType<SqliteSessionRepo["list"]>>[number]> {
    const metadata = (await repository.list(undefined, BACKGROUND_CONTEXT)).find(
      (session) => session.id === sessionId,
    );
    if (!metadata) {
      throw new AgentRuntimeOperationError(
        "SESSION_NOT_FOUND",
        `Session ${sessionId} was not found`,
      );
    }
    return metadata;
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

function toAgentSession(
  agentId: string,
  metadata: { id: string; createdAt: number },
): AgentSession {
  return {
    id: metadata.id,
    agentId,
    createdAt: new Date(metadata.createdAt).toISOString(),
  };
}

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
  return "role" in message && message.role === "assistant";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
