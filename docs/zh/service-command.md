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
- `opencodex service telegram set-setting`
- `opencodex service telegram send-status`
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

## 输入

### `telegram install`

- `--cwd <dir>`
- `--chat-id <id>`
- `--bot-token <token>` 或 `OPENCODEX_TELEGRAM_BOT_TOKEN`
- `--poll-timeout <seconds>`
- `--profile <name>`；默认值：`full-access`
- `--install-menubar`
- `--open-menubar`
- `--no-load`
- `--json`

### `telegram status | start | stop | restart | send-status | task-history | uninstall`

- `--state-dir <dir>`
- `--launch-agent-dir <dir>`
- `--applications-dir <dir>`
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

### `telegram uninstall`

- `--remove-menubar`

## 菜单栏 App

当开启 `--install-menubar` 时，openCodex 会编译一个常驻的菜单栏 applet。
它可以：

- 查看当前服务状态、running / waiting 工作流数量、任务历史数量、主线程 / 子线程数量，以及最近工作流
- 直接在菜单栏中切换 `safe` / `balanced` / `full-access`
- 启动、停止或重启 Telegram CTO 服务
- 直接在菜单栏内浏览最近派发记录，并为单个任务弹出详情窗口
- 从菜单栏进入完整的 `Task History` 浏览列表，再对选中的任务继续查看详情
- 直接在 UI 中修改任务栏设置，包括语言、角标模式、刷新间隔、工作流 ID 显示与路径快捷入口
- 需要时可一键打开任务记录、原始事件日志、最后消息文件、仓库目录、服务日志、最近工作流，以及可编辑的 CTO 灵魂文档
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
