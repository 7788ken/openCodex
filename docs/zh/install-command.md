# Install 命令

## 目的

`opencodex install` 用来创建或检查 detached local runtime，避免已安装 CLI 和长期 service 继续依赖源码 checkout。

## 第一版范围

第一版支持：

- `opencodex install bundle`
- `opencodex install detached`
- `opencodex install status`

`bundle` 用来先产出一个可交付的 runtime 包。
`detached` 会安装版本化 runtime 目录、重写 `current` 指针、创建用户级 CLI shim，并编译一个指向同一 `current` runtime 的轻量 `OpenCodex.app` 宿主壳。
这个 App 壳本身不复制业务逻辑，而是把动作回落到已安装 CLI runtime。

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
如果这套安装来自 bundle，`status` 还会显示 bundle 路径以及 bundle manifest 里记录的原始来源。

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
