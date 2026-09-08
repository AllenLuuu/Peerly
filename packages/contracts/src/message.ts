import { z } from "zod";

import { conversationIdSchema } from "./conversation.js";
import { principalIdSchema } from "./principal.js";

export const messageIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);

export const mentionSchema = z.strictObject({
  principalId: principalIdSchema,
  displayName: z.string().trim().min(1).max(128),
});

const mentionsSchema = z
  .array(mentionSchema)
  .max(50)
  .refine(
    (mentions) => new Set(mentions.map((mention) => mention.principalId)).size === mentions.length,
    "Mention targets must be unique",
  );

export const textMessageContentSchema = z.strictObject({
  type: z.literal("text"),
  text: z
    .string()
    .max(20_000)
    .refine((text) => text.trim().length > 0, "Message text must not be empty"),
  mentions: mentionsSchema.optional(),
});

export const messageContentSchema = z.discriminatedUnion("type", [textMessageContentSchema]);

export const messageSchema = z.strictObject({
  id: messageIdSchema,
  conversationId: conversationIdSchema,
  senderId: principalIdSchema,
  clientMessageId: z.string().trim().min(1).max(128),
  sequence: z.number().int().positive(),
  content: messageContentSchema,
  createdAt: z.string().datetime({ offset: true }),
});

export const sendMessageInputSchema = z.strictObject({
  clientMessageId: z.string().trim().min(1).max(128),
  content: messageContentSchema,
});

export const listMessagesQuerySchema = z.strictObject({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const messagePageSchema = z.strictObject({
  items: z.array(messageSchema),
  nextCursor: z.number().int().positive().nullable(),
});

export type MessageContent = z.infer<typeof messageContentSchema>;
export type Mention = z.infer<typeof mentionSchema>;
export type Message = z.infer<typeof messageSchema>;
export type SendMessageInput = z.infer<typeof sendMessageInputSchema>;
export type MessagePage = z.infer<typeof messagePageSchema>;
