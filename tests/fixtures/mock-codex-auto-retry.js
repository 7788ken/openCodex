#!/usr/bin/env node
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const rawArgs = process.argv.slice(2);
const args = stripGlobalArgs(rawArgs);
const statePath = path.join(process.cwd(), '.mock-auto-retry-state.json');
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

  if (state.run_count === 1) {
    console.error('transient codex failure');
    process.exit(1);
  }

  if (lastMessagePath) {
    writeFileSync(lastMessagePath, JSON.stringify({
      title: 'Recovered run completed',
      result: 'The run succeeded on retry.',
      status: 'completed',
      highlights: ['Retry path recovered successfully.'],
      next_steps: ['Optionally review the result.']
    }, null, 2));
  }

  console.log(JSON.stringify({ type: 'event', recovered: true }));
  process.exit(0);
}

if (args[0] === 'review') {
  console.log(['codex', 'No blocking issues remain after retry recovery.'].join('\n'));
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
    return { run_count: 0 };
  }

  return JSON.parse(readFileSync(statePath, 'utf8'));
}

function writeState(nextState) {
  writeFileSync(statePath, JSON.stringify(nextState, null, 2));
}
