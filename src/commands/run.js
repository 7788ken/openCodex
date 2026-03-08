import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { parseOptions } from '../lib/args.js';
import { getCodexBin, runCommandCapture, runCommandToFile } from '../lib/codex.js';
import { readTextIfExists, writeJson } from '../lib/fs.js';
import { createSession, saveSession } from '../lib/session-store.js';
import { createDefaultRunSchema, normalizeSummary, renderHumanSummary } from '../lib/summary.js';

const OPTION_SPEC = {
  profile: { type: 'string' },
  schema: { type: 'string' },
  output: { type: 'string' },
  cwd: { type: 'string' }
};

export async function runRunCommand(args) {
  const { options, positionals } = parseOptions(args, OPTION_SPEC);
  const prompt = positionals.join(' ').trim();

  if (!prompt) {
    throw new Error('`opencodex run` requires a prompt, for example: opencodex run "summarize this repo"');
  }

  const cwd = path.resolve(options.cwd || process.cwd());
  const codexBin = getCodexBin();
  const versionResult = await runCommandCapture(codexBin, ['--version'], { cwd });
  const codexCliVersion = pickFirstLine(versionResult.stdout) || pickFirstLine(versionResult.stderr) || 'unknown';

  const session = createSession({
    command: 'run',
    cwd,
    codexCliVersion,
    input: {
      prompt,
      arguments: options
    }
  });
  session.status = 'running';

  const sessionDir = await saveSession(cwd, session);
  const eventsPath = path.join(sessionDir, 'events.jsonl');
  const lastMessagePath = path.join(sessionDir, 'last-message.txt');
  const stderrPath = path.join(sessionDir, 'artifacts', 'codex-stderr.log');
  const schemaPath = options.schema ? path.resolve(options.schema) : path.join(sessionDir, 'run-output.schema.json');

  if (!options.schema) {
    await writeJson(schemaPath, createDefaultRunSchema());
  }

  const codexArgs = ['exec', '--json', '--output-schema', schemaPath, '--output-last-message', lastMessagePath];
  if (options.profile) {
    codexArgs.push('--profile', options.profile);
  }
  if (cwd) {
    codexArgs.push('-C', cwd);
  }
  codexArgs.push(prompt);

  const result = await runCommandToFile(codexBin, codexArgs, { cwd, stdoutPath: eventsPath });
  if (result.stderr.trim()) {
    await writeFile(stderrPath, result.stderr, 'utf8');
  }

  const rawLastMessage = (await readTextIfExists(lastMessagePath))?.trim() || '';
  const parsedLastMessage = tryParseJson(rawLastMessage);
  const fallbackStatus = result.code === 0 ? 'completed' : 'failed';
  const summary = normalizeSummary(parsedLastMessage, {
    title: fallbackStatus === 'completed' ? 'Run completed' : 'Run failed',
    result: rawLastMessage || (result.code === 0 ? 'Codex CLI completed without a structured final message.' : 'Codex CLI failed before producing a structured final message.'),
    status: fallbackStatus,
    highlights: [`Codex CLI version: ${codexCliVersion}`],
    next_steps: result.code === 0 ? [] : ['Inspect session artifacts for raw Codex output.']
  });

  session.status = summary.status || fallbackStatus;
  session.updated_at = new Date().toISOString();
  session.summary = summary;
  session.artifacts = [
    {
      type: 'jsonl_events',
      path: eventsPath,
      description: 'Raw Codex CLI JSONL event stream.'
    },
    {
      type: 'last_message',
      path: lastMessagePath,
      description: 'Final Codex CLI assistant message.'
    },
    {
      type: 'output_schema',
      path: schemaPath,
      description: 'JSON Schema used for the structured run output.'
    }
  ];

  if (result.stderr.trim()) {
    session.artifacts.push({
      type: 'log',
      path: stderrPath,
      description: 'Codex CLI stderr output.'
    });
  }

  await saveSession(cwd, session);

  if (options.output) {
    const outputPath = path.resolve(options.output);
    await writeJson(outputPath, { session_id: session.session_id, summary });
    session.artifacts.push({
      type: 'run_summary',
      path: outputPath,
      description: 'Exported normalized run summary.'
    });
    await saveSession(cwd, session);
  }

  process.stdout.write(renderHumanSummary(summary));
  process.stdout.write(`\nSession: ${session.session_id}\n`);

  if (result.code !== 0 || summary.status === 'failed') {
    process.exitCode = 1;
  }
}

function pickFirstLine(value) {
  return String(value || '').split('\n').find((line) => line.trim())?.trim() || '';
}

function tryParseJson(value) {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
