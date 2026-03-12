# Service 命令

## 目的

`opencodex service` 用来把 Telegram CTO 通道固化成 macOS 本地后台服务。
它会安装用户级 `launchd` agent，让 Telegram 监听器不依赖当前终端窗口，同时还能可选生成一个轻量菜单栏 app。

## 第一版范围

第一版先只支持 Telegram CTO 服务管理：

- `opencodex service telegram install`
- `opencodex service telegram status`
- `opencodex service telegram start`
- `opencodex service telegram stop`
- `opencodex service telegram restart`
- `opencodex service telegram set-profile`
- `opencodex service telegram set-workspace`
- `opencodex service telegram relink`
- `opencodex service telegram set-setting`
- `opencodex service telegram supervise`
- `opencodex service telegram send-status`
- `opencodex service telegram workflow-history`
- `opencodex service telegram workflow-detail`
- `opencodex service telegram task-history`
- `opencodex service telegram dispatch-detail`
- `opencodex service telegram reset-cto-soul`
- `opencodex service telegram uninstall`

## `install` 会做什么

`telegram install` 会创建并管理这些本地资产：

- 放到 `~/Library/LaunchAgents` 下面的 `launchd` plist
- 一个启动 `opencodex im telegram listen --cto` 的 wrapper shell script
- 一个带 Telegram bot token 与代理变量的受保护 env 文件
- 后台监听器的持久 stdout / stderr 日志
- 在开启 `--install-menubar` 时，额外生成一个 stay-open 的 macOS 菜单栏 app
- 当未提供 `--cwd` 时，自动创建一个独立默认 workspace：`~/.opencodex/workspaces/telegram-cto`
- 一组 service-local 的 CTO soul 文件，默认放在 service state dir 下面：
  `cto-soul.md`、`cto-chat-soul.md`、`cto-workflow-soul.md`
- 一组 service-local 的子代理 soul 文件：
  `cto-reply-agent-soul.md`、`cto-planner-agent-soul.md`、`cto-worker-agent-soul.md`

默认情况下，`install` 会拒绝把长期后台服务绑定到当前源码 checkout。
规范流程应从已安装的 openCodex CLI 执行安装；只有在你明确接受“服务跟随当前开发仓库”时，才使用 `--allow-project-cli`。

## 输入

### `telegram install`

- `--cwd <dir>`；可选，service workspace 根目录。默认：`~/.opencodex/workspaces/telegram-cto`
- `--chat-id <id>`
- `--bot-token <token>` 或 `OPENCODEX_TELEGRAM_BOT_TOKEN`
- `--cli-path <path>`；可选，显式指定后台服务要绑定的 openCodex CLI 入口
- `--cto-soul-path <path>`；可选，显式指定共享层 service-local CTO soul 文件路径；chat/workflow 两层会默认放在同目录下
- `--poll-timeout <seconds>`
- `--profile <name>`；默认值：`full-access`
- `--allow-project-cli`；显式允许把服务绑定到当前项目 checkout
- `--install-menubar`
- `--open-menubar`
- `--no-load`
- `--json`

### `telegram relink`

- `--cli-path <path>`；必填，新的独立 openCodex CLI 入口
- `--allow-project-cli`；仅在你明确要临时回退到源码 checkout 时使用
- `--json`

`telegram relink` 会保留现有 service 的 chat 绑定和其他配置，只重写保存下来的 launcher 路径、wrapper 脚本，以及菜单栏 app 内嵌的 CLI 入口。
如果这个新入口来自 `opencodex install detached`，应优先使用 `current/bin/opencodex.js`，这样后续升级切换 `current` 时 service 会自动跟上。

### `telegram set-workspace`

- `--cwd <dir>`；必填，新的 service workspace 根目录
- `--cto-soul-path <path>`；可选，覆盖共享层 service-local CTO soul 文件路径；chat/workflow 两层会跟随切换到同目录
- `--json`

`telegram set-workspace` 会保留当前 launcher、chat 绑定和其他配置，只重写保存下来的 workspace 路径、wrapper 脚本，以及菜单栏 app 里内嵌的工作区入口。
如果当前 CTO soul 仍来自旧 workspace，openCodex 会先把它复制到 service-local soul 文件，再切换工作区。
如果新 workspace 下面还没有 `.opencodex/sessions` 目录，openCodex 也会把已有 session 历史一起迁过去，避免切换后状态面板和任务栏历史突然归零。

### `telegram status | start | stop | restart | send-status | task-history | uninstall`

- `--state-dir <dir>`
- `--launch-agent-dir <dir>`
- `--applications-dir <dir>`
- `--json`

### `telegram supervise`

- `--state-dir <dir>`
- `--launch-agent-dir <dir>`
- `--applications-dir <dir>`
- `--json`

`telegram supervise` 会复用已安装 service 保存下来的 workspace、profile 和 Telegram bot 环境，执行一次宿主 supervisor tick。
它不会像 `start` / `restart` 那样启动长轮询 listener，而是只把已经落盘的 CTO workflow 和排队中的 host-executor 工作推进一轮。

### `telegram workflow-history`

- `--limit <n>`
- `--json`

### `telegram workflow-detail`

- `--index <n>`
- `--json`

### `telegram task-history`

- `--limit <n>`
- `--json`

### `telegram dispatch-detail`

- `--index <n>`
- `--json`

### `telegram set-setting`

- `--key <name>`
- `--value <value>`
- `--json`

第一版支持的设置项：

- `ui_language` → `en` 或 `zh`
- `badge_mode` → `tasks`、`workflows` 或 `none`
- `refresh_interval_seconds` → `5`、`15`、`30` 或 `60`
- `show_workflow_ids` → `on` 或 `off`
- `show_paths` → `on` 或 `off`

### `telegram reset-cto-soul`

- `--json`

`telegram reset-cto-soul` 现在会把默认模板同时写回三份 service-local CTO soul 文件，默认位置是 `<state-dir>/cto-soul.md`、`<state-dir>/cto-chat-soul.md`、`<state-dir>/cto-workflow-soul.md`。
同时也会重置三份子代理 soul 文件：`<state-dir>/cto-reply-agent-soul.md`、`<state-dir>/cto-planner-agent-soul.md`、`<state-dir>/cto-worker-agent-soul.md`。

### `telegram uninstall`

- `--remove-menubar`

## 菜单栏 App

当开启 `--install-menubar` 时，openCodex 会编译一个常驻的菜单栏 applet。
它可以：

- 查看当前服务状态、running / waiting 工作流数量、任务历史数量、主线程 / 子线程数量，以及最近工作流
- 直接在菜单栏中切换 `safe` / `balanced` / `full-access`
- 启动、停止或重启 Telegram CTO 服务
- 直接在菜单栏内浏览最近派发记录，并为单个任务弹出详情窗口
- 从菜单栏进入完整的工作流列表，再对选中的工作流继续查看详情
- 从菜单栏进入完整的 `Task History` 浏览列表，再对选中的任务继续查看详情
- 直接在 UI 中修改任务栏设置，包括语言、角标模式、刷新间隔、工作流 ID 显示与路径快捷入口
- 需要时可一键打开任务记录、原始事件日志、最后消息文件、仓库目录、服务日志、最近工作流，以及可编辑的 CTO 灵魂文档
- 需要时可一键打开任务记录、原始事件日志、最后消息文件、当前 service workspace、服务日志、最近工作流，以及可编辑的 service-local CTO 灵魂文档
- 需要时也可以直接从任务栏恢复基于 Codex CLI 的默认 CTO 灵魂模板
- 把当前状态回执发回配置好的 CEO Telegram chat

## 安全说明

- 为了让 `launchd` 在没有交互 shell 的情况下也能重启服务，Telegram bot token 会保存在本地专用 env 文件里。
- openCodex 会把这个 env 文件写成仅 owner 可读写权限。
- Telegram CTO 监听器仍然应继续配合固定的 `--chat-id` 一起使用。

## 运行说明

- 服务层直接复用现有的 `opencodex im telegram listen --cto` 路径，而不是另造一套执行引擎。
- 当前 shell 里的代理变量会一并写入服务 env 文件，这样即使退出终端，Codex CLI 和 Telegram 长轮询仍能继续工作。

## 任务历史与详情视图

`telegram task-history` 会输出当前已知的完整任务派发历史，而不只是 `telegram status` 中默认展示的最近 5 条。

`telegram dispatch-detail --index <n>` 会把某一条历史任务解析成适合 UI 展示的人类可读详情，内容包括：

- 工作流 id 与工作流目标
- 任务 id、任务标题与任务状态
- 更新时间与标准化后的任务结果
- 如果存在，则展示 highlights、next steps、validation 与 changed files
- 最近事件活动摘要与最后保存的任务消息
- 任务记录、事件日志、last-message artifact 的直接文件路径

菜单栏 app 会复用这两个 service 子命令来驱动 `Browse Task History…` 选择器和后续的详情弹窗。
