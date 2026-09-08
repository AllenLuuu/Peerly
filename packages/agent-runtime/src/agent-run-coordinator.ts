import type {
  AgentRuntimeError,
  AgentRuntimeEvent,
  AgentRuntimeEventStream,
  DeliverAgentMessageInput,
  DeliverMessageOptions,
} from "@peerly/agent-protocol";

import { AgentConversationMailbox } from "./agent-conversation-mailbox.js";
import { BufferedEventStream } from "./agent-event-stream.js";
import { AgentRuntimeOperationError } from "./agent-runtime-operation-error.js";
import { MessageRunCancelledError, type PiMessageRunner } from "./pi-message-runner.js";

interface PendingMessageRun {
  readonly input: DeliverAgentMessageInput;
  readonly stream: BufferedEventStream<AgentRuntimeEvent>;
  readonly controller: AbortController;
  status: "queued" | "running" | "terminal";
  removeAbortListener?: () => void;
}

export class AgentRunCoordinator {
  private readonly messageQueues = new Map<string, PendingMessageRun[]>();
  private readonly sessionDrains = new Map<string, Promise<void>>();
  private readonly activeRuns = new Set<PendingMessageRun>();
  private readonly mailboxes = new Map<string, AgentConversationMailbox>();
  private closed = false;
  private closePromise: Promise<void> | undefined;

  constructor(private readonly runner: PiMessageRunner) {}

  deliverMessage(
    input: DeliverAgentMessageInput,
    options: DeliverMessageOptions = {},
  ): AgentRuntimeEventStream {
    if (this.closed) {
      throw new AgentRuntimeOperationError("RUNTIME_CLOSED", "Agent Runtime is closed");
    }

    const stream = new BufferedEventStream<AgentRuntimeEvent>();
    const queueKey = conversationQueueKey(input.agentId, input.conversation.id);
    const mailbox = this.mailboxes.get(queueKey) ?? new AgentConversationMailbox();
    mailbox.enqueue(input.messages);
    this.mailboxes.set(queueKey, mailbox);
    const run: PendingMessageRun = {
      input,
      stream,
      controller: new AbortController(),
      status: "queued",
    };
    stream.push(timestamped({ type: "run_queued" }));

    if (options.signal) {
      const cancel = () => this.cancelRun(run);
      options.signal.addEventListener("abort", cancel, { once: true });
      run.removeAbortListener = () => options.signal?.removeEventListener("abort", cancel);
      if (options.signal.aborted) this.cancelRun(run);
    }

    const queue = this.messageQueues.get(queueKey) ?? [];
    queue.push(run);
    this.messageQueues.set(queueKey, queue);
    this.scheduleDrain(queueKey);
    return stream;
  }

  cancelAgent(agentId: string): void {
    for (const queue of this.messageQueues.values()) {
      for (const run of queue) {
        if (run.input.agentId === agentId) this.cancelRun(run);
      }
    }
    for (const run of this.activeRuns) {
      if (run.input.agentId === agentId) this.cancelRun(run);
    }
  }

  close(): Promise<void> {
    if (!this.closePromise) {
      this.closed = true;
      for (const queue of this.messageQueues.values()) {
        for (const run of queue) this.cancelRun(run);
      }
      for (const run of this.activeRuns) this.cancelRun(run);
      this.closePromise = Promise.all([...this.sessionDrains.values()]).then(() => undefined);
    }
    return this.closePromise;
  }

  private scheduleDrain(queueKey: string): void {
    if (this.sessionDrains.has(queueKey)) return;
    const drain = this.drainQueue(queueKey).finally(() => {
      if (this.sessionDrains.get(queueKey) !== drain) return;
      this.sessionDrains.delete(queueKey);
      if (this.messageQueues.get(queueKey)?.length === 0) {
        this.messageQueues.delete(queueKey);
      } else {
        this.scheduleDrain(queueKey);
      }
    });
    this.sessionDrains.set(queueKey, drain);
  }

  private async drainQueue(queueKey: string): Promise<void> {
    const queue = this.messageQueues.get(queueKey);
    if (!queue) return;

    while (queue.length > 0) {
      const run = queue.shift();
      if (!run || run.status === "terminal") continue;

      run.status = "running";
      this.activeRuns.add(run);
      const mailbox = this.mailboxes.get(queueKey);
      const messages = mailbox?.takePending() ?? [];
      if (messages.length === 0) {
        run.stream.push(timestamped({ type: "delivery_skipped", reason: "already_processed" }));
        this.finishRun(run, { type: "run_completed", replyCount: 0 });
        continue;
      }
      run.stream.push(timestamped({ type: "run_started" }));
      try {
        const replyCount = await this.runner.run(
          { ...run.input, messages },
          {
            signal: run.controller.signal,
            getExpectedSequence: () => mailbox?.observedSequence ?? 0,
            onConflict: (result) => mailbox?.observeConflict(result),
            onPublished: (result) => mailbox?.observePublished(result),
            onThinkingDelta: (delta) => {
              if (run.status === "running" && !run.controller.signal.aborted) {
                run.stream.push(timestamped({ type: "thinking_delta", delta }));
              }
            },
            onToolStarted: (toolName) => {
              run.stream.push(timestamped({ type: "tool_started", toolName }));
            },
            onToolCompleted: (toolName) => {
              run.stream.push(timestamped({ type: "tool_completed", toolName }));
            },
            onReply: (text, result) => {
              run.stream.push(
                timestamped({
                  type: "reply_published",
                  text,
                  messageId: result.messageId,
                  sequence: result.sequence,
                  createdAt: result.createdAt,
                }),
              );
            },
          },
        );
        if (run.controller.signal.aborted) {
          this.finishRun(run, { type: "run_cancelled" });
        } else {
          this.finishRun(run, { type: "run_completed", replyCount });
        }
      } catch (error) {
        if (error instanceof MessageRunCancelledError || run.controller.signal.aborted) {
          this.finishRun(run, { type: "run_cancelled" });
        } else {
          this.finishRun(run, { type: "run_failed", error: toRuntimeError(error) });
        }
      }
    }
  }

  private finishRun(
    run: PendingMessageRun,
    event:
      | { type: "run_completed"; replyCount: number }
      | { type: "run_cancelled" }
      | { type: "run_failed"; error: AgentRuntimeError },
  ): void {
    if (run.status === "terminal") return;
    run.status = "terminal";
    this.activeRuns.delete(run);
    run.removeAbortListener?.();
    run.stream.push(timestamped(event));
    run.stream.end();
  }

  private cancelRun(run: PendingMessageRun): void {
    if (run.status === "terminal") return;
    run.controller.abort();
    if (run.status === "queued") this.finishRun(run, { type: "run_cancelled" });
  }
}

function conversationQueueKey(agentId: string, conversationId: string): string {
  return `${agentId}\u0000${conversationId}`;
}

function timestamped<T extends Omit<AgentRuntimeEvent, "timestamp">>(
  event: T,
): T & { timestamp: string } {
  return { ...event, timestamp: new Date().toISOString() };
}

function toRuntimeError(error: unknown): AgentRuntimeError {
  if (error instanceof AgentRuntimeOperationError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    };
  }
  return {
    code: "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : String(error),
  };
}
