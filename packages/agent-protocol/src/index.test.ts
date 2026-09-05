import { describe, expect, it } from "vitest";

import {
  acceptedRunSchema,
  agentDefinitionSchema,
  agentRunSchema,
  agentRuntimeErrorSchema,
  agentRuntimeEventSchema,
  createAgentInputSchema,
  createRunInputSchema,
  runtimeRoutes,
  runtimeMessageSchema,
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

describe("agentDefinitionSchema", () => {
  it("accepts a complete agent definition", () => {
    expect(agentDefinitionSchema.parse(agentDefinition)).toEqual(agentDefinition);
  });

  it.each([
    ["empty name", { ...agentDefinition, name: "" }],
    ["empty instructions", { ...agentDefinition, instructions: "" }],
    ["empty provider", { ...agentDefinition, model: { ...agentDefinition.model, provider: "" } }],
    ["empty model id", { ...agentDefinition, model: { ...agentDefinition.model, modelId: "" } }],
    ["invalid timestamp", { ...agentDefinition, createdAt: "yesterday" }],
  ])("rejects %s", (_case, value) => {
    expect(agentDefinitionSchema.safeParse(value).success).toBe(false);
  });
});

describe("runtimeMessageSchema", () => {
  it("accepts a text message", () => {
    const message = {
      id: "message_1",
      senderId: "human_alice",
      content: { type: "text", text: "Hello" },
      createdAt: "2026-09-06T10:00:00.000Z",
    };

    expect(runtimeMessageSchema.parse(message)).toEqual(message);
  });

  it("rejects empty text", () => {
    expect(
      runtimeMessageSchema.safeParse({
        id: "message_1",
        senderId: "human_alice",
        content: { type: "text", text: "" },
        createdAt: "2026-09-06T10:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});

describe("createRunInputSchema", () => {
  const message = {
    id: "message_1",
    senderId: "human_alice",
    content: { type: "text" as const, text: "Hello" },
    createdAt: "2026-09-06T10:00:00.000Z",
  };

  it("accepts optional temporary context", () => {
    const input = {
      requestId: "request_1",
      sessionKey: "conversation_1",
      message,
      context: [
        { ...message, id: "message_0", content: { type: "text" as const, text: "Earlier" } },
      ],
    };

    expect(createRunInputSchema.parse(input)).toEqual(input);
  });

  it.each(["requestId", "sessionKey", "message"])("requires %s", (field) => {
    const input: Record<string, unknown> = {
      requestId: "request_1",
      sessionKey: "conversation_1",
      message,
    };
    delete input[field];

    expect(createRunInputSchema.safeParse(input).success).toBe(false);
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

describe("run schemas", () => {
  it("accepts an acknowledged queued run", () => {
    const accepted = { runId: "run_1", status: "queued" };
    expect(acceptedRunSchema.parse(accepted)).toEqual(accepted);
  });

  it("accepts a completed run", () => {
    const run = {
      id: "run_1",
      agentId: "agent_researcher",
      requestId: "request_1",
      sessionKey: "conversation_1",
      status: "completed",
      output: "Hello",
      createdAt: "2026-09-06T10:00:00.000Z",
      startedAt: "2026-09-06T10:00:01.000Z",
      completedAt: "2026-09-06T10:00:02.000Z",
    };

    expect(agentRunSchema.parse(run)).toEqual(run);
  });
});

describe("runtimeRoutes", () => {
  it("builds versioned resource routes", () => {
    expect(runtimeRoutes.agents).toBe("/v1/agents");
    expect(runtimeRoutes.agent("agent 1")).toBe("/v1/agents/agent%201");
    expect(runtimeRoutes.agentRuns("agent 1")).toBe("/v1/agents/agent%201/runs");
    expect(runtimeRoutes.run("run 1")).toBe("/v1/runs/run%201");
    expect(runtimeRoutes.runEvents("run 1")).toBe("/v1/runs/run%201/events");
    expect(runtimeRoutes.cancelRun("run 1")).toBe("/v1/runs/run%201/cancel");
  });
});

describe("agentRuntimeEventSchema", () => {
  it.each([
    { type: "run.queued", sequence: 0, runId: "run_1", occurredAt: "2026-09-06T10:00:00.000Z" },
    { type: "run.started", sequence: 1, runId: "run_1", occurredAt: "2026-09-06T10:00:01.000Z" },
    {
      type: "run.output.delta",
      sequence: 2,
      runId: "run_1",
      occurredAt: "2026-09-06T10:00:02.000Z",
      delta: "Hello",
    },
    {
      type: "run.tool.started",
      sequence: 3,
      runId: "run_1",
      occurredAt: "2026-09-06T10:00:03.000Z",
      toolCallId: "tool_1",
      toolName: "get_current_time",
    },
    {
      type: "run.tool.completed",
      sequence: 4,
      runId: "run_1",
      occurredAt: "2026-09-06T10:00:04.000Z",
      toolCallId: "tool_1",
      toolName: "get_current_time",
      isError: false,
    },
    {
      type: "run.completed",
      sequence: 5,
      runId: "run_1",
      occurredAt: "2026-09-06T10:00:05.000Z",
      output: "Hello",
    },
    { type: "run.cancelled", sequence: 5, runId: "run_1", occurredAt: "2026-09-06T10:00:05.000Z" },
    {
      type: "run.failed",
      sequence: 5,
      runId: "run_1",
      occurredAt: "2026-09-06T10:00:05.000Z",
      error: { code: "PROVIDER_ERROR", message: "Provider unavailable" },
    },
  ])("accepts $type", (event) => {
    expect(agentRuntimeEventSchema.parse(event)).toEqual(event);
  });

  it("rejects an unknown event", () => {
    expect(agentRuntimeEventSchema.safeParse({ type: "run.unknown" }).success).toBe(false);
  });
});

describe("agentRuntimeErrorSchema", () => {
  it("accepts a stable error envelope", () => {
    const error = {
      code: "INVALID_AGENT",
      message: "Agent definition is invalid",
      details: { field: "name" },
    };

    expect(agentRuntimeErrorSchema.parse(error)).toEqual(error);
  });
});
