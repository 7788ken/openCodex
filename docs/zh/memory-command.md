# Memory 命令

## 目的

`opencodex memory` 现在包含两个子能力：

- `sync`：把“只追加、不回写”的 memory 记录文件收敛成最新 summary 和 machine-readable state
- `compact`：把“旧且已被新记录覆盖”的历史条目从 active source 中迁到 archive，并重新生成 summary/state

这样后续定时任务就只需要调用 openCodex 自己的能力，不必再各个仓库单独维护解析脚本。

## 用法

```bash
node ./bin/opencodex.js memory sync --source "$HOME/.codex/memories/global_session_insights.md"

node ./bin/opencodex.js memory compact --source "$HOME/.codex/memories/global_session_insights.md"
```

`sync` 可选参数：

- `--summary <file>` — 指定 summary 输出路径
- `--state <file>` — 指定 state 输出路径
- `--cwd <dir>` — 指定相对 `--source`、`--summary`、`--state` 的解析基准目录
- `--now <timestamp>` — 测试时覆盖生成时间
- `--json` — 输出结构化结果，包含解析条数与目标路径

`compact` 可选参数：

- `--archive-dir <dir>` — 指定 archive 根目录，默认是源文件同级的 `archives/`
- `--retention-days <days>` — 只归档早于该天数、且已经被更近记录覆盖的旧条目，默认 `7`
- `--summary <file>` — compact 后重建 summary 的输出路径
- `--state <file>` — compact 后重建 state 的输出路径
- `--cwd <dir>` — 指定相对路径解析基准目录
- `--now <timestamp>` — 测试时覆盖当前时间
- `--json` — 输出结构化结果，包含 active/archived 计数与目标路径

如果不显式提供 `--summary` 和 `--state`，openCodex 会按源文件名自动推导。
对于以 `_insights.md` 结尾的文件，会生成：

- `_summary.md`
- `_summary_state.json`

## 归并与拆分规则

- 同一 `主题键` 下，时间最新的记录覆盖旧进度，成为当前 summary 的有效版本。
- 如果旧记录没有 `主题键`，才回退到标准化后的标题归并。
- 如果旧记录没有 `主题键`、而后续同标题记录补了显式 `主题键`，只有在该标题唯一映射到这一个 `主题键` 时才会自动并入。
- `sync` 不会改写原始追加文件，只会重建 summary 与 state。
- `compact` 会保留每个主题当前最新的一条 active 记录，再把“超过保留窗口且已被覆盖”的旧条目迁到 archive。
- archive 默认按“项目 / 月份”拆分，例如 `archives/opencodex/2026-03.md`。
- summary 会按项目分组，优先展开当前活跃主题，而不是把所有历史细节重复铺平。

## 建议条目结构

为了保证归并稳定，每条 memory 建议至少包含：

- `项目`
- `主题键`
- `关键判断`
- `动作`
- `验证`
- `进度`
- `下一步`
- `可复用规则`
- `关键词`

## 调度建议

`opencodex memory` 只负责能力本体，不负责内建 scheduler。
调度层可以是：

- Codex desktop automations
- `launchd`
- 其他本地调度器

关键原则是：调度层调用 openCodex 能力，而不是各仓库自己维护的解析脚本。

## 推荐策略

如果 memory 增长很快，不要继续把热数据、冷数据和稳定规则都堆在一个文件里。更稳的做法是：

- active source 保留最近窗口内的完整条目，以及每个主题的最新状态
- archive 保存旧且已被覆盖的历史条目
- 记录里显式写 `项目`，让 summary 和 archive 都能按项目维度收敛
- 触发 compact 时同时看时间和体积，不要只依赖“超过 7 天”这一条规则
