# 架构

## 核心决策

openCodex 架在 Codex CLI 之上。
它不打算替代或重写 Codex CLI 已经提供的本地 coding engine。

## 分层模型

### Layer 1 — Codex CLI

Codex CLI 是本地执行引擎。
它负责：

- 面向仓库的执行能力
- 文件编辑
- shell 命令执行
- sandbox 与 approval 控制
- 机器可读的命令接口

### Layer 2 — openCodex Runtime

openCodex 在 Codex CLI 之上提供编排层。
它负责：

- 工作流封装
- 命令预设
- session 归一化
- 结果摘要
- policy 与 profile 映射
- 项目级约定
- 同机任务协同

### Layer 2A — Host Supervisor

openCodex CTO 应该驻留在这一层。
这个宿主机上的 supervisor 负责：

- 面向 CEO 的长期身份与主线程归属
- workflow 状态、路由与队列监管
- 决定继续、reroute、停止还是回头确认
- 汇总子会话建议并形成唯一的 CTO 回复
- 持有任务栏、Telegram 等常驻控制面

### Layer 2B — Sandbox Advisor Sessions

沙箱子会话应当是下属 helper，而不是 CTO 身份本体。
它们可以承担：

- planner
- analyst
- reviewer
- 局部实现 helper

但它们不应成为 supervisor of record。
最终决策、状态归属与面向用户的回复仍由宿主 supervisor 持有。

## 安装产物边界

已安装的 App 形态、CLI 形态和长期服务应共享同一个 detached runtime root。
默认 launcher 不应再指向源码 checkout。
当前包装方向见 `install-layout.md`。

### Layer 3 — openCodex Gateway

这一层保留给后续阶段。
它可以提供：

- 远程入口
- chat 或 web 触发
- session 路由
- 常驻控制面

## MVP 边界

MVP 聚焦 Layer 2。
第一批命令应是对稳定 Codex CLI 能力的轻量封装。

建议的 MVP 路径：

- `opencodex run` -> 主要的本地干活入口
- `opencodex session` -> 本地追踪与协同入口
- `opencodex doctor` -> 辅助型就绪检查
- `opencodex review` -> 第二阶段 review 工作流
- `opencodex service` / `opencodex im` -> CTO 模式的宿主 supervisor 控制面

## 明确的非目标

第一版不应：

- 重写本地 coding engine
- 让某个沙箱子会话冒充 CTO 身份
- 把产品收缩成一个健康检查工具
- 把交互式 TUI 文本解析作为主要契约
- 依赖 experimental 的 app-server 特性
- 在本地 CLI 流程尚未跑顺前扩展成 gateway 平台
