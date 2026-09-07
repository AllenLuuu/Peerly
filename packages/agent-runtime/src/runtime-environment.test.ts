import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createAgentRuntimeFromEnvironment } from "./index.js";

const temporaryDirectories: string[] = [];

async function makeDataDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "peerly-runtime-environment-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Agent Runtime environment configuration", () => {
  it("uses an OpenAI-compatible model as the default Agent model", async () => {
    const dataDirectory = await makeDataDirectory();
    const runtime = await createAgentRuntimeFromEnvironment({
      env: {
        PEERLY_AGENT_DATA_DIR: dataDirectory,
        PEERLY_MODEL_PROVIDER: "openai-compatible",
        PEERLY_MODEL_ID: "custom-chat-model",
        OPENAI_BASE_URL: "https://models.example.test/v1",
        OPENAI_API_KEY: "test-key",
      },
    });

    const agent = await runtime.createAgent({
      id: "assistant",
      name: "Assistant",
      instructions: "Help the user.",
    });

    expect(agent.model).toEqual({
      provider: "openai-compatible",
      modelId: "custom-chat-model",
    });
    await runtime.close();
  });

  it.each([
    [
      "PEERLY_MODEL_ID",
      { OPENAI_BASE_URL: "https://models.example.test/v1", OPENAI_API_KEY: "key" },
    ],
    ["OPENAI_BASE_URL", { PEERLY_MODEL_ID: "model", OPENAI_API_KEY: "key" }],
    [
      "OPENAI_API_KEY",
      { PEERLY_MODEL_ID: "model", OPENAI_BASE_URL: "https://models.example.test/v1" },
    ],
  ])("rejects OpenAI-compatible setup without %s", async (_missing, configured) => {
    await expect(
      createAgentRuntimeFromEnvironment({
        env: {
          PEERLY_MODEL_PROVIDER: "openai-compatible",
          ...configured,
        },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects unsupported OpenAI-compatible API modes", async () => {
    await expect(
      createAgentRuntimeFromEnvironment({
        env: {
          PEERLY_MODEL_PROVIDER: "openai-compatible",
          PEERLY_MODEL_ID: "model",
          OPENAI_BASE_URL: "https://models.example.test/v1",
          OPENAI_API_KEY: "key",
          PEERLY_OPENAI_API: "legacy",
        },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
