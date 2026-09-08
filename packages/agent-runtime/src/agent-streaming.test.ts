import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type Models,
} from "@earendil-works/pi-ai";
import type {
  AgentRuntime,
  AgentRuntimeEvent,
  DeliverAgentMessageInput,
} from "@peerly/agent-protocol";
import { afterEach, describe, expect, it } from "vitest";

import { createAgentRuntime } from "./index.js";

const temporaryDirectories: string[] = [];
const runtimes: AgentRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Agent Runtime 事件流", () => {
  it("依次流式报告排队、运行过程、工具回复和完成", async () => {
    const { faux, models } = makeFauxModels();
    faux.setResponses([
      fauxAssistantMessage([fauxText("正在整理"), fauxToolCall("reply", { text: "整理完成" })], {
        stopReason: "toolUse",
      }),
    ]);
    const runtime = await prepareRuntime(models);
    const events = await collect(runtime.deliverMessage(delivery("开始")));

    expect(events[0]).toMatchObject({ type: "run_queued" });
    expect(events[1]).toMatchObject({ type: "run_started" });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "thinking_delta", delta: "正在整理" }),
        expect.objectContaining({ type: "tool_started", toolName: "reply" }),
        expect.objectContaining({ type: "reply_published", text: "整理完成" }),
      ]),
    );
    expect(events.at(-1)).toMatchObject({ type: "run_completed", replyCount: 1 });
  });

  it("同一 Agent Conversation 按 FIFO 执行，不同 Conversation 可以并行", async () => {
    const { faux, models } = makeFauxModels();
    const firstStarted = deferred();
    const secondConversationStarted = deferred();
    const releaseFirst = deferred();
    const starts: string[] = [];
    faux.setResponses([
      async () => {
        starts.push("first");
        firstStarted.resolve();
        await releaseFirst.promise;
        return replyResponse("第一条");
      },
      () => {
        starts.push("other-conversation");
        secondConversationStarted.resolve();
        return replyResponse("并行消息");
      },
      () => {
        starts.push("queued");
        return replyResponse("排队消息");
      },
    ]);
    const runtime = await prepareRuntime(models);
    const first = collect(runtime.deliverMessage(delivery("一")));
    await firstStarted.promise;
    const queued = collect(
      runtime.deliverMessage(delivery("二", { deliveryId: "delivery-2", messageId: "message-2" })),
    );
    const parallel = collect(
      runtime.deliverMessage(
        delivery("三", {
          deliveryId: "delivery-3",
          conversationId: "conversation-2",
          messageId: "message-3",
        }),
      ),
    );

    await withTimeout(secondConversationStarted.promise);
    expect(starts).toEqual(["first", "other-conversation"]);
    releaseFirst.resolve();
    await Promise.all([first, queued, parallel]);
    expect(starts).toEqual(["first", "other-conversation", "queued"]);
  });

  it("通过 AbortSignal 取消活跃运行", async () => {
    const { faux, models } = makeFauxModels({ tokensPerSecond: 20 });
    faux.setResponses([fauxAssistantMessage("这是一段足够长、可以在流式输出时取消的工作过程。")]);
    const runtime = await prepareRuntime(models);
    const controller = new AbortController();
    const events: AgentRuntimeEvent[] = [];

    for await (const event of runtime.deliverMessage(delivery("取消"), {
      signal: controller.signal,
    })) {
      events.push(event);
      if (event.type === "thinking_delta") controller.abort();
    }

    expect(events.at(-1)).toMatchObject({ type: "run_cancelled" });
    expect(events.some((event) => event.type === "reply_published")).toBe(false);
  });

  it("取消排队中的运行时不会调用模型", async () => {
    const { faux, models } = makeFauxModels();
    const firstStarted = deferred();
    const releaseFirst = deferred();
    faux.setResponses([
      async () => {
        firstStarted.resolve();
        await releaseFirst.promise;
        return replyResponse("第一条");
      },
      replyResponse("不应执行"),
    ]);
    const runtime = await prepareRuntime(models);
    const first = collect(runtime.deliverMessage(delivery("一")));
    await firstStarted.promise;
    const controller = new AbortController();
    const second = collect(
      runtime.deliverMessage(delivery("二", { deliveryId: "delivery-2", messageId: "message-2" }), {
        signal: controller.signal,
      }),
    );
    controller.abort();

    expect((await second).at(-1)).toMatchObject({ type: "run_cancelled" });
    expect(faux.state.callCount).toBe(1);
    releaseFirst.resolve();
    await first;
    expect(faux.state.callCount).toBe(1);
  });
});

function delivery(
  text: string,
  overrides: { deliveryId?: string; conversationId?: string; messageId?: string } = {},
): DeliverAgentMessageInput {
  return {
    deliveryId: overrides.deliveryId ?? "delivery-1",
    agentId: "assistant",
    agentPrincipalId: "principal-assistant",
    conversation: { id: overrides.conversationId ?? "conversation-1", type: "direct" },
    messages: [
      {
        id: overrides.messageId ?? "message-1",
        sender: { id: "human-alice", type: "human", name: "Alice" },
        createdAt: "2026-09-08T10:00:00.000Z",
        content: { type: "text", text },
      },
    ],
  };
}

function replyResponse(text: string) {
  return fauxAssistantMessage(fauxToolCall("reply", { text }), { stopReason: "toolUse" });
}

function makeFauxModels(options: { tokensPerSecond?: number } = {}) {
  const faux = fauxProvider({
    provider: "faux",
    models: [{ id: "chat-model" }],
    ...(options.tokensPerSecond ? { tokensPerSecond: options.tokensPerSecond } : {}),
  });
  const models = createModels();
  models.setProvider(faux.provider);
  return { faux, models };
}

async function prepareRuntime(models: Models) {
  const dataDirectory = await mkdtemp(join(tmpdir(), "peerly-agent-streaming-"));
  temporaryDirectories.push(dataDirectory);
  const runtime = await createAgentRuntime({ dataDirectory, models });
  runtimes.push(runtime);
  await runtime.createAgent({
    id: "assistant",
    name: "Assistant",
    instructions: "帮助用户",
    model: { provider: "faux", modelId: "chat-model" },
  });
  return runtime;
}

async function collect(stream: AsyncIterable<AgentRuntimeEvent>) {
  const events: AgentRuntimeEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs = 1_000): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
