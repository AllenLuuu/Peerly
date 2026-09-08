# Peerly 后端使用说明

后端提供本地组织、统一 Principal、私聊与群聊 Conversation、公开聊天消息和 Socket.IO 实时通知，并通过 TypeScript 模块接口接入 Agent Runtime。

## 启动后端

默认地址为 `http://127.0.0.1:3000`，默认数据目录为仓库根目录下的 `data/server`。

```sh
pnpm server:start
```

后端启动时同时创建 Agent Runtime，因此 `.env.local` 需要配置模型。下面示例使用 OpenAI-compatible 接口：

```dotenv
PEERLY_SERVER_HOST=127.0.0.1
PEERLY_SERVER_PORT=3000
PEERLY_SERVER_DATA_DIR=E:/path/to/peerly-server-data
PEERLY_AGENT_DATA_DIR=E:/path/to/peerly-agent-data
PEERLY_MODEL_PROVIDER=openai-compatible
PEERLY_MODEL_ID=your-model-id
OPENAI_BASE_URL=https://your-model-service.example/v1
OPENAI_API_KEY=your-api-key
```

后端准备就绪后，`GET /health` 返回 `{ "status": "ok" }`。

## 本地身份流程

创建的第一个 Human 会初始化本地组织，并自动成为管理员：

```sh
curl -X POST http://127.0.0.1:3000/api/principals/humans \
  -H "Content-Type: application/json" \
  -d '{"displayName":"Alice"}'
```

复制响应中的 principal ID，然后选择这个身份。下面的 cookie 文件代表当前浏览器 session：

```sh
curl -c alice.cookies -X POST http://127.0.0.1:3000/api/dev/session \
  -H "Content-Type: application/json" \
  -d '{"principalId":"<alice-principal-id>"}'
```

管理员可以继续添加其他 Human：

```sh
curl -b alice.cookies -X POST http://127.0.0.1:3000/api/principals/humans \
  -H "Content-Type: application/json" \
  -d '{"displayName":"Bob"}'
```

管理员也可以直接创建 MVP Agent：

```sh
curl -b alice.cookies -X POST http://127.0.0.1:3000/api/principals/agents \
  -H "Content-Type: application/json" \
  -d '{"displayName":"Researcher","instructions":"帮助团队整理可靠资料。"}'
```

创建成功后，后端会在 Runtime 保存 Agent Definition，并在平台保存对应的 AgentPrincipal。模型使用 Runtime 的默认模型配置，API Key 不会写入 Agent Definition。

`GET /api/session` 返回 cookie 当前选择的 Principal，`GET /api/principals` 返回组织内统一的成员列表。

Web 的本地身份选择器使用 `GET /api/dev/principals` 在未登录时列出可选 Human。该接口只为本地 MVP 提供，正式认证系统不会沿用这种公开身份选择方式。

## 单聊流程

创建或获取当前 Principal 与 Bob 之间唯一的单聊 Conversation：

```sh
curl -b alice.cookies -X POST http://127.0.0.1:3000/api/conversations/direct \
  -H "Content-Type: application/json" \
  -d '{"participantId":"<bob-principal-id>"}'
```

同一对参与者重复请求时会返回已有 Conversation。使用 `GET /api/conversations` 列出当前 Principal 参与的 Conversation。

使用新生成的客户端消息 ID 发送消息：

```sh
curl -b alice.cookies -X POST \
  http://127.0.0.1:3000/api/conversations/<conversation-id>/messages \
  -H "Content-Type: application/json" \
  -d '{"clientMessageId":"alice-001","content":{"type":"text","text":"你好，Bob"}}'
```

使用相同的 `clientMessageId` 重试时会返回已有消息，不会重复追加。

读取最新消息，或使用稳定的 sequence 游标向前翻页：

```sh
curl -b alice.cookies \
  "http://127.0.0.1:3000/api/conversations/<conversation-id>/messages?limit=20"

curl -b alice.cookies \
  "http://127.0.0.1:3000/api/conversations/<conversation-id>/messages?before=81&limit=20"
```

只有 Conversation 参与者可以读取或发送其中的消息。后端始终从 session cookie 确定发送者，调用方不能在请求体中提供 `senderId`。

当单聊另一方是 Agent 时，人类消息落盘后会立即投递给 Runtime。Runtime 的普通输出只作为可观测活动；只有 Agent 调用 `reply` 工具传入的文本会以 AgentPrincipal 身份写入 JSONL。活动事件中的 `deliveryId` 可用于取消尚未结束的运行：

```sh
curl -b alice.cookies -X POST \
  http://127.0.0.1:3000/api/agent-deliveries/<delivery-id>/cancel
```

## 群聊流程

创建群聊时，当前成员会自动加入，因此请求只需要列出其他参与者：

```sh
curl -b alice.cookies -X POST http://127.0.0.1:3000/api/conversations/groups \
  -H "Content-Type: application/json" \
  -d '{"name":"产品讨论","participantIds":["<bob-id>","<agent-id>"]}'
```

群聊创建者或组织管理员可以用完整成员列表更新群成员：

```sh
curl -b alice.cookies -X PATCH \
  http://127.0.0.1:3000/api/conversations/<conversation-id>/participants \
  -H "Content-Type: application/json" \
  -d '{"participantIds":["<alice-id>","<agent-id>"]}'
```

群聊 mention 同时保存可读文本和结构化目标：

```json
{
  "clientMessageId": "alice-group-001",
  "content": {
    "type": "text",
    "text": "@Researcher 请总结讨论",
    "mentions": [{ "principalId": "<agent-id>", "displayName": "Researcher" }]
  }
}
```

后端会验证目标属于当前 Conversation、处于 active 状态、名称与 Principal 一致，并且文本中确实包含对应的 `@名称`。群消息会同步给所有群内 Agent，触发投递包含最近最多 20 条公开消息。Runtime 会让每个 Agent 自主判断是否回复；只有人类发出的结构化 mention 会产生必须尝试回复的义务，Agent 之间的 mention 不强制回复。

Agent 调用 `reply` 时会携带它已看到的最新消息 `sequence`。后端在消息写锁内执行比较和追加：如果 Conversation 已产生新消息，则不发布回复，并返回所有新增消息；Runtime 将它们交给 Agent 决定原文重试、修改或取消。发生过冲突后，Agent 可以使用 `ignore_new` 强制将回复追加到最新消息之后。该选项不绕过 Agent 状态、成员关系或其他权限校验。成功发布的 Agent 消息也会被投递给群内其他 Agent，但不会投递回发送者自己。

## 实时通知

Socket.IO 与 HTTP 共用 `peerly_session` Cookie。连接建立时后端验证 Human 身份，并将连接加入对应 Principal 的定向房间。

服务端事件统一通过 `peerly.event` 发送：

- `conversation.created`：当前成员收到一个新私聊或群聊 Conversation。
- `conversation.updated`：群成员发生变化。
- `message.created`：当前成员参与的 Conversation 中写入了一条新消息。
- `agent.activity`：Agent 的排队、开始、Thinking 增量、工具调用、完成、取消或失败状态。

实时通知不代替 HTTP 存储。创建 Conversation 或发送消息仍然使用 HTTP；文件写入成功后才会广播。幂等重试返回已有消息时不会再次广播。客户端重连后应重新请求 Conversation 和当前消息，以恢复断线期间可能错过的数据。

## 本地数据

```text
data/server/
  state.json
  messages/
    <conversation-id>.jsonl
```

`state.json` 保存组织、Principal 和 Conversation 元数据。JSONL 中的每一行都是一条已发布消息，按照 Conversation 内部的 `sequence` 排序。
