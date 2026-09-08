import type { Principal } from "@peerly/contracts";
import { useState, type FormEvent } from "react";

interface GroupDialogProps {
  title: string;
  principals: Principal[];
  initialParticipantIds?: string[];
  currentId: string;
  groupName?: string;
  lockedParticipantIds?: string[];
  submitLabel: string;
  busy: boolean;
  onCancel(): void;
  onSubmit(name: string, participantIds: string[]): Promise<void>;
}

export function GroupDialog({
  title,
  principals,
  initialParticipantIds = [],
  currentId,
  groupName = "",
  lockedParticipantIds = [],
  submitLabel,
  busy,
  onCancel,
  onSubmit,
}: GroupDialogProps) {
  const [name, setName] = useState(groupName);
  const [selected, setSelected] = useState(() => new Set(initialParticipantIds));
  const candidates = principals.filter(
    (principal) => principal.status === "active" && principal.id !== currentId,
  );

  function toggle(principalId: string) {
    if (lockedParticipantIds.includes(principalId)) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(principalId)) next.delete(principalId);
      else next.add(principalId);
      return next;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit(name.trim(), [currentId, ...selected]);
  }

  return (
    <div aria-label={title} aria-modal="true" className="dialog-backdrop" role="dialog">
      <form className="group-dialog" onSubmit={(event) => void submit(event)}>
        <div className="dialog-heading">
          <h2>{title}</h2>
          <button aria-label="关闭" className="quiet-button" onClick={onCancel} type="button">
            ×
          </button>
        </div>
        {groupName ? null : (
          <label>
            群聊名称
            <input
              aria-label="群聊名称"
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </label>
        )}
        <fieldset>
          <legend>选择成员</legend>
          {candidates.map((principal) => (
            <label className="participant-option" key={principal.id}>
              <input
                aria-label={principal.displayName}
                checked={selected.has(principal.id)}
                disabled={busy || lockedParticipantIds.includes(principal.id)}
                onChange={() => toggle(principal.id)}
                type="checkbox"
              />
              <span>{principal.displayName}</span>
              <small>{principal.type === "agent" ? "Agent" : "成员"}</small>
            </label>
          ))}
        </fieldset>
        <div className="dialog-actions">
          <button className="quiet-button" onClick={onCancel} type="button">
            取消
          </button>
          <button disabled={busy || !name.trim() || selected.size === 0} type="submit">
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
