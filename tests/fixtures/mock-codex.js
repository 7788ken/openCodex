#!/usr/bin/env node
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);

if (args[0] === '--version') {
  console.log('codex-cli 0.111.0');
  process.exit(0);
}

if (args[0] === 'login' && args[1] === 'status') {
  console.log('Logged in using an API key - sk-test');
  process.exit(0);
}

if (args[0] === 'mcp' && args[1] === 'list' && args[2] === '--json') {
  console.log('[]');
  process.exit(0);
}

if (args[0] === 'exec') {
  const outputSchemaIndex = args.indexOf('--output-schema');
  const lastMessageIndex = args.indexOf('--output-last-message');

  const schemaPath = outputSchemaIndex >= 0 ? args[outputSchemaIndex + 1] : null;
  const lastMessagePath = lastMessageIndex >= 0 ? args[lastMessageIndex + 1] : null;

  if (schemaPath) {
    console.log(JSON.stringify({ type: 'schema', path: schemaPath }));
  }

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

console.error(`Unsupported mock codex invocation: ${args.join(' ')}`);
process.exit(1);
