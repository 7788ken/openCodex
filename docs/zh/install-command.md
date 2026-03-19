# Install 命令

## 目的

`opencodex install` 用来创建或检查 detached local runtime，避免已安装 CLI 和长期 service 继续依赖源码 checkout。

## 第一版范围

第一版支持：

- `opencodex install bundle`
- `opencodex install detached`
- `opencodex install status`
- `opencodex install prune`

`bundle` 用来先产出一个可交付的 runtime 包。
`detached` 会安装版本化 runtime 目录、重写 `current` 指针、创建用户级 CLI shim，并编译一个指向同一 `current` runtime 的轻量 `OpenCodex.app` 宿主壳。
这个 App 壳本身不复制业务逻辑，而是把动作回落到已安装 CLI runtime。

## 一键脚本

现在仓库里也提供了一条命令式安装入口，适合直接让终端或 Codex 执行：

```bash
curl -fsSL https://raw.githubusercontent.com/7788ken/openCodex/main/scripts/install-opencodex.sh | bash
```

这个脚本默认走 detached install 流程：

1. 拉取 openCodex
2. 执行 `doctor`
3. 执行 `opencodex install bundle`
4. 执行 `opencodex install detached --bundle <path>`

如果你本地已经有 checkout，也可以直接复用：

```bash
OPENCODEX_SOURCE_DIR="$PWD" bash ./scripts/install-opencodex.sh
```

## 输入

### `bundle`

- `--output <path>`；默认：`./dist/opencodex-runtime-<version>-<timestamp>.tgz`
- `--force`
- `--json`

### `detached`

- `--root <dir>`；默认：`~/Library/Application Support/OpenCodex`
- `--bin-dir <dir>`；默认：`~/.local/bin`
- `--applications-dir <dir>`；默认：`~/Applications`
- `--bundle <path>`；可选，已打好的 runtime bundle 或已解压 bundle 目录
- `--name <id>`；可选，安装槽位名
- `--link-source`；不复制文件，直接把安装槽位链接回当前源码仓库；仅用于开发期
- `--force`
- `--json`

### `status`

- `--root <dir>`
- `--bin-dir <dir>`
- `--applications-dir <dir>`
- `--keep <n>`；按保留数量 `n` 预览 prune 候选（不会删除）
- `--json`

### `prune`

- `--root <dir>`
- `--keep <n>`；最多保留 `n` 个安装槽位（若存在 `current` 目标会强制保留），默认 `3`
- `--dry-run`；仅预览不删除
- `--json`

## 输出

`bundle` 会报告：

- 产出的 bundle 路径
- bundle 是 archive 还是 directory
- 打包出来的 runtime 版本
- 这份 bundle 的来源 provenance

`detached` 会报告：

- 版本化 runtime 路径
- 供 `service relink` 使用的 `current` CLI 路径
- `current` 指针位置
- CLI shim 路径
- 已安装 App bundle 路径和生成的 AppleScript 源文件路径
- 已安装 runtime 的 launcher provenance
- 这次安装是 direct copy、source link，还是 bundle install
- 如果使用了 `--bundle`，还会带上 bundle provenance

`status` 会报告 detached runtime、CLI shim 和 App 壳是否存在，以及 `current` 当前解析到哪一个 runtime。
同时还会给出安装槽位生命周期信息，包括槽位总数、当前槽位名和 prune 预览信号。
默认按 `keep=3` 预览，也可以通过 `--keep <n>` 先预估其他保留策略下的清理范围，再决定是否执行 `prune`。
在文本模式下，`status` 还会直接列出预览候选槽位名，便于在清理前明确知道哪些 runtime 会被视为过期。
如果这套安装来自 bundle，`status` 还会显示 bundle 路径以及 bundle manifest 里记录的原始来源。

`prune` 会报告哪些安装槽位被保留、哪些被清理，并支持 dry-run 预览模式。

## 推荐流程

面向产品态安装，优先走这条流程：

1. `opencodex install bundle`
2. `opencodex install detached --bundle <path>`

直接在 live checkout 上跑 `install detached` 仍然保留，主要用于本地开发和临时验证，不再是默认推荐的交付路径。
如果你希望已安装 CLI 和 App 壳直接跟着当前仓库代码走，改完不用反复重新安装，可以使用 `opencodex install detached --link-source`。
这个模式只适合开发期，本质上仍然是让运行时和当前 checkout 保持耦合。

## 非目标

第一版不做：

- notarized 桌面应用打包
- 系统级 launcher 安装
- 自动改写现有 Telegram service
