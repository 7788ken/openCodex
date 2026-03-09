import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { chmod, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { buildReviewArgs, buildReviewSummary, extractReviewBody } from '../src/commands/review.js';

const fixture = path.resolve('tests/fixtures/mock-codex.js');
const reviewFixture = path.resolve('tests/fixtures/review-report.txt');
const cli = path.resolve('bin/opencodex.js');

test('extractReviewBody keeps the final codex section when present', () => {
  const text = [
    'OpenAI Codex v0.111.0',
    'thinking',
    'something',
    'codex',
    'The patch introduces a regression.',
    '- Fix the schema path.'
  ].join('\n');

  assert.equal(extractReviewBody(text), 'The patch introduces a regression.\n- Fix the schema path.');
});

test('buildReviewArgs rejects conflicting target selectors', () => {
  assert.throws(
    () => buildReviewArgs('focus on risks', { uncommitted: true, base: 'origin/main' }),
    /accepts only one target selector/
  );
});

test('buildReviewSummary falls back to a string finding for non-clean plain-text review output', () => {
  const summary = buildReviewSummary([
    'codex',
    'There is still a blocking workflow regression to fix before this change is safe.'
  ].join('\n'), '', 0, 'codex-cli 0.111.0', { uncommitted: true });

  assert.equal(summary.result, 'There is still a blocking workflow regression to fix before this change is safe.');
  assert.deepEqual(summary.findings, ['There is still a blocking workflow regression to fix before this change is safe.']);
  assert.match(summary.highlights.at(-1), /blocking workflow regression/);
});

test('buildReviewSummary keeps explicit clean plain-text review output finding-free', () => {
  const summary = buildReviewSummary([
    'codex',
    'No blocking issues remain after the second unattended pass.'
  ].join('\n'), '', 0, 'codex-cli 0.111.0', { uncommitted: true });

  assert.deepEqual(summary.findings, []);
});

test('buildReviewSummary preserves mixed positive plain-text review output as a finding', () => {
  const summary = buildReviewSummary([
    'codex',
    'Looks good overall, but one blocking issue remains'
  ].join('\n'), '', 0, 'codex-cli 0.111.0', { uncommitted: true });

  assert.equal(summary.result, 'Looks good overall, but one blocking issue remains');
  assert.deepEqual(summary.findings, ['Looks good overall, but one blocking issue remains']);
});

test('buildReviewSummary returns structured findings from a saved review report fixture', async () => {
  const report = await readFile(reviewFixture, 'utf8');
  const summary = buildReviewSummary(report, '', 0, 'codex-cli 0.111.0', { uncommitted: true });

  assert.equal(summary.title, 'Review completed');
  assert.equal(summary.status, 'completed');
  assert.equal(summary.result, 'The patch introduces a user-facing regression in `opencodex run`: the default schema path is resolved from the caller\'s working directory, so the command breaks outside this repository. It also narrows the structured-output schema in a way that drops previously supported summary fields.');
  assert.match(summary.highlights[0], /Target: uncommitted changes/);
  assert.equal(summary.findings.length, 2);
  assert.deepEqual(summary.findings[0], {
    priority: 'P1',
    title: 'Resolve the bundled run schema relative to the package, not CWD',
    location: {
      path: '/Users/lijianqian/svn/tools/openCodex/src/commands/run.js',
      start_line: 17,
      end_line: 17
    },
    detail: 'When `--schema` is omitted, `DEFAULT_SCHEMA_PATH` now points to `path.resolve(\'schemas\', \'run-summary.schema.json\')`, which resolves against the user\'s current working directory. In the normal case where `opencodex` is run inside some other repository (or installed globally), that file does not exist there, so `codex exec --output-schema ...` fails for every `opencodex run` unless the caller manually supplies `--schema`.'
  });
  assert.deepEqual(summary.findings[1], {
    priority: 'P2',
    title: 'Keep optional summary fields in the run output schema',
    location: {
      path: '/Users/lijianqian/svn/tools/openCodex/src/lib/summary.js',
      start_line: 17,
      end_line: 20
    },
    detail: 'The checked-in schema and `createDefaultRunSchema()` no longer allow `risks`, `validation`, `changed_files`, or `findings`, while `normalizeSummary()` still preserves those fields when Codex returns them. Because `opencodex run` passes this schema to `codex exec` with `additionalProperties: false`, runs that previously emitted these sections will now either lose that metadata or fail schema validation, which is a regression in the stored summary fidelity.'
  });
});

test('review stores structured findings from mock codex output', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-review-'));
  const result = await runCli(['review', '--uncommitted', '--cwd', cwd], {
    OPENCODEX_CODEX_BIN: fixture
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Review completed/);
  assert.match(result.stdout, /Add regression coverage for empty summaries/);

  const sessionsRoot = path.join(cwd, '.opencodex', 'sessions');
  const sessionIds = await readdir(sessionsRoot);
  assert.equal(sessionIds.length, 1);

  const session = JSON.parse(await readFile(path.join(sessionsRoot, sessionIds[0], 'session.json'), 'utf8'));
  assert.equal(session.command, 'review');
  assert.equal(session.summary.status, 'completed');
  assert.deepEqual(session.summary.findings, [
    {
      priority: 'P2',
      title: 'Add regression coverage for empty summaries',
      location: {
        path: 'tests/review.test.js',
        start_line: 39,
        end_line: 56
      },
      detail: 'The current review path stores a summary, but it does not assert the empty-summary branch.\nAdd a regression test so later parser changes do not silently drop fallback behavior.'
    }
  ]);
});

test('review failure keeps stderr in summary and main artifact when stdout is present', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-review-fail-'));
  const failingFixture = await writeFailingReviewFixture(path.join(cwd, 'mock-codex-fail.js'));
  const result = await runCli(['review', '--uncommitted', '--cwd', cwd], {
    OPENCODEX_CODEX_BIN: failingFixture
  });

  assert.equal(result.code, 1);
  assert.match(result.stdout, /Review failed/);

  const sessionsRoot = path.join(cwd, '.opencodex', 'sessions');
  const sessionIds = await readdir(sessionsRoot);
  assert.equal(sessionIds.length, 1);

  const session = JSON.parse(await readFile(path.join(sessionsRoot, sessionIds[0], 'session.json'), 'utf8'));
  assert.equal(session.summary.status, 'failed');
  assert.match(session.summary.result, /Stderr: fatal: unable to inspect target/);
  assert.ok(session.artifacts.some((artifact) => artifact.type === 'log'));

  const reportArtifact = session.artifacts.find((artifact) => artifact.type === 'review_report');
  assert.ok(reportArtifact);

  const report = await readFile(reportArtifact.path, 'utf8');
  assert.match(report, /Partial review output on stdout\./);
  assert.match(report, /stderr:\nfatal: unable to inspect target/);
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

async function writeFailingReviewFixture(filePath) {
  await writeFile(filePath, `#!/usr/bin/env node
if (process.argv.includes('--version')) {
  console.log('codex-cli 0.111.0');
  process.exit(0);
}

console.log(['codex', 'Partial review output on stdout.'].join('\\n'));
console.error('fatal: unable to inspect target');
process.exit(1);
`, 'utf8');
  await chmod(filePath, 0o755);
  return filePath;
}
