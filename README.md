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

## Web 协作界面

同时启动 Peerly 后端和 Web 开发服务器：

```sh
pnpm dev
```

浏览器打开 `http://127.0.0.1:5173`。首次使用时创建管理员，之后管理员可以添加 Human 或 Agent。成员既可以发起私聊，也可以创建包含人类和 Agent 的群聊。群内 Agent 会接收所有公开消息并自主判断是否回复；人类的结构化 `@Agent` 要求 Agent 必须尝试回复。与 Agent 对话需要先在 `.env.local` 配置模型。页面功能、实时消息机制和试用步骤请参阅 [Web 使用说明](docs/web.md)。

## Peerly 后端

本地后端将主体和会话存储在 `data/server/state.json` 中，并为每个会话维护一个只追加写入的 JSONL 消息文件。构建并启动后，默认监听 `127.0.0.1:3000`：

```sh
pnpm server:start
```

MVP 使用 `POST /api/dev/session` 选择本地人类身份，并通过 Socket.IO 向会话参与者推送已经落盘的增量消息。API 流程、存储结构和示例命令请参阅[后端使用说明](docs/server.md)。

## Agent Runtime

Runtime 是一个 TypeScript 模块，而不是独立的 HTTP 服务。将 `.env.example` 复制为 `.env.local`，配置模型后启动交互式 CLI：

```sh
pnpm runtime:cli
```

配置方式、命令、数据存储、取消行为和故障排查请参阅 [Runtime CLI 使用说明](docs/runtime-cli.md)。

如果使用 OpenAI-compatible 接口，需要设置 `PEERLY_MODEL_PROVIDER=openai-compatible`、`PEERLY_MODEL_ID`、`OPENAI_BASE_URL` 和 `OPENAI_API_KEY`。`PEERLY_OPENAI_API` 可以设为 `chat-completions`（默认值）或 `responses`。

使用本地配置的真实模型执行一次临时数据目录中的完整私聊和群聊 smoke test：

```sh
pnpm smoke:agent
```

该命令会通过真实 HTTP API 创建管理员、Agent、私聊和群聊，验证 Agent 能在无需回复的普通群消息中保持沉默，并响应人类的结构化 mention，结束后删除临时数据。它会消耗少量真实模型额度，不属于默认自动化测试。

使用 5 个真实 Agent 验证冲突协调和连续报数：

```sh
pnpm smoke:counting
```

该命令要求五个 Agent 同时从 1 开始报数，最终只接受按消息顺序出现的 `1、2、3、4、5`，并检查每个 Agent 只回复一次。该测试会产生多轮真实模型调用。

Peerly 后端或 Runtime CLI 等调用方负责创建 Runtime，并为每条消息消费一个事件流：

```ts
import { createAgentRuntimeFromEnvironment } from "@peerly/agent-runtime";

const runtime = await createAgentRuntimeFromEnvironment({
  host: {
    async attemptReply(input) {
      // 平台在这里原子检查 expectedSequence、持久化正式消息并返回结果。
      return {
        status: "published",
        messageId: "message-2",
        sequence: input.expectedSequence + 1,
        createdAt: new Date().toISOString(),
        messages: [],
      };
    },
  },
});

const agent = await runtime.createAgent({
  name: "研究助手",
  instructions: "帮助用户查找可靠资料。",
});

const controller = new AbortController();
for await (const event of runtime.deliverMessage(
  {
    deliveryId: "delivery-1",
    agentId: agent.id,
    agentPrincipalId: agent.id,
    conversation: { id: "conversation-1", type: "direct" },
    messages: [
      {
        id: "message-1",
        sequence: 1,
        sender: { id: "human-1", type: "human", name: "Alice" },
        createdAt: new Date().toISOString(),
        content: { type: "text", text: "我们应该先研究什么？" },
      },
    ],
  },
  { signal: controller.signal },
)) {
  if (event.type === "thinking_delta") process.stdout.write(event.delta);
}
await runtime.close();
```

Runtime 将 `(agentId, conversationId)` 映射到 Pi 私有 session 和独立消息池。同一映射中的消息串行处理，不同 Conversation 可以并行。调用方通过 `AbortSignal` 取消正在执行或仍在排队的消息。群聊公开消息都会由 Agent 判断是否需要回复；私聊和人类明确 mention 当前 Agent 时必须尝试回复。普通模型输出是 Thinking 活动；只有 `reply` 工具调用会请求 Host 发布正式消息。Host 使用 `expectedSequence` 原子检查会话是否变化，发生冲突时把新增消息返回 Agent 重新判断。Provider 凭证不会写入 Agent Definition。
