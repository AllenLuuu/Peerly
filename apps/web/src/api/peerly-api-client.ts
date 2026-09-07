import {
  conversationResponseSchema,
  conversationsResponseSchema,
  messagePageSchema,
  messageResponseSchema,
  principalsResponseSchema,
  principalResponseSchema,
  sessionResponseSchema,
  type Conversation,
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
  listPrincipals(): Promise<Principal[]>;
  listConversations(): Promise<Conversation[]>;
  createDirectConversation(participantId: string): Promise<Conversation>;
  listMessages(conversationId: string): Promise<MessagePage>;
  sendMessage(conversationId: string, input: SendMessageInput): Promise<Message>;
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
}

async function request<T>(
  path: string,
  schema: ResponseSchema<T>,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const body: unknown = await response.json();
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
    return body.error.message;
  }
  return "请求失败，请稍后重试";
}
