# openCodex Adoption Backlog（from telegram-codex-bridge）

- 来源输入：
  - `docs/zh/research/telegram-codex-bridge-baseline.md`
  - `docs/zh/research/telegram-codex-bridge-orchestration-patterns.md`
  - `docs/zh/research/telegram-codex-bridge-reliability-ops.md`
- 仓库基线：`/Users/lijianqian/svn/tools/openCodex`
- 目标：把 bridge 中已验证有效的编排与可靠性做法，收敛为 openCodex 可立即执行的采纳清单。

## 主结论（单一主方案）
先做“状态与阻塞语义收敛 + 事件串行化 + Telegram 投递可靠性”三件事，再补 readiness gate 与事件字典；保持最小可逆改动，不引入兼容双轨。

## Top 5 High-Leverage Adoptions

### 1) Interaction 作为一等状态（替代仅 `pending_question_zh` 文本门控）
- 目标模块：`src/lib/cto-workflow.js`、`src/commands/im.js`、`schemas/cto-workflow-plan.schema.json`、`tests/cto-workflow.test.js`、`tests/im.test.js`
- 最小可逆改动范围：
  - 在 workflow state 中新增轻量 `pending_interactions`（数组）和 `interaction_status` 字段，不替换现有 `pending_question_zh`，先做并行写入。
  - 把当前“waiting_for_user”的阻塞原因从字符串，升级为可枚举类型（例如 `confirmation_required`、`missing_context`、`external_blocked`）。
  - 先只接管 CTO 主流程里最常见的确认场景，不扩展到 support 子域。
- 验收检查：
  - `tests/cto-workflow.test.js` 新增状态迁移用例：`running -> waiting_for_user -> running/completed`。
  - `tests/im.test.js` 验证重复消息/重复确认不会创建重复 interaction。
  - workflow artifact 中可看到 interaction id、state、resolved_at。
- 风险等级：中（触及状态结构与消息流，但可通过并行字段写入回滚）。

### 2) Per-workflow 串行事件队列（避免同一 workflow 被并发回调抢写）
- 目标模块：`src/commands/im.js`、`src/lib/cto-workflow.js`、`tests/im.test.js`
- 最小可逆改动范围：
  - 在 Telegram CTO runtime 内增加 `Map<workflow_session_id, Promise>` 队列，把 `applyWorkflowTaskResult`、`finalizeWorkflowStatus`、workflow 持久化串行化。
  - 不改外部命令接口；仅调整内部执行顺序。
  - 保留现有并发任务上限 `MAX_PARALLEL_CTO_TASKS`，只限制“同一 workflow”的状态写入并发。
- 验收检查：
  - 构造同一 workflow 快速连续更新，验证最终状态无回滚、无重复终态消息。
  - `tests/im.test.js` 增加乱序回调场景，断言 session summary 与 artifact 一致。
- 风险等级：中低（局部改动，影响面明确）。

### 3) Telegram API 分层重试与退避（带 `retry_after` 感知）
- 目标模块：`src/commands/im.js`、`tests/im.test.js`
- 最小可逆改动范围：
  - 把 `callTelegramApi` 封装为带策略的单入口：
    - 429 按 `retry_after` 等待再试。
    - 5xx/网络错误指数退避 + jitter（上限次数固定，如 2-3 次）。
    - 4xx 非 429 快速失败。
  - 保持现有调用点不变（`sendMessage/getUpdates/setMessageReaction` 继续调用同一函数）。
- 验收检查：
  - 模拟 429/5xx/4xx，验证重试次数和等待策略符合预期。
  - 日志中可区分 `retry_scheduled` 与 `retry_exhausted`。
- 风险等级：低（实现集中、可快速回滚）。

### 4) Readiness Gate 前移到长期运行入口（listen/supervise）
- 目标模块：`src/commands/im.js`、`src/commands/service.js`、`src/commands/doctor.js`、`tests/im.test.js`、`tests/doctor.test.js`
- 最小可逆改动范围：
  - 抽一个轻量 `checkImReadiness`：Codex 可用、token 合法、webhook 状态、工作目录可写、关键 state 目录可写。
  - `im telegram listen` 和 `im telegram supervise` 在进入主循环前必须通过 gate；失败即 fail-fast。
  - `doctor` 增加对应检查项，输出 next steps。
- 验收检查：
  - 关键依赖缺失时命令直接失败，不进入长轮询。
  - `doctor` 报告能提示具体修复动作。
- 风险等级：低（新增检查，不改业务状态机）。

### 5) 统一事件字典（event_code + severity）用于运维聚合
- 目标模块：`src/commands/im.js`、`src/lib/summary.js`、`docs/en` + `docs/zh` 运维文档、`tests/im.test.js`
- 最小可逆改动范围：
  - 为关键事件打标准字段：`event_code`、`severity`、`workflow_session_id`、`task_id`。
  - 首批覆盖：workflow start/finish、reroute、interaction pending/resolved、telegram delivery retry。
  - 只增量加字段，不重构现有日志文件结构。
- 验收检查：
  - 关键路径日志都可被 `event_code` 检索。
  - session summary 里至少能汇总失败和待确认事件数量。
- 风险等级：低（观测增强型改动）。

## First-Batch Change Plan（可立即开工，无外部审批）

### Batch-1 Task A：实现 Telegram API retry/backoff 策略
- 范围：`src/commands/im.js` + `tests/im.test.js`
- 产出：统一 `callTelegramApi` 重试策略与测试覆盖。
- 完成判定：429/5xx/4xx 路径行为可测，现有命令参数与调用方式不变。

### Batch-1 Task B：给 CTO workflow 增加同 workflow 串行化队列
- 范围：`src/commands/im.js` + `src/lib/cto-workflow.js` + `tests/im.test.js`
- 产出：同一 `workflow_session_id` 的状态更新串行执行。
- 完成判定：并发输入下无重复终态、无状态倒退。

### Batch-1 Task C：补齐 IM readiness gate 并接入 doctor
- 范围：`src/commands/im.js` + `src/commands/doctor.js` + `tests/doctor.test.js`（必要时补 `tests/im.test.js`）
- 产出：`listen/supervise` 启动前 gate + doctor 可见检查项。
- 完成判定：依赖缺失时 fail-fast，报告含明确 next step。

## 执行顺序与回滚点
1. 先做 Task A（单点改动、风险最低）。
2. 再做 Task B（并发一致性收益最高）。
3. 最后做 Task C（把运行期风险前移到启动期）。

回滚策略：每个任务均保持“单文件主改 + 对应测试”，出现回归可按任务粒度回退，不影响其他批次。

## 暂不纳入首批的项
- interaction 全量持久化与跨重启恢复（作为第二批，避免首批改动过宽）。
- 日志轮转与目录级配额（可在 event 字典稳定后接入）。
