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

export const groupConversationSchema = z.strictObject({
  id: conversationIdSchema,
  type: z.literal("group"),
  name: z.string().trim().min(1).max(128),
  participantIds: uniquePrincipalIds(2),
  createdBy: principalIdSchema,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const conversationSchema = z.discriminatedUnion("type", [
  directConversationSchema,
  groupConversationSchema,
]);

export const createDirectConversationInputSchema = z.strictObject({
  participantId: principalIdSchema,
});

export const createGroupConversationInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(128),
  participantIds: uniquePrincipalIds(1),
});

export const updateGroupParticipantsInputSchema = z.strictObject({
  participantIds: uniquePrincipalIds(2),
});

export type Conversation = z.infer<typeof conversationSchema>;
export type CreateDirectConversationInput = z.infer<typeof createDirectConversationInputSchema>;
export type GroupConversation = z.infer<typeof groupConversationSchema>;
export type CreateGroupConversationInput = z.infer<typeof createGroupConversationInputSchema>;
export type UpdateGroupParticipantsInput = z.infer<typeof updateGroupParticipantsInputSchema>;

function uniquePrincipalIds(minimum: number) {
  return z
    .array(principalIdSchema)
    .min(minimum)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, "Principal IDs must be unique");
}
