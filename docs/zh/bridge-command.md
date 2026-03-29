# Bridge 命令

## 目的

`opencodex bridge` 是当前产品主线，对应一个非常具体的目标：

- 保留用户原本的 `codex` 使用习惯
- 让 Codex 进程在 openCodex 监督下以 bridge-owned session 运行
- 让 remote / mobile / IM 入口继续同一条主线会话，而不是再开一条平行执行线
- 让会话历史、最近输出和外部控制审计统一落在同一套 session 模型里

它不是边角工具。
它就是“从别处继续当前 Codex 会话”这条产品路径的控制面入口。

## 产品边界

bridge 模型故意收得很窄：

- openCodex 支持的是 bridge-owned Codex 会话
- openCodex 不承诺接管那些在 bridge 之外直接启动的任意 Codex 进程
- remote / mobile / Telegram 控制面在存在 attachable bridge 会话时，应优先接入那条会话
- 如果当前没有可接入的 bridge-owned 会话，系统必须直接说明，而不是假装新开一个 workflow 就等于“继续当前会话”

## 主线路径

目标路径是：

1. 用户继续使用 `codex ...`
2. 安装后的 openCodex bridge shim 挂在真实 Codex launcher 前面
3. 启动出来的 Codex 进程成为一条 bridge-owned live session
4. 之后用户可以：
   - 查看 bridge 状态
   - 查看最近输出
   - 查看外部消息的排队与投递记录
   - 向当前会话注入一条 continuation message
   - 让 remote / mobile / Telegram 接到这条同一主线会话

这就是“远程看历史、继续同一条 Codex 工作”的主产品形态。

## 当前支持的子命令

- `opencodex bridge status`
- `opencodex bridge tail`
- `opencodex bridge inbox`
- `opencodex bridge send`
- `opencodex bridge register-codex`
- `opencodex bridge install-shim`
- `opencodex bridge repair-shim`

## 各命令职责

### `bridge register-codex`

保存真实 Codex launcher 的路径，作为 bridge 转发目标。

这是稳定 installed-product bridge 的前置条件。

### `bridge install-shim`

在 `PATH` 上安装一个透明的 `codex` shim，挂到真实 Codex 前面。

用户表面习惯仍然是 `codex`。
但 openCodex 获得了进程所有权和会话血缘。

### `bridge repair-shim`

当 `PATH` 顺序、launcher 目标或 detached runtime 升级导致 shim 漂移时，用它修复。

### `bridge status`

查看安装层的 bridge 状态，以及当前 active 的 bridge-owned live session。

它首先回答这些问题：

- bridge 是否装好了
- 当前注册的真实 Codex 路径是什么
- 现在有没有可 attach 的 bridge 会话
- 最近输出和待处理 bridge 消息是什么

### `bridge tail`

读取 bridge-owned session 最近捕获的输出。

这是远程场景下最快的“当前这条 Codex 会话正在干什么”视图。

### `bridge inbox`

读取指定 bridge session 下排队或已投递的外部消息。

它是 remote / mobile / IM continuation input 的审计轨迹。

### `bridge send`

向 active 或指定 bridge-owned session 注入一条外部消息。

它对应的就是命令层面的“从别处继续这条 Codex 会话”。

## Bridge-Owned Live Session 模型

一条 bridge-owned session 应该保留这些东西：

- 稳定的 session identity
- launcher provenance
- 生命周期状态
- 最近输出
- 排队和已投递的外部消息
- remote / mobile / Telegram 的 attach 语义

核心区分是：

- bridge-owned live session：受支持的 attach 目标
- historical bridge-owned session：可读历史，但不一定还能 attach
- foreign Codex process：不在当前支持契约里

当前已经明确下来的 operator 边界是：

- live continuation 默认只认全局 active pointer 指向的那条 bridge session
- `tail` / `inbox` 在没有 active pointer 时，可以退回到最新历史 session 做只读查看
- `send` 的产品语义仍然是“向当前 running 主线写消息”，不是“尝试重开历史 session”
- `completed` / `failed` / `cancelled` 的历史 bridge session 当前都不支持 reopen / resume
- dangling active pointer、orphaned controller、runtime crash 当前只会被识别并暴露，不会被 bridge 自动复活成新的 live session

也就是说，bridge 现在支持的是 live attach，不是历史会话复活。
它当前提供的是“识别坏现场 + 指向人工修复动作”，还不是“自动恢复旧主线”。

## 与其他入口的关系

### 与 `remote` 的关系

`remote` 是适合手机使用的入口面。
它不应该长成自己的执行主线。
它正确的职责是：把消息中继到 active bridge-owned session，并为同一条会话提供状态/历史查看面。

### 与 `im` 的关系

当用户意图是“继续当前 Codex 主线”时，Telegram CTO 模式应接到 active bridge-owned session。
不能默默新开一条平行 workflow。

### 与 `session` 的关系

`session` 仍然是仓库内可见的历史与交接面。
bridge-owned session 必须作为一等 session 记录，正常出现在这里。

## 当前缺口

目前主要还差：

- 更完整的 bridge-owned 会话历史查看路径
- orphaned controller / dangling active pointer 的正式 repair 命令
- bridge crash 后 active pointer 与 session record 的自动/半自动一致性策略
- 安装产物层面的文档与排障打磨

这些缺口都归在 `T021-installed-oc-codex-control-bridge.md` 下。

## 相关文档

- `install-layout.md` — detached runtime 与安装 launcher 所有权
- `remote-command.md` — 手机入口
- `im-command.md` — Telegram 入口与当前 attach 行为
- `project-status.md` — 当前执行状态
