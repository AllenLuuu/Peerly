import type {
  AgentRuntime,
  AgentRuntimeEvent,
  AgentSession,
  CreateAgentInput,
  RuntimeAgentDefinition,
  SendAgentMessageInput,
  SendMessageOptions,
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
  readonly sentMessages: SendAgentMessageInput[] = [];
  readonly createdAgents: CreateAgentInput[] = [];
  readonly createdSessions: AgentSession[] = [];
  closed = false;

  constructor(
    readonly agents: RuntimeAgentDefinition[] = [],
    readonly sessions: AgentSession[] = [],
    private readonly response: (
      input: SendAgentMessageInput,
      options: SendMessageOptions,
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

  async listAgents(): Promise<RuntimeAgentDefinition[]> {
    return this.agents;
  }

  async getAgent(id: string): Promise<RuntimeAgentDefinition> {
    return this.agents.find((agent) => agent.id === id)!;
  }

  async updateAgent(): Promise<RuntimeAgentDefinition> {
    throw new Error("Not used by CLI");
  }

  async deleteAgent(): Promise<void> {
    throw new Error("Not used by CLI");
  }

  async createSession(input: { agentId: string }): Promise<AgentSession> {
    const session = {
      id: `session-${this.sessions.length + 1}`,
      agentId: input.agentId,
      createdAt: timestamp,
    };
    this.sessions.push(session);
    this.createdSessions.push(session);
    return session;
  }

  async listSessions(agentId: string): Promise<AgentSession[]> {
    return this.sessions.filter((session) => session.agentId === agentId);
  }

  async deleteSession(): Promise<void> {
    throw new Error("Not used by CLI");
  }

  sendMessage(
    input: SendAgentMessageInput,
    options: SendMessageOptions = {},
  ): AsyncIterable<AgentRuntimeEvent> {
    this.sentMessages.push(input);
    return this.response(input, options);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

async function* completedResponse(): AsyncIterable<AgentRuntimeEvent> {
  yield { type: "run_queued", timestamp };
  yield { type: "run_started", timestamp };
  yield { type: "output_delta", timestamp, delta: "Hello" };
  yield { type: "output_delta", timestamp, delta: "!" };
  yield { type: "run_completed", timestamp, content: "Hello!" };
}

describe("Runtime CLI", () => {
  it("exits without creating data when input is interrupted during setup", async () => {
    const runtime = new FakeRuntime();
    const terminal = new ScriptedTerminal([], undefined, "Agent id [assistant]: ");

    await runRuntimeCli({ runtime, terminal });

    expect(runtime.createdAgents).toEqual([]);
    expect(runtime.createdSessions).toEqual([]);
    expect(runtime.closed).toBe(true);
  });

  it("creates the first Agent and supports multi-turn chat plus /new", async () => {
    const runtime = new FakeRuntime();
    const terminal = new ScriptedTerminal([
      "assistant",
      "Peerly Assistant",
      "Help with Peerly.",
      "Hi",
      "/new",
      "Hi again",
      "/exit",
    ]);

    await runRuntimeCli({ runtime, terminal });

    expect(runtime.createdAgents).toEqual([
      {
        id: "assistant",
        name: "Peerly Assistant",
        instructions: "Help with Peerly.",
      },
    ]);
    expect(runtime.createdSessions).toHaveLength(2);
    expect(runtime.sentMessages).toEqual([
      { agentId: "assistant", sessionId: "session-1", content: "Hi" },
      { agentId: "assistant", sessionId: "session-2", content: "Hi again" },
    ]);
    expect(terminal.output.join("")).toContain("Hello!");
    expect(runtime.closed).toBe(true);
  });

  it("uses an existing session and Ctrl+C cancels only the active response", async () => {
    const agent: RuntimeAgentDefinition = {
      id: "assistant",
      name: "Assistant",
      instructions: "Help.",
      model: { provider: "openai-compatible", modelId: "configured-model" },
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const session: AgentSession = {
      id: "existing-session",
      agentId: "assistant",
      createdAt: timestamp,
    };
    const runtime = new FakeRuntime([agent], [session], async function* (_input, options) {
      yield { type: "run_queued", timestamp };
      yield { type: "run_started", timestamp };
      yield { type: "output_delta", timestamp, delta: "partial" };
      expect(options.signal?.aborted).toBe(true);
      yield { type: "run_cancelled", timestamp };
    });
    const terminal = new ScriptedTerminal(["", "", "long answer", "/exit"], "partial");

    await runRuntimeCli({ runtime, terminal });

    expect(runtime.sentMessages).toEqual([
      {
        agentId: "assistant",
        sessionId: "existing-session",
        content: "long answer",
      },
    ]);
    expect(terminal.output.join("")).toContain("Cancelled");
    expect(runtime.closed).toBe(true);
  });
});
