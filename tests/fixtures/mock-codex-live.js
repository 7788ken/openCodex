#!/usr/bin/env node
import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);
const delayMs = Math.max(0, Number.parseInt(process.env.OPENCODEX_MOCK_CODEX_DELAY_MS || '0', 10) || 0);

if (delayMs > 0) {
  await sleep(delayMs);
}

if (args[0] === '--version') {
  console.log('codex-cli 0.222.0');
  process.exit(0);
}

console.error(`Unsupported live mock codex invocation: ${args.join(' ')}`);
process.exit(1);
