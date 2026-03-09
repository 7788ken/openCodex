import { runDoctorCommand } from './commands/doctor.js';
import { runRunCommand } from './commands/run.js';
import { runReviewCommand } from './commands/review.js';
import { runSessionCommand } from './commands/session.js';
import { runAutoCommand } from './commands/auto.js';
import { runRemoteCommand } from './commands/remote.js';
import { runImCommand } from './commands/im.js';
import { runServiceCommand } from './commands/service.js';

const HELP_TEXT = `openCodex

Usage:
  opencodex <command> [options]

Commands:
  doctor    Validate local openCodex readiness
  run       Run a task through Codex CLI
  review    Run a repository review through Codex CLI
  session   Inspect local openCodex sessions
  auto      Run an unattended local workflow
  remote    Expose a phone-friendly remote message bridge
  im        Connect to chat apps like Telegram
  service   Install and control local background services

Global options:
  --help    Show help
`;

export async function main(argv) {
  const [command, ...rest] = argv;

  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(HELP_TEXT);
    return;
  }

  if (command === 'doctor') {
    await runDoctorCommand(rest);
    return;
  }

  if (command === 'run') {
    await runRunCommand(rest);
    return;
  }

  if (command === 'review') {
    await runReviewCommand(rest);
    return;
  }

  if (command === 'session') {
    await runSessionCommand(rest);
    return;
  }

  if (command === 'auto') {
    await runAutoCommand(rest);
    return;
  }

  if (command === 'remote') {
    await runRemoteCommand(rest);
    return;
  }

  if (command === 'im') {
    await runImCommand(rest);
    return;
  }

  if (command === 'service') {
    await runServiceCommand(rest);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}
