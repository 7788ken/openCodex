import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const fixture = path.resolve('tests/fixtures/mock-codex.js');
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
  assert.equal(payload.codex.version, 'codex-cli 0.111.0');
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
