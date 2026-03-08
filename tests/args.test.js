import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { parseArgs } from '../src/lib/args.js';
import { buildRunArgs, buildSummaryFromMessage } from '../src/commands/run.js';

test('parseArgs separates flags and positionals', () => {
  const parsed = parseArgs(['hello', '--profile', 'safe', '--json']);
  assert.deepEqual(parsed.positionals, ['hello']);
  assert.deepEqual(parsed.flags, {
    profile: 'safe',
    json: true
  });
});

test('buildRunArgs uses schema and output files', () => {
  const args = buildRunArgs('fix bug', { profile: 'safe', cwd: '/tmp/repo' }, {
    lastMessageFile: '/tmp/message.txt'
  });

  assert.deepEqual(args, [
    'exec',
    'fix bug',
    '--json',
    '--output-last-message',
    '/tmp/message.txt',
    '--output-schema',
    path.resolve('schemas', 'run-summary.schema.json'),
    '--cd',
    '/tmp/repo',
    '--profile',
    'safe'
  ]);
});

test('buildSummaryFromMessage parses structured JSON output', () => {
  const summary = buildSummaryFromMessage(JSON.stringify({
    title: 'Done',
    result: 'Worked',
    status: 'completed',
    highlights: ['a'],
    next_steps: []
  }), 'completed');

  assert.equal(summary.title, 'Done');
  assert.equal(summary.status, 'completed');
});
