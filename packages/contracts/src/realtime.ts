import { z } from "zod";

import { conversationSchema } from "./conversation.js";
import { messageSchema } from "./message.js";

export const peerlyRealtimeEventName = "peerly.event" as const;

export const conversationCreatedEventSchema = z.strictObject({
  type: z.literal("conversation.created"),
  conversation: conversationSchema,
});

export const messageCreatedEventSchema = z.strictObject({
  type: z.literal("message.created"),
  message: messageSchema,
});

export const peerlyRealtimeEventSchema = z.discriminatedUnion("type", [
  conversationCreatedEventSchema,
  messageCreatedEventSchema,
]);

export type PeerlyRealtimeEvent = z.infer<typeof peerlyRealtimeEventSchema>;
