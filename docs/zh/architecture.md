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

- `opencodex run` -> `codex exec --json --output-schema`
- `opencodex review` -> `codex review`
- `opencodex doctor` -> 本地环境就绪检查

## 明确的非目标

第一版不应：

- 重写本地 coding engine
- 把交互式 TUI 文本解析作为主要契约
- 依赖 experimental 的 app-server 特性
- 在本地 CLI 流程尚未跑顺前扩展成 gateway 平台
