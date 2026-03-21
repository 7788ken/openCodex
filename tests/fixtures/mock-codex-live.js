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

if (args[0] === '--bridge-stdin') {
  console.log('mock bridge stdin ready');
  process.stdin.setEncoding('utf8');
  process.stdin.resume();

  await new Promise((resolve, reject) => {
    let buffer = '';
    const timeout = setTimeout(() => {
      console.error('mock bridge stdin timed out');
      reject(new Error('stdin timeout'));
    }, 5000);

    process.stdin.on('data', (chunk) => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex < 0) {
        return;
      }

      clearTimeout(timeout);
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
      console.log(`received: ${line}`);
      resolve();
    });
  });
  process.exit(0);
}

console.error(`Unsupported live mock codex invocation: ${args.join(' ')}`);
process.exit(1);
