import type { DeliverAgentMessageInput, RuntimeAgentDefinition } from "@peerly/agent-protocol";

export const PEERLY_SYSTEM_PROMPT = `你是 Peerly 协作平台中的 Agent 用户，与人类成员和其他 Agent 在同一个空间中协作。

每次收到的消息都是 JSON，顶层只有 conversation 和 messages：
- conversation.type 表示 direct 私聊或 group 群聊。
- messages 按时间顺序排列。
- 每条消息包含 sender、sentAt 和 text。

你可以在私有 session 中思考和使用工具。普通文本输出只作为内部工作过程，不会发送到聊天中。只有传给 reply 工具的 text 才会成为 Peerly 中的正式消息。

回复规则：
- 私聊消息必须尝试调用 reply 工具回复。
- 群聊中的所有公开消息都会发送给你。人类成员明确 @ 你时必须尝试回复；普通群消息由你判断是否有必要回复。
- 其他 Agent @ 你只表示定向交流意图，不要求你必须回复。不要仅为确认收到而回复；如果问题已被充分回答或你没有新的有效贡献，应保持沉默。

reply 工具会在发送前检查会话是否出现了你尚未看到的新消息。如果工具返回 reply 为 not_sent，说明回复没有发出，返回的 messages 是期间新增的消息。此时你必须结合新消息重新判断，并选择以下一种做法：
1. 如果原回复仍合适，用原文再次调用 reply。
2. 如果需要调整，修改文本后再次调用 reply。
3. 如果新增消息与回复无关且会话持续活跃，可以设置 ignore_new=true 强制发送。ignore_new 只能在已经发生过冲突后使用。
4. 如果回复已重复、已不合适或不再需要，不再调用 reply，表示取消发送。

每次未设置 ignore_new 的 reply 都会重新检查新消息，因此修改期间如果又产生消息，你会再次看到它们。`;

export function buildAgentSystemPrompt(agent: RuntimeAgentDefinition): string {
  return `${PEERLY_SYSTEM_PROMPT}\n\n你的个性化设定：\n${agent.instructions}`;
}

export function formatPeerlyMessageBatch(input: DeliverAgentMessageInput): string {
  return formatMessages(input.conversation.type, input.messages);
}

export function formatReplyConflict(
  conversationType: "direct" | "group",
  messages: DeliverAgentMessageInput["messages"],
): string {
  return JSON.stringify({
    reply: "not_sent",
    ...messageEnvelope(conversationType, messages),
  });
}

function formatMessages(
  conversationType: "direct" | "group",
  messages: DeliverAgentMessageInput["messages"],
): string {
  return JSON.stringify(messageEnvelope(conversationType, messages));
}

function messageEnvelope(
  conversationType: "direct" | "group",
  messages: DeliverAgentMessageInput["messages"],
) {
  return {
    conversation: {
      type: conversationType,
    },
    messages: messages.map((message) => ({
      sender: {
        name: message.sender.name,
        type: message.sender.type,
      },
      sentAt: message.createdAt,
      text: message.content.text,
    })),
  };
}
