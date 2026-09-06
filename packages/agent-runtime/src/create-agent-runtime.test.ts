import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntimeOperationError, createAgentRuntime } from "./index.js";

const temporaryDirectories: string[] = [];

async function makeDataDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "peerly-agent-runtime-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe("Agent Runtime definition management", () => {
  it("creates, lists, and retrieves Agent definitions", async () => {
    const runtime = await createAgentRuntime({ dataDirectory: await makeDataDirectory() });

    const created = await runtime.createAgent({
      id: "researcher",
      name: "Researcher",
      instructions: "Find reliable sources.",
      model: { provider: "faux", modelId: "test-model" },
    });

    expect(created).toMatchObject({
      id: "researcher",
      name: "Researcher",
      instructions: "Find reliable sources.",
      model: { provider: "faux", modelId: "test-model" },
      enabled: true,
    });
    expect(await runtime.getAgent("researcher")).toEqual(created);
    expect(await runtime.listAgents()).toEqual([created]);
  });

  it("uses generated IDs and the configured default model", async () => {
    const runtime = await createAgentRuntime({
      dataDirectory: await makeDataDirectory(),
      defaultModel: { provider: "faux", modelId: "default-model" },
      generateId: () => "agent_generated",
    });

    await expect(
      runtime.createAgent({ name: "Writer", instructions: "Write clearly." }),
    ).resolves.toMatchObject({
      id: "agent_generated",
      model: { provider: "faux", modelId: "default-model" },
    });
  });

  it("rejects invalid definitions, duplicate IDs, and missing model configuration", async () => {
    const runtime = await createAgentRuntime({ dataDirectory: await makeDataDirectory() });

    await expect(
      runtime.createAgent({ name: "Writer", instructions: "Write clearly." }),
    ).rejects.toMatchObject({ code: "MODEL_REQUIRED" });

    await expect(
      runtime.createAgent({
        id: "invalid id",
        name: "Writer",
        instructions: "Write clearly.",
        model: { provider: "faux", modelId: "test-model" },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const input = {
      id: "writer",
      name: "Writer",
      instructions: "Write clearly.",
      model: { provider: "faux", modelId: "test-model" },
    };
    await runtime.createAgent(input);
    await expect(runtime.createAgent(input)).rejects.toMatchObject({
      code: "AGENT_ALREADY_EXISTS",
    });
  });

  it("updates mutable fields while preserving identity and creation time", async () => {
    let now = "2026-09-06T01:00:00.000Z";
    const runtime = await createAgentRuntime({
      dataDirectory: await makeDataDirectory(),
      now: () => now,
    });
    const created = await runtime.createAgent({
      id: "assistant",
      name: "Assistant",
      instructions: "Help the team.",
      model: { provider: "faux", modelId: "v1" },
    });

    now = "2026-09-06T02:00:00.000Z";
    const updated = await runtime.updateAgent("assistant", {
      name: "Team Assistant",
      model: { provider: "faux", modelId: "v2" },
      enabled: false,
    });

    expect(updated).toMatchObject({
      id: "assistant",
      name: "Team Assistant",
      instructions: "Help the team.",
      model: { provider: "faux", modelId: "v2" },
      enabled: false,
      createdAt: created.createdAt,
      updatedAt: now,
    });
  });

  it("deletes definitions without allowing their IDs to be reused", async () => {
    const runtime = await createAgentRuntime({ dataDirectory: await makeDataDirectory() });
    const input = {
      id: "archived-agent",
      name: "Archived Agent",
      instructions: "No longer active.",
      model: { provider: "faux", modelId: "test-model" },
    };
    await runtime.createAgent(input);

    await runtime.deleteAgent(input.id);

    expect(await runtime.listAgents()).toEqual([]);
    await expect(runtime.getAgent(input.id)).rejects.toMatchObject({ code: "AGENT_NOT_FOUND" });
    await expect(runtime.createAgent(input)).rejects.toMatchObject({
      code: "AGENT_ALREADY_EXISTS",
    });
  });

  it("recovers definitions when a new Runtime instance uses the same data directory", async () => {
    const dataDirectory = await makeDataDirectory();
    const firstRuntime = await createAgentRuntime({ dataDirectory });
    const created = await firstRuntime.createAgent({
      id: "persistent-agent",
      name: "Persistent Agent",
      instructions: "Remember my definition.",
      model: { provider: "faux", modelId: "test-model" },
    });

    const restartedRuntime = await createAgentRuntime({ dataDirectory });

    await expect(restartedRuntime.getAgent(created.id)).resolves.toEqual(created);
  });

  it("keeps concurrently requested updates valid", async () => {
    const runtime = await createAgentRuntime({ dataDirectory: await makeDataDirectory() });
    await runtime.createAgent({
      id: "shared-agent",
      name: "Shared Agent",
      instructions: "Initial instructions.",
      model: { provider: "faux", modelId: "test-model" },
    });

    await Promise.all([
      runtime.updateAgent("shared-agent", { name: "Renamed Agent" }),
      runtime.updateAgent("shared-agent", { instructions: "Updated instructions." }),
    ]);

    await expect(runtime.getAgent("shared-agent")).resolves.toMatchObject({
      name: "Renamed Agent",
      instructions: "Updated instructions.",
    });
  });

  it("exposes stable error information without transport-specific fields", async () => {
    const runtime = await createAgentRuntime({ dataDirectory: await makeDataDirectory() });

    await expect(runtime.getAgent("missing")).rejects.toEqual(
      expect.objectContaining<Partial<AgentRuntimeOperationError>>({
        code: "AGENT_NOT_FOUND",
      }),
    );
  });
});
