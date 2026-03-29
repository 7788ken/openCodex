# Session Bridge Operations

## 目的

本文是 Codex session bridge 的 operator-facing 操作文档。

它回答四个实际问题：

1. 如何判断当前有没有可 attach 的 bridge 会话
2. 如何查看最近输出和消息历史
3. 如何继续同一条会话，而不是新开一条平行 lane
4. 在什么情况下系统应该 fail closed，而不是假装 continuation 成功

## 核心规则

bridge 只支持对 bridge-owned Codex 会话做 continuation。

如果当前 Codex 进程不是通过 bridge-owned 的 `codex` shim 路径启动的，openCodex 就不应该假装自己能安全接入。

## 主操作流程

### 1. 先判断是否存在 live bridge session

先执行：

```bash
opencodex bridge status
```

它应该先回答这些问题：

- 真实 Codex launcher 是否已经注册
- 透明 `codex` shim 是否安装正确
- 当前是否存在 active 的 bridge-owned session
- 现在哪条 session ID 可以 attach

如果没有 attachable session，就停在这里。
正确行为是直接返回“没有可接入会话”，而不是偷偷换一条路线。

### 2. 在发送 continuation input 前先看当前输出

使用：

```bash
opencodex bridge tail
```

它最快能回答：

- 当前这条 Codex 会话在做什么
- 它是不是卡住了
- 下一条 remote/mobile 消息应该是 continuation、answer，还是根本不该发

### 3. 查看最近外部控制历史

使用：

```bash
opencodex bridge inbox
```

它会告诉 operator：

- 哪些 remote/mobile/Telegram 消息已经排队
- 哪些已经投递
- 同一条 continuation 指令是否已经发过

### 4. 继续同一条会话

使用：

```bash
opencodex bridge send "continue with <message>"
```

这就是命令行层面标准的 continuation 路径。
remote/mobile/Telegram 入口也应该复用同一套 bridge-session message 模型。

## 历史查看模型

这里有两种历史：

### Active session 的运行历史

使用：

- `opencodex bridge status`
- `opencodex bridge tail`
- `opencodex bridge inbox`

这组回答的是“当前这条主线会话现在正在发生什么”。

### 仓库可见的 session 历史

使用：

- `opencodex session latest`
- `opencodex session list`
- `opencodex session show <id>`
- `opencodex session tree <id>`

这组回答的是“更长时间尺度上，这些 session 之间发生了什么”。

规则很简单：

- `bridge *` 回答“当前 live 的 bridge 会话”
- `session *` 回答“落盘的 session 历史与 lineage”

## Session Selection 规则

### 对 bridge 命令

当前选择契约是：

- `active` 表示当前可 attach 的 bridge-owned live session
- `latest` 表示按更新时间选择的最新 bridge-owned session
- 当 operator 需要查看某一条精确历史记录时，应显式传 session ID

更具体地说，当前实现的选择顺序是：

- `bridge status` 只看全局 bridge state 下的 `active-session.json`
- `bridge tail` / `bridge inbox` 在未显式传 selector 时，先用 active pointer
- 如果没有 active pointer，`bridge tail` / `bridge inbox` 会回退到当前工作区里更新时间最新的 bridge session
- 显式传 session ID 时，直接读取那条已落盘 session

这意味着当前版本并没有“在多个 live bridge session 之间自动仲裁”的复杂策略。
当前唯一被视为“主线 live attach target”的，是全局 active pointer 指向的那条 session。

### 多 candidate 并存时的当前规则

当前实现对“多个 attachable candidate 同时存在”并没有做并行比较后再选优。

事实上的当前规则只有两条：

- live continuation 只认全局 active pointer 指向的那条 session
- history inspection 才会退回到按 `updated_at` 排序后的最新 session

因此：

- 如果确实存在多条同时还在跑的 bridge session，但全局 active pointer 只指向其中一条，那么 bridge continuation 只会接那一条
- 如果 active pointer 丢失，`tail` / `inbox` 还能看历史；`send` 不应把这种情况伪装成“已经重新接入主线”
- 当前没有“按工作目录、最近输出、最近外部消息数、锁拥有者”等维度做 selector tie-break 的公开契约

### 对 remote status / inbox

当前优先选择规则是：

- 默认优先 active remote session
- 没有 active 时，再回退到最新历史 remote session

这样状态面会优先围绕 live 路径展开。

要注意，`remote` 的 selector 是它自己的 session selector，不是 bridge live-session selector：

- `remote status` / `remote inbox` 默认会优先选非终态 remote session
- 只有在 remote status 内部检查 bridge attach 时，才会去看 active bridge session
- 所以 remote 的“active”不等于 bridge 的“可 continuation 主线”

## 必须 Fail Closed 的情况

以下场景必须 fail closed：

- 当前不存在 active bridge-owned session
- 注册的真实 Codex launcher 缺失或已失效
- bridge shim 会递归指回自己
- 当前选中的 session 是历史记录，不能用于 live continuation
- 同时存在多个候选，而当前策略无法确定性选中其中一个

这些情况下，正确输出是明确的 operator-facing 解释。
系统不能默默新开一条 workflow，再把它说成“继续当前 Codex 会话”。

## Session State 与 Attachability

当前 bridge continuation 的硬性前提比“看起来像最新 session”更窄。

### 允许 live continuation 的状态

当前实现里，一条 session 只有同时满足下面条件才允许真正接 continuation message：

- `session.command === "bridge"`
- `session.status === "running"`
- session record 仍然可读，`record_found === true`
- 存在有效的 `working_directory`

对应到 operator 视角，可以把它理解为：

- `running` 且仍被 bridge runtime 持有的 session：可继续

### 只读查看或明确阻断的状态

以下状态或现场只能查看，不能当成 live continuation target：

- `completed`
- `failed`
- `cancelled`
- `missing`
- `invalid`
- `record_found === false` 的 dangling active pointer

其中：

- `tail` / `inbox` 可以对历史 session 做只读查看
- `send` 只能对 running bridge session 生效
- Telegram / remote attach 也是按“record found + running”来判断 attachability

所以当前产品语义不是“只要最近有一条 bridge session 就能继续”，而是“只有当前仍在运行的 bridge-owned 主线才能继续”。

## 推荐的 Remote/Mobile 操作顺序

远程 operator 的推荐顺序是：

1. `opencodex remote status`
2. 先看 bridge attachability 和最近输出摘要
3. 有需要时再看 `opencodex bridge tail`
4. 有需要时再看 `opencodex bridge inbox`
5. 最后通过选定入口发一条 continuation message

关键产品规则是：

remote/mobile 入口不是独立工作线。
它们只是同一条 bridge-owned session 的控制面。

## 历史会话的 reopen / resume 语义

当前 bridge 主线还没有支持“把历史 bridge session 明确 reopen / resume 成一条新的 live session”。

现阶段已明确支持的只有两类操作：

- 对 running bridge session 继续发送外部消息
- 对 historical bridge session 做只读查看

现阶段明确不支持的事情是：

- 对 `completed` / `failed` / `cancelled` 的 bridge session 直接重新 attach
- 把历史 session 假装成当前 live session 继续投递 message
- 用 bridge 命令把一条历史 session 重新拉起成新进程

仓库里确实存在别的“resume”语义，但它们不是 bridge session reopen：

- `opencodex auto --resume` 只针对 `auto` workflow
- Telegram CTO workflow restart resume 只针对其自身 workflow rehydration

它们都不能当成 bridge 历史会话 reopen 的现有能力。

## Repair / Recovery 契约

当前实现已经能识别几类坏现场，但“识别出来”不等于“系统已经有专门 repair 命令”。

operator 需要把当前恢复路径理解成两层：

- 安装层修复：修 bridge state、真实 Codex launcher、shim、PATH
- live session 层修复：承认当前主线已经不可继续，然后决定是只读检查历史，还是重新启动一条新的 bridge-owned `codex ...`

### 1. 安装层坏现场

这类问题通常由 `opencodex bridge status` 和 `opencodex doctor` 直接暴露：

- bridge state 缺失或损坏
- 注册的真实 Codex launcher 已失效
- shim 缺失、陈旧、目标不匹配
- shim 递归指回自己
- PATH 仍然先命中别处的 `codex`

当前明确可执行的 repair 动作是：

- `opencodex bridge register-codex --path <real-codex-path>`
- `opencodex bridge install-shim`
- `opencodex bridge repair-shim`
- 调整 PATH，让 bridge shim 先于其他 `codex` launcher 生效

这里的产品语义很简单：

- 安装层坏了，先修安装层
- 安装层没修好之前，不要把 remote / mobile / Telegram 的 attach 失败误判成 session 问题

### 2. Dangling active pointer

当前 `active-session.json` 还在，但它指向的 session record 已经不可读、缺失或损坏时，bridge 会把这条主线识别成：

- `missing`
- `invalid`
- 或者 `record_found === false` 的 dangling active pointer

这类情况下，当前 operator-facing 结果是：

- `bridge status` 还能显示这条 active pointer，但它不是 attachable 主线
- `bridge send` 不会把它当成可继续的 live session
- `remote status` / remote 页面会显示没有可 attach 的 bridge-owned session，或检测到但不可 attach
- Telegram bridge attach 也会直接提示“当前不可继续接入”，而不是偷偷新开平行 workflow

当前明确支持的恢复动作只有：

- 用 `bridge status` 先确认现场
- 如需读历史，用 `bridge tail` / `bridge inbox` / `session show` 只读检查
- 如需继续主线，重新从本机启动一条新的 bridge-owned `codex ...`

当前还没有的能力是：

- 一个专门“清理/重建 active pointer”的 bridge repair 命令
- 自动把 dangling active pointer 修复成一个新的 live session

### 3. Orphaned controller / runtime crash

当前 bridge runtime 在正常退出、失败退出、收到 signal 结束时，都会在 `finally` 里尝试清掉 active pointer。

所以：

- 正常 `completed`
- 明确 `failed`
- 明确 `cancelled`

这几类收尾后，理论上都不会继续保留 active mainline。

但如果发生的是更粗暴的宿主 crash、controller 异常退出、或 active pointer 落盘与 session 持久化之间出现时序中断，operator 侧看到的现场通常会退化成上一节的 dangling pointer / missing record 问题，而不是一套更丰富的自动恢复流程。

也就是说，当前系统的恢复语义是：

- 它会尽量识别“这条主线已经不可靠了”
- 但不会自动 revive 那条旧 bridge session

当前可执行动作仍然是：

- 先看 `bridge status`
- 需要时再看 `bridge tail`、`bridge inbox`、`session show <id>`
- 如果只是安装层问题，先修 bridge state / shim / PATH
- 如果 live session 已经不再是 `running` attachable 状态，就重新启动新的 bridge-owned `codex ...`

### 4. 当前没有的 repair 能力

这一轮需要明确承认，下面这些恢复动作当前还没有正式支持：

- 自动检测并清理 stale active pointer
- 自动把 orphaned bridge process 重新接管成可 continuation 的 live session
- crash 后自动重建 active pointer 与 session record 的一致性
- 把历史 bridge session 显式 reopen 成一条新的 live session

## 当前仍待补的细节

当前这轮已经把 selector / attachability / no-reopen / repair contract 的文档边界写清。
接下来仍值得继续补的是：

- orphaned controller / dangling running record 的正式 repair 命令
- bridge runtime crash 后 active pointer 与 session record 的自动/半自动一致性策略
- 如果未来真的支持历史 reopen，需要定义“新 session 继承旧 lineage，而不是篡改旧记录”的显式契约

这些后续补充都归在 `T021` 下。
