import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
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

test('run fails fast with a precise host sandbox diagnostic when the host is stricter than the requested profile', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-run-host-sandbox-'));
  const result = await runCli(['run', '--cwd', cwd, '--profile', 'full-access', 'apply', 'the', 'patch'], {
    OPENCODEX_CODEX_BIN: fixture,
    OPENCODEX_HOST_SANDBOX_MODE: 'read-only'
  });

  assert.equal(result.code, 1);
  assert.match(result.stdout, /Run blocked by host sandbox/);
  assert.match(result.stdout, /read-only/);

  const sessionsRoot = path.join(cwd, '.opencodex', 'sessions');
  const sessionIds = await readdir(sessionsRoot);
  assert.equal(sessionIds.length, 1);

  const session = JSON.parse(await readFile(path.join(sessionsRoot, sessionIds[0], 'session.json'), 'utf8'));
  assert.equal(session.summary.status, 'failed');
  assert.match(session.summary.result, /不能从子任务内部突破更严格的外层沙箱/);
  assert.equal(session.input.arguments.requested_sandbox_mode, 'danger-full-access');
  assert.equal(session.input.arguments.host_sandbox_mode, 'read-only');
});

test('run keeps a completed structured summary even when the assistant mentions sandbox modes in analysis', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-run-sandbox-analysis-'));
  const successFixture = await writeSandboxMentioningSuccessFixture(path.join(cwd, 'mock-codex-sandbox-success.js'));
  const result = await runCli(['run', '--cwd', cwd, '--profile', 'full-access', 'audit', 'permissions'], {
    OPENCODEX_CODEX_BIN: successFixture
  });

  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stdout, /Run blocked by host sandbox/);

  const sessionsRoot = path.join(cwd, '.opencodex', 'sessions');
  const sessionIds = await readdir(sessionsRoot);
  assert.equal(sessionIds.length, 1);

  const session = JSON.parse(await readFile(path.join(sessionsRoot, sessionIds[0], 'session.json'), 'utf8'));
  assert.equal(session.summary.status, 'completed');
  assert.equal(session.summary.title, 'Permission audit completed');
  assert.match(session.summary.result, /sandbox: workspace-write/i);
  assert.equal(session.input.arguments.effective_sandbox_mode, '');
});
test('run preserves structured event errors when codex fails before writing last-message', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-run-error-'));
  const failingFixture = await writeEventFailingFixture(path.join(cwd, 'mock-codex-event-fail.js'));
  const result = await runCli(['run', '--cwd', cwd, 'trigger', 'error'], {
    OPENCODEX_CODEX_BIN: failingFixture
  });

  assert.equal(result.code, 1);
  assert.match(result.stdout, /Invalid schema for response_format 'codex_output_schema'/);

  const sessionsRoot = path.join(cwd, '.opencodex', 'sessions');
  const sessionIds = await readdir(sessionsRoot);
  assert.equal(sessionIds.length, 1);

  const session = JSON.parse(await readFile(path.join(sessionsRoot, sessionIds[0], 'session.json'), 'utf8'));
  assert.equal(session.summary.status, 'failed');
  assert.match(session.summary.result, /Invalid schema for response_format 'codex_output_schema'/);
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


async function writeSandboxMentioningSuccessFixture(filePath) {
  const source = `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';

const rawArgs = process.argv.slice(2);
const args = stripGlobalArgs(rawArgs);

if (rawArgs[0] === '--version') {
  console.log('codex-cli 0.112.0');
  process.exit(0);
}

if (args[0] === 'exec') {
  const lastMessageIndex = args.indexOf('--output-last-message');
  const lastMessagePath = lastMessageIndex >= 0 ? args[lastMessageIndex + 1] : null;
  if (lastMessagePath) {
    writeFileSync(lastMessagePath, JSON.stringify({
      title: 'Permission audit completed',
      result: 'Permission audit completed successfully. Observed sandbox: workspace-write. The policy still maps full-access to danger-full-access.',
      status: 'completed',
      highlights: ['Captured the current sandbox profile mapping.'],
      next_steps: [],
      risks: [],
      validation: [],
      changed_files: [],
      findings: []
    }, null, 2));
  }

  console.log(JSON.stringify({ type: 'event', message: 'mock execution event' }));
  process.exit(0);
}

console.error('Unsupported mock codex invocation');
process.exit(1);

function stripGlobalArgs(argv) {
  const result = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '-a' || token === '-s' || token === '-c') {
      index += 1;
      continue;
    }
    result.push(token);
  }
  return result;
}
`;
  await writeFile(filePath, source, { mode: 0o755 });
  return filePath;
}

async function writeEventFailingFixture(filePath) {
  const source = `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';

const rawArgs = process.argv.slice(2);
const args = stripGlobalArgs(rawArgs);

if (rawArgs[0] === '--version') {
  console.log('codex-cli 0.111.0');
  process.exit(0);
}

if (args[0] === 'exec') {
  const lastMessageIndex = args.indexOf('--output-last-message');
  const lastMessagePath = lastMessageIndex >= 0 ? args[lastMessageIndex + 1] : null;
  if (lastMessagePath) {
    writeFileSync(lastMessagePath, '');
  }

  const payload = JSON.stringify({
    error: {
      message: "Invalid schema for response_format 'codex_output_schema': In context=('properties', 'findings', 'items'), schema must have a 'type' key.",
      type: 'invalid_request_error',
      param: 'text.format.schema',
      code: 'invalid_json_schema'
    }
  }, null, 2);

  console.log(JSON.stringify({ type: 'thread.started', thread_id: 'test-thread' }));
  console.log(JSON.stringify({ type: 'turn.started' }));
  console.log(JSON.stringify({ type: 'error', message: payload }));
  console.log(JSON.stringify({ type: 'turn.failed', error: { message: payload } }));
  console.error('Warning: no last agent message; wrote empty content to nowhere');
  process.exit(1);
}

console.error('Unsupported mock codex invocation');
process.exit(1);

function stripGlobalArgs(argv) {
  const result = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '-a' || token === '-s' || token === '-c') {
      index += 1;
      continue;
    }
    result.push(token);
  }
  return result;
}
`;
  await writeFile(filePath, source, { mode: 0o755 });
  return filePath;
}
