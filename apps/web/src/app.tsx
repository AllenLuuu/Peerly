import type {
  Conversation,
  HumanPrincipal,
  Mention,
  Message,
  PeerlyRealtimeEvent,
  Principal,
} from "@peerly/contracts";
import { useEffect, useRef, useState } from "react";

import type { PeerlyApi } from "./api/peerly-api-client.js";
import { ChatPanel } from "./components/chat-panel.js";
import { ConversationList } from "./components/conversation-list.js";
import { IdentityGate } from "./components/identity-gate.js";
import { MemberList } from "./components/member-list.js";
import type { PeerlyRealtimeClient } from "./realtime/peerly-realtime-client.js";

interface AppProps {
  api: PeerlyApi;
  realtime: PeerlyRealtimeClient;
}

export function App({ api, realtime }: AppProps) {
  const [initialized, setInitialized] = useState(false);
  const [current, setCurrent] = useState<HumanPrincipal | null>(null);
  const [developmentPrincipals, setDevelopmentPrincipals] = useState<HumanPrincipal[]>([]);
  const [principals, setPrincipals] = useState<Principal[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeConversationRef = useRef<Conversation | null>(null);
  const currentRef = useRef<HumanPrincipal | null>(null);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const session = await api.getSession();
        if (disposed) return;
        if (session === null) {
          setDevelopmentPrincipals(await api.listDevelopmentPrincipals());
          setInitialized(true);
          return;
        }
        await enterWorkspace(session);
      } catch (cause) {
        if (!disposed) setError(errorMessage(cause));
      } finally {
        if (!disposed) setInitialized(true);
      }
    })();
    return () => {
      disposed = true;
      realtime.disconnect();
    };
  }, [api, realtime]);

  async function enterWorkspace(session: HumanPrincipal): Promise<void> {
    const [nextPrincipals, nextConversations] = await Promise.all([
      api.listPrincipals(),
      api.listConversations(),
    ]);
    setCurrent(session);
    currentRef.current = session;
    setPrincipals(nextPrincipals);
    setConversations(nextConversations);
    setActiveConversation(null);
    activeConversationRef.current = null;
    setMessages([]);
    setError(null);
    realtime.connect({
      onEvent: handleRealtimeEvent,
      onConnected: () => void synchronizeAfterReconnect(),
    });
  }

  function handleRealtimeEvent(event: PeerlyRealtimeEvent): void {
    if (event.type === "agent.activity") {
      return;
    }
    if (event.type === "conversation.created" || event.type === "conversation.updated") {
      if (!event.conversation.participantIds.includes(currentRef.current?.id ?? "")) {
        setConversations((currentConversations) =>
          currentConversations.filter((conversation) => conversation.id !== event.conversation.id),
        );
        if (activeConversationRef.current?.id === event.conversation.id) {
          activeConversationRef.current = null;
          setActiveConversation(null);
          setMessages([]);
        }
        return;
      }
      setConversations((currentConversations) =>
        mergeConversation(currentConversations, event.conversation),
      );
      if (activeConversationRef.current?.id === event.conversation.id) {
        activeConversationRef.current = event.conversation;
        setActiveConversation(event.conversation);
      }
      return;
    }
    setConversations((currentConversations) =>
      currentConversations
        .map((conversation) =>
          conversation.id === event.message.conversationId
            ? { ...conversation, updatedAt: event.message.createdAt }
            : conversation,
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    );
    if (event.message.conversationId === activeConversationRef.current?.id) {
      setMessages((currentMessages) => mergeMessage(currentMessages, event.message));
    }
  }

  async function synchronizeAfterReconnect(): Promise<void> {
    try {
      const nextConversations = await api.listConversations();
      setConversations(nextConversations);
      const active = activeConversationRef.current;
      if (active !== null) {
        const page = await api.listMessages(active.id);
        setMessages(page.items);
      }
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function perform(operation: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function bootstrap(displayName: string): Promise<void> {
    await perform(async () => {
      const principal = await api.createHuman(displayName);
      const session = await api.selectSession(principal.id);
      await enterWorkspace(session);
    });
  }

  async function selectIdentity(principalId: string): Promise<void> {
    await perform(async () => {
      const session = await api.selectSession(principalId);
      await enterWorkspace(session);
    });
  }

  async function switchIdentity(): Promise<void> {
    await perform(async () => {
      realtime.disconnect();
      setCurrent(null);
      currentRef.current = null;
      setActiveConversation(null);
      activeConversationRef.current = null;
      setMessages([]);
      setDevelopmentPrincipals(await api.listDevelopmentPrincipals());
    });
  }

  async function createHuman(displayName: string): Promise<void> {
    await perform(async () => {
      const principal = await api.createHuman(displayName);
      setPrincipals((currentPrincipals) => [...currentPrincipals, principal]);
      setDevelopmentPrincipals((currentPrincipals) => [...currentPrincipals, principal]);
    });
  }

  async function createAgent(displayName: string, instructions: string): Promise<void> {
    await perform(async () => {
      const principal = await api.createAgent(displayName, instructions);
      setPrincipals((currentPrincipals) => [...currentPrincipals, principal]);
    });
  }

  async function startDirect(principalId: string): Promise<void> {
    await perform(async () => {
      const conversation = await api.createDirectConversation(principalId);
      setConversations((currentConversations) =>
        mergeConversation(currentConversations, conversation),
      );
      await openConversation(conversation);
    });
  }

  async function createGroup(name: string, participantIds: string[]): Promise<void> {
    await perform(async () => {
      const conversation = await api.createGroupConversation(name, participantIds);
      setConversations((currentConversations) =>
        mergeConversation(currentConversations, conversation),
      );
      await openConversation(conversation);
    });
  }

  async function updateGroupParticipants(
    conversationId: string,
    participantIds: string[],
  ): Promise<void> {
    await perform(async () => {
      const conversation = await api.updateGroupParticipants(conversationId, participantIds);
      setConversations((currentConversations) =>
        mergeConversation(currentConversations, conversation),
      );
      if (activeConversationRef.current?.id === conversation.id) {
        activeConversationRef.current = conversation;
        setActiveConversation(conversation);
      }
    });
  }

  async function openConversation(conversation: Conversation): Promise<void> {
    activeConversationRef.current = conversation;
    setActiveConversation(conversation);
    const page = await api.listMessages(conversation.id);
    if (activeConversationRef.current.id === conversation.id) setMessages(page.items);
  }

  async function selectConversation(conversation: Conversation): Promise<void> {
    await perform(() => openConversation(conversation));
  }

  async function sendMessage(text: string, mentions?: Mention[]): Promise<void> {
    const conversation = activeConversationRef.current;
    if (conversation === null) return;
    await perform(async () => {
      const message = await api.sendMessage(conversation.id, {
        clientMessageId: createClientMessageId(),
        content: { type: "text", text, ...(mentions ? { mentions } : {}) },
      });
      if (activeConversationRef.current?.id === conversation.id) {
        setMessages((currentMessages) => mergeMessage(currentMessages, message));
      }
    });
  }

  if (!initialized) {
    return (
      <main className="loading-screen">
        <div className="loading-dot" />
        <p>正在打开 Peerly…</p>
      </main>
    );
  }

  if (current === null) {
    return (
      <>
        {error === null ? null : <ErrorBanner message={error} />}
        <IdentityGate
          busy={busy}
          onBootstrap={bootstrap}
          onSelect={selectIdentity}
          principals={developmentPrincipals}
        />
      </>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">P</span>
          <span>Peerly</span>
        </div>
        <div className="session-control">
          <span>当前身份：{current.displayName}</span>
          <button className="quiet-button" onClick={() => void switchIdentity()} type="button">
            切换身份
          </button>
        </div>
      </header>
      {error === null ? null : <ErrorBanner message={error} />}
      <div className="workspace">
        <MemberList
          busy={busy}
          current={current}
          onCreateHuman={createHuman}
          onCreateAgent={createAgent}
          onStartDirect={startDirect}
          principals={principals}
        />
        <ConversationList
          activeConversationId={activeConversation?.id ?? null}
          conversations={conversations}
          current={current}
          busy={busy}
          onCreateGroup={createGroup}
          onOpen={selectConversation}
          principals={principals}
        />
        <ChatPanel
          busy={busy}
          conversation={activeConversation}
          current={current}
          messages={messages}
          onSend={sendMessage}
          onUpdateGroupParticipants={updateGroupParticipants}
          principals={principals}
        />
      </div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="error-banner" role="alert">
      {message}
    </div>
  );
}

function mergeConversation(conversations: Conversation[], incoming: Conversation): Conversation[] {
  const remaining = conversations.filter((conversation) => conversation.id !== incoming.id);
  return [incoming, ...remaining].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

function mergeMessage(messages: Message[], incoming: Message): Message[] {
  const existingIndex = messages.findIndex((message) => message.id === incoming.id);
  const merged = existingIndex === -1 ? [...messages, incoming] : [...messages];
  if (existingIndex !== -1) merged[existingIndex] = incoming;
  return merged.sort((left, right) => left.sequence - right.sequence);
}

function createClientMessageId(): string {
  return `web-${globalThis.crypto.randomUUID()}`;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "发生了未知错误";
}
