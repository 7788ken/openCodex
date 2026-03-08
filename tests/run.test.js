import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const fixture = path.resolve('tests/fixtures/mock-codex.js');
const cli = path.resolve('bin/opencodex.js');

test('run stores a normalized session from mock codex output', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-run-'));
  const result = await runCli(['run', '--cwd', cwd, 'draft', 'a', 'summary'], {
    OPENCODEX_CODEX_BIN: fixture
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Mock run completed/);

  const sessionsRoot = path.join(cwd, '.opencodex', 'sessions');
  const sessionIds = await readdir(sessionsRoot);
  assert.equal(sessionIds.length, 1);

  const session = JSON.parse(await readFile(path.join(sessionsRoot, sessionIds[0], 'session.json'), 'utf8'));
  assert.equal(session.command, 'run');
  assert.equal(session.summary.status, 'completed');
  assert.equal(session.summary.title, 'Mock run completed');
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
