import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const cli = path.resolve('bin/opencodex.js');

test('remote serve accepts token-authenticated mobile messages and stores them in a session artifact', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-remote-'));
  const token = 'test-remote-token';
  const child = spawn('node', [cli, 'remote', 'serve', '--cwd', cwd, '--host', '127.0.0.1', '--port', '0', '--token', token], {
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

  const port = await waitForPort(() => extractPort(stdout));
  const sessionId = await waitForSessionId(() => extractSessionId(stdout));

  const unauthorized = await fetch(`http://127.0.0.1:${port}/api/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'missing token' })
  });
  assert.equal(unauthorized.status, 401);

  const accepted = await fetch(`http://127.0.0.1:${port}/api/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, sender: 'phone', text: 'Ship the remote bridge first.' })
  });
  assert.equal(accepted.status, 200);
  const acceptedPayload = await accepted.json();
  assert.equal(acceptedPayload.ok, true);
  assert.ok(acceptedPayload.message_id);

  const inboxResponse = await fetch(`http://127.0.0.1:${port}/api/messages?token=${token}`);
  assert.equal(inboxResponse.status, 200);
  const inboxPayload = await inboxResponse.json();
  assert.equal(inboxPayload.count, 1);
  assert.equal(inboxPayload.messages[0].text, 'Ship the remote bridge first.');

  child.kill('SIGTERM');
  const exitCode = await waitForExit(child);
  assert.equal(exitCode, 0);
  assert.equal(stderr, '');
  assert.match(stdout, /Remote bridge started/);
  assert.match(stdout, /Remote bridge stopped/);

  const session = JSON.parse(await readFile(path.join(cwd, '.opencodex', 'sessions', sessionId, 'session.json'), 'utf8'));
  assert.equal(session.command, 'remote');
  assert.equal(session.status, 'completed');
  assert.match(session.summary.result, /Stopped by SIGTERM/i);
  assert.ok(session.artifacts.some((artifact) => artifact.type === 'messages_log'));

  const messagesLogPath = session.artifacts.find((artifact) => artifact.type === 'messages_log').path;
  const messagesLog = await readFile(messagesLogPath, 'utf8');
  assert.match(messagesLog, /Ship the remote bridge first\./);
});

test('remote inbox returns the latest received messages in json mode', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-remote-inbox-'));
  const sessionId = 'remote-20260308-inbox';
  const sessionDir = path.join(cwd, '.opencodex', 'sessions', sessionId);
  const artifactsDir = path.join(sessionDir, 'artifacts');
  const messagesPath = path.join(artifactsDir, 'messages.jsonl');

  await mkdir(artifactsDir, { recursive: true });
  await writeFile(path.join(sessionDir, 'session.json'), `${JSON.stringify({
    session_id: sessionId,
    command: 'remote',
    status: 'completed',
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:01:00.000Z',
    working_directory: cwd,
    codex_cli_version: 'embedded-http',
    input: { prompt: '', arguments: { host: '0.0.0.0', port: 3789, auth: 'token', token_configured: true } },
    summary: { title: 'Remote bridge completed', result: 'ok', status: 'completed', highlights: [], next_steps: [], findings: [] },
    artifacts: [{ type: 'messages_log', path: messagesPath, description: 'Remote messages received by the mobile bridge.' }]
  }, null, 2)}\n`, 'utf8');
  await writeFile(messagesPath, [
    JSON.stringify({ message_id: 'msg-1', created_at: '2026-03-08T00:00:10.000Z', sender: 'phone', text: 'first' }),
    JSON.stringify({ message_id: 'msg-2', created_at: '2026-03-08T00:00:20.000Z', sender: 'phone', text: 'second' })
  ].join('\n') + '\n', 'utf8');

  const result = await runCli(['remote', 'inbox', '--cwd', cwd, '--limit', '1', '--json']);
  assert.equal(result.code, 0);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.session_id, sessionId);
  assert.equal(payload.count, 1);
  assert.equal(payload.messages[0].text, 'second');
});

test('remote status returns deployment checks and troubleshooting hints in json mode', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-remote-status-'));
  const sessionId = 'remote-20260318-status';
  const sessionDir = path.join(cwd, '.opencodex', 'sessions', sessionId);
  const artifactsDir = path.join(sessionDir, 'artifacts');
  const messagesPath = path.join(artifactsDir, 'messages.jsonl');

  await mkdir(artifactsDir, { recursive: true });
  await writeFile(path.join(sessionDir, 'session.json'), `${JSON.stringify({
    session_id: sessionId,
    command: 'remote',
    status: 'running',
    created_at: '2026-03-18T00:00:00.000Z',
    updated_at: '2026-03-18T00:01:00.000Z',
    working_directory: cwd,
    codex_cli_version: 'embedded-http',
    input: { prompt: '', arguments: { host: '0.0.0.0', port: 3789, auth: 'token', token_configured: true } },
    summary: { title: 'Remote bridge running', result: 'ok', status: 'running', highlights: [], next_steps: [], findings: [] },
    artifacts: [{ type: 'messages_log', path: messagesPath, description: 'Remote messages received by the mobile bridge.' }]
  }, null, 2)}\n`, 'utf8');
  await writeFile(messagesPath, [
    JSON.stringify({ message_id: 'msg-1', created_at: '2026-03-18T00:00:10.000Z', sender: 'phone', text: 'first' }),
    JSON.stringify({ message_id: 'msg-2', created_at: '2026-03-18T00:00:20.000Z', sender: 'phone', text: 'second' })
  ].join('\n') + '\n', 'utf8');

  const result = await runCli(['remote', 'status', '--cwd', cwd, '--json']);
  assert.equal(result.code, 0);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.session_id, sessionId);
  assert.equal(payload.status, 'running');
  assert.equal(payload.host, '0.0.0.0');
  assert.equal(payload.port, 3789);
  assert.equal(payload.exposure.mode, 'network_wide');
  assert.equal(payload.message_count, 2);
  assert.equal(payload.latest_message.text, 'second');
  assert.equal(payload.health_probe.attempted, true);
  assert.equal(payload.health_probe.ok, false);
  assert.equal(payload.health_probe.url, 'http://127.0.0.1:3789/health');
  assert.ok(Number.isFinite(payload.health_probe.duration_ms));
  assert.match(payload.health_probe.probed_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(payload.urls.some((url) => url.includes(':3789')));
  assert.ok(payload.warnings.some((line) => line.includes('all interfaces')));
  assert.ok(payload.warnings.some((line) => line.includes('Health probe failed')));
  assert.ok(payload.success_checks.some((line) => line.includes('/health')));
  assert.ok(payload.common_failures.some((line) => line.includes('Unauthorized')));
});

test('remote status text output includes health probe latency metadata', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-remote-status-text-'));
  const sessionId = 'remote-20260318-status-text';
  const sessionDir = path.join(cwd, '.opencodex', 'sessions', sessionId);
  const artifactsDir = path.join(sessionDir, 'artifacts');
  const messagesPath = path.join(artifactsDir, 'messages.jsonl');

  await mkdir(artifactsDir, { recursive: true });
  await writeFile(path.join(sessionDir, 'session.json'), `${JSON.stringify({
    session_id: sessionId,
    command: 'remote',
    status: 'running',
    created_at: '2026-03-18T00:00:00.000Z',
    updated_at: '2026-03-18T00:01:00.000Z',
    working_directory: cwd,
    codex_cli_version: 'embedded-http',
    input: { prompt: '', arguments: { host: '0.0.0.0', port: 3789, auth: 'token', token_configured: true } },
    summary: { title: 'Remote bridge running', result: 'ok', status: 'running', highlights: [], next_steps: [], findings: [] },
    artifacts: [{ type: 'messages_log', path: messagesPath, description: 'Remote messages received by the mobile bridge.' }]
  }, null, 2)}\n`, 'utf8');
  await writeFile(messagesPath, [
    JSON.stringify({ message_id: 'msg-1', created_at: '2026-03-18T00:00:10.000Z', sender: 'phone', text: 'first' })
  ].join('\n') + '\n', 'utf8');

  const result = await runCli(['remote', 'status', '--cwd', cwd]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Health probe: failed/);
  assert.match(result.stdout, /latency: \d+ ms at \d{4}-\d{2}-\d{2}T/);
});

test('remote status probes health successfully while remote serve is running', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-remote-status-live-'));
  const token = 'test-remote-status-live-token';
  const child = spawn('node', [cli, 'remote', 'serve', '--cwd', cwd, '--host', '127.0.0.1', '--port', '0', '--token', token], {
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

  const port = await waitForPort(() => extractPort(stdout));
  const status = await runCli(['remote', 'status', '--cwd', cwd, '--json']);
  assert.equal(status.code, 0);
  const payload = JSON.parse(status.stdout);
  assert.equal(payload.status, 'running');
  assert.equal(payload.port, port);
  assert.equal(payload.health_probe.attempted, true);
  assert.equal(payload.health_probe.ok, true);
  assert.ok(Number.isFinite(payload.health_probe.duration_ms));
  assert.match(payload.health_probe.probed_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(payload.health_probe.status_code, 200);
  assert.equal(payload.health_probe.response_ok, true);
  assert.equal(payload.health_probe.url, `http://127.0.0.1:${port}/health`);

  child.kill('SIGTERM');
  const exitCode = await waitForExit(child);
  assert.equal(exitCode, 0);
  assert.equal(stderr, '');
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

async function waitForPort(readValue) {
  return waitForValue(readValue, 'remote port');
}

async function waitForSessionId(readValue) {
  return waitForValue(readValue, 'remote session id');
}

async function waitForValue(readValue, label) {
  const start = Date.now();
  while (Date.now() - start < 5000) {
    const value = readValue();
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function extractPort(stdout) {
  const match = stdout.match(/Port:\s+(\d+)/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function extractSessionId(stdout) {
  const match = stdout.match(/Session:\s+([^\s]+)/);
  return match ? match[1] : '';
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code));
  });
}
