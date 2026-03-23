#!/usr/bin/env node
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const rawArgs = process.argv.slice(2);
const args = stripGlobalArgs(rawArgs);
const statePath = path.join(process.cwd(), '.mock-auto-loop-state.json');
const state = readState();

if (rawArgs[0] === '--version') {
  console.log('codex-cli 0.116.0');
  process.exit(0);
}

if (args[0] === 'exec') {
  state.run_count += 1;
  writeState(state);

  const lastMessageIndex = args.indexOf('--output-last-message');
  const lastMessagePath = lastMessageIndex >= 0 ? args[lastMessageIndex + 1] : null;
  if (lastMessagePath) {
    writeFileSync(lastMessagePath, JSON.stringify({
      title: `Loop run ${state.run_count} completed`,
      result: `The iterative mock run ${state.run_count} finished successfully.`,
      status: 'completed',
      highlights: [`Iterative run count: ${state.run_count}`],
      next_steps: ['Continue the unattended workflow.']
    }, null, 2));
  }

  console.log(JSON.stringify({ type: 'event', run_count: state.run_count }));
  process.exit(0);
}

if (args[0] === 'review') {
  state.review_count += 1;
  writeState(state);

  if (state.review_count === 1) {
    console.log([
      'codex',
      'The repository still has one blocking issue to address.',
      '',
      'Full review comments:',
      '',
      '- [P1] Fix the remaining workflow regression — src/commands/auto.js:1-40',
      '  The first unattended pass still leaves one issue open.',
      '  Run one more iteration to resolve it.'
    ].join('\n'));
    process.exit(0);
  }

  console.log([
    'codex',
    'No blocking issues remain after the second unattended pass.'
  ].join('\n'));
  process.exit(0);
}

console.error(`Unsupported mock codex invocation: ${rawArgs.join(' ')}`);
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

function readState() {
  if (!existsSync(statePath)) {
    return { run_count: 0, review_count: 0 };
  }

  return JSON.parse(readFileSync(statePath, 'utf8'));
}

function writeState(nextState) {
  writeFileSync(statePath, JSON.stringify(nextState, null, 2));
}
