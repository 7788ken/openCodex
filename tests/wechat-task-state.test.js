import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTaskLedgerContext,
  mergeUserTaskState,
  normalizeTaskSyncPayload,
  splitAssistantReply,
} from "../tools/wechat-agent-channel/sessions/task-state.js";

test("splitAssistantReply strips internal task sync block", () => {
  const rawReply = [
    "这件事我继续跟进，先把主线和当前动作分开记住。",
    "<oc_task_state>{\"focus\":\"bridge mainline\",\"long_tasks\":[{\"title\":\"修 bridge 主线\",\"status\":\"running\",\"summary\":\"正在持续推进\"}],\"short_tasks\":[{\"title\":\"核对最近失败日志\",\"status\":\"pending\",\"next_step\":\"先看最新报错\"}]}</oc_task_state>",
  ].join("\n");

  const result = splitAssistantReply(rawReply);
  assert.equal(result.visibleText, "这件事我继续跟进，先把主线和当前动作分开记住。");
  assert.equal(result.taskState.focus, "bridge mainline");
  assert.equal(result.taskState.long_tasks.length, 1);
  assert.equal(result.taskState.short_tasks.length, 1);
  assert.equal(result.taskState.long_tasks[0].status, "running");
  assert.equal(result.taskState.short_tasks[0].status, "pending");
});

test("normalizeTaskSyncPayload keeps only valid task entries and statuses", () => {
  const payload = normalizeTaskSyncPayload({
    focus: "repo repair",
    long_tasks: [
      { title: "修 repo 主线", status: "RUNNING" },
      { title: "", status: "completed" },
    ],
    short_tasks: [
      { title: "补测试", status: "done" },
    ],
  });

  assert.equal(payload.focus, "repo repair");
  assert.equal(payload.long_tasks.length, 1);
  assert.equal(payload.long_tasks[0].status, "running");
  assert.equal(payload.short_tasks.length, 1);
  assert.equal(payload.short_tasks[0].status, "pending");
});

test("mergeUserTaskState updates tasks and remembers latest dialog snippets", () => {
  const currentState = {
    focus: "old focus",
    long_tasks: [
      { id: "old-mainline", title: "旧主线", status: "running", summary: "", next_step: "", updated_at: "2026-03-24T00:00:00.000Z" },
    ],
    short_tasks: [],
    last_user_message: "旧消息",
    last_assistant_reply: "旧回复",
    updated_at: "2026-03-24T00:00:00.000Z",
  };

  const nextState = mergeUserTaskState(currentState, {
    focus: "new focus",
    long_tasks: [
      { title: "新主线", status: "waiting", summary: "等用户拍板" },
    ],
    short_tasks: [
      { title: "整理待确认点", status: "running" },
    ],
  }, {
    lastUserMessage: "这个任务现在怎么样",
    lastAssistantReply: "我还在跟，卡在一个待确认点。",
  });

  assert.equal(nextState.focus, "new focus");
  assert.equal(nextState.long_tasks.length, 1);
  assert.equal(nextState.long_tasks[0].title, "新主线");
  assert.equal(nextState.short_tasks.length, 1);
  assert.equal(nextState.last_user_message, "这个任务现在怎么样");
  assert.equal(nextState.last_assistant_reply, "我还在跟，卡在一个待确认点。");
  assert.match(buildTaskLedgerContext(nextState), /新主线/);
});
