import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);
const isoDateTime = z.string().datetime({ offset: true });

export const agentModelSchema = z.strictObject({
  provider: nonEmptyString,
  modelId: nonEmptyString,
});

export const agentDefinitionSchema = z.strictObject({
  id: nonEmptyString,
  name: nonEmptyString,
  instructions: nonEmptyString,
  model: agentModelSchema,
  enabled: z.boolean(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

export const createAgentInputSchema = z.strictObject({
  id: nonEmptyString.optional(),
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

export const textMessageContentSchema = z.strictObject({
  type: z.literal("text"),
  text: nonEmptyString,
});

export const runtimeMessageSchema = z.strictObject({
  id: nonEmptyString,
  senderId: nonEmptyString,
  content: textMessageContentSchema,
  createdAt: isoDateTime,
});

export const createRunInputSchema = z.strictObject({
  requestId: nonEmptyString,
  sessionKey: nonEmptyString,
  message: runtimeMessageSchema,
  context: z.array(runtimeMessageSchema).optional(),
});

export const agentRunStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "cancelled",
  "failed",
]);

export const agentRuntimeErrorSchema = z.strictObject({
  code: nonEmptyString,
  message: nonEmptyString,
  details: z.record(z.string(), z.unknown()).optional(),
});

export const acceptedRunSchema = z.strictObject({
  runId: nonEmptyString,
  status: z.literal("queued"),
});

export const agentRunSchema = z.strictObject({
  id: nonEmptyString,
  agentId: nonEmptyString,
  requestId: nonEmptyString,
  sessionKey: nonEmptyString,
  status: agentRunStatusSchema,
  output: z.string().optional(),
  error: agentRuntimeErrorSchema.optional(),
  createdAt: isoDateTime,
  startedAt: isoDateTime.optional(),
  completedAt: isoDateTime.optional(),
});

const eventBase = {
  sequence: z.number().int().nonnegative(),
  runId: nonEmptyString,
  occurredAt: isoDateTime,
};

const runQueuedSchema = z.strictObject({
  ...eventBase,
  type: z.literal("run.queued"),
});

const runStartedSchema = z.strictObject({
  ...eventBase,
  type: z.literal("run.started"),
});

const outputDeltaSchema = z.strictObject({
  ...eventBase,
  type: z.literal("run.output.delta"),
  delta: z.string(),
});

const toolStartedSchema = z.strictObject({
  ...eventBase,
  type: z.literal("run.tool.started"),
  toolCallId: nonEmptyString,
  toolName: nonEmptyString,
});

const toolCompletedSchema = z.strictObject({
  ...eventBase,
  type: z.literal("run.tool.completed"),
  toolCallId: nonEmptyString,
  toolName: nonEmptyString,
  isError: z.boolean(),
});

const runCompletedSchema = z.strictObject({
  ...eventBase,
  type: z.literal("run.completed"),
  output: z.string(),
});

const runCancelledSchema = z.strictObject({
  ...eventBase,
  type: z.literal("run.cancelled"),
});

const runFailedSchema = z.strictObject({
  ...eventBase,
  type: z.literal("run.failed"),
  error: agentRuntimeErrorSchema,
});

export const agentRuntimeEventSchema = z.discriminatedUnion("type", [
  runQueuedSchema,
  runStartedSchema,
  outputDeltaSchema,
  toolStartedSchema,
  toolCompletedSchema,
  runCompletedSchema,
  runCancelledSchema,
  runFailedSchema,
]);

export type AgentModel = z.infer<typeof agentModelSchema>;
export type AgentDefinition = z.infer<typeof agentDefinitionSchema>;
export type CreateAgentInput = z.infer<typeof createAgentInputSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentInputSchema>;
export type TextMessageContent = z.infer<typeof textMessageContentSchema>;
export type RuntimeMessage = z.infer<typeof runtimeMessageSchema>;
export type CreateRunInput = z.infer<typeof createRunInputSchema>;
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;
export type AgentRuntimeError = z.infer<typeof agentRuntimeErrorSchema>;
export type AcceptedRun = z.infer<typeof acceptedRunSchema>;
export type AgentRun = z.infer<typeof agentRunSchema>;
export type AgentRuntimeEvent = z.infer<typeof agentRuntimeEventSchema>;
