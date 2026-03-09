import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const cli = path.resolve('bin/opencodex.js');
const fixture = path.resolve('tests/fixtures/mock-codex.js');

test('im telegram listen stores inbound messages and im telegram inbox reads them back', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-im-telegram-'));
  const telegram = await startTelegramMockServer({
    updates: [
      {
        update_id: 101,
        message: {
          message_id: 501,
          date: 1741435200,
          text: 'hello from telegram',
          chat: { id: 123456, type: 'private' },
          from: { id: 9001, first_name: 'Li', last_name: 'Jianqian', username: 'lijq' }
        }
      }
    ]
  });
  t.after(async () => {
    await telegram.close();
  });

  const child = spawn('node', [cli, 'im', 'telegram', 'listen', '--cwd', cwd, '--bot-token', 'test-token', '--poll-timeout', '0'], {
    env: {
      ...process.env,
      OPENCODEX_TELEGRAM_API_BASE_URL: telegram.baseUrl
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const sessionId = await waitForValue(() => extractSessionId(stdout), 'telegram session id');
  await waitForCondition(() => stdout.includes('Message 101 from chat 123456: hello from telegram'), 'telegram message log');
  await waitForCondition(() => stdout.includes('Reacted to chat 123456 message 501 with 👍'), 'telegram reaction log');

  child.kill('SIGTERM');
  const exitCode = await waitForExit(child);
  assert.equal(exitCode, 0);
  assert.equal(stderr, '');
  assert.match(stdout, /Telegram listener started/);
  assert.match(stdout, /Delegate mode: ack-only/);

  const inboxResult = await runCli(['im', 'telegram', 'inbox', '--cwd', cwd, '--json']);
  assert.equal(inboxResult.code, 0);
  const payload = JSON.parse(inboxResult.stdout);
  assert.equal(payload.count, 1);
  assert.equal(payload.messages[0].chat_id, '123456');
  assert.equal(payload.messages[0].text, 'hello from telegram');
  assert.equal(payload.messages[0].sender_display, 'Li Jianqian');
  assert.equal(telegram.state.sentMessages.length, 0);
  assert.equal(telegram.state.reactions.length, 1);
  assert.deepEqual(telegram.state.reactions[0], {
    chat_id: '123456',
    message_id: 501,
    reaction: [{ type: 'emoji', emoji: '👍' }],
    is_big: false
  });

  const session = JSON.parse(await readFile(path.join(cwd, '.opencodex', 'sessions', sessionId, 'session.json'), 'utf8'));
  assert.equal(session.command, 'im');
  assert.equal(session.status, 'completed');
  assert.equal(session.input.arguments.provider, 'telegram');
  assert.equal(session.input.arguments.delegate_mode, 'ack');
  assert.ok(session.artifacts.some((artifact) => artifact.type === 'telegram_updates'));
});

test('im telegram listen --cto orchestrates a workflow and returns structured progress', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-im-telegram-cto-'));
  const telegram = await startTelegramMockServer({
    updates: [
      {
        update_id: 201,
        message: {
          message_id: 601,
          date: 1741435300,
          text: 'please inspect the repo',
          chat: { id: 123456, type: 'private' },
          from: { id: 9001, first_name: 'Li', last_name: 'Jianqian', username: 'lijq' }
        }
      }
    ]
  });
  t.after(async () => {
    await telegram.close();
  });

  const child = spawn('node', [
    cli,
    'im', 'telegram', 'listen',
    '--cwd', cwd,
    '--bot-token', 'test-token',
    '--chat-id', '123456',
    '--poll-timeout', '0',
    '--cto'
  ], {
    env: {
      ...process.env,
      OPENCODEX_TELEGRAM_API_BASE_URL: telegram.baseUrl,
      OPENCODEX_CODEX_BIN: fixture
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const imSessionId = await waitForValue(() => extractSessionId(stdout), 'telegram cto session id');
  await waitForCondition(() => stdout.includes('Delegate mode: CTO via Codex CLI (full-access)'), 'telegram cto mode log');
  await waitForCondition(() => telegram.state.reactions.length >= 1, 'telegram cto acknowledgement');
  await waitForCondition(() => telegram.state.sentMessages.length >= 2, 'telegram cto replies');
  await waitForCondition(() => /CTO workflow cto-/.test(stdout), 'telegram cto workflow log');

  child.kill('SIGTERM');
  const exitCode = await waitForExit(child);
  assert.equal(exitCode, 0);
  assert.equal(stderr, '');

  assert.deepEqual(telegram.state.reactions[0], {
    chat_id: '123456',
    message_id: 601,
    reaction: [{ type: 'emoji', emoji: '👍' }],
    is_big: false
  });
  assert.match(telegram.state.sentMessages[0].text, /openCodex CTO 已完成任务拆解/);
  assert.match(telegram.state.sentMessages[0].text, /Workflow: cto-/);
  assert.match(telegram.state.sentMessages.at(-1).text, /openCodex CTO 工作流已完成/);
  assert.match(telegram.state.sentMessages.at(-1).text, /src\/mock-inspection\.js/);
  assert.match(telegram.state.sentMessages.at(-1).text, /docs\/en\/mock-summary\.md/);

  const sessionsRoot = path.join(cwd, '.opencodex', 'sessions');
  const sessionIds = await readdir(sessionsRoot);
  assert.ok(sessionIds.length >= 4);

  const imSession = JSON.parse(await readFile(path.join(sessionsRoot, imSessionId, 'session.json'), 'utf8'));
  const ctoSessionId = imSession.child_sessions.find((entry) => entry.command === 'cto')?.session_id;
  assert.ok(ctoSessionId);

  const ctoSession = JSON.parse(await readFile(path.join(sessionsRoot, ctoSessionId, 'session.json'), 'utf8'));
  const workflowState = JSON.parse(await readFile(path.join(sessionsRoot, ctoSessionId, 'artifacts', 'cto-workflow.json'), 'utf8'));

  assert.equal(imSession.command, 'im');
  assert.equal(imSession.input.arguments.delegate_mode, 'cto');
  assert.equal(imSession.input.arguments.profile, 'full-access');
  assert.ok(imSession.artifacts.some((artifact) => artifact.type === 'telegram_runs'));
  assert.ok(imSession.artifacts.some((artifact) => artifact.type === 'child_session'));

  assert.equal(ctoSession.command, 'cto');
  assert.equal(ctoSession.parent_session_id, imSessionId);
  assert.equal(ctoSession.summary.status, 'completed');
  assert.equal(workflowState.status, 'completed');
  assert.equal(workflowState.tasks.length, 2);
  assert.deepEqual(workflowState.tasks.map((task) => task.id), ['inspect-repo', 'summarize-findings']);
  assert.ok(workflowState.tasks.every((task) => task.status === 'completed'));
});


test('im telegram listen --cto injects a default repair task when stale workflows exist', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-im-telegram-cto-repair-'));
  const staleWorkflowId = 'cto-20260308-stale-zombie';
  const staleWorkflowDir = path.join(cwd, '.opencodex', 'sessions', staleWorkflowId);
  const staleWorkflowStatePath = path.join(staleWorkflowDir, 'artifacts', 'cto-workflow.json');
  await mkdir(path.join(staleWorkflowDir, 'artifacts'), { recursive: true });
  await writeFile(path.join(staleWorkflowDir, 'session.json'), `${JSON.stringify({
    session_id: staleWorkflowId,
    command: 'cto',
    status: 'running',
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    working_directory: cwd,
    codex_cli_version: 'telegram-bot-api',
    input: { prompt: 'Old stale workflow', arguments: { provider: 'telegram' } },
    summary: {
      title: 'CTO workflow running',
      result: 'Workflow is running with 1 active task(s).',
      status: 'running',
      highlights: [],
      next_steps: []
    },
    artifacts: [
      { type: 'cto_workflow', path: staleWorkflowStatePath, description: 'Telegram CTO workflow state and task graph.' }
    ]
  }, null, 2)}
`, 'utf8');
  await writeFile(staleWorkflowStatePath, `${JSON.stringify({
    workflow_session_id: staleWorkflowId,
    related_workflow_id: '',
    provider: 'telegram',
    chat_id: '123456',
    source_update_id: 1,
    source_message_id: 1,
    sender_display: 'CEO',
    goal_text: 'Old stale workflow',
    latest_user_message: 'Old stale workflow',
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    status: 'running',
    plan_mode: 'execute',
    plan_summary_zh: 'Old stale workflow.',
    pending_question_zh: '',
    task_counter: 1,
    tasks: [
      {
        id: 'old-task',
        title: 'Old task',
        worker_prompt: 'Inspect the stale workflow.',
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

  const telegram = await startTelegramMockServer({
    updates: [
      {
        update_id: 211,
        message: {
          message_id: 611,
          date: 1741435301,
          text: 'please inspect the repo',
          chat: { id: 123456, type: 'private' },
          from: { id: 9001, first_name: 'Li', last_name: 'Jianqian', username: 'lijq' }
        }
      }
    ]
  });
  t.after(async () => {
    await telegram.close();
  });

  const child = spawn('node', [
    cli,
    'im', 'telegram', 'listen',
    '--cwd', cwd,
    '--bot-token', 'test-token',
    '--chat-id', '123456',
    '--poll-timeout', '0',
    '--cto'
  ], {
    env: {
      ...process.env,
      OPENCODEX_TELEGRAM_API_BASE_URL: telegram.baseUrl,
      OPENCODEX_CODEX_BIN: fixture
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const imSessionId = await waitForValue(() => extractSessionId(stdout), 'telegram cto repair session id');
  await waitForCondition(() => telegram.state.sentMessages.some((message) => /Repair historical stuck workflows/.test(message.text)), 'repair task plan reply');
  await waitForCondition(() => telegram.state.sentMessages.some((message) => /工作流已完成/.test(message.text)), 'repair task final reply');

  child.kill('SIGTERM');
  const exitCode = await waitForExit(child);
  assert.equal(exitCode, 0);
  assert.equal(stderr, '');

  const sessionsRoot = path.join(cwd, '.opencodex', 'sessions');
  const imSession = JSON.parse(await readFile(path.join(sessionsRoot, imSessionId, 'session.json'), 'utf8'));
  const ctoSessionId = imSession.child_sessions.find((entry) => entry.command === 'cto')?.session_id;
  assert.ok(ctoSessionId);

  const workflowState = JSON.parse(await readFile(path.join(sessionsRoot, ctoSessionId, 'artifacts', 'cto-workflow.json'), 'utf8'));
  assert.equal(workflowState.tasks[0].id, 'repair-historical-workflows');
  assert.equal(workflowState.tasks[0].status, 'completed');
  assert.match(workflowState.plan_summary_zh, /历史卡住 workflow/);
  assert.match(telegram.state.sentMessages[0].text, /Repair historical stuck workflows/);
});


test('im telegram listen --cto cancels the current waiting workflow without dispatching a new one', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-im-telegram-cto-cancel-'));
  const telegram = await startTelegramMockServer({
    updates: [
      {
        update_id: 321,
        message: {
          message_id: 721,
          date: 1741435450,
          text: 'need confirm',
          chat: { id: 123456, type: 'private' },
          from: { id: 9001, first_name: 'Li', last_name: 'Jianqian', username: 'lijq' }
        }
      }
    ]
  });
  t.after(async () => {
    await telegram.close();
  });

  const child = spawn('node', [
    cli,
    'im', 'telegram', 'listen',
    '--cwd', cwd,
    '--bot-token', 'test-token',
    '--chat-id', '123456',
    '--poll-timeout', '0',
    '--cto'
  ], {
    env: {
      ...process.env,
      OPENCODEX_TELEGRAM_API_BASE_URL: telegram.baseUrl,
      OPENCODEX_CODEX_BIN: fixture
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  await waitForCondition(() => telegram.state.sentMessages.some((message) => message.reply_to_message_id === 721 && /需要你确认下一步/.test(message.text)), 'confirmation reply');

  telegram.state.updates.push({
    update_id: 322,
    message: {
      message_id: 722,
      date: 1741435451,
      text: '取消',
      chat: { id: 123456, type: 'private' },
      from: { id: 9001, first_name: 'Li', last_name: 'Jianqian', username: 'lijq' }
    }
  });

  await waitForCondition(() => telegram.state.sentMessages.some((message) => message.reply_to_message_id === 722 && /工作流已取消/.test(message.text)), 'cancel reply');
  await waitForCondition(() => stdout.includes('Handled CTO workflow control for update 322'), 'cancel control log');

  const planReply = telegram.state.sentMessages.find((message) => message.reply_to_message_id === 721 && /Workflow: cto-/.test(message.text));
  assert.ok(planReply);
  const workflowIdMatch = planReply.text.match(/Workflow:\s+(cto-[^\s]+)/);
  assert.ok(workflowIdMatch);

  const cancelReply = telegram.state.sentMessages.find((message) => message.reply_to_message_id === 722 && /工作流已取消/.test(message.text));
  assert.ok(cancelReply);
  assert.ok(cancelReply.text.includes(`Workflow: ${workflowIdMatch[1]}`));
  assert.equal(telegram.state.reactions.length, 1);
  assert.doesNotMatch(stdout, /started workflow .* for update 322/);

  await waitForCondition(async () => {
    const workflowState = JSON.parse(await readFile(path.join(cwd, '.opencodex', 'sessions', workflowIdMatch[1], 'artifacts', 'cto-workflow.json'), 'utf8'));
    return workflowState.status === 'cancelled';
  }, 'cancelled workflow state');

  const workflowState = JSON.parse(await readFile(path.join(cwd, '.opencodex', 'sessions', workflowIdMatch[1], 'artifacts', 'cto-workflow.json'), 'utf8'));
  assert.equal(workflowState.status, 'cancelled');
  assert.equal(workflowState.pending_question_zh, '');

  child.kill('SIGTERM');
  const exitCode = await waitForExit(child);
  assert.equal(exitCode, 0);
  assert.equal(stderr, '');
});

test('im telegram listen --cto handles casual chat inline without resuming the current waiting workflow', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-im-telegram-cto-casual-chat-'));
  const telegram = await startTelegramMockServer({
    updates: [
      {
        update_id: 321,
        message: {
          message_id: 721,
          date: 1741435450,
          text: 'need confirm',
          chat: { id: 123456, type: 'private' },
          from: { id: 9001, first_name: 'Li', last_name: 'Jianqian', username: 'lijq' }
        }
      }
    ]
  });
  t.after(async () => {
    await telegram.close();
  });

  const child = spawn('node', [
    cli,
    'im', 'telegram', 'listen',
    '--cwd', cwd,
    '--bot-token', 'test-token',
    '--chat-id', '123456',
    '--poll-timeout', '0',
    '--cto'
  ], {
    env: {
      ...process.env,
      OPENCODEX_TELEGRAM_API_BASE_URL: telegram.baseUrl,
      OPENCODEX_CODEX_BIN: fixture
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  await waitForCondition(() => telegram.state.sentMessages.some((message) => message.reply_to_message_id === 721 && /需要你确认下一步/.test(message.text)), 'confirmation reply');

  const planReply = telegram.state.sentMessages.find((message) => message.reply_to_message_id === 721 && /Workflow: cto-/.test(message.text));
  assert.ok(planReply);
  const workflowIdMatch = planReply.text.match(/Workflow:\s+(cto-[^\s]+)/);
  assert.ok(workflowIdMatch);

  const originalWorkflowState = JSON.parse(await readFile(path.join(cwd, '.opencodex', 'sessions', workflowIdMatch[1], 'artifacts', 'cto-workflow.json'), 'utf8'));
  assert.equal(originalWorkflowState.status, 'waiting_for_user');
  assert.ok(originalWorkflowState.pending_question_zh);

  telegram.state.updates.push({
    update_id: 322,
    message: {
      message_id: 722,
      date: 1741435451,
      text: 'CTO 陪我聊聊天',
      chat: { id: 123456, type: 'private' },
      from: { id: 9001, first_name: 'Li', last_name: 'Jianqian', username: 'lijq' }
    }
  });

  await waitForCondition(() => telegram.state.sentMessages.some((message) => message.reply_to_message_id === 722 && /可以，我在/.test(message.text)), 'casual chat direct reply');
  await waitForCondition(() => stdout.includes('Handled CTO casual chat for update 322'), 'casual chat log');

  const directReply = telegram.state.sentMessages.find((message) => message.reply_to_message_id === 722 && /可以，我在/.test(message.text));
  assert.ok(directReply);
  assert.match(directReply.text, /当前 Workflow 仍保持等待中/);
  assert.equal(telegram.state.reactions.length, 1);
  assert.doesNotMatch(stdout, /started workflow .* for update 322/);
  assert.doesNotMatch(stdout, /Continuing CTO workflow .* from update 322/);

  const workflowState = JSON.parse(await readFile(path.join(cwd, '.opencodex', 'sessions', workflowIdMatch[1], 'artifacts', 'cto-workflow.json'), 'utf8'));
  assert.equal(workflowState.status, 'waiting_for_user');
  assert.equal(workflowState.pending_question_zh, originalWorkflowState.pending_question_zh);

  child.kill('SIGTERM');
  const exitCode = await waitForExit(child);
  assert.equal(exitCode, 0);
  assert.equal(stderr, '');
});

test('im telegram listen --cto does not dispatch a new workflow when no cancellable workflow exists', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-im-telegram-cto-cancel-missing-'));
  const telegram = await startTelegramMockServer({
    updates: [
      {
        update_id: 331,
        message: {
          message_id: 731,
          date: 1741435460,
          text: 'cancel',
          chat: { id: 123456, type: 'private' },
          from: { id: 9001, first_name: 'Li', last_name: 'Jianqian', username: 'lijq' }
        }
      }
    ]
  });
  t.after(async () => {
    await telegram.close();
  });

  const child = spawn('node', [
    cli,
    'im', 'telegram', 'listen',
    '--cwd', cwd,
    '--bot-token', 'test-token',
    '--chat-id', '123456',
    '--poll-timeout', '0',
    '--cto'
  ], {
    env: {
      ...process.env,
      OPENCODEX_TELEGRAM_API_BASE_URL: telegram.baseUrl,
      OPENCODEX_CODEX_BIN: fixture
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  await waitForCondition(() => telegram.state.sentMessages.some((message) => message.reply_to_message_id === 731 && /没有可取消的工作流/.test(message.text)), 'missing cancel reply');
  await waitForCondition(() => stdout.includes('Handled CTO workflow control for update 331'), 'missing cancel control log');

  assert.equal(telegram.state.reactions.length, 0);
  assert.equal(telegram.state.sentMessages.length, 1);
  assert.match(telegram.state.sentMessages[0].text, /当前没有可取消的工作流/);
  assert.doesNotMatch(stdout, /started workflow .* for update 331/);

  child.kill('SIGTERM');
  const exitCode = await waitForExit(child);
  assert.equal(exitCode, 0);
  assert.equal(stderr, '');
});

test('im telegram listen --cto keeps later messages non-blocking while a slow workflow is running', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-im-telegram-cto-parallel-'));
  const telegram = await startTelegramMockServer({
    updates: [
      {
        update_id: 301,
        message: {
          message_id: 701,
          date: 1741435400,
          text: 'parallel slow',
          chat: { id: 123456, type: 'private' },
          from: { id: 9001, first_name: 'Li', last_name: 'Jianqian', username: 'lijq' }
        }
      },
      {
        update_id: 302,
        message: {
          message_id: 702,
          date: 1741435401,
          text: 'parallel fast',
          chat: { id: 123456, type: 'private' },
          from: { id: 9001, first_name: 'Li', last_name: 'Jianqian', username: 'lijq' }
        }
      }
    ]
  });
  t.after(async () => {
    await telegram.close();
  });

  const child = spawn('node', [
    cli,
    'im', 'telegram', 'listen',
    '--cwd', cwd,
    '--bot-token', 'test-token',
    '--chat-id', '123456',
    '--poll-timeout', '0',
    '--cto'
  ], {
    env: {
      ...process.env,
      OPENCODEX_TELEGRAM_API_BASE_URL: telegram.baseUrl,
      OPENCODEX_CODEX_BIN: fixture
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  });

  await waitForCondition(() => telegram.state.reactions.length >= 2, 'parallel workflow reactions');
  await waitForCondition(() => telegram.state.sentMessages.length >= 4, 'parallel workflow replies');

  const planSlowIndex = findMessageIndex(telegram.state.sentMessages, (message) => message.reply_to_message_id === 701 && /已完成任务拆解/.test(message.text));
  const planFastIndex = findMessageIndex(telegram.state.sentMessages, (message) => message.reply_to_message_id === 702 && /已完成任务拆解/.test(message.text));
  const finalSlowIndex = findMessageIndex(telegram.state.sentMessages, (message) => message.reply_to_message_id === 701 && /工作流已完成/.test(message.text));
  const finalFastIndex = findMessageIndex(telegram.state.sentMessages, (message) => message.reply_to_message_id === 702 && /工作流已完成/.test(message.text));

  assert.deepEqual(telegram.state.reactions, [
    {
      chat_id: '123456',
      message_id: 701,
      reaction: [{ type: 'emoji', emoji: '👍' }],
      is_big: false
    },
    {
      chat_id: '123456',
      message_id: 702,
      reaction: [{ type: 'emoji', emoji: '👍' }],
      is_big: false
    }
  ]);
  assert.ok(planSlowIndex >= 0);
  assert.ok(planFastIndex >= 0);
  assert.ok(finalSlowIndex >= 0);
  assert.ok(finalFastIndex >= 0);
  assert.ok(planFastIndex < finalSlowIndex);
  assert.ok(finalFastIndex < finalSlowIndex);

  child.kill('SIGTERM');
  await waitForExit(child);
});

test('im telegram listen --cto reports workflow status instead of dispatching a new workflow for status questions', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-im-telegram-cto-status-'));
  const telegram = await startTelegramMockServer({
    updates: [
      {
        update_id: 301,
        message: {
          message_id: 701,
          date: 1741435400,
          text: 'parallel slow',
          chat: { id: 123456, type: 'private' },
          from: { id: 9001, first_name: 'Li', last_name: 'Jianqian', username: 'lijq' }
        }
      },
      {
        update_id: 302,
        message: {
          message_id: 702,
          date: 1741435401,
          text: '安排了哪些任务',
          chat: { id: 123456, type: 'private' },
          from: { id: 9001, first_name: 'Li', last_name: 'Jianqian', username: 'lijq' }
        }
      }
    ]
  });
  t.after(async () => {
    await telegram.close();
  });

  const child = spawn('node', [
    cli,
    'im', 'telegram', 'listen',
    '--cwd', cwd,
    '--bot-token', 'test-token',
    '--chat-id', '123456',
    '--poll-timeout', '0',
    '--cto'
  ], {
    env: {
      ...process.env,
      OPENCODEX_TELEGRAM_API_BASE_URL: telegram.baseUrl,
      OPENCODEX_CODEX_BIN: fixture
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  await waitForCondition(() => telegram.state.reactions.length >= 1, 'workflow acknowledgement');
  await waitForCondition(() => telegram.state.sentMessages.some((message) => message.reply_to_message_id === 702 && /工作流汇报/.test(message.text)), 'workflow status reply');
  await waitForCondition(() => telegram.state.sentMessages.some((message) => message.reply_to_message_id === 701 && /工作流已完成/.test(message.text)), 'slow workflow completion');

  const planReply = telegram.state.sentMessages.find((message) => message.reply_to_message_id === 701 && /Workflow: cto-/.test(message.text));
  assert.ok(planReply);
  const workflowIdMatch = planReply.text.match(/Workflow:\s+(cto-[^\s]+)/);
  assert.ok(workflowIdMatch);

  assert.equal(telegram.state.reactions.length, 1);
  const secondReplies = telegram.state.sentMessages.filter((message) => message.reply_to_message_id === 702);
  assert.equal(secondReplies.length, 1);
  assert.match(secondReplies[0].text, /openCodex CTO 工作流汇报/);
  assert.ok(secondReplies[0].text.includes(`Workflow: ${workflowIdMatch[1]}`));
  assert.doesNotMatch(secondReplies[0].text, /主线程已接管/);
  assert.doesNotMatch(secondReplies[0].text, /已完成任务拆解/);
  assert.match(stdout, /Reported CTO workflow status for update 302/);
  assert.doesNotMatch(stdout, /started workflow .* for update 302/);

  child.kill('SIGTERM');
  const exitCode = await waitForExit(child);
  assert.equal(exitCode, 0);
  assert.equal(stderr, '');
});

test('im telegram listen --cto can report a referenced workflow id without dispatching new tasks', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-im-telegram-cto-workflow-ref-'));
  const workflowId = 'cto-20260308-232854-zetg6z';
  const workflowDir = path.join(cwd, '.opencodex', 'sessions', workflowId);
  const workflowStatePath = path.join(workflowDir, 'artifacts', 'cto-workflow.json');
  const workflowState = {
    workflow_session_id: workflowId,
    provider: 'telegram',
    chat_id: '123456',
    source_update_id: 500,
    source_message_id: 900,
    sender_display: 'Li Jianqian',
    goal_text: 'please inspect the repo',
    latest_user_message: 'please inspect the repo',
    created_at: '2026-03-08T15:28:54.000Z',
    updated_at: '2026-03-08T15:29:10.000Z',
    status: 'completed',
    plan_mode: 'execute',
    plan_summary_zh: '已拆分任务并完成执行。',
    pending_question_zh: '',
    task_counter: 2,
    tasks: [
      {
        id: 'inspect-repo',
        title: 'Inspect repository',
        worker_prompt: 'MOCK_WORKER inspect-repo',
        depends_on: [],
        status: 'completed',
        session_id: 'run-1',
        summary_status: 'completed',
        result: 'The mock repository inspection completed successfully.',
        next_steps: [],
        changed_files: ['src/mock-inspection.js'],
        updated_at: '2026-03-08T15:28:59.000Z'
      },
      {
        id: 'summarize-findings',
        title: 'Summarize findings',
        worker_prompt: 'MOCK_WORKER summarize-findings',
        depends_on: ['inspect-repo'],
        status: 'completed',
        session_id: 'run-2',
        summary_status: 'completed',
        result: 'The mock findings summary completed successfully.',
        next_steps: [],
        changed_files: ['docs/en/mock-summary.md', 'docs/zh/mock-summary.md'],
        updated_at: '2026-03-08T15:29:10.000Z'
      }
    ],
    user_messages: [
      {
        update_id: 500,
        message_id: 900,
        text: 'please inspect the repo',
        created_at: '2026-03-08T15:28:54.000Z'
      }
    ]
  };
  const workflowSession = {
    session_id: workflowId,
    command: 'cto',
    status: 'completed',
    created_at: '2026-03-08T15:28:54.000Z',
    updated_at: '2026-03-08T15:29:10.000Z',
    working_directory: cwd,
    codex_cli_version: 'telegram-cto',
    input: {
      prompt: 'please inspect the repo',
      arguments: {
        provider: 'telegram',
        profile: 'full-access',
        update_id: 500,
        chat_id: '123456',
        sender: 'Li Jianqian'
      }
    },
    summary: {
      title: 'CTO workflow completed',
      result: 'Completed 2/2 workflow task(s).',
      status: 'completed',
      highlights: [],
      next_steps: []
    },
    artifacts: [
      {
        type: 'cto_workflow',
        path: workflowStatePath,
        description: 'Telegram CTO workflow state and task graph.'
      }
    ]
  };

  await mkdir(path.join(workflowDir, 'artifacts'), { recursive: true });
  await writeFile(path.join(workflowDir, 'session.json'), `${JSON.stringify(workflowSession, null, 2)}\n`, 'utf8');
  await writeFile(workflowStatePath, `${JSON.stringify(workflowState, null, 2)}\n`, 'utf8');

  const telegram = await startTelegramMockServer({
    updates: [
      {
        update_id: 501,
        message: {
          message_id: 901,
          date: 1741435600,
          text: `Workflow: ${workflowId} 安排了哪些任务`,
          chat: { id: 123456, type: 'private' },
          from: { id: 9001, first_name: 'Li', last_name: 'Jianqian', username: 'lijq' }
        }
      }
    ]
  });
  t.after(async () => {
    await telegram.close();
  });

  const child = spawn('node', [
    cli,
    'im', 'telegram', 'listen',
    '--cwd', cwd,
    '--bot-token', 'test-token',
    '--chat-id', '123456',
    '--poll-timeout', '0',
    '--cto'
  ], {
    env: {
      ...process.env,
      OPENCODEX_TELEGRAM_API_BASE_URL: telegram.baseUrl,
      OPENCODEX_CODEX_BIN: fixture
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  await waitForCondition(() => telegram.state.sentMessages.length >= 1, 'referenced workflow status reply');
  await waitForCondition(() => stdout.includes('Reported CTO workflow status for update 501'), 'referenced workflow status log');

  assert.equal(telegram.state.sentMessages.length, 1);
  assert.match(telegram.state.sentMessages[0].text, /openCodex CTO 工作流汇报/);
  assert.ok(telegram.state.sentMessages[0].text.includes(`Workflow: ${workflowId}`));
  assert.match(telegram.state.sentMessages[0].text, /\[completed\] inspect-repo/);
  assert.match(stdout, /Reported CTO workflow status for update 501/);
  assert.doesNotMatch(stdout, /started workflow .* for update 501/);

  child.kill('SIGTERM');
  const exitCode = await waitForExit(child);
  assert.equal(exitCode, 0);
  assert.equal(stderr, '');

  const sessionIds = await readdir(path.join(cwd, '.opencodex', 'sessions'));
  assert.equal(sessionIds.length, 2);
});

test('im telegram listen --cto can report recent task history without dispatching a new workflow', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-im-telegram-cto-task-history-'));
  const workflowId = 'cto-20260308-232854-zetg6z';
  const workflowDir = path.join(cwd, '.opencodex', 'sessions', workflowId);
  const workflowStatePath = path.join(workflowDir, 'artifacts', 'cto-workflow.json');
  const workflowState = {
    workflow_session_id: workflowId,
    provider: 'telegram',
    chat_id: '123456',
    source_update_id: 500,
    source_message_id: 900,
    sender_display: 'Li Jianqian',
    goal_text: 'please inspect the repo',
    latest_user_message: 'please inspect the repo',
    created_at: '2026-03-08T15:28:54.000Z',
    updated_at: '2026-03-08T15:29:10.000Z',
    status: 'completed',
    plan_mode: 'execute',
    plan_summary_zh: '已拆分任务并完成执行。',
    pending_question_zh: '',
    task_counter: 3,
    tasks: [
      {
        id: 'inspect-repo',
        title: 'Inspect repository',
        worker_prompt: 'MOCK_WORKER inspect-repo',
        depends_on: [],
        status: 'completed',
        session_id: 'run-1',
        summary_status: 'completed',
        result: 'The mock repository inspection completed successfully.',
        next_steps: [],
        changed_files: ['src/mock-inspection.js'],
        updated_at: '2026-03-08T15:28:59.000Z'
      },
      {
        id: 'summarize-findings',
        title: 'Summarize findings',
        worker_prompt: 'MOCK_WORKER summarize-findings',
        depends_on: ['inspect-repo'],
        status: 'completed',
        session_id: 'run-2',
        summary_status: 'completed',
        result: 'The mock findings summary completed successfully.',
        next_steps: [],
        changed_files: ['docs/en/mock-summary.md', 'docs/zh/mock-summary.md'],
        updated_at: '2026-03-08T15:29:10.000Z'
      },
      {
        id: 'archive-report',
        title: 'Archive report',
        worker_prompt: 'MOCK_WORKER archive-report',
        depends_on: ['summarize-findings'],
        status: 'completed',
        session_id: 'run-3',
        summary_status: 'completed',
        result: 'The mock archive task completed successfully.',
        next_steps: [],
        changed_files: [],
        updated_at: '2026-03-08T15:29:12.000Z'
      }
    ],
    user_messages: [
      {
        update_id: 500,
        message_id: 900,
        text: 'please inspect the repo',
        created_at: '2026-03-08T15:28:54.000Z'
      }
    ]
  };
  const workflowSession = {
    session_id: workflowId,
    command: 'cto',
    status: 'completed',
    created_at: '2026-03-08T15:28:54.000Z',
    updated_at: '2026-03-08T15:29:12.000Z',
    working_directory: cwd,
    codex_cli_version: 'telegram-cto',
    input: {
      prompt: 'please inspect the repo',
      arguments: {
        provider: 'telegram',
        profile: 'full-access',
        update_id: 500,
        chat_id: '123456',
        sender: 'Li Jianqian'
      }
    },
    summary: {
      title: 'CTO workflow completed',
      result: 'Completed 3/3 workflow task(s).',
      status: 'completed',
      highlights: [],
      next_steps: []
    },
    artifacts: [
      {
        type: 'cto_workflow',
        path: workflowStatePath,
        description: 'Telegram CTO workflow state and task graph.'
      }
    ]
  };

  await mkdir(path.join(workflowDir, 'artifacts'), { recursive: true });
  await writeFile(path.join(workflowDir, 'session.json'), `${JSON.stringify(workflowSession, null, 2)}\n`, 'utf8');
  await writeFile(workflowStatePath, `${JSON.stringify(workflowState, null, 2)}\n`, 'utf8');

  const telegram = await startTelegramMockServer({
    updates: [
      {
        update_id: 601,
        message: {
          message_id: 1001,
          date: 1741435601,
          text: '最近任务',
          chat: { id: 123456, type: 'private' },
          from: { id: 9001, first_name: 'Li', last_name: 'Jianqian', username: 'lijq' }
        }
      }
    ]
  });
  t.after(async () => {
    await telegram.close();
  });

  const child = spawn('node', [
    cli,
    'im', 'telegram', 'listen',
    '--cwd', cwd,
    '--bot-token', 'test-token',
    '--chat-id', '123456',
    '--poll-timeout', '0',
    '--cto'
  ], {
    env: {
      ...process.env,
      OPENCODEX_TELEGRAM_API_BASE_URL: telegram.baseUrl,
      OPENCODEX_CODEX_BIN: fixture
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  await waitForCondition(() => telegram.state.sentMessages.length >= 1, 'recent task history reply');
  await waitForCondition(() => stdout.includes('Reported CTO workflow status for update 601'), 'recent task history status log');

  assert.equal(telegram.state.sentMessages.length, 1);
  assert.match(telegram.state.sentMessages[0].text, /openCodex CTO 最近任务/);
  assert.match(telegram.state.sentMessages[0].text, /\[completed\] archive-report/);
  assert.match(telegram.state.sentMessages[0].text, /\[completed\] summarize-findings/);
  assert.match(telegram.state.sentMessages[0].text, /\[completed\] inspect-repo/);
  assert.doesNotMatch(stdout, /started workflow .* for update 601/);

  child.kill('SIGTERM');
  const exitCode = await waitForExit(child);
  assert.equal(exitCode, 0);
  assert.equal(stderr, '');
});

test('im telegram listen --cto can infer an actionable audit from an abstract inspection request', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-im-telegram-cto-infer-'));
  const telegram = await startTelegramMockServer({
    updates: [
      {
        update_id: 402,
        message: {
          message_id: 802,
          date: 1741435501,
          text: 'CTO 检查你的思考深度是不是最高',
          chat: { id: 123456, type: 'private' },
          from: { id: 9001, first_name: 'Li', last_name: 'Jianqian', username: 'lijq' }
        }
      }
    ]
  });
  t.after(async () => {
    await telegram.close();
  });

  const child = spawn('node', [
    cli,
    'im', 'telegram', 'listen',
    '--cwd', cwd,
    '--bot-token', 'test-token',
    '--chat-id', '123456',
    '--poll-timeout', '0',
    '--cto'
  ], {
    env: {
      ...process.env,
      OPENCODEX_TELEGRAM_API_BASE_URL: telegram.baseUrl,
      OPENCODEX_CODEX_BIN: fixture
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const imSessionId = await waitForValue(() => extractSessionId(stdout), 'telegram inferred-audit session id');
  await waitForCondition(() => telegram.state.reactions.length >= 1, 'inferred-audit acknowledgement');
  await waitForCondition(() => telegram.state.sentMessages.length >= 2, 'inferred-audit replies');
  await waitForCondition(() => telegram.state.sentMessages.some((message) => message.reply_to_message_id === 802 && /已完成任务拆解/.test(message.text)), 'inferred-audit plan reply');
  await waitForCondition(() => telegram.state.sentMessages.some((message) => message.reply_to_message_id === 802 && /工作流已完成/.test(message.text)), 'inferred-audit final reply');

  child.kill('SIGTERM');
  const exitCode = await waitForExit(child);
  assert.equal(exitCode, 0);
  assert.equal(stderr, '');

  assert.deepEqual(telegram.state.reactions[0], {
    chat_id: '123456',
    message_id: 802,
    reaction: [{ type: 'emoji', emoji: '👍' }],
    is_big: false
  });
  assert.match(telegram.state.sentMessages[0].text, /Audit CTO reasoning depth/);
  assert.doesNotMatch(telegram.state.sentMessages[0].text, /需要你确认下一步/);
  assert.match(telegram.state.sentMessages.at(-1).text, /工作流已完成/);

  const sessionsRoot = path.join(cwd, '.opencodex', 'sessions');
  const imSession = JSON.parse(await readFile(path.join(sessionsRoot, imSessionId, 'session.json'), 'utf8'));
  const ctoSessionId = imSession.child_sessions.find((entry) => entry.command === 'cto')?.session_id;
  assert.ok(ctoSessionId);

  const workflowState = JSON.parse(await readFile(path.join(sessionsRoot, ctoSessionId, 'artifacts', 'cto-workflow.json'), 'utf8'));
  assert.equal(workflowState.status, 'completed');
  assert.equal(workflowState.tasks.length, 1);
  assert.equal(workflowState.tasks[0].id, 'audit-cto-reasoning');
  assert.equal(workflowState.tasks[0].status, 'completed');
});

test('im telegram listen --cto asks for confirmation before execution when planner requires it', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-im-telegram-cto-confirm-'));
  const telegram = await startTelegramMockServer({
    updates: [
      {
        update_id: 401,
        message: {
          message_id: 801,
          date: 1741435500,
          text: 'need confirm',
          chat: { id: 123456, type: 'private' },
          from: { id: 9001, first_name: 'Li', last_name: 'Jianqian', username: 'lijq' }
        }
      }
    ]
  });
  t.after(async () => {
    await telegram.close();
  });

  const child = spawn('node', [
    cli,
    'im', 'telegram', 'listen',
    '--cwd', cwd,
    '--bot-token', 'test-token',
    '--chat-id', '123456',
    '--poll-timeout', '0',
    '--cto'
  ], {
    env: {
      ...process.env,
      OPENCODEX_TELEGRAM_API_BASE_URL: telegram.baseUrl,
      OPENCODEX_CODEX_BIN: fixture
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  });

  await waitForCondition(() => telegram.state.reactions.length >= 1, 'confirmation acknowledgement');
  await waitForCondition(() => telegram.state.sentMessages.length >= 1, 'confirmation replies');

  assert.deepEqual(telegram.state.reactions[0], {
    chat_id: '123456',
    message_id: 801,
    reaction: [{ type: 'emoji', emoji: '👍' }],
    is_big: false
  });
  assert.match(telegram.state.sentMessages[0].text, /需要你确认下一步/);
  assert.match(telegram.state.sentMessages[0].text, /请确认是否继续修改本地仓库/);

  child.kill('SIGTERM');
  await waitForExit(child);
});

test('im telegram listen --cto requires chat-id for safety', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-im-telegram-cto-safety-'));
  const telegram = await startTelegramMockServer({ updates: [] });

  const result = await runCli([
    'im', 'telegram', 'listen',
    '--cwd', cwd,
    '--bot-token', 'test-token',
    '--poll-timeout', '0',
    '--cto'
  ], {
    OPENCODEX_TELEGRAM_API_BASE_URL: telegram.baseUrl,
    OPENCODEX_CODEX_BIN: fixture
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /requires `--chat-id <id>` for safety/);

  await telegram.close();
});

test('im telegram send posts a message through the Telegram Bot API', async () => {
  const telegram = await startTelegramMockServer({ updates: [] });
  const result = await runCli([
    'im', 'telegram', 'send',
    '--bot-token', 'test-token',
    '--chat-id', '123456',
    'reply', 'from', 'openCodex'
  ], {
    OPENCODEX_TELEGRAM_API_BASE_URL: telegram.baseUrl
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Telegram message sent/);
  assert.equal(telegram.state.sentMessages.length, 1);
  assert.deepEqual(telegram.state.sentMessages[0], {
    chat_id: '123456',
    text: 'reply from openCodex'
  });

  await telegram.close();
});

test('im telegram listen fails when a webhook is active and clear-webhook is not set', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-im-telegram-webhook-'));
  const telegram = await startTelegramMockServer({
    updates: [],
    webhookUrl: 'https://example.com/telegram-webhook'
  });

  const result = await runCli([
    'im', 'telegram', 'listen',
    '--cwd', cwd,
    '--bot-token', 'test-token',
    '--poll-timeout', '0'
  ], {
    OPENCODEX_TELEGRAM_API_BASE_URL: telegram.baseUrl
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Telegram webhook is currently set/);
  assert.equal(telegram.state.deleteWebhookCalls, 0);

  await telegram.close();
});

function runCli(args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [cli, ...args], {
      env: { ...process.env, ...extraEnv },
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

async function startTelegramMockServer({ updates, webhookUrl = '' }) {
  const state = {
    updates: [...updates],
    webhookUrl,
    sentMessages: [],
    reactions: [],
    deleteWebhookCalls: 0
  };

  const server = http.createServer(async (request, response) => {
    const rawBody = await readRequestBody(request);
    const body = rawBody ? JSON.parse(rawBody) : {};
    const [, botToken, methodName] = (request.url || '').match(/^\/bot([^/]+)\/([^?]+)/) || [];

    if (botToken !== 'test-token') {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: false, description: 'bad token' }));
      return;
    }

    if (methodName === 'getMe') {
      return writeTelegram(response, { id: 77, is_bot: true, username: 'openCodexBot', first_name: 'openCodex' });
    }

    if (methodName === 'getWebhookInfo') {
      return writeTelegram(response, { url: state.webhookUrl });
    }

    if (methodName === 'deleteWebhook') {
      state.deleteWebhookCalls += 1;
      state.webhookUrl = '';
      return writeTelegram(response, true);
    }

    if (methodName === 'getUpdates') {
      const offset = Number(body.offset || 0);
      const nextUpdates = state.updates.filter((item) => item.update_id >= offset);
      state.updates = state.updates.filter((item) => item.update_id < offset);
      return writeTelegram(response, nextUpdates);
    }

    if (methodName === 'setMessageReaction') {
      state.reactions.push({
        chat_id: String(body.chat_id),
        message_id: body.message_id,
        reaction: body.reaction,
        is_big: Boolean(body.is_big)
      });
      return writeTelegram(response, true);
    }

    if (methodName === 'sendMessage') {
      state.sentMessages.push({
        chat_id: String(body.chat_id),
        text: body.text,
        ...(body.reply_to_message_id ? { reply_to_message_id: body.reply_to_message_id } : {})
      });
      return writeTelegram(response, {
        message_id: 900,
        date: 1741435201,
        text: body.text,
        chat: { id: body.chat_id }
      });
    }

    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: false, description: `unknown method ${methodName}` }));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    state,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })
  };
}

function writeTelegram(response, result) {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ ok: true, result }));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code));
  });
}

async function waitForValue(readValue, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5000) {
    const value = readValue();
    if (value) {
      return value;
    }
    await delay(25);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitForCondition(check, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5000) {
    if (await Promise.resolve(check())) {
      return;
    }
    await delay(25);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function extractSessionId(stdout) {
  const match = stdout.match(/Session:\s+([^\s]+)/);
  return match ? match[1] : '';
}

function findMessageIndex(messages, predicate) {
  return messages.findIndex(predicate);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
