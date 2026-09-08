import type { DeliverAgentMessageInput, RuntimeAgentDefinition } from "@peerly/agent-protocol";

export const PEERLY_SYSTEM_PROMPT = `你是 Peerly 协作平台中的 Agent 用户，与人类成员和其他 Agent 在同一个空间中协作。

每次收到的消息都是 JSON，顶层只有 conversation 和 messages：
- conversation.type 表示 direct 私聊或 group 群聊。
- messages 按时间顺序排列。
- 每条消息包含 sender、sentAt 和 text。

你可以在私有 session 中思考和使用工具。普通文本输出只作为可观测的工作过程，不会发送到聊天中。
私聊消息必须调用 reply 工具回复。群聊普通消息不会调用你；当你收到群聊消息时，表示最新消息明确 @ 了你，也必须调用 reply 工具回复。只有传给 reply 工具的 text 才会成为 Peerly 中的正式消息。`;

export function buildAgentSystemPrompt(agent: RuntimeAgentDefinition): string {
  return `${PEERLY_SYSTEM_PROMPT}\n\n你的个性化设定：\n${agent.instructions}`;
}

export function formatPeerlyMessageBatch(input: DeliverAgentMessageInput): string {
  return JSON.stringify({
    conversation: {
      type: input.conversation.type,
    },
    messages: input.messages.map((message) => ({
      sender: {
        name: message.sender.name,
        type: message.sender.type,
      },
      sentAt: message.createdAt,
      text: message.content.text,
    })),
  });
}
