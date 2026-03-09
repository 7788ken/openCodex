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
      { label: 'run', iteration: 1, command: 'run', session_id: runSessionId, status: 'completed' },
      { label: 'review', iteration: 1, command: 'review', session_id: reviewSessionId, status: 'completed' }
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
