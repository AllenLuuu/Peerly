import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);
const isoDateTime = z.string().datetime({ offset: true });
export const agentIdSchema = nonEmptyString.regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);

export const agentModelSchema = z.strictObject({
  provider: nonEmptyString,
  modelId: nonEmptyString,
});

export const runtimeAgentDefinitionSchema = z.strictObject({
  id: agentIdSchema,
  name: nonEmptyString,
  instructions: nonEmptyString,
  model: agentModelSchema,
  enabled: z.boolean(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

export const createAgentInputSchema = z.strictObject({
  id: agentIdSchema.optional(),
  name: nonEmptyString,
  instructions: nonEmptyString,
  model: agentModelSchema.optional(),
  enabled: z.boolean().optional(),
});

export const updateAgentInputSchema = z
  .strictObject({
    name: nonEmptyString.optional(),
    instructions: nonEmptyString.optional(),
    model: agentModelSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: "At least one change is required",
  });

export const runtimeMessageSchema = z.strictObject({
  id: nonEmptyString,
  sender: z.strictObject({
    id: nonEmptyString,
    type: z.enum(["human", "agent"]),
    name: nonEmptyString,
  }),
  createdAt: isoDateTime,
  content: z.strictObject({
    type: z.literal("text"),
    text: z.string().refine((text) => text.trim().length > 0, {
      message: "Message content must not be empty",
    }),
  }),
});

export const deliverAgentMessageInputSchema = z.strictObject({
  deliveryId: nonEmptyString,
  agentId: agentIdSchema,
  conversation: z.strictObject({
    id: nonEmptyString,
    type: z.literal("direct"),
  }),
  messages: z.array(runtimeMessageSchema).min(1),
});

export const agentRuntimeErrorCodeSchema = z.enum([
  "AGENT_ALREADY_EXISTS",
  "AGENT_DISABLED",
  "AGENT_NOT_FOUND",
  "MODEL_NOT_FOUND",
  "MODEL_REQUIRED",
  "PROVIDER_ERROR",
  "REPLY_REQUIRED",
  "RUNTIME_CLOSED",
  "SESSION_NOT_FOUND",
  "VALIDATION_ERROR",
  "INTERNAL_ERROR",
]);

export const agentRuntimeErrorSchema = z.strictObject({
  code: agentRuntimeErrorCodeSchema,
  message: nonEmptyString,
  details: z.record(z.string(), z.unknown()).optional(),
});

const agentRuntimeEventBaseSchema = z.strictObject({
  timestamp: isoDateTime,
});

export const runQueuedEventSchema = agentRuntimeEventBaseSchema.extend({
  type: z.literal("run_queued"),
});

export const runStartedEventSchema = agentRuntimeEventBaseSchema.extend({
  type: z.literal("run_started"),
});

export const thinkingDeltaEventSchema = agentRuntimeEventBaseSchema.extend({
  type: z.literal("thinking_delta"),
  delta: z.string().min(1),
});

export const toolStartedEventSchema = agentRuntimeEventBaseSchema.extend({
  type: z.literal("tool_started"),
  toolName: nonEmptyString,
});

export const toolCompletedEventSchema = agentRuntimeEventBaseSchema.extend({
  type: z.literal("tool_completed"),
  toolName: nonEmptyString,
});

export const replyPublishedEventSchema = agentRuntimeEventBaseSchema.extend({
  type: z.literal("reply_published"),
  text: nonEmptyString,
  messageId: nonEmptyString,
  createdAt: isoDateTime,
});

export const runCompletedEventSchema = agentRuntimeEventBaseSchema.extend({
  type: z.literal("run_completed"),
  replyCount: z.number().int().nonnegative(),
});

export const runCancelledEventSchema = agentRuntimeEventBaseSchema.extend({
  type: z.literal("run_cancelled"),
});

export const runFailedEventSchema = agentRuntimeEventBaseSchema.extend({
  type: z.literal("run_failed"),
  error: agentRuntimeErrorSchema,
});

export const agentRuntimeEventSchema = z.discriminatedUnion("type", [
  runQueuedEventSchema,
  runStartedEventSchema,
  thinkingDeltaEventSchema,
  toolStartedEventSchema,
  toolCompletedEventSchema,
  replyPublishedEventSchema,
  runCompletedEventSchema,
  runCancelledEventSchema,
  runFailedEventSchema,
]);

export const runtimeAgentListSchema = z.array(runtimeAgentDefinitionSchema);

export type AgentModel = z.infer<typeof agentModelSchema>;
export type RuntimeAgentDefinition = z.infer<typeof runtimeAgentDefinitionSchema>;
export type CreateAgentInput = z.infer<typeof createAgentInputSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentInputSchema>;
export type RuntimeMessage = z.infer<typeof runtimeMessageSchema>;
export type DeliverAgentMessageInput = z.infer<typeof deliverAgentMessageInputSchema>;
export type AgentRuntimeError = z.infer<typeof agentRuntimeErrorSchema>;
export type AgentRuntimeErrorCode = z.infer<typeof agentRuntimeErrorCodeSchema>;
export type AgentRuntimeEvent = z.infer<typeof agentRuntimeEventSchema>;
export type AgentRuntimeEventStream = AsyncIterable<AgentRuntimeEvent>;

export interface DeliverMessageOptions {
  signal?: AbortSignal;
}

export interface PublishAgentReplyInput {
  deliveryId: string;
  runtimeAgentId: string;
  conversationId: string;
  text: string;
  replyIndex: number;
}

export interface PublishedAgentReply {
  messageId: string;
  createdAt: string;
}

export interface AgentHost {
  publishReply(input: PublishAgentReplyInput): Promise<PublishedAgentReply>;
}

export interface AgentRuntime {
  createAgent(input: CreateAgentInput): Promise<RuntimeAgentDefinition>;
  listAgents(): Promise<RuntimeAgentDefinition[]>;
  getAgent(id: string): Promise<RuntimeAgentDefinition>;
  updateAgent(id: string, input: UpdateAgentInput): Promise<RuntimeAgentDefinition>;
  deleteAgent(id: string): Promise<void>;
  deliverMessage(
    input: DeliverAgentMessageInput,
    options?: DeliverMessageOptions,
  ): AgentRuntimeEventStream;
  close(): Promise<void>;
}
