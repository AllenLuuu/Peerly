import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { AgentHost, PublishedAgentReply } from "@peerly/agent-protocol";

export interface ReplyToolContext {
  deliveryId: string;
  runtimeAgentId: string;
  conversationId: string;
  host: AgentHost;
  signal: AbortSignal;
  nextReplyIndex(): number;
  onReply(text: string, result: PublishedAgentReply): void;
  onToolStarted(): void;
  onToolCompleted(): void;
}

const replyParameters = Type.Object(
  {
    text: Type.String({ minLength: 1, description: "要发送到当前会话的文本" }),
  },
  { additionalProperties: false },
);

export function createReplyTool(): AgentHarnessTool<
  ReplyToolContext,
  typeof replyParameters,
  PublishedAgentReply
> {
  return {
    name: "reply",
    label: "回复 Peerly 消息",
    description: "向当前 Peerly 会话发送一条正式文本消息。私聊时必须使用此工具回复。",
    parameters: replyParameters,
    executionMode: "sequential",
    replay: "safe",
    async execute(_toolCallId, params, _onUpdate, toolContext) {
      if (toolContext.signal.aborted) throw new Error("Message delivery was cancelled");
      toolContext.onToolStarted();
      const replyIndex = toolContext.nextReplyIndex();
      const result = await toolContext.host.publishReply({
        deliveryId: toolContext.deliveryId,
        runtimeAgentId: toolContext.runtimeAgentId,
        conversationId: toolContext.conversationId,
        text: params.text,
        replyIndex,
      });
      toolContext.onReply(params.text, result);
      toolContext.onToolCompleted();
      return {
        content: [{ type: "text", text: "回复已发送" }],
        details: result,
        terminate: true,
      };
    },
  };
}
