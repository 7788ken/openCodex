import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chmod, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const cli = path.resolve('bin/opencodex.js');
const fixture = path.resolve('tests/fixtures/mock-codex.js');
const liveFixture = path.resolve('tests/fixtures/mock-codex-live.js');

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
  await waitForCondition(() => telegram.state.sentMessages.length >= 1, 'telegram cto final reply');
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
  assert.equal(telegram.state.sentMessages.length, 1);
  assert.match(telegram.state.sentMessages[0].text, /这轮已经处理完/);
  assert.match(telegram.state.sentMessages[0].text, /本轮结果：/);
  assert.match(telegram.state.sentMessages[0].text, /改动文件：/);
  assert.match(telegram.state.sentMessages[0].text, /已经检查完了。/);
  assert.match(telegram.state.sentMessages[0].text, /已经处理完，结果也整理好了。/);
  assert.doesNotMatch(telegram.state.sentMessages[0].text, /openCodex CTO|Workflow:/);

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
  assert.equal(imSession.session_contract.thread_kind, 'service_listener');
  assert.equal(imSession.session_contract.role, 'telegram_cto_listener');
  assert.ok(imSession.artifacts.some((artifact) => artifact.type === 'telegram_runs'));
  assert.ok(imSession.artifacts.some((artifact) => artifact.type === 'child_session'));
  assert.ok(ctoSession.child_sessions.some((entry) => /Plan workflow/.test(entry.label) && entry.agent_name_zh === '阿周'));
  assert.ok(ctoSession.child_sessions.some((entry) => entry.session_contract?.role === 'planner'));
  assert.ok(ctoSession.child_sessions.some((entry) => /^Task /.test(entry.label) && entry.agent_name_zh));
  assert.ok(ctoSession.child_sessions.some((entry) => entry.session_contract?.role === 'worker' && entry.task_id));

  assert.equal(ctoSession.command, 'cto');
  assert.equal(ctoSession.parent_session_id, imSessionId);
  assert.equal(ctoSession.session_contract.thread_kind, 'host_workflow');
  assert.equal(ctoSession.session_contract.role, 'cto_supervisor');
  assert.equal(ctoSession.summary.status, 'completed');
  assert.equal(workflowState.status, 'completed');
  assert.equal(workflowState.tasks.length, 2);
  assert.deepEqual(workflowState.tasks.map((task) => task.id), ['inspect-repo', 'summarize-findings']);
  assert.ok(workflowState.tasks.every((task) => task.status === 'completed'));
  assert.ok(workflowState.tasks.every((task) => task.session_id));
});

test('im telegram listen --cto relays actionable messages into the active bridge session instead of spawning a new workflow', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-im-telegram-bridge-'));
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'opencodex-im-telegram-bridge-home-'));
  const telegram = await startTelegramMockServer({
    updates: []
  });
  t.after(async () => {
    await telegram.close();
  });

  await chmod(liveFixture, 0o755);

  const register = await runCli(['bridge', 'register-codex', '--path', liveFixture, '--json', '--cwd', cwd], {
    HOME: homeDir
  });
  assert.equal(register.code, 0);

  const listenerChild = spawn('node', [
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
      HOME: homeDir,
      OPENCODEX_TELEGRAM_API_BASE_URL: telegram.baseUrl,
      OPENCODEX_CODEX_BIN: fixture
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => {
    if (!listenerChild.killed) {
      listenerChild.kill('SIGTERM');
    }
  });
  const listenerExitPromise = waitForExit(listenerChild);

  let listenerStdout = '';
  let listenerStderr = '';
  listenerChild.stdout.on('data', (chunk) => {
    listenerStdout += chunk.toString();
  });
  listenerChild.stderr.on('data', (chunk) => {
    listenerStderr += chunk.toString();
  });

  const bridgeChild = spawn('node', [cli, 'bridge', 'exec-codex', '--bridge-stdin'], {
    cwd,
    env: {
      ...process.env,
      HOME: homeDir
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => {
    if (!bridgeChild.killed) {
      bridgeChild.kill('SIGTERM');
    }
  });
  const bridgeExitPromise = waitForExit(bridgeChild);

  let bridgeStdout = '';
  let bridgeStderr = '';
  bridgeChild.stdout.on('data', (chunk) => {
    bridgeStdout += chunk.toString();
  });
  bridgeChild.stderr.on('data', (chunk) => {
    bridgeStderr += chunk.toString();
  });

  let activeBridgeSessionId = '';
  await waitForCondition(async () => {
    const status = await runCli(['bridge', 'status', '--json', '--cwd', cwd], {
      HOME: homeDir
    });
    const payload = JSON.parse(status.stdout);
    activeBridgeSessionId = payload?.active_session?.session_id || '';
    return Boolean(activeBridgeSessionId);
  }, 'active bridge session for telegram relay');

  telegram.state.updates.push({
    update_id: 211,
    message: {
      message_id: 611,
      date: 1741435310,
      text: '修一下 bridge relay 的收口并继续推进',
      chat: { id: 123456, type: 'private' },
      from: { id: 9001, first_name: 'Li', last_name: 'Jianqian', username: 'lijq' }
    }
  });

  await waitForCondition(
    () => telegram.state.sentMessages.some((message) => message.reply_to_message_id === 611 && /已接入当前 Codex 主线会话/.test(message.text)),
    'bridge relay reply'
  );
  await waitForCondition(() => bridgeStdout.includes('received: 修一下 bridge relay 的收口并继续推进'), 'bridge relay delivery');

  const bridgeExitCode = await bridgeExitPromise;
  assert.equal(bridgeExitCode, 0);
  assert.equal(bridgeStderr, '');
  assert.match(bridgeStdout, /mock bridge stdin ready/);
  assert.match(bridgeStdout, /received: 修一下 bridge relay 的收口并继续推进/);

  const relayReply = telegram.state.sentMessages.find((message) => message.reply_to_message_id === 611);
  assert.ok(relayReply);
  assert.match(relayReply.text, new RegExp(`已接入当前 Codex 主线会话 ${activeBridgeSessionId}`));
  assert.match(relayReply.text, /bridge tail --session-id/);
  assert.equal(telegram.state.reactions.length, 0);

  const inboxResult = await runCli(['bridge', 'inbox', '--cwd', cwd, '--json', '--session-id', activeBridgeSessionId], {
    HOME: homeDir
  });
  assert.equal(inboxResult.code, 0);
  const inboxPayload = JSON.parse(inboxResult.stdout);
  assert.equal(inboxPayload.count, 1);
  assert.equal(inboxPayload.messages[0].text, '修一下 bridge relay 的收口并继续推进');
  assert.equal(inboxPayload.messages[0].source, 'telegram_cto');
  assert.equal(inboxPayload.messages[0].metadata.chat_id, '123456');
  assert.equal(inboxPayload.messages[0].metadata.message_id, 611);

  const sessionsRoot = path.join(cwd, '.opencodex', 'sessions');
  const sessionIds = await readdir(sessionsRoot);
  assert.ok(sessionIds.includes(activeBridgeSessionId));
  assert.ok(!sessionIds.some((sessionId) => sessionId.startsWith('cto-')));

  listenerChild.kill('SIGTERM');
  const listenerExitCode = await listenerExitPromise;
  assert.equal(listenerExitCode, 0);
  assert.equal(listenerStderr, '');
  assert.match(listenerStdout, /Handled CTO bridge relay for update 211/);
});

test('im telegram listen --cto says there is no attachable bridge session for explicit mainline attach requests', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-im-telegram-bridge-missing-'));
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'opencodex-im-telegram-bridge-home-missing-'));
  const telegram = await startTelegramMockServer({
    updates: [
      {
        update_id: 212,
        message: {
          message_id: 612,
          date: 1741435311,
          text: '接入当前 codex 主线继续做',
          chat: { id: 123456, type: 'private' },
          from: { id: 9001, first_name: 'Li', last_name: 'Jianqian', username: 'lijq' }
        }
      }
    ]
  });
  t.after(async () => {
    await telegram.close();
  });

  const listenerChild = spawn('node', [
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
      HOME: homeDir,
      OPENCODEX_TELEGRAM_API_BASE_URL: telegram.baseUrl,
      OPENCODEX_CODEX_BIN: fixture
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => {
    if (!listenerChild.killed) {
      listenerChild.kill('SIGTERM');
    }
  });
  const listenerExitPromise = waitForExit(listenerChild);

  let listenerStdout = '';
  let listenerStderr = '';
  listenerChild.stdout.on('data', (chunk) => {
    listenerStdout += chunk.toString();
  });
  listenerChild.stderr.on('data', (chunk) => {
    listenerStderr += chunk.toString();
  });

  await waitForCondition(
    () => telegram.state.sentMessages.some((message) => message.reply_to_message_id === 612 && /当前没有可接入的 Codex 主线会话/.test(message.text)),
    'missing bridge relay reply'
  );

  assert.equal(telegram.state.reactions.length, 0);
  assert.equal(telegram.state.sentMessages.length, 1);
  assert.match(telegram.state.sentMessages[0].text, /不会被伪装成“继续当前工作”/);

  listenerChild.kill('SIGTERM');
  const listenerExitCode = await listenerExitPromise;
  assert.equal(listenerExitCode, 0);
  assert.equal(listenerStderr, '');
  assert.match(listenerStdout, /Handled CTO bridge relay for update 212 via no-session/);

  const sessionsRoot = path.join(cwd, '.opencodex', 'sessions');
  const sessionIds = await readdir(sessionsRoot);
  assert.ok(!sessionIds.some((sessionId) => sessionId.startsWith('cto-')));
});

test('im telegram listen prunes old ended service sessions without touching the chat main line', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-im-telegram-service-prune-'));

  await writeSessionFixture(cwd, {
    session_id: 'im-old-completed',
    command: 'im',
    status: 'completed',
    created_at: '2026-03-10T06:00:00.000Z',
    updated_at: '2026-03-10T06:10:00.000Z',
    input: {
      prompt: '',
      arguments: {
        provider: 'telegram',
        mode: 'listen'
      }
    }
  });

  await writeSessionFixture(cwd, {
    session_id: 'cto-old-completed',
    command: 'cto',
    status: 'completed',
    created_at: '2026-03-10T06:20:00.000Z',
    updated_at: '2026-03-10T06:30:00.000Z'
  }, [
    {
      name: 'cto-workflow.json',
      type: 'cto_workflow',
      json: {
        workflow_session_id: 'cto-old-completed',
        status: 'completed',
        updated_at: '2026-03-10T06:30:00.000Z',
        tasks: []
      }
    }
  ]);

  await writeSessionFixture(cwd, {
    session_id: 'run-old-completed',
    command: 'run',
    status: 'completed',
    parent_session_id: 'cto-old-completed',
    created_at: '2026-03-10T06:25:00.000Z',
    updated_at: '2026-03-10T06:28:00.000Z'
  });

  await writeSessionFixture(cwd, {
    session_id: 'cto-waiting-retained',
    command: 'cto',
    status: 'partial',
    created_at: '2026-03-10T07:00:00.000Z',
    updated_at: '2026-03-10T07:30:00.000Z',
    child_sessions: [
      {
        session_id: 'run-waiting-retained',
        command: 'run',
        status: 'completed'
      }
    ]
  }, [
    {
      name: 'cto-workflow.json',
      type: 'cto_workflow',
      json: {
        workflow_session_id: 'cto-waiting-retained',
        status: 'waiting_for_user',
        chat_id: '123456',
        source_message_id: 701,
        updated_at: '2026-03-10T07:30:00.000Z',
        tasks: []
      }
    }
  ]);

  await writeSessionFixture(cwd, {
    session_id: 'run-waiting-retained',
    command: 'run',
    status: 'completed',
    parent_session_id: 'cto-waiting-retained',
    created_at: '2026-03-10T07:05:00.000Z',
    updated_at: '2026-03-10T07:25:00.000Z'
  });

  const telegram = await startTelegramMockServer({ updates: [] });
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
      OPENCODEX_TELEGRAM_SERVICE_MODE: '1',
      OPENCODEX_TELEGRAM_SERVICE_SESSION_RETENTION_MINUTES: '0',
      OPENCODEX_TELEGRAM_SERVICE_SESSION_KEEP_RECENT_PER_COMMAND: '0'
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

  const sessionId = await waitForValue(() => extractSessionId(stdout), 'telegram service prune session id');
  const logPath = path.join(cwd, '.opencodex', 'sessions', sessionId, 'artifacts', 'telegram-log.txt');
  await waitForCondition(async () => {
    try {
      const logText = await readFile(logPath, 'utf8');
      return logText.includes('pruned 3 old ended session(s)');
    } catch {
      return false;
    }
  }, 'session prune log');

  child.kill('SIGTERM');
  const exitCode = await waitForExit(child);
  assert.equal(exitCode, 0);
  assert.equal(stderr, '');

  const sessionIds = (await readdir(path.join(cwd, '.opencodex', 'sessions'))).sort();
  assert.ok(sessionIds.includes(sessionId));
  assert.ok(sessionIds.includes('cto-waiting-retained'));
  assert.ok(sessionIds.includes('run-waiting-retained'));
  assert.ok(!sessionIds.includes('im-old-completed'));
  assert.ok(!sessionIds.includes('cto-old-completed'));
  assert.ok(!sessionIds.includes('run-old-completed'));
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
  await waitForCondition(() => telegram.state.sentMessages.length >= 1, 'repair task final reply');

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
  assert.doesNotMatch(telegram.state.sentMessages[0].text, /openCodex CTO|Workflow:/);
  assert.match(telegram.state.sentMessages[0].text, /这轮已经处理完/);
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

  await waitForCondition(() => telegram.state.sentMessages.some((message) => message.reply_to_message_id === 721 && /请确认是否继续修改本地仓库/.test(message.text)), 'confirmation reply');
  const waitingWorkflow = await waitForCtoWorkflowStateBySourceMessageId(cwd, 721, 'waiting workflow');

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

  await waitForCondition(() => telegram.state.sentMessages.some((message) => message.reply_to_message_id === 722 && /这轮先停在这里/.test(message.text)), 'cancel reply');
  await waitForCondition(() => stdout.includes('Handled CTO workflow control for update 322'), 'cancel control log');

  const cancelReply = telegram.state.sentMessages.find((message) => message.reply_to_message_id === 722 && /这轮先停在这里/.test(message.text));
  assert.ok(cancelReply);
  assert.doesNotMatch(cancelReply.text, /openCodex CTO|Workflow:/);
  assert.equal(telegram.state.reactions.length, 1);
  assert.doesNotMatch(stdout, /started workflow .* for update 322/);

  await waitForCondition(async () => {
    const workflowState = JSON.parse(await readFile(waitingWorkflow.workflowPath, 'utf8'));
    return workflowState.status === 'cancelled';
  }, 'cancelled workflow state');

  const workflowState = JSON.parse(await readFile(waitingWorkflow.workflowPath, 'utf8'));
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

  await waitForCondition(() => telegram.state.sentMessages.some((message) => message.reply_to_message_id === 721 && /请确认是否继续修改本地仓库/.test(message.text)), 'confirmation reply');

  const waitingWorkflow = await waitForCtoWorkflowStateBySourceMessageId(cwd, 721, 'waiting workflow');
  const originalWorkflowState = JSON.parse(await readFile(waitingWorkflow.workflowPath, 'utf8'));
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

  const workflowState = JSON.parse(await readFile(waitingWorkflow.workflowPath, 'utf8'));
  assert.equal(workflowState.status, 'waiting_for_user');
  assert.equal(workflowState.pending_question_zh, originalWorkflowState.pending_question_zh);

  child.kill('SIGTERM');
  const exitCode = await waitForExit(child);
  assert.equal(exitCode, 0);
  assert.equal(stderr, '');
});

test('im telegram listen --cto explains the previous pending question inline instead of opening a new workflow', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-im-telegram-cto-explain-pending-'));
  const telegram = await startTelegramMockServer({
    updates: [
      {
        update_id: 331,
        message: {
          message_id: 731,
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

  await waitForCondition(() => telegram.state.sentMessages.some((message) => message.reply_to_message_id === 731 && /请确认是否继续修改本地仓库/.test(message.text)), 'confirmation reply');
  const waitingWorkflow = await waitForCtoWorkflowStateBySourceMessageId(cwd, 731, 'waiting workflow');

  telegram.state.updates.push({
    update_id: 332,
    message: {
      message_id: 732,
      date: 1741435451,
      text: '我觉得你可以解释一下这个待确认问题。',
      chat: { id: 123456, type: 'private' },
      from: { id: 9001, first_name: 'Li', last_name: 'Jianqian', username: 'lijq' }
    }
  });

  await waitForCondition(() => telegram.state.sentMessages.some((message) => message.reply_to_message_id === 732 && /我说的待确认问题/.test(message.text)), 'pending question explanation reply');
  await waitForCondition(() => stdout.includes('Handled CTO casual chat for update 332'), 'pending question explanation log');

  const directReply = telegram.state.sentMessages.find((message) => message.reply_to_message_id === 732 && /我说的待确认问题/.test(message.text));
  assert.ok(directReply);
  assert.equal(telegram.state.reactions.length, 1);
  assert.doesNotMatch(stdout, /started workflow .* for update 332/);
  assert.doesNotMatch(stdout, /Continuing CTO workflow .* from update 332/);

  const workflowState = JSON.parse(await readFile(waitingWorkflow.workflowPath, 'utf8'));
  assert.equal(workflowState.status, 'waiting_for_user');
  assert.ok(workflowState.pending_question_zh);

  child.kill('SIGTERM');
  const exitCode = await waitForExit(child);
  assert.equal(exitCode, 0);
  assert.equal(stderr, '');
});

test('im telegram listen --cto preserves the pending question when the CEO explicitly continues a waiting workflow', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-im-telegram-cto-explicit-continue-'));
  const workflowId = 'cto-20260308-232854-zetg6z';
  const workflowDir = path.join(cwd, '.opencodex', 'sessions', workflowId);
  const workflowStatePath = path.join(workflowDir, 'artifacts', 'cto-workflow.json');
  const workflowState = {
    workflow_session_id: workflowId,
    provider: 'telegram',
    chat_id: '123456',
    source_update_id: 320,
    source_message_id: 720,
    sender_display: 'Li Jianqian',
    goal_text: 'review the repo',
    latest_user_message: 'review the repo',
    created_at: '2026-03-08T15:28:54.000Z',
    updated_at: '2026-03-08T15:29:10.000Z',
    status: 'waiting_for_user',
    plan_mode: 'confirm',
    plan_summary_zh: '当前需要你先确认关键决策。',
    pending_question_zh: '请确认是否继续修改本地仓库。',
    task_counter: 1,
    tasks: [
      {
        id: 'inspect-repo',
        title: 'Inspect repository',
        worker_prompt: 'MOCK_WORKER inspect-repo',
        depends_on: [],
        status: 'partial',
        session_id: 'run-1',
        summary_status: 'partial',
        result: 'Need confirmation before editing.',
        next_steps: ['请确认是否继续修改本地仓库。'],
        changed_files: [],
        updated_at: '2026-03-08T15:29:10.000Z'
      }
    ],
    user_messages: [
      {
        update_id: 320,
        message_id: 720,
        text: 'review the repo',
        created_at: '2026-03-08T15:28:54.000Z'
      }
    ]
  };
  const workflowSession = {
    session_id: workflowId,
    command: 'cto',
    status: 'partial',
    created_at: '2026-03-08T15:28:54.000Z',
    updated_at: '2026-03-08T15:29:10.000Z',
    working_directory: cwd,
    codex_cli_version: 'telegram-cto',
    input: {
      prompt: 'review the repo',
      arguments: {
        provider: 'telegram',
        profile: 'full-access',
        update_id: 320,
        chat_id: '123456',
        sender: 'Li Jianqian'
      }
    },
    summary: {
      title: 'CTO workflow needs follow-up',
      result: '请确认是否继续修改本地仓库。',
      status: 'partial',
      highlights: [],
      next_steps: ['请确认是否继续修改本地仓库。']
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
        update_id: 322,
        message: {
          message_id: 722,
          date: 1741435451,
          text: '继续。',
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

  await waitForCondition(() => telegram.state.sentMessages.some((message) => message.reply_to_message_id === 722 && /这轮先做到这里，还没完全收口。/.test(message.text)), 'explicit continue final reply');
  await waitForCondition(() => stdout.includes(`Continuing CTO workflow ${workflowId} from update 322`), 'continue workflow log');

  const continueReply = telegram.state.sentMessages.find((message) => message.reply_to_message_id === 722 && /这轮先做到这里，还没完全收口。/.test(message.text));
  assert.ok(continueReply);
  assert.match(continueReply.text, /这轮先做到这里，还没完全收口。/);
  assert.match(continueReply.text, /已完成部分：/);
  assert.match(continueReply.text, /改动文件：/);
  assert.match(continueReply.text, /已经继续跑完了。/);
  assert.match(continueReply.text, /建议下一步：/);
  assert.equal(telegram.state.reactions.length, 1);
  assert.doesNotMatch(stdout, /started workflow .* for update 322/);

  const resumedWorkflowState = JSON.parse(await readFile(path.join(cwd, '.opencodex', 'sessions', workflowId, 'artifacts', 'cto-workflow.json'), 'utf8'));
  assert.equal(resumedWorkflowState.latest_user_message, '继续。');
  assert.ok(resumedWorkflowState.tasks.some((task) => task.id === 'resume-work'));

  child.kill('SIGTERM');
  const exitCode = await waitForExit(child);
  assert.equal(exitCode, 0);
  assert.equal(stderr, '');
});

test('im telegram listen --cto starts a new workflow for a new directive instead of resuming a waiting workflow', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-im-telegram-cto-new-goal-'));
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

  await waitForCondition(() => telegram.state.sentMessages.some((message) => message.reply_to_message_id === 721 && /请确认是否继续修改本地仓库/.test(message.text)), 'confirmation reply');

  const originalWorkflow = await waitForCtoWorkflowStateBySourceMessageId(cwd, 721, 'original waiting workflow');
  const originalWorkflowId = originalWorkflow.sessionId;
  const originalWorkflowState = JSON.parse(await readFile(originalWorkflow.workflowPath, 'utf8'));
  assert.equal(originalWorkflowState.status, 'waiting_for_user');
  assert.ok(originalWorkflowState.pending_question_zh);

  telegram.state.updates.push({
    update_id: 322,
    message: {
      message_id: 722,
      date: 1741435451,
      text: '这样，帮我的电脑播放音乐。',
      chat: { id: 123456, type: 'private' },
      from: { id: 9001, first_name: 'Li', last_name: 'Jianqian', username: 'lijq' }
    }
  });

  await waitForCondition(() => telegram.state.sentMessages.some((message) => message.reply_to_message_id === 722 && /这轮已经处理完/.test(message.text)), 'new workflow final reply');
  await waitForCondition(() => stdout.includes('started workflow') && stdout.includes('update 322'), 'new workflow start log');
  const newWorkflow = await waitForCtoWorkflowStateBySourceMessageId(cwd, 722, 'new workflow');
  const newWorkflowId = newWorkflow.sessionId;
  assert.notEqual(newWorkflowId, originalWorkflowId);
  assert.match(stdout, /started workflow .* for update 322/);
  assert.doesNotMatch(stdout, /Continuing CTO workflow .* from update 322/);

  const preservedWorkflowState = JSON.parse(await readFile(originalWorkflow.workflowPath, 'utf8'));
  assert.equal(preservedWorkflowState.status, 'waiting_for_user');
  assert.equal(preservedWorkflowState.pending_question_zh, originalWorkflowState.pending_question_zh);

  const newWorkflowState = JSON.parse(await readFile(newWorkflow.workflowPath, 'utf8'));
  assert.equal(newWorkflowState.goal_text, '这样，帮我的电脑播放音乐。');
  assert.equal(newWorkflowState.latest_user_message, '这样，帮我的电脑播放音乐。');

  child.kill('SIGTERM');
  const exitCode = await waitForExit(child);
  assert.equal(exitCode, 0);
  assert.equal(stderr, '');
});

test('im telegram listen --cto keeps the first vague greeting in conversation mode instead of opening a workflow', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-im-telegram-cto-conversation-gate-'));
  const telegram = await startTelegramMockServer({
    updates: [
      {
        update_id: 501,
        message: {
          message_id: 901,
          date: 1741435600,
          text: '嘿，你在哪？',
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

  await waitForCondition(() => telegram.state.sentMessages.some((message) => message.reply_to_message_id === 901 && /我在，先不急着进入员工编排/.test(message.text)), 'conversation gate reply');
  assert.equal(telegram.state.reactions.length, 0);
  assert.doesNotMatch(stdout, /started workflow .* for update 501/);

  child.kill('SIGTERM');
  const exitCode = await waitForExit(child);
  assert.equal(exitCode, 0);
  assert.equal(stderr, '');

  const sessionIds = await readdir(path.join(cwd, '.opencodex', 'sessions'));
  assert.equal(sessionIds.length, 2);
  const imSessionId = sessionIds.find((id) => id.startsWith('im-'));
  assert.ok(imSessionId);
  const imSession = JSON.parse(await readFile(path.join(cwd, '.opencodex', 'sessions', imSessionId, 'session.json'), 'utf8'));
  assert.ok(imSession.child_sessions.some((entry) => entry.command === 'run'));
});

test('im telegram listen --cto keeps context-missing issue questions on the chat main line', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-im-telegram-cto-contextless-issue-'));
  const telegram = await startTelegramMockServer({
    updates: [
      {
        update_id: 521,
        message: {
          message_id: 921,
          date: 1741435601,
          text: '解释一下这个问题。。',
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

  await waitForCondition(() => telegram.state.sentMessages.some((message) => message.reply_to_message_id === 921 && /请把“这个问题”的具体内容发我/.test(message.text)), 'context-missing issue reply');
  assert.equal(telegram.state.reactions.length, 0);
  assert.doesNotMatch(stdout, /started workflow .* for update 521/);

  child.kill('SIGTERM');
  const exitCode = await waitForExit(child);
  assert.equal(exitCode, 0);
  assert.equal(stderr, '');

  const sessionIds = await readdir(path.join(cwd, '.opencodex', 'sessions'));
  assert.equal(sessionIds.length, 2);
  const imSessionId = sessionIds.find((id) => id.startsWith('im-'));
  assert.ok(imSessionId);
  const imSession = JSON.parse(await readFile(path.join(cwd, '.opencodex', 'sessions', imSessionId, 'session.json'), 'utf8'));
  assert.ok(imSession.child_sessions.some((entry) => entry.command === 'run' && /Direct reply/.test(entry.label)));
  assert.ok(imSession.child_sessions.every((entry) => entry.command !== 'cto'));
});

test('im telegram listen --cto keeps social small talk on the chat main line without spawning a workflow', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-im-telegram-cto-social-chat-'));
  const telegram = await startTelegramMockServer({
    updates: [
      {
        update_id: 551,
        message: {
          message_id: 951,
          date: 1741435602,
          text: '你吃晚餐了吗',
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

  await waitForCondition(() => telegram.state.sentMessages.some((message) => message.reply_to_message_id === 951 && /可以，我在。/.test(message.text)), 'social chat direct reply');
  await waitForCondition(() => stdout.includes('Handled CTO casual chat for update 551'), 'social chat log');
  assert.equal(telegram.state.reactions.length, 0);
  assert.doesNotMatch(stdout, /started workflow .* for update 551/);

  child.kill('SIGTERM');
  const exitCode = await waitForExit(child);
  assert.equal(exitCode, 0);
  assert.equal(stderr, '');

  const sessionIds = await readdir(path.join(cwd, '.opencodex', 'sessions'));
  assert.equal(sessionIds.length, 2);
  const imSessionId = sessionIds.find((id) => id.startsWith('im-'));
  assert.ok(imSessionId);
  const imSession = JSON.parse(await readFile(path.join(cwd, '.opencodex', 'sessions', imSessionId, 'session.json'), 'utf8'));
  assert.ok(imSession.child_sessions.some((entry) => entry.command === 'run' && /Direct reply/.test(entry.label)));
  assert.ok(imSession.child_sessions.some((entry) => entry.command === 'run' && entry.agent_name_zh));
  assert.ok(imSession.child_sessions.every((entry) => entry.command !== 'cto'));
});

test('im telegram listen --cto keeps praise-only feedback on the chat main line without spawning a workflow', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-im-telegram-cto-praise-chat-'));
  const telegram = await startTelegramMockServer({
    updates: [
      {
        update_id: 552,
        message: {
          message_id: 952,
          date: 1741435605,
          text: '你好厉害，居然能秒回。',
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

  await waitForCondition(() => telegram.state.sentMessages.some((message) => message.reply_to_message_id === 952 && /可以，我在。/.test(message.text)), 'praise direct reply');
  await waitForCondition(() => stdout.includes('Handled CTO casual chat for update 552'), 'praise chat log');
  assert.equal(telegram.state.reactions.length, 0);
  assert.doesNotMatch(stdout, /started workflow .* for update 552/);

  child.kill('SIGTERM');
  const exitCode = await waitForExit(child);
  assert.equal(exitCode, 0);
  assert.equal(stderr, '');

  const sessionIds = await readdir(path.join(cwd, '.opencodex', 'sessions'));
  assert.equal(sessionIds.length, 2);
  assert.ok(sessionIds.every((id) => !id.startsWith('cto-')));
});

test('im telegram listen --cto enters orchestration after a follow-up concrete request', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-im-telegram-cto-conversation-escalate-'));
  const telegram = await startTelegramMockServer({
    updates: [
      {
        update_id: 601,
        message: {
          message_id: 1001,
          date: 1741435600,
          text: '嘿，你在哪？',
          chat: { id: 123456, type: 'private' },
          from: { id: 9001, first_name: 'Li', last_name: 'Jianqian', username: 'lijq' }
        }
      },
      {
        update_id: 602,
        message: {
          message_id: 1002,
          date: 1741435601,
          text: '那你先检查一下 repo',
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
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });

  await waitForCondition(() => telegram.state.sentMessages.some((message) => message.reply_to_message_id === 1001 && /我在，先不急着进入员工编排/.test(message.text)), 'first conversation reply');
  await waitForCondition(() => telegram.state.reactions.length >= 1, 'workflow acknowledgement after follow-up');
  await waitForCondition(() => telegram.state.sentMessages.some((message) => message.reply_to_message_id === 1002 && /这轮已经处理完/.test(message.text)), 'workflow final reply after follow-up');
  await waitForCtoWorkflowStateBySourceMessageId(cwd, 1002, 'workflow after follow-up');

  assert.match(stdout, /started workflow .* for update 602/);
  assert.doesNotMatch(stdout, /started workflow .* for update 601/);

  child.kill('SIGTERM');
  await waitForExit(child);
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

  await waitForCondition(() => telegram.state.sentMessages.some((message) => message.reply_to_message_id === 731 && /当前没有可取消的 workflow/.test(message.text)), 'missing cancel reply');
  await waitForCondition(() => stdout.includes('Handled CTO workflow control for update 331'), 'missing cancel control log');

  assert.equal(telegram.state.reactions.length, 0);
  assert.equal(telegram.state.sentMessages.length, 1);
  assert.match(telegram.state.sentMessages[0].text, /当前没有可取消的 workflow/);
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
  await waitForCondition(() => telegram.state.sentMessages.length >= 2, 'parallel workflow replies');

  const finalSlowIndex = findMessageIndex(telegram.state.sentMessages, (message) => message.reply_to_message_id === 701 && /已经处理完了。/.test(message.text));
  const finalFastIndex = findMessageIndex(telegram.state.sentMessages, (message) => message.reply_to_message_id === 702 && /已经处理完了。/.test(message.text));

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
  assert.ok(finalSlowIndex >= 0);
  assert.ok(finalFastIndex >= 0);
  assert.ok(finalFastIndex < finalSlowIndex);

  child.kill('SIGTERM');
  await waitForExit(child);
});

test('im telegram listen --cto resumes a running workflow after listener restart', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-im-telegram-cto-restart-'));
  const telegram = await startTelegramMockServer({
    updates: []
  });
  t.after(async () => {
    await telegram.close();
  });

  await writeSessionFixture(cwd, {
    session_id: 'run-restart-slow',
    command: 'run',
    status: 'completed',
    created_at: '2026-03-12T08:00:00.000Z',
    updated_at: '2026-03-12T08:00:01.000Z',
    input: {
      prompt: 'Slow task',
      arguments: {
        profile: 'full-access'
      }
    },
    summary: {
      title: 'Mock slow task completed',
      result: 'The mock slow worker finished successfully.',
      status: 'completed',
      highlights: ['Slow mock task completed.'],
      next_steps: [],
      risks: [],
      validation: [],
      changed_files: ['src/mock-slow.js'],
      findings: []
    }
  });

  await writeSessionFixture(cwd, {
    session_id: 'cto-20260312-080000-restart',
    command: 'cto',
    status: 'running',
    created_at: '2026-03-12T08:00:00.000Z',
    updated_at: '2026-03-12T08:00:01.000Z',
    input: {
      prompt: 'restart chain',
      arguments: {
        provider: 'telegram',
        chat_id: '123456'
      }
    },
    child_sessions: [
      {
        session_id: 'run-restart-slow',
        label: 'Task slow-task · 阿岚',
        task_id: 'slow-task',
        session_contract: {
          schema: 'opencodex/session-contract/v1',
          layer: 'child',
          thread_kind: 'child_session',
          role: 'worker',
          scope: 'telegram_cto',
          supervisor_session_id: 'cto-20260312-080000-restart'
        }
      }
    ],
    summary: {
      title: 'CTO workflow running',
      result: 'Workflow is running with 1 active task(s).',
      status: 'running',
      highlights: [],
      next_steps: []
    }
  }, [
    {
      name: 'cto-workflow.json',
      type: 'cto_workflow',
      description: 'Telegram CTO workflow state and task graph.',
      json: {
        workflow_session_id: 'cto-20260312-080000-restart',
        source_message_id: 711,
        source_update_id: 311,
        chat_id: '123456',
        sender_display: 'Li Jianqian',
        goal_text: 'restart chain',
        status: 'running',
        pending_question_zh: '',
        created_at: '2026-03-12T08:00:00.000Z',
        updated_at: '2026-03-12T08:00:01.000Z',
        task_counter: 2,
        user_messages: [
          {
            provider: 'telegram',
            update_id: 311,
            message_id: 711,
            created_at: '2026-03-12T08:00:00.000Z',
            chat_id: '123456',
            sender_display: 'Li Jianqian',
            text: 'restart chain'
          }
        ],
        tasks: [
          {
            id: 'slow-task',
            title: 'Slow task',
            worker_prompt: 'MOCK_WORKER slow-500',
            depends_on: [],
            status: 'running',
            session_id: 'run-restart-slow',
            summary_status: '',
            result: '',
            next_steps: [],
            changed_files: [],
            updated_at: '2026-03-12T08:00:01.000Z'
          },
          {
            id: 'fast-task',
            title: 'Fast task',
            worker_prompt: 'MOCK_WORKER fast',
            depends_on: ['slow-task'],
            status: 'queued',
            session_id: '',
            summary_status: '',
            result: '',
            next_steps: [],
            changed_files: [],
            updated_at: '2026-03-12T08:00:01.000Z'
          }
        ]
      }
    }
  ]);

  const secondListener = spawn('node', [
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
    if (!secondListener.killed) {
      secondListener.kill('SIGTERM');
    }
  });

  let secondStdout = '';
  secondListener.stdout.on('data', (chunk) => {
    secondStdout += chunk.toString();
  });

  await waitForCondition(() => secondStdout.includes('Resuming CTO workflow cto-20260312-080000-restart after listener restart'), 'restart resume log');
  await waitForCondition(() => telegram.state.sentMessages.some((message) => message.reply_to_message_id === 711 && /已经处理完了。/.test(message.text)), 'restart final reply');

  const resumedWorkflow = await waitForCtoWorkflowState(cwd, (state) => String(state?.workflow_session_id || '') === 'cto-20260312-080000-restart' && state.status === 'completed', 'completed resumed workflow');
  assert.equal(resumedWorkflow.sessionId, 'cto-20260312-080000-restart');
  assert.deepEqual(resumedWorkflow.state.tasks.map((task) => task.status), ['completed', 'completed']);
  assert.ok(resumedWorkflow.state.tasks.every((task) => task.session_id));

  secondListener.kill('SIGTERM');
  await waitForExit(secondListener);
});

test('im telegram listen --cto resumes a planning workflow after listener restart once the planner session completes', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-im-telegram-cto-plan-restart-'));
  const telegram = await startTelegramMockServer({
    updates: []
  });
  t.after(async () => {
    await telegram.close();
  });

  await writeSessionFixture(cwd, {
    session_id: 'run-restart-planner',
    command: 'run',
    status: 'running',
    created_at: '2026-03-12T08:10:00.000Z',
    updated_at: '2026-03-12T08:10:01.000Z',
    input: {
      prompt: 'restart chain',
      arguments: {
        profile: 'safe'
      }
    },
    summary: {
      title: 'Planner running',
      result: 'Planner is still running.',
      status: 'running',
      highlights: [],
      next_steps: []
    }
  });

  await writeSessionFixture(cwd, {
    session_id: 'cto-20260312-081000-plan-restart',
    command: 'cto',
    status: 'running',
    created_at: '2026-03-12T08:10:00.000Z',
    updated_at: '2026-03-12T08:10:01.000Z',
    input: {
      prompt: 'restart chain',
      arguments: {
        provider: 'telegram',
        chat_id: '123456'
      }
    },
    child_sessions: [
      {
        session_id: 'run-restart-planner',
        label: 'Plan workflow 411 · 阿周',
        update_id: 411,
        session_contract: {
          schema: 'opencodex/session-contract/v1',
          layer: 'child',
          thread_kind: 'child_session',
          role: 'planner',
          scope: 'telegram_cto',
          supervisor_session_id: 'cto-20260312-081000-plan-restart'
        }
      }
    ],
    summary: {
      title: 'CTO workflow running',
      result: 'Workflow is still planning.',
      status: 'running',
      highlights: [],
      next_steps: []
    }
  }, [
    {
      name: 'cto-workflow.json',
      type: 'cto_workflow',
      description: 'Telegram CTO workflow state and task graph.',
      json: {
        workflow_session_id: 'cto-20260312-081000-plan-restart',
        source_message_id: 811,
        source_update_id: 411,
        chat_id: '123456',
        sender_display: 'Li Jianqian',
        goal_text: 'restart chain',
        latest_user_message: 'restart chain',
        status: 'planning',
        plan_mode: 'execute',
        plan_summary_zh: '',
        pending_question_zh: '',
        created_at: '2026-03-12T08:10:00.000Z',
        updated_at: '2026-03-12T08:10:01.000Z',
        task_counter: 0,
        user_messages: [
          {
            provider: 'telegram',
            update_id: 411,
            message_id: 811,
            created_at: '2026-03-12T08:10:00.000Z',
            chat_id: '123456',
            sender_display: 'Li Jianqian',
            text: 'restart chain'
          }
        ],
        tasks: []
      }
    }
  ]);

  const listener = spawn('node', [
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
    if (!listener.killed) {
      listener.kill('SIGTERM');
    }
  });

  let stdout = '';
  listener.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });

  await delay(150);
  await writeSessionFixture(cwd, {
    session_id: 'run-restart-planner',
    command: 'run',
    status: 'completed',
    created_at: '2026-03-12T08:10:00.000Z',
    updated_at: '2026-03-12T08:10:02.000Z',
    input: {
      prompt: 'restart chain',
      arguments: {
        profile: 'safe'
      }
    },
    summary: {
      title: 'Planner completed',
      result: 'Planner finished and returned a recoverable plan.',
      status: 'completed',
      highlights: [],
      next_steps: [],
      risks: [],
      validation: [],
      changed_files: [],
      findings: []
    }
  }, [
    {
      name: 'last-message.txt',
      type: 'last_message',
      description: 'Planner output for restart recovery.',
      text: `${JSON.stringify({
        mode: 'execute',
        summary_zh: '已拆分为可恢复的串行工作流。',
        question_zh: '',
        tasks: [
          {
            id: 'slow-task',
            title: 'Slow task',
            worker_prompt: 'MOCK_WORKER slow-500',
            depends_on: []
          },
          {
            id: 'fast-task',
            title: 'Fast task',
            worker_prompt: 'MOCK_WORKER fast',
            depends_on: ['slow-task']
          }
        ]
      }, null, 2)}\n`
    }
  ]);

  await waitForCondition(() => stdout.includes('Resuming CTO planning workflow cto-20260312-081000-plan-restart after listener restart'), 'planning restart resume log');
  await waitForCondition(() => telegram.state.sentMessages.some((message) => message.reply_to_message_id === 811 && /已经处理完了。/.test(message.text)), 'planning restart final reply');

  const resumedWorkflow = await waitForCtoWorkflowState(cwd, (state) => String(state?.workflow_session_id || '') === 'cto-20260312-081000-plan-restart' && state.status === 'completed', 'completed planning workflow');
  assert.equal(resumedWorkflow.sessionId, 'cto-20260312-081000-plan-restart');
  assert.deepEqual(resumedWorkflow.state.tasks.map((task) => task.status), ['completed', 'completed']);
  assert.deepEqual(resumedWorkflow.state.tasks.map((task) => task.id), ['slow-task', 'fast-task']);
  assert.ok(resumedWorkflow.state.tasks.every((task) => task.session_id));

  listener.kill('SIGTERM');
  await waitForExit(listener);
});

test('im telegram supervise resumes a rehydrated workflow without starting the polling listener', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-im-telegram-cto-supervise-'));
  const telegram = await startTelegramMockServer({
    updates: []
  });
  t.after(async () => {
    await telegram.close();
  });

  await writeSessionFixture(cwd, {
    session_id: 'run-supervise-slow',
    command: 'run',
    status: 'completed',
    created_at: '2026-03-12T08:20:00.000Z',
    updated_at: '2026-03-12T08:20:01.000Z',
    input: {
      prompt: 'Slow task',
      arguments: {
        profile: 'full-access'
      }
    },
    summary: {
      title: 'Mock slow task completed',
      result: 'The mock slow worker finished successfully.',
      status: 'completed',
      highlights: ['Slow mock task completed.'],
      next_steps: [],
      risks: [],
      validation: [],
      changed_files: ['src/mock-slow.js'],
      findings: []
    }
  });

  await writeSessionFixture(cwd, {
    session_id: 'cto-20260312-082000-supervise',
    command: 'cto',
    status: 'running',
    created_at: '2026-03-12T08:20:00.000Z',
    updated_at: '2026-03-12T08:20:01.000Z',
    input: {
      prompt: 'restart chain',
      arguments: {
        provider: 'telegram',
        chat_id: '123456'
      }
    },
    child_sessions: [
      {
        session_id: 'run-supervise-slow',
        label: 'Task slow-task · 阿岚',
        task_id: 'slow-task',
        session_contract: {
          schema: 'opencodex/session-contract/v1',
          layer: 'child',
          thread_kind: 'child_session',
          role: 'worker',
          scope: 'telegram_cto',
          supervisor_session_id: 'cto-20260312-082000-supervise'
        }
      }
    ],
    summary: {
      title: 'CTO workflow running',
      result: 'Workflow is running with 1 active task(s).',
      status: 'running',
      highlights: [],
      next_steps: []
    }
  }, [
    {
      name: 'cto-workflow.json',
      type: 'cto_workflow',
      description: 'Telegram CTO workflow state and task graph.',
      json: {
        workflow_session_id: 'cto-20260312-082000-supervise',
        source_message_id: 911,
        source_update_id: 511,
        chat_id: '123456',
        sender_display: 'Li Jianqian',
        goal_text: 'restart chain',
        status: 'running',
        pending_question_zh: '',
        created_at: '2026-03-12T08:20:00.000Z',
        updated_at: '2026-03-12T08:20:01.000Z',
        task_counter: 2,
        user_messages: [
          {
            provider: 'telegram',
            update_id: 511,
            message_id: 911,
            created_at: '2026-03-12T08:20:00.000Z',
            chat_id: '123456',
            sender_display: 'Li Jianqian',
            text: 'restart chain'
          }
        ],
        tasks: [
          {
            id: 'slow-task',
            title: 'Slow task',
            worker_prompt: 'MOCK_WORKER slow-500',
            depends_on: [],
            status: 'running',
            session_id: 'run-supervise-slow',
            summary_status: '',
            result: '',
            next_steps: [],
            changed_files: [],
            updated_at: '2026-03-12T08:20:01.000Z'
          },
          {
            id: 'fast-task',
            title: 'Fast task',
            worker_prompt: 'MOCK_WORKER fast',
            depends_on: ['slow-task'],
            status: 'queued',
            session_id: '',
            summary_status: '',
            result: '',
            next_steps: [],
            changed_files: [],
            updated_at: '2026-03-12T08:20:01.000Z'
          }
        ]
      }
    }
  ]);

  const result = await runCli([
    'im', 'telegram', 'supervise',
    '--cwd', cwd,
    '--bot-token', 'test-token',
    '--profile', 'full-access'
  ], {
    OPENCODEX_TELEGRAM_API_BASE_URL: telegram.baseUrl,
    OPENCODEX_CODEX_BIN: fixture
  });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Telegram supervisor tick started/);
  assert.match(result.stdout, /Telegram supervisor tick completed with no active rehydrated workflow remaining/);

  const resumedWorkflow = await waitForCtoWorkflowState(cwd, (state) => String(state?.workflow_session_id || '') === 'cto-20260312-082000-supervise' && state.status === 'completed', 'completed supervised workflow');
  assert.equal(resumedWorkflow.sessionId, 'cto-20260312-082000-supervise');
  assert.deepEqual(resumedWorkflow.state.tasks.map((task) => task.status), ['completed', 'completed']);
  assert.ok(resumedWorkflow.state.tasks.every((task) => task.session_id));
  assert.ok(telegram.state.sentMessages.some((message) => message.reply_to_message_id === 911 && /已经处理完了。/.test(message.text)));
});

test('im telegram supervise does not duplicate a rehydrated workflow when two supervisor ticks race', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-im-telegram-cto-supervise-race-'));
  const telegram = await startTelegramMockServer({
    updates: []
  });
  t.after(async () => {
    await telegram.close();
  });

  await writeSessionFixture(cwd, {
    session_id: 'run-race-first',
    command: 'run',
    status: 'completed',
    created_at: '2026-03-12T08:30:00.000Z',
    updated_at: '2026-03-12T08:30:01.000Z',
    input: {
      prompt: 'First task',
      arguments: {
        profile: 'full-access'
      }
    },
    summary: {
      title: 'First task completed',
      result: 'The first task already completed.',
      status: 'completed',
      highlights: [],
      next_steps: [],
      risks: [],
      validation: [],
      changed_files: ['src/mock-first.js'],
      findings: []
    }
  });

  await writeSessionFixture(cwd, {
    session_id: 'cto-20260312-083000-race',
    command: 'cto',
    status: 'running',
    created_at: '2026-03-12T08:30:00.000Z',
    updated_at: '2026-03-12T08:30:01.000Z',
    input: {
      prompt: 'race chain',
      arguments: {
        provider: 'telegram',
        chat_id: '123456'
      }
    },
    child_sessions: [
      {
        session_id: 'run-race-first',
        label: 'Task first-task · 阿岚',
        task_id: 'first-task',
        session_contract: {
          schema: 'opencodex/session-contract/v1',
          layer: 'child',
          thread_kind: 'child_session',
          role: 'worker',
          scope: 'telegram_cto',
          supervisor_session_id: 'cto-20260312-083000-race'
        }
      }
    ],
    summary: {
      title: 'CTO workflow running',
      result: 'Workflow is running with 1 active task(s).',
      status: 'running',
      highlights: [],
      next_steps: []
    }
  }, [
    {
      name: 'cto-workflow.json',
      type: 'cto_workflow',
      description: 'Telegram CTO workflow state and task graph.',
      json: {
        workflow_session_id: 'cto-20260312-083000-race',
        source_message_id: 921,
        source_update_id: 521,
        chat_id: '123456',
        sender_display: 'Li Jianqian',
        goal_text: 'race chain',
        status: 'running',
        pending_question_zh: '',
        created_at: '2026-03-12T08:30:00.000Z',
        updated_at: '2026-03-12T08:30:01.000Z',
        task_counter: 2,
        user_messages: [
          {
            provider: 'telegram',
            update_id: 521,
            message_id: 921,
            created_at: '2026-03-12T08:30:00.000Z',
            chat_id: '123456',
            sender_display: 'Li Jianqian',
            text: 'race chain'
          }
        ],
        tasks: [
          {
            id: 'first-task',
            title: 'First task',
            worker_prompt: 'MOCK_WORKER fast',
            depends_on: [],
            status: 'completed',
            session_id: 'run-race-first',
            summary_status: 'completed',
            result: 'The first task already completed.',
            next_steps: [],
            changed_files: ['src/mock-first.js'],
            updated_at: '2026-03-12T08:30:01.000Z'
          },
          {
            id: 'finish-task',
            title: 'Finish task',
            worker_prompt: 'MOCK_WORKER slow-500',
            depends_on: ['first-task'],
            status: 'queued',
            session_id: '',
            summary_status: '',
            result: '',
            next_steps: [],
            changed_files: [],
            updated_at: '2026-03-12T08:30:01.000Z'
          }
        ]
      }
    }
  ]);

  const sharedEnv = {
    OPENCODEX_TELEGRAM_API_BASE_URL: telegram.baseUrl,
    OPENCODEX_CODEX_BIN: fixture
  };

  const [firstResult, secondResult] = await Promise.all([
    runCli([
      'im', 'telegram', 'supervise',
      '--cwd', cwd,
      '--bot-token', 'test-token',
      '--profile', 'full-access'
    ], sharedEnv),
    runCli([
      'im', 'telegram', 'supervise',
      '--cwd', cwd,
      '--bot-token', 'test-token',
      '--profile', 'full-access'
    ], sharedEnv)
  ]);

  assert.equal(firstResult.code, 0);
  assert.equal(secondResult.code, 0);

  const completedReplies = telegram.state.sentMessages.filter((message) => message.reply_to_message_id === 921 && /已经处理完了。/.test(message.text));
  assert.equal(completedReplies.length, 1);

  const workflowRecord = await waitForCtoWorkflowState(cwd, (state) => String(state?.workflow_session_id || '') === 'cto-20260312-083000-race' && state.status === 'completed', 'completed raced workflow');
  assert.deepEqual(workflowRecord.state.tasks.map((task) => task.status), ['completed', 'completed']);

  const workflowSession = JSON.parse(await readFile(path.join(cwd, '.opencodex', 'sessions', 'cto-20260312-083000-race', 'session.json'), 'utf8'));
  const resumedChildren = (workflowSession.child_sessions || []).filter((entry) => entry.task_id === 'finish-task');
  assert.equal(resumedChildren.length, 1);
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
  await waitForCondition(() => telegram.state.sentMessages.some((message) => message.reply_to_message_id === 701 && /已经处理完了。/.test(message.text)), 'slow workflow completion');

  const workflow = await waitForCtoWorkflowStateBySourceMessageId(cwd, 701, 'slow workflow');

  assert.equal(telegram.state.reactions.length, 1);
  const secondReplies = telegram.state.sentMessages.filter((message) => message.reply_to_message_id === 702);
  assert.equal(secondReplies.length, 1);
  assert.match(secondReplies[0].text, /openCodex CTO 工作流汇报/);
  assert.ok(secondReplies[0].text.includes(`Workflow: ${workflow.sessionId}`));
  assert.doesNotMatch(secondReplies[0].text, /主线程已接管/);
  assert.doesNotMatch(secondReplies[0].text, /已完成任务拆解/);
  assert.match(stdout, /Reported CTO workflow status for update 302/);
  assert.doesNotMatch(stdout, /started workflow .* for update 302/);

  child.kill('SIGTERM');
  const exitCode = await waitForExit(child);
  assert.equal(exitCode, 0);
  assert.equal(stderr, '');
});

test('im telegram listen --cto binds colloquial completion follow-ups to the latest waiting workflow', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-im-telegram-cto-colloquial-status-'));
  const workflowId = 'cto-20260312-012756-0gcurj';
  const workflowDir = path.join(cwd, '.opencodex', 'sessions', workflowId);
  const workflowStatePath = path.join(workflowDir, 'artifacts', 'cto-workflow.json');
  const workflowState = {
    workflow_session_id: workflowId,
    provider: 'telegram',
    chat_id: '123456',
    source_update_id: 510,
    source_message_id: 910,
    sender_display: 'Li Jianqian',
    goal_text: '把这些输出的文档保存到下载文件夹中',
    latest_user_message: '把这些输出的文档保存到下载文件夹中',
    created_at: '2026-03-12T01:27:56.000Z',
    updated_at: '2026-03-12T01:28:16.000Z',
    status: 'waiting_for_user',
    plan_mode: 'execute',
    plan_summary_zh: '当前导出卡在宿主权限边界。',
    pending_question_zh: '当前复制到下载目录被当前环境拦住了，需要切到宿主环境继续导出。',
    task_counter: 1,
    tasks: [
      {
        id: 'export-downloads',
        title: 'Export documents to Downloads',
        worker_prompt: 'MOCK_WORKER export-downloads',
        depends_on: [],
        status: 'partial',
        session_id: 'run-export-1',
        summary_status: 'partial',
        result: '实际复制被当前只读沙箱拦住了。',
        next_steps: ['当前复制到下载目录被当前环境拦住了，需要切到宿主环境继续导出。'],
        changed_files: [],
        updated_at: '2026-03-12T01:28:16.000Z'
      }
    ],
    user_messages: [
      {
        update_id: 510,
        message_id: 910,
        text: '把这些输出的文档保存到下载文件夹中',
        created_at: '2026-03-12T01:27:56.000Z'
      }
    ]
  };
  const workflowSession = {
    session_id: workflowId,
    command: 'cto',
    status: 'partial',
    created_at: '2026-03-12T01:27:56.000Z',
    updated_at: '2026-03-12T01:28:16.000Z',
    working_directory: cwd,
    codex_cli_version: 'telegram-cto',
    input: {
      prompt: '把这些输出的文档保存到下载文件夹中',
      arguments: {
        provider: 'telegram',
        profile: 'full-access',
        update_id: 510,
        chat_id: '123456',
        sender: 'Li Jianqian'
      }
    },
    summary: {
      title: 'CTO workflow needs follow-up',
      result: '当前复制到下载目录被当前环境拦住了，需要切到宿主环境继续导出。',
      status: 'partial',
      highlights: [],
      next_steps: ['当前复制到下载目录被当前环境拦住了，需要切到宿主环境继续导出。']
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
        update_id: 511,
        message: {
          message_id: 911,
          date: 1741742900,
          text: '这个任务完成没有？',
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

  await waitForCondition(() => telegram.state.sentMessages.some((message) => message.reply_to_message_id === 911 && /工作流汇报/.test(message.text)), 'colloquial status reply');
  await waitForCondition(() => stdout.includes('Reported CTO workflow status for update 511'), 'colloquial status log');

  assert.equal(telegram.state.reactions.length, 0);
  assert.equal(telegram.state.sentMessages.length, 1);
  assert.match(telegram.state.sentMessages[0].text, /openCodex CTO 工作流汇报/);
  assert.match(telegram.state.sentMessages[0].text, new RegExp(`Workflow: ${workflowId}`));
  assert.match(telegram.state.sentMessages[0].text, /waiting_for_user（等待 CEO 确认）/);
  assert.match(telegram.state.sentMessages[0].text, /待确认：当前复制到下载目录被当前环境拦住了，需要切到宿主环境继续导出。/);
  assert.doesNotMatch(stdout, /started workflow .* for update 511/);
  assert.doesNotMatch(stdout, /Continuing CTO workflow .* from update 511/);

  child.kill('SIGTERM');
  const exitCode = await waitForExit(child);
  assert.equal(exitCode, 0);
  assert.equal(stderr, '');

  const sessionIds = await readdir(path.join(cwd, '.opencodex', 'sessions'));
  assert.equal(sessionIds.length, 2);
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
  await waitForCondition(() => telegram.state.sentMessages.length >= 1, 'inferred-audit final reply');

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
  assert.match(telegram.state.sentMessages[0].text, /The mock Codex binary executed successfully\./);
  assert.doesNotMatch(telegram.state.sentMessages[0].text, /需要你确认下一步/);
  assert.doesNotMatch(telegram.state.sentMessages[0].text, /openCodex CTO|Workflow:/);

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

test('im telegram listen --cto fails closed on stricter host sandbox without leaving the workflow waiting', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-im-telegram-cto-host-sandbox-'));
  const telegram = await startTelegramMockServer({
    updates: [
      {
        update_id: 451,
        message: {
          message_id: 851,
          date: 1741435510,
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
      OPENCODEX_CODEX_BIN: fixture,
      OPENCODEX_HOST_SANDBOX_MODE: 'read-only'
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

  await waitForCondition(() => telegram.state.reactions.length >= 1, 'sandbox acknowledgement');
  await waitForCondition(() => telegram.state.sentMessages.some((message) => message.reply_to_message_id === 851 && /read-only/.test(message.text)), 'sandbox final reply');

  const workflow = await waitForCtoWorkflowStateBySourceMessageId(cwd, 851, 'sandbox workflow');

  const finalReply = telegram.state.sentMessages.find((message) => message.reply_to_message_id === 851 && /read-only/.test(message.text));
  assert.ok(finalReply);
  assert.match(finalReply.text, /read-only/);
  assert.doesNotMatch(finalReply.text, /待确认/);
  assert.match(stdout, /task inspect-repo finished with failed|finished with status failed/);

  const workflowState = JSON.parse(await readFile(workflow.workflowPath, 'utf8'));
  assert.equal(workflowState.status, 'failed');
  assert.equal(workflowState.pending_question_zh, '');

  child.kill('SIGTERM');
  const exitCode = await waitForExit(child);
  assert.equal(exitCode, 0);
  assert.equal(stderr, '');
});


test('im telegram listen --cto reroutes host-sandbox-blocked work into the host executor queue and finishes automatically', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-im-telegram-cto-reroute-'));
  const serviceStateDir = path.join(cwd, '.service-state');
  const telegram = await startTelegramMockServer({
    updates: [
      {
        update_id: 452,
        message: {
          message_id: 852,
          date: 1741435511,
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
      OPENCODEX_CODEX_BIN: fixture,
      OPENCODEX_HOST_SANDBOX_MODE: 'read-only',
      OPENCODEX_HOST_EXECUTOR_ENABLED: '1',
      OPENCODEX_SERVICE_STATE_DIR: serviceStateDir,
      OPENCODEX_HOST_EXECUTOR_SANDBOX_MODE: 'danger-full-access'
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

  await waitForCondition(() => telegram.state.reactions.length >= 1, 'reroute acknowledgement');
  await waitForCondition(() => telegram.state.sentMessages.some((message) => message.reply_to_message_id === 852 && /宿主执行器/.test(message.text)), 'reroute interim reply');
  await waitForCondition(() => telegram.state.sentMessages.some((message) => message.reply_to_message_id === 852 && /已经处理完，结果也整理好了。/.test(message.text)), 'reroute final reply');

  const workflow = await waitForCtoWorkflowStateBySourceMessageId(cwd, 852, 'reroute workflow');

  assert.match(stdout, /rerouted work to the host executor/);
  assert.match(stdout, /Host executor claimed/);

  const workflowState = JSON.parse(await readFile(workflow.workflowPath, 'utf8'));
  assert.equal(workflowState.status, 'completed');
  assert.ok(workflowState.tasks.every((task) => task.status === 'completed'));

  const jobsDir = path.join(serviceStateDir, 'host-executor', 'jobs');
  await waitForCondition(async () => {
    try {
      const entries = await readdir(jobsDir);
      return entries.length >= 2;
    } catch {
      return false;
    }
  }, 'host executor job files');
  const jobFiles = await readdir(jobsDir);
  assert.equal(jobFiles.length, 2);
  const jobPayloads = await Promise.all(jobFiles.map((entry) => readFile(path.join(jobsDir, entry), 'utf8').then((content) => JSON.parse(content))));
  assert.ok(jobPayloads.every((job) => job.status === 'completed'));

  child.kill('SIGTERM');
  const exitCode = await waitForExit(child);
  assert.equal(exitCode, 0);
  assert.equal(stderr, '');
});

test('im telegram listen --cto reroutes partial sandbox-blocked export tasks into the host executor queue', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-im-telegram-cto-partial-reroute-'));
  const serviceStateDir = path.join(cwd, '.service-state');
  const telegram = await startTelegramMockServer({
    updates: [
      {
        update_id: 453,
        message: {
          message_id: 853,
          date: 1741435512,
          text: '把这些输出的文档保存到下载文件夹中',
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
      OPENCODEX_CODEX_BIN: fixture,
      OPENCODEX_HOST_EXECUTOR_ENABLED: '1',
      OPENCODEX_SERVICE_STATE_DIR: serviceStateDir,
      OPENCODEX_HOST_EXECUTOR_SANDBOX_MODE: 'danger-full-access'
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

  await waitForCondition(() => telegram.state.reactions.length >= 1, 'partial reroute acknowledgement');
  await waitForCondition(() => telegram.state.sentMessages.some((message) => message.reply_to_message_id === 853 && /宿主执行器/.test(message.text)), 'partial reroute interim reply');
  await waitForCondition(() => telegram.state.sentMessages.some((message) => message.reply_to_message_id === 853 && /这轮已经处理完了。/.test(message.text)), 'partial reroute final reply');

  const workflow = await waitForCtoWorkflowStateBySourceMessageId(cwd, 853, 'partial reroute workflow');

  assert.match(stdout, /rerouted work to the host executor/);
  assert.match(stdout, /Host executor claimed/);

  const workflowState = JSON.parse(await readFile(workflow.workflowPath, 'utf8'));
  assert.equal(workflowState.status, 'completed');
  assert.equal(workflowState.tasks.length, 1);
  assert.equal(workflowState.tasks[0].id, 'export-downloads');
  assert.equal(workflowState.tasks[0].status, 'completed');
  assert.match(telegram.state.sentMessages.at(-1).text, /mock-report\.md/);

  const jobsDir = path.join(serviceStateDir, 'host-executor', 'jobs');
  await waitForCondition(async () => {
    try {
      const entries = await readdir(jobsDir);
      return entries.length >= 1;
    } catch {
      return false;
    }
  }, 'partial reroute job files');
  const jobFiles = await readdir(jobsDir);
  assert.ok(jobFiles.length >= 1);
  const jobPayloads = await Promise.all(jobFiles.map((entry) => readFile(path.join(jobsDir, entry), 'utf8').then((content) => JSON.parse(content))));
  assert.ok(jobPayloads.every((job) => job.status === 'completed'));

  child.kill('SIGTERM');
  const exitCode = await waitForExit(child);
  assert.equal(exitCode, 0);
  assert.equal(stderr, '');
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
  assert.match(telegram.state.sentMessages[0].text, /这轮先停一下，等你拍板/);
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

async function waitForCtoWorkflowStateBySourceMessageId(cwd, sourceMessageId, label) {
  return waitForCtoWorkflowState(
    cwd,
    (state) => String(state?.source_message_id || '') === String(sourceMessageId),
    label
  );
}

async function waitForCtoWorkflowState(cwd, predicate, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5000) {
    const records = await readCtoWorkflowStates(cwd);
    const match = records.find(({ state }) => predicate(state));
    if (match) {
      return match;
    }
    await delay(25);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function readCtoWorkflowStates(cwd) {
  const sessionsRoot = path.join(cwd, '.opencodex', 'sessions');
  let sessionIds = [];
  try {
    sessionIds = await readdir(sessionsRoot);
  } catch {
    return [];
  }

  const records = [];
  for (const sessionId of sessionIds) {
    if (!sessionId.startsWith('cto-')) {
      continue;
    }
    const workflowPath = path.join(sessionsRoot, sessionId, 'artifacts', 'cto-workflow.json');
    try {
      const state = JSON.parse(await readFile(workflowPath, 'utf8'));
      records.push({ sessionId, state, workflowPath });
    } catch {
      // ignore incomplete or unrelated session entries
    }
  }
  return records;
}

async function writeSessionFixture(cwd, session, artifactFiles = []) {
  const sessionDir = path.join(cwd, '.opencodex', 'sessions', session.session_id);
  const artifactsDir = path.join(sessionDir, 'artifacts');
  await mkdir(artifactsDir, { recursive: true });

  const artifacts = Array.isArray(session.artifacts) ? [...session.artifacts] : [];
  for (const artifactFile of artifactFiles) {
    const artifactPath = path.join(artifactsDir, artifactFile.name);
    await mkdir(path.dirname(artifactPath), { recursive: true });
    const content = Object.hasOwn(artifactFile, 'json')
      ? `${JSON.stringify(artifactFile.json, null, 2)}\n`
      : String(artifactFile.text || '');
    await writeFile(artifactPath, content, 'utf8');
    if (artifactFile.type) {
      artifacts.push({
        type: artifactFile.type,
        path: artifactPath,
        description: artifactFile.description || ''
      });
    }
  }

  const normalizedSession = {
    session_id: session.session_id,
    command: session.command,
    status: session.status,
    created_at: session.created_at,
    updated_at: session.updated_at,
    working_directory: cwd,
    codex_cli_version: 'test',
    input: session.input || { prompt: '', arguments: {} },
    summary: session.summary || {
      title: `${session.command} ${session.status}`,
      result: session.status,
      status: session.status,
      highlights: [],
      next_steps: []
    },
    artifacts,
    ...(session.parent_session_id ? { parent_session_id: session.parent_session_id } : {}),
    ...(Array.isArray(session.child_sessions) ? { child_sessions: session.child_sessions } : {})
  };

  await writeFile(path.join(sessionDir, 'session.json'), `${JSON.stringify(normalizedSession, null, 2)}\n`, 'utf8');
}

function extractSessionId(stdout) {
  const imMatches = [...stdout.matchAll(/Session:\s+(im-[^\s]+)/g)];
  if (imMatches.length) {
    return imMatches.at(-1)?.[1] || '';
  }
  const match = stdout.match(/Session:\s+([^\s]+)/);
  return match ? match[1] : '';
}

function findMessageIndex(messages, predicate) {
  return messages.findIndex(predicate);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
