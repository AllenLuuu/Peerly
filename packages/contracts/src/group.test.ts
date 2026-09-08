import { describe, expect, it } from "vitest";

import {
  conversationSchema,
  createGroupConversationInputSchema,
  sendMessageInputSchema,
  updateGroupParticipantsInputSchema,
} from "./index.js";

describe("群聊契约", () => {
  it("接受群聊及结构化 mention", () => {
    expect(
      conversationSchema.parse({
        id: "conversation-product",
        type: "group",
        name: "产品讨论",
        participantIds: ["human-alice", "agent-emily"],
        createdBy: "human-alice",
        createdAt: "2026-09-08T10:00:00.000Z",
        updatedAt: "2026-09-08T10:00:00.000Z",
      }),
    ).toMatchObject({ type: "group", name: "产品讨论" });

    expect(
      sendMessageInputSchema.parse({
        clientMessageId: "web-1",
        content: {
          type: "text",
          text: "@Emily 请总结",
          mentions: [{ principalId: "agent-emily", displayName: "Emily" }],
        },
      }),
    ).toMatchObject({
      content: { mentions: [{ principalId: "agent-emily", displayName: "Emily" }] },
    });
  });

  it("拒绝重复 mention、重复群成员和空群名", () => {
    expect(
      sendMessageInputSchema.safeParse({
        clientMessageId: "web-1",
        content: {
          type: "text",
          text: "@Emily",
          mentions: [
            { principalId: "agent-emily", displayName: "Emily" },
            { principalId: "agent-emily", displayName: "Emily" },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      createGroupConversationInputSchema.safeParse({
        name: "   ",
        participantIds: ["human-bob"],
      }).success,
    ).toBe(false);
    expect(
      updateGroupParticipantsInputSchema.safeParse({
        participantIds: ["human-alice", "human-alice"],
      }).success,
    ).toBe(false);
  });
});
