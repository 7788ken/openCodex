import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { parseArgs } from '../src/lib/args.js';
import { buildRunArgs, buildSummaryFromMessage } from '../src/commands/run.js';
import { buildReviewArgs } from '../src/commands/review.js';

test('parseArgs separates flags and positionals', () => {
  const parsed = parseArgs(['hello', '--profile', 'safe', '--json']);
  assert.deepEqual(parsed.positionals, ['hello']);
  assert.deepEqual(parsed.flags, {
    profile: 'safe',
    json: true
  });
});

test('buildRunArgs uses package schema path and output files', () => {
  const args = buildRunArgs('fix bug', { profile: 'safe', cwd: '/tmp/repo' }, {
    lastMessagePath: '/tmp/message.txt'
  });

  assert.deepEqual(args, [
    '-a',
    'never',
    '-s',
    'read-only',
    '-c',
    'model_reasoning_effort="medium"',
    'exec',
    '--skip-git-repo-check',
    '--json',
    '--output-schema',
    args[10],
    '--output-last-message',
    '/tmp/message.txt',
    '-C',
    '/tmp/repo',
    'fix bug'
  ]);
  assert.match(args[10], /schemas[\/]+run-summary\.schema\.json$/);
});

test('buildReviewArgs applies profile defaults', () => {
  const args = buildReviewArgs('focus on risks', { profile: 'balanced', uncommitted: true });

  assert.deepEqual(args, [
    '-a',
    'never',
    '-s',
    'read-only',
    '-c',
    'model_reasoning_effort="medium"',
    'review',
    '--uncommitted',
    'focus on risks'
  ]);
});


test('buildRunArgs uses bundled schema path by default', () => {
  const args = buildRunArgs('inspect repo', { profile: 'safe', cwd: '/tmp/repo' }, {
    lastMessagePath: '/tmp/message.txt'
  });

  assert.equal(path.isAbsolute(args[10]), true);
  assert.equal(args[10].endsWith('/schemas/run-summary.schema.json'), true);
});

test('buildSummaryFromMessage parses structured JSON output', () => {
  const summary = buildSummaryFromMessage(JSON.stringify({
    title: 'Done',
    result: 'Worked',
    status: 'completed',
    highlights: ['a'],
    next_steps: [],
    risks: null,
    validation: null,
    changed_files: ['src/main.js'],
    findings: ['one']
  }), 'completed');

  assert.equal(summary.title, 'Done');
  assert.equal(summary.status, 'completed');
  assert.deepEqual(summary.changed_files, ['src/main.js']);
  assert.deepEqual(summary.findings, ['one']);
});
