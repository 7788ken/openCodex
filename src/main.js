import { runDoctorCommand } from './commands/doctor.js';
import { runRunCommand } from './commands/run.js';
import { runSessionCommand } from './commands/session.js';

const HELP_TEXT = `openCodex

Usage:
  opencodex <command> [options]

Commands:
  doctor    Validate local openCodex readiness
  run       Run a task through Codex CLI
  session   Inspect local openCodex sessions

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

  if (command === 'session') {
    await runSessionCommand(rest);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}
