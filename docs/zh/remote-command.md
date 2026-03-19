# Remote 命令

## 目的

`opencodex remote` 用来给本地 openCodex 工作区开放一个适合手机使用的消息入口。
它提供轻量的远程 inbox，但不会替代 Codex CLI 作为本地执行引擎。

## 第一版流程

第一版提供三个子命令：

- `opencodex remote serve`
- `opencodex remote inbox`
- `opencodex remote status`

`remote serve` 会启动一个带 token 保护的本地 HTTP 服务。
它会创建一个 `remote` session，打印手机访问 URL，把收到的消息保存到当前 `remote` session 的 artifact 中，同时保留正常的 openCodex 审计轨迹。
`remote inbox` 默认从“优先 remote session”读取最近消息（优先 active，会话不存在时回退到最新历史记录），也支持显式指定目标会话。
`remote status` 使用同一套选择模型，输出面向部署与排障的状态快照，包括：

- 会话选择来源（`active`、`latest_history`、`explicit_latest`、`explicit_id`）
- 绑定范围与暴露级别
- 消息数量与最近一条消息
- 优先会话处于运行中时的实时 `/health` 探测结果（含探测时间与延迟）
- 成功检查项（`/health`、表单投递、inbox 可见性）
- 常见故障提示

## 输入

### `remote serve`

- `--cwd <dir>`
- `--host <host>`
- `--port <n>`
- `--token <value>`
- `--json`

### `remote inbox`

- `--cwd <dir>`
- `--limit <n>`
- `--session-id <id|latest>`（可选）
- `--json`

### `remote status`

- `--cwd <dir>`
- `--json`
- `--session-id <id|latest>`（可选，仅 status 使用）

会话选择规则（`remote inbox` 与 `remote status` 共用）：

- 默认：优先 active `remote` session（`running` / `queued`），否则回退最新历史（`latest_history`）
- `--session-id latest`：强制按更新时间选择最新 `remote` session（`explicit_latest`）
- `--session-id <id>`：仅查看指定 `remote` session（`explicit_id`）

## HTTP 接口

第一版暴露这些接口：

- `GET /` — 适合手机访问的 HTML 页面
- `GET /health` — 就绪检查
- `GET /api/messages?token=...` — 以 JSON 返回最近消息
- `POST /api/messages` — 带 token 鉴权的消息提交入口
- `POST /send` — HTML 表单提交入口

支持的鉴权输入：

- `Authorization: Bearer <token>`
- query string 中的 `token`
- JSON 或 form body 中的 `token`

## 存储产物

bridge 会把收到的消息保存到当前 `remote` session 的 artifact 中：

- `messages.jsonl` — 位于 session artifacts 目录下的追加式消息日志

`remote` 会优先展示 active 会话；没有 active 时回退到最新历史会话。这个优先会话可以继续通过 `opencodex session` 和 `opencodex remote inbox` 查看。
如果需要快速查看运行状态并按清单排障，使用 `opencodex remote status`。

## 安全说明

- 第一版坚持 local-first，并使用 token 做保护。
- 生成的 token 要按密码来保管。
- 如果要让手机在公网访问，请把这个本地 HTTP bridge 放到你自己控制的安全 tunnel 或 VPN 后面。
- 当前版本不提供官方托管 relay 服务。

## 非目标

第一版暂不提供：

- 托管式公网 relay
- 多用户身份体系
- 对正在运行的 Codex turn 做远程实时控制
- 从 openCodex 反向推送消息到手机
