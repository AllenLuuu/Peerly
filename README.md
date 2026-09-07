# Peerly

Peerly 是一个让人类和 Agent 以一等成员身份共同参与的协作平台。

MVP 分为三个逻辑层：

- `apps/web`：浏览器界面。
- `apps/server`：组织、主体、会话、消息、权限和消息路由。
- `packages/agent-runtime`：Agent 执行能力，通过与传输方式无关的 TypeScript 接口提供。

## 环境要求

- Node.js 24
- pnpm 11

## 工作区检查

```sh
pnpm install
pnpm lint
pnpm test
pnpm typecheck
pnpm build
```

项目采用分步骤实现方式。审批、TDD、Review 和提交规范请参阅[开发流程](docs/development.md)。

## Peerly 后端

本地后端将主体和会话存储在 `data/server/state.json` 中，并为每个会话维护一个只追加写入的 JSONL 消息文件。构建并启动后，默认监听 `127.0.0.1:3000`：

```sh
pnpm server:start
```

MVP 使用 `POST /api/dev/session` 选择本地人类身份。API 流程、存储结构和示例命令请参阅[后端使用说明](docs/server.md)。

## Agent Runtime

Runtime 是一个 TypeScript 模块，而不是独立的 HTTP 服务。将 `.env.example` 复制为 `.env.local`，配置模型后启动交互式 CLI：

```sh
pnpm runtime:cli
```

配置方式、命令、数据存储、取消行为和故障排查请参阅 [Runtime CLI 使用说明](docs/runtime-cli.md)。

如果使用 OpenAI-compatible 接口，需要设置 `PEERLY_MODEL_PROVIDER=openai-compatible`、`PEERLY_MODEL_ID`、`OPENAI_BASE_URL` 和 `OPENAI_API_KEY`。`PEERLY_OPENAI_API` 可以设为 `chat-completions`（默认值）或 `responses`。

Peerly 后端或 Runtime CLI 等调用方负责创建 Runtime，并为每条消息消费一个事件流：

```ts
import { createAgentRuntimeFromEnvironment } from "@peerly/agent-runtime";

const runtime = await createAgentRuntimeFromEnvironment();

const agent = await runtime.createAgent({
  name: "研究助手",
  instructions: "帮助用户查找可靠资料。",
});

const session = await runtime.createSession({ agentId: agent.id });
const controller = new AbortController();
for await (const event of runtime.sendMessage(
  {
    agentId: agent.id,
    sessionId: session.id,
    content: "我们应该先研究什么？",
  },
  { signal: controller.signal },
)) {
  if (event.type === "output_delta") process.stdout.write(event.delta);
}
await runtime.close();
```

同一个 Agent session 中的消息按 FIFO 顺序执行，不同 session 可以并行执行。调用方通过 `AbortSignal` 取消正在执行或仍在排队的消息。Agent Definition 和 Pi 私有 session 持久化在配置的数据目录中，活动队列和事件流只存在于当前进程。Provider 凭证不会写入 Agent Definition。
