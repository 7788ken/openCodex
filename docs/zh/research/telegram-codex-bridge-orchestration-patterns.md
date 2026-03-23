# Telegram Codex Bridge 编排模式提炼（面向 openCodex）

基于仓库 `/tmp/telegram-codex-bridge` 当前实现与产品文档，聚焦编排与计划相关能力，提炼可复用模式、风险点与 openCodex 映射建议。

## 一、可复用模式（值得吸收）

### 1) 任务分解模型：`会话(Session) -> 线程(Thread) -> 回合(Turn) -> 交互(Interaction)`

结论：
- 把“长期上下文”和“一次执行”解耦是该仓库最稳的骨架。
- `session` 负责用户侧语义边界（项目、模型、plan mode、活跃态），`thread` 负责与 Codex 的历史连续性，`turn` 负责一次执行闭环，`interaction` 负责执行中断点（审批/问答/表单）。

证据点：
- `turn-coordinator` 只做 turn 生命周期，不把 session 管理和交互卡片 UI 细节揉在一起。
- `interaction-broker` 专管 server request 归一化、持久化、卡片渲染、回复回传。
- `session-project-coordinator` 负责项目与会话生命周期（含手动路径确认、归档/反归档）。

为什么值得采用：
- 边界清晰后，重试、恢复、并发限制、回滚都能落在正确层级，避免“所有状态都在一个大控制器里”。

可复用规则：
- openCodex 建议固定为：`CTO 主线程(会话调度)` + `worker 执行回合` + `interaction broker 统一阻塞点`，不要把阻塞点直接塞进 worker 主循环。

---

### 2) 任务创建、串行化、恢复三件套

结论：
- 新任务并非直接 `startTurn`，而是先 `ensureSessionThreadState`：有 thread 则 `resumeThread`，远端丢失则重建 thread 并更新本地映射。
- 通知处理按 thread/turn 建队列串行消费，避免状态写入乱序。
- turn 终态后，先做交互清理，再做最终结果投递与运行面板收尾，顺序稳定。

证据点：
- `turn-coordinator` 里 `ensureSessionThreadState`（有线程先恢复，缺失则重建）。
- `notificationQueuesByKey` 以 thread/turn 作为队列键，串行处理事件。
- `turn_completed` 分支中明确先清理未决 interaction，再落 session 状态与最终消息。

为什么值得采用：
- 防止“同一 turn 收到乱序事件导致二次终态、重复卡片、错误回写”。

可复用规则：
- openCodex 可直接沿用“按执行实体串行事件队列”的思路，不要让多个异步回调并发改同一个 turn 状态。

---

### 3) 阻塞态继续执行采用 `turn/steer`，但前置条件严格

结论：
- 运行中并非一律拒绝新输入：若 turn 处于 blocked 且无未处理 interaction，可把文本/结构化输入走 `steerTurn` 继续原 turn。
- 如果存在 `pending` 或 `awaiting_text` 的 interaction，必须先处理卡片，禁止旁路输入。

证据点：
- `interaction-broker.getBlockedTurnSteerAvailability` 明确区分 `available / interaction_pending / busy`。
- `rich-input-adapter` 在 running 场景先查 steer 可用性，再决定 continuation 或拒绝。

为什么值得采用：
- 避免“用户又发一条消息导致并行第二个任务”造成状态炸裂；同时保留 blocked turn 的连续性。

可复用规则：
- openCodex 里 worker 遇阻塞时，继续执行入口应唯一化：`resume same task`，不是 `start new task`。

---

### 4) 交互卡片持久化 + 回调幂等

结论：
- interaction 是一等状态，持久化在 `pending_interaction`，包含 `promptJson`、`responseJson`、`state`、`telegramMessageId`、`errorReason`。
- 回调统一做“过期/重复”防护：重复点击返回“已处理”，过期按钮返回“已过期”。

证据点：
- 状态集合：`pending/awaiting_text/answered/canceled/expired/failed`。
- 回调契约文档要求 stale/duplicate 语义固定；实现层 `guardStaleInteraction` 和 messageId 校验。

为什么值得采用：
- 交互链路可以跨进程重启恢复，不依赖聊天平台记忆；UI 抖动也不会破坏业务状态。

可复用规则：
- openCodex 的“待确认动作”也应落可查询存储，并给每个动作定义终态与错误原因，不做内存态临时票据。

---

### 5) 风险动作双阶段：先选目标，再确认执行

结论：
- `/rollback` 不是一次点击即执行，而是“目标选择 -> 确认”两步；并且支持按钮过期提示。
- 手动路径创建会话也是“输入路径 -> 校验 -> 确认新建会话”。

证据点：
- `handleRollbackPickerCallback` 的 confirm 分支与 `handleRollbackConfirmCallback` 分离。
- `confirmManualProject` 前必须有候选路径并通过 active picker state 校验。

为什么值得采用：
- 减少误触造成的破坏性动作；同时把风险门槛放在 UX 层，不污染执行核心。

可复用规则：
- openCodex 对“不可逆/高影响动作”统一采用二次确认，但只对高风险动作启用，避免全局确认疲劳。

---

### 6) Prompt 治理：桥接层尽量不偷偷改写执行提示

结论：
- 在 turn start 的 collaboration settings 中，`developerInstructions` 明确置空，避免桥接层隐式注入“看不见的系统提示”。
- prompt 变化主要来自显式用户输入（例如 `/skill ... :: prompt`、`/review custom ...`），不是中间层自动拼接隐藏策略。

证据点：
- `buildTurnStartRequest` 对 plan mode 仅设置 mode/model/reasoning，`developerInstructions: null`。
- structured input 场景通过显式 prompt 合并，而不是全局模板污染。

为什么值得采用：
- 减少“上层策略漂移”与调试不可解释性。

可复用规则：
- openCodex 里 prompt governance 建议遵循“显式来源可追踪”：系统策略、仓库策略、用户输入三层可审计，不要隐式混写。

## 二、反模式 / 风险（应避免）

### 1) 把规划文档当已上线行为

风险：
- 该仓库把 `docs/plans` 与 `docs/archive` 明确标为历史/规划，如果直接当现状实现，容易在编排策略上做错判。

规避：
- 先看 `docs/product` + `docs/architecture` + `src`，规划文档只做意图补充。

### 2) 在运行中允许“新任务并发创建”替代 blocked continuation

风险：
- 用户感觉可用，但状态会变成多条活跃链并发抢写同一会话，最终出现错误终态和回执串线。

规避：
- running 时只允许：`interrupt` 或 `steer same turn`（且需无未决 interaction）。

### 3) 未决交互与运行面板抢焦点

风险：
- 如果自动刷新运行面板把交互卡片顶下去，用户会误以为无需处理审批/问答，形成“看得见 blocked，点不到解决入口”。

规避：
- 有 actionable interaction 时，禁止 `/hub` 下沉和自动重锚。

### 4) 失败时静默兜底，不写明失败原因

风险：
- 无法定位是 Telegram 发送失败、app-server 断开，还是 request-response 回传失败。

规避：
- `failed/expired/canceled` 分开；`error_reason` 必填且可追踪；失败后卡片要显式转终态。

### 5) 回调数据与协议内部 ID 强耦合

风险：
- 直接暴露/依赖协议原生 ID 使前端 payload 脆弱，兼容升级困难。

规避：
- callback contract 走 bridge-owned token/index，协议 ID 在服务端映射。

## 三、映射建议（openCodex：CTO 主线程 + 子 worker）

### 映射 1：任务分解与生命周期
- 建议：CTO 主线程只维护 `任务会话` 与 `任务回合` 的状态机；worker 只执行回合，不直接改全局会话路由。
- 对应：
  - CTO 主线程 ≈ `session-project-coordinator + turn-coordinator` 的上层编排职责
  - 子 worker ≈ 单个 active turn 的执行体

### 映射 2：阻塞点统一代理
- 建议：把“等待用户确认/补充输入/外部授权”抽成统一 `interaction broker`，让 worker 通过 broker 暴露阻塞，不直接和用户通道耦合。
- 收益：可持久化、可重放、可恢复、可审计。

### 映射 3：状态定义最小但完备
- 建议：openCodex 至少统一以下状态：
  - 回合态：`running/blocked/completed/interrupted/failed`
  - 交互态：`pending/awaiting_text/answered/canceled/expired/failed`
- 收益：重试和恢复不需要靠“字符串猜测”，可以按状态机转移。

### 映射 4：确认策略与风险分层
- 建议：默认直通执行，仅对高风险动作启用“双阶段确认”。
- 可直接套用的高风险类：回滚、破坏性改写、跨目录高影响操作。
- 禁止扩散：普通查询、只读检查、低风险本地变更不要引入确认噪音。

### 映射 5：Prompt 治理职责边界
- 建议：
  - CTO 主线程负责策略拼装顺序与审计记录；
  - worker 只消费已定稿 prompt，不擅自注入隐藏提示；
  - 所有 prompt 来源可追踪（系统/仓库/用户/临时指令）。
- 这比“每个 worker 各自拼 prompt”更稳定，更容易解释行为偏差。

## 四、给 openCodex 的落地顺序（最小可逆）

1. 先落状态机与持久化表：任务回合 + 交互卡片（不改执行逻辑）。
2. 接入 blocked continuation 的单一入口（steer/resume 同回合）。
3. 补高风险动作二次确认（先 rollback 类）。
4. 最后再做 UI 层重锚与提示策略，避免先做表层改动掩盖状态机问题。

