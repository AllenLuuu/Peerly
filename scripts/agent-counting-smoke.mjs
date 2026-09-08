import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

import { createAgentRuntimeFromEnvironment } from "../packages/agent-runtime/dist/index.js";
import { createPeerlyApp } from "../apps/server/dist/app.js";

const AGENT_COUNT = 5;
const temporaryDirectory = await mkdtemp(join(tmpdir(), "peerly-agent-counting-"));
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
  const humanResponse = await request(address, "/api/principals/humans", {
    method: "POST",
    body: { displayName: "报数主持人" },
  });
  const human = (await humanResponse.json()).principal;
  const sessionResponse = await request(address, "/api/dev/session", {
    method: "POST",
    body: { principalId: human.id },
  });
  const sessionCookie = sessionResponse.headers.getSetCookie()[0]?.split(";", 1)[0];
  if (!sessionCookie) throw new Error("没有收到本地身份 Cookie");

  const agents = [];
  for (let index = 1; index <= AGENT_COUNT; index += 1) {
    const response = await request(address, "/api/principals/agents", {
      method: "POST",
      cookie: sessionCookie,
      body: {
        displayName: `Counter ${index}`,
        instructions: `你正在参加一个五名 Agent 的报数验收。主持人要求开始报数时，每个 Agent 必须且只能贡献一个数字。第一次尝试时，如果还没有其他 Agent 的数字，就回复 1；reply 冲突返回新消息后，回复其中最大数字加 1。必须只发送一个阿拉伯数字，不要解释，不要使用 ignore_new。自己的数字成功发送后，之后收到其他 Agent 的报数消息必须保持沉默，不得再次报数。`,
      },
    });
    agents.push((await response.json()).principal);
  }

  const groupResponse = await request(address, "/api/conversations/groups", {
    method: "POST",
    cookie: sessionCookie,
    body: {
      name: "五 Agent 报数验收",
      participantIds: agents.map((agent) => agent.id),
    },
  });
  const conversation = (await groupResponse.json()).conversation;
  await request(address, `/api/conversations/${conversation.id}/messages`, {
    method: "POST",
    cookie: sessionCookie,
    body: {
      clientMessageId: "counting-start",
      content: {
        type: "text",
        text: `${agents.map((agent) => `@${agent.displayName}`).join(" ")} 请五位 Agent 开始报数，每人只报一次，从 1 开始连续报到 5。`,
        mentions: agents.map((agent) => ({
          principalId: agent.id,
          displayName: agent.displayName,
        })),
      },
    },
  });

  const messages = await waitForStableMessages(
    address,
    conversation.id,
    sessionCookie,
    AGENT_COUNT + 1,
  );
  const agentMessages = messages.filter((message) => message.senderId !== human.id);
  const values = agentMessages.map((message) => message.content.text.trim());
  const expected = Array.from({ length: AGENT_COUNT }, (_, index) => String(index + 1));
  if (agentMessages.length !== AGENT_COUNT) {
    throw new Error(
      `预期 5 条 Agent 回复，实际为 ${agentMessages.length} 条：${values.join(", ")}`,
    );
  }
  if (new Set(agentMessages.map((message) => message.senderId)).size !== AGENT_COUNT) {
    throw new Error(`存在 Agent 重复报数：${values.join(", ")}`);
  }
  if (JSON.stringify(values) !== JSON.stringify(expected)) {
    throw new Error(`报数顺序不正确，预期 ${expected.join(", ")}，实际 ${values.join(", ")}`);
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        conversationId: conversation.id,
        participants: agents.map((agent) => agent.displayName),
        count: values,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await app?.close();
  await rm(temporaryDirectory, { recursive: true, force: true });
}

async function waitForStableMessages(address, conversationId, cookie, minimumCount) {
  const deadline = Date.now() + 180_000;
  let previousCount = -1;
  let stableSince = Date.now();
  let latest = [];
  while (Date.now() < deadline) {
    const response = await request(
      address,
      `/api/conversations/${conversationId}/messages?limit=100`,
      { cookie },
    );
    latest = (await response.json()).items;
    if (latest.length !== previousCount) {
      previousCount = latest.length;
      stableSince = Date.now();
    }
    if (latest.length >= minimumCount && Date.now() - stableSince >= 3_000) return latest;
    await delay(500);
  }
  return latest;
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
