# 客服域契约（双渠道）

## 目标

定义一个最小可落地的独立客服模块契约，同时服务：

- Telegram 群客服（`tg_group`）
- 咸鱼个人客服（`xianyu_personal`）

模块需可配置、可回滚，不引入重型 fallback。
当渠道关闭或配置错误时，应直接报错而不是隐式绕路。

## 设计约束

- 一个工单只能归属一个渠道。
- 不允许跨渠道自动 fallback。
- 路由和 SLA 全部由配置驱动。
- 分配和状态流转前必须做权限校验。
- 适配器只负责收发与归一化，业务策略留在领域层。

## 领域模型

英文实现契约、类型定义、状态机、适配器接口和 JSON Schema 以 `docs/en/support-domain-contract.md` 为准，中文文档保持同构解释，便于评审与协作。

### 核心对象

- `SupportTicket`：工单主实体，包含渠道、状态、售后子状态、优先级、SLA 截止时间。
- `TicketMessage`：工单消息，区分 `inbound`、`outbound`、`internal_note`。
- `TicketEvent`：审计事件，记录流转、升级、SLA 违约等关键动作。

### 状态定义

- 工单状态：`new`、`triaged`、`assigned`、`waiting_customer`、`waiting_internal`、`after_sales`、`resolved`、`closed`、`cancelled`
- 售后子状态：`none`、`requested`、`evidence_required`、`evidence_received`、`solution_proposed`、`solution_accepted`、`fulfillment_in_progress`、`fulfilled`、`rejected`

## 工单生命周期规则

- `new -> triaged`：基础校验和渠道策略通过。
- `triaged -> assigned`：分配规则选出唯一客服。
- `assigned -> waiting_customer`：等待用户补充信息。
- `assigned -> waiting_internal`：等待内部动作。
- `assigned -> after_sales`：进入售后流程。
- `waiting_customer -> assigned`：收到并验证用户回复。
- `waiting_internal -> assigned`：内部依赖完成。
- `after_sales -> resolved`：售后处理完成并确认。
- `resolved -> closed`：达到关闭条件。
- `* -> cancelled`：有权限角色可取消并写明原因。

不可跳转约束：

- `new` 不能直接到 `assigned`，必须先 `triaged`。
- `after_sales` 不能直接 `closed`，必须先 `resolved`。
- `closed` 与 `cancelled` 为终态。

## 分配规则

在 `triaged -> assigned` 执行一次自动分配，仅允许显式重分配再触发：

1. 过滤条件：渠道权限、值班可用性、规则标签技能匹配。
2. 排序条件：当前在手工单数最少、上次分配时间最早。
3. 选择第 1 名。
4. 若无人可分配：切换到 `waiting_internal`，并写入 `ticket_escalated(no_eligible_agent)` 事件。

## 售后流程

售后是 `after_sales` 下的严格子状态机：

- `requested -> evidence_required`
- `requested -> solution_proposed`
- `evidence_required -> evidence_received`
- `evidence_received -> solution_proposed`
- `solution_proposed -> solution_accepted`
- `solution_proposed -> rejected`
- `solution_accepted -> fulfillment_in_progress`
- `fulfillment_in_progress -> fulfilled`
- `fulfilled -> none`（允许工单转 `resolved`）

可用补救动作由配置控制：`refund`、`replacement`、`repair`、`coupon`、`manual`。

## 权限边界

- `owner`：配置变更、强制关闭/取消、覆盖分配。
- `manager`：重分配、升级、审批售后方案。
- `agent`：回复用户、写内部备注、执行允许的操作态流转。
- `bot`：仅可收发渠道消息，不可直接改业务状态。

硬边界：

- 升级级别变更仅 `owner/manager` 可执行。
- `after_sales_state` 进入 `solution_proposed` 及后续阶段仅 `manager/owner` 可执行。
- 适配器层禁止直写状态，必须走领域命令。

## 渠道适配器接口

采用统一接口：

- `validateConfig`
- `start` / `stop`
- `normalizeInbound`
- `sendOutbound`

适配器失败必须显式暴露错误与重试元数据，不允许用跨渠道 fallback 掩盖。

## 严格配置 Schema 与示例

- 严格 JSON Schema（draft 2020-12）和可直接使用的示例配置见英文文档：
  `docs/en/support-domain-contract.md`
- Schema 强制 `additionalProperties: false`，覆盖：
  - `features`（功能开关）
  - `channels`（渠道开关与适配器）
  - `routing`（路由规则）
  - `sla`（分优先级时限）
  - `escalation`（升级策略）
  - `templates`（消息模板）

## 最小落地步骤

1. 新增配置加载与 Schema 校验。
2. 增加工单流转与售后流转命令处理器。
3. 以同一适配器接口实现 TG 与咸鱼通道。
4. 补齐聚焦测试：状态机守卫、分配规则、配置校验、适配器契约。
