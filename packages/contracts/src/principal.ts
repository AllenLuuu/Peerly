import { z } from "zod";

export const principalIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);

const principalBaseShape = {
  id: principalIdSchema,
  displayName: z.string().trim().min(1).max(80),
  createdAt: z.string().datetime({ offset: true }),
};

export const humanPrincipalSchema = z.strictObject({
  ...principalBaseShape,
  type: z.literal("human"),
  role: z.enum(["admin", "member"]),
  status: z.enum(["active", "disabled"]),
});

export const agentPrincipalSchema = z.strictObject({
  ...principalBaseShape,
  type: z.literal("agent"),
  runtimeAgentId: z.string().trim().min(1).max(128),
  status: z.enum(["active", "disabled", "error"]),
});

export const principalSchema = z.discriminatedUnion("type", [
  humanPrincipalSchema,
  agentPrincipalSchema,
]);

export const createHumanInputSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(80),
});

export const createAgentPrincipalInputSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(80),
  instructions: z.string().trim().min(1).max(20_000),
});

export const selectDevSessionInputSchema = z.strictObject({
  principalId: principalIdSchema,
});

export type HumanPrincipal = z.infer<typeof humanPrincipalSchema>;
export type AgentPrincipal = z.infer<typeof agentPrincipalSchema>;
export type Principal = z.infer<typeof principalSchema>;
export type CreateHumanInput = z.infer<typeof createHumanInputSchema>;
export type CreateAgentPrincipalInput = z.infer<typeof createAgentPrincipalInputSchema>;
export type SelectDevSessionInput = z.infer<typeof selectDevSessionInputSchema>;
