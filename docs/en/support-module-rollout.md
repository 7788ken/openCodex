# Support Module Rollout (Telegram + Xianyu)

## Purpose

This module is an independent, configurable support domain that handles:

- Telegram group support (`telegram_group`) for group moderation and after-sales intake.
- Xianyu personal support (`xianyu_personal`) for one-to-one order and after-sales handling.

The first implementation slice is local-only, stateful, and deterministic for fast rollout and safe iteration.

## Config Reference (Current Slice)

Define config in `opencodex.config.json` under `support` (or `support_module` alias).

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

## Behavior Boundaries

- Telegram scope:
  - Accepts only configured `chat_ids` when provided.
  - Handles support-intent messages and ticket transitions only.
  - Uses one thread key per group chat (`tg:<chat_id>`), so the same open ticket is appended until resolved/closed.
  - Not a generic chat bot in this module.
  - Group moderation actions (mute/kick/anti-spam) are out of scope in this slice.
- Xianyu scope:
  - Channel is enabled/disabled by config.
  - Current mode is `mock` only; no production API calls.
  - Uses one thread key per user (`xy:<user_id>`), targeting one-to-one order/after-sales follow-up.
  - Personal order/after-sales intents are routed through the same ticket model.
- Shared ticket model:
  - Ticket states: `open -> processing -> waiting_buyer -> resolved -> closed`.
  - Transition commands: `/support take|wait|resolve|close SUP-XXXX`.
  - Outbound dispatch is channel-specific through adapter hooks and only runs when inbound is actually handled.

## Local Rollout Steps

1. Add support config to `opencodex.config.json`.
2. Keep Xianyu in `mode: "mock"` for local verification.
3. Send Telegram/Xianyu-like inbound events via local command/test harness.
4. Confirm state persistence under `state_path`.
5. Verify route matching, transition behavior, and channel dispatch output.
6. Expand routing rules after baseline behavior is stable.

## Local Validation Commands

1. Run focused tests: `node --test tests/support.test.js tests/support-module.behavior.test.js`.
2. Quick config check: `node ./bin/opencodex.js support status --cwd <your-project-dir> --json`.
3. Telegram simulation: `node ./bin/opencodex.js support simulate --cwd <your-project-dir> --channel telegram_group --chat-id <id> --sender-id <id> --text "#support order A100 refund" --json`.
4. Xianyu simulation: `node ./bin/opencodex.js support simulate --cwd <your-project-dir> --channel xianyu_personal --user-id <id> --sender-id <id> --text "order XY100 after-sales" --json`.

## Known Gaps (Current Slice)

- No production Xianyu adapter integration yet.
- No SLA timer/escalation workflow yet.
- No rich Telegram group moderation flow in this module yet.
- Ticket permissions and multi-agent conflict control are basic.
- Duplicate inbound deliveries can still append duplicate events.

## Next Safe Iteration

1. Add idempotency keys for inbound events to avoid duplicate appends.
2. Introduce adapter contract tests with deterministic fixtures.
3. Add queue-level metrics and replay-safe event dedup.
4. Introduce minimal TG moderation hooks without mixing them into ticket state transitions.
