import {
  AgentHarness,
  BACKGROUND_CONTEXT,
  type AgentLane,
  type AgentMessage,
} from "@earendil-works/pi-agent-core";
import { contentText, type AssistantMessage, type Models } from "@earendil-works/pi-ai";
import type { RuntimeAgentDefinition, SendAgentMessageInput } from "@peerly/agent-protocol";

import type { AgentDefinitionService } from "./agent-definition-service.js";
import { AgentRuntimeOperationError } from "./agent-runtime-operation-error.js";
import type { PiSessionStore } from "./pi-session-store.js";

const MAIN_LANE = "main";

export interface RunPiMessageOptions {
  signal: AbortSignal;
  onDelta: (delta: string) => void;
}

export class PiMessageRunner {
  constructor(
    private readonly definitions: AgentDefinitionService,
    private readonly sessions: PiSessionStore,
    private readonly models: Models,
  ) {}

  async run(input: SendAgentMessageInput, options: RunPiMessageOptions): Promise<string> {
    const agent = await this.getEnabledAgent(input.agentId);
    const model = this.models.getModel(agent.model.provider, agent.model.modelId);
    if (!model) {
      throw new AgentRuntimeOperationError(
        "MODEL_NOT_FOUND",
        `Model ${agent.model.provider}/${agent.model.modelId} was not found`,
        { provider: agent.model.provider, modelId: agent.model.modelId },
      );
    }

    if (options.signal.aborted) throw new MessageRunCancelledError();
    const session = await this.sessions.open(input.agentId, input.sessionId);
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
      await alignLaneModel(lane, agent);

      let finalAssistantMessage: AssistantMessage | undefined;
      const unsubscribeEnd = harness.events.on("message_end", (event) => {
        if (isAssistantMessage(event.message)) finalAssistantMessage = event.message;
      });
      const unsubscribeUpdates = harness.events.on("message_update", (event) => {
        if (
          !options.signal.aborted &&
          event.event.type === "text_delta" &&
          event.event.delta.length > 0
        ) {
          options.onDelta(event.event.delta);
        }
      });

      try {
        await promptLane(lane, input.content, options.signal);
      } finally {
        unsubscribeEnd();
        unsubscribeUpdates();
      }

      if (!finalAssistantMessage) {
        throw new AgentRuntimeOperationError(
          "INTERNAL_ERROR",
          "Agent run completed without an assistant response",
        );
      }
      return contentText(finalAssistantMessage.content);
    } catch (error) {
      if (
        error instanceof MessageRunCancelledError ||
        options.signal.aborted ||
        isAbortError(error)
      ) {
        throw new MessageRunCancelledError();
      }
      if (error instanceof AgentRuntimeOperationError) throw error;
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

  private async getEnabledAgent(agentId: string): Promise<RuntimeAgentDefinition> {
    const agent = await this.definitions.get(agentId);
    if (!agent.enabled) {
      throw new AgentRuntimeOperationError("AGENT_DISABLED", `Agent ${agentId} is disabled`);
    }
    return agent;
  }
}

export class MessageRunCancelledError extends Error {}

async function alignLaneModel(lane: AgentLane, agent: RuntimeAgentDefinition): Promise<void> {
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
}

async function promptLane(lane: AgentLane, content: string, signal: AbortSignal): Promise<void> {
  let abortLanePromise: Promise<void> | undefined;
  let promptSettled = false;
  const abortLane = () => {
    abortLanePromise ??= abortPromptLane(lane, () => promptSettled);
  };
  signal.addEventListener("abort", abortLane, { once: true });

  try {
    if (signal.aborted) throw new MessageRunCancelledError();
    const result = await lane.prompt(content, undefined, BACKGROUND_CONTEXT);
    if (!result.ok) {
      throw new AgentRuntimeOperationError("PROVIDER_ERROR", result.error.message);
    }
    if (result.value.status === "aborted" || signal.aborted) {
      throw new MessageRunCancelledError();
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
    promptSettled = true;
    if (signal.aborted) {
      abortLane();
      await abortLanePromise;
    }
    signal.removeEventListener("abort", abortLane);
  }
}

async function abortPromptLane(lane: AgentLane, promptSettled: () => boolean): Promise<void> {
  while (!promptSettled()) {
    const execution = await lane.inspectExecution(BACKGROUND_CONTEXT);
    if (execution.current) {
      await lane.abort(BACKGROUND_CONTEXT);
      await lane.waitForIdle(BACKGROUND_CONTEXT);
      return;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
  return "role" in message && message.role === "assistant";
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
