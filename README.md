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

The Runtime is a module, not a separate HTTP service. Copy `.env.example` to `.env.local`, configure a model, then start the interactive CLI:

```sh
pnpm runtime:cli
```

See the [Runtime CLI usage guide](docs/runtime-cli.md) for configuration, commands, data storage, cancellation behavior, and troubleshooting.

For an OpenAI-compatible endpoint, set `PEERLY_MODEL_PROVIDER=openai-compatible`, `PEERLY_MODEL_ID`, `OPENAI_BASE_URL`, and `OPENAI_API_KEY`. `PEERLY_OPENAI_API` may be `chat-completions` (the default) or `responses`.

A host such as the Peerly server or Runtime CLI creates the Runtime and consumes one event stream per message:

```ts
import { createAgentRuntimeFromEnvironment } from "@peerly/agent-runtime";

const runtime = await createAgentRuntimeFromEnvironment();

const agent = await runtime.createAgent({
  name: "Researcher",
  instructions: "Find reliable sources.",
});

const session = await runtime.createSession({ agentId: agent.id });
const controller = new AbortController();
for await (const event of runtime.sendMessage(
  {
    agentId: agent.id,
    sessionId: session.id,
    content: "What should we research first?",
  },
  { signal: controller.signal },
)) {
  if (event.type === "output_delta") process.stdout.write(event.delta);
}
await runtime.close();
```

Messages to the same Agent session run in FIFO order; different sessions can run concurrently. The caller cancels an active or queued message with its `AbortSignal`. Agent definitions and private Pi sessions are persisted under the configured data directory, while active queues and streams are process-local. Provider credentials never belong in Agent definitions.
