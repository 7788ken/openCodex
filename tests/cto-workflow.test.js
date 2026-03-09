import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTelegramCtoMainThreadSystemPrompt,
  buildTelegramCtoPlannerPrompt,
  buildTelegramCtoWorkerExecutionPrompt
} from '../src/lib/cto-workflow.js';

test('cto main thread prompt declares central orchestration ownership', () => {
  const prompt = buildTelegramCtoMainThreadSystemPrompt();
  assert.match(prompt, /dedicated openCodex CTO main thread/i);
  assert.match(prompt, /central orchestrator for many worker agents/i);
  assert.match(prompt, /personally generate and edit every worker prompt/i);
  assert.match(prompt, /openclaw/i);
});

test('cto planner prompt keeps CEO context and main-thread rules', () => {
  const prompt = buildTelegramCtoPlannerPrompt({
    message: { text: '安排一下接下来的任务' },
    workflowState: {
      goal_text: '安排一下接下来的任务',
      pending_question_zh: '',
      tasks: [],
      user_messages: []
    }
  });

  assert.match(prompt, /The user is the CEO/i);
  assert.match(prompt, /main thread/i);
  assert.match(prompt, /Telegram message:/);
});

test('cto worker execution prompt wraps child work under the main thread', () => {
  const prompt = buildTelegramCtoWorkerExecutionPrompt({
    workflowState: {
      goal_text: 'Fix the Telegram CTO workflow'
    },
    task: {
      id: 'fix-telegram-cto',
      title: 'Fix Telegram CTO flow',
      depends_on: ['inspect-current-flow'],
      worker_prompt: 'Update the IM routing and add regression coverage.'
    }
  });

  assert.match(prompt, /worker agent delegated by the openCodex CTO main thread/i);
  assert.match(prompt, /sole orchestrator/i);
  assert.match(prompt, /Workflow goal: Fix the Telegram CTO workflow/);
  assert.match(prompt, /Task id: fix-telegram-cto/);
  assert.match(prompt, /Dependencies: inspect-current-flow/);
  assert.match(prompt, /Worker directive from the CTO main thread:/);
  assert.match(prompt, /Update the IM routing and add regression coverage\./);
});
