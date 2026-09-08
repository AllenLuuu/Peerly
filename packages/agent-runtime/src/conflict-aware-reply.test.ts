import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  contentText,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type {
  AgentHost,
  AgentRuntime,
  AgentRuntimeEvent,
  DeliverAgentMessageInput,
} from "@peerly/agent-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

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

describe("群聊自主参与和冲突感知回复", () => {
  it("普通群消息会交给 Agent 判断，并允许不回复", async () => {
    const { faux, runtime, host } = await prepareRuntime();
    faux.setResponses([fauxAssistantMessage("讨论已经很充分，我保持沉默。")]);

    const events = await collect(runtime.deliverMessage(groupDelivery({ text: "大家怎么看？" })));

    expect(faux.state.callCount).toBe(1);
    expect(host.attemptReply).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ type: "run_completed", replyCount: 0 });
  });

  it("Agent 的 mention 只表达定向意图，不强制被提及 Agent 回复", async () => {
    const { faux, runtime, host } = await prepareRuntime();
    faux.setResponses([fauxAssistantMessage("不需要补充。")]);

    const events = await collect(
      runtime.deliverMessage(
        groupDelivery({
          text: "@Assistant 你觉得呢？",
          sender: { id: "agent-peer", type: "agent", name: "Peer" },
          mentions: [{ principalId: "agent-assistant", displayName: "Assistant" }],
        }),
      ),
    );

    expect(faux.state.callCount).toBe(1);
    expect(host.attemptReply).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ type: "run_completed", replyCount: 0 });
  });

  it("人类 mention 后回复若过时，会看到新消息并可修改后再次发送", async () => {
    const { faux, runtime, host } = await prepareRuntime();
    let conflictToolResult = "";
    faux.setResponses([
      replyResponse("1"),
      (context) => {
        conflictToolResult = contentText(context.messages.at(-1)!.content);
        return replyResponse("2");
      },
    ]);
    host.attemptReply
      .mockResolvedValueOnce({
        status: "conflict",
        latestSequence: 2,
        messages: [runtimeMessage(2, "1", { id: "agent-first", type: "agent", name: "First" })],
      })
      .mockResolvedValueOnce({
        status: "published",
        messageId: "message-3",
        sequence: 3,
        createdAt: "2026-09-08T10:00:03.000Z",
        messages: [],
      });

    const events = await collect(
      runtime.deliverMessage(
        groupDelivery({
          text: "@Assistant 开始报数",
          mentions: [{ principalId: "agent-assistant", displayName: "Assistant" }],
        }),
      ),
    );

    expect(host.attemptReply).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ text: "1", expectedSequence: 1, ignoreNew: false }),
    );
    expect(JSON.parse(conflictToolResult)).toEqual({
      reply: "not_sent",
      conversation: { type: "group" },
      messages: [
        {
          sender: { name: "First", type: "agent" },
          sentAt: "2026-09-08T10:00:02.000Z",
          text: "1",
        },
      ],
    });
    expect(host.attemptReply).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ text: "2", expectedSequence: 2, ignoreNew: false }),
    );
    expect(events.at(-1)).toMatchObject({ type: "run_completed", replyCount: 1 });
  });

  it("冲突后可以取消发送，不再因为人类 mention 被强制重试", async () => {
    const { faux, runtime, host } = await prepareRuntime();
    faux.setResponses([
      replyResponse("重复答案"),
      fauxAssistantMessage("已有同伴回答，取消发送。"),
    ]);
    host.attemptReply.mockResolvedValueOnce({
      status: "conflict",
      latestSequence: 2,
      messages: [runtimeMessage(2, "已经回答", { id: "agent-peer", type: "agent", name: "Peer" })],
    });

    const events = await collect(
      runtime.deliverMessage(
        groupDelivery({
          text: "@Assistant 回答问题",
          mentions: [{ principalId: "agent-assistant", displayName: "Assistant" }],
        }),
      ),
    );

    expect(host.attemptReply).toHaveBeenCalledOnce();
    expect(events.at(-1)).toMatchObject({ type: "run_completed", replyCount: 0 });
  });

  it("冲突后可以用 ignore_new 强制追加，避免活跃会话导致回复饥饿", async () => {
    const { faux, runtime, host } = await prepareRuntime();
    faux.setResponses([replyResponse("结论"), replyResponse("结论", true)]);
    host.attemptReply
      .mockResolvedValueOnce({
        status: "conflict",
        latestSequence: 2,
        messages: [runtimeMessage(2, "无关插话")],
      })
      .mockResolvedValueOnce({
        status: "published",
        messageId: "message-4",
        sequence: 4,
        createdAt: "2026-09-08T10:00:04.000Z",
        messages: [runtimeMessage(3, "又一条无关插话")],
      });

    const events = await collect(
      runtime.deliverMessage(
        groupDelivery({
          text: "@Assistant 给出结论",
          mentions: [{ principalId: "agent-assistant", displayName: "Assistant" }],
        }),
      ),
    );

    expect(host.attemptReply).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ text: "结论", expectedSequence: 2, ignoreNew: true }),
    );
    expect(events.at(-1)).toMatchObject({ type: "run_completed", replyCount: 1 });
  });

  it("修改回复期间再次出现消息时会再次冲突，直到回复基于最新消息", async () => {
    const { faux, runtime, host } = await prepareRuntime();
    faux.setResponses([replyResponse("1"), replyResponse("2"), replyResponse("3")]);
    host.attemptReply
      .mockResolvedValueOnce({
        status: "conflict",
        latestSequence: 2,
        messages: [runtimeMessage(2, "1", { id: "agent-one", type: "agent", name: "One" })],
      })
      .mockResolvedValueOnce({
        status: "conflict",
        latestSequence: 3,
        messages: [runtimeMessage(3, "2", { id: "agent-two", type: "agent", name: "Two" })],
      })
      .mockResolvedValueOnce({
        status: "published",
        messageId: "message-4",
        sequence: 4,
        createdAt: "2026-09-08T10:00:04.000Z",
        messages: [],
      });

    const events = await collect(
      runtime.deliverMessage(
        groupDelivery({
          text: "@Assistant 开始报数",
          mentions: [{ principalId: "agent-assistant", displayName: "Assistant" }],
        }),
      ),
    );

    expect(host.attemptReply.mock.calls.map(([input]) => input.expectedSequence)).toEqual([
      1, 2, 3,
    ]);
    expect(events.at(-1)).toMatchObject({ type: "run_completed", replyCount: 1 });
  });

  it("重复投递同一批消息不会再次调用模型", async () => {
    const { faux, runtime } = await prepareRuntime();
    faux.setResponses([fauxAssistantMessage("无需回复")]);
    const input = groupDelivery({ text: "普通消息" });

    await collect(runtime.deliverMessage(input));
    const duplicateEvents = await collect(
      runtime.deliverMessage({ ...input, deliveryId: "duplicate-delivery" }),
    );

    expect(faux.state.callCount).toBe(1);
    expect(duplicateEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "delivery_skipped", reason: "already_processed" }),
      ]),
    );
  });

  it("发生冲突前不能使用 ignore_new 绕过检查", async () => {
    const { faux, runtime, host } = await prepareRuntime();
    faux.setResponses([replyResponse("不能直接强制发送", true), replyResponse("正常发送")]);
    host.attemptReply.mockResolvedValueOnce({
      status: "published",
      messageId: "message-2",
      sequence: 2,
      createdAt: "2026-09-08T10:00:02.000Z",
      messages: [],
    });

    const events = await collect(
      runtime.deliverMessage(
        groupDelivery({
          text: "@Assistant 回答",
          mentions: [{ principalId: "agent-assistant", displayName: "Assistant" }],
        }),
      ),
    );

    expect(host.attemptReply).toHaveBeenCalledOnce();
    expect(host.attemptReply).toHaveBeenCalledWith(
      expect.objectContaining({ text: "正常发送", ignoreNew: false }),
    );
    expect(events.at(-1)).toMatchObject({ type: "run_completed", replyCount: 1 });
  });

  it("默认 Prompt 会教 Agent 处理冲突、ignore_new 和取消发送", async () => {
    const { faux, runtime } = await prepareRuntime();
    let systemPrompt = "";
    faux.setResponses([
      (context) => {
        systemPrompt = context.systemPrompt ?? "";
        return fauxAssistantMessage("保持沉默");
      },
    ]);

    await collect(runtime.deliverMessage(groupDelivery({ text: "普通消息" })));

    expect(systemPrompt).toContain("ignore_new");
    expect(systemPrompt).toContain("原文");
    expect(systemPrompt).toContain("修改");
    expect(systemPrompt).toContain("取消");
    expect(systemPrompt).toContain("人类成员明确 @ 你");
    expect(systemPrompt).toContain("其他 Agent @ 你");
  });
});

function groupDelivery(options: {
  text: string;
  sender?: { id: string; type: "human" | "agent"; name: string };
  mentions?: Array<{ principalId: string; displayName: string }>;
}): DeliverAgentMessageInput {
  return {
    deliveryId: "delivery-1",
    agentId: "assistant",
    agentPrincipalId: "agent-assistant",
    conversation: { id: "conversation-group", type: "group" },
    messages: [
      {
        ...runtimeMessage(1, options.text, options.sender),
        content: {
          type: "text",
          text: options.text,
          ...(options.mentions ? { mentions: options.mentions } : {}),
        },
      },
    ],
  };
}

function runtimeMessage(
  sequence: number,
  text: string,
  sender: { id: string; type: "human" | "agent"; name: string } = {
    id: "human-alice",
    type: "human",
    name: "Alice",
  },
) {
  return {
    id: `message-${sequence}`,
    sequence,
    sender,
    createdAt: `2026-09-08T10:00:0${sequence}.000Z`,
    content: { type: "text" as const, text },
  };
}

function replyResponse(text: string, ignoreNew = false) {
  return fauxAssistantMessage(
    fauxToolCall("reply", { text, ...(ignoreNew ? { ignore_new: true } : {}) }),
    { stopReason: "toolUse" },
  );
}

async function prepareRuntime() {
  const directory = await mkdtemp(join(tmpdir(), "peerly-conflict-aware-"));
  temporaryDirectories.push(directory);
  const faux = fauxProvider({ provider: "faux", models: [{ id: "chat-model" }] });
  const models = createModels();
  models.setProvider(faux.provider);
  const host = {
    attemptReply: vi.fn(),
  };
  const runtime = await createAgentRuntime({
    dataDirectory: directory,
    models,
    host: host as unknown as AgentHost,
  });
  runtimes.push(runtime);
  await runtime.createAgent({
    id: "assistant",
    name: "Assistant",
    instructions: "帮助团队。",
    model: { provider: "faux", modelId: "chat-model" },
  });
  return { faux, runtime, host };
}

async function collect(stream: AsyncIterable<AgentRuntimeEvent>): Promise<AgentRuntimeEvent[]> {
  const events: AgentRuntimeEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}
