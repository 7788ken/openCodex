# Native Host Runtime Spine

## 目的

本文定义 openCodex 为什么需要一条 native host/runtime spine，以及这条 spine 应该拥有哪些职责。

驱动力不是语言偏好。
驱动力是 ownership。

凡是一个能力真正需要：

- OS 级进程所有权
- PTY 生命周期控制
- 更强的 service/runtime 身份
- 更严谨的 detached install ownership
- 更底层的 native framework 集成

就不应该仅仅因为 JS 写起来更快，就默认继续放在 JS 里实现。

## 核心规则

JS 保留给这些职责：

- 编排逻辑
- workflow policy
- session summary
- 跨命令的产品逻辑
- repo-facing 的业务规则

Swift native spine 收口这些职责：

- bridge launcher ownership
- live-session runtime ownership
- PTY/input/output 控制
- native service/process 生命周期
- 未来依赖 native OS 集成的宿主状态发布面

## 为什么这对产品重要

产品目标不是“尽量多用 JS 写 openCodex”。
产品目标是：

- 桥接到真实 Codex 会话
- 让远程入口安全地继续这些会话
- 让安装产物层的 runtime ownership 保持一致

这意味着 bridge/runtime 这一层是基础设施，不是临时胶水。
如果这一层只是因为原型期写得快而一直留在 JS，架构就会倒过来：

- JS 持有了进程/runtime 真相
- native host integration 变成事后补丁
- install/service/process 语义会越来越难稳定

## 建议的职责切分

### Swift native spine 负责

- detached launcher/runtime 入口
- bridge 启动的 Codex 会话的进程 spawn 与 attach ownership
- PTY relay 和底层 IO 控制
- 长生命周期 service/runtime 的生命周期管理
- 需要更强 OS 保证的 native host 状态面

### JS core 负责

- 命令语义
- 编排策略
- session 归一化规则
- remote / IM / control-plane 路由逻辑
- 产品级 summary 与用户可读解释

## 增量迁移规则

这不是一条盲目重写计划。

迁移顺序应当是：

1. 先把边界写清楚
2. 找出当前把 host ownership 泄漏到 JS 的 bridge/runtime 表面
3. 按切片逐步迁移这些表面
4. 宿主层迁移期间，保持 session model 和产品语义稳定

## 第一批候选切片

优先迁移到 native 的切片应包括：

- bridge launcher/runtime 入口
- PTY-backed live-session ownership
- service/runtime 生命周期管理
- 面向外部客户端的 active bridge session 状态发布面

## 与 T021 的关系

`T021` 是产品主线。
它定义的是 Codex session bridge。

`T023` 的存在是为了支撑 `T021`，不是替代它。
native spine 是 bridge 模型下面的 host/runtime 基础设施。

## 非目标

- 把所有 openCodex 命令逻辑都改写成 Swift
- 在 JS 仍然最适合做编排的地方强行去 JS
- 在边界尚未证明前就引入过重的多语言抽象框架

## 验收

- 仓库里存在一条明确的 native-vs-JS 边界说明
- bridge/runtime ownership 表面已经被明确归到 native spine
- 后续实现切片可以直接沿着这条边界推进，而不必每次重新争论架构意图
