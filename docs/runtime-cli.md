# Runtime CLI 使用说明

Runtime CLI 是 Peerly Agent Runtime 的本地交互工具。它直接调用 Runtime TypeScript 模块，可用于创建第一个 Agent、管理对话 session、验证模型配置，以及进行流式多轮对话。

它主要服务于 Agent Runtime 的开发和调试，不是最终的 Peerly 聊天客户端。当前 CLI 不经过 Peerly 后端，也不读写平台公开聊天记录。

## 1. 当前能力

Runtime CLI 目前支持：

- 从 `.env.local` 加载模型、凭证和数据目录配置。
- 使用 Pi 内置 provider，或连接带有自定义 Base URL 的 OpenAI-compatible API。
- 在没有可用 Agent 时创建第一个 Agent。
- 从已有的已启用 Agent 中选择一个进行对话。
- 选择已有 session，或创建新 session。
- 与 Agent 进行流式、多轮对话。
- 使用 Ctrl+C 取消当前生成，并继续使用同一个 session。
- 重启 CLI 后恢复 Agent Definition 和 Pi session 历史。

当前不支持：

- 在已有 Agent 的情况下继续创建其他 Agent。
- 在 CLI 中编辑、启用、暂停或删除 Agent。
- 重命名或删除 session。
- 查看完整的 Runtime 内部事件、工具调用或 token 用量。
- 同时操作多个 Agent 或多个 session。

这些管理能力会由后续 Peerly 协作平台提供。

## 2. 环境要求

- Node.js 24
- pnpm 11
- 一个 Pi 支持的模型 provider，或一个 OpenAI-compatible 模型接口

在仓库根目录安装依赖：

```sh
pnpm install
```

复制环境变量模板：

```sh
cp .env.example .env.local
```

Windows PowerShell 可以使用：

```powershell
Copy-Item .env.example .env.local
```

`.env.local` 已被 Git 忽略，不要把 API Key 写入 Agent Definition 或提交到仓库。

## 3. 配置模型

### 3.1 OpenAI-compatible API

如果模型服务实现了 OpenAI-compatible 协议，可使用以下配置：

```dotenv
PEERLY_MODEL_PROVIDER=openai-compatible
PEERLY_MODEL_ID=your-model-id
OPENAI_BASE_URL=https://your-model-service.example/v1
OPENAI_API_KEY=your-api-key
PEERLY_OPENAI_API=chat-completions
PEERLY_AGENT_DATA_DIR=E:/peerly-data/agent-runtime
```

配置含义：

| 变量                    | 是否必需 | 说明                                                           |
| ----------------------- | -------- | -------------------------------------------------------------- |
| `PEERLY_MODEL_PROVIDER` | 是       | OpenAI-compatible 服务固定填写 `openai-compatible`。           |
| `PEERLY_MODEL_ID`       | 是       | 服务实际接受的模型 ID。                                        |
| `OPENAI_BASE_URL`       | 是       | 模型服务的 Base URL；是否包含 `/v1` 取决于服务商。             |
| `OPENAI_API_KEY`        | 是       | 模型服务的访问凭证。                                           |
| `PEERLY_OPENAI_API`     | 否       | `chat-completions` 或 `responses`，默认是 `chat-completions`。 |
| `PEERLY_AGENT_DATA_DIR` | 否       | Runtime 数据目录。建议使用绝对路径。                           |

大多数兼容服务应先尝试 `chat-completions`。只有服务明确支持 OpenAI Responses API 时，才使用：

```dotenv
PEERLY_OPENAI_API=responses
```

### 3.2 Pi 内置 provider

也可以把 `PEERLY_MODEL_PROVIDER` 设置为 Pi 支持的内置 provider，并使用该 provider 的标准凭证环境变量。例如：

```dotenv
PEERLY_MODEL_PROVIDER=anthropic
PEERLY_MODEL_ID=your-model-id
ANTHROPIC_API_KEY=your-api-key
PEERLY_AGENT_DATA_DIR=E:/peerly-data/agent-runtime
```

Runtime 启动时会检查 provider 和 model 是否存在；实际凭证是否有效则会在第一次模型请求时验证。

### 3.3 数据目录

如果没有设置 `PEERLY_AGENT_DATA_DIR`，Runtime 使用相对于当前进程工作目录的 `data/agent-runtime`。

通过根目录的 `pnpm runtime:cli` 启动时，pnpm 会在 CLI workspace 中执行 `start`，因此相对路径可能落在 `apps/runtime-cli/data/agent-runtime`。为避免启动方式改变数据位置，建议始终配置绝对路径。

## 4. 启动 CLI

在仓库根目录运行：

```sh
pnpm runtime:cli
```

该命令会先构建：

1. `@peerly/agent-protocol`
2. `@peerly/agent-runtime`
3. `@peerly/runtime-cli`

然后加载根目录的 `.env.local` 并启动交互界面。

## 5. 首次使用

如果数据目录中没有已启用的 Agent，CLI 会提示创建第一个 Agent：

```text
No enabled Agents found. Create the first Agent.
Agent id [assistant]: researcher
Agent name [Assistant]: Researcher
Instructions [Be a helpful assistant.]: Find and summarize reliable information.
```

- `Agent id` 是本地持久化标识，只能包含字母、数字、下划线和连字符。
- `Agent name` 是 CLI 中显示的名称。
- `Instructions` 是传给 Agent 的系统指令。
- 直接按 Enter 会采用方括号中的默认值。
- 模型配置来自 `.env.local`，创建 Agent 时不需要再次输入。

创建完成后，CLI 会自动创建第一个 session 并进入对话。

## 6. 选择 Agent 和 session

如果已经存在多个已启用 Agent，CLI 会显示编号列表：

```text
Agents:
  1. Researcher (researcher)
  2. Writer (writer)
Select Agent [1]:
```

输入编号并按 Enter。直接按 Enter 选择第一项。已暂停或禁用的 Agent 不会出现在列表中。

如果 Agent 已有 session，CLI 会继续显示：

```text
Sessions:
  1. <session-id> (<created-at>)
  2. New session
Select session [1]:
```

- 选择已有 session 会恢复此前的多轮上下文。
- 选择 `New session` 会创建没有历史上下文的新对话。
- 如果 Agent 尚无 session，CLI 会自动创建一个。

## 7. 对话和命令

进入对话后会看到：

```text
Commands: /new starts a new session, /exit quits.
You>
```

Runtime CLI 当前支持两个文本命令：

| 命令    | 作用                                      |
| ------- | ----------------------------------------- |
| `/new`  | 为当前 Agent 创建并切换到一个新 session。 |
| `/exit` | 正常关闭 Runtime 并退出 CLI。             |

除这两个命令外，输入内容都会作为用户消息发送给当前 Agent。命令会忽略首尾空格，但必须单独输入。

Agent 的文本会边生成边显示：

```text
You> 简要介绍 Peerly
Researcher> Peerly 是一个让人类和 Agent 在同一空间协作的平台……
```

同一 session 内的消息会保留上下文。`/new` 创建的新 session 与旧 session 相互隔离。

## 8. Ctrl+C 行为

Ctrl+C 会根据 CLI 当前状态执行不同操作：

- Agent 正在生成时：取消当前请求，等待 Pi 把 session 安全地写入终态，然后显示 `Cancelled.` 并返回 `You>`。
- CLI 正在等待输入、选择 Agent 或选择 session 时：正常关闭并退出，进程退出码为 `0`。

取消不会删除整个 session。取消完成后可以继续发送消息，也可以退出并在下次启动时恢复该 session。

部分 provider 可能需要短暂时间才能完全停止网络流；CLI 会等待 Pi 完成取消收尾，避免 session 在重启后残留未结束的 operation。

## 9. 数据存储

Runtime 数据结构如下：

```text
<PEERLY_AGENT_DATA_DIR>/
  agents/
    <agent-id>/
      definition.json
      sessions/
        sessions.sqlite
```

- `definition.json` 保存 Agent 名称、instructions、模型标识和启用状态，不保存 API Key。
- `sessions.sqlite` 由 Pi 官方 SQLite session backend 管理，保存 Agent 的私有对话和执行状态。
- CLI 和 Peerly 平台未来展示的公开聊天记录不是同一份数据。

不要手工修改正在使用的 SQLite 文件。同一个数据目录也不应同时由多个 Runtime 进程写入。

## 10. 常见问题

### `MODEL_NOT_FOUND`

`PEERLY_MODEL_PROVIDER` 或 `PEERLY_MODEL_ID` 与 Runtime 可用模型不匹配。检查模型 ID 是否使用了服务商要求的精确值。

### `Missing required environment setting ...`

`.env.local` 缺少必需配置，或变量值为空。OpenAI-compatible 模式需要同时设置 provider、model ID、Base URL 和 API Key。

### `PROVIDER_ERROR: Connection error`

Runtime 已开始调用模型，但无法连接目标服务。检查：

- `OPENAI_BASE_URL` 是否正确。
- 服务是否要求 `/v1` 路径。
- 本机网络、代理或防火墙是否允许访问该地址。
- 服务是否支持所选的 `chat-completions` 或 `responses` API。

### 认证失败或 HTTP 401/403

检查 provider 对应的 API Key。凭证只从环境变量解析，修改 `.env.local` 后需要重启 CLI。

### 找不到之前创建的 Agent

通常是本次启动使用了不同的数据目录。检查 `PEERLY_AGENT_DATA_DIR`，尤其注意相对路径会根据启动工作目录变化。

### pnpm 显示 `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`

这是 pnpm 对子命令失败的汇总提示，真正原因通常位于它之前的 Runtime 或 Node 错误信息中。优先检查前面的第一条错误。

## 11. 与 Runtime 的关系

CLI 不直接调用模型 SDK，也不通过 HTTP 调用 Runtime。依赖关系是：

```text
Runtime CLI → Agent Runtime → Pi Agent / Pi Session
```

发送一条消息时，CLI 消费 Runtime 返回的事件流：

```text
run_queued
→ run_started
→ output_delta × N
→ run_completed | run_cancelled | run_failed
```

每次调用只有一个终态事件。同一 `(agentId, sessionId)` 的请求按 FIFO 执行，不同 session 可以并行执行。
