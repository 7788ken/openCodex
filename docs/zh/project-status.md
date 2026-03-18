# 项目状态快照（2026-03-18）

## 定位

openCodex 是构建在 Codex CLI 之上的本地编排层，不重写本地 coding engine。
产品关注点是工作流编排、session 归一化、策略映射、同机协同和多入口控制面。

## 项目目标

1. 让任务从“意图”到“可验证改动”形成可观察闭环。
2. 保持最小且可回滚的改动策略，避免高风险大改。
3. 以 `run` 作为主干活入口，`session` 作为同机追踪与交接入口。
4. 让宿主机 CTO supervisor 持有对外身份和最终控制权，沙箱子会话保持从属。

## 展望

- 继续收敛为“host supervisor + sandbox advisors”的稳定模型。
- 手机/Web 入口保持窄 control plane，不演化为远程 IDE。
- 默认 local-first / private-network-first，不把公网 relay 作为第一阶段前提。
- 安装形态保持 App、CLI、长期 service 共用同一 detached runtime。

## 当前进度

### 已落地能力

- 命令面已覆盖：
  - `run`
  - `session`
  - `doctor`
  - `review`
  - `auto`
  - `remote`
  - `im`
  - `service`
  - `install`
- 测试状态（2026-03-18）：
  - `npm test` 通过，`172/172` 通过。

### 看板状态摘要

- 已实现或完成：
  - `T001` 到 `T012`
  - `T018`
  - `T019`
- 基本实现（mostly implemented）：
  - `T013` Host supervisor runtime（剩余独立 runtime 生命周期统一）
  - `T014` Session contract（剩余历史记录一致性收敛）
  - `T015` Supervisor 与子会话可视分离（剩余旧记录回填）
  - `T016` Conversation / research mode（剩余全控制面持久可见性）
- 部分实现（partial）：
  - `T017` Detached install 形态（核心边界已完成，剩余 packaging/lifecycle 打磨）
- 规划中：
  - `T020` Mobile/Web control-plane 边界（边界文档已完成，实现待跟进）
- 暂停（parked）：
  - `T008` Gateway spike

### 最近迭代重点

- 增加并强化 host-supervisor 恢复路径、并发 lease 防重机制与 service 周期性 supervisor tick。
- 将 session-contract 元数据扩展到 `im/auto/run/review/session/service` 相关链路。
- 完成 detached install 的 bundle/install/status、service relink 和 bootstrap 安装链路。
- 补齐 `mobile-control-plane` 中英文边界文档，并建立 `T020` 跟踪。

## 风险与待收敛项

- Supervisor 仍由 launchd + CLI wrapper 组装，尚未统一为单一独立 runtime 生命周期。
- 历史 session 与旧生产路径仍存在部分 contract 推断/回填逻辑。
- 手机/Web 控制面仍处于“边界已收敛、实现待落地”的阶段。
- detached 安装链路可用，但产品化 packaging 细节仍需持续打磨。

