import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Models,
} from "@earendil-works/pi-ai";
import type {
  AgentHost,
  AgentRuntime,
  AgentRuntimeEvent,
  DeliverAgentMessageInput,
} from "@peerly/agent-protocol";
import { afterEach, describe, expect, it } from "vitest";

import { createAgentRuntime } from "./index.js";

const temporaryDirectories: string[] = [];
const runtimes: AgentRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Agent Runtime Conversation session", () => {
  it("重启后按 Agent 和 Conversation 恢复上下文", async () => {
    const dataDirectory = await makeDataDirectory();
    const firstModels = makeFauxModels();
    firstModels.faux.setResponses([replyResponse("记住了")]);
    const firstRuntime = await makeRuntime(dataDirectory, firstModels.models);
    await createAgent(firstRuntime);
    await collect(firstRuntime.deliverMessage(delivery("项目叫 Peerly")));
    await firstRuntime.close();
    runtimes.splice(runtimes.indexOf(firstRuntime), 1);

    const secondModels = makeFauxModels();
    let restoredContext = "";
    secondModels.faux.setResponses([
      (context) => {
        restoredContext = JSON.stringify(context.messages);
        return replyResponse("Peerly");
      },
    ]);
    const restarted = await makeRuntime(dataDirectory, secondModels.models);
    const events = await collect(
      restarted.deliverMessage(
        delivery("项目叫什么？", { deliveryId: "delivery-2", messageId: "message-2" }),
      ),
    );

    expect(restoredContext).toContain("项目叫 Peerly");
    expect(restoredContext).toContain("项目叫什么？");
    expect(events.at(-1)).toMatchObject({ type: "run_completed", replyCount: 1 });
  });

  it("下一次运行使用最新的个性化设定和模型", async () => {
    const faux = fauxProvider({
      provider: "faux",
      models: [{ id: "model-v1" }, { id: "model-v2" }],
    });
    const models = createModels();
    models.setProvider(faux.provider);
    const observed: Array<{ modelId: string; systemPrompt?: string }> = [];
    faux.setResponses([
      (context, _options, _state, model) => {
        observed.push({
          modelId: model.id,
          ...(context.systemPrompt ? { systemPrompt: context.systemPrompt } : {}),
        });
        return replyResponse("第一次");
      },
      (context, _options, _state, model) => {
        observed.push({
          modelId: model.id,
          ...(context.systemPrompt ? { systemPrompt: context.systemPrompt } : {}),
        });
        return replyResponse("第二次");
      },
    ]);
    const runtime = await makeRuntime(await makeDataDirectory(), models);
    await createAgent(runtime, { instructions: "版本一", modelId: "model-v1" });
    await collect(runtime.deliverMessage(delivery("一")));
    await runtime.updateAgent("assistant", {
      instructions: "版本二",
      model: { provider: "faux", modelId: "model-v2" },
    });
    await collect(
      runtime.deliverMessage(delivery("二", { deliveryId: "delivery-2", messageId: "message-2" })),
    );

    expect(observed[0]).toMatchObject({
      modelId: "model-v1",
      systemPrompt: expect.stringContaining("版本一"),
    });
    expect(observed[1]).toMatchObject({
      modelId: "model-v2",
      systemPrompt: expect.stringContaining("版本二"),
    });
  });

  it("以稳定错误报告禁用、删除、未知模型和 Provider 失败", async () => {
    const { faux, models } = makeFauxModels();
    faux.setResponses([
      fauxAssistantMessage("", { stopReason: "error", errorMessage: "Provider failed" }),
    ]);
    const runtime = await makeRuntime(await makeDataDirectory(), models);
    await createAgent(runtime, { id: "disabled", enabled: false });
    await createAgent(runtime, { id: "missing-model", modelId: "unknown" });
    await createAgent(runtime, { id: "broken" });
    await createAgent(runtime, { id: "deleted" });
    await runtime.deleteAgent("deleted");

    expect(await terminalError(runtime, delivery("x", { agentId: "disabled" }))).toBe(
      "AGENT_DISABLED",
    );
    expect(await terminalError(runtime, delivery("x", { agentId: "missing-model" }))).toBe(
      "MODEL_NOT_FOUND",
    );
    expect(await terminalError(runtime, delivery("x", { agentId: "broken" }))).toBe(
      "PROVIDER_ERROR",
    );
    expect(await terminalError(runtime, delivery("x", { agentId: "deleted" }))).toBe(
      "AGENT_NOT_FOUND",
    );
  });
});

async function terminalError(runtime: AgentRuntime, input: DeliverAgentMessageInput) {
  const terminal = (await collect(runtime.deliverMessage(input))).at(-1);
  expect(terminal?.type).toBe("run_failed");
  return terminal?.type === "run_failed" ? terminal.error.code : undefined;
}

function delivery(
  text: string,
  overrides: {
    agentId?: string;
    deliveryId?: string;
    conversationId?: string;
    messageId?: string;
  } = {},
): DeliverAgentMessageInput {
  return {
    deliveryId: overrides.deliveryId ?? `delivery-${overrides.agentId ?? "assistant"}`,
    agentId: overrides.agentId ?? "assistant",
    agentPrincipalId: `principal-${overrides.agentId ?? "assistant"}`,
    conversation: { id: overrides.conversationId ?? "conversation-1", type: "direct" },
    messages: [
      {
        id: overrides.messageId ?? "message-1",
        sender: { id: "human-alice", type: "human", name: "Alice" },
        createdAt: "2026-09-08T10:00:00.000Z",
        content: { type: "text", text },
      },
    ],
  };
}

function replyResponse(text: string) {
  return fauxAssistantMessage(fauxToolCall("reply", { text }), { stopReason: "toolUse" });
}

async function createAgent(
  runtime: AgentRuntime,
  overrides: { id?: string; instructions?: string; modelId?: string; enabled?: boolean } = {},
) {
  await runtime.createAgent({
    id: overrides.id ?? "assistant",
    name: "Assistant",
    instructions: overrides.instructions ?? "帮助用户",
    model: { provider: "faux", modelId: overrides.modelId ?? "chat-model" },
    enabled: overrides.enabled ?? true,
  });
}

function makeFauxModels() {
  const faux = fauxProvider({ provider: "faux", models: [{ id: "chat-model" }] });
  const models = createModels();
  models.setProvider(faux.provider);
  return { faux, models };
}

async function makeRuntime(dataDirectory: string, models: Models) {
  const host: AgentHost = {
    async publishReply(input) {
      return {
        messageId: `${input.deliveryId}-${input.replyIndex}`,
        createdAt: new Date().toISOString(),
      };
    },
  };
  const runtime = await createAgentRuntime({ dataDirectory, models, host });
  runtimes.push(runtime);
  return runtime;
}

async function makeDataDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "peerly-agent-conversation-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function collect(stream: AsyncIterable<AgentRuntimeEvent>) {
  const events: AgentRuntimeEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}
