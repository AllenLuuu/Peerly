import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type Models,
} from "@earendil-works/pi-ai";
import type { AgentRuntime, AgentRuntimeEvent } from "@peerly/agent-protocol";
import { afterEach, describe, expect, it } from "vitest";

import { createAgentRuntime } from "./index.js";

const temporaryDirectories: string[] = [];
const runtimes: AgentRuntime[] = [];

async function makeDataDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "peerly-agent-streaming-"));
  temporaryDirectories.push(directory);
  return directory;
}

function makeFauxModels(options: { tokensPerSecond?: number } = {}) {
  const faux = fauxProvider({
    provider: "faux",
    models: [{ id: "chat-model" }],
    ...(options.tokensPerSecond === undefined ? {} : { tokensPerSecond: options.tokensPerSecond }),
  });
  const models = createModels();
  models.setProvider(faux.provider);
  return { faux, models };
}

async function makeRuntime(dataDirectory: string, models: Models): Promise<AgentRuntime> {
  const runtime = await createAgentRuntime({ dataDirectory, models });
  runtimes.push(runtime);
  return runtime;
}

async function prepareConversation(runtime: AgentRuntime, agentId = "assistant") {
  await runtime.createAgent({
    id: agentId,
    name: "Assistant",
    instructions: "Help the user.",
    model: { provider: "faux", modelId: "chat-model" },
  });
  return runtime.createSession({ agentId });
}

async function collectEvents(
  stream: AsyncIterable<AgentRuntimeEvent>,
): Promise<AgentRuntimeEvent[]> {
  const events: AgentRuntimeEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function withTimeout<T>(promise: Promise<T>, milliseconds = 1_000): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Timed out waiting for concurrent run")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Agent Runtime event streams", () => {
  it("rejects invalid messages before creating a stream", async () => {
    const { models } = makeFauxModels();
    const runtime = await makeRuntime(await makeDataDirectory(), models);

    expect(() =>
      runtime.sendMessage({ agentId: "assistant", sessionId: "session", content: "   " }),
    ).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
  });

  it("streams lifecycle events and text deltas ending with the complete reply", async () => {
    const { faux, models } = makeFauxModels();
    faux.setResponses([fauxAssistantMessage("Hello from Peerly")]);
    const runtime = await makeRuntime(await makeDataDirectory(), models);
    const session = await prepareConversation(runtime);

    const events = await collectEvents(
      runtime.sendMessage({
        agentId: "assistant",
        sessionId: session.id,
        content: "Hello",
      }),
    );

    expect(events[0]).toMatchObject({ type: "run_queued" });
    expect(events[1]).toMatchObject({ type: "run_started" });
    expect(events.at(-1)).toEqual(
      expect.objectContaining({ type: "run_completed", content: "Hello from Peerly" }),
    );
    expect(
      events
        .filter(
          (event): event is Extract<AgentRuntimeEvent, { type: "output_delta" }> =>
            event.type === "output_delta",
        )
        .map((event) => event.delta)
        .join(""),
    ).toBe("Hello from Peerly");
  });

  it("runs messages for the same session in FIFO order", async () => {
    const { faux, models } = makeFauxModels();
    const firstStarted = deferred();
    const releaseFirst = deferred();
    const providerStarts: string[] = [];
    faux.setResponses([
      async () => {
        providerStarts.push("first");
        firstStarted.resolve();
        await releaseFirst.promise;
        return fauxAssistantMessage("First reply");
      },
      () => {
        providerStarts.push("second");
        return fauxAssistantMessage("Second reply");
      },
    ]);
    const runtime = await makeRuntime(await makeDataDirectory(), models);
    const session = await prepareConversation(runtime);

    const firstEvents = collectEvents(
      runtime.sendMessage({ agentId: "assistant", sessionId: session.id, content: "First" }),
    );
    await firstStarted.promise;
    const secondEvents = collectEvents(
      runtime.sendMessage({ agentId: "assistant", sessionId: session.id, content: "Second" }),
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(providerStarts).toEqual(["first"]);
    releaseFirst.resolve();
    const [, second] = await Promise.all([firstEvents, secondEvents]);
    expect(providerStarts).toEqual(["first", "second"]);
    expect(second.at(-1)).toMatchObject({ type: "run_completed", content: "Second reply" });
  });

  it("uses the Agent configuration in effect when a queued message starts", async () => {
    const faux = fauxProvider({
      provider: "faux",
      models: [{ id: "model-v1" }, { id: "model-v2" }],
    });
    const models = createModels();
    models.setProvider(faux.provider);
    const firstStarted = deferred();
    const releaseFirst = deferred();
    const observedModels: string[] = [];
    faux.setResponses([
      async (_context, _options, _state, model) => {
        observedModels.push(model.id);
        firstStarted.resolve();
        await releaseFirst.promise;
        return fauxAssistantMessage("First reply");
      },
      (_context, _options, _state, model) => {
        observedModels.push(model.id);
        return fauxAssistantMessage("Second reply");
      },
    ]);
    const runtime = await makeRuntime(await makeDataDirectory(), models);
    await runtime.createAgent({
      id: "assistant",
      name: "Assistant",
      instructions: "Version one.",
      model: { provider: "faux", modelId: "model-v1" },
    });
    const session = await runtime.createSession({ agentId: "assistant" });

    const firstEvents = collectEvents(
      runtime.sendMessage({ agentId: "assistant", sessionId: session.id, content: "First" }),
    );
    await firstStarted.promise;
    const secondEvents = collectEvents(
      runtime.sendMessage({ agentId: "assistant", sessionId: session.id, content: "Second" }),
    );
    await runtime.updateAgent("assistant", {
      instructions: "Version two.",
      model: { provider: "faux", modelId: "model-v2" },
    });
    releaseFirst.resolve();
    await Promise.all([firstEvents, secondEvents]);

    expect(observedModels).toEqual(["model-v1", "model-v2"]);
  });

  it("runs different sessions concurrently", async () => {
    const { faux, models } = makeFauxModels();
    const firstStarted = deferred();
    const secondStarted = deferred();
    const releaseFirst = deferred();
    faux.setResponses([
      async () => {
        firstStarted.resolve();
        await releaseFirst.promise;
        return fauxAssistantMessage("First reply");
      },
      () => {
        secondStarted.resolve();
        return fauxAssistantMessage("Second reply");
      },
    ]);
    const runtime = await makeRuntime(await makeDataDirectory(), models);
    await runtime.createAgent({
      id: "assistant",
      name: "Assistant",
      instructions: "Help the user.",
      model: { provider: "faux", modelId: "chat-model" },
    });
    const firstSession = await runtime.createSession({ agentId: "assistant" });
    const secondSession = await runtime.createSession({ agentId: "assistant" });

    const firstEvents = collectEvents(
      runtime.sendMessage({
        agentId: "assistant",
        sessionId: firstSession.id,
        content: "First",
      }),
    );
    await firstStarted.promise;
    const secondEvents = collectEvents(
      runtime.sendMessage({
        agentId: "assistant",
        sessionId: secondSession.id,
        content: "Second",
      }),
    );

    await withTimeout(secondStarted.promise);
    releaseFirst.resolve();
    await Promise.all([firstEvents, secondEvents]);
  });

  it("cancels an active stream through AbortSignal", async () => {
    const { faux, models } = makeFauxModels({ tokensPerSecond: 20 });
    faux.setResponses([
      fauxAssistantMessage("This response is deliberately long enough to cancel while streaming."),
    ]);
    const runtime = await makeRuntime(await makeDataDirectory(), models);
    const session = await prepareConversation(runtime);
    const controller = new AbortController();
    const events: AgentRuntimeEvent[] = [];

    for await (const event of runtime.sendMessage(
      { agentId: "assistant", sessionId: session.id, content: "Write a long answer" },
      { signal: controller.signal },
    )) {
      events.push(event);
      if (event.type === "output_delta") controller.abort();
    }

    expect(faux.state.callCount).toBe(1);
    expect(events.at(-1)).toMatchObject({ type: "run_cancelled" });
    expect(events.some((event) => event.type === "run_completed")).toBe(false);
  });

  it("can continue the same session after an active response is cancelled", async () => {
    const { faux, models } = makeFauxModels({ tokensPerSecond: 20 });
    faux.setResponses([
      fauxAssistantMessage("This response is deliberately long enough to cancel."),
      fauxAssistantMessage("Recovered reply"),
    ]);
    const runtime = await makeRuntime(await makeDataDirectory(), models);
    const session = await prepareConversation(runtime);
    const controller = new AbortController();

    for await (const event of runtime.sendMessage(
      { agentId: "assistant", sessionId: session.id, content: "Cancel this" },
      { signal: controller.signal },
    )) {
      if (event.type === "output_delta") controller.abort();
    }
    const nextEvents = await collectEvents(
      runtime.sendMessage({
        agentId: "assistant",
        sessionId: session.id,
        content: "Continue after cancellation",
      }),
    );

    expect(nextEvents.at(-1)).toMatchObject({
      type: "run_completed",
      content: "Recovered reply",
    });
  });

  it("can restore a cancelled session after the Runtime restarts", async () => {
    const dataDirectory = await makeDataDirectory();
    const firstModels = makeFauxModels({ tokensPerSecond: 20 });
    firstModels.faux.setResponses([
      fauxAssistantMessage("This response is deliberately long enough to cancel."),
    ]);
    const firstRuntime = await makeRuntime(dataDirectory, firstModels.models);
    const session = await prepareConversation(firstRuntime);
    const controller = new AbortController();

    for await (const event of firstRuntime.sendMessage(
      { agentId: "assistant", sessionId: session.id, content: "Cancel before restart" },
      { signal: controller.signal },
    )) {
      if (event.type === "output_delta") controller.abort();
    }
    await firstRuntime.close();
    runtimes.splice(runtimes.indexOf(firstRuntime), 1);

    const secondModels = makeFauxModels();
    secondModels.faux.setResponses([fauxAssistantMessage("Restored reply")]);
    const restartedRuntime = await makeRuntime(dataDirectory, secondModels.models);
    const events = await collectEvents(
      restartedRuntime.sendMessage({
        agentId: "assistant",
        sessionId: session.id,
        content: "Continue after restart",
      }),
    );

    expect(events.at(-1)).toMatchObject({
      type: "run_completed",
      content: "Restored reply",
    });
  });

  it("cancels a queued stream without calling the provider", async () => {
    const { faux, models } = makeFauxModels();
    const firstStarted = deferred();
    const releaseFirst = deferred();
    faux.setResponses([
      async () => {
        firstStarted.resolve();
        await releaseFirst.promise;
        return fauxAssistantMessage("First reply");
      },
      fauxAssistantMessage("Must not be requested"),
    ]);
    const runtime = await makeRuntime(await makeDataDirectory(), models);
    const session = await prepareConversation(runtime);
    const firstEvents = collectEvents(
      runtime.sendMessage({ agentId: "assistant", sessionId: session.id, content: "First" }),
    );
    await firstStarted.promise;
    const controller = new AbortController();
    const secondEvents = collectEvents(
      runtime.sendMessage(
        { agentId: "assistant", sessionId: session.id, content: "Second" },
        { signal: controller.signal },
      ),
    );

    controller.abort();
    expect(await secondEvents).toEqual([
      expect.objectContaining({ type: "run_queued" }),
      expect.objectContaining({ type: "run_cancelled" }),
    ]);
    expect(faux.state.callCount).toBe(1);
    releaseFirst.resolve();
    await firstEvents;
    expect(faux.state.callCount).toBe(1);
  });
});
