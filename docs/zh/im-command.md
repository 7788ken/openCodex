# IM 命令

## 目的

`opencodex im` 用来把 openCodex 接到即时通讯平台上，而不是依赖会变化的本地 IP 地址。
第一版优先支持 Telegram，因为它允许本机通过长轮询收消息，不需要额外开放公网 webhook。

## 第一版范围

第一版只支持 Telegram：

- `opencodex im telegram listen`
- `opencodex im telegram inbox`
- `opencodex im telegram send`

## Telegram 流程

`telegram listen` 会做这些事：

- 调用 `getMe` 校验 bot token
- 调用 `getWebhookInfo`，避免长轮询和已存在的 webhook 默默冲突
- 通过 `getUpdates` 做长轮询
- 把归一化后的入站消息保存到 session artifact
- 自动给同一个 Telegram chat 回一条确认回执
- 可选地把每条入站消息升级成一条 CTO 编排工作流，worker 默认使用 `full-access` 权限
- 先拆出可并行的后台任务，启动已就绪任务，并把等待确认的工作流保存在本地 session 里
- 当检测到历史卡住的 CTO workflow 时，会默认插入一条清理/修复维护任务
- 给同一个 Telegram chat 回确认回执、任务拆解进度，以及最终结果或待确认问题
- 当 CEO 追问最近工作流或指定工作流状态时，直接回工作流汇报，而不是新开一条工作流
- 当 CEO 询问 `最近任务` / `任务历史` 这类问题时，直接回一份适合手机阅读的简版任务历史
- 让这条连接继续出现在正常的 session store 中

`telegram inbox` 会从最新一条 Telegram IM session 里读取最近消息。
`telegram send` 则可以把回复消息发回指定的 Telegram chat。

## 输入

### `telegram listen`

- `--cwd <dir>`
- `--bot-token <token>` 或 `OPENCODEX_TELEGRAM_BOT_TOKEN`
- `--chat-id <id>`，用于只接收某一个 chat 的消息
- `--poll-timeout <seconds>`
- `--clear-webhook`
- `--cto`，把每条消息交给本地 Codex CLI，以 openCodex CTO 身份处理
- `--profile <name>`，在 `--cto` 模式下控制委托给 `opencodex run` 的 profile；默认值：`full-access`

出于安全考虑，`--cto` 必须配合 `--chat-id <id>` 一起使用。
这样可以避免任意 Telegram 用户驱动本机执行任务。

### `telegram inbox`

- `--cwd <dir>`
- `--limit <n>`
- `--json`

### `telegram send`

- `--cwd <dir>`
- `--bot-token <token>` 或 `OPENCODEX_TELEGRAM_BOT_TOKEN`
- `--chat-id <id>`
- `--reply-to-message-id <id>`
- 位置参数里的消息文本

## 存储产物

每一条 Telegram listen session 会保存：

- `telegram-updates.jsonl` — 归一化后的入站消息
- `telegram-replies.jsonl` — 确认回执和结果回包
- `telegram-state.json` — 最近的 polling offset 和监听状态
- `telegram-log.txt` — 监听生命周期日志
- `telegram-runs.jsonl` — 开启 `--cto` 后的 CTO 规划与任务执行记录

在 `--cto` 模式下，每条入站 Telegram 消息现在都会先生成一条专用的 `cto` 工作流 session。这个工作流下面可以再挂规划和执行用的 `run` 子 session，也可以在需要时进入“等待 CEO 确认”状态，并在同一个 chat 的下一条 Telegram 回复里继续推进。

## 安全说明

- bot token 要按密码来保管。
- 如果同一个 bot 已经配置了 webhook，openCodex 默认会直接报错；只有显式传入 `--clear-webhook` 才会清掉它。
- `--cto` 模式应始终和明确的 `--chat-id` 一起使用。
- 这个设计让本机始终走出站长轮询，所以手机连通性不依赖稳定的本地 IP。

## 官方参考

- Telegram Bot API：`https://core.telegram.org/bots/api`

## Telegram CTO 追问查询

在 `--cto` 模式下，同一个 chat 现在可以发起轻量追问，而不需要为每次追问都新开一条工作流。

当前支持的追问类型包括：

- 工作流状态类问题，例如 `安排了哪些任务`、`workflow status`、`task status`
- 带明确工作流引用的问题，例如 `Workflow: cto-... 安排了哪些任务`
- 最近历史类问题，例如 `最近任务`、`任务历史`、`recent tasks`、`task history`
- 取消控制类消息，例如 `取消`、`cancel`、`stop`、`Workflow: cto-... cancel`

状态类查询会返回匹配工作流的摘要；最近历史类查询会返回这个 Telegram chat 下最近已知的 CTO 任务记录简表。
