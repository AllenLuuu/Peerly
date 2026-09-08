import type {
  AgentHost,
  AgentRuntime,
  AgentRuntimeEvent,
  AttemptAgentReplyInput,
} from "@peerly/agent-protocol";
import type { Message } from "@peerly/contracts";

import type { PeerlyService, PreparedAgentDelivery } from "./peerly-service.js";
import type { PeerlyRealtime } from "./realtime.js";

interface ActiveDelivery {
  conversationId: string;
  controller: AbortController;
  task: Promise<void>;
}

export class AgentMessageDispatcher {
  readonly #active = new Map<string, ActiveDelivery>();
  readonly #preparing = new Set<Promise<void>>();
  #closed = false;

  constructor(
    private readonly peerly: PeerlyService,
    private readonly realtime: PeerlyRealtime,
    private readonly runtime: AgentRuntime,
  ) {}

  dispatch(message: Message): void {
    if (this.#closed) return;
    const task = this.#prepareAndDispatch(message)
      .catch(() => undefined)
      .finally(() => this.#preparing.delete(task));
    this.#preparing.add(task);
  }

  async #prepareAndDispatch(message: Message): Promise<void> {
    for (const delivery of await this.peerly.prepareAgentDeliveries(message)) {
      if (this.#closed) return;
      if (this.#active.has(delivery.input.deliveryId)) continue;
      const controller = new AbortController();
      const task = this.#consume(delivery, controller).finally(() => {
        this.#active.delete(delivery.input.deliveryId);
      });
      this.#active.set(delivery.input.deliveryId, {
        conversationId: delivery.input.conversation.id,
        controller,
        task,
      });
    }
  }

  cancel(deliveryId: string, actorId?: string): boolean {
    const active = this.#active.get(deliveryId);
    if (!active) return false;
    this.peerly.requireConversationAccess(actorId, active.conversationId);
    active.controller.abort();
    return true;
  }

  async close(): Promise<void> {
    this.#closed = true;
    await Promise.all([...this.#preparing]);
    for (const delivery of this.#active.values()) delivery.controller.abort();
    await Promise.all([...this.#active.values()].map((delivery) => delivery.task));
  }

  async #consume(delivery: PreparedAgentDelivery, controller: AbortController): Promise<void> {
    try {
      for await (const activity of this.runtime.deliverMessage(delivery.input, {
        signal: controller.signal,
      })) {
        this.#publishActivity(delivery, activity);
      }
    } catch (error) {
      this.#publishActivity(delivery, {
        type: "run_failed",
        timestamp: new Date().toISOString(),
        error: {
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  #publishActivity(delivery: PreparedAgentDelivery, activity: AgentRuntimeEvent): void {
    const publicActivity =
      activity.type === "run_failed"
        ? {
            type: activity.type,
            timestamp: activity.timestamp,
            error: { code: activity.error.code, message: activity.error.message },
          }
        : activity;
    this.realtime.publish(
      {
        type: "agent.activity",
        deliveryId: delivery.input.deliveryId,
        conversationId: delivery.input.conversation.id,
        agentId: delivery.agentPrincipalId,
        activity: publicActivity,
      },
      delivery.recipientIds,
    );
  }
}

export function createPeerlyAgentHost(
  peerly: PeerlyService,
  realtime: PeerlyRealtime,
  onMessageCreated: (message: Message) => void = () => undefined,
): AgentHost {
  return {
    async attemptReply(input: AttemptAgentReplyInput) {
      const { result, attempt } = await peerly.attemptAgentReply(input);
      if (result?.created) {
        realtime.publish({ type: "message.created", message: result.value }, result.recipientIds);
        onMessageCreated(result.value);
      }
      return attempt;
    },
  };
}
