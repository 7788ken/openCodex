import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const cli = path.resolve('bin/opencodex.js');

test('session repair skips stale sessions without terminal evidence', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-repair-'));
  const sessionId = 'run-20260308-stale';
  const sessionDir = path.join(cwd, '.opencodex', 'sessions', sessionId);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(path.join(sessionDir, 'session.json'), `${JSON.stringify({
    session_id: sessionId,
    command: 'run',
    status: 'running',
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    working_directory: cwd,
    codex_cli_version: 'codex-cli 0.111.0',
    input: { prompt: 'x', arguments: {} },
    summary: { title: 'Run running', result: 'started', status: 'running', highlights: [], next_steps: [] },
    artifacts: []
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(sessionDir, 'events.jsonl'), `${JSON.stringify({ type: 'thread.started' })}\n`, 'utf8');

  const result = await runCli(['session', 'repair', '--json', '--cwd', cwd, '--stale-minutes', '1']);
  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.repaired_count, 0);
  assert.deepEqual(payload.repaired, []);

  const repaired = JSON.parse(await readFile(path.join(sessionDir, 'session.json'), 'utf8'));
  assert.equal(repaired.status, 'running');
  assert.equal(repaired.summary.title, 'Run running');
});

test('session repair restores failed run sessions from completed turn evidence when wrapper misclassified sandbox diagnostics', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-repair-run-false-sandbox-'));
  const sessionId = 'run-20260308-false-sandbox';
  const sessionDir = path.join(cwd, '.opencodex', 'sessions', sessionId);
  const lastMessage = {
    title: 'Permission audit completed',
    result: 'Permission audit completed successfully. Observed sandbox: workspace-write.',
    status: 'completed',
    highlights: ['Recovered completed result from last-message.txt'],
    next_steps: [],
    risks: [],
    validation: [],
    changed_files: [],
    findings: []
  };

  await mkdir(sessionDir, { recursive: true });
  await writeFile(path.join(sessionDir, 'session.json'), `${JSON.stringify({
    session_id: sessionId,
    command: 'run',
    status: 'failed',
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    working_directory: cwd,
    codex_cli_version: 'codex-cli 0.112.0',
    input: { prompt: 'audit permissions', arguments: {} },
    summary: {
      title: 'Run blocked by host sandbox',
      result: 'wrapper misclassified the completed run as sandbox-blocked',
      status: 'failed',
      highlights: [],
      next_steps: []
    },
    artifacts: []
  }, null, 2)}
`, 'utf8');
  await writeFile(path.join(sessionDir, 'events.jsonl'), [
    JSON.stringify({ type: 'thread.started' }),
    JSON.stringify({ type: 'turn.started' }),
    JSON.stringify({ type: 'turn.completed' })
  ].join('\n'), 'utf8');
  await writeFile(path.join(sessionDir, 'last-message.txt'), `${JSON.stringify(lastMessage)}\n`, 'utf8');

  const result = await runCli(['session', 'repair', '--json', '--cwd', cwd, '--stale-minutes', '1']);
  assert.equal(result.code, 0);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.repaired_count, 1);
  assert.equal(payload.repaired[0].session_id, sessionId);
  assert.equal(payload.repaired[0].to, 'completed');

  const repaired = JSON.parse(await readFile(path.join(sessionDir, 'session.json'), 'utf8'));
  assert.equal(repaired.status, 'completed');
  assert.equal(repaired.summary.title, lastMessage.title);
  assert.equal(repaired.summary.result, lastMessage.result);
});

test('session repair restores failed cto workflows when child runs can be recovered from disk', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-repair-cto-false-sandbox-'));
  const ctoSessionId = 'cto-20260308-failed-false-sandbox';
  const childSessionId = 'run-20260308-child-false-sandbox';
  const ctoSessionDir = path.join(cwd, '.opencodex', 'sessions', ctoSessionId);
  const childSessionDir = path.join(cwd, '.opencodex', 'sessions', childSessionId);
  const workflowStatePath = path.join(ctoSessionDir, 'artifacts', 'cto-workflow.json');

  await mkdir(path.join(ctoSessionDir, 'artifacts'), { recursive: true });
  await mkdir(childSessionDir, { recursive: true });

  await writeFile(path.join(childSessionDir, 'session.json'), `${JSON.stringify({
    session_id: childSessionId,
    command: 'run',
    status: 'failed',
    created_at: '2026-03-08T00:00:10.000Z',
    updated_at: '2026-03-08T00:00:10.000Z',
    working_directory: cwd,
    codex_cli_version: 'codex-cli 0.112.0',
    input: { prompt: 'audit permissions', arguments: {} },
    summary: { title: 'Run blocked by host sandbox', result: 'false negative', status: 'failed', highlights: [], next_steps: [] },
    artifacts: []
  }, null, 2)}
`, 'utf8');
  await writeFile(path.join(childSessionDir, 'events.jsonl'), [
    JSON.stringify({ type: 'thread.started' }),
    JSON.stringify({ type: 'turn.started' }),
    JSON.stringify({ type: 'turn.completed' })
  ].join('\n'), 'utf8');
  await writeFile(path.join(childSessionDir, 'last-message.txt'), `${JSON.stringify({
    title: 'Permission audit completed',
    result: 'Recovered completed audit.',
    status: 'completed',
    highlights: [],
    next_steps: [],
    risks: [],
    validation: [],
    changed_files: [],
    findings: []
  })}\n`, 'utf8');

  await writeFile(path.join(ctoSessionDir, 'session.json'), `${JSON.stringify({
    session_id: ctoSessionId,
    command: 'cto',
    status: 'failed',
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    working_directory: cwd,
    codex_cli_version: 'telegram-bot-api',
    input: { prompt: 'Recover workflow', arguments: { provider: 'telegram' } },
    summary: { title: 'CTO workflow failed', result: 'Workflow failed after 1 failed task(s).', status: 'failed', highlights: [], next_steps: [] },
    artifacts: [
      { type: 'cto_workflow', path: workflowStatePath, description: 'Telegram CTO workflow state and task graph.' }
    ],
    child_sessions: [
      { label: 'Task audit-permissions', command: 'run', session_id: childSessionId, status: 'failed' }
    ]
  }, null, 2)}
`, 'utf8');
  await writeFile(workflowStatePath, `${JSON.stringify({
    workflow_session_id: ctoSessionId,
    provider: 'telegram',
    chat_id: '123456',
    source_update_id: 1,
    source_message_id: 1,
    sender_display: 'CEO',
    goal_text: 'Recover workflow',
    latest_user_message: 'Recover workflow',
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    status: 'failed',
    pending_question_zh: '',
    tasks: [
      {
        id: 'audit-permissions',
        title: 'Audit permissions',
        status: 'failed',
        session_id: childSessionId,
        summary_status: 'failed',
        result: 'Run blocked by host sandbox',
        next_steps: [],
        changed_files: [],
        updated_at: '2026-03-08T00:00:10.000Z'
      }
    ]
  }, null, 2)}\n`, 'utf8');

  const result = await runCli(['session', 'repair', '--json', '--cwd', cwd, '--stale-minutes', '1']);
  assert.equal(result.code, 0);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.repaired_count, 2);

  const repairedChild = JSON.parse(await readFile(path.join(childSessionDir, 'session.json'), 'utf8'));
  assert.equal(repairedChild.status, 'completed');

  const repairedCto = JSON.parse(await readFile(path.join(ctoSessionDir, 'session.json'), 'utf8'));
  assert.equal(repairedCto.status, 'completed');

  const repairedWorkflowState = JSON.parse(await readFile(workflowStatePath, 'utf8'));
  assert.equal(repairedWorkflowState.status, 'completed');
  assert.equal(repairedWorkflowState.tasks[0].status, 'completed');
});

test('session repair restores summary from last-message when turn completed', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-repair-'));
  const sessionId = 'run-20260308-completed';
  const sessionDir = path.join(cwd, '.opencodex', 'sessions', sessionId);
  const lastMessage = {
    title: 'Run completed',
    result: 'Recovered real summary from disk.',
    status: 'completed',
    highlights: ['Recovered from last-message.txt'],
    next_steps: ['Review changed files if needed.'],
    risks: [],
    validation: [],
    changed_files: ['src/commands/session.js'],
    findings: []
  };

  await mkdir(sessionDir, { recursive: true });
  await writeFile(path.join(sessionDir, 'session.json'), `${JSON.stringify({
    session_id: sessionId,
    command: 'run',
    status: 'running',
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    working_directory: cwd,
    codex_cli_version: 'codex-cli 0.111.0',
    input: { prompt: 'x', arguments: {} },
    summary: { title: 'Run running', result: 'started', status: 'running', highlights: [], next_steps: [] },
    artifacts: []
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(sessionDir, 'events.jsonl'), [
    JSON.stringify({ type: 'thread.started' }),
    JSON.stringify({ type: 'turn.completed' })
  ].join('\n'), 'utf8');
  await writeFile(path.join(sessionDir, 'last-message.txt'), `${JSON.stringify(lastMessage)}\n`, 'utf8');

  const result = await runCli(['session', 'repair', '--json', '--cwd', cwd, '--stale-minutes', '1']);
  assert.equal(result.code, 0);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.repaired_count, 1);
  assert.equal(payload.repaired[0].to, 'completed');
  assert.equal(payload.repaired[0].reason, lastMessage.result);

  const repaired = JSON.parse(await readFile(path.join(sessionDir, 'session.json'), 'utf8'));
  assert.equal(repaired.status, 'completed');
  assert.equal(repaired.summary.title, lastMessage.title);
  assert.equal(repaired.summary.result, lastMessage.result);
  assert.deepEqual(repaired.summary.changed_files, lastMessage.changed_files);
  assert.notEqual(repaired.summary.result, 'The Codex turn completed, but the wrapper did not finish writing a final session status.');
});

test('session repair completes stale cto workflows from finished child sessions', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-repair-cto-completed-'));
  const ctoSessionId = 'cto-20260308-stale-completed';
  const childSessionId = 'run-20260308-stale-child';
  const ctoSessionDir = path.join(cwd, '.opencodex', 'sessions', ctoSessionId);
  const childSessionDir = path.join(cwd, '.opencodex', 'sessions', childSessionId);
  const workflowStatePath = path.join(ctoSessionDir, 'artifacts', 'cto-workflow.json');

  await mkdir(path.join(ctoSessionDir, 'artifacts'), { recursive: true });
  await mkdir(path.join(childSessionDir, 'artifacts'), { recursive: true });
  await writeFile(path.join(ctoSessionDir, 'session.json'), `${JSON.stringify({
    session_id: ctoSessionId,
    command: 'cto',
    status: 'running',
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    working_directory: cwd,
    codex_cli_version: 'telegram-bot-api',
    input: { prompt: 'Repair completed workflow', arguments: { provider: 'telegram' } },
    summary: { title: 'CTO workflow running', result: 'running', status: 'running', highlights: [], next_steps: [] },
    artifacts: [
      { type: 'cto_workflow', path: workflowStatePath, description: 'Telegram CTO workflow state and task graph.' }
    ],
    child_sessions: [
      { label: 'Task sync-task', command: 'run', session_id: childSessionId, status: 'completed' }
    ]
  }, null, 2)}
`, 'utf8');
  await writeFile(workflowStatePath, `${JSON.stringify({
    workflow_session_id: ctoSessionId,
    provider: 'telegram',
    chat_id: '123456',
    source_update_id: 1,
    source_message_id: 1,
    sender_display: 'CEO',
    goal_text: 'Repair completed workflow',
    latest_user_message: 'Repair completed workflow',
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    status: 'running',
    plan_mode: 'execute',
    plan_summary_zh: 'Repair completed workflow.',
    pending_question_zh: '',
    task_counter: 1,
    tasks: [
      {
        id: 'sync-task',
        title: 'Sync child task',
        worker_prompt: 'Inspect child output.',
        depends_on: [],
        status: 'running',
        session_id: childSessionId,
        summary_status: '',
        result: '',
        next_steps: [],
        changed_files: [],
        updated_at: '2026-03-08T00:00:00.000Z'
      }
    ],
    user_messages: []
  }, null, 2)}
`, 'utf8');
  await writeFile(path.join(childSessionDir, 'session.json'), `${JSON.stringify({
    session_id: childSessionId,
    command: 'run',
    status: 'completed',
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:05:00.000Z',
    working_directory: cwd,
    codex_cli_version: 'codex-cli 0.111.0',
    input: { prompt: 'child', arguments: {} },
    summary: {
      title: 'Child task completed',
      result: 'Recovered child completion summary.',
      status: 'completed',
      highlights: [],
      next_steps: [],
      changed_files: ['src/repaired-child.js'],
      findings: []
    },
    artifacts: []
  }, null, 2)}
`, 'utf8');

  const result = await runCli(['session', 'repair', '--json', '--cwd', cwd, '--stale-minutes', '1']);
  assert.equal(result.code, 0);

  const payload = JSON.parse(result.stdout);
  const repairedWorkflow = payload.repaired.find((item) => item.session_id === ctoSessionId);
  assert.ok(repairedWorkflow);
  assert.equal(repairedWorkflow.to, 'completed');

  const repairedSession = JSON.parse(await readFile(path.join(ctoSessionDir, 'session.json'), 'utf8'));
  const repairedWorkflowState = JSON.parse(await readFile(workflowStatePath, 'utf8'));
  assert.equal(repairedSession.status, 'completed');
  assert.equal(repairedSession.summary.title, 'CTO workflow completed');
  assert.equal(repairedWorkflowState.status, 'completed');
  assert.equal(repairedWorkflowState.tasks[0].status, 'completed');
  assert.equal(repairedWorkflowState.tasks[0].result, 'Recovered child completion summary.');
  assert.deepEqual(repairedWorkflowState.tasks[0].changed_files, ['src/repaired-child.js']);
});

test('session repair converts orphaned stale cto tasks into a waiting workflow', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-repair-cto-orphaned-'));
  const ctoSessionId = 'cto-20260308-stale-orphaned';
  const ctoSessionDir = path.join(cwd, '.opencodex', 'sessions', ctoSessionId);
  const workflowStatePath = path.join(ctoSessionDir, 'artifacts', 'cto-workflow.json');

  await mkdir(path.join(ctoSessionDir, 'artifacts'), { recursive: true });
  await writeFile(path.join(ctoSessionDir, 'session.json'), `${JSON.stringify({
    session_id: ctoSessionId,
    command: 'cto',
    status: 'running',
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    working_directory: cwd,
    codex_cli_version: 'telegram-bot-api',
    input: { prompt: 'Repair orphaned workflow', arguments: { provider: 'telegram' } },
    summary: { title: 'CTO workflow running', result: 'running', status: 'running', highlights: [], next_steps: [] },
    artifacts: [
      { type: 'cto_workflow', path: workflowStatePath, description: 'Telegram CTO workflow state and task graph.' }
    ]
  }, null, 2)}
`, 'utf8');
  await writeFile(workflowStatePath, `${JSON.stringify({
    workflow_session_id: ctoSessionId,
    provider: 'telegram',
    chat_id: '123456',
    source_update_id: 1,
    source_message_id: 1,
    sender_display: 'CEO',
    goal_text: 'Repair orphaned workflow',
    latest_user_message: 'Repair orphaned workflow',
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    status: 'running',
    plan_mode: 'execute',
    plan_summary_zh: 'Repair orphaned workflow.',
    pending_question_zh: '',
    task_counter: 1,
    tasks: [
      {
        id: 'orphaned-task',
        title: 'Orphaned task',
        worker_prompt: 'Dispatch never happened.',
        depends_on: [],
        status: 'running',
        session_id: '',
        summary_status: '',
        result: '',
        next_steps: [],
        changed_files: [],
        updated_at: '2026-03-08T00:00:00.000Z'
      }
    ],
    user_messages: []
  }, null, 2)}
`, 'utf8');

  const result = await runCli(['session', 'repair', '--json', '--cwd', cwd, '--stale-minutes', '1']);
  assert.equal(result.code, 0);

  const payload = JSON.parse(result.stdout);
  const repairedWorkflow = payload.repaired.find((item) => item.session_id === ctoSessionId);
  assert.ok(repairedWorkflow);
  assert.equal(repairedWorkflow.to, 'partial');

  const repairedSession = JSON.parse(await readFile(path.join(ctoSessionDir, 'session.json'), 'utf8'));
  const repairedWorkflowState = JSON.parse(await readFile(workflowStatePath, 'utf8'));
  assert.equal(repairedSession.status, 'partial');
  assert.equal(repairedSession.summary.title, 'CTO workflow needs follow-up');
  assert.equal(repairedWorkflowState.status, 'waiting_for_user');
  assert.equal(repairedWorkflowState.tasks[0].status, 'partial');
  assert.match(repairedWorkflowState.tasks[0].result, /worker session was created/i);
  assert.match(repairedWorkflowState.pending_question_zh, /重新派发该任务/);
});


test('session repair gives failed stale cto workflows a generic follow-up question when detail is missing', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-repair-cto-failed-'));
  const ctoSessionId = 'cto-20260308-stale-failed';
  const ctoSessionDir = path.join(cwd, '.opencodex', 'sessions', ctoSessionId);
  const workflowStatePath = path.join(ctoSessionDir, 'artifacts', 'cto-workflow.json');

  await mkdir(path.join(ctoSessionDir, 'artifacts'), { recursive: true });
  await writeFile(path.join(ctoSessionDir, 'session.json'), `${JSON.stringify({
    session_id: ctoSessionId,
    command: 'cto',
    status: 'partial',
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    working_directory: cwd,
    codex_cli_version: 'telegram-bot-api',
    input: { prompt: 'Repair failed workflow', arguments: { provider: 'telegram' } },
    summary: { title: 'CTO workflow needs follow-up', result: 'stale', status: 'partial', highlights: [], next_steps: [] },
    artifacts: [
      { type: 'cto_workflow', path: workflowStatePath, description: 'Telegram CTO workflow state and task graph.' }
    ]
  }, null, 2)}
`, 'utf8');
  await writeFile(workflowStatePath, `${JSON.stringify({
    workflow_session_id: ctoSessionId,
    provider: 'telegram',
    chat_id: '123456',
    source_update_id: 1,
    source_message_id: 1,
    sender_display: 'CEO',
    goal_text: 'Repair failed workflow',
    latest_user_message: 'Repair failed workflow',
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    status: 'partial',
    plan_mode: 'execute',
    plan_summary_zh: 'Repair failed workflow.',
    pending_question_zh: '',
    task_counter: 1,
    tasks: [
      {
        id: 'failed-task',
        title: 'Failed task',
        worker_prompt: 'A failed task without detail.',
        depends_on: [],
        status: 'failed',
        session_id: '',
        summary_status: 'failed',
        result: '',
        next_steps: [],
        changed_files: [],
        updated_at: '2026-03-08T00:00:00.000Z'
      }
    ],
    user_messages: []
  }, null, 2)}
`, 'utf8');

  const result = await runCli(['session', 'repair', '--json', '--cwd', cwd, '--stale-minutes', '1']);
  assert.equal(result.code, 0);

  const payload = JSON.parse(result.stdout);
  const repairedWorkflow = payload.repaired.find((item) => item.session_id === ctoSessionId);
  assert.ok(repairedWorkflow);
  assert.equal(repairedWorkflow.to, 'partial');

  const repairedWorkflowState = JSON.parse(await readFile(workflowStatePath, 'utf8'));
  assert.equal(repairedWorkflowState.status, 'waiting_for_user');
  assert.match(repairedWorkflowState.pending_question_zh, /重新派发失败任务/);
});

test('session repair closes misrouted casual-chat cto workflows and stays idempotent', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-repair-cto-casual-chat-'));
  const ctoSessionId = 'cto-20260310-casual-chat';
  const ctoSessionDir = path.join(cwd, '.opencodex', 'sessions', ctoSessionId);
  const workflowStatePath = path.join(ctoSessionDir, 'artifacts', 'cto-workflow.json');

  await mkdir(path.join(ctoSessionDir, 'artifacts'), { recursive: true });
  await writeFile(path.join(ctoSessionDir, 'session.json'), `${JSON.stringify({
    session_id: ctoSessionId,
    command: 'cto',
    status: 'partial',
    created_at: '2026-03-10T12:09:50.000Z',
    updated_at: '2026-03-10T12:09:50.000Z',
    working_directory: cwd,
    codex_cli_version: 'telegram-bot-api',
    input: { prompt: '你吃晚餐了吗', arguments: { provider: 'telegram' } },
    summary: {
      title: 'CTO workflow needs follow-up',
      result: '旧规则把轻聊天误开成 workflow，仍在等待 CEO 回复。',
      status: 'partial',
      highlights: [],
      next_steps: ['请确认是否继续当前工作流。']
    },
    artifacts: [
      { type: 'cto_workflow', path: workflowStatePath, description: 'Telegram CTO workflow state and task graph.' }
    ]
  }, null, 2)}
`, 'utf8');
  await writeFile(workflowStatePath, `${JSON.stringify({
    workflow_session_id: ctoSessionId,
    provider: 'telegram',
    chat_id: '1379564094',
    source_update_id: 1,
    source_message_id: 1,
    sender_display: 'CEO',
    goal_text: '你吃晚餐了吗',
    latest_user_message: '你吃晚餐了吗',
    created_at: '2026-03-10T12:09:50.000Z',
    updated_at: '2026-03-10T12:09:50.000Z',
    status: 'waiting_for_user',
    pending_question_zh: '请确认是否继续当前工作流。',
    tasks: [
      {
        id: 'reply-social-chat',
        title: 'Reply to the social check-in',
        status: 'failed',
        session_id: '',
        summary_status: 'failed',
        result: 'Not inside a trusted directory and --skip-git-repo-check was not specified.',
        next_steps: ['请确认是否重新派发失败任务。'],
        changed_files: [],
        updated_at: '2026-03-10T12:10:10.000Z'
      }
    ]
  }, null, 2)}\n`, 'utf8');

  const firstRun = await runCli(['session', 'repair', '--json', '--cwd', cwd, '--stale-minutes', '0']);
  assert.equal(firstRun.code, 0);

  const firstPayload = JSON.parse(firstRun.stdout);
  assert.equal(firstPayload.repaired_count, 1);
  assert.equal(firstPayload.repaired[0].session_id, ctoSessionId);
  assert.equal(firstPayload.repaired[0].to, 'failed');

  const repairedSession = JSON.parse(await readFile(path.join(ctoSessionDir, 'session.json'), 'utf8'));
  const repairedWorkflowState = JSON.parse(await readFile(workflowStatePath, 'utf8'));
  assert.equal(repairedSession.status, 'failed');
  assert.equal(repairedSession.summary.status, 'failed');
  assert.match(repairedSession.summary.result, /本不该进入 workflow/);
  assert.deepEqual(repairedSession.summary.validation, ['chat_routing:casual_chat_repair']);
  assert.equal(repairedWorkflowState.status, 'failed');
  assert.equal(repairedWorkflowState.pending_question_zh, '');
  assert.deepEqual(repairedWorkflowState.tasks[0].next_steps, []);

  const secondRun = await runCli(['session', 'repair', '--json', '--cwd', cwd, '--stale-minutes', '0']);
  assert.equal(secondRun.code, 0);

  const secondPayload = JSON.parse(secondRun.stdout);
  assert.equal(secondPayload.repaired_count, 0);
  assert.deepEqual(secondPayload.repaired, []);
});

test('session repair restores stale review sessions from review-report artifact', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-repair-review-'));
  const sessionId = 'review-20260308-stale';
  const sessionDir = path.join(cwd, '.opencodex', 'sessions', sessionId);
  const artifactsDir = path.join(sessionDir, 'artifacts');
  const reviewReport = await readFile(path.resolve('tests/fixtures/review-report.txt'), 'utf8');

  await mkdir(artifactsDir, { recursive: true });
  await writeFile(path.join(sessionDir, 'session.json'), `${JSON.stringify({
    session_id: sessionId,
    command: 'review',
    status: 'running',
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    working_directory: cwd,
    codex_cli_version: 'codex-cli 0.111.0',
    input: { prompt: '', arguments: { uncommitted: true } },
    summary: { title: 'Review running', result: 'started', status: 'running', highlights: [], next_steps: [], findings: [] },
    artifacts: [
      { type: 'review_report', path: path.join(artifactsDir, 'review-report.txt') }
    ]
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(artifactsDir, 'review-report.txt'), reviewReport, 'utf8');

  const result = await runCli(['session', 'repair', '--json', '--cwd', cwd, '--stale-minutes', '1']);
  assert.equal(result.code, 0);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.repaired_count, 1);
  assert.equal(payload.repaired[0].to, 'completed');

  const repaired = JSON.parse(await readFile(path.join(sessionDir, 'session.json'), 'utf8'));
  assert.equal(repaired.status, 'completed');
  assert.equal(repaired.summary.title, 'Review completed');
  assert.match(repaired.summary.result, /user-facing regression/i);
  assert.equal(repaired.summary.findings.length, 2);
});

test('session repair preserves failed review status when report ends with stderr footer', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-repair-review-failed-'));
  const sessionId = 'review-20260308-failed';
  const sessionDir = path.join(cwd, '.opencodex', 'sessions', sessionId);
  const artifactsDir = path.join(sessionDir, 'artifacts');
  const stdoutText = [
    'codex',
    'Found one blocking issue.',
    '',
    'Full review comments:',
    '- [P1] Keep failed status (src/commands/session.js:510-514)',
    '  The review crashed after partial output.'
  ].join('\n');
  const stderrText = 'transport closed unexpectedly';

  await mkdir(artifactsDir, { recursive: true });
  await writeFile(path.join(sessionDir, 'session.json'), `${JSON.stringify({
    session_id: sessionId,
    command: 'review',
    status: 'running',
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    working_directory: cwd,
    codex_cli_version: 'codex-cli 0.111.0',
    input: { prompt: '', arguments: { uncommitted: true } },
    summary: { title: 'Review running', result: 'started', status: 'running', highlights: [], next_steps: [], findings: [] },
    artifacts: [
      { type: 'review_report', path: path.join(artifactsDir, 'review-report.txt') },
      { type: 'log', path: path.join(artifactsDir, 'codex-stderr.log') }
    ]
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(artifactsDir, 'review-report.txt'), `${stdoutText}\n\nstderr:\n${stderrText}`, 'utf8');
  await writeFile(path.join(artifactsDir, 'codex-stderr.log'), stderrText, 'utf8');

  const result = await runCli(['session', 'repair', '--json', '--cwd', cwd, '--stale-minutes', '1']);
  assert.equal(result.code, 0);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.repaired_count, 1);
  assert.equal(payload.repaired[0].to, 'failed');

  const repaired = JSON.parse(await readFile(path.join(sessionDir, 'session.json'), 'utf8'));
  assert.equal(repaired.status, 'failed');
  assert.equal(repaired.summary.title, 'Review failed');
  assert.match(repaired.summary.result, /transport closed unexpectedly/i);
  assert.equal(repaired.summary.findings.length, 1);
});


test('session repair infers failed review status from embedded stderr without a log artifact', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-repair-review-embedded-stderr-'));
  const sessionId = 'review-20260308-embedded-stderr';
  const sessionDir = path.join(cwd, '.opencodex', 'sessions', sessionId);
  const artifactsDir = path.join(sessionDir, 'artifacts');
  const stdoutText = [
    'codex',
    'Found one blocking issue.',
    '',
    'Full review comments:',
    '- [P1] Keep failed status when stderr is embedded (src/commands/session.js:1-1)',
    '  The wrapper wrote the combined review artifact before crashing.'
  ].join('\n');
  const stderrText = 'review transport disconnected';

  await mkdir(artifactsDir, { recursive: true });
  await writeFile(path.join(sessionDir, 'session.json'), `${JSON.stringify({
    session_id: sessionId,
    command: 'review',
    status: 'running',
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    working_directory: cwd,
    codex_cli_version: 'codex-cli 0.111.0',
    input: { prompt: '', arguments: { uncommitted: true } },
    summary: { title: 'Review running', result: 'started', status: 'running', highlights: [], next_steps: [], findings: [] },
    artifacts: [
      { type: 'review_report', path: path.join(artifactsDir, 'review-report.txt') }
    ]
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(artifactsDir, 'review-report.txt'), `${stdoutText}\n\nstderr:\n${stderrText}`, 'utf8');

  const result = await runCli(['session', 'repair', '--json', '--cwd', cwd, '--stale-minutes', '1']);
  assert.equal(result.code, 0);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.repaired_count, 1);
  assert.equal(payload.repaired[0].to, 'failed');

  const repaired = JSON.parse(await readFile(path.join(sessionDir, 'session.json'), 'utf8'));
  assert.equal(repaired.status, 'failed');
  assert.equal(repaired.summary.title, 'Review failed');
  assert.match(repaired.summary.result, /review transport disconnected/i);
  assert.equal(repaired.summary.findings.length, 1);
});

test('session repair keeps auto partial when the latest review child is still running', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-repair-auto-running-review-'));
  const autoSessionId = 'auto-20260308-running-review-parent';
  const runSessionId = 'run-20260308-running-review-child';
  const reviewSessionId = 'review-20260308-running-review-child';
  const autoSessionDir = path.join(cwd, '.opencodex', 'sessions', autoSessionId);
  const autoArtifactsDir = path.join(autoSessionDir, 'artifacts');

  await writeSession(cwd, autoSessionId, '2026-03-08T00:03:00.000Z', 'auto', 'running', {
    input: {
      prompt: 'draft a summary',
      arguments: { review: true, 'max-iterations': 2, 'run-retries': 0, 'fail-on-review': false }
    },
    summary: { title: 'Auto running', result: 'started', status: 'running', highlights: [], next_steps: [], findings: [] },
    artifacts: [
      { type: 'auto_log', path: path.join(autoArtifactsDir, 'auto-log.txt') }
    ],
    child_sessions: [
      { label: 'run', iteration: 1, command: 'run', session_id: runSessionId, status: 'completed' },
      { label: 'review', iteration: 1, command: 'review', session_id: reviewSessionId, status: 'running' }
    ],
    iteration_count: 1
  });
  await mkdir(autoArtifactsDir, { recursive: true });
  await writeFile(path.join(autoArtifactsDir, 'auto-log.txt'), [
    '==> Run main task',
    `Session: ${runSessionId}` ,
    '==> Run repository review',
    `Session: ${reviewSessionId}`
  ].join('\n'), 'utf8');

  await writeSession(cwd, runSessionId, '2026-03-08T00:01:00.000Z', 'run', 'completed', {
    parent_session_id: autoSessionId,
    auto_iteration: 1,
    summary: {
      title: 'Run completed',
      result: 'Implemented the requested change.',
      status: 'completed',
      highlights: [],
      next_steps: [],
      risks: [],
      validation: [],
      changed_files: [],
      findings: []
    }
  });
  await writeSession(cwd, reviewSessionId, '2026-03-08T00:02:00.000Z', 'review', 'running', {
    parent_session_id: autoSessionId,
    auto_iteration: 1,
    summary: { title: 'Review running', result: 'started', status: 'running', highlights: [], next_steps: [], findings: [] },
    artifacts: []
  });

  const result = await runCli(['session', 'repair', '--json', '--cwd', cwd, '--stale-minutes', '1']);
  assert.equal(result.code, 0);

  const repaired = JSON.parse(await readFile(path.join(autoSessionDir, 'session.json'), 'utf8'));
  assert.equal(repaired.status, 'partial');
  assert.equal(repaired.summary.title, 'Auto partial');
  assert.match(repaired.summary.result, /before the review step produced a terminal child session/i);
});
test('session repair converts stale auto sessions into a resumable partial summary', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-repair-auto-'));
  const autoSessionId = 'auto-20260308-parent';
  const runSessionId = 'run-20260308-child';
  const reviewSessionId = 'review-20260308-child';
  const autoSessionDir = path.join(cwd, '.opencodex', 'sessions', autoSessionId);
  const autoArtifactsDir = path.join(autoSessionDir, 'artifacts');

  await writeSession(cwd, autoSessionId, '2026-03-08T00:03:00.000Z', 'auto', 'running', {
    input: {
      prompt: 'draft a summary',
      arguments: {
        review: true,
        'max-iterations': 2,
        'run-retries': 0,
        'fail-on-review': false
      }
    },
    summary: { title: 'Auto running', result: 'started', status: 'running', highlights: [], next_steps: [], findings: [] },
    artifacts: [
      { type: 'auto_log', path: path.join(autoArtifactsDir, 'auto-log.txt') }
    ],
    child_sessions: [
      {
        label: 'run',
        iteration: 1,
        command: 'run',
        session_id: runSessionId,
        status: 'completed',
        session_contract: {
          schema: 'opencodex/session-contract/v1',
          layer: 'child',
          thread_kind: 'child_session',
          role: 'executor',
          scope: 'auto',
          supervisor_session_id: autoSessionId
        }
      },
      {
        label: 'review',
        iteration: 1,
        command: 'review',
        session_id: reviewSessionId,
        status: 'completed',
        session_contract: {
          schema: 'opencodex/session-contract/v1',
          layer: 'child',
          thread_kind: 'child_session',
          role: 'reviewer',
          scope: 'auto',
          supervisor_session_id: autoSessionId
        }
      }
    ],
    iteration_count: 1
  });
  await mkdir(autoArtifactsDir, { recursive: true });
  await writeFile(path.join(autoArtifactsDir, 'auto-log.txt'), [
    '==> Run main task',
    `Session: ${runSessionId}`,
    '==> Run repository review',
    `Session: ${reviewSessionId}`
  ].join('\n'), 'utf8');

  await writeSession(cwd, runSessionId, '2026-03-08T00:01:00.000Z', 'run', 'completed', {
    parent_session_id: autoSessionId,
    auto_iteration: 1,
    summary: {
      title: 'Run completed',
      result: 'Implemented the requested change.',
      status: 'completed',
      highlights: [],
      next_steps: [],
      risks: [],
      validation: [],
      changed_files: [],
      findings: []
    }
  });
  await writeSession(cwd, reviewSessionId, '2026-03-08T00:02:00.000Z', 'review', 'completed', {
    parent_session_id: autoSessionId,
    auto_iteration: 1,
    summary: {
      title: 'Review completed',
      result: 'One blocking finding remains.',
      status: 'completed',
      highlights: [],
      next_steps: [],
      findings: ['There is still one blocking issue to fix.']
    }
  });

  const result = await runCli(['session', 'repair', '--json', '--cwd', cwd, '--stale-minutes', '1']);
  assert.equal(result.code, 0);

  const payload = JSON.parse(result.stdout);
  const repairedAuto = payload.repaired.find((item) => item.session_id === autoSessionId);
  assert.ok(repairedAuto);
  assert.equal(repairedAuto.to, 'partial');

  const repaired = JSON.parse(await readFile(path.join(autoSessionDir, 'session.json'), 'utf8'));
  assert.equal(repaired.status, 'partial');
  assert.equal(repaired.summary.title, 'Auto partial');
  assert.match(repaired.summary.result, /remaining review finding|review finding\(s\) remain/i);
  assert.deepEqual(repaired.summary.findings, ['There is still one blocking issue to fix.']);
  assert.deepEqual(repaired.child_sessions.map((child) => child.status), ['completed', 'completed']);
  assert.equal(repaired.child_sessions[0].session_contract?.role, 'executor');
  assert.equal(repaired.child_sessions[1].session_contract?.role, 'reviewer');
});

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [cli, ...args], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function writeSession(cwd, sessionId, updatedAt, command, status = 'completed', extra = {}) {
  const sessionDir = path.join(cwd, '.opencodex', 'sessions', sessionId);
  await mkdir(sessionDir, { recursive: true });
  const payload = {
    session_id: sessionId,
    command,
    status,
    created_at: updatedAt,
    updated_at: updatedAt,
    working_directory: cwd,
    codex_cli_version: 'codex-cli 0.111.0',
    input: { prompt: '', arguments: {} },
    summary: {
      title: `${command} ${status}`,
      result: 'ok',
      status,
      highlights: [],
      next_steps: []
    },
    artifacts: [],
    ...extra
  };
  await writeFile(path.join(sessionDir, 'session.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}
