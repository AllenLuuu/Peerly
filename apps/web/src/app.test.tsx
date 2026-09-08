// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import type {
  AgentPrincipal,
  Conversation,
  HumanPrincipal,
  Message,
  Principal,
} from "@peerly/contracts";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./app.js";
import type { PeerlyApi } from "./api/peerly-api-client.js";
import type {
  PeerlyRealtimeClient,
  PeerlyRealtimeHandlers,
} from "./realtime/peerly-realtime-client.js";

const alice = human("human_alice", "Alice", "admin");
const bob = human("human_bob", "Bob", "member");
const charlie = human("human_charlie", "Charlie", "member");
const researcher = agent("agent_researcher", "Researcher", "runtime_researcher");

afterEach(cleanup);

describe("Peerly Web", () => {
  it("首次使用时创建管理员并进入协作界面", async () => {
    const api = fakeApi({ session: null, developmentPrincipals: [] });
    const realtime = new FakeRealtimeClient();
    const user = userEvent.setup();

    render(<App api={api} realtime={realtime} />);

    expect(await screen.findByRole("heading", { name: "欢迎使用 Peerly" })).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "你的名字" }), "Alice");
    await user.click(screen.getByRole("button", { name: "创建管理员" }));

    expect(await screen.findByText("当前身份：Alice")).toBeInTheDocument();
    expect(api.createHuman).toHaveBeenCalledWith("Alice");
    expect(api.selectSession).toHaveBeenCalledWith(alice.id);
    expect(realtime.connected).toBe(true);
  });

  it("创建私聊、发送消息并实时接收当前会话的新消息", async () => {
    const conversation = directConversation("conversation_alice_bob", alice.id, bob.id);
    const sentMessage = message("message_alice_1", conversation.id, alice.id, 1, "你好，Bob");
    const api = fakeApi({
      session: alice,
      principals: [alice, bob, charlie],
      conversations: [],
      createdConversation: conversation,
      sentMessage,
    });
    const realtime = new FakeRealtimeClient();
    const user = userEvent.setup();

    render(<App api={api} realtime={realtime} />);
    expect(await screen.findByText("当前身份：Alice")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "与 Bob 私聊" }));
    expect(await screen.findByRole("heading", { name: "Bob" })).toBeInTheDocument();
    expect(api.createDirectConversation).toHaveBeenCalledWith(bob.id);

    const composer = screen.getByRole("textbox", { name: "消息内容" });
    await user.type(composer, "你好，Bob");
    await user.keyboard("{Enter}");
    expect(await screen.findByText("你好，Bob")).toBeInTheDocument();
    expect(api.sendMessage).toHaveBeenCalledWith(
      conversation.id,
      expect.objectContaining({
        clientMessageId: expect.any(String),
        content: { type: "text", text: "你好，Bob" },
      }),
    );

    await user.type(composer, "第一行");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await user.type(composer, "第二行");
    expect(composer).toHaveValue("第一行\n第二行");
    expect(api.sendMessage).toHaveBeenCalledTimes(1);

    realtime.emit({
      type: "message.created",
      message: message("message_bob_1", conversation.id, bob.id, 2, "你好，Alice"),
    });
    expect(await screen.findByText("你好，Alice")).toBeInTheDocument();

    realtime.emit({
      type: "message.created",
      message: message("message_other", "conversation_other", charlie.id, 1, "不应显示"),
    });
    expect(screen.queryByText("不应显示")).not.toBeInTheDocument();

    realtime.reconnect();
    await waitFor(() => expect(api.listConversations).toHaveBeenCalledTimes(2));
    expect(api.listMessages).toHaveBeenCalledTimes(2);
  });

  it("管理员可以添加成员并从成员列表发起私聊", async () => {
    const api = fakeApi({ session: alice, principals: [alice] });
    api.createHuman.mockResolvedValue(bob);
    const user = userEvent.setup();

    render(<App api={api} realtime={new FakeRealtimeClient()} />);
    expect(await screen.findByText("当前身份：Alice")).toBeInTheDocument();

    const memberPanel = screen.getByRole("region", { name: "成员" });
    await user.type(within(memberPanel).getByRole("textbox", { name: "新成员姓名" }), "Bob");
    await user.click(within(memberPanel).getByRole("button", { name: "添加成员" }));

    expect(await within(memberPanel).findByText("Bob")).toBeInTheDocument();
    expect(api.createHuman).toHaveBeenCalledWith("Bob");
  });

  it("管理员可以创建 Agent，聊天界面不展示 Agent 运行过程", async () => {
    const conversation = directConversation(
      "conversation_alice_researcher",
      alice.id,
      researcher.id,
    );
    const api = fakeApi({
      session: alice,
      principals: [alice],
      createdAgent: researcher,
      conversations: [conversation],
    });
    const realtime = new FakeRealtimeClient();
    const user = userEvent.setup();

    render(<App api={api} realtime={realtime} />);
    expect(await screen.findByText("当前身份：Alice")).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Agent 名称" }), "Researcher");
    await user.type(screen.getByRole("textbox", { name: "Agent 个性化设定" }), "擅长资料整理");
    await user.click(screen.getByRole("button", { name: "创建 Agent" }));
    expect((await screen.findAllByText("Researcher")).length).toBeGreaterThan(0);
    expect(api.createAgent).toHaveBeenCalledWith("Researcher", "擅长资料整理");

    await user.click(
      within(screen.getByRole("region", { name: "会话" })).getByRole("button", {
        name: /Researcher/,
      }),
    );
    act(() => {
      realtime.emit({
        type: "agent.activity",
        deliveryId: "delivery-1",
        conversationId: conversation.id,
        agentId: researcher.id,
        activity: {
          type: "thinking_delta",
          timestamp: "2026-09-08T10:30:00.000Z",
          delta: "正在分析需求",
        },
      });
    });

    expect(screen.queryByText("Researcher 正在处理")).not.toBeInTheDocument();
    expect(screen.queryByText("正在分析需求")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "停止 Researcher" })).not.toBeInTheDocument();
  });

  it("创建群聊、选择结构化 Agent mention 并管理群成员", async () => {
    const group = groupConversation("conversation_product", "产品讨论", alice.id, [
      alice.id,
      bob.id,
      researcher.id,
    ]);
    const updatedGroup = { ...group, participantIds: [alice.id, researcher.id] };
    const sentMessage: Message = {
      ...message("message_group_1", group.id, alice.id, 1, "@Researcher 请总结"),
      content: {
        type: "text",
        text: "@Researcher 请总结",
        mentions: [{ principalId: researcher.id, displayName: "Researcher" }],
      },
    };
    const api = fakeApi({
      session: alice,
      principals: [alice, bob, researcher],
      createdGroup: group,
      updatedGroup,
      sentMessage,
    });
    const user = userEvent.setup();

    render(<App api={api} realtime={new FakeRealtimeClient()} />);
    expect(await screen.findByText("当前身份：Alice")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "新建群聊" }));
    const createDialog = screen.getByRole("dialog", { name: "新建群聊" });
    await user.type(within(createDialog).getByRole("textbox", { name: "群聊名称" }), "产品讨论");
    await user.click(within(createDialog).getByRole("checkbox", { name: "Bob" }));
    await user.click(within(createDialog).getByRole("checkbox", { name: "Researcher" }));
    await user.click(within(createDialog).getByRole("button", { name: "创建" }));

    expect(await screen.findByRole("heading", { name: "产品讨论" })).toBeInTheDocument();
    expect(api.createGroupConversation).toHaveBeenCalledWith("产品讨论", [bob.id, researcher.id]);

    await user.click(screen.getByRole("button", { name: "@ Researcher" }));
    const composer = screen.getByRole("textbox", { name: "消息内容" });
    await user.type(composer, "请总结");
    await user.keyboard("{Enter}");
    expect(api.sendMessage).toHaveBeenCalledWith(
      group.id,
      expect.objectContaining({
        content: {
          type: "text",
          text: "@Researcher 请总结",
          mentions: [{ principalId: researcher.id, displayName: "Researcher" }],
        },
      }),
    );

    await user.click(screen.getByRole("button", { name: "管理群成员" }));
    const manageDialog = screen.getByRole("dialog", { name: "管理群成员" });
    await user.click(within(manageDialog).getByRole("checkbox", { name: "Bob" }));
    await user.click(within(manageDialog).getByRole("button", { name: "保存" }));
    expect(api.updateGroupParticipants).toHaveBeenCalledWith(group.id, [alice.id, researcher.id]);
  });
});

class FakeRealtimeClient implements PeerlyRealtimeClient {
  connected = false;
  #handlers: PeerlyRealtimeHandlers | undefined;

  connect(handlers: PeerlyRealtimeHandlers): void {
    this.connected = true;
    this.#handlers = handlers;
  }

  disconnect(): void {
    this.connected = false;
  }

  emit(event: Parameters<PeerlyRealtimeHandlers["onEvent"]>[0]): void {
    this.#handlers?.onEvent(event);
  }

  reconnect(): void {
    this.#handlers?.onConnected();
  }
}

function fakeApi(options: {
  session?: HumanPrincipal | null;
  developmentPrincipals?: HumanPrincipal[];
  principals?: Principal[];
  conversations?: Conversation[];
  createdConversation?: Conversation;
  createdGroup?: Conversation;
  updatedGroup?: Conversation;
  sentMessage?: Message;
  createdAgent?: AgentPrincipal;
}): PeerlyApi & Record<keyof PeerlyApi, ReturnType<typeof vi.fn>> {
  const createdConversation =
    options.createdConversation ?? directConversation("conversation_default", alice.id, bob.id);
  const sentMessage =
    options.sentMessage ?? message("message_default", createdConversation.id, alice.id, 1, "你好");
  return {
    getSession: vi.fn().mockResolvedValue(options.session ?? null),
    listDevelopmentPrincipals: vi.fn().mockResolvedValue(options.developmentPrincipals ?? [alice]),
    selectSession: vi.fn().mockResolvedValue(alice),
    createHuman: vi.fn().mockResolvedValue(alice),
    createAgent: vi.fn().mockResolvedValue(options.createdAgent ?? researcher),
    listPrincipals: vi.fn().mockResolvedValue(options.principals ?? [alice]),
    listConversations: vi.fn().mockResolvedValue(options.conversations ?? []),
    createDirectConversation: vi.fn().mockResolvedValue(createdConversation),
    createGroupConversation: vi.fn().mockResolvedValue(options.createdGroup ?? createdConversation),
    updateGroupParticipants: vi
      .fn()
      .mockResolvedValue(options.updatedGroup ?? options.createdGroup ?? createdConversation),
    listMessages: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    sendMessage: vi.fn().mockResolvedValue(sentMessage),
    cancelAgentDelivery: vi.fn().mockResolvedValue(undefined),
  };
}

function groupConversation(
  id: string,
  name: string,
  createdBy: string,
  participantIds: string[],
): Conversation {
  return {
    id,
    type: "group",
    name,
    createdBy,
    participantIds,
    createdAt: "2026-09-07T00:00:00.000Z",
    updatedAt: "2026-09-07T00:00:00.000Z",
  };
}

function agent(id: string, displayName: string, runtimeAgentId: string): AgentPrincipal {
  return {
    id,
    type: "agent",
    displayName,
    runtimeAgentId,
    status: "active",
    createdAt: "2026-09-07T00:00:00.000Z",
  };
}

function human(id: string, displayName: string, role: HumanPrincipal["role"]): HumanPrincipal {
  return {
    id,
    type: "human",
    displayName,
    role,
    status: "active",
    createdAt: "2026-09-07T00:00:00.000Z",
  };
}

function directConversation(id: string, first: string, second: string): Conversation {
  return {
    id,
    type: "direct",
    participantIds: [first, second],
    createdAt: "2026-09-07T00:00:00.000Z",
    updatedAt: "2026-09-07T00:00:00.000Z",
  };
}

function message(
  id: string,
  conversationId: string,
  senderId: string,
  sequence: number,
  text: string,
): Message {
  return {
    id,
    conversationId,
    senderId,
    clientMessageId: `${senderId}-${sequence}`,
    sequence,
    content: { type: "text", text },
    createdAt: "2026-09-07T00:00:00.000Z",
  };
}
