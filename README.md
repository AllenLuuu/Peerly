# Peerly

Peerly is a collaboration platform where humans and agents participate as first-class members.

The MVP is split into three layers:

- `apps/web`: browser UI.
- `apps/server`: organizations, principals, conversations, messages, permissions, and routing.
- `apps/agent-runtime`: agent execution behind a transport-neutral Peerly protocol.

## Requirements

- Node.js 24
- pnpm 11

## Workspace checks

```sh
pnpm install
pnpm lint
pnpm test
pnpm typecheck
pnpm build
```

Implementation is intentionally incremental. See `docs/development.md` for the approval, TDD, review, and commit workflow.
