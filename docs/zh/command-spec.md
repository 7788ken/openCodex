# 命令规范

## 范围

openCodex 是架在 Codex CLI 之上的轻量 CLI 层。
第一版应优先封装稳定的非交互 Codex CLI 接口，而不是重复实现底层 engine 行为。

## 命令集合

### `opencodex run`

**Purpose**

通过 Codex CLI 在当前仓库上执行任务，并返回统一的 openCodex 摘要。

**Preferred backend**

- `codex exec --json --output-schema`

**Minimal flags**

- `--profile <name>`
- `--schema <file>`
- `--output <file>`
- `--cwd <dir>`

**Non-goals**

- 替代 Codex CLI 的执行逻辑
- 解析交互式 TUI 输出
- 在 MVP 阶段再发明一套任务语言

### `opencodex review`

**Purpose**

通过 Codex CLI 执行仓库 review 流程，并返回稳定的 openCodex review 摘要。

**Preferred backend**

- `codex review`

**Minimal flags**

- `--uncommitted`
- `--base <branch>`
- `--commit <sha>`
- `--output <file>`

**Non-goals**

- 自己实现一套 review engine
- 在 v1 支持所有高级 review 模式
- 替代 Codex 原生 review 控制能力

### `opencodex doctor`

**Purpose**

检查本机是否已具备在 Codex CLI 之上运行 openCodex 的条件。

**Expected checks**

- Codex CLI 是否可用
- Codex CLI 版本
- 在可检测时检查本地认证就绪情况
- 必要配置或工作区前置条件

**Minimal flags**

- `--json`
- `--verbose`
- `--fix`（留待后续）

**Non-goals**

- 默认修改用户环境
- 隐藏失败检查项
- 管理远程基础设施

### `opencodex session`

**Purpose**

查看或管理 openCodex 命令产生的本地 session 元数据。

**Initial scope**

- 列出 sessions
- 查看某个 session 摘要
- 查看关联产物路径

**Minimal flags**

- `list`
- `show <id>`
- `--json`

**Non-goals**

- MVP 阶段支持远程同步
- 多设备 session 管理
- v1 做深度回放工具

## 命令设计规则

- 顶层命令集合保持精简。
- 优先透传稳定的 Codex CLI 能力。
- 通过统一最终摘要来增加产品层价值，而不是重写执行内部逻辑。
- 第一版避免为了完整性镜像大量低频上游参数。
