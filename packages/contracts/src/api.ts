import { z } from "zod";

import { conversationSchema } from "./conversation.js";
import { messageSchema } from "./message.js";
import { principalSchema } from "./principal.js";

export const principalResponseSchema = z.strictObject({ principal: principalSchema });
export const principalsResponseSchema = z.strictObject({
  principals: z.array(principalSchema),
});
export const sessionResponseSchema = z.strictObject({
  principal: principalSchema.nullable(),
});
export const conversationResponseSchema = z.strictObject({
  conversation: conversationSchema,
});
export const conversationsResponseSchema = z.strictObject({
  conversations: z.array(conversationSchema),
});
export const messageResponseSchema = z.strictObject({ message: messageSchema });

export const apiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: z.string().min(1),
    message: z.string().min(1),
  }),
});
