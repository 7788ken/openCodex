# Memory 命令

## 目的

`opencodex memory sync` 用来把“只追加、不回写”的 memory 记录文件收敛成两个产物：

- 一个给人看的最新 summary
- 一个给自动化读的 state 文件

这样后续定时任务就只需要调用 openCodex 自己的能力，不必再各个仓库单独维护解析脚本。

## 用法

```bash
node ./bin/opencodex.js memory sync --source "$HOME/.codex/memories/ewallet_session_insights.md"
```

可选参数：

- `--summary <file>` — 指定 summary 输出路径
- `--state <file>` — 指定 state 输出路径
- `--cwd <dir>` — 指定相对 `--source`、`--summary`、`--state` 的解析基准目录
- `--now <timestamp>` — 测试时覆盖生成时间
- `--json` — 输出结构化结果，包含解析条数与目标路径

如果不显式提供 `--summary` 和 `--state`，openCodex 会按源文件名自动推导。
对于以 `_insights.md` 结尾的文件，会生成：

- `_summary.md`
- `_summary_state.json`

## 归并规则

- 同一 `主题键` 下，时间最新的记录覆盖旧进度，成为当前 summary 的有效版本。
- 如果旧记录没有 `主题键`，才回退到标准化后的标题归并。
- 如果旧记录没有 `主题键`、而后续同标题记录补了显式 `主题键`，只有在该标题唯一映射到这一个 `主题键` 时才会自动并入。
- 这个命令不会改写原始追加文件，只会重建 summary 与 state。

## 建议条目结构

为了保证归并稳定，每条 memory 建议至少包含：

- `主题键`
- `关键判断`
- `动作`
- `验证`
- `进度`
- `下一步`
- `可复用规则`
- `关键词`

## 调度建议

`opencodex memory sync` 只负责能力本体，不负责内建 scheduler。
调度层可以是：

- Codex desktop automations
- `launchd`
- 其他本地调度器

关键原则是：调度层调用 openCodex 能力，而不是各仓库自己维护的解析脚本。
