# 命令规范

## 范围

openCodex 是架在 Codex CLI 之上的轻量 CLI 层。
第一版应优先封装稳定的非交互 Codex CLI 接口，而不是重复实现底层 engine 行为。

## 命令集合

### `opencodex run`

**Purpose**

通过 Codex CLI 在当前仓库上处理真实的本地工作，并返回统一的 openCodex 摘要。

**Preferred backend**

- `codex exec --json --output-schema`

**Minimal flags**

- `--profile <name>`
- 如果省略，openCodex 会回退到当前目录或父目录中的 `opencodex.config.json`。
- `--schema <file>`
- `--output <file>`
- `--cwd <dir>`

**Non-goals**

- 替代 Codex CLI 的执行逻辑
- 解析交互式 TUI 输出
- 在 MVP 阶段再发明一套任务语言

### `opencodex session`

**Purpose**

查看本地 session，并为 openCodex run 提供同机协同入口。

**Initial scope**

- 列出 sessions
- 查看单个 session 摘要
- 查看最近一次 session 以便同机交接
- 查看 parent / child lineage 的 session tree
- 基于 terminal evidence 和命令对应 artifacts 修复残留的 running sessions
- 查看相关 artifact 路径

**Minimal flags**

- `list`
- `show <id>`
- `latest`
- `tree <id>`
- `repair`
- `--json`
- `--stale-minutes <n>`

**Non-goals**

- MVP 阶段的远程同步
- 多设备 session 管理
- v1 深度回放工具

### `opencodex auto`

**Purpose**

通过串联稳定的 openCodex wrapper 命令，运行第一版无人值守本地工作流。

**Initial scope**

- 执行前先修复残留 stale sessions
- 运行主任务
- 可选执行后续 review
- 把之前 `partial` / `failed` 的 `auto` 工作流恢复成一个新的 parent session
- 在恢复后的新 parent 上继续沿用 iteration 编号和 max-iteration 预算

**Minimal flags**

- `--profile <name>`
- `--cwd <dir>`
- `--review`
- `--uncommitted`
- `--base <branch>`
- `--commit <sha>`
- `--skip-repair`
- `--max-iterations <n>`
- `--run-retries <n>`
- `--fail-on-review`
- `--resume <session-id|latest>`

**Non-goals**

- v1 的长驻后台 agent
- 分布式作业执行
- 替代 `run` 作为真实 Codex 执行引擎

### `opencodex memory`

**Purpose**

把追加型 memory 记录收敛成“active + archive + summary/state”三层产物。

**Initial scope**

- 解析带时间标题的追加型 session 记录
- 同一 `主题键` 下只保留最新记录作为当前视图
- 当旧记录没有 `主题键` 且标题只映射到一个显式 `主题键` 时，并入该主题
- `sync` 重建按项目分组的 summary 与 state
- `compact` 保留每个主题最新 active 记录，并把旧且已被覆盖的历史按项目/月归档
- 把本次处理过程也落成标准 openCodex 本地 session

**Minimal flags**

- `sync`
- `compact`
- `--source <path>`
- `--summary <path>`
- `--state <path>`
- `--archive-dir <path>`
- `--retention-days <days>`
- `--cwd <dir>`
- `--json`
- `--now <timestamp>`

**Non-goals**

- 把追加型记录改造成可编辑数据库
- 在命令内部内建 scheduler
- 靠单一大文件长期承载所有热数据和冷历史

### `opencodex remote`

**Purpose**

通过绑定当前工作区的带 token HTTP 桥，让手机可以把远程消息发进 openCodex。

**Initial scope**

- 运行一个轻量本地 HTTP 服务
- 通过 token 鉴权接收手机提交的消息
- 把入站消息保存为本地 artifacts
- 为优先 remote session（active 优先，否则回退最新历史记录）提供 CLI inbox 查看入口
- 为同一优先 remote session 提供 CLI 状态快照、会话选择来源元数据（含候选统计）、实时 health 探测信号（含探测时间/延迟）、部署检查与排障提示

**Minimal flags**

- `serve`
- `inbox`
- `status`
- `--cwd <dir>`
- `--host <host>`
- `--port <n>`
- `--token <value>`
- `--limit <n>`
- `--session-id <id|latest>`（inbox/status）
- `--json`

**Non-goals**

- v1 的公网 relay 基建
- 后台 push 通知
- 从手机直接实时接管一个 Codex turn

### `opencodex bridge`

**Purpose**

管理 installed Codex session bridge，让 remote / mobile / IM 入口可以查看并继续同一条 bridge-owned Codex 会话。

**Initial scope**

- 保存真实 Codex launcher 路径
- 安装或修复透明的 `codex` bridge shim
- 暴露当前 active bridge-owned session 状态
- 暴露最近输出和外部消息审计轨迹
- 向 active 或指定 bridge-owned session 注入 continuation input

**Minimal flags**

- `status`
- `tail`
- `inbox`
- `send`
- `register-codex`
- `install-shim`
- `repair-shim`
- `--cwd <dir>`
- `--bin-dir <dir>`
- `--limit <n>`
- `--session-id <id|active|latest>`
- `--path <path>`
- `--force`
- `--json`

**Non-goals**

- 接管 bridge 之外随意启动的 foreign Codex 进程
- 在 Codex CLI 旁边再造一套执行引擎
- 当用户意图是“继续当前 Codex 主线”时，静默回退成平行 workflow

### `opencodex im`

**Purpose**

把 openCodex 接到即时通讯平台上，而不是依赖本地 IP 的可达性。

**Initial scope**

- 第一优先支持 Telegram 长轮询
- 把入站 IM 消息保存成 session artifacts
- 通过 CLI 提供 inbox 查看与外发回复
- 尽量保持本机只做出站连接

**Minimal flags**

- `telegram listen`
- `telegram inbox`
- `telegram send`
- `--cwd <dir>`
- `--bot-token <token>`
- `--chat-id <id>`
- `--poll-timeout <seconds>`
- `--clear-webhook`
- `--cto`
- `--profile <name>`，用于 Telegram CTO 工作流里 worker run 的权限配置
- `--limit <n>`
- `--json`

出于安全考虑，`--cto` 必须和 `--chat-id <id>` 一起使用。这个模式下 openCodex 会在同一个 chat 里维持一条 CTO 编排主线程，需要确认时暂停，并在下一条 Telegram 回复里续跑。

**Non-goals**

- 替换本地 openCodex session 模型
- 在 v1 就引入托管 relay 基础设施
- 第一版就支持所有 IM 平台

### `opencodex install`

**Purpose**

创建并检查 detached local runtime，让已安装 CLI 和长期 service 不再依赖源码 checkout。

**Initial scope**

- 先产出一个可交付的 runtime bundle
- 在用户目录下安装版本化 detached runtime
- 重写活动 runtime 的 `current` 指针
- 创建给 shell 使用的 CLI shim
- 编译一个启动同一 detached runtime 的轻量 `OpenCodex.app` 宿主壳
- 输出供 `service relink` 使用的 runtime CLI 路径
- 在 `status` 中暴露安装槽位生命周期预览，先看清再清理
- 支持 `status --keep <n>` 预览不同保留策略下的 prune 范围（不删除）
- 清理过期安装槽位，同时保留当前活动 runtime

**Minimal flags**

- `bundle`
- `detached`
- `status`
- `prune`
- `--output <path>`
- `--root <dir>`
- `--bin-dir <dir>`
- `--applications-dir <dir>`
- `--bundle <path>`
- `--name <id>`
- `--keep <n>`
- `--dry-run`
- `--link-source`
- `--force`
- `--json`

**Non-goals**

- 第一版就交付 notarized 桌面 App
- 自动改写现有 service
- 在 v1 定义系统级安装器

### `opencodex service`

**Purpose**

为 Telegram CTO 通道安装并控制 macOS 本地后台服务，并可选生成菜单栏 app。

**Initial scope**

- 为 `opencodex im telegram listen --cto` 安装用户级 `launchd` agent
- 把 Telegram bot token 和代理相关 env 固化到独立 env 文件
- 提供 start / stop / restart / status / send-status / supervise / workflow-history / workflow-detail / task-history / dispatch-detail / set-setting / reset-cto-soul / uninstall 控制
- 可选编译一个轻量的 stay-open 菜单栏 app，并支持任务浏览与任务详情弹窗

**Minimal flags**

- `telegram install`
- `telegram status`
- `telegram start`
- `telegram stop`
- `telegram restart`
- `telegram send-status`
- `telegram supervise`
- `telegram set-workspace`
- `telegram relink`
- `telegram workflow-history`
- `telegram workflow-detail`
- `telegram task-history`
- `telegram dispatch-detail`
- `telegram set-setting`
- `telegram reset-cto-soul`
- `telegram uninstall`
- `--cwd <dir>`
- `--chat-id <id>`
- `--bot-token <token>`
- `--cli-path <path>`
- `--cto-soul-path <path>`
- `--poll-timeout <seconds>`
- `--profile <name>`
- `set-profile --profile <name>`
- `set-workspace --cwd <path>`
- `relink --cli-path <path>`
- `--allow-project-cli`
- `--install-menubar`
- `--open-menubar`
- `--no-load`
- `--remove-menubar`
- `--json`

**Non-goals**

- 替换 `im telegram listen` 作为真正的 Telegram 执行引擎
- 在 v1 自建托管 relay 服务
- 第一版就交付一套完全自定义的原生桌面客户端

### `opencodex island`

**Purpose**

安装并驱动一个刘海屏风格的 macOS 浮层，用来汇总所有已知 workspace 的 Codex 任务状态，并在需要回复时直接暴露待处理消息，而不是依赖菜单栏图标。

**Initial scope**

- 聚合当前工作区、已注册工作区、默认 detached workspace 根目录，以及 Telegram service 配置里声明的工作区任务
- 提供只读的 `status` 全局状态快照
- 安装一个轻量原生 macOS overlay app，周期性轮询 `opencodex island status`
- 按需打开已安装的 overlay app
- 默认把浮层锚定在主显示器的菜单栏 / 刘海区域
- 收敛态显示状态与进行中的任务数，展开态显示待回复消息预览

**Minimal flags**

- `status`
- `install`
- `open`
- `--cwd <dir>`
- `--home-dir <dir>`
- `--applications-dir <dir>`
- `--app-path <path>`
- `--cli-path <path>`
- `--node-path <path>`
- `--open`（`install`）
- `--json`

**Non-goals**

- 替代主 `OpenCodex.app` 宿主壳
- 演化成通用桌面通知系统
- 第一版就做成完整沙盒化 / notarized 的原生桌面应用

### `opencodex doctor`

**Purpose**

检查本机是否已准备好运行基于 Codex CLI 的 openCodex。
这是辅助命令，不是主要干活入口。

**Expected checks**

- Codex CLI 可用性
- Codex CLI 版本
- 在可检测时检查本地登录状态
- 必要的配置或工作区前提

**Minimal flags**

- `--json`
- `--verbose`
- `--cwd <dir>`
- `--fix`（后置保留）

**Non-goals**

- 默认修改用户环境
- 隐藏失败检查项
- 替代主线 `run` 工作流

### `opencodex review`

**Purpose**

通过 Codex CLI 执行仓库 review 流程，并返回稳定的 openCodex review 摘要。

**Preferred backend**

- `codex review`

**Minimal flags**

- `--profile <name>`
- 如果省略，openCodex 会回退到当前目录或父目录中的 `opencodex.config.json`。
- `--uncommitted`
- `--base <branch>`
- `--commit <sha>`
- `--title <text>`
- `--output <file>`
- `--cwd <dir>`

**Non-goals**

- 自己实现一套 review engine
- 在 v1 支持所有高级 review 模式
- 替代原生 Codex review 控制能力

## 命令设计规则

- 保持顶层命令集合精简。
- 优先透传稳定的 Codex CLI 能力。
- 让 `run` 成为真实本地工作的主路径。
- 用 `session` 保留本地追踪能力和交接上下文。
- 让 `doctor` 保持辅助护栏角色，而不是产品中心。
- 第一版避免加入仅仅镜像上游冷门参数的 flags。
