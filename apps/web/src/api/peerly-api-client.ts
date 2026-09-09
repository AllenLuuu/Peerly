import {
  conversationResponseSchema,
  conversationsResponseSchema,
  messagePageSchema,
  messageResponseSchema,
  principalsResponseSchema,
  principalResponseSchema,
  sessionResponseSchema,
  type Conversation,
  type AgentPrincipal,
  type HumanPrincipal,
  type Message,
  type MessagePage,
  type Principal,
  type SendMessageInput,
} from "@peerly/contracts";

interface ResponseSchema<T> {
  parse(value: unknown): T;
}

export interface PeerlyApi {
  getSession(): Promise<HumanPrincipal | null>;
  listDevelopmentPrincipals(): Promise<HumanPrincipal[]>;
  selectSession(principalId: string): Promise<HumanPrincipal>;
  createHuman(displayName: string): Promise<HumanPrincipal>;
  createAgent(displayName: string, instructions: string): Promise<AgentPrincipal>;
  deleteAgent(principalId: string): Promise<void>;
  listPrincipals(): Promise<Principal[]>;
  listConversations(): Promise<Conversation[]>;
  createDirectConversation(participantId: string): Promise<Conversation>;
  createGroupConversation(name: string, participantIds: string[]): Promise<Conversation>;
  updateGroupParticipants(conversationId: string, participantIds: string[]): Promise<Conversation>;
  listMessages(conversationId: string): Promise<MessagePage>;
  sendMessage(conversationId: string, input: SendMessageInput): Promise<Message>;
  cancelAgentDelivery(deliveryId: string): Promise<void>;
}

export class HttpPeerlyApi implements PeerlyApi {
  async getSession(): Promise<HumanPrincipal | null> {
    const result = await request("/api/session", sessionResponseSchema);
    if (result.principal === null) return null;
    return requireHuman(result.principal);
  }

  async listDevelopmentPrincipals(): Promise<HumanPrincipal[]> {
    const result = await request("/api/dev/principals", principalsResponseSchema);
    return result.principals.map(requireHuman);
  }

  async selectSession(principalId: string): Promise<HumanPrincipal> {
    const result = await request("/api/dev/session", principalResponseSchema, {
      method: "POST",
      body: JSON.stringify({ principalId }),
    });
    return requireHuman(result.principal);
  }

  async createHuman(displayName: string): Promise<HumanPrincipal> {
    const result = await request("/api/principals/humans", principalResponseSchema, {
      method: "POST",
      body: JSON.stringify({ displayName }),
    });
    return requireHuman(result.principal);
  }

  async createAgent(displayName: string, instructions: string): Promise<AgentPrincipal> {
    const result = await request("/api/principals/agents", principalResponseSchema, {
      method: "POST",
      body: JSON.stringify({ displayName, instructions }),
    });
    if (result.principal.type !== "agent") throw new Error("服务端未返回 Agent 成员");
    return result.principal;
  }

  async deleteAgent(principalId: string): Promise<void> {
    await request(
      `/api/principals/agents/${encodeURIComponent(principalId)}`,
      { parse: () => undefined },
      { method: "DELETE" },
    );
  }

  async listPrincipals(): Promise<Principal[]> {
    return (await request("/api/principals", principalsResponseSchema)).principals;
  }

  async listConversations(): Promise<Conversation[]> {
    return (await request("/api/conversations", conversationsResponseSchema)).conversations;
  }

  async createDirectConversation(participantId: string): Promise<Conversation> {
    return (
      await request("/api/conversations/direct", conversationResponseSchema, {
        method: "POST",
        body: JSON.stringify({ participantId }),
      })
    ).conversation;
  }

  async createGroupConversation(name: string, participantIds: string[]): Promise<Conversation> {
    return (
      await request("/api/conversations/groups", conversationResponseSchema, {
        method: "POST",
        body: JSON.stringify({ name, participantIds }),
      })
    ).conversation;
  }

  async updateGroupParticipants(
    conversationId: string,
    participantIds: string[],
  ): Promise<Conversation> {
    return (
      await request(
        `/api/conversations/${encodeURIComponent(conversationId)}/participants`,
        conversationResponseSchema,
        { method: "PATCH", body: JSON.stringify({ participantIds }) },
      )
    ).conversation;
  }

  async listMessages(conversationId: string): Promise<MessagePage> {
    return request(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
      messagePageSchema,
    );
  }

  async sendMessage(conversationId: string, input: SendMessageInput): Promise<Message> {
    return (
      await request(
        `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
        messageResponseSchema,
        { method: "POST", body: JSON.stringify(input) },
      )
    ).message;
  }

  async cancelAgentDelivery(deliveryId: string): Promise<void> {
    await request(
      `/api/agent-deliveries/${encodeURIComponent(deliveryId)}/cancel`,
      { parse: () => undefined },
      { method: "POST" },
    );
  }
}

async function request<T>(
  path: string,
  schema: ResponseSchema<T>,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && init.body !== null && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers,
  });
  const responseText = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(responseText);
  } catch {
    throw new Error("服务端未返回有效 JSON，请确认 Peerly 后端是否已启动");
  }
  if (!response.ok) {
    const message = readErrorMessage(body);
    throw new Error(message);
  }
  return schema.parse(body);
}

function requireHuman(principal: Principal): HumanPrincipal {
  if (principal.type !== "human") throw new Error("当前身份不是人类成员");
  return principal;
}

function readErrorMessage(body: unknown): string {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "object" &&
    body.error !== null &&
    "message" in body.error &&
    typeof body.error.message === "string"
  ) {
    const requestId =
      "requestId" in body.error && typeof body.error.requestId === "string"
        ? body.error.requestId
        : undefined;
    return requestId ? `${body.error.message} (request ID: ${requestId})` : body.error.message;
  }
  return "请求失败，请稍后重试";
}
