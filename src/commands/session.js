import path from 'node:path';
import { parseOptions } from '../lib/args.js';
import { listSessions, loadSession } from '../lib/session-store.js';
import { renderHumanSummary } from '../lib/summary.js';

const OPTION_SPEC = {
  json: { type: 'boolean' },
  cwd: { type: 'string' }
};

export async function runSessionCommand(args) {
  const [subcommand, ...rest] = args;
  const cwd = path.resolve(process.cwd());

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    process.stdout.write('Usage:\n  opencodex session list [--json] [--cwd <dir>]\n  opencodex session show <id> [--json] [--cwd <dir>]\n');
    return;
  }

  if (subcommand === 'list') {
    const { options, positionals } = parseOptions(rest, OPTION_SPEC);
    if (positionals.length) {
      throw new Error('`opencodex session list` does not accept positional arguments');
    }
    const targetCwd = path.resolve(options.cwd || cwd);
    const sessions = await listSessions(targetCwd);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);
      return;
    }
    if (!sessions.length) {
      process.stdout.write('No sessions found.\n');
      return;
    }
    for (const session of sessions) {
      process.stdout.write(`${session.session_id}  ${session.command}  ${session.status}  ${session.updated_at}\n`);
    }
    return;
  }

  if (subcommand === 'show') {
    const { options, positionals } = parseOptions(rest, OPTION_SPEC);
    const [sessionId] = positionals;
    if (!sessionId) {
      throw new Error('`opencodex session show` requires a session id');
    }
    const targetCwd = path.resolve(options.cwd || cwd);
    const session = await loadSession(targetCwd, sessionId);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(session, null, 2)}\n`);
      return;
    }
    process.stdout.write(renderHumanSummary(session.summary));
    process.stdout.write(`\nSession: ${session.session_id}\n`);
    if (session.artifacts?.length) {
      process.stdout.write('\nArtifacts:\n');
      for (const artifact of session.artifacts) {
        process.stdout.write(`- ${artifact.type}: ${artifact.path}\n`);
      }
    }
    return;
  }

  throw new Error(`Unknown session subcommand: ${subcommand}`);
}
