# telegram-codex-bridge 基线调研

- 调研对象仓库：`https://github.com/InDreamer/telegram-codex-bridge`
- 本地基线：`/tmp/telegram-codex-bridge`（HEAD: `bd66e09`）
- 调研时间：2026-03-23

## 1) 项目目的与运行模型

`telegram-codex-bridge` 的定位是把 Telegram 作为 Codex 的远程控制面，桥接层本身不替代 Codex 推理引擎，只负责会话管理、Telegram UI 适配、协议转发和持久化状态管理（参考 `README.md`、`docs/architecture/runtime-and-state.md`、`src/service.ts`）。

运行模型是一个常驻单进程服务：

1. 通过 `ctb service run` 进入服务主循环（`src/cli.ts`）。
2. 启动时先打开 SQLite 状态库、做 readiness 检查并建立 app-server 连接（`src/service.ts`）。
3. 通过 Telegram long polling 拉取消息/回调（`src/telegram/poller.ts` + `src/telegram/api.ts`）。
4. 把 Telegram 输入路由到命令处理、交互处理或 turn 执行（`src/service.ts`、`src/service/command-router.ts`、`src/service/callback-router.ts`）。
5. app-server 事件再回流为运行态卡片、交互卡片、最终答复消息（`src/service/turn-coordinator.ts`、`src/service/runtime-surface-controller.ts`、`src/service/interaction-broker.ts`）。

## 2) 架构草图（高层）

```text
Telegram user
   |
   | getUpdates / callbacks / messages
   v
TelegramPoller + TelegramApi
   |
   v
BridgeService (service shell)
   |-- command-router / callback-router
   |-- session-project-coordinator
   |-- codex-command-coordinator
   |-- rich-input-adapter
   |-- interaction-broker
   |-- turn-coordinator
   |-- runtime-surface-controller
   |
   | JSON-RPC over stdio
   v
Codex app-server child process
   |
   v
Project workspace (thread + turn execution)

State sidecar:
BridgeStateStore (SQLite) 持久化授权、会话、交互、runtime 卡片偏好、final answer 视图等。
```

## 3) 关键模块与入口点

### 3.1 控制流入口

- `src/cli.ts`
  - `ctb` 命令入口；`service run` 最终调用 `runBridgeService`。
- `src/service.ts`
  - `runBridgeService(importMetaUrl)`：加载路径与配置、注册 SIGINT/SIGTERM、启动 `BridgeService.run()`。
  - `BridgeService.run()`：服务启动主流程（store/readiness/app-server/api/poller）。
- `src/telegram/poller.ts`
  - `TelegramPoller.run()`：循环 `getUpdates`，逐条回调 `onUpdate` 并写入 offset 文件。

### 3.2 主要职责模块

- `src/service/command-router.ts`：把命令名映射到 handler（含不支持命令分支）。
- `src/service/callback-router.ts`：把按钮回调 `ParsedCallbackData` 分发到具体动作。
- `src/service/session-project-coordinator.ts`：`/new` 选项目、会话切换、归档/反归档、重命名、`/where`、`/status` 等。
- `src/service/turn-coordinator.ts`：turn 启动、事件消费、终态收敛、最终答复投递。
- `src/service/interaction-broker.ts`：approval/questionnaire/text-mode 交互卡片与 server request 响应。
- `src/service/runtime-surface-controller.ts`：Hub/状态卡片/错误卡片/inspect 展示策略。
- `src/codex/app-server.ts`：本地 app-server 子进程与 JSON-RPC 协议封装。
- `src/state/store.ts` + `src/state/store-*.ts`：SQLite 持久化 façade 与分层实现。

## 4) 重要目录/文件一览（角色一句话）

| 路径 | 角色 |
|---|---|
| `src/cli.ts` | CLI 入口与 install/admin/service 子命令分发 |
| `src/service.ts` | 服务壳层：启动编排、Telegram 输入接入、各 coordinator 装配 |
| `src/service/` | 运行时域模块（命令、会话、交互、turn、runtime surface） |
| `src/telegram/api.ts` | Telegram Bot HTTP API 调用封装（消息、回调、文件） |
| `src/telegram/poller.ts` | long polling 循环与 offset 持久化 |
| `src/telegram/ui-*.ts` | Telegram 展示文案、按钮编码/解码、final-answer 渲染 |
| `src/codex/app-server.ts` | Codex app-server 进程管理 + JSON-RPC client |
| `src/state/store.ts` | 状态层统一入口（SQLite），内部拆分到 `store-*.ts` |
| `docs/architecture/runtime-and-state.md` | 运行时与状态架构约束说明 |
| `docs/architecture/current-code-organization.md` | 当前代码组织与模块 ownership 地图 |

## 5) Telegram 控制通道、编排与会话生命周期（高层）

### 5.1 Telegram 控制通道

1. `TelegramPoller` 从 Telegram 拉取 `message/callback_query`（`src/telegram/poller.ts`）。
2. `BridgeService.handleUpdate` 分流到 `handleMessage` 或 `handleCallback`（`src/service.ts`）。
3. 文本命令通过 `parseCommand` + `routeBridgeCommand` 进入命令处理链（`src/telegram/ui-callbacks.ts`、`src/service/command-router.ts`）。
4. 按钮回调通过 `parseCallbackData` + `routeBridgeCallback` 进入回调链（`src/telegram/ui-callbacks.ts`、`src/service/callback-router.ts`）。

### 5.2 Agent/Turn 编排路径

1. normal text 或 structured input 最终进入 `TurnCoordinator.startTextTurn/startStructuredTurn`（`src/service.ts`、`src/service/turn-coordinator.ts`）。
2. `ensureSessionThreadState` 保证 thread 可用（首次 `startThread`，已存在则 `resumeThread`，缺失时重建）（`src/service/turn-coordinator.ts`）。
3. `startTurn` 发起执行，`beginActiveTurn` 将 session 标记为 running 并挂载 tracker/status card（`src/service/turn-coordinator.ts`）。
4. app-server 通知通过 `classifyNotification` 进入状态机，持续同步 runtime cards（`src/service/turn-coordinator.ts`）。
5. `turn_completed` 后收敛交互、更新 session 状态、投递 final answer 或 plan result（`src/service/turn-coordinator.ts`）。

### 5.3 会话生命周期

- 创建：`/new` 走项目选择器，`store.createSession(...)` 创建会话（`src/service/session-project-coordinator.ts`）。
- 激活与运行：活跃会话由 store 维护，turn 期间状态变为 `running`（`src/state/store.ts`、`src/service/turn-coordinator.ts`）。
- 终态：完成/中断/失败分别写回 session 状态（`markSessionSuccessful` 或 `updateSessionStatus`）（`src/service/turn-coordinator.ts`）。
- 归档：`archive/unarchive` 同步本地会话与远端 thread 归档状态（`src/service/session-project-coordinator.ts`、`src/service/thread-archive-reconciler.ts`）。

## 6) 事实观察（带代码证据）

1. 服务启动时如果发现“上次运行中断”，会把 running session 统一标记失败并尝试发送恢复 Hub，不会静默丢状态（`src/service.ts` 中 `markRunningSessionsFailedWithNotices`、`sendRecoveryHub`）。
2. Telegram offset 文件采用“临时文件 + rename”原子写，避免进程崩溃造成半写入（`src/telegram/poller.ts` 的 `writeOffset`）。
3. 控制面是单用户绑定模型：未授权用户只能进入 pending authorization 或被拒绝访问（`src/service.ts` 的 `authorizeMessageSender/authorizeCallbackSender`，`src/state/store.ts` 的授权表逻辑）。
4. 命令和回调都采用独立 router 模块，`service.ts` 只做 glue，不直接写大规模 switch 业务逻辑（`src/service/command-router.ts`、`src/service/callback-router.ts`）。
5. turn 启动前有并发上限控制，同一 chat 默认最多 10 个 running session（`src/service/turn-coordinator.ts` 的 `MAX_RUNNING_SESSIONS_PER_CHAT` 与 `getRunningTurnCapacity`）。
6. 当 app-server 中途退出时，桥接会失败当前运行 turn、清理 pending interactions 并尝试重连，而不是保持假在线（`src/service.ts` 的 `handleAppServerExit`，`src/service/turn-coordinator.ts` 的 `handleActiveTurnAppServerExit`）。
7. final answer 采用“可折叠 + 分页 + SQLite 持久化”的视图模型，按钮在重启后可继续用（`src/service/turn-coordinator.ts` 的 `sendFinalAnswer` 流程，`docs/architecture/runtime-and-state.md` 的 `final_answer_view` 说明）。
8. 交互卡片（approval/questionnaire/text mode）走持久化 broker，并支持 `serverRequest/resolved` 反向关闭卡片，避免卡片与真实状态漂移（`src/service/interaction-broker.ts`、`src/service/turn-coordinator.ts`）。
9. callback data 统一做短编码并受 64-byte 限制约束，避免 Telegram 按钮 payload 越界（`src/telegram/ui-callbacks.ts` 的 `TELEGRAM_CALLBACK_DATA_LIMIT_BYTES` 与 encode 系列方法）。

## 7) 简短结论

这是一个“Telegram 控制面 + 本地桥接编排 + Codex app-server 执行核 + SQLite 状态层”的单机高信任架构。代码组织上已将复杂逻辑从 `service.ts` 拆到多个 coordinator，但 `service.ts` 仍是启动与接入总线，阅读顺序建议从 `cli.ts -> service.ts -> service/*coordinator -> codex/app-server.ts -> state/store.ts`。
