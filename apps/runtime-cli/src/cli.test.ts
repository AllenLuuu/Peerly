import type {
  AgentRuntime,
  AgentRuntimeEvent,
  CreateAgentInput,
  DeliverAgentMessageInput,
  DeliverMessageOptions,
  RuntimeAgentDefinition,
} from "@peerly/agent-protocol";
import { describe, expect, it } from "vitest";

import { runRuntimeCli, type RuntimeCliTerminal } from "./cli.js";

const timestamp = "2026-09-06T00:00:00.000Z";

class ScriptedTerminal implements RuntimeCliTerminal {
  readonly output: string[] = [];
  private interruptHandler: (() => void) | undefined;

  constructor(
    private readonly input: string[],
    private readonly interruptOnOutput?: string,
    private readonly interruptOnPrompt?: string,
  ) {}

  async read(prompt: string): Promise<string | undefined> {
    this.output.push(prompt);
    if (prompt === this.interruptOnPrompt) this.interruptHandler?.();
    return this.input.shift();
  }

  write(content: string): void {
    this.output.push(content);
    if (content === this.interruptOnOutput) this.interruptHandler?.();
  }

  onInterrupt(handler: () => void): () => void {
    this.interruptHandler = handler;
    return () => {
      this.interruptHandler = undefined;
    };
  }

  close(): void {}
}

class FakeRuntime implements AgentRuntime {
  readonly deliveredMessages: DeliverAgentMessageInput[] = [];
  readonly createdAgents: CreateAgentInput[] = [];
  closed = false;

  constructor(
    readonly agents: RuntimeAgentDefinition[] = [],
    private readonly response: (
      input: DeliverAgentMessageInput,
      options: DeliverMessageOptions,
    ) => AsyncIterable<AgentRuntimeEvent> = completedResponse,
  ) {}

  async createAgent(input: CreateAgentInput): Promise<RuntimeAgentDefinition> {
    this.createdAgents.push(input);
    const agent: RuntimeAgentDefinition = {
      id: input.id ?? "generated-agent",
      name: input.name,
      instructions: input.instructions,
      model: input.model ?? { provider: "openai-compatible", modelId: "configured-model" },
      enabled: input.enabled ?? true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.agents.push(agent);
    return agent;
  }

  async listAgents() {
    return this.agents;
  }
  async getAgent(id: string) {
    return this.agents.find((agent) => agent.id === id)!;
  }
  async updateAgent(): Promise<RuntimeAgentDefinition> {
    throw new Error("CLI 不使用");
  }
  async deleteAgent(): Promise<void> {
    throw new Error("CLI 不使用");
  }

  deliverMessage(input: DeliverAgentMessageInput, options: DeliverMessageOptions = {}) {
    this.deliveredMessages.push(input);
    return this.response(input, options);
  }

  async close() {
    this.closed = true;
  }
}

async function* completedResponse(): AsyncIterable<AgentRuntimeEvent> {
  yield { type: "run_queued", timestamp };
  yield { type: "run_started", timestamp };
  yield { type: "thinking_delta", timestamp, delta: "分析中" };
  yield {
    type: "reply_published",
    timestamp,
    text: "Hello!",
    messageId: "message-1",
    sequence: 2,
    createdAt: timestamp,
  };
  yield { type: "run_completed", timestamp, replyCount: 1 };
}

describe("Runtime CLI", () => {
  it("初始化中断时退出且不创建 Agent", async () => {
    const runtime = new FakeRuntime();
    const terminal = new ScriptedTerminal([], undefined, "Agent id [assistant]: ");
    await runRuntimeCli({ runtime, terminal });
    expect(runtime.createdAgents).toEqual([]);
    expect(runtime.closed).toBe(true);
  });

  it("创建第一个 Agent，并用 /new 切换测试 Conversation", async () => {
    const runtime = new FakeRuntime();
    const terminal = new ScriptedTerminal([
      "assistant",
      "Peerly Assistant",
      "Help with Peerly.",
      "Hi",
      "Follow up",
      "/new",
      "Hi again",
      "/exit",
    ]);
    await runRuntimeCli({ runtime, terminal });

    expect(runtime.deliveredMessages).toHaveLength(3);
    expect(runtime.deliveredMessages[0]).toMatchObject({
      agentId: "assistant",
      messages: [{ content: { text: "Hi" } }],
    });
    expect(runtime.deliveredMessages[1]).toMatchObject({
      agentId: "assistant",
      messages: [{ sequence: 3, content: { text: "Follow up" } }],
    });
    expect(runtime.deliveredMessages[2]).toMatchObject({
      agentId: "assistant",
      messages: [{ sequence: 1, content: { text: "Hi again" } }],
    });
    expect(runtime.deliveredMessages[0]?.conversation.id).toBe(
      runtime.deliveredMessages[1]?.conversation.id,
    );
    expect(runtime.deliveredMessages[1]?.conversation.id).not.toBe(
      runtime.deliveredMessages[2]?.conversation.id,
    );
    expect(terminal.output.join("")).toContain("Hello!");
  });

  it("Ctrl+C 通过 AbortSignal 取消活跃回复", async () => {
    const agent: RuntimeAgentDefinition = {
      id: "assistant",
      name: "Assistant",
      instructions: "Help.",
      model: { provider: "openai-compatible", modelId: "configured-model" },
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const runtime = new FakeRuntime([agent], async function* (_input, options) {
      yield { type: "run_started", timestamp };
      yield { type: "thinking_delta", timestamp, delta: "partial" };
      expect(options.signal?.aborted).toBe(true);
      yield { type: "run_cancelled", timestamp };
    });
    const terminal = new ScriptedTerminal(["", "long answer", "/exit"], "partial");
    await runRuntimeCli({ runtime, terminal });
    expect(terminal.output.join("")).toContain("Cancelled");
  });
});
