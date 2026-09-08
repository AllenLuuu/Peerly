import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createPeerlyApp } from "./app.js";

type TestApp = Awaited<ReturnType<typeof createPeerlyApp>>;

interface PrincipalBody {
  principal: {
    id: string;
    type: "human" | "agent";
    displayName: string;
    role?: "admin" | "member";
  };
}

interface ConversationBody {
  conversation: {
    id: string;
    type: "direct" | "group";
    name?: string;
    createdBy?: string;
    participantIds: string[];
  };
}

interface MessageBody {
  message: {
    id: string;
    senderId: string;
    sequence: number;
    content: { type: "text"; text: string };
  };
}

const applications: TestApp[] = [];
const temporaryDirectories: string[] = [];

async function makeDataDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "peerly-server-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function makeApp(dataDirectory?: string): Promise<TestApp> {
  const app = await createPeerlyApp({
    dataDirectory: dataDirectory ?? (await makeDataDirectory()),
  });
  applications.push(app);
  return app;
}

async function createHuman(app: TestApp, displayName: string, cookie?: string) {
  return app.inject({
    method: "POST",
    url: "/api/principals/humans",
    ...(cookie === undefined ? {} : { headers: { cookie } }),
    payload: { displayName },
  });
}

async function selectIdentity(app: TestApp, principalId: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/dev/session",
    payload: { principalId },
  });
  expect(response.statusCode).toBe(200);
  const header = response.headers["set-cookie"];
  const serializedCookie = Array.isArray(header) ? header[0] : header;
  expect(serializedCookie).toBeDefined();
  return serializedCookie!.split(";", 1)[0]!;
}

async function bootstrapTeam(app: TestApp) {
  const aliceResponse = await createHuman(app, "Alice");
  expect(aliceResponse.statusCode).toBe(201);
  const alice = aliceResponse.json<PrincipalBody>().principal;
  const aliceCookie = await selectIdentity(app, alice.id);

  const bobResponse = await createHuman(app, "Bob", aliceCookie);
  expect(bobResponse.statusCode).toBe(201);
  const bob = bobResponse.json<PrincipalBody>().principal;

  const charlieResponse = await createHuman(app, "Charlie", aliceCookie);
  expect(charlieResponse.statusCode).toBe(201);
  const charlie = charlieResponse.json<PrincipalBody>().principal;

  return {
    alice,
    aliceCookie,
    bob,
    bobCookie: await selectIdentity(app, bob.id),
    charlie,
    charlieCookie: await selectIdentity(app, charlie.id),
  };
}

async function createDirectConversation(app: TestApp, cookie: string, participantId: string) {
  return app.inject({
    method: "POST",
    url: "/api/conversations/direct",
    headers: { cookie },
    payload: { participantId },
  });
}

async function createGroupConversation(
  app: TestApp,
  cookie: string,
  name: string,
  participantIds: string[],
) {
  return app.inject({
    method: "POST",
    url: "/api/conversations/groups",
    headers: { cookie },
    payload: { name, participantIds },
  });
}

async function updateGroupParticipants(
  app: TestApp,
  cookie: string,
  conversationId: string,
  participantIds: string[],
) {
  return app.inject({
    method: "PATCH",
    url: `/api/conversations/${conversationId}/participants`,
    headers: { cookie },
    payload: { participantIds },
  });
}

async function sendMessage(
  app: TestApp,
  cookie: string,
  conversationId: string,
  clientMessageId: string,
  text: string,
) {
  return app.inject({
    method: "POST",
    url: `/api/conversations/${conversationId}/messages`,
    headers: { cookie },
    payload: {
      clientMessageId,
      content: { type: "text", text },
    },
  });
}

afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Peerly messaging API", () => {
  it("bootstraps an administrator and only lets administrators add more humans", async () => {
    const app = await makeApp();

    const aliceResponse = await createHuman(app, "Alice");
    expect(aliceResponse.statusCode).toBe(201);
    const alice = aliceResponse.json<PrincipalBody>().principal;
    expect(alice).toMatchObject({ type: "human", displayName: "Alice", role: "admin" });

    const unauthenticatedResponse = await createHuman(app, "Bob");
    expect(unauthenticatedResponse.statusCode).toBe(401);

    const aliceCookie = await selectIdentity(app, alice.id);
    const bobResponse = await createHuman(app, "Bob", aliceCookie);
    expect(bobResponse.statusCode).toBe(201);
    const bob = bobResponse.json<PrincipalBody>().principal;
    expect(bob).toMatchObject({ type: "human", displayName: "Bob", role: "member" });

    const bobCookie = await selectIdentity(app, bob.id);
    const forbiddenResponse = await createHuman(app, "Charlie", bobCookie);
    expect(forbiddenResponse.statusCode).toBe(403);

    const sessionResponse = await app.inject({
      method: "GET",
      url: "/api/session",
      headers: { cookie: aliceCookie },
    });
    expect(sessionResponse.statusCode).toBe(200);
    expect(sessionResponse.json<PrincipalBody>().principal.id).toBe(alice.id);

    const principalsResponse = await app.inject({
      method: "GET",
      url: "/api/principals",
      headers: { cookie: aliceCookie },
    });
    expect(principalsResponse.statusCode).toBe(200);
    expect(
      principalsResponse.json<{ principals: PrincipalBody["principal"][] }>().principals,
    ).toEqual([alice, bob]);
  });

  it("creates one direct conversation per participant pair and hides it from outsiders", async () => {
    const app = await makeApp();
    const team = await bootstrapTeam(app);

    const firstResponse = await createDirectConversation(app, team.aliceCookie, team.bob.id);
    expect(firstResponse.statusCode).toBe(201);
    const first = firstResponse.json<ConversationBody>().conversation;
    expect(first.participantIds).toEqual(expect.arrayContaining([team.alice.id, team.bob.id]));

    const repeatedResponse = await createDirectConversation(app, team.bobCookie, team.alice.id);
    expect(repeatedResponse.statusCode).toBe(200);
    expect(repeatedResponse.json<ConversationBody>().conversation.id).toBe(first.id);

    const selfConversationResponse = await createDirectConversation(
      app,
      team.aliceCookie,
      team.alice.id,
    );
    expect(selfConversationResponse.statusCode).toBe(400);

    const unknownParticipantResponse = await createDirectConversation(
      app,
      team.aliceCookie,
      "human_unknown",
    );
    expect(unknownParticipantResponse.statusCode).toBe(404);

    for (const cookie of [team.aliceCookie, team.bobCookie]) {
      const response = await app.inject({
        method: "GET",
        url: "/api/conversations",
        headers: { cookie },
      });
      expect(response.statusCode).toBe(200);
      expect(
        response.json<{ conversations: ConversationBody["conversation"][] }>().conversations,
      ).toHaveLength(1);
    }

    const outsiderResponse = await app.inject({
      method: "GET",
      url: "/api/conversations",
      headers: { cookie: team.charlieCookie },
    });
    expect(outsiderResponse.statusCode).toBe(200);
    expect(outsiderResponse.json<{ conversations: unknown[] }>().conversations).toEqual([]);
  });

  it("sends messages idempotently and enforces conversation membership", async () => {
    const app = await makeApp();
    const team = await bootstrapTeam(app);
    const conversationResponse = await createDirectConversation(app, team.aliceCookie, team.bob.id);
    const conversation = conversationResponse.json<ConversationBody>().conversation;

    const firstResponse = await sendMessage(
      app,
      team.aliceCookie,
      conversation.id,
      "alice-1",
      "Hello Bob",
    );
    expect(firstResponse.statusCode).toBe(201);
    const first = firstResponse.json<MessageBody>().message;
    expect(first).toMatchObject({
      senderId: team.alice.id,
      sequence: 1,
      content: { type: "text", text: "Hello Bob" },
    });

    const retryResponse = await sendMessage(
      app,
      team.aliceCookie,
      conversation.id,
      "alice-1",
      "Hello Bob",
    );
    expect(retryResponse.statusCode).toBe(200);
    expect(retryResponse.json<MessageBody>().message.id).toBe(first.id);

    const emptyMessageResponse = await sendMessage(
      app,
      team.aliceCookie,
      conversation.id,
      "alice-empty",
      "   ",
    );
    expect(emptyMessageResponse.statusCode).toBe(400);

    const secondResponse = await sendMessage(
      app,
      team.bobCookie,
      conversation.id,
      "bob-1",
      "Hello Alice",
    );
    expect(secondResponse.statusCode).toBe(201);
    expect(secondResponse.json<MessageBody>().message.sequence).toBe(2);

    const forbiddenSend = await sendMessage(
      app,
      team.charlieCookie,
      conversation.id,
      "charlie-1",
      "I should not be here",
    );
    expect(forbiddenSend.statusCode).toBe(403);

    const forbiddenRead = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversation.id}/messages`,
      headers: { cookie: team.charlieCookie },
    });
    expect(forbiddenRead.statusCode).toBe(403);

    const messagesResponse = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversation.id}/messages`,
      headers: { cookie: team.aliceCookie },
    });
    expect(messagesResponse.statusCode).toBe(200);
    expect(messagesResponse.json<{ items: MessageBody["message"][] }>().items).toHaveLength(2);
  });

  it("创建者和管理员可以管理群成员，被移除成员立即失去访问权限", async () => {
    const app = await makeApp();
    const team = await bootstrapTeam(app);

    const createdResponse = await createGroupConversation(app, team.bobCookie, "产品讨论", [
      team.alice.id,
      team.charlie.id,
    ]);
    expect(createdResponse.statusCode).toBe(201);
    const group = createdResponse.json<ConversationBody>().conversation;
    expect(group).toMatchObject({
      type: "group",
      name: "产品讨论",
      createdBy: team.bob.id,
    });
    expect(group.participantIds).toEqual(
      expect.arrayContaining([team.alice.id, team.bob.id, team.charlie.id]),
    );

    const forbidden = await updateGroupParticipants(app, team.charlieCookie, group.id, [
      team.alice.id,
      team.bob.id,
    ]);
    expect(forbidden.statusCode).toBe(403);

    const updatedResponse = await updateGroupParticipants(app, team.aliceCookie, group.id, [
      team.alice.id,
      team.bob.id,
    ]);
    expect(updatedResponse.statusCode).toBe(200);
    expect(updatedResponse.json<ConversationBody>().conversation.participantIds).toEqual(
      expect.arrayContaining([team.alice.id, team.bob.id]),
    );

    const removedMemberRead = await app.inject({
      method: "GET",
      url: `/api/conversations/${group.id}/messages`,
      headers: { cookie: team.charlieCookie },
    });
    expect(removedMemberRead.statusCode).toBe(403);

    const creatorRemoval = await updateGroupParticipants(app, team.aliceCookie, group.id, [
      team.alice.id,
      team.charlie.id,
    ]);
    expect(creatorRemoval.statusCode).toBe(400);
  });

  it("群聊消息保存结构化 mention，并拒绝群外或名称不匹配的目标", async () => {
    const app = await makeApp();
    const team = await bootstrapTeam(app);
    const groupResponse = await createGroupConversation(app, team.aliceCookie, "项目群", [
      team.bob.id,
    ]);
    const group = groupResponse.json<ConversationBody>().conversation;

    const mentioned = await app.inject({
      method: "POST",
      url: `/api/conversations/${group.id}/messages`,
      headers: { cookie: team.aliceCookie },
      payload: {
        clientMessageId: "mention-bob",
        content: {
          type: "text",
          text: "@Bob 请看一下",
          mentions: [{ principalId: team.bob.id, displayName: "Bob" }],
        },
      },
    });
    expect(mentioned.statusCode).toBe(201);
    expect(mentioned.json<MessageBody>().message.content).toEqual({
      type: "text",
      text: "@Bob 请看一下",
      mentions: [{ principalId: team.bob.id, displayName: "Bob" }],
    });

    const idempotentRetry = await app.inject({
      method: "POST",
      url: `/api/conversations/${group.id}/messages`,
      headers: { cookie: team.aliceCookie },
      payload: {
        clientMessageId: "mention-bob",
        content: {
          type: "text",
          text: "这次重试的请求体不会覆盖已保存消息",
          mentions: [{ principalId: team.charlie.id, displayName: "Charlie" }],
        },
      },
    });
    expect(idempotentRetry.statusCode).toBe(200);
    expect(idempotentRetry.json<MessageBody>().message.id).toBe(
      mentioned.json<MessageBody>().message.id,
    );

    const outsiderMention = await app.inject({
      method: "POST",
      url: `/api/conversations/${group.id}/messages`,
      headers: { cookie: team.aliceCookie },
      payload: {
        clientMessageId: "mention-charlie",
        content: {
          type: "text",
          text: "@Charlie 请看一下",
          mentions: [{ principalId: team.charlie.id, displayName: "Charlie" }],
        },
      },
    });
    expect(outsiderMention.statusCode).toBe(400);

    const spoofedName = await app.inject({
      method: "POST",
      url: `/api/conversations/${group.id}/messages`,
      headers: { cookie: team.aliceCookie },
      payload: {
        clientMessageId: "spoofed-bob",
        content: {
          type: "text",
          text: "@NotBob 请看一下",
          mentions: [{ principalId: team.bob.id, displayName: "NotBob" }],
        },
      },
    });
    expect(spoofedName.statusCode).toBe(400);
  });

  it("pages backward through messages using stable sequence cursors", async () => {
    const app = await makeApp();
    const team = await bootstrapTeam(app);
    const conversationResponse = await createDirectConversation(app, team.aliceCookie, team.bob.id);
    const conversation = conversationResponse.json<ConversationBody>().conversation;

    for (let sequence = 1; sequence <= 5; sequence += 1) {
      const response = await sendMessage(
        app,
        team.aliceCookie,
        conversation.id,
        `alice-${sequence}`,
        `Message ${sequence}`,
      );
      expect(response.statusCode).toBe(201);
    }

    const latestResponse = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversation.id}/messages?limit=2`,
      headers: { cookie: team.aliceCookie },
    });
    expect(
      latestResponse.json<{ items: { sequence: number }[]; nextCursor: number | null }>(),
    ).toEqual({
      items: [expect.objectContaining({ sequence: 4 }), expect.objectContaining({ sequence: 5 })],
      nextCursor: 4,
    });

    const middleResponse = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversation.id}/messages?before=4&limit=2`,
      headers: { cookie: team.aliceCookie },
    });
    expect(
      middleResponse.json<{ items: { sequence: number }[]; nextCursor: number | null }>(),
    ).toEqual({
      items: [expect.objectContaining({ sequence: 2 }), expect.objectContaining({ sequence: 3 })],
      nextCursor: 2,
    });

    const oldestResponse = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversation.id}/messages?before=2&limit=2`,
      headers: { cookie: team.aliceCookie },
    });
    expect(
      oldestResponse.json<{ items: { sequence: number }[]; nextCursor: number | null }>(),
    ).toEqual({
      items: [expect.objectContaining({ sequence: 1 })],
      nextCursor: null,
    });
  });

  it("recovers principals, conversations, and messages after a restart", async () => {
    const dataDirectory = await makeDataDirectory();
    const firstApp = await makeApp(dataDirectory);
    const team = await bootstrapTeam(firstApp);
    const conversationResponse = await createDirectConversation(
      firstApp,
      team.aliceCookie,
      team.bob.id,
    );
    const conversation = conversationResponse.json<ConversationBody>().conversation;
    await sendMessage(firstApp, team.aliceCookie, conversation.id, "before-restart", "Persist me");
    await firstApp.close();
    applications.splice(applications.indexOf(firstApp), 1);

    const restartedApp = await makeApp(dataDirectory);
    const restoredCookie = await selectIdentity(restartedApp, team.alice.id);
    const conversationsResponse = await restartedApp.inject({
      method: "GET",
      url: "/api/conversations",
      headers: { cookie: restoredCookie },
    });
    expect(conversationsResponse.json<{ conversations: { id: string }[] }>().conversations).toEqual(
      [expect.objectContaining({ id: conversation.id })],
    );

    const messagesResponse = await restartedApp.inject({
      method: "GET",
      url: `/api/conversations/${conversation.id}/messages`,
      headers: { cookie: restoredCookie },
    });
    expect(messagesResponse.json<{ items: MessageBody["message"][] }>().items).toEqual([
      expect.objectContaining({ content: { type: "text", text: "Persist me" } }),
    ]);
  });
});
