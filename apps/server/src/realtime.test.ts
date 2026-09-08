import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PeerlyRealtimeEvent } from "@peerly/contracts";
import { io, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createPeerlyApp } from "./app.js";

type TestApp = Awaited<ReturnType<typeof createPeerlyApp>>;

interface PrincipalResponse {
  principal: { id: string; displayName: string };
}

interface ConversationResponse {
  conversation: { id: string };
}

const applications: TestApp[] = [];
const sockets: Socket[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.disconnect();
  await Promise.all(applications.splice(0).map((app) => app.close()));
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Peerly 实时消息", () => {
  it("只向会话参与者广播已落盘的新会话和新消息", async () => {
    const app = await makeApp();
    const alice = await createHuman(app, "Alice");
    const aliceCookie = await selectIdentity(app, alice.id);
    const bob = await createHuman(app, "Bob", aliceCookie);
    const charlie = await createHuman(app, "Charlie", aliceCookie);
    const bobCookie = await selectIdentity(app, bob.id);
    const charlieCookie = await selectIdentity(app, charlie.id);

    const developmentPrincipals = await app.inject({
      method: "GET",
      url: "/api/dev/principals",
    });
    expect(developmentPrincipals.statusCode).toBe(200);
    expect(
      developmentPrincipals.json<{ principals: { displayName: string }[] }>().principals,
    ).toEqual([
      expect.objectContaining({ displayName: "Alice" }),
      expect.objectContaining({ displayName: "Bob" }),
      expect.objectContaining({ displayName: "Charlie" }),
    ]);

    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const aliceEvents: PeerlyRealtimeEvent[] = [];
    const bobEvents: PeerlyRealtimeEvent[] = [];
    const charlieEvents: PeerlyRealtimeEvent[] = [];
    const aliceSocket = await connect(address, aliceCookie, aliceEvents);
    await connect(address, bobCookie, bobEvents);
    await connect(address, charlieCookie, charlieEvents);

    const conversationResponse = await app.inject({
      method: "POST",
      url: "/api/conversations/direct",
      headers: { cookie: aliceCookie },
      payload: { participantId: bob.id },
    });
    expect(conversationResponse.statusCode).toBe(201);
    const conversation = conversationResponse.json<ConversationResponse>().conversation;

    await vi.waitFor(() => {
      expect(aliceEvents).toContainEqual(expect.objectContaining({ type: "conversation.created" }));
      expect(bobEvents).toContainEqual(expect.objectContaining({ type: "conversation.created" }));
    });
    expect(charlieEvents).toEqual([]);

    const sendResponse = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversation.id}/messages`,
      headers: { cookie: aliceCookie },
      payload: {
        clientMessageId: "alice-message-1",
        content: { type: "text", text: "你好，Bob" },
      },
    });
    expect(sendResponse.statusCode).toBe(201);

    await vi.waitFor(() => {
      expect(aliceEvents.filter((event) => event.type === "message.created")).toHaveLength(1);
      expect(bobEvents.filter((event) => event.type === "message.created")).toHaveLength(1);
    });
    expect(charlieEvents).toEqual([]);

    const retryResponse = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversation.id}/messages`,
      headers: { cookie: aliceCookie },
      payload: {
        clientMessageId: "alice-message-1",
        content: { type: "text", text: "你好，Bob" },
      },
    });
    expect(retryResponse.statusCode).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(aliceEvents.filter((event) => event.type === "message.created")).toHaveLength(1);

    const groupResponse = await app.inject({
      method: "POST",
      url: "/api/conversations/groups",
      headers: { cookie: bobCookie },
      payload: { name: "实时群聊", participantIds: [alice.id, charlie.id] },
    });
    const group = groupResponse.json<ConversationResponse>().conversation;
    await vi.waitFor(() => {
      for (const events of [aliceEvents, bobEvents, charlieEvents]) {
        expect(events).toContainEqual(
          expect.objectContaining({
            type: "conversation.created",
            conversation: expect.objectContaining({ id: group.id }),
          }),
        );
      }
    });

    await app.inject({
      method: "PATCH",
      url: `/api/conversations/${group.id}/participants`,
      headers: { cookie: aliceCookie },
      payload: { participantIds: [alice.id, bob.id] },
    });
    await vi.waitFor(() => {
      for (const events of [aliceEvents, bobEvents, charlieEvents]) {
        expect(events).toContainEqual(
          expect.objectContaining({
            type: "conversation.updated",
            conversation: expect.objectContaining({
              id: group.id,
              participantIds: expect.not.arrayContaining([charlie.id]),
            }),
          }),
        );
      }
    });

    aliceSocket.disconnect();
  });

  it("拒绝没有有效身份 Cookie 的实时连接", async () => {
    const app = await makeApp();
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const socket = io(address, { forceNew: true, transports: ["websocket"] });
    sockets.push(socket);

    const error = await new Promise<Error>((resolve) => socket.once("connect_error", resolve));
    expect(error.message).toBe("AUTHENTICATION_REQUIRED");
  });
});

async function makeApp(): Promise<TestApp> {
  const dataDirectory = await mkdtemp(join(tmpdir(), "peerly-realtime-"));
  temporaryDirectories.push(dataDirectory);
  const app = await createPeerlyApp({ dataDirectory });
  applications.push(app);
  return app;
}

async function createHuman(app: TestApp, displayName: string, cookie?: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/principals/humans",
    ...(cookie === undefined ? {} : { headers: { cookie } }),
    payload: { displayName },
  });
  expect(response.statusCode).toBe(201);
  return response.json<PrincipalResponse>().principal;
}

async function selectIdentity(app: TestApp, principalId: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/dev/session",
    payload: { principalId },
  });
  expect(response.statusCode).toBe(200);
  const header = response.headers["set-cookie"];
  const serialized = Array.isArray(header) ? header[0] : header;
  return serialized!.split(";", 1)[0]!;
}

async function connect(
  address: string,
  cookie: string,
  events: PeerlyRealtimeEvent[],
): Promise<Socket> {
  const socket = io(address, {
    extraHeaders: { cookie },
    forceNew: true,
    transports: ["websocket"],
  });
  sockets.push(socket);
  socket.on("peerly.event", (event: PeerlyRealtimeEvent) => events.push(event));
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return socket;
}
