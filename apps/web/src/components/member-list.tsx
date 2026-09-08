import type { HumanPrincipal, Principal } from "@peerly/contracts";
import { useState, type FormEvent } from "react";

import { Avatar } from "./identity-gate.js";

interface MemberListProps {
  current: HumanPrincipal;
  principals: Principal[];
  busy: boolean;
  onCreateHuman(displayName: string): Promise<void>;
  onCreateAgent(displayName: string, instructions: string): Promise<void>;
  onStartDirect(principalId: string): Promise<void>;
}

export function MemberList({
  current,
  principals,
  busy,
  onCreateHuman,
  onCreateAgent,
  onStartDirect,
}: MemberListProps) {
  const [displayName, setDisplayName] = useState("");
  const [agentName, setAgentName] = useState("");
  const [agentInstructions, setAgentInstructions] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = displayName.trim();
    if (!name) return;
    await onCreateHuman(name);
    setDisplayName("");
  }

  async function submitAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = agentName.trim();
    const instructions = agentInstructions.trim();
    if (!name || !instructions) return;
    await onCreateAgent(name, instructions);
    setAgentName("");
    setAgentInstructions("");
  }

  return (
    <section aria-label="成员" className="panel member-panel">
      <div className="panel-heading">
        <h2>成员</h2>
        <span className="count">{principals.length}</span>
      </div>

      {current.role === "admin" ? (
        <div className="member-forms">
          <form className="member-form" onSubmit={(event) => void submit(event)}>
            <input
              aria-label="新成员姓名"
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="添加成员"
              value={displayName}
            />
            <button disabled={busy || !displayName.trim()} type="submit">
              添加成员
            </button>
          </form>
          <form className="agent-form" onSubmit={(event) => void submitAgent(event)}>
            <input
              aria-label="Agent 名称"
              onChange={(event) => setAgentName(event.target.value)}
              placeholder="Agent 名称"
              value={agentName}
            />
            <textarea
              aria-label="Agent 个性化设定"
              onChange={(event) => setAgentInstructions(event.target.value)}
              placeholder="Agent 个性化设定"
              rows={2}
              value={agentInstructions}
            />
            <button disabled={busy || !agentName.trim() || !agentInstructions.trim()} type="submit">
              创建 Agent
            </button>
          </form>
        </div>
      ) : null}

      <div className="member-list">
        {principals.map((principal) => {
          const isCurrent = principal.id === current.id;
          return (
            <div className="member-row" key={principal.id}>
              <Avatar name={principal.displayName} />
              <span className="member-copy">
                <strong>{principal.displayName}</strong>
                <small>
                  {principal.type === "agent"
                    ? "Agent"
                    : principal.role === "admin"
                      ? "管理员"
                      : "成员"}
                </small>
              </span>
              {isCurrent ? (
                <span className="self-badge">你</span>
              ) : (
                <button
                  aria-label={`与 ${principal.displayName} 私聊`}
                  className="icon-button"
                  disabled={busy}
                  onClick={() => void onStartDirect(principal.id)}
                  title={`与 ${principal.displayName} 私聊`}
                  type="button"
                >
                  ↗
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
