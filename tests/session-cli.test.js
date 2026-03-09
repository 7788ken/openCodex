import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const cli = path.resolve('bin/opencodex.js');

test('session latest returns the most recent session in json mode', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-session-'));
  const olderId = 'run-20260308-000000-older';
  const newerId = 'review-20260308-000100-newer';

  await writeSession(cwd, olderId, '2026-03-08T00:00:00.000Z', 'run');
  await writeSession(cwd, newerId, '2026-03-08T00:01:00.000Z', 'review');

  const result = await runCli(['session', 'latest', '--json', '--cwd', cwd]);
  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.session_id, newerId);
  assert.equal(payload.command, 'review');
});

test('session tree resolves the full tree from a child session id', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-session-tree-'));
  const rootId = 'auto-20260308-000000-root';
  const childId = 'run-20260308-000100-child';
  const grandchildId = 'review-20260308-000200-grandchild';

  await writeSession(cwd, rootId, '2026-03-08T00:00:00.000Z', 'auto');
  await writeSession(cwd, childId, '2026-03-08T00:01:00.000Z', 'run', 'completed', { parent_session_id: rootId });
  await writeSession(cwd, grandchildId, '2026-03-08T00:02:00.000Z', 'review', 'completed', { parent_session_id: childId });

  const result = await runCli(['session', 'tree', grandchildId, '--json', '--cwd', cwd]);
  assert.equal(result.code, 0);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.session_id, rootId);
  assert.equal(payload.children.length, 1);
  assert.equal(payload.children[0].session_id, childId);
  assert.equal(payload.children[0].children.length, 1);
  assert.equal(payload.children[0].children[0].session_id, grandchildId);
});

test('session tree can infer the parent from child_sessions fallback links', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-session-tree-'));
  const rootId = 'auto-20260308-000000-root';
  const childId = 'run-20260308-000100-child';

  await writeSession(cwd, rootId, '2026-03-08T00:00:00.000Z', 'auto', 'completed', {
    child_sessions: [{ session_id: childId, command: 'run', status: 'completed' }]
  });
  await writeSession(cwd, childId, '2026-03-08T00:01:00.000Z', 'run');

  const result = await runCli(['session', 'tree', childId, '--json', '--cwd', cwd]);
  assert.equal(result.code, 0);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.session_id, rootId);
  assert.equal(payload.children.length, 1);
  assert.equal(payload.children[0].session_id, childId);
  assert.equal(payload.children[0].parent_session_id, rootId);
});

test('session repair backfills stale failed sessions from terminal events', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-session-repair-'));
  const sessionId = 'run-20260308-000000-stale';
  await writeSession(cwd, sessionId, '2026-03-08T00:00:00.000Z', 'run', 'running');

  const sessionDir = path.join(cwd, '.opencodex', 'sessions', sessionId);
  await writeFile(path.join(sessionDir, 'events.jsonl'), [
    JSON.stringify({ type: 'thread.started' }),
    JSON.stringify({ type: 'error', message: 'stream disconnected before completion' }),
    JSON.stringify({ type: 'turn.failed', error: { message: 'stream disconnected before completion' } })
  ].join('\n'));

  const result = await runCli(['session', 'repair', '--json', '--cwd', cwd, '--stale-minutes', '1']);
  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.repaired_count, 1);
  assert.equal(payload.repaired_sessions[0].to, 'failed');

  const repaired = JSON.parse(await readFile(path.join(sessionDir, 'session.json'), 'utf8'));
  assert.equal(repaired.status, 'failed');
  assert.match(repaired.summary.result, /stream disconnected/);
});


test('session repair keeps turn.failed diagnostics even without separate error events', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-session-repair-turn-failed-'));
  const sessionId = 'run-20260308-000000-turn-failed';
  await writeSession(cwd, sessionId, '2026-03-08T00:00:00.000Z', 'run', 'running');

  const sessionDir = path.join(cwd, '.opencodex', 'sessions', sessionId);
  await writeFile(path.join(sessionDir, 'events.jsonl'), [
    JSON.stringify({ type: 'thread.started' }),
    JSON.stringify({ type: 'turn.failed', message: 'run wrapper crashed before saving state' })
  ].join('\n'));

  const result = await runCli(['session', 'repair', '--json', '--cwd', cwd, '--stale-minutes', '1']);
  assert.equal(result.code, 0);

  const repaired = JSON.parse(await readFile(path.join(sessionDir, 'session.json'), 'utf8'));
  assert.equal(repaired.status, 'failed');
  assert.match(repaired.summary.result, /run wrapper crashed before saving state/);
});
test('session repair does not rewrite stale queued sessions without terminal events', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-session-repair-'));
  const sessionId = 'run-20260308-000000-queued';
  await writeSession(cwd, sessionId, '2026-03-08T00:00:00.000Z', 'run', 'queued');

  const sessionDir = path.join(cwd, '.opencodex', 'sessions', sessionId);
  await writeFile(path.join(sessionDir, 'events.jsonl'), JSON.stringify({ type: 'thread.started' }));

  const before = JSON.parse(await readFile(path.join(sessionDir, 'session.json'), 'utf8'));
  const result = await runCli(['session', 'repair', '--json', '--cwd', cwd, '--stale-minutes', '1']);
  assert.equal(result.code, 0);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.repaired_count, 0);
  assert.deepEqual(payload.repaired_sessions, []);

  const after = JSON.parse(await readFile(path.join(sessionDir, 'session.json'), 'utf8'));
  assert.equal(after.status, 'queued');
  assert.equal(after.updated_at, before.updated_at);
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
