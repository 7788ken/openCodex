# 安装产物布局

## 目标

定义一套 detached install 布局，让 openCodex 的 App 形态、CLI 形态和长期后台服务可以并存，但不会把生产运行时绑定到源码 checkout。

## 核心规则

openCodex 可以同时以两种形态存在：

- 桌面 / 菜单栏应用
- `opencodex` CLI 入口

两者可以并存，但不能各跑各的。
已安装的 App、CLI shim 和 `launchd` 服务必须最终落到同一个 detached runtime root。
源码 checkout 只负责开发，不应成为默认的长期安装 launcher。
源码世界和安装世界之间，推荐通过显式 runtime bundle 交接，而不是直接从当前 checkout live copy。

## 第一版支持的布局

第一版建议先支持用户级 macOS 安装。
这样权限更简单，也和当前 Telegram service 的用户级模型一致。

建议布局：

```text
~/Library/Application Support/OpenCodex/
├── installs/
│   └── <version>/
│       ├── bin/
│       │   └── opencodex.js
│       ├── package.json
│       ├── src/
│       └── resources/
└── current -> installs/<version>

~/Applications/OpenCodex.app
~/.local/bin/opencodex -> ~/Library/Application Support/OpenCodex/current/bin/opencodex.js
~/.opencodex/
├── service/
├── sessions/
└── ...
```

## 职责划分

- `~/Library/Application Support/OpenCodex/current` 是唯一的运行时根目录。
- `~/Applications/OpenCodex.app` 是包在外层的宿主壳，不单独拥有一套 runtime。当前实现里它是一个生成出来的 AppleScript App，用来启动 detached CLI 流程。
- `~/.local/bin/opencodex` 是指向同一 runtime 的 CLI shim。
- `~/.opencodex` 存放可变用户状态，必须和安装 runtime 分离。

## Service 绑定规则

- `launchd` wrapper 和菜单栏动作都应绑定到独立安装的 CLI，而不是仓库 checkout。
- 实际绑定时应优先使用 `current/bin/opencodex.js`，而不是具体版本槽位路径，这样升级切换 `current` 后 service 才能自动跟随。
- `service.json` 应保存 launcher provenance，便于 `doctor` 和 `service status` 识别 checkout-coupled install。
- 对历史上已经绑到源码 checkout 的安装，`service relink` 是标准修复路径。

## 升级模型

推荐的 release/install 交接流程：

1. 在准备交付的源码树里运行 `opencodex install bundle`。
2. 把产出的 bundle 交给目标机器或安装操作方。
3. 在目标侧运行 `opencodex install detached --bundle <path>`。

安装后的 runtime 升级流程：

1. 把新版本安装到 `installs/<version>`。
2. 原子切换 `current` 指针。
3. 让 App 壳和 CLI shim 持续指向 `current`。
4. 仅在必要时刷新或重启长期服务。
5. 不触碰开发仓库。

这样可以让 App、CLI 和 service 始终共享同一版本 runtime，而不需要每次升级都完整卸载重装。

## 开发规则

仓库 checkout 只用于开发、测试和临时本地实验。
如果开发者明确需要在本地调试期间让 service 跟随当前 checkout，这种行为必须显式 opt-in，并且在状态里清楚标记为临时耦合。
直接在当前 checkout 上执行 `install detached` 仍然保留，但它更适合开发期临时验证，不再作为默认的产品安装交付路径。

## 非目标

本文档不定义：

- 最终打包技术选型
- notarization / code-signing 细节
- 第一版就支持 `/Library` 或 `/Applications` 的系统级安装
- Windows / Linux 的跨平台安装器行为
