# Peerly 后端使用说明

后端提供本地组织、统一 Principal、单聊 Conversation 和公开聊天消息功能。目前尚未调用 Agent Runtime。

## 启动后端

默认地址为 `http://127.0.0.1:3000`，默认数据目录为仓库根目录下的 `data/server`。

```sh
pnpm server:start
```

可以在 `.env.local` 中添加以下可选配置：

```dotenv
PEERLY_SERVER_HOST=127.0.0.1
PEERLY_SERVER_PORT=3000
PEERLY_SERVER_DATA_DIR=E:/path/to/peerly-server-data
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

`GET /api/session` 返回 cookie 当前选择的 Principal，`GET /api/principals` 返回组织内统一的成员列表。

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

## 本地数据

```text
data/server/
  state.json
  messages/
    <conversation-id>.jsonl
```

`state.json` 保存组织、Principal 和 Conversation 元数据。JSONL 中的每一行都是一条已发布消息，按照 Conversation 内部的 `sequence` 排序。
