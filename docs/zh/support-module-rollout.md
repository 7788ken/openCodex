# 客服模块上线说明（Telegram + 咸鱼）

## 模块目的

该模块是一个独立、可配置的客服域，统一承接：

- Telegram 群客服（`telegram_group`）：群管理与售后入口。
- 咸鱼个人客服（`xianyu_personal`）：一对一订单与售后处理。

当前切片以本地可验证为优先，强调状态可追踪、行为可复现，便于快速上线与安全迭代。

## 配置参考（当前切片）

在 `opencodex.config.json` 中使用 `support`（兼容别名 `support_module`）：

```json
{
  "support": {
    "enabled": true,
    "state_path": ".opencodex/support/state.json",
    "channels": {
      "telegram_group": {
        "enabled": true,
        "chat_ids": ["<group_chat_id>"],
        "default_assignee": "tg_ops"
      },
      "xianyu_personal": {
        "enabled": true,
        "mode": "mock",
        "default_assignee": "xy_ops"
      }
    },
    "routing": {
      "default_queue": "after_sales",
      "rules": [
        {
          "channel": "telegram_group",
          "chat_id": "<group_chat_id>",
          "queue": "tg_after_sales"
        },
        {
          "channel": "xianyu_personal",
          "user_id": "<xianyu_user_id>",
          "order_type": "order_after_sales",
          "queue": "xy_after_sales"
        }
      ]
    }
  }
}
```

## TG / 咸鱼行为边界

- Telegram 边界：
  - 配置了 `chat_ids` 时，只接收白名单群消息。
  - 仅处理客服意图消息与工单状态流转。
  - 以群维度聚合线程键（`tg:<chat_id>`），同一群内未完结工单会持续追加。
  - 不承担通用闲聊机器人职责。
  - 禁言/踢人/反垃圾等群管动作不在当前切片范围。
- 咸鱼边界：
  - 是否启用由配置控制。
  - 当前仅支持 `mode: "mock"`，不触发生产外部调用。
  - 以用户维度聚合线程键（`xy:<user_id>`），用于一对一订单/售后跟进。
  - 订单/售后请求复用同一套工单模型。
- 统一工单边界：
  - 状态机：`open -> processing -> waiting_buyer -> resolved -> closed`。
  - 状态命令：`/support take|wait|resolve|close SUP-XXXX`。
  - 只有入站被成功处理时，才会触发对应渠道的出站适配器分发。

## 本地上线步骤

1. 在 `opencodex.config.json` 写入客服配置。
2. 咸鱼先保持 `mode: "mock"` 完成本地验证。
3. 通过本地命令或测试注入 Telegram/咸鱼入站消息。
4. 校验 `state_path` 下的状态落盘是否正确。
5. 校验路由命中、状态流转与渠道分发输出。
6. 基线稳定后再逐步扩展 `routing.rules`。

## 本地验证命令

1. 运行聚焦测试：`node --test tests/support.test.js tests/support-module.behavior.test.js`。
2. 快速检查配置：`node ./bin/opencodex.js support status --cwd <your-project-dir> --json`。
3. Telegram 模拟：`node ./bin/opencodex.js support simulate --cwd <your-project-dir> --channel telegram_group --chat-id <id> --sender-id <id> --text "#support order A100 refund" --json`。
4. 咸鱼模拟：`node ./bin/opencodex.js support simulate --cwd <your-project-dir> --channel xianyu_personal --user-id <id> --sender-id <id> --text "order XY100 after-sales" --json`。

## 当前已知缺口

- 尚未接入生产级咸鱼适配器。
- 尚未实现 SLA 计时与升级策略。
- 尚未提供 Telegram 群管的丰富动作流。
- 工单权限与多代理并发冲突控制仍是基础版本。
- 重复入站消息仍可能写入重复事件。

## 下一轮安全迭代

1. 为入站事件增加幂等键，避免重复追加。
2. 补齐适配器契约测试与固定夹具。
3. 增加队列级指标与可回放去重能力。
4. 增加最小化的 TG 群管钩子，并与工单状态流转解耦。
