import type { Conversation, HumanPrincipal, Message, Principal } from "@peerly/contracts";
import { useState, type FormEvent, type KeyboardEvent } from "react";

import { findPeer } from "./conversation-list.js";
import { Avatar } from "./identity-gate.js";

interface ChatPanelProps {
  current: HumanPrincipal;
  conversation: Conversation | null;
  messages: Message[];
  principals: Principal[];
  busy: boolean;
  onSend(text: string): Promise<void>;
}

export function ChatPanel({
  current,
  conversation,
  messages,
  principals,
  busy,
  onSend,
}: ChatPanelProps) {
  const [text, setText] = useState("");

  if (conversation === null) {
    return (
      <section className="chat-panel empty-chat">
        <div className="empty-mark">P</div>
        <h2>选择一个会话</h2>
        <p className="muted">你的消息会保存在本地 Peerly 数据目录中。</p>
      </section>
    );
  }

  const peer = findPeer(conversation, current.id, principals);
  const peerName = peer?.displayName ?? "未知成员";

  async function sendCurrentText() {
    const message = text.trim();
    if (!message) return;
    await onSend(message);
    setText("");
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
        <Avatar name={peerName} />
        <div>
          <h2>{peerName}</h2>
          <p>私聊</p>
        </div>
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
        <textarea
          aria-label="消息内容"
          onKeyDown={handleKeyDown}
          onChange={(event) => setText(event.target.value)}
          placeholder={`发消息给 ${peerName}`}
          rows={2}
          value={text}
        />
        <button disabled={busy || !text.trim()} type="submit">
          发送
        </button>
      </form>
    </section>
  );
}
