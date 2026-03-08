import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const fixture = path.resolve('tests/fixtures/mock-codex.js');
const cli = path.resolve('bin/opencodex.js');

test('doctor emits structured json with passing core checks', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-doctor-'));
  const result = await runCli(['doctor', '--json', '--cwd', cwd], {
    OPENCODEX_CODEX_BIN: fixture
  });

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.summary.status, 'partial');
  assert.ok(payload.checks.some((check) => check.name === 'codex_cli' && check.status === 'pass'));
  assert.ok(payload.checks.some((check) => check.name === 'codex_login' && check.status === 'pass'));
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
