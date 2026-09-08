import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

import { createAgentRuntimeFromEnvironment } from "../packages/agent-runtime/dist/index.js";
import { createPeerlyApp } from "../apps/server/dist/app.js";

const temporaryDirectory = await mkdtemp(join(tmpdir(), "peerly-real-model-smoke-"));
let app;

try {
  app = await createPeerlyApp({
    dataDirectory: join(temporaryDirectory, "server"),
    agentRuntimeFactory: (host) =>
      createAgentRuntimeFromEnvironment({
        env: {
          ...process.env,
          PEERLY_AGENT_DATA_DIR: join(temporaryDirectory, "agent-runtime"),
        },
        host,
      }),
  });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const aliceResponse = await request(address, "/api/principals/humans", {
    method: "POST",
    body: { displayName: "Smoke Test User" },
  });
  const cookie = aliceResponse.headers.getSetCookie()[0]?.split(";", 1)[0];
  const alice = (await aliceResponse.json()).principal;
  const sessionResponse = await request(address, "/api/dev/session", {
    method: "POST",
    body: { principalId: alice.id },
  });
  const sessionCookie = sessionResponse.headers.getSetCookie()[0]?.split(";", 1)[0] ?? cookie;
  if (!sessionCookie) throw new Error("没有收到本地身份 Cookie");

  const agentResponse = await request(address, "/api/principals/agents", {
    method: "POST",
    cookie: sessionCookie,
    body: {
      displayName: "Smoke Test Agent",
      instructions: "简洁、准确地回复测试消息。",
    },
  });
  const agent = (await agentResponse.json()).principal;
  const conversationResponse = await request(address, "/api/conversations/direct", {
    method: "POST",
    cookie: sessionCookie,
    body: { participantId: agent.id },
  });
  const conversation = (await conversationResponse.json()).conversation;
  await request(address, `/api/conversations/${conversation.id}/messages`, {
    method: "POST",
    cookie: sessionCookie,
    body: {
      clientMessageId: "real-model-smoke-1",
      content: {
        type: "text",
        text: "请简短确认你作为 Peerly Agent 收到了这条私聊消息。",
      },
    },
  });

  const messages = await waitForAgentReply(address, conversation.id, sessionCookie);
  const reply = messages.find((message) => message.senderId === agent.id);
  if (!reply) throw new Error("超时前没有收到 Agent 的正式回复");
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        agent: agent.displayName,
        conversationId: conversation.id,
        reply: reply.content.text,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await app?.close();
  await rm(temporaryDirectory, { recursive: true, force: true });
}

async function waitForAgentReply(address, conversationId, cookie) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const response = await request(
      address,
      `/api/conversations/${conversationId}/messages?limit=20`,
      { cookie },
    );
    const messages = (await response.json()).items;
    if (messages.length >= 2) return messages;
    await delay(500);
  }
  return [];
}

async function request(address, path, options = {}) {
  const response = await globalThis.fetch(`${address}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.cookie ? { cookie: options.cookie } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${path}: ${await response.text()}`);
  }
  return response;
}
