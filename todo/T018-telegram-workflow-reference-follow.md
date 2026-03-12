# T018 — Telegram Workflow Follow-Up Reference Binding

## Objective

Keep colloquial Telegram follow-up questions such as “这个任务完成没有？” attached to the latest relevant CTO workflow instead of opening a brand-new empty workflow.

## Why Now

The Telegram CTO chat now supports planning, waiting-for-user, and status reporting.
If short follow-up questions are misread as fresh directives, the CEO sees a fake context gap even though the real workflow is still active.

## Scope

- Recognize colloquial Simplified Chinese completion/status follow-ups as status queries.
- Reuse the existing “latest workflow for this chat” lookup instead of adding a second workflow-binding system.
- Preserve the current override rules so messages like “继续检查项目进度并推进落地” still count as directives.
- Add regression coverage for waiting and running workflow follow-ups.

## Acceptance Criteria

- “这个任务完成没有？” reports the latest relevant workflow status for the same chat.
- Waiting workflows stay attached and expose their pending confirmation instead of creating a new empty workflow.
- Progress-push directives that mention “进度” still enter orchestration instead of being downgraded into status queries.
- Regression coverage proves no new CTO workflow is started for these follow-up questions.

## Current Status

- Implemented on 2026-03-12.
- Colloquial completion follow-ups now route through the existing status-report path.
- Regression coverage was added for both intent classification and Telegram waiting-workflow follow-ups.
