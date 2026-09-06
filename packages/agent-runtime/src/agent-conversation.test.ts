import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  contentText,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type Models,
} from "@earendil-works/pi-ai";
import type { AgentRuntime } from "@peerly/agent-protocol";
import { afterEach, describe, expect, it } from "vitest";

import { createAgentRuntime } from "./index.js";

const temporaryDirectories: string[] = [];
const runtimes: AgentRuntime[] = [];

async function makeDataDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "peerly-agent-conversation-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function makeRuntime(dataDirectory: string, models: Models): Promise<AgentRuntime> {
  const runtime = await createAgentRuntime({ dataDirectory, models });
  runtimes.push(runtime);
  return runtime;
}

function makeFauxModels(modelIds = ["chat-model"]) {
  const faux = fauxProvider({
    provider: "faux",
    models: modelIds.map((id) => ({ id })),
  });
  const models = createModels();
  models.setProvider(faux.provider);
  return { faux, models };
}

async function createAgent(
  runtime: AgentRuntime,
  overrides: {
    id?: string;
    instructions?: string;
    modelId?: string;
    enabled?: boolean;
  } = {},
) {
  return runtime.createAgent({
    id: overrides.id ?? "assistant",
    name: "Assistant",
    instructions: overrides.instructions ?? "Help the user.",
    model: { provider: "faux", modelId: overrides.modelId ?? "chat-model" },
    enabled: overrides.enabled ?? true,
  });
}

function messageText(message: {
  role: string;
  content: Parameters<typeof contentText>[0];
}): string {
  return `${message.role}:${contentText(message.content)}`;
}

afterEach(async () => {
  await Promise.all(
    runtimes.splice(0).map(async (runtime) => {
      await runtime.close?.();
    }),
  );
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe("Agent Runtime conversations", () => {
  it("creates, lists, and deletes Pi sessions", async () => {
    const dataDirectory = await makeDataDirectory();
    const { models } = makeFauxModels();
    const runtime = await makeRuntime(dataDirectory, models);
    await createAgent(runtime);

    const session = await runtime.createSession({ agentId: "assistant" });

    expect(session).toMatchObject({ agentId: "assistant" });
    expect(session.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(Number.isNaN(Date.parse(session.createdAt))).toBe(false);
    await expect(runtime.listSessions("assistant")).resolves.toEqual([session]);

    await runtime.deleteSession({ agentId: "assistant", sessionId: session.id });

    await expect(runtime.listSessions("assistant")).resolves.toEqual([]);
    await expect(
      runtime.sendMessage({
        agentId: "assistant",
        sessionId: session.id,
        content: "Hello",
      }),
    ).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
  });

  it("keeps multi-turn context in one session and isolates different sessions", async () => {
    const dataDirectory = await makeDataDirectory();
    const { faux, models } = makeFauxModels();
    const observedTranscripts: string[][] = [];
    faux.setResponses([
      fauxAssistantMessage("I will remember that."),
      (context) => {
        observedTranscripts.push(context.messages.map(messageText));
        return fauxAssistantMessage("Your project is Peerly.");
      },
      (context) => {
        observedTranscripts.push(context.messages.map(messageText));
        return fauxAssistantMessage("I do not know yet.");
      },
    ]);
    const runtime = await makeRuntime(dataDirectory, models);
    await createAgent(runtime);
    const firstSession = await runtime.createSession({ agentId: "assistant" });
    const secondSession = await runtime.createSession({ agentId: "assistant" });

    await runtime.sendMessage({
      agentId: "assistant",
      sessionId: firstSession.id,
      content: "My project is Peerly.",
    });
    await expect(
      runtime.sendMessage({
        agentId: "assistant",
        sessionId: firstSession.id,
        content: "What is my project?",
      }),
    ).resolves.toEqual({ content: "Your project is Peerly." });
    await runtime.sendMessage({
      agentId: "assistant",
      sessionId: secondSession.id,
      content: "What is my project?",
    });

    expect(observedTranscripts[0]).toEqual([
      "user:My project is Peerly.",
      "assistant:I will remember that.",
      "user:What is my project?",
    ]);
    expect(observedTranscripts[1]).toEqual(["user:What is my project?"]);
  });

  it("restores conversation context after the Runtime restarts", async () => {
    const dataDirectory = await makeDataDirectory();
    const firstFaux = makeFauxModels();
    firstFaux.faux.setResponses([fauxAssistantMessage("Saved.")]);
    const firstRuntime = await makeRuntime(dataDirectory, firstFaux.models);
    await createAgent(firstRuntime);
    const session = await firstRuntime.createSession({ agentId: "assistant" });
    await firstRuntime.sendMessage({
      agentId: "assistant",
      sessionId: session.id,
      content: "Remember Peerly.",
    });
    await firstRuntime.close();
    runtimes.splice(runtimes.indexOf(firstRuntime), 1);

    const secondFaux = makeFauxModels();
    let restoredTranscript: string[] = [];
    secondFaux.faux.setResponses([
      (context) => {
        restoredTranscript = context.messages.map(messageText);
        return fauxAssistantMessage("I remember Peerly.");
      },
    ]);
    const restartedRuntime = await makeRuntime(dataDirectory, secondFaux.models);

    await expect(
      restartedRuntime.sendMessage({
        agentId: "assistant",
        sessionId: session.id,
        content: "What should you remember?",
      }),
    ).resolves.toEqual({ content: "I remember Peerly." });
    expect(restoredTranscript).toEqual([
      "user:Remember Peerly.",
      "assistant:Saved.",
      "user:What should you remember?",
    ]);
  });

  it("uses the latest Agent configuration for the next message", async () => {
    const dataDirectory = await makeDataDirectory();
    const { faux, models } = makeFauxModels(["model-v1", "model-v2"]);
    const observedConfigurations: { modelId: string; systemPrompt: string | undefined }[] = [];
    faux.setResponses([
      (context, _options, _state, model) => {
        observedConfigurations.push({ modelId: model.id, systemPrompt: context.systemPrompt });
        return fauxAssistantMessage("First reply");
      },
      (context, _options, _state, model) => {
        observedConfigurations.push({ modelId: model.id, systemPrompt: context.systemPrompt });
        return fauxAssistantMessage("Second reply");
      },
    ]);
    const runtime = await makeRuntime(dataDirectory, models);
    await createAgent(runtime, { instructions: "Version one.", modelId: "model-v1" });
    const session = await runtime.createSession({ agentId: "assistant" });

    await runtime.sendMessage({ agentId: "assistant", sessionId: session.id, content: "One" });
    await runtime.updateAgent("assistant", {
      instructions: "Version two.",
      model: { provider: "faux", modelId: "model-v2" },
    });
    await runtime.sendMessage({ agentId: "assistant", sessionId: session.id, content: "Two" });

    expect(observedConfigurations).toEqual([
      { modelId: "model-v1", systemPrompt: "Version one." },
      { modelId: "model-v2", systemPrompt: "Version two." },
    ]);
  });

  it("rejects sessions for the wrong, disabled, or deleted Agent", async () => {
    const dataDirectory = await makeDataDirectory();
    const { faux, models } = makeFauxModels();
    faux.setResponses([fauxAssistantMessage("Should not be used")]);
    const runtime = await makeRuntime(dataDirectory, models);
    await createAgent(runtime, { id: "first" });
    await createAgent(runtime, { id: "second" });
    await createAgent(runtime, { id: "disabled", enabled: false });
    const session = await runtime.createSession({ agentId: "first" });

    await expect(runtime.createSession({ agentId: "disabled" })).rejects.toMatchObject({
      code: "AGENT_DISABLED",
    });
    await expect(
      runtime.sendMessage({ agentId: "second", sessionId: session.id, content: "Hello" }),
    ).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });

    await runtime.deleteAgent("first");
    await expect(
      runtime.sendMessage({ agentId: "first", sessionId: session.id, content: "Hello" }),
    ).rejects.toMatchObject({ code: "AGENT_NOT_FOUND" });
  });

  it("reports unknown models and provider failures as stable Runtime errors", async () => {
    const dataDirectory = await makeDataDirectory();
    const { faux, models } = makeFauxModels();
    faux.setResponses([
      fauxAssistantMessage("", { stopReason: "error", errorMessage: "Provider failed" }),
    ]);
    const runtime = await makeRuntime(dataDirectory, models);
    await createAgent(runtime, { id: "unknown-model", modelId: "missing-model" });
    await createAgent(runtime, { id: "broken-provider" });
    const unknownModelSession = await runtime.createSession({ agentId: "unknown-model" });
    const brokenProviderSession = await runtime.createSession({ agentId: "broken-provider" });

    await expect(
      runtime.sendMessage({
        agentId: "unknown-model",
        sessionId: unknownModelSession.id,
        content: "Hello",
      }),
    ).rejects.toMatchObject({ code: "MODEL_NOT_FOUND" });
    await expect(
      runtime.sendMessage({
        agentId: "broken-provider",
        sessionId: brokenProviderSession.id,
        content: "Hello",
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR", message: "Provider failed" });
  });
});
