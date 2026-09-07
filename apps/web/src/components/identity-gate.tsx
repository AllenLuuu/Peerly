import type { HumanPrincipal } from "@peerly/contracts";
import { useState, type FormEvent } from "react";

interface IdentityGateProps {
  principals: HumanPrincipal[];
  busy: boolean;
  onBootstrap(displayName: string): Promise<void>;
  onSelect(principalId: string): Promise<void>;
}

export function IdentityGate({ principals, busy, onBootstrap, onSelect }: IdentityGateProps) {
  const [displayName, setDisplayName] = useState("");

  if (principals.length > 0) {
    return (
      <main className="identity-shell">
        <section className="identity-card">
          <p className="eyebrow">本地开发环境</p>
          <h1>选择你的身份</h1>
          <p className="muted">使用一个已有成员进入 Peerly。</p>
          <div className="identity-list">
            {principals.map((principal) => (
              <button
                className="identity-option"
                disabled={busy}
                key={principal.id}
                onClick={() => void onSelect(principal.id)}
                type="button"
              >
                <Avatar name={principal.displayName} />
                <span>
                  <strong>{principal.displayName}</strong>
                  <small>{principal.role === "admin" ? "管理员" : "成员"}</small>
                </span>
              </button>
            ))}
          </div>
        </section>
      </main>
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (displayName.trim()) void onBootstrap(displayName.trim());
  }

  return (
    <main className="identity-shell">
      <section className="identity-card">
        <p className="eyebrow">创建你的协作空间</p>
        <h1>欢迎使用 Peerly</h1>
        <p className="muted">先创建第一位管理员，之后可以从成员列表添加同事。</p>
        <form className="stack" onSubmit={submit}>
          <label htmlFor="bootstrap-name">你的名字</label>
          <input
            autoFocus
            id="bootstrap-name"
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="例如：Alice"
            value={displayName}
          />
          <button disabled={busy || !displayName.trim()} type="submit">
            创建管理员
          </button>
        </form>
      </section>
    </main>
  );
}

export function Avatar({ name }: { name: string }) {
  return <span className="avatar">{name.trim().charAt(0).toUpperCase()}</span>;
}
