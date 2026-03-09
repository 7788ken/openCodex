# T016 — CTO Conversation and Research Mode

## Objective

Make chat, discussion, and research first-class CTO capabilities so the CEO can think aloud with openCodex before switching into orchestration.

## Why Now

The current Telegram CTO loop already has a casual-chat gate, but that is not enough.
The CTO should support deeper discussion, architectural trade-off analysis, option comparison, and lightweight research without forcing every turn into task dispatch.

## Scope

- Add an explicit exploration mode for the CTO control loop.
- Keep chat, discussion, and research replies natural and CEO-facing.
- Delay orchestration until the CEO explicitly asks to execute or the intent becomes concretely actionable.
- Preserve the ability to promote an exploratory thread into a workflow later.
- Make the mode visible in prompts, session summaries, and control-surface wording where useful.

## Acceptance Criteria

- The CTO can hold a short back-and-forth discussion without spawning a workflow.
- Messages about architecture, trade-offs, and research are not forced into task dispatch on the first turn.
- The CEO can later turn the same thread into orchestration with a concrete execution request.
- The behavior remains compatible with existing workflow status and history views.
