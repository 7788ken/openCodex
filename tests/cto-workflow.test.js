import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import {
  appendWorkflowUserMessage,
  buildTelegramCtoMainThreadSystemPrompt,
  buildTelegramCtoPlannerPrompt,
  buildTelegramCtoSessionSummary,
  buildTelegramCtoWorkerExecutionPrompt,
  loadCtoSoulDocument,
  buildDefaultCtoSoulDocument,
  collectHistoricalStuckCtoWorkflowCandidates,
  injectHistoricalCtoRepairTask,
  isLikelyTelegramNonDirectiveMessage,
  normalizeTelegramCtoPlan,
  shouldPromoteWorkflowGoal
} from '../src/lib/cto-workflow.js';

test('cto main thread prompt declares central orchestration ownership', () => {
  const prompt = buildTelegramCtoMainThreadSystemPrompt();
  assert.match(prompt, /dedicated openCodex CTO main thread/i);
  assert.match(prompt, /central orchestrator for many worker agents/i);
  assert.match(prompt, /personally generate and edit every worker prompt/i);
  assert.match(prompt, /infer the CEO intent from context/i);
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

test('cto soul document loads from repo prompts and extends the main-thread prompt', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-cto-soul-'));
  await mkdir(path.join(cwd, 'prompts'), { recursive: true });
  await writeFile(path.join(cwd, 'prompts', 'cto-soul.md'), '# Soul\n\n- Stay opinionated.\n- Keep Codex CLI as the engine.\n', 'utf8');

  const soul = await loadCtoSoulDocument(cwd);
  const prompt = buildTelegramCtoMainThreadSystemPrompt({
    soulText: soul.text,
    soulPath: soul.display_path
  });

  assert.equal(soul.display_path, 'prompts/cto-soul.md');
  assert.equal(soul.builtin, false);
  assert.match(prompt, /Active CTO soul document \(prompts\/cto-soul\.md\):/);
  assert.match(prompt, /Stay opinionated\./);
  assert.match(prompt, /Keep Codex CLI as the engine\./);
});

test('cto default soul template is based on the Codex CLI personal assistant persona', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-cto-soul-default-'));
  const soul = await loadCtoSoulDocument(cwd);
  const template = buildDefaultCtoSoulDocument();

  assert.equal(soul.builtin, true);
  assert.equal(soul.display_path, 'prompts/cto-soul.md');
  assert.equal(soul.text, template);
  assert.match(template, /general-purpose Codex CLI personal assistant persona/);
  assert.match(template, /primary local execution engine/);
  assert.match(template, /CTO-style orchestrator/);
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


test('cto workflow promotes a later actionable Telegram reply into the workflow goal', () => {
  const workflowState = {
    goal_text: '很好.加油',
    latest_user_message: '很好.加油',
    updated_at: '2026-03-09T04:49:40.000Z',
    user_messages: []
  };
  const message = {
    text: '继续推进，不需要等我，遇到高风险再确认',
    update_id: 2,
    message_id: 3,
    created_at: '2026-03-09T04:51:34.000Z'
  };

  assert.equal(isLikelyTelegramNonDirectiveMessage('很好.加油'), true);
  assert.equal(shouldPromoteWorkflowGoal(workflowState, message), true);

  appendWorkflowUserMessage(workflowState, message);

  assert.equal(workflowState.goal_text, '继续推进，不需要等我，遇到高风险再确认');
  assert.equal(workflowState.latest_user_message, '继续推进，不需要等我，遇到高风险再确认');
  assert.equal(workflowState.user_messages.length, 1);
});

test('cto workflow keeps the original goal when the later Telegram reply is only acknowledgement', () => {
  const workflowState = {
    goal_text: '修复 Telegram CTO 续跑逻辑',
    latest_user_message: '修复 Telegram CTO 续跑逻辑',
    updated_at: '2026-03-09T04:49:40.000Z',
    user_messages: []
  };
  const message = {
    text: '好的，加油',
    update_id: 4,
    message_id: 5,
    created_at: '2026-03-09T04:52:34.000Z'
  };

  assert.equal(isLikelyTelegramNonDirectiveMessage(message.text), true);
  assert.equal(shouldPromoteWorkflowGoal(workflowState, message), false);

  appendWorkflowUserMessage(workflowState, message);

  assert.equal(workflowState.goal_text, '修复 Telegram CTO 续跑逻辑');
  assert.equal(workflowState.latest_user_message, '好的，加油');
  assert.equal(workflowState.user_messages.length, 1);
});



test('cto workflow identifies stale historical workflows and injects a default repair task', () => {
  const candidates = collectHistoricalStuckCtoWorkflowCandidates([
    {
      session: {
        session_id: 'cto-20260309-old-running',
        command: 'cto',
        status: 'running',
        updated_at: '2026-03-09T05:00:00.000Z',
        input: { prompt: 'Repair the tray UI' }
      },
      workflowState: {
        status: 'running',
        goal_text: 'Repair the tray UI',
        pending_question_zh: '',
        updated_at: '2026-03-09T05:00:00.000Z',
        tasks: [
          { status: 'running' }
        ]
      }
    },
    {
      session: {
        session_id: 'cto-20260309-waiting',
        command: 'cto',
        status: 'partial',
        updated_at: '2026-03-09T05:00:00.000Z',
        input: { prompt: 'Need a decision' }
      },
      workflowState: {
        status: 'waiting_for_user',
        goal_text: 'Need a decision',
        pending_question_zh: '请确认是否继续。',
        updated_at: '2026-03-09T05:00:00.000Z',
        tasks: []
      }
    }
  ], {
    currentWorkflowSessionId: 'cto-current',
    staleMinutes: 30,
    now: '2026-03-09T06:00:00.000Z'
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].session_id, 'cto-20260309-old-running');
  assert.match(candidates[0].reason, /stale threshold/i);

  const plan = injectHistoricalCtoRepairTask({
    mode: 'execute',
    summary_zh: '已拆分 1 个可执行任务。',
    question_zh: '',
    task_counter: 1,
    tasks: [
      {
        id: 'inspect-repo',
        title: 'Inspect repo',
        worker_prompt: 'Inspect the repository.',
        depends_on: [],
        status: 'queued',
        session_id: '',
        summary_status: '',
        result: '',
        next_steps: [],
        changed_files: [],
        updated_at: ''
      }
    ]
  }, {
    candidates,
    cwd: '/repo/openCodex',
    currentWorkflowSessionId: 'cto-current',
    staleMinutes: 30
  });

  assert.equal(plan.tasks.length, 2);
  assert.equal(plan.tasks[0].id, 'repair-historical-workflows');
  assert.match(plan.tasks[0].title, /Repair historical stuck workflows/);
  assert.match(plan.tasks[0].worker_prompt, /session repair/);
  assert.match(plan.tasks[0].worker_prompt, /OPENCODEX_REPAIR_SKIP_SESSION_ID/);
  assert.match(plan.summary_zh, /历史卡住 workflow/);
});


test('cto session summary describes partial workflows without calling them running', () => {
  const summary = buildTelegramCtoSessionSummary({
    chat_id: '123456',
    status: 'partial',
    pending_question_zh: '',
    tasks: [
      { status: 'completed' },
      { status: 'failed' }
    ]
  });

  assert.equal(summary.status, 'partial');
  assert.match(summary.result, /needs follow-up/i);
  assert.doesNotMatch(summary.result, /running with 0 active/i);
});

test('cto planner auto-infers a safe execute plan from an abstract inspection request', () => {
  const plan = normalizeTelegramCtoPlan({
    mode: 'confirm',
    summary_zh: '当前还缺少更具体的执行对象。',
    question_zh: '请直接给本轮要推进的具体目标。',
    tasks: []
  }, 'CTO 检查你的思考深度是不是最高', {
    task_counter: 0,
    tasks: [],
    goal_text: 'CTO 检查你的思考深度是不是最高'
  });

  assert.equal(plan.mode, 'execute');
  assert.match(plan.summary_zh, /自动推断/);
  assert.equal(plan.tasks.length, 1);
  assert.equal(plan.tasks[0].id, 'audit-cto-reasoning');
  assert.match(plan.tasks[0].title, /Audit CTO reasoning depth/);
  assert.match(plan.tasks[0].worker_prompt, /src\/lib\/cto-workflow\.js/);
});
