#!/usr/bin/env node

import { runDoctor } from './commands/doctor.js';
import { runTask } from './commands/run.js';
import { runSession } from './commands/session.js';
import { parseArgs } from './lib/args.js';

function printHelp() {
  console.log(`openCodex

Usage:
  opencodex doctor [--json] [--verbose]
  opencodex run <prompt> [--profile <name>] [--schema <file>] [--output <file>] [--cwd <dir>]
  opencodex session list [--json]
  opencodex session show <id> [--json]

Commands:
  doctor   Check local readiness for openCodex on top of Codex CLI
  run      Run a task through Codex CLI and store a normalized session
  session  Inspect locally stored openCodex sessions
  review   Reserved for the next milestone
`);
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === 'review') {
    console.error('`opencodex review` is planned next and not implemented in this milestone.');
    process.exitCode = 2;
    return;
  }

  if (command === 'doctor') {
    const options = parseArgs(argv.slice(1));
    const result = await runDoctor(options);
    process.exitCode = result.exitCode;
    return;
  }

  if (command === 'run') {
    const parsed = parseArgs(argv.slice(1));
    const result = await runTask(parsed);
    process.exitCode = result.exitCode;
    return;
  }

  if (command === 'session') {
    const result = await runSession(argv.slice(1));
    process.exitCode = result.exitCode;
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
