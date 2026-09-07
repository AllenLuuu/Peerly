import type { Conversation, HumanPrincipal, Principal } from "@peerly/contracts";

import { Avatar } from "./identity-gate.js";

interface ConversationListProps {
  current: HumanPrincipal;
  conversations: Conversation[];
  principals: Principal[];
  activeConversationId: string | null;
  onOpen(conversation: Conversation): Promise<void>;
}

export function ConversationList({
  current,
  conversations,
  principals,
  activeConversationId,
  onOpen,
}: ConversationListProps) {
  return (
    <section aria-label="会话" className="panel conversation-panel">
      <div className="panel-heading">
        <h2>消息</h2>
        <span className="count">{conversations.length}</span>
      </div>
      {conversations.length === 0 ? (
        <p className="empty-copy">从成员列表选择一个人开始私聊。</p>
      ) : (
        <div className="conversation-list">
          {conversations.map((conversation) => {
            const peer = findPeer(conversation, current.id, principals);
            const name = peer?.displayName ?? "未知成员";
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
                  <small>私聊</small>
                </span>
              </button>
            );
          })}
        </div>
      )}
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
