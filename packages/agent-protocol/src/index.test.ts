import { describe, expect, it } from "vitest";

import {
  agentRuntimeErrorSchema,
  createAgentInputSchema,
  runtimeAgentDefinitionSchema,
  runtimeAgentListSchema,
  updateAgentInputSchema,
} from "./index.js";

const agentDefinition = {
  id: "agent_researcher",
  name: "Researcher",
  instructions: "Answer with verifiable facts.",
  model: { provider: "anthropic", modelId: "claude-sonnet" },
  enabled: true,
  createdAt: "2026-09-06T10:00:00.000Z",
  updatedAt: "2026-09-06T10:00:00.000Z",
};

describe("runtimeAgentDefinitionSchema", () => {
  it("accepts a complete agent definition", () => {
    expect(runtimeAgentDefinitionSchema.parse(agentDefinition)).toEqual(agentDefinition);
  });

  it.each([
    ["empty name", { ...agentDefinition, name: "" }],
    ["empty instructions", { ...agentDefinition, instructions: "" }],
    ["empty provider", { ...agentDefinition, model: { ...agentDefinition.model, provider: "" } }],
    ["empty model id", { ...agentDefinition, model: { ...agentDefinition.model, modelId: "" } }],
    ["invalid timestamp", { ...agentDefinition, createdAt: "yesterday" }],
    ["unsafe id", { ...agentDefinition, id: "../agent" }],
  ])("rejects %s", (_case, value) => {
    expect(runtimeAgentDefinitionSchema.safeParse(value).success).toBe(false);
  });
});

describe("agent inputs", () => {
  it("allows create input to use the runtime default model", () => {
    const input = {
      name: "Researcher",
      instructions: "Answer accurately.",
    };

    expect(createAgentInputSchema.parse(input)).toEqual(input);
  });

  it("requires update input to contain at least one change", () => {
    expect(updateAgentInputSchema.safeParse({}).success).toBe(false);
    expect(updateAgentInputSchema.parse({ enabled: false })).toEqual({ enabled: false });
  });
});

describe("shared response schemas", () => {
  it("accepts Agent definition lists", () => {
    expect(runtimeAgentListSchema.parse([agentDefinition])).toEqual([agentDefinition]);
  });

  it("limits errors to stable codes", () => {
    expect(agentRuntimeErrorSchema.parse({ code: "AGENT_NOT_FOUND", message: "Missing" })).toEqual({
      code: "AGENT_NOT_FOUND",
      message: "Missing",
    });
    expect(
      agentRuntimeErrorSchema.safeParse({ code: "SOMETHING_RANDOM", message: "No" }).success,
    ).toBe(false);
  });
});

describe("agentRuntimeErrorSchema", () => {
  it("accepts a stable error envelope", () => {
    const error = {
      code: "VALIDATION_ERROR",
      message: "Agent definition is invalid",
      details: { field: "name" },
    };

    expect(agentRuntimeErrorSchema.parse(error)).toEqual(error);
  });
});
