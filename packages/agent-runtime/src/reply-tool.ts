import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type {
  AgentHost,
  AgentReplyAttempt,
  ConflictedAgentReply,
  PublishedAgentReply,
} from "@peerly/agent-protocol";

import { formatReplyConflict } from "./peerly-system-prompt.js";

export interface ReplyToolContext {
  deliveryId: string;
  runtimeAgentId: string;
  conversationId: string;
  conversationType: "direct" | "group";
  host: AgentHost;
  signal: AbortSignal;
  expectedSequence(): number;
  hasConflict(): boolean;
  nextReplyIndex(): number;
  onReplyAttempt(): void;
  onConflict(result: ConflictedAgentReply): void;
  onPublished(result: PublishedAgentReply): void;
  onReply(text: string, result: PublishedAgentReply): void;
  onToolStarted(): void;
  onToolCompleted(): void;
}

const replyParameters = Type.Object(
  {
    text: Type.String({ minLength: 1, description: "要发送到当前会话的文本" }),
    ignore_new: Type.Optional(
      Type.Boolean({
        description: "仅在发生过回复冲突后使用；忽略之后出现的新消息并直接追加回复",
      }),
    ),
  },
  { additionalProperties: false },
);

export function createReplyTool(): AgentHarnessTool<
  ReplyToolContext,
  typeof replyParameters,
  AgentReplyAttempt
> {
  return {
    name: "reply",
    label: "回复 Peerly 消息",
    description:
      "向当前 Peerly 会话发送一条正式文本消息。私聊和人类明确 @ 你时必须尝试使用此工具。",
    parameters: replyParameters,
    executionMode: "sequential",
    replay: "safe",
    async execute(_toolCallId, params, _onUpdate, toolContext) {
      if (toolContext.signal.aborted) throw new Error("Message delivery was cancelled");
      if (params.ignore_new === true && !toolContext.hasConflict()) {
        throw new Error("ignore_new 只能在本次回复发生冲突后使用");
      }
      toolContext.onToolStarted();
      toolContext.onReplyAttempt();
      const replyIndex = toolContext.nextReplyIndex();
      const result = await toolContext.host.attemptReply({
        deliveryId: toolContext.deliveryId,
        runtimeAgentId: toolContext.runtimeAgentId,
        conversationId: toolContext.conversationId,
        expectedSequence: toolContext.expectedSequence(),
        text: params.text,
        ignoreNew: params.ignore_new ?? false,
        replyIndex,
      });
      if (result.status === "conflict") {
        toolContext.onConflict(result);
        toolContext.onToolCompleted();
        return {
          content: [
            {
              type: "text",
              text: formatReplyConflict(toolContext.conversationType, result.messages),
            },
          ],
          details: result,
          terminate: false,
        };
      }
      toolContext.onPublished(result);
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
