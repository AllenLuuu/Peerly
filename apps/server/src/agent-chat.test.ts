import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  AgentHost,
  AgentRuntime,
  AgentRuntimeEventStream,
  CreateAgentInput,
  DeliverAgentMessageInput,
  DeliverMessageOptions,
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

describe("平台内私聊 Agent", () => {
  it("管理员创建 Agent 后可发起私聊，只有 reply 工具内容进入公开消息", async () => {
    const runtime = new FakeAgentRuntime();
    const app = await makeApp(runtime);
    const { alice, cookie } = await bootstrapAdministrator(app);

    const createAgentResponse = await app.inject({
      method: "POST",
      url: "/api/principals/agents",
      headers: { cookie },
      payload: { displayName: "Researcher", instructions: "擅长资料整理。" },
    });

    expect(createAgentResponse.statusCode).toBe(201);
    const agent = createAgentResponse.json<{ principal: AgentBody }>().principal;
    expect(agent).toMatchObject({
      type: "agent",
      displayName: "Researcher",
      runtimeAgentId: "runtime-researcher",
      status: "active",
    });
    expect(runtime.createAgent).toHaveBeenCalledWith({
      name: "Researcher",
      instructions: "擅长资料整理。",
    });

    const conversationResponse = await app.inject({
      method: "POST",
      url: "/api/conversations/direct",
      headers: { cookie },
      payload: { participantId: agent.id },
    });
    const conversation = conversationResponse.json<{
      conversation: { id: string };
    }>().conversation;

    const sendResponse = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversation.id}/messages`,
      headers: { cookie },
      payload: {
        clientMessageId: "alice-1",
        content: { type: "text", text: "帮我总结一下" },
      },
    });
    expect(sendResponse.statusCode).toBe(201);

    await waitFor(() => runtime.deliverMessage.mock.calls.length === 1);
    expect(runtime.deliverMessage.mock.calls[0]?.[0]).toMatchObject({
      agentId: "runtime-researcher",
      conversation: { id: conversation.id, type: "direct" },
      messages: [
        {
          sender: { id: alice.id, type: "human", name: "Alice" },
          content: { type: "text", text: "帮我总结一下" },
        },
      ],
    });

    await waitFor(async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/conversations/${conversation.id}/messages`,
        headers: { cookie },
      });
      return (
        response.json<{ items: Array<{ content: { text: string }; senderId: string }> }>().items
          .length === 2
      );
    });
    const messagesResponse = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversation.id}/messages`,
      headers: { cookie },
    });
    expect(
      messagesResponse.json<{ items: Array<{ content: { text: string }; senderId: string }> }>()
        .items,
    ).toEqual([
      expect.objectContaining({
        senderId: alice.id,
        content: { type: "text", text: "帮我总结一下" },
      }),
      expect.objectContaining({
        senderId: agent.id,
        content: { type: "text", text: "这是正式回复" },
      }),
    ]);
  });

  it("只有管理员可以创建 Agent", async () => {
    const runtime = new FakeAgentRuntime();
    const app = await makeApp(runtime);
    const { cookie } = await bootstrapAdministrator(app);
    const bobResponse = await app.inject({
      method: "POST",
      url: "/api/principals/humans",
      headers: { cookie },
      payload: { displayName: "Bob" },
    });
    const bob = bobResponse.json<{ principal: { id: string } }>().principal;
    const bobCookie = await selectIdentity(app, bob.id);

    const response = await app.inject({
      method: "POST",
      url: "/api/principals/agents",
      headers: { cookie: bobCookie },
      payload: { displayName: "Assistant", instructions: "帮助团队。" },
    });

    expect(response.statusCode).toBe(403);
    expect(runtime.createAgent).not.toHaveBeenCalled();
  });

  it("用户可以取消当前 Agent 运行", async () => {
    const runtime = new FakeAgentRuntime({ waitForCancellation: true });
    const app = await makeApp(runtime);
    const { cookie } = await bootstrapAdministrator(app);
    const agentResponse = await app.inject({
      method: "POST",
      url: "/api/principals/agents",
      headers: { cookie },
      payload: { displayName: "Assistant", instructions: "帮助团队。" },
    });
    const agent = agentResponse.json<{ principal: AgentBody }>().principal;
    const conversationResponse = await app.inject({
      method: "POST",
      url: "/api/conversations/direct",
      headers: { cookie },
      payload: { participantId: agent.id },
    });
    const conversationId = conversationResponse.json<{ conversation: { id: string } }>()
      .conversation.id;
    await app.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/messages`,
      headers: { cookie },
      payload: { clientMessageId: "cancel-1", content: { type: "text", text: "慢任务" } },
    });
    await waitFor(() => runtime.lastDelivery !== undefined);

    const cancelResponse = await app.inject({
      method: "POST",
      url: `/api/agent-deliveries/${runtime.lastDelivery!.deliveryId}/cancel`,
      headers: { cookie },
    });

    expect(cancelResponse.statusCode).toBe(202);
    await waitFor(() => runtime.wasCancelled);
  });
});

interface AgentBody {
  id: string;
  type: "agent";
  displayName: string;
  runtimeAgentId: string;
  status: string;
}

class FakeAgentRuntime implements AgentRuntime {
  readonly createAgent = vi.fn(
    async (input: CreateAgentInput): Promise<RuntimeAgentDefinition> => ({
      id: "runtime-researcher",
      name: input.name,
      instructions: input.instructions,
      model: input.model ?? { provider: "faux", modelId: "chat-model" },
      enabled: true,
      createdAt: "2026-09-08T10:00:00.000Z",
      updatedAt: "2026-09-08T10:00:00.000Z",
    }),
  );
  readonly deliverMessage = vi.fn(
    (input: DeliverAgentMessageInput, options: DeliverMessageOptions = {}) => {
      this.lastDelivery = input;
      const host = this.host;
      const waitForCancellation = this.options.waitForCancellation;
      const markCancelled = (cancelled: boolean) => {
        this.wasCancelled = cancelled;
      };
      return (async function* (): AgentRuntimeEventStream {
        yield { type: "run_queued", timestamp: now() };
        yield { type: "run_started", timestamp: now() };
        if (waitForCancellation) {
          await new Promise<void>((resolve) => {
            if (options.signal?.aborted) return resolve();
            options.signal?.addEventListener("abort", () => resolve(), { once: true });
          });
          markCancelled(options.signal?.aborted === true);
          yield { type: "run_cancelled", timestamp: now() };
          return;
        }
        yield { type: "thinking_delta", timestamp: now(), delta: "不会公开的思考" };
        const published = await host.publishReply({
          deliveryId: input.deliveryId,
          runtimeAgentId: input.agentId,
          conversationId: input.conversation.id,
          text: "这是正式回复",
          replyIndex: 0,
        });
        yield {
          type: "reply_published",
          timestamp: now(),
          text: "这是正式回复",
          ...published,
        };
        yield { type: "run_completed", timestamp: now(), replyCount: 1 };
      })();
    },
  );
  lastDelivery: DeliverAgentMessageInput | undefined;
  wasCancelled = false;
  host!: AgentHost;

  constructor(private readonly options: { waitForCancellation?: boolean } = {}) {}

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

async function makeApp(runtime: FakeAgentRuntime) {
  const dataDirectory = await mkdtemp(join(tmpdir(), "peerly-agent-chat-"));
  temporaryDirectories.push(dataDirectory);
  const app = await createPeerlyApp({
    dataDirectory,
    agentRuntimeFactory: async (host) => {
      runtime.host = host;
      return runtime;
    },
  });
  applications.push(app);
  return app;
}

async function bootstrapAdministrator(app: Awaited<ReturnType<typeof createPeerlyApp>>) {
  const response = await app.inject({
    method: "POST",
    url: "/api/principals/humans",
    payload: { displayName: "Alice" },
  });
  const alice = response.json<{ principal: { id: string } }>().principal;
  return { alice, cookie: await selectIdentity(app, alice.id) };
}

async function selectIdentity(
  app: Awaited<ReturnType<typeof createPeerlyApp>>,
  principalId: string,
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/dev/session",
    payload: { principalId },
  });
  const header = response.headers["set-cookie"];
  return (Array.isArray(header) ? header[0] : header)!.split(";", 1)[0]!;
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function now() {
  return new Date().toISOString();
}
