import { z } from "zod";

import { principalIdSchema } from "./principal.js";

export const conversationIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);

export const directConversationSchema = z.strictObject({
  id: conversationIdSchema,
  type: z.literal("direct"),
  participantIds: z.array(principalIdSchema).length(2),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const conversationSchema = directConversationSchema;

export const createDirectConversationInputSchema = z.strictObject({
  participantId: principalIdSchema,
});

export type Conversation = z.infer<typeof conversationSchema>;
export type CreateDirectConversationInput = z.infer<typeof createDirectConversationInputSchema>;
