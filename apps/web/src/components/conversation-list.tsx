import type { Conversation, HumanPrincipal, Principal } from "@peerly/contracts";
import { useState } from "react";

import { GroupDialog } from "./group-dialog.js";
import { Avatar } from "./identity-gate.js";

interface ConversationListProps {
  current: HumanPrincipal;
  conversations: Conversation[];
  principals: Principal[];
  activeConversationId: string | null;
  onOpen(conversation: Conversation): Promise<void>;
  onCreateGroup(name: string, participantIds: string[]): Promise<void>;
  busy: boolean;
}

export function ConversationList({
  current,
  conversations,
  principals,
  activeConversationId,
  onOpen,
  onCreateGroup,
  busy,
}: ConversationListProps) {
  const [creatingGroup, setCreatingGroup] = useState(false);

  return (
    <section aria-label="会话" className="panel conversation-panel">
      <div className="panel-heading">
        <h2>消息</h2>
        <div className="heading-actions">
          <span className="count">{conversations.length}</span>
          <button className="icon-button" onClick={() => setCreatingGroup(true)} type="button">
            新建群聊
          </button>
        </div>
      </div>
      {conversations.length === 0 ? (
        <p className="empty-copy">从成员列表选择一个人开始私聊。</p>
      ) : (
        <div className="conversation-list">
          {conversations.map((conversation) => {
            const peer =
              conversation.type === "direct"
                ? findPeer(conversation, current.id, principals)
                : undefined;
            const name =
              conversation.type === "group" ? conversation.name : (peer?.displayName ?? "未知成员");
            return (
              <button
                className={
                  conversation.id === activeConversationId
                    ? "conversation-row active"
                    : "conversation-row"
                }
                key={conversation.id}
                onClick={() => void onOpen(conversation)}
                type="button"
              >
                <Avatar name={name} />
                <span>
                  <strong>{name}</strong>
                  <small>{conversation.type === "group" ? "群聊" : "私聊"}</small>
                </span>
              </button>
            );
          })}
        </div>
      )}
      {creatingGroup ? (
        <GroupDialog
          busy={busy}
          currentId={current.id}
          onCancel={() => setCreatingGroup(false)}
          onSubmit={async (name, participantIds) => {
            await onCreateGroup(
              name,
              participantIds.filter((principalId) => principalId !== current.id),
            );
            setCreatingGroup(false);
          }}
          principals={principals}
          submitLabel="创建"
          title="新建群聊"
        />
      ) : null}
    </section>
  );
}

export function findPeer(
  conversation: Conversation,
  currentId: string,
  principals: Principal[],
): Principal | undefined {
  const peerId = conversation.participantIds.find((id) => id !== currentId);
  return principals.find((principal) => principal.id === peerId);
}
