import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { chmod, mkdtemp, readFile, realpath } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const fixture = path.resolve('tests/fixtures/mock-codex.js');
const liveFixture = path.resolve('tests/fixtures/mock-codex-live.js');
const cli = path.resolve('bin/opencodex.js');

test('bridge status reports a missing bridge state and the current Codex candidate', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-bridge-status-'));
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'opencodex-bridge-home-status-'));
  const result = await runCli(['bridge', 'status', '--json', '--cwd', cwd], {
    OPENCODEX_CODEX_BIN: fixture,
    HOME: homeDir
  });

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.registered, false);
  assert.equal(payload.state_path, path.join(homeDir, '.opencodex', 'bridge', 'bridge.json'));
  assert.equal(payload.detected_codex?.resolved_path, fixture);
  assert.equal(payload.detected_codex?.valid, true);
  assert.match((payload.next_steps || []).join('\n'), /register-codex/);
});

test('bridge register-codex writes a global bridge state under HOME', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-bridge-register-'));
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'opencodex-bridge-home-register-'));
  const result = await runCli(['bridge', 'register-codex', '--path', fixture, '--json', '--cwd', cwd], {
    HOME: homeDir
  });

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.registered, true);
  assert.equal(payload.codex.path, fixture);
  assert.equal(payload.codex.resolved_path, fixture);
  assert.equal(payload.codex.source, 'manual_register');
  assert.equal(payload.codex.version, 'codex-cli 0.116.0');
  assert.equal(payload.bridge.default_surface, 'cli');

  const statePath = path.join(homeDir, '.opencodex', 'bridge', 'bridge.json');
  const stored = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(stored.schema, 'opencodex/bridge-state/v1');
  assert.equal(stored.codex.path, fixture);
  assert.equal(stored.codex.resolved_path, fixture);
  assert.equal(stored.codex.source, 'manual_register');
  assert.equal(stored.bridge.default_surface, 'cli');

  const status = await runCli(['bridge', 'status', '--json', '--cwd', cwd], {
    HOME: homeDir
  });
  assert.equal(status.code, 0);
  const statusPayload = JSON.parse(status.stdout);
  assert.equal(statusPayload.registered, true);
  assert.equal(statusPayload.codex_valid, true);
  assert.equal(statusPayload.codex.resolved_path, fixture);
});

test('bridge install-shim writes a transparent codex shim and preserves PATH habit', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-bridge-install-shim-'));
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'opencodex-bridge-home-install-shim-'));
  const binDir = path.join(homeDir, '.local', 'bin');

  const register = await runCli(['bridge', 'register-codex', '--path', fixture, '--json', '--cwd', cwd], {
    HOME: homeDir
  });
  assert.equal(register.code, 0);

  const install = await runCli(['bridge', 'install-shim', '--bin-dir', binDir, '--json', '--cwd', cwd], {
    HOME: homeDir
  });
  assert.equal(install.code, 0);

  const payload = JSON.parse(install.stdout);
  assert.equal(payload.shim.exists, true);
  assert.equal(payload.shim.valid, true);
  assert.equal(payload.shim.path, path.join(binDir, 'codex'));
  assert.equal(payload.bridge.shim_path, path.join(binDir, 'codex'));

  const shimText = await readFile(path.join(binDir, 'codex'), 'utf8');
  assert.match(shimText, /openCodex codex bridge shim/);
  assert.match(shimText, /bridge exec-codex/);

  const shimResult = await runCommand(path.join(binDir, 'codex'), ['--version'], {
    HOME: homeDir,
    PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`
  });
  assert.equal(shimResult.code, 0);
  assert.match(shimResult.stdout, /codex-cli 0\.116\.0/);

  const status = await runCli(['bridge', 'status', '--bin-dir', binDir, '--json', '--cwd', cwd], {
    HOME: homeDir,
    PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`
  });
  assert.equal(status.code, 0);
  const statusPayload = JSON.parse(status.stdout);
  assert.equal(statusPayload.shim.exists, true);
  assert.equal(statusPayload.shim.valid, true);
  assert.equal(statusPayload.shim.path_precedence, 'bridge_shim');
  assert.equal(statusPayload.shim.path_command.resolved_path, await realpath(path.join(binDir, 'codex')));
});

test('bridge exec-codex records and clears a bridge-owned live session', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-bridge-live-'));
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'opencodex-bridge-home-live-'));

  await chmod(liveFixture, 0o755);

  const register = await runCli(['bridge', 'register-codex', '--path', liveFixture, '--json', '--cwd', cwd], {
    HOME: homeDir
  });
  assert.equal(register.code, 0);

  const liveRun = spawnCli(['bridge', 'exec-codex', '--version'], {
    HOME: homeDir,
    OPENCODEX_MOCK_CODEX_DELAY_MS: '800'
  }, { cwd });

  const activeStatusPayload = await waitFor(async () => {
    const status = await runCli(['bridge', 'status', '--json', '--cwd', cwd], {
      HOME: homeDir
    });
    const payload = JSON.parse(status.stdout);
    return payload?.active_session?.session_id ? payload : null;
  });

  assert.ok(activeStatusPayload);
  const activeSessionId = activeStatusPayload.active_session.session_id;
  assert.equal(activeStatusPayload.active_session.status, 'running');
  assert.equal(activeStatusPayload.active_session.record_found, true);
  assert.equal(activeStatusPayload.active_session.command, '--version');

  const liveResult = await liveRun.result;
  assert.equal(liveResult.code, 0);
  assert.match(liveResult.stdout, /codex-cli 0\.222\.0/);

  const finalStatus = await runCli(['bridge', 'status', '--json', '--cwd', cwd], {
    HOME: homeDir
  });
  assert.equal(finalStatus.code, 0);
  const finalStatusPayload = JSON.parse(finalStatus.stdout);
  assert.equal(finalStatusPayload.active_session, null);

  const sessionPath = path.join(cwd, '.opencodex', 'sessions', activeSessionId, 'session.json');
  const eventsPath = path.join(cwd, '.opencodex', 'sessions', activeSessionId, 'events.jsonl');
  const runtimePath = path.join(cwd, '.opencodex', 'sessions', activeSessionId, 'artifacts', 'bridge-runtime.json');
  const sessionPayload = JSON.parse(await readFile(sessionPath, 'utf8'));
  const runtimePayload = JSON.parse(await readFile(runtimePath, 'utf8'));
  const eventsText = await readFile(eventsPath, 'utf8');

  assert.equal(sessionPayload.command, 'bridge');
  assert.equal(sessionPayload.status, 'completed');
  assert.equal(sessionPayload.session_contract?.role, 'bridge_supervisor');
  assert.equal(runtimePayload.status, 'completed');
  assert.equal(runtimePayload.real_codex_path, liveFixture);
  assert.match(eventsText, /bridge\.session\.started/);
  assert.match(eventsText, /bridge\.session\.exited/);
});

test('bridge send injects external input into the active live session and bridge inbox reports delivery', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-bridge-send-'));
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'opencodex-bridge-home-send-'));

  await chmod(liveFixture, 0o755);

  const register = await runCli(['bridge', 'register-codex', '--path', liveFixture, '--json', '--cwd', cwd], {
    HOME: homeDir
  });
  assert.equal(register.code, 0);

  const liveRun = spawnCli(['bridge', 'exec-codex', '--bridge-stdin'], {
    HOME: homeDir
  }, { cwd });

  const activeStatusPayload = await waitFor(async () => {
    const status = await runCli(['bridge', 'status', '--json', '--cwd', cwd], {
      HOME: homeDir
    });
    const payload = JSON.parse(status.stdout);
    return payload?.active_session?.session_id ? payload : null;
  }, { attempts: 80, delayMs: 50 });

  const activeSessionId = activeStatusPayload.active_session.session_id;
  assert.equal(activeStatusPayload.active_session.status, 'running');

  const send = await runCli(['bridge', 'send', '--cwd', cwd, 'continue from tg'], {
    HOME: homeDir
  });
  assert.equal(send.code, 0);
  assert.match(send.stdout, /Bridge message delivered/);
  assert.match(send.stdout, /Text: continue from tg/);

  const liveResult = await liveRun.result;
  assert.equal(liveResult.code, 0);
  assert.match(liveResult.stdout, /mock bridge stdin ready/);
  assert.match(liveResult.stdout, /received: continue from tg/);

  const inbox = await runCli(['bridge', 'inbox', '--cwd', cwd, '--session-id', activeSessionId, '--json'], {
    HOME: homeDir
  });
  assert.equal(inbox.code, 0);
  const inboxPayload = JSON.parse(inbox.stdout);
  assert.equal(inboxPayload.session_id, activeSessionId);
  assert.equal(inboxPayload.count, 1);
  assert.equal(inboxPayload.messages[0].text, 'continue from tg');
  assert.ok(inboxPayload.messages[0].delivered_at);

  const tail = await runCli(['bridge', 'tail', '--cwd', cwd, '--session-id', activeSessionId, '--json'], {
    HOME: homeDir
  });
  assert.equal(tail.code, 0);
  const tailPayload = JSON.parse(tail.stdout);
  assert.equal(tailPayload.session_id, activeSessionId);
  assert.ok(tailPayload.lines.some((line) => line.includes('mock bridge stdin ready')));
  assert.ok(tailPayload.lines.some((line) => line.includes('received: continue from tg')));

  const runtimePath = path.join(cwd, '.opencodex', 'sessions', activeSessionId, 'artifacts', 'bridge-runtime.json');
  const controlEventsPath = path.join(cwd, '.opencodex', 'sessions', activeSessionId, 'artifacts', 'bridge-control-events.jsonl');
  const outputLogPath = path.join(cwd, '.opencodex', 'sessions', activeSessionId, 'artifacts', 'bridge-output.log');
  const runtimePayload = JSON.parse(await readFile(runtimePath, 'utf8'));
  const controlEventsText = await readFile(controlEventsPath, 'utf8');
  const outputLogText = await readFile(outputLogPath, 'utf8');

  assert.match(runtimePayload.transport, /_inbox$/);
  assert.match(controlEventsText, /bridge\.inbox\.delivered/);
  assert.match(outputLogText, /received: continue from tg/);
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

function runCommand(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
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

function spawnCli(args, extraEnv = {}, options = {}) {
  const child = spawn('node', [cli, ...args], {
    cwd: options.cwd,
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

  return {
    child,
    result: new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    })
  };
}

async function waitFor(check, { attempts = 30, delayMs = 25 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const result = await check();
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(delayMs);
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error('Timed out waiting for bridge state.');
}
