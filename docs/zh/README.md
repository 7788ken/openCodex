# 文档索引

这里存放 openCodex 的中文文档。

## 安装指南

### 前置条件

- `Node.js 20+`
- 已安装并登录 `Codex CLI`
- 如果要使用当前的 detached app + `launchd` 服务流程，建议在 macOS 上操作

### 一键安装

如果你希望给 Codex 或终端一条命令，就把 openCodex 装好，可以直接用：

```bash
curl -fsSL https://raw.githubusercontent.com/7788ken/openCodex/main/scripts/install-opencodex.sh | bash
```

这个脚本会自动：

- 拉取 openCodex
- 执行 `doctor`
- 打运行时 bundle
- 安装 detached runtime、CLI shim 和 App 壳

如果你已经在本地有仓库，不想再 clone 一次，也可以直接复用当前 checkout：

```bash
OPENCODEX_SOURCE_DIR="$PWD" bash ./scripts/install-opencodex.sh
```

### 方案一：直接从源码运行

适合先试用 openCodex，或者直接在仓库里开发。

```bash
git clone https://github.com/7788ken/openCodex.git
cd openCodex
node --version
node ./bin/opencodex.js doctor
node ./bin/opencodex.js run "summarize this repository"
```

当前还没有单独的 build 步骤。
CLI 直接运行仓库里的源码。

### 方案二：安装成 detached runtime

适合长期使用，不希望 CLI、App 和长期服务继续绑定当前源码目录。

```bash
git clone https://github.com/7788ken/openCodex.git
cd openCodex
node ./bin/opencodex.js doctor
node ./bin/opencodex.js install bundle
node ./bin/opencodex.js install detached --bundle ./dist/opencodex-runtime-<version>-<timestamp>.tgz
node ./bin/opencodex.js install status
open "$HOME/Applications/OpenCodex.app"
```

当前 detached 安装默认会落到：

- runtime 根目录：`~/Library/Application Support/OpenCodex`
- CLI shim：`~/.local/bin/opencodex`
- App：`~/Applications/OpenCodex.app`

### 开发快捷方式

如果你就是想让安装后的 App 和 CLI 继续跟着当前源码变动，可以用：

```bash
node ./bin/opencodex.js install detached --link-source
```

这只是开发模式。
长期服务默认还是应该指向 detached installed runtime，而不是源码目录。
一键安装脚本面向的是 detached install，不是 `--link-source` 这种开发模式。

### 相关文档

- `install-command.md` — 安装命令、参数和输出说明
- `install-layout.md` — detached runtime 的目录布局和升级方式
- `../../README.md` — 仓库根 README，包含命令概览和快速开始

## 当前文档

- `project-overview.md` — 项目定位、范围与原则。
- `roadmap.md` — 初始里程碑与交付方向。
- `team.md` — 团队架构、固定内部称呼与管理规则。
- `session-model.md` — wrapper 命令使用的 session、summary 与 artifact 结构。
- `architecture.md` — 分层架构决策与 MVP 边界。
- `command-spec.md` — 第一版 CLI 命令面与边界。
- `doctor-command.md` — 本地就绪检查、输出结构与退出行为。
- `review-command.md` — review 工作流输入、artifacts 与 summary 策略。
- `auto-command.md` — 基于现有 wrapper 命令串联的无人值守本地工作流。
- `remote-command.md` — 基于本地 HTTP 的带 token 手机消息桥。
- `service-command.md` — Telegram CTO 模式的 macOS launchd 服务与菜单栏 app 管理。
- `install-command.md` — detached runtime 安装与本地 CLI shim 管理。
- `im-command.md` — 以 Telegram 为第一优先的即时通讯连接器。
- `cto-main-thread-sequence.md` — CTO 主线程、workflow 与 task 的 chat-first 时序图。
- `profile-policy.md` — 当前 wrapper profiles 与 Codex CLI 策略映射。
- `cto-soul.md` — CTO 主线程可编辑的初始化提示文档。
- `install-layout.md` — App 形态、CLI shim 与长期服务共享 detached runtime 的安装布局。

## 说明

- 仓库内容默认使用英文。
- 中文文档与英文文档保持对应，英文版本位于 `../en/`。
