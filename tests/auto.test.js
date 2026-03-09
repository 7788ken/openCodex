import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const fixture = path.resolve('tests/fixtures/mock-codex.js');
const loopFixture = path.resolve('tests/fixtures/mock-codex-auto-loop.js');
const plainReviewFixture = path.resolve('tests/fixtures/mock-codex-auto-plain-review.js');
const retryFixture = path.resolve('tests/fixtures/mock-codex-auto-retry.js');
const cli = path.resolve('bin/opencodex.js');

test('auto runs repair, run, and review in one unattended workflow', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-auto-'));
  const result = await runCli(['auto', '--review', '--cwd', cwd, 'draft', 'a', 'summary'], {
    OPENCODEX_CODEX_BIN: fixture
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Auto workflow started/);
  assert.match(result.stdout, /==> Repair stale sessions/);
  assert.match(result.stdout, /==> Run main task/);
  assert.match(result.stdout, /Mock run completed/);
  assert.match(result.stdout, /==> Run repository review/);
  assert.match(result.stdout, /Review completed/);
  assert.match(result.stdout, /Auto partial/);

  const sessions = await loadSessions(cwd);
  const commands = sessions.map((session) => session.command).sort();
  assert.deepEqual(commands, ['auto', 'review', 'run']);

  const autoSession = sessions.find((session) => session.command === 'auto');
  const childSessions = sessions.filter((session) => session.command !== 'auto');
  assert.equal(autoSession.summary.status, 'partial');
  assert.equal(autoSession.child_sessions.length, 2);
  assert.ok(autoSession.artifacts.some((artifact) => artifact.type === 'step_output'));
  for (const child of childSessions) {
    assert.equal(child.parent_session_id, autoSession.session_id);
  }
});

test('auto treats non-clean plain-text review output as a remaining finding', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-auto-plain-review-'));
  const result = await runCli(['auto', '--review', '--cwd', cwd, 'stabilize', 'this', 'repo'], {
    OPENCODEX_CODEX_BIN: plainReviewFixture
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Auto partial/);
  assert.doesNotMatch(result.stdout, /no remaining review findings/i);

  const sessions = await loadSessions(cwd);
  const autoSession = sessions.find((session) => session.command === 'auto');
  assert.ok(autoSession);
  assert.equal(autoSession.summary.status, 'partial');
  assert.deepEqual(autoSession.summary.findings, ['There is still a blocking workflow regression to fix before this change is safe.']);
});

test('auto can continue for multiple iterations until review findings clear', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-auto-loop-'));
  const result = await runCli(['auto', '--review', '--max-iterations', '2', '--cwd', cwd, 'stabilize', 'this', 'repo'], {
    OPENCODEX_CODEX_BIN: loopFixture
  });

  assert.equal(result.code, 0);
  assert.equal(countMatches(result.stdout, /==> Run main task/g), 2);
  assert.equal(countMatches(result.stdout, /==> Run repository review/g), 2);
  assert.match(result.stdout, /Auto completed/);
  assert.match(result.stdout, /no remaining review findings/i);

  const sessions = await loadSessions(cwd);
  const autoSession = sessions.find((session) => session.command === 'auto');
  assert.ok(autoSession);
  assert.equal(autoSession.summary.status, 'completed');
  assert.equal(autoSession.child_sessions.length, 4);
  assert.equal(autoSession.summary.findings.length, 0);
  assert.equal(sessions.length, 5);
  for (const child of sessions.filter((session) => session.command !== 'auto')) {
    assert.equal(child.parent_session_id, autoSession.session_id);
  }
});

test('auto can fail the parent workflow when findings remain and fail-on-review is set', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-auto-fail-review-'));
  const result = await runCli(['auto', '--review', '--fail-on-review', '--cwd', cwd, 'draft', 'a', 'summary'], {
    OPENCODEX_CODEX_BIN: fixture
  });

  assert.equal(result.code, 1);
  assert.match(result.stdout, /Auto failed/);
  assert.match(result.stdout, /remaining review finding/);

  const sessions = await loadSessions(cwd);
  const autoSession = sessions.find((session) => session.command === 'auto');
  assert.ok(autoSession);
  assert.equal(autoSession.summary.status, 'failed');
  assert.equal(autoSession.summary.findings.length, 1);
});

test('auto retries failed runs when run retries are enabled', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-auto-retry-'));
  const result = await runCli(['auto', '--run-retries', '1', '--cwd', cwd, 'recover', 'the', 'run'], {
    OPENCODEX_CODEX_BIN: retryFixture
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Retrying run after failure/);
  assert.doesNotMatch(result.stdout, /running -> failed/);
  assert.match(result.stdout, /Recovered run completed/);
  assert.match(result.stdout, /Auto completed/);
  assert.equal(countMatches(result.stdout, /No stale sessions required repair\./g), 2);

  const sessions = await loadSessions(cwd);
  const autoSession = sessions.find((session) => session.command === 'auto');
  const runSessions = sessions.filter((session) => session.command === 'run').sort((left, right) => left.created_at.localeCompare(right.created_at));

  assert.ok(autoSession);
  assert.equal(autoSession.summary.status, 'completed');
  assert.equal(autoSession.child_sessions.length, 2);
  assert.equal(runSessions.length, 2);
  assert.equal(runSessions[0].status, 'failed');
  assert.equal(runSessions[1].status, 'completed');
  assert.equal(runSessions[0].auto_attempt, 1);
  assert.equal(runSessions[1].auto_attempt, 2);
  assert.equal(runSessions[0].parent_session_id, autoSession.session_id);
  assert.equal(runSessions[1].parent_session_id, autoSession.session_id);
  assert.equal(runSessions[0].auto_iteration, 1);
  assert.equal(runSessions[1].auto_iteration, 1);
});

test('auto retry repair immediately repairs fresh stale sessions', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-auto-retry-repair-'));
  const staleSessionId = 'run-20260308-fresh-stale';
  const staleSessionDir = path.join(cwd, '.opencodex', 'sessions', staleSessionId);
  await mkdir(staleSessionDir, { recursive: true });
  await writeFile(path.join(staleSessionDir, 'session.json'), `${JSON.stringify({
    session_id: staleSessionId,
    command: 'run',
    status: 'running',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    working_directory: cwd,
    codex_cli_version: 'codex-cli 0.111.0',
    input: { prompt: 'recover the run', arguments: {} },
    summary: { title: 'Run running', result: 'started', status: 'running', highlights: [], next_steps: [], risks: [], validation: [], changed_files: [], findings: [] },
    artifacts: []
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(staleSessionDir, 'events.jsonl'), `${JSON.stringify({ type: 'turn.failed', message: 'fresh stale run crashed' })}\n`, 'utf8');

  const result = await runCli(['auto', '--run-retries', '1', '--cwd', cwd, 'recover', 'the', 'run'], {
    OPENCODEX_CODEX_BIN: retryFixture
  });

  assert.equal(result.code, 0);

  const sessions = await loadSessions(cwd);
  const repairedStale = sessions.find((session) => session.session_id === staleSessionId);
  assert.ok(repairedStale);
  assert.equal(repairedStale.status, 'failed');
  assert.match(repairedStale.summary.result, /previous Codex run failed|fresh stale run crashed/i);
});

test('auto can resume the latest partial auto session into a new parent workflow', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-auto-resume-'));
  const firstResult = await runCli(['auto', '--review', '--cwd', cwd, 'draft', 'a', 'summary'], {
    OPENCODEX_CODEX_BIN: loopFixture
  });

  assert.equal(firstResult.code, 0);
  assert.match(firstResult.stdout, /Auto partial/);

  const resumeResult = await runCli(['auto', '--resume', 'latest', '--max-iterations', '2', '--cwd', cwd], {
    OPENCODEX_CODEX_BIN: loopFixture
  });

  assert.equal(resumeResult.code, 0);
  assert.equal(countMatches(resumeResult.stdout, /==> Run main task/g), 1);
  assert.equal(countMatches(resumeResult.stdout, /==> Run repository review/g), 1);
  assert.match(resumeResult.stdout, /Auto completed/);

  const sessions = await loadSessions(cwd);
  const autoSessions = sessions
    .filter((session) => session.command === 'auto')
    .sort((left, right) => left.created_at.localeCompare(right.created_at));

  assert.equal(autoSessions.length, 2);

  const [originalAuto, resumedAuto] = autoSessions;
  assert.equal(originalAuto.summary.status, 'partial');
  assert.equal(resumedAuto.parent_session_id, originalAuto.session_id);
  assert.equal(resumedAuto.summary.status, 'completed');
  assert.equal(resumedAuto.input.prompt, originalAuto.input.prompt);
  assert.ok(resumedAuto.artifacts.some((artifact) => artifact.type === 'resumed_from_session'));

  const resumedChildren = sessions
    .filter((session) => session.parent_session_id === resumedAuto.session_id)
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
  assert.equal(resumedChildren.length, 2);
  assert.equal(resumedAuto.iteration_count, 2);
  assert.deepEqual(resumedChildren.map((child) => child.auto_iteration), [2, 2]);
  for (const child of resumedChildren) {
    assert.notEqual(child.session_id, originalAuto.session_id);
  }
});


test('auto rejects conflicting review target selectors', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-auto-conflicting-review-target-'));
  const result = await runCli(['auto', '--base', 'origin/main', '--commit', 'HEAD~1', '--cwd', cwd, 'stabilize', 'this', 'repo'], {
    OPENCODEX_CODEX_BIN: fixture
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /accepts only one review target selector: --uncommitted, --base, or --commit/);
});


test('auto resume keeps carried findings when max iteration budget is already exhausted', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-auto-resume-budget-exhausted-'));
  const firstResult = await runCli(['auto', '--review', '--cwd', cwd, 'draft', 'a', 'summary'], {
    OPENCODEX_CODEX_BIN: plainReviewFixture
  });

  assert.equal(firstResult.code, 0);
  assert.match(firstResult.stdout, /Auto partial/);

  const resumeResult = await runCli(['auto', '--resume', 'latest', '--max-iterations', '1', '--cwd', cwd], {
    OPENCODEX_CODEX_BIN: loopFixture
  });

  assert.equal(resumeResult.code, 0);
  assert.equal(countMatches(resumeResult.stdout, /==> Run main task/g), 0);
  assert.match(resumeResult.stdout, /Auto partial/);

  const sessions = await loadSessions(cwd);
  const autoSessions = sessions
    .filter((session) => session.command === 'auto')
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
  const resumedAuto = autoSessions.at(-1);

  assert.equal(resumedAuto.summary.status, 'partial');
  assert.equal(resumedAuto.iteration_count, 1);
  assert.equal(resumedAuto.child_sessions.length, 0);
  assert.deepEqual(resumedAuto.summary.findings, ['There is still a blocking workflow regression to fix before this change is safe.']);
});


test('auto rejects resume latest when the latest resumable session has no stored prompt', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-auto-resume-missing-prompt-'));
  const sessionId = 'auto-20260308-missing-prompt';
  const sessionDir = path.join(cwd, '.opencodex', 'sessions', sessionId);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(path.join(sessionDir, 'session.json'), `${JSON.stringify({
    session_id: sessionId,
    command: 'auto',
    status: 'partial',
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    working_directory: cwd,
    codex_cli_version: 'delegated',
    input: { arguments: { review: true, 'max-iterations': 2, 'run-retries': 0 } },
    summary: { title: 'Auto partial', result: 'waiting', status: 'partial', highlights: [], next_steps: [], findings: ['One issue remains.'] },
    artifacts: [],
    child_sessions: [],
    iteration_count: 1
  }, null, 2)}\n`, 'utf8');

  const result = await runCli(['auto', '--resume', 'latest', '--cwd', cwd], {
    OPENCODEX_CODEX_BIN: loopFixture
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Cannot resume auto session without a stored prompt/);

  const sessions = await loadSessions(cwd);
  assert.equal(sessions.filter((session) => session.command === 'auto').length, 1);
});
test('auto rejects resume for completed auto sessions', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-auto-resume-completed-'));
  const firstResult = await runCli(['auto', '--cwd', cwd, 'stabilize', 'this', 'repo'], {
    OPENCODEX_CODEX_BIN: fixture
  });

  assert.equal(firstResult.code, 0);
  assert.match(firstResult.stdout, /Auto completed/);

  const sessionsBeforeResume = await loadSessions(cwd);
  const completedAuto = sessionsBeforeResume.find((session) => session.command === 'auto');

  const resumeResult = await runCli(['auto', '--resume', completedAuto.session_id, '--cwd', cwd], {
    OPENCODEX_CODEX_BIN: fixture
  });

  assert.equal(resumeResult.code, 1);
  assert.match(resumeResult.stderr, /only supports `auto` sessions with status `partial` or `failed`/);

  const sessionsAfterResume = await loadSessions(cwd);
  assert.equal(sessionsAfterResume.filter((session) => session.command === 'auto').length, 1);
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

async function loadSessions(cwd) {
  const sessionsRoot = path.join(cwd, '.opencodex', 'sessions');
  const sessionIds = await readdir(sessionsRoot);
  return Promise.all(sessionIds.map(async (sessionId) => JSON.parse(await readFile(path.join(sessionsRoot, sessionId, 'session.json'), 'utf8'))));
}

function countMatches(text, pattern) {
  return [...text.matchAll(pattern)].length;
}
