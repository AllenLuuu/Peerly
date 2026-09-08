import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  AgentHost,
  AgentRuntime,
  AgentRuntimeEventStream,
  CreateAgentInput,
  DeliverAgentMessageInput,
  RuntimeAgentDefinition,
} from "@peerly/agent-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createPeerlyApp } from "./app.js";

const applications: Awaited<ReturnType<typeof createPeerlyApp>>[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Agent 回复的原子冲突检查", () => {
  it("两个 Agent 基于相同 sequence 回复时，只发布第一个并向第二个返回新增消息", async () => {
    const { app, runtime, host } = await makeApp();
    const { cookie } = await bootstrapAdministrator(app);
    const first = await createAgent(app, cookie, "First");
    const second = await createAgent(app, cookie, "Second");
    const conversationId = await createGroup(app, cookie, [first.id, second.id]);
    await sendMessage(app, cookie, conversationId, "开始报数");
    await waitFor(() => runtime.deliverMessage.mock.calls.length === 2);

    const published = await host.attemptReply({
      deliveryId: "first-delivery",
      runtimeAgentId: first.runtimeAgentId,
      conversationId,
      expectedSequence: 1,
      text: "1",
      ignoreNew: false,
      replyIndex: 0,
    });
    const conflicted = await host.attemptReply({
      deliveryId: "second-delivery",
      runtimeAgentId: second.runtimeAgentId,
      conversationId,
      expectedSequence: 1,
      text: "1",
      ignoreNew: false,
      replyIndex: 0,
    });

    expect(published).toMatchObject({ status: "published", sequence: 2, messages: [] });
    expect(conflicted).toMatchObject({
      status: "conflict",
      latestSequence: 2,
      messages: [
        expect.objectContaining({
          sequence: 2,
          sender: { id: first.id, type: "agent", name: "First" },
          content: { type: "text", text: "1" },
        }),
      ],
    });
    await waitFor(() => runtime.deliverMessage.mock.calls.length === 3);
    expect(runtime.deliverMessage.mock.calls.at(-1)?.[0].agentPrincipalId).toBe(second.id);
  });

  it("发生冲突后 ignoreNew 可以追加到最新消息之后，并返回期间忽略的消息", async () => {
    const { app, host } = await makeApp();
    const { cookie } = await bootstrapAdministrator(app);
    const first = await createAgent(app, cookie, "First");
    const second = await createAgent(app, cookie, "Second");
    const conversationId = await createGroup(app, cookie, [first.id, second.id]);
    await sendMessage(app, cookie, conversationId, "给出结论");

    await host.attemptReply({
      deliveryId: "first-delivery",
      runtimeAgentId: first.runtimeAgentId,
      conversationId,
      expectedSequence: 1,
      text: "补充信息",
      ignoreNew: false,
      replyIndex: 0,
    });
    const forced = await host.attemptReply({
      deliveryId: "second-delivery",
      runtimeAgentId: second.runtimeAgentId,
      conversationId,
      expectedSequence: 1,
      text: "最终结论",
      ignoreNew: true,
      replyIndex: 0,
    });

    expect(forced).toMatchObject({
      status: "published",
      sequence: 3,
    });
    const forcedMessages = (forced as { messages: Array<{ sequence: number; content: unknown }> })
      .messages;
    expect(forcedMessages).toHaveLength(1);
    expect(forcedMessages[0]).toMatchObject({ sequence: 2, content: { text: "补充信息" } });
    const response = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversationId}/messages`,
      headers: { cookie },
    });
    expect(
      response.json<{ items: Array<{ sequence: number; content: { text: string } }> }>().items,
    ).toMatchObject([
      { sequence: 1, content: { text: "给出结论" } },
      { sequence: 2, content: { text: "补充信息" } },
      { sequence: 3, content: { text: "最终结论" } },
    ]);
  });
});

interface TestAgent {
  id: string;
  runtimeAgentId: string;
}

interface ConflictAwareHost {
  attemptReply(input: {
    deliveryId: string;
    runtimeAgentId: string;
    conversationId: string;
    expectedSequence: number;
    text: string;
    ignoreNew: boolean;
    replyIndex: number;
  }): Promise<unknown>;
}

class PassiveAgentRuntime implements AgentRuntime {
  readonly createAgent = vi.fn(
    async (input: CreateAgentInput): Promise<RuntimeAgentDefinition> => ({
      id: `runtime-${input.name.toLowerCase()}`,
      name: input.name,
      instructions: input.instructions,
      model: input.model ?? { provider: "faux", modelId: "chat-model" },
      enabled: true,
      createdAt: "2026-09-08T10:00:00.000Z",
      updatedAt: "2026-09-08T10:00:00.000Z",
    }),
  );
  readonly deliverMessage = vi.fn((input: DeliverAgentMessageInput) => {
    void input;
    return (async function* (): AgentRuntimeEventStream {})();
  });
  async listAgents() {
    return [];
  }
  async getAgent(): Promise<RuntimeAgentDefinition> {
    throw new Error("not used");
  }
  async updateAgent(): Promise<RuntimeAgentDefinition> {
    throw new Error("not used");
  }
  async deleteAgent() {}
  async close() {}
}

async function makeApp() {
  const dataDirectory = await mkdtemp(join(tmpdir(), "peerly-reply-conflict-"));
  temporaryDirectories.push(dataDirectory);
  const runtime = new PassiveAgentRuntime();
  let capturedHost: AgentHost | undefined;
  const app = await createPeerlyApp({
    dataDirectory,
    agentRuntimeFactory: async (host) => {
      capturedHost = host;
      return runtime;
    },
  });
  applications.push(app);
  return { app, runtime, host: capturedHost as AgentHost & ConflictAwareHost };
}

async function bootstrapAdministrator(app: Awaited<ReturnType<typeof createPeerlyApp>>) {
  const response = await app.inject({
    method: "POST",
    url: "/api/principals/humans",
    payload: { displayName: "Alice" },
  });
  const principal = response.json<{ principal: { id: string } }>().principal;
  const session = await app.inject({
    method: "POST",
    url: "/api/dev/session",
    payload: { principalId: principal.id },
  });
  const header = session.headers["set-cookie"];
  return { cookie: (Array.isArray(header) ? header[0] : header)!.split(";", 1)[0]! };
}

async function createAgent(
  app: Awaited<ReturnType<typeof createPeerlyApp>>,
  cookie: string,
  displayName: string,
): Promise<TestAgent> {
  const response = await app.inject({
    method: "POST",
    url: "/api/principals/agents",
    headers: { cookie },
    payload: { displayName, instructions: `${displayName} 的设定。` },
  });
  return response.json<{ principal: TestAgent }>().principal;
}

async function createGroup(
  app: Awaited<ReturnType<typeof createPeerlyApp>>,
  cookie: string,
  participantIds: string[],
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/conversations/groups",
    headers: { cookie },
    payload: { name: "报数群", participantIds },
  });
  return response.json<{ conversation: { id: string } }>().conversation.id;
}

async function sendMessage(
  app: Awaited<ReturnType<typeof createPeerlyApp>>,
  cookie: string,
  conversationId: string,
  text: string,
) {
  await app.inject({
    method: "POST",
    url: `/api/conversations/${conversationId}/messages`,
    headers: { cookie },
    payload: { clientMessageId: `client-${text}`, content: { type: "text", text } },
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
