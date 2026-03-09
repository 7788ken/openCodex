# Auto 命令

## 目的

`opencodex auto` 是第一版无人值守本地工作流入口。
它会串起现有 openCodex 命令，让本地工作不必在每一步之间都等待人工交接。

## 第一版流程

第一版按顺序执行这些步骤：

- `session repair`
- `run`
- 可选的 `review`

这样实现足够薄，并且直接复用现有 session 与 summary 契约。
parent `auto` session 会记录 child sessions 和每一步的 output artifacts，保证无人值守链路仍然可追踪。child `run` / `review` session 也会带回指向 parent 的 `parent_session_id`。当使用 `--resume` 时，openCodex 会创建一个新的 parent `auto` session，并把它回链到旧的 `auto` session，而不是直接改写旧记录。

## 输入

- 必填 goal prompt；如果使用 `--resume <session-id|latest>` 则可省略
- `--cwd <dir>`
- `--profile <name>`
- `--review`
- `--uncommitted`
- `--base <branch>`
- `--commit <sha>`
- `--skip-repair`
- `--max-iterations <n>`
- `--run-retries <n>`
- `--fail-on-review`
- `--resume <session-id|latest>`

## Resume 行为

- `--resume <id>` 会从之前状态为 `partial` 或 `failed` 的 `auto` session 继续，但会创建一个新的 parent workflow session。
- `--resume latest` 会选择目标工作目录下最近一个可恢复的 `auto` session。
- 恢复时会复用旧 session 保存的 prompt 和 workflow 参数；如果还有 findings，会把它们带进下一轮 follow-up prompt。
- 恢复时也会沿用已完成的 `iteration_count`，所以新的 parent session 会从后续 iteration 编号继续，并继续消耗同一条 `--max-iterations` 预算。
- 可以用 `opencodex session tree <id>` 查看 parent / child / resume lineage。

## Review 行为

- 如果设置了 `--review` 但没有指定 review 目标，openCodex 默认执行 `review --uncommitted`。
- `--uncommitted`、`--base`、`--commit` 在 auto 模式下互斥，和 `opencodex review` 保持一致。
- 如果传入 `--base` 或 `--commit`，review 步骤会使用对应目标。
- 如果没有任何 review flag 或目标，工作流会在 `run` 后结束。
- 如果 `--max-iterations` 大于 `1`，openCodex 会基于 review findings 继续迭代，直到问题清空或达到上限。
- 即使 review 只有非 clean 的纯文本结论，没有结构化 findings，openCodex 也会把它保留为 findings，避免 `auto` 误判为 clean pass。
- 如果 `--run-retries` 大于 `0`，每一轮 unattended `run` 在失败后都可以先重试，再决定是否停止整个 parent workflow。
- 重试前的 cleanup 会立即修复 fresh stale child sessions，但会跳过当前仍在运行的 parent `auto` session。
- 如果设置了 `--fail-on-review`，最后一轮之后仍有 findings 时，parent auto session 会被标记为失败。

## 退出行为

- 所有已执行步骤都成功时，退出码为 `0`
- 任一步骤失败时，返回非零退出码
- 已经完成的子 session 仍会保存在本地

## 非目标

第一版暂不提供：

- 多步自主规划
- 超出命令失败透传之外的复杂重试策略
- 后台 daemon 或 scheduler
- 分布式执行
