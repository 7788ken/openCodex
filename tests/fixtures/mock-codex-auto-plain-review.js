#!/usr/bin/env node
import { writeFileSync } from 'node:fs';

const rawArgs = process.argv.slice(2);
const args = stripGlobalArgs(rawArgs);

if (rawArgs[0] === '--version') {
  console.log('codex-cli 0.116.0');
  process.exit(0);
}

if (args[0] === 'exec') {
  const lastMessageIndex = args.indexOf('--output-last-message');
  const lastMessagePath = lastMessageIndex >= 0 ? args[lastMessageIndex + 1] : null;

  if (lastMessagePath) {
    writeFileSync(lastMessagePath, JSON.stringify({
      title: 'Mock run completed',
      result: 'The mock Codex binary executed successfully.',
      status: 'completed',
      highlights: ['Structured result returned by mock codex.'],
      next_steps: ['Replace mock binary with real Codex CLI.']
    }, null, 2));
  }

  console.log(JSON.stringify({ type: 'event', message: 'mock execution event' }));
  process.exit(0);
}

if (args[0] === 'review') {
  console.log([
    'codex',
    'There is still a blocking workflow regression to fix before this change is safe.'
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
