import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  contentText,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type Models,
} from "@earendil-works/pi-ai";
import type {
  AgentHost,
  AgentRuntime,
  AgentRuntimeEvent,
  DeliverAgentMessageInput,
  PublishAgentReplyInput,
} from "@peerly/agent-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAgentRuntime } from "./index.js";

const temporaryDirectories: string[] = [];
const runtimes: AgentRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe("Peerly 消息投递", () => {
  it("向模型注入精简消息 JSON，并且只通过 reply 工具发布正式回复", async () => {
    const dataDirectory = await makeDataDirectory();
    const { faux, models } = makeFauxModels();
    let modelInput: { systemPrompt?: string; userContent?: string } = {};
    faux.setResponses([
      (context) => {
        const lastMessage = context.messages.at(-1);
        modelInput = {
          ...(context.systemPrompt ? { systemPrompt: context.systemPrompt } : {}),
          ...(lastMessage?.role === "user"
            ? { userContent: contentText(lastMessage.content) }
            : {}),
        };
        return fauxAssistantMessage(
          [fauxText("我先整理一下。"), fauxToolCall("reply", { text: "这是整理后的结论。" })],
          { stopReason: "toolUse" },
        );
      },
    ]);
    const publishReply = vi.fn(async (input: PublishAgentReplyInput) => ({
      messageId: `published-${input.replyIndex}`,
      createdAt: "2026-09-08T10:31:00.000Z",
    }));
    const runtime = await makeRuntime(dataDirectory, models, { publishReply });
    await createAgent(runtime, "你擅长提炼产品需求。");

    const events = await collect(runtime.deliverMessage(directDelivery("请总结方案")));

    expect(JSON.parse(modelInput.userContent!)).toEqual({
      conversation: { type: "direct" },
      messages: [
        {
          sender: { name: "Alice", type: "human" },
          sentAt: "2026-09-08T10:30:00.000Z",
          text: "请总结方案",
        },
      ],
    });
    expect(modelInput.userContent).not.toContain("message-101");
    expect(modelInput.userContent).not.toContain("conversation-1");
    expect(modelInput.systemPrompt).toContain("Peerly");
    expect(modelInput.systemPrompt).toContain("私聊消息必须调用 reply 工具回复");
    expect(modelInput.systemPrompt).toContain("你擅长提炼产品需求。");
    expect(publishReply).toHaveBeenCalledWith({
      deliveryId: "delivery-1",
      runtimeAgentId: "assistant",
      conversationId: "conversation-1",
      text: "这是整理后的结论。",
      replyIndex: 0,
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "thinking_delta", delta: "我先整理一下。" }),
        expect.objectContaining({ type: "tool_started", toolName: "reply" }),
        expect.objectContaining({
          type: "reply_published",
          text: "这是整理后的结论。",
          messageId: "published-0",
        }),
        expect.objectContaining({ type: "tool_completed", toolName: "reply" }),
        expect.objectContaining({ type: "run_completed", replyCount: 1 }),
      ]),
    );
    expect(events.some((event) => "content" in event && event.type === "run_completed")).toBe(
      false,
    );
  });

  it("同一 Agent 和 Conversation 保留上下文，不同 Conversation 相互隔离", async () => {
    const dataDirectory = await makeDataDirectory();
    const { faux, models } = makeFauxModels();
    const observedTranscripts: string[][] = [];
    faux.setResponses([
      replyResponse("记住了"),
      (context) => {
        observedTranscripts.push(context.messages.map(transcriptLine));
        return replyResponse("Peerly");
      },
      (context) => {
        observedTranscripts.push(context.messages.map(transcriptLine));
        return replyResponse("不知道");
      },
    ]);
    const runtime = await makeRuntime(dataDirectory, models, successfulHost());
    await createAgent(runtime);

    await collect(runtime.deliverMessage(directDelivery("项目叫 Peerly")));
    await collect(
      runtime.deliverMessage(
        directDelivery("项目叫什么？", {
          deliveryId: "delivery-2",
          messageId: "message-102",
        }),
      ),
    );
    await collect(
      runtime.deliverMessage(
        directDelivery("项目叫什么？", {
          deliveryId: "delivery-3",
          conversationId: "conversation-2",
          messageId: "message-103",
        }),
      ),
    );

    expect(observedTranscripts[0]?.[0]).toContain("项目叫 Peerly");
    expect(observedTranscripts[0]?.at(-1)).toContain("项目叫什么？");
    expect(observedTranscripts[1]).toHaveLength(1);
    expect(observedTranscripts[1]?.[0]).toContain("项目叫什么？");
  });

  it("模型未调用 reply 时纠正一次，仍未回复则以 REPLY_REQUIRED 失败", async () => {
    const dataDirectory = await makeDataDirectory();
    const { faux, models } = makeFauxModels();
    faux.setResponses([fauxAssistantMessage("只输出文本"), fauxAssistantMessage("仍然只输出文本")]);
    const host = successfulHost();
    const runtime = await makeRuntime(dataDirectory, models, host);
    await createAgent(runtime);

    const events = await collect(runtime.deliverMessage(directDelivery("必须回复")));

    expect(faux.state.callCount).toBe(2);
    expect(host.publishReply).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({
      type: "run_failed",
      error: { code: "REPLY_REQUIRED" },
    });
  });

  it("群聊普通消息不调用模型，被明确 mention 时必须回复", async () => {
    const dataDirectory = await makeDataDirectory();
    const { faux, models } = makeFauxModels();
    faux.setResponses([replyResponse("群聊回复")]);
    const host = successfulHost();
    const runtime = await makeRuntime(dataDirectory, models, host);
    await createAgent(runtime);

    const skipped = await collect(runtime.deliverMessage(groupDelivery(false)));
    expect(skipped).toEqual([
      expect.objectContaining({ type: "delivery_skipped", reason: "not_mentioned" }),
    ]);
    expect(faux.state.callCount).toBe(0);

    const mentionedOtherAgent = await collect(
      runtime.deliverMessage(groupDelivery(true, "agent-other")),
    );
    expect(mentionedOtherAgent.at(-1)).toMatchObject({
      type: "delivery_skipped",
      reason: "not_mentioned",
    });
    expect(faux.state.callCount).toBe(0);

    const events = await collect(runtime.deliverMessage(groupDelivery(true)));
    expect(faux.state.callCount).toBe(1);
    expect(host.publishReply).toHaveBeenCalledOnce();
    expect(events.at(-1)).toMatchObject({ type: "run_completed", replyCount: 1 });
  });
});

function directDelivery(
  text: string,
  overrides: {
    deliveryId?: string;
    conversationId?: string;
    messageId?: string;
  } = {},
): DeliverAgentMessageInput {
  return {
    deliveryId: overrides.deliveryId ?? "delivery-1",
    agentId: "assistant",
    agentPrincipalId: "agent-assistant",
    conversation: {
      id: overrides.conversationId ?? "conversation-1",
      type: "direct",
    },
    messages: [
      {
        id: overrides.messageId ?? "message-101",
        sender: { id: "human-alice", type: "human", name: "Alice" },
        createdAt: "2026-09-08T10:30:00.000Z",
        content: { type: "text", text },
      },
    ],
  };
}

function groupDelivery(
  mentioned: boolean,
  mentionedPrincipalId = "agent-assistant",
): DeliverAgentMessageInput {
  return {
    deliveryId: mentioned ? "delivery-group-mentioned" : "delivery-group-ordinary",
    agentId: "assistant",
    agentPrincipalId: "agent-assistant",
    conversation: { id: "conversation-group", type: "group" },
    messages: [
      {
        id: mentioned ? "message-mentioned" : "message-ordinary",
        sender: { id: "human-alice", type: "human", name: "Alice" },
        createdAt: "2026-09-08T10:30:00.000Z",
        content: {
          type: "text",
          text: mentioned ? "@Assistant 请总结" : "大家先看看材料",
          ...(mentioned
            ? {
                mentions: [{ principalId: mentionedPrincipalId, displayName: "Assistant" }],
              }
            : {}),
        },
      },
    ],
  };
}

function replyResponse(text: string) {
  return fauxAssistantMessage(fauxToolCall("reply", { text }), { stopReason: "toolUse" });
}

function transcriptLine(message: { role: string; content: Parameters<typeof contentText>[0] }) {
  return `${message.role}:${contentText(message.content)}`;
}

function successfulHost(): AgentHost & { publishReply: ReturnType<typeof vi.fn> } {
  return {
    publishReply: vi.fn(async (input: PublishAgentReplyInput) => ({
      messageId: `${input.deliveryId}-${input.replyIndex}`,
      createdAt: "2026-09-08T10:31:00.000Z",
    })),
  };
}

async function createAgent(runtime: AgentRuntime, instructions = "帮助用户。") {
  await runtime.createAgent({
    id: "assistant",
    name: "Assistant",
    instructions,
    model: { provider: "faux", modelId: "chat-model" },
  });
}

async function makeDataDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "peerly-delivery-"));
  temporaryDirectories.push(directory);
  return directory;
}

function makeFauxModels() {
  const faux = fauxProvider({ provider: "faux", models: [{ id: "chat-model" }] });
  const models = createModels();
  models.setProvider(faux.provider);
  return { faux, models };
}

async function makeRuntime(dataDirectory: string, models: Models, host: AgentHost) {
  const runtime = await createAgentRuntime({ dataDirectory, models, host });
  runtimes.push(runtime);
  return runtime;
}

async function collect(stream: AsyncIterable<AgentRuntimeEvent>): Promise<AgentRuntimeEvent[]> {
  const events: AgentRuntimeEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}
