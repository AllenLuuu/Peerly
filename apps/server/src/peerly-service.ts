import { createHash, randomUUID } from "node:crypto";

import type {
  AgentPrincipal,
  Conversation,
  CreateAgentPrincipalInput,
  CreateHumanInput,
  HumanPrincipal,
  Message,
  MessagePage,
  Principal,
  SendMessageInput,
} from "@peerly/contracts";
import type {
  DeliverAgentMessageInput,
  PublishAgentReplyInput,
  PublishedAgentReply,
  RuntimeAgentDefinition,
} from "@peerly/agent-protocol";

import type { PeerlyRepository, PeerlyState } from "./domain.js";
import { PeerlyError } from "./errors.js";

interface Created<T> {
  value: T;
  created: boolean;
}

interface Delivered<T> extends Created<T> {
  recipientIds: string[];
}

export interface PeerlyServiceOptions {
  now?: () => string;
  generateId?: (prefix: "human" | "agent" | "conversation" | "message") => string;
}

export interface PreparedAgentDelivery {
  agentPrincipalId: string;
  recipientIds: string[];
  input: DeliverAgentMessageInput;
}

export class PeerlyService {
  readonly #repository: PeerlyRepository;
  readonly #now: () => string;
  readonly #generateId: NonNullable<PeerlyServiceOptions["generateId"]>;
  #mutationTail: Promise<void> = Promise.resolve();

  constructor(repository: PeerlyRepository, options: PeerlyServiceOptions = {}) {
    this.#repository = repository;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#generateId = options.generateId ?? ((prefix) => `${prefix}_${randomUUID()}`);
  }

  async createHuman(input: CreateHumanInput, actorId?: string): Promise<HumanPrincipal> {
    return this.#mutate(async () => {
      const state = this.#repository.readState();
      const humans = state.principals.filter((principal) => principal.type === "human");
      if (humans.length > 0) {
        const actor = this.#requireActor(state, actorId);
        if (actor.type !== "human" || actor.role !== "admin") {
          throw new PeerlyError("FORBIDDEN", "Only administrators can create members", 403);
        }
      }

      const principal: HumanPrincipal = {
        id: this.#generateId("human"),
        type: "human",
        displayName: input.displayName,
        role: humans.length === 0 ? "admin" : "member",
        status: "active",
        createdAt: this.#now(),
      };
      state.principals.push(principal);
      await this.#repository.saveState(state);
      return principal;
    });
  }

  async registerAgent(
    input: CreateAgentPrincipalInput,
    definition: RuntimeAgentDefinition,
    actorId?: string,
  ): Promise<AgentPrincipal> {
    return this.#mutate(async () => {
      const state = this.#repository.readState();
      const actor = this.#requireActor(state, actorId);
      if (actor.type !== "human" || actor.role !== "admin") {
        throw new PeerlyError("FORBIDDEN", "Only administrators can create Agents", 403);
      }
      if (
        state.principals.some(
          (principal) => principal.type === "agent" && principal.runtimeAgentId === definition.id,
        )
      ) {
        throw new PeerlyError("INVALID_OPERATION", "Agent is already registered", 409);
      }

      const principal: AgentPrincipal = {
        id: this.#generateId("agent"),
        type: "agent",
        displayName: input.displayName,
        runtimeAgentId: definition.id,
        status: definition.enabled ? "active" : "disabled",
        createdAt: this.#now(),
      };
      state.principals.push(principal);
      await this.#repository.saveState(state);
      return principal;
    });
  }

  getSessionPrincipal(principalId?: string): HumanPrincipal | null {
    if (principalId === undefined) return null;
    const principal = this.#repository
      .readState()
      .principals.find((candidate) => candidate.id === principalId);
    return principal?.type === "human" && principal.status === "active" ? principal : null;
  }

  requireHumanSession(principalId: string): HumanPrincipal {
    const principal = this.getSessionPrincipal(principalId);
    if (principal === null) {
      throw new PeerlyError("PRINCIPAL_NOT_FOUND", "Active human principal not found", 404);
    }
    return principal;
  }

  listPrincipals(actorId?: string): Principal[] {
    const state = this.#repository.readState();
    this.#requireActor(state, actorId);
    return state.principals;
  }

  listDevelopmentPrincipals(): HumanPrincipal[] {
    return this.#repository
      .readState()
      .principals.filter(
        (principal): principal is HumanPrincipal =>
          principal.type === "human" && principal.status === "active",
      );
  }

  requireAdministrator(actorId?: string): HumanPrincipal {
    const actor = this.#requireActor(this.#repository.readState(), actorId);
    if (actor.type !== "human" || actor.role !== "admin") {
      throw new PeerlyError("FORBIDDEN", "Only administrators can create Agents", 403);
    }
    return actor;
  }

  async createDirectConversation(
    actorId: string | undefined,
    participantId: string,
  ): Promise<Created<Conversation>> {
    return this.#mutate(async () => {
      const state = this.#repository.readState();
      const actor = this.#requireActor(state, actorId);
      const participant = this.#findActivePrincipal(state, participantId);
      if (actor.id === participant.id) {
        throw new PeerlyError(
          "INVALID_OPERATION",
          "A direct conversation requires two different principals",
          400,
        );
      }

      const existing = state.conversations.find(
        (conversation) =>
          conversation.type === "direct" &&
          conversation.participantIds.includes(actor.id) &&
          conversation.participantIds.includes(participant.id),
      );
      if (existing !== undefined) return { value: existing, created: false };

      const timestamp = this.#now();
      const conversation: Conversation = {
        id: this.#generateId("conversation"),
        type: "direct",
        participantIds: [actor.id, participant.id],
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      state.conversations.push(conversation);
      await this.#repository.saveState(state);
      return { value: conversation, created: true };
    });
  }

  listConversations(actorId?: string): Conversation[] {
    const state = this.#repository.readState();
    const actor = this.#requireActor(state, actorId);
    return state.conversations
      .filter((conversation) => conversation.participantIds.includes(actor.id))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async sendMessage(
    actorId: string | undefined,
    conversationId: string,
    input: SendMessageInput,
  ): Promise<Delivered<Message>> {
    return this.#mutate(async () => {
      const state = this.#repository.readState();
      const actor = this.#requireActor(state, actorId);
      const conversation = this.#requireConversation(state, conversationId);
      this.#requireParticipant(conversation, actor.id);

      const messages = await this.#repository.readMessages(conversation.id);
      const existing = messages.find(
        (message) =>
          message.senderId === actor.id && message.clientMessageId === input.clientMessageId,
      );
      if (existing !== undefined) {
        return {
          value: existing,
          created: false,
          recipientIds: [...conversation.participantIds],
        };
      }

      const timestamp = this.#now();
      const previousMessage = messages.at(-1);
      const message: Message = {
        id: this.#generateId("message"),
        conversationId: conversation.id,
        senderId: actor.id,
        clientMessageId: input.clientMessageId,
        sequence: (previousMessage?.sequence ?? 0) + 1,
        content: input.content,
        createdAt: timestamp,
      };
      await this.#repository.appendMessage(message);

      conversation.updatedAt = timestamp;
      await this.#repository.saveState(state);
      return {
        value: message,
        created: true,
        recipientIds: [...conversation.participantIds],
      };
    });
  }

  async listMessages(
    actorId: string | undefined,
    conversationId: string,
    query: { before?: number | undefined; limit: number },
  ): Promise<MessagePage> {
    const state = this.#repository.readState();
    const actor = this.#requireActor(state, actorId);
    const conversation = this.#requireConversation(state, conversationId);
    this.#requireParticipant(conversation, actor.id);

    const messages = await this.#repository.readMessages(conversation.id);
    const eligible =
      query.before === undefined
        ? messages
        : messages.filter((message) => message.sequence < query.before!);
    const items = eligible.slice(-query.limit);
    return {
      items,
      nextCursor: eligible.length > items.length ? (items[0]?.sequence ?? null) : null,
    };
  }

  prepareAgentDeliveries(message: Message): PreparedAgentDelivery[] {
    const state = this.#repository.readState();
    const conversation = this.#requireConversation(state, message.conversationId);
    const sender = state.principals.find((principal) => principal.id === message.senderId);
    if (!sender) throw new PeerlyError("PRINCIPAL_NOT_FOUND", "Message sender not found", 404);

    return conversation.participantIds.flatMap((principalId) => {
      const principal = state.principals.find((candidate) => candidate.id === principalId);
      if (
        principal?.type !== "agent" ||
        principal.status !== "active" ||
        principal.id === message.senderId
      ) {
        return [];
      }
      return [
        {
          agentPrincipalId: principal.id,
          recipientIds: [...conversation.participantIds],
          input: {
            deliveryId: `delivery_${message.id}_${principal.id}`,
            agentId: principal.runtimeAgentId,
            conversation: { id: conversation.id, type: conversation.type },
            messages: [
              {
                id: message.id,
                sender: { id: sender.id, type: sender.type, name: sender.displayName },
                createdAt: message.createdAt,
                content: message.content,
              },
            ],
          },
        },
      ];
    });
  }

  async publishAgentReply(input: PublishAgentReplyInput): Promise<{
    result: Delivered<Message>;
    published: PublishedAgentReply;
  }> {
    const principal = this.#repository
      .readState()
      .principals.find(
        (candidate): candidate is AgentPrincipal =>
          candidate.type === "agent" &&
          candidate.runtimeAgentId === input.runtimeAgentId &&
          candidate.status === "active",
      );
    if (!principal) {
      throw new PeerlyError("PRINCIPAL_NOT_FOUND", "Active Agent principal not found", 404);
    }
    const result = await this.sendMessage(principal.id, input.conversationId, {
      clientMessageId: replyClientMessageId(input),
      content: { type: "text", text: input.text },
    });
    return {
      result,
      published: { messageId: result.value.id, createdAt: result.value.createdAt },
    };
  }

  requireConversationAccess(actorId: string | undefined, conversationId: string): void {
    const state = this.#repository.readState();
    const actor = this.#requireActor(state, actorId);
    this.#requireParticipant(this.#requireConversation(state, conversationId), actor.id);
  }

  #requireActor(state: PeerlyState, actorId?: string): Principal {
    if (actorId === undefined) {
      throw new PeerlyError("AUTHENTICATION_REQUIRED", "Authentication is required", 401);
    }
    const principal = state.principals.find((candidate) => candidate.id === actorId);
    const active = principal !== undefined && principal.status === "active";
    if (!active) {
      throw new PeerlyError("AUTHENTICATION_REQUIRED", "Authentication is required", 401);
    }
    return principal;
  }

  #findActivePrincipal(state: PeerlyState, principalId: string): Principal {
    const principal = state.principals.find((candidate) => candidate.id === principalId);
    const active = principal !== undefined && principal.status === "active";
    if (!active) {
      throw new PeerlyError("PRINCIPAL_NOT_FOUND", "Active principal not found", 404);
    }
    return principal;
  }

  #requireConversation(state: PeerlyState, conversationId: string): Conversation {
    const conversation = state.conversations.find((candidate) => candidate.id === conversationId);
    if (conversation === undefined) {
      throw new PeerlyError("CONVERSATION_NOT_FOUND", "Conversation not found", 404);
    }
    return conversation;
  }

  #requireParticipant(conversation: Conversation, principalId: string): void {
    if (!conversation.participantIds.includes(principalId)) {
      throw new PeerlyError("FORBIDDEN", "Conversation membership is required", 403);
    }
  }

  #mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#mutationTail.then(operation, operation);
    this.#mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function replyClientMessageId(input: PublishAgentReplyInput): string {
  const digest = createHash("sha256")
    .update(`${input.deliveryId}\u0000${input.replyIndex}`)
    .digest("hex");
  return `agent-reply-${digest}`;
}
