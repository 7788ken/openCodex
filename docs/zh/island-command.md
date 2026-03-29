# Island 命令

## 目的

`opencodex island` 提供一个轻量原生 macOS 浮层，默认停靠在菜单栏 / 刘海区域附近，用来汇总所有已知 workspace 的 Codex 任务状态。

它的目标不是菜单栏图标，而是更接近系统灵动岛的任务面板：

- 收敛态：左侧显示当前状态，右侧显示进行中的任务数
- 展开态：显示仍然需要用户处理的待回复消息
- 全局态：聚合所有已知 workspace，而不是只看当前仓库

## 用法

```bash
node ./bin/opencodex.js island status --json

node ./bin/opencodex.js island install --open

node ./bin/opencodex.js island open
```

## 子命令

`status`：

- 返回当前工作区以及所有已知 workspace 的聚合状态
- 工作区来源包括：
- 当前 `--cwd`
- `~/.opencodex/workspaces`
- 持久化 workspace registry
- Telegram service 配置中的工作区
- 输出包含 counts、focus session 和 `pending_messages`

`install`：

- 把生成的 Swift 源码写到 `~/.opencodex/island/`
- 默认编译到 `~/Applications/OpenCodex Island.app`
- 支持覆盖 app 路径、applications 目录、CLI 路径、Node 路径和 home 目录
- `--open` 会在编译完成后直接打开 overlay

`open`：

- 不重装，直接打开已经安装的 overlay app

## 说明

- overlay 本身是只读的，通过轮询 `opencodex island status` 获取状态
- 收敛态和展开态都会跟随当前 macOS 亮 / 暗模式
- 它独立于主 `OpenCodex.app` 宿主壳，但不是菜单栏图标工作流
