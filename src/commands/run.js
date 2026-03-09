import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { parseOptions } from '../lib/args.js';
import { getCodexBin, runCommandCapture, runCommandToFile } from '../lib/codex.js';
import { readTextIfExists, writeJson } from '../lib/fs.js';
import { detectHostSandboxMode, isLikelySandboxRestriction, isSandboxModeStricter, resolveCodexProfile } from '../lib/profile.js';
import { createSession, saveSession } from '../lib/session-store.js';
import { normalizeSummary, renderHumanSummary } from '../lib/summary.js';

const OPTION_SPEC = {
  profile: { type: 'string' },
  schema: { type: 'string' },
  output: { type: 'string' },
  cwd: { type: 'string' }
};

const DEFAULT_SCHEMA_PATH = fileURLToPath(new URL('../../schemas/run-summary.schema.json', import.meta.url));

export async function runRunCommand(args) {
  const { options, positionals } = parseOptions(args, OPTION_SPEC);
  const prompt = positionals.join(' ').trim();

  if (!prompt) {
    throw new Error('`opencodex run` requires a prompt, for example: opencodex run "summarize this repo"');
  }

  const cwd = path.resolve(options.cwd || process.cwd());
  const codexBin = getCodexBin();
  const profile = resolveCodexProfile(options.profile, 'run', cwd);
  const initialHostSandboxMode = detectHostSandboxMode({ env: process.env });
  const versionResult = await runCommandCapture(codexBin, ['--version'], { cwd });
  const codexCliVersion = pickFirstLine(versionResult.stdout) || pickFirstLine(versionResult.stderr) || 'unknown';

  const session = createSession({
    command: 'run',
    cwd,
    codexCliVersion,
    input: {
      prompt,
      arguments: {
        ...options,
        profile: profile.name,
        approval_mode: profile.approvalMode,
        requested_sandbox_mode: profile.sandboxMode,
        host_sandbox_mode: initialHostSandboxMode || ''
      }
    }
  });
  if (process.env.OPENCODEX_PARENT_SESSION_ID) {
    session.parent_session_id = process.env.OPENCODEX_PARENT_SESSION_ID;
  }
  if (process.env.OPENCODEX_AUTO_ITERATION) {
    session.auto_iteration = Number.parseInt(process.env.OPENCODEX_AUTO_ITERATION, 10) || process.env.OPENCODEX_AUTO_ITERATION;
  }
  if (process.env.OPENCODEX_AUTO_ATTEMPT) {
    session.auto_attempt = Number.parseInt(process.env.OPENCODEX_AUTO_ATTEMPT, 10) || process.env.OPENCODEX_AUTO_ATTEMPT;
  }
  session.status = 'running';

  const sessionDir = await saveSession(cwd, session);
  const eventsPath = path.join(sessionDir, 'events.jsonl');
  const lastMessagePath = path.join(sessionDir, 'last-message.txt');
  const stderrPath = path.join(sessionDir, 'artifacts', 'codex-stderr.log');
  const schemaPath = resolveSchemaPath(options.schema);

  session.summary = {
    title: 'Run running',
    result: 'Codex CLI execution has started.',
    status: 'running',
    highlights: [
      profile.name === 'safe' ? 'Profile: safe (read-only).' : `Profile: ${profile.name}.`,
      `Requested sandbox: ${profile.sandboxMode}.`,
      ...(initialHostSandboxMode ? [`Host sandbox: ${initialHostSandboxMode}.`] : [])
    ],
    next_steps: ['Use `opencodex session show <id>` to inspect live artifact paths.'],
    risks: [],
    validation: [],
    changed_files: [],
    findings: []
  };
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
  await saveSession(cwd, session);

  if (initialHostSandboxMode && isSandboxModeStricter(initialHostSandboxMode, profile.sandboxMode)) {
    const summary = buildHostSandboxFailureSummary({
      profileName: profile.name,
      requestedSandboxMode: profile.sandboxMode,
      hostSandboxMode: initialHostSandboxMode,
      codexCliVersion,
      detectionSource: 'env'
    });
    session.status = summary.status;
    session.updated_at = new Date().toISOString();
    session.summary = summary;
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
    process.exitCode = 1;
    return;
  }
  const codexArgs = buildRunArgs(prompt, { ...options, cwd, profile: profile.name }, { lastMessagePath, schemaPath });
  const result = await runCommandToFile(codexBin, codexArgs, { cwd, stdoutPath: eventsPath });

  if (result.stderr.trim()) {
    await writeFile(stderrPath, result.stderr, 'utf8');
  }

  const rawLastMessage = (await readTextIfExists(lastMessagePath))?.trim() || '';
  const fallbackStatus = result.code === 0 ? 'completed' : 'failed';
  const eventError = pickUsefulEventError(result.stdout);
  const fallbackMessage = rawLastMessage || eventError || pickUsefulError(result.stderr);
  const baseSummary = buildSummaryFromMessage(fallbackMessage, fallbackStatus, codexCliVersion);

  let detectedHostSandboxMode = initialHostSandboxMode || '';
  let summary = baseSummary;

  if (baseSummary.status === 'failed') {
    detectedHostSandboxMode = detectHostSandboxMode({
      env: process.env,
      stderr: result.stderr,
      stdout: result.stdout,
      message: fallbackMessage
    }) || initialHostSandboxMode || '';

    if (isLikelySandboxRestriction({
      requestedSandboxMode: profile.sandboxMode,
      hostSandboxMode: detectedHostSandboxMode || initialHostSandboxMode,
      stderr: result.stderr,
      stdout: result.stdout,
      message: fallbackMessage
    })) {
      summary = buildHostSandboxFailureSummary({
        profileName: profile.name,
        requestedSandboxMode: profile.sandboxMode,
        hostSandboxMode: detectedHostSandboxMode || initialHostSandboxMode,
        codexCliVersion,
        detectionSource: detectedHostSandboxMode ? 'output' : 'heuristic'
      });
    }
  }

  session.input.arguments.effective_sandbox_mode = detectedHostSandboxMode || '';

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

export function buildRunArgs(prompt, options = {}, paths = {}) {
  const schemaPath = paths.schemaPath || resolveSchemaPath(options.schema);
  const lastMessagePath = paths.lastMessagePath;
  const profile = resolveCodexProfile(options.profile, 'run', options.cwd);

  return [
    ...profile.args,
    'exec',
    '--json',
    '--output-schema',
    schemaPath,
    '--output-last-message',
    lastMessagePath,
    '-C',
    options.cwd,
    prompt
  ];
}

export function buildSummaryFromMessage(message, fallbackStatus, codexCliVersion) {
  const parsed = tryParseJson(message);
  return normalizeSummary(parsed, {
    title: fallbackStatus === 'completed' ? 'Run completed' : 'Run failed',
    result: message || (fallbackStatus === 'completed' ? 'Codex CLI completed without a structured final message.' : 'Codex CLI failed before producing a structured final message.'),
    status: fallbackStatus,
    highlights: codexCliVersion ? [`Codex CLI version: ${codexCliVersion}`] : [],
    next_steps: fallbackStatus === 'completed' ? [] : ['Inspect session artifacts for raw Codex output.'],
    risks: [],
    validation: [],
    changed_files: [],
    findings: []
  });
}

<<<<<<< HEAD
=======
function buildHostSandboxFailureSummary({ profileName, requestedSandboxMode, hostSandboxMode = '', codexCliVersion = '', detectionSource = '' }) {
  const effectiveHostSandboxMode = hostSandboxMode || 'read-only';
  return normalizeSummary({
    title: 'Run blocked by host sandbox',
    result: `请求的 profile \`${profileName}\` 需要 \`${requestedSandboxMode}\`，但当前宿主环境实际只给到了 \`${effectiveHostSandboxMode}\`。openCodex 不能从子任务内部突破更严格的外层沙箱，所以这次执行已快速失败并停止，不再继续把 workflow 挂成等待。`,
    status: 'failed',
    highlights: [
      codexCliVersion ? `Codex CLI version: ${codexCliVersion}` : '',
      `Requested profile: ${profileName}.`,
      `Requested sandbox: ${requestedSandboxMode}.`,
      `Effective host sandbox: ${effectiveHostSandboxMode}.`
    ].filter(Boolean),
    next_steps: [],
    risks: ['上层宿主沙箱比请求的 profile 更严格；子任务无法自行提权。'],
    validation: [detectionSource ? `sandbox_detection:${detectionSource}` : 'sandbox_detection:unknown'],
    changed_files: [],
    findings: []
  }, {
    title: 'Run blocked by host sandbox',
    result: 'Host sandbox restriction detected.',
    status: 'failed',
    highlights: [],
    next_steps: [],
    risks: [],
    validation: [],
    changed_files: [],
    findings: []
  });
}

>>>>>>> 962493a (fix(cto): fail fast on stricter host sandbox)
function resolveSchemaPath(schemaPath) {
  return schemaPath ? path.resolve(schemaPath) : DEFAULT_SCHEMA_PATH;
}

function pickFirstLine(value) {
  return String(value || '').split('\n').find((line) => line.trim())?.trim() || '';
}

function pickUsefulError(stderr) {
  const lines = String(stderr || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('WARNING: proceeding,') && !line.startsWith('note: run with') && !line.startsWith('Warning: no last agent message'));

  return lines.find((line) => line.includes('stream disconnected'))
    || lines.find((line) => line.includes('failed to'))
    || lines.find((line) => line.includes('panicked'))
    || lines.at(-1)
    || '';
}

function pickUsefulEventError(stdout) {
  const events = String(stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of events.reverse()) {
    try {
      const event = JSON.parse(line);
      const message = extractEventErrorMessage(event);
      if (message) {
        return message;
      }
    } catch {
    }
  }

  return '';
}

function extractEventErrorMessage(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return '';
  }

  if (typeof event.message === 'string' && event.message.trim()) {
    const parsed = tryParseJson(event.message);
    const nestedMessage = parsed?.error?.message;
    if (typeof nestedMessage === 'string' && nestedMessage.trim()) {
      return nestedMessage.trim();
    }
    return event.message.trim();
  }

  const nested = event.error;
  if (nested && typeof nested === 'object' && !Array.isArray(nested) && typeof nested.message === 'string' && nested.message.trim()) {
    const parsed = tryParseJson(nested.message);
    const nestedMessage = parsed?.error?.message;
    if (typeof nestedMessage === 'string' && nestedMessage.trim()) {
      return nestedMessage.trim();
    }
    return nested.message.trim();
  }

  return '';
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
