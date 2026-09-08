import type { Conversation, HumanPrincipal, Mention, Message, Principal } from "@peerly/contracts";
import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";

import { findPeer } from "./conversation-list.js";
import { GroupDialog } from "./group-dialog.js";
import { Avatar } from "./identity-gate.js";

interface ChatPanelProps {
  current: HumanPrincipal;
  conversation: Conversation | null;
  messages: Message[];
  principals: Principal[];
  busy: boolean;
  onSend(text: string, mentions?: Mention[]): Promise<void>;
  onUpdateGroupParticipants(conversationId: string, participantIds: string[]): Promise<void>;
}

export function ChatPanel({
  current,
  conversation,
  messages,
  principals,
  busy,
  onSend,
  onUpdateGroupParticipants,
}: ChatPanelProps) {
  const [text, setText] = useState("");
  const [mentionedAgentIds, setMentionedAgentIds] = useState<string[]>([]);
  const [managingMembers, setManagingMembers] = useState(false);

  useEffect(() => {
    setText("");
    setMentionedAgentIds([]);
    setManagingMembers(false);
  }, [conversation?.id]);

  if (conversation === null) {
    return (
      <section className="chat-panel empty-chat">
        <div className="empty-mark">P</div>
        <h2>选择一个会话</h2>
        <p className="muted">你的消息会保存在本地 Peerly 数据目录中。</p>
      </section>
    );
  }

  const peer =
    conversation.type === "direct" ? findPeer(conversation, current.id, principals) : undefined;
  const peerName = peer?.displayName ?? "未知成员";
  const title = conversation.type === "group" ? conversation.name : peerName;
  const mentionableAgents =
    conversation.type === "group"
      ? principals.filter(
          (principal) =>
            principal.type === "agent" &&
            principal.status === "active" &&
            conversation.participantIds.includes(principal.id),
        )
      : [];
  const canManageGroup =
    conversation.type === "group" &&
    (conversation.createdBy === current.id || current.role === "admin");

  async function sendCurrentText() {
    const message = text.trim();
    if (!message) return;
    const mentions = mentionableAgents
      .filter((agent) => mentionedAgentIds.includes(agent.id))
      .map((agent) => ({ principalId: agent.id, displayName: agent.displayName }));
    const prefix = mentions.map((mention) => `@${mention.displayName}`).join(" ");
    await onSend(
      prefix ? `${prefix} ${message}` : message,
      mentions.length > 0 ? mentions : undefined,
    );
    setText("");
    setMentionedAgentIds([]);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendCurrentText();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!busy) void sendCurrentText();
  }

  return (
    <section className="chat-panel">
      <header className="chat-header">
        <Avatar name={title} />
        <div>
          <h2>{title}</h2>
          <p>
            {conversation.type === "group"
              ? `${conversation.participantIds.length} 位成员`
              : "私聊"}
          </p>
        </div>
        {canManageGroup ? (
          <button
            className="quiet-button manage-group-button"
            onClick={() => setManagingMembers(true)}
            type="button"
          >
            管理群成员
          </button>
        ) : null}
      </header>
      <div aria-live="polite" className="message-list">
        {messages.length === 0 ? (
          <p className="empty-copy">还没有消息，发一条问候吧。</p>
        ) : (
          messages.map((message) => {
            const mine = message.senderId === current.id;
            const sender = principals.find((principal) => principal.id === message.senderId);
            return (
              <article className={mine ? "message mine" : "message"} key={message.id}>
                <small>{mine ? "你" : (sender?.displayName ?? "未知成员")}</small>
                <p>{message.content.text}</p>
              </article>
            );
          })
        )}
      </div>
      <form className="composer" onSubmit={submit}>
        {mentionableAgents.length > 0 ? (
          <div className="mention-bar">
            {mentionableAgents.map((agent) => {
              const selected = mentionedAgentIds.includes(agent.id);
              return (
                <button
                  aria-pressed={selected}
                  className={selected ? "mention-button selected" : "mention-button"}
                  disabled={busy}
                  key={agent.id}
                  onClick={() =>
                    setMentionedAgentIds((currentIds) =>
                      currentIds.includes(agent.id)
                        ? currentIds.filter((id) => id !== agent.id)
                        : [...currentIds, agent.id],
                    )
                  }
                  type="button"
                >
                  @ {agent.displayName}
                </button>
              );
            })}
          </div>
        ) : null}
        <textarea
          aria-label="消息内容"
          onKeyDown={handleKeyDown}
          onChange={(event) => setText(event.target.value)}
          placeholder={`发消息给 ${title}`}
          rows={2}
          value={text}
        />
        <button disabled={busy || !text.trim()} type="submit">
          发送
        </button>
      </form>
      {managingMembers && conversation.type === "group" ? (
        <GroupDialog
          busy={busy}
          currentId={current.id}
          groupName={conversation.name}
          initialParticipantIds={conversation.participantIds.filter((id) => id !== current.id)}
          lockedParticipantIds={[conversation.createdBy]}
          onCancel={() => setManagingMembers(false)}
          onSubmit={async (_name, participantIds) => {
            await onUpdateGroupParticipants(conversation.id, participantIds);
            setManagingMembers(false);
          }}
          principals={principals}
          submitLabel="保存"
          title="管理群成员"
        />
      ) : null}
    </section>
  );
}
