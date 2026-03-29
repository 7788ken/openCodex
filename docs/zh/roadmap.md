# 路线图

## Phase 0 — 项目初始化

- 定义仓库结构。
- 建立双语文档规则。
- 编写初版项目概览。

## Phase 1 — CLI 骨架

- 添加基础 CLI 入口。
- 支持本地任务的 `run` 命令。
- 输出结构化执行摘要。

## Phase 2 — 核心流程

- 增加仓库检索能力。
- 增加基础规划能力。
- 增加补丁应用支持。

## Phase 3 — 验证闭环

- 增加聚焦型命令执行。
- 采集命令输出。
- 以清晰摘要报告验证状态。

## Phase 4 — 安装产物形态

- 定义 detached install 的运行时根目录。
- 让 App 形态和 CLI 形态基于同一套 runtime 并存。
- 让长期服务绑定安装产物，而不是源码 checkout。

## Phase 5 — Codex Session Bridge

- 在真实 Codex launcher 前面放一层透明 `codex` bridge shim。
- 让 bridge-owned live session 成为 remote/mobile 续接的受支持 attach 目标。
- 让会话历史、最近输出和远程续接统一落在同一条主线 session 模型上。

## Phase 6 — Native Host Runtime Spine

- 把 bridge/runtime 的宿主 ownership 收口到 Swift native spine，前提是真正存在 OS 集成需求。
- 让 JS 继续做编排层和产品逻辑层，而不是底层 runtime owner。
