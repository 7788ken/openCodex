# 项目状态快照（2026-03-29）

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
- 让 Codex session bridge 成为远程续接与历史查看的产品主线。
- 当 bridge/runtime 真正需要 OS 集成、PTY 控制和 service ownership 时，把宿主 ownership 收口到 native spine。

## 当前进度

### 已落地能力

- 命令面已覆盖：
  - `run`
  - `session`
  - `doctor`
  - `review`
  - `auto`
  - `bridge`
  - `remote`
  - `im`
  - `service`
  - `install`
- 测试状态（2026-03-29）：
  - 当前主要依赖 bridge / remote / im / install 相关的聚焦回归
  - 下一轮 bridge 主线实现后，需要重新做一次完整测试基线收口

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
  - `T021` Installed Codex control bridge（installed bridge state、shim install/repair、live-session records、remote/Telegram attach、最近输出和外部消息中继已落地；operator-facing 的 selector / attachability / no-reopen 契约也已写清；剩余缺口是 orphaned/dangling 修复语义、crash 后一致性策略，以及 installed-product 与 native-runtime 的后续落地）
- 新开任务：
  - `T023` Native host runtime spine（作为 bridge/runtime 宿主 ownership 收口的支撑性重构路径，已先完成文档定义）
- 部分实现（partial）：
  - `T017` Detached install 形态（核心边界已完成，剩余 packaging/lifecycle 打磨）
  - `T020` Mobile/Web control-plane 边界（边界文档与 `remote status` 诊断能力已落地，剩余更完整 control-plane 产品化收敛）
- 暂停（parked）：
  - `T008` Gateway spike

### 最近迭代重点

- 把产品主线重新收回到 `T021`：桥接到真实 Codex 会话、远程查看同一条会话、继续同一条主线工作，而不是再开平行 lane。
- 在“文档先行，wiki 先行”的前提下，为 `T023` 补了宿主 ownership 的 native spine 设计文档，明确 bridge/runtime 不应只因实现便利继续留在 JS。
- 把 `T021` 当前已经成立的 operator 规则写实到 bridge wiki：live selector 只认全局 active pointer，attach 只认 running bridge session，历史 bridge session 目前只读、不支持 reopen / resume。
- 把 `T021` 当前 repair/recovery contract 也写实到 bridge wiki：安装层 repair 与 live-session recovery 已拆开说明，当前 recovery 只支持诊断后重新启动新的 bridge-owned 主线，不假装能复活旧 live lane。
- 增加并强化 host-supervisor 恢复路径、并发 lease 防重机制与 service 周期性 supervisor tick。
- 将 session-contract 元数据扩展到 `im/auto/run/review/session/service` 相关链路。
- service 在 workflow/dispatch 聚合时，父会话 child metadata 过期时会从子会话 `session.json` 回填 contract 快照。
- rehydrated supervisor 在拿到 resume lease 后会重新核对持久化 workflow/session 状态，避免并发窗口下重复恢复。
- 完成 detached install 的 bundle/install/status、service relink 和 bootstrap 安装链路。
- 补齐 `mobile-control-plane` 中英文边界文档，并建立 `T020` 跟踪。

## 风险与待收敛项

- Supervisor 仍由 launchd + CLI wrapper 组装，尚未统一为单一独立 runtime 生命周期。
- 历史 session 与旧生产路径仍存在部分 contract 推断/回填逻辑。
- 手机/Web 控制面仍处于“边界已收敛、实现待落地”的阶段。
- detached 安装链路可用，但产品化 packaging 细节仍需持续打磨。
- bridge-owned 会话在 orphaned controller、dangling active pointer、runtime crash 后的一致性修复策略仍待继续收敛。
- bridge/runtime 这一层在宿主 ownership 上仍然偏 JS，需要按 `T023` 逐步下沉到 native spine。
