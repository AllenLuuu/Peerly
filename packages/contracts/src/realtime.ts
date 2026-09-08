import { z } from "zod";

import { conversationSchema } from "./conversation.js";
import { messageSchema } from "./message.js";

export const peerlyRealtimeEventName = "peerly.event" as const;

export const conversationCreatedEventSchema = z.strictObject({
  type: z.literal("conversation.created"),
  conversation: conversationSchema,
});

export const conversationUpdatedEventSchema = z.strictObject({
  type: z.literal("conversation.updated"),
  conversation: conversationSchema,
});

export const messageCreatedEventSchema = z.strictObject({
  type: z.literal("message.created"),
  message: messageSchema,
});

const timestamp = z.string().datetime({ offset: true });
const agentActivitySchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("run_queued"), timestamp }),
  z.strictObject({ type: z.literal("run_started"), timestamp }),
  z.strictObject({ type: z.literal("thinking_delta"), timestamp, delta: z.string().min(1) }),
  z.strictObject({ type: z.literal("tool_started"), timestamp, toolName: z.string().min(1) }),
  z.strictObject({ type: z.literal("tool_completed"), timestamp, toolName: z.string().min(1) }),
  z.strictObject({
    type: z.literal("reply_published"),
    timestamp,
    text: z.string().min(1),
    messageId: z.string().min(1),
    sequence: z.number().int().positive(),
    createdAt: timestamp,
  }),
  z.strictObject({
    type: z.literal("run_completed"),
    timestamp,
    replyCount: z.number().int().nonnegative(),
  }),
  z.strictObject({ type: z.literal("run_cancelled"), timestamp }),
  z.strictObject({
    type: z.literal("delivery_skipped"),
    timestamp,
    reason: z.literal("already_processed"),
  }),
  z.strictObject({
    type: z.literal("run_failed"),
    timestamp,
    error: z.strictObject({ code: z.string().min(1), message: z.string().min(1) }),
  }),
]);

export const agentActivityEventSchema = z.strictObject({
  type: z.literal("agent.activity"),
  deliveryId: z.string().min(1),
  conversationId: z.string().min(1),
  agentId: z.string().min(1),
  activity: agentActivitySchema,
});

export const peerlyRealtimeEventSchema = z.discriminatedUnion("type", [
  conversationCreatedEventSchema,
  conversationUpdatedEventSchema,
  messageCreatedEventSchema,
  agentActivityEventSchema,
]);

export type PeerlyRealtimeEvent = z.infer<typeof peerlyRealtimeEventSchema>;
export type AgentActivity = z.infer<typeof agentActivitySchema>;
export type AgentActivityEvent = z.infer<typeof agentActivityEventSchema>;
