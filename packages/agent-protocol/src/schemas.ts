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

export const agentSessionSchema = z.strictObject({
  id: nonEmptyString,
  agentId: agentIdSchema,
  createdAt: isoDateTime,
});

export const createAgentSessionInputSchema = z.strictObject({
  agentId: agentIdSchema,
});

export const deleteAgentSessionInputSchema = z.strictObject({
  agentId: agentIdSchema,
  sessionId: nonEmptyString,
});

export const sendAgentMessageInputSchema = z.strictObject({
  agentId: agentIdSchema,
  sessionId: nonEmptyString,
  content: z.string().refine((content) => content.trim().length > 0, {
    message: "Message content must not be empty",
  }),
});

export const agentReplySchema = z.strictObject({
  content: z.string(),
});

export const agentRuntimeErrorCodeSchema = z.enum([
  "AGENT_ALREADY_EXISTS",
  "AGENT_DISABLED",
  "AGENT_NOT_FOUND",
  "MODEL_NOT_FOUND",
  "MODEL_REQUIRED",
  "PROVIDER_ERROR",
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

export const runtimeAgentListSchema = z.array(runtimeAgentDefinitionSchema);

export type AgentModel = z.infer<typeof agentModelSchema>;
export type RuntimeAgentDefinition = z.infer<typeof runtimeAgentDefinitionSchema>;
export type CreateAgentInput = z.infer<typeof createAgentInputSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentInputSchema>;
export type AgentSession = z.infer<typeof agentSessionSchema>;
export type CreateAgentSessionInput = z.infer<typeof createAgentSessionInputSchema>;
export type DeleteAgentSessionInput = z.infer<typeof deleteAgentSessionInputSchema>;
export type SendAgentMessageInput = z.infer<typeof sendAgentMessageInputSchema>;
export type AgentReply = z.infer<typeof agentReplySchema>;
export type AgentRuntimeError = z.infer<typeof agentRuntimeErrorSchema>;
export type AgentRuntimeErrorCode = z.infer<typeof agentRuntimeErrorCodeSchema>;

export interface AgentRuntime {
  createAgent(input: CreateAgentInput): Promise<RuntimeAgentDefinition>;
  listAgents(): Promise<RuntimeAgentDefinition[]>;
  getAgent(id: string): Promise<RuntimeAgentDefinition>;
  updateAgent(id: string, input: UpdateAgentInput): Promise<RuntimeAgentDefinition>;
  deleteAgent(id: string): Promise<void>;
  createSession(input: CreateAgentSessionInput): Promise<AgentSession>;
  listSessions(agentId: string): Promise<AgentSession[]>;
  deleteSession(input: DeleteAgentSessionInput): Promise<void>;
  sendMessage(input: SendAgentMessageInput): Promise<AgentReply>;
  close(): Promise<void>;
}
