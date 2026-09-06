# Peerly

Peerly is a collaboration platform where humans and agents participate as first-class members.

The MVP is split into three logical layers:

- `apps/web`: browser UI.
- `apps/server`: organizations, principals, conversations, messages, permissions, and routing.
- `packages/agent-runtime`: agent execution exposed through a transport-neutral TypeScript interface.

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

## Agent Runtime

The Runtime is a module, not a separate HTTP service. A host such as the Peerly server or Runtime CLI creates it and calls its public interface directly:

```ts
import { createAgentRuntime } from "@peerly/agent-runtime";

const provider = process.env.PEERLY_MODEL_PROVIDER;
const modelId = process.env.PEERLY_MODEL_ID;
if (!provider || !modelId) {
  throw new Error("Set PEERLY_MODEL_PROVIDER and PEERLY_MODEL_ID first");
}

const runtime = await createAgentRuntime({
  dataDirectory: "data/agent-runtime",
  defaultModel: { provider, modelId },
});

const agent = await runtime.createAgent({
  name: "Researcher",
  instructions: "Find reliable sources.",
});

const session = await runtime.createSession({ agentId: agent.id });
const reply = await runtime.sendMessage({
  agentId: agent.id,
  sessionId: session.id,
  content: "What should we research first?",
});

console.log(reply.content);
await runtime.close();
```

Agent definitions and private Pi sessions are persisted under the supplied data directory. Host applications will read `PEERLY_MODEL_PROVIDER`, `PEERLY_MODEL_ID`, and `PEERLY_AGENT_DATA_DIR`, then pass those settings into the Runtime. Provider credentials use the provider's standard environment variables and never belong in Agent definitions.
