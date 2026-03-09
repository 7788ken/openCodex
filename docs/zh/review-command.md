# Review 命令

## 目的

`opencodex review` 对 `codex review` 做轻量封装，并把结果保存为本地 openCodex session。
它是项目里的第一版 review 工作流入口。

## 输入

该命令接受一个 review 选择器，以及一个可选的自定义 prompt。

### 支持的选择器

一次调用里这三个 selector 只能选一个。

- `--uncommitted`
- `--base <branch>`
- `--commit <sha>`

### 其他 flags

- `--title <text>`
- `--output <file>`
- `--cwd <dir>`

## Artifacts

每次 review session 会保存：

- 一份归一化后的 `session.json`
- 一份原始 `review-report.txt`
- 在可用时保存 stderr 日志

如果 `codex review` 失败前已经输出了部分 stdout，openCodex 会把 stdout 和 stderr 一起保留到主 `review-report` artifact 里，避免关键诊断只藏在单独 log 中。
- 当使用 `--output` 时保存导出的 summary 文件

## Summary 策略

`codex review` 当前没有像 `codex exec --output-schema` 那样的结构化 schema 输出流程。
在 MVP 阶段，openCodex 会保留完整原始 review 文本，并额外生成一份归一化 summary。

wrapper 会优先提取最后一个 `codex` 段落，这样 transport 元数据和 transcript 骨架不会主导最终摘要。
当报告中存在标准的 `Full review comments:` 区块时，openCodex 还会额外提取结构化 findings，包含：

- `priority`
- `title`
- `location.path` / `location.start_line` / `location.end_line`
- `detail`

如果报告里没有标准 `Full review comments:` 区块，openCodex 也会把非 clean 的纯文本结论保留成字符串 finding；明确 clean 的结论则保持无 findings。只有整段结论都明确表达“无问题”时，像 `looks good` 这样的正向短语才会被视为 clean。

归一化 summary 会保留：

- 稳定标题
- 一行结果说明
- 状态字段
- 简短 highlights 列表
- 后续 next steps

## 退出行为

- 当底层 `codex review` 成功时，退出码为 `0`
- 当底层命令失败时，退出码为 `1`
- 即使 review 失败，session 也依然会被保存

## 非目标

第一版不尝试：

- 替代 Codex review 本身的逻辑
- 再发明一套 review engine
- 把所有可能的 review 输出都强行收敛成刚性的统一 schema
