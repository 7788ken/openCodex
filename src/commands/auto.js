import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { appendFile, writeFile } from 'node:fs/promises';
import { parseOptions } from '../lib/args.js';
import { createSession, getSessionDir, listSessions, loadSession, saveSession } from '../lib/session-store.js';
import { readJson } from '../lib/fs.js';
import { applySessionContract, buildSessionContract, buildSessionContractEnv, buildSessionContractSnapshot } from '../lib/session-contract.js';
import { renderHumanSummary } from '../lib/summary.js';

const OPTION_SPEC = {
  profile: { type: 'string' },
  cwd: { type: 'string' },
  review: { type: 'boolean' },
  uncommitted: { type: 'boolean' },
  base: { type: 'string' },
  commit: { type: 'string' },
  'skip-repair': { type: 'boolean' },
  'max-iterations': { type: 'string' },
  'run-retries': { type: 'string' },
  'fail-on-review': { type: 'boolean' },
  resume: { type: 'string' }
};

const CLI_PATH = fileURLToPath(new URL('../../bin/opencodex.js', import.meta.url));

export async function runAutoCommand(args) {
  const { options, positionals } = parseOptions(args, OPTION_SPEC);
  const cwd = path.resolve(options.cwd || process.cwd());
  let prompt = positionals.join(' ').trim();
  let currentPrompt = prompt;
  let effectiveOptions = { ...options };
  let resumeSource = null;

  if (options.resume) {
    if (prompt) {
      throw new Error('`opencodex auto --resume` does not accept an additional goal prompt');
    }

    resumeSource = await resolveResumeSource(cwd, options.resume);
    prompt = getStoredPrompt(resumeSource);
    currentPrompt = buildResumePrompt(resumeSource, prompt);
    effectiveOptions = mergeResumeOptions(resumeSource, options, cwd);
  } else if (!prompt) {
    throw new Error('`opencodex auto` requires a goal prompt, for example: opencodex auto "stabilize this repo"');
  }

  const maxIterations = parsePositiveInteger(effectiveOptions['max-iterations'] || '1', '--max-iterations');
  const runRetries = parseNonNegativeInteger(effectiveOptions['run-retries'] || '0', '--run-retries');
  ensureSingleReviewTarget(effectiveOptions);
  const shouldRunReview = effectiveOptions.review
    || effectiveOptions.uncommitted
    || Boolean(effectiveOptions.base)
    || Boolean(effectiveOptions.commit)
    || maxIterations > 1
    || effectiveOptions['fail-on-review'];

  const session = createSession({
    command: 'auto',
    cwd,
    input: {
      prompt,
      arguments: {
        ...effectiveOptions,
        'max-iterations': maxIterations,
        'run-retries': runRetries
      }
    },
    codexCliVersion: 'delegated'
  });
  if (resumeSource) {
    session.parent_session_id = resumeSource.session_id;
  }
  applySessionContract(session, buildSessionContract({
    layer: 'host',
    thread_kind: 'host_workflow',
    role: 'auto_orchestrator',
    scope: 'auto',
    supervisor_session_id: resumeSource?.session_id || ''
  }));
  const initialIterationCount = getInitialIterationCount(resumeSource);
  session.status = 'running';
  session.summary = buildInitialSummary({ cwd, maxIterations, runRetries, shouldRunReview, resumeSource, initialIterationCount });
  session.child_sessions = [];
  session.iteration_count = initialIterationCount;

  const sessionDir = await saveSession(cwd, session);
  const logPath = path.join(sessionDir, 'artifacts', 'auto-log.txt');
  await writeFile(logPath, '', 'utf8');
  session.artifacts = [
    {
      type: 'auto_log',
      path: logPath,
      description: 'Combined stdout and stderr from auto workflow child steps.'
    }
  ];
  if (resumeSource) {
    session.artifacts.push({
      type: 'resumed_from_session',
      path: path.join(getSessionDir(cwd, resumeSource.session_id), 'session.json'),
      description: `Original auto session ${resumeSource.session_id} resumed by this workflow.`
    });
  }
  await saveSession(cwd, session);

  process.stdout.write('Auto workflow started\n');
  process.stdout.write(`Working directory: ${cwd}\n`);

  let iterationsCompleted = initialIterationCount;
  let unresolvedFindings = normalizeFindings(resumeSource?.summary?.findings);
  let retryCount = 0;

  try {
    if (!effectiveOptions['skip-repair']) {
      await runRepairStep(cwd, logPath, 'Repair stale sessions', 10, session.session_id);
      await recordNonSessionUpdate(session, cwd, {
        result: 'Initial repair step completed.',
        highlights: ['Repair step completed before unattended execution started.']
      });
    }

    while (iterationsCompleted < maxIterations) {
      const nextIteration = iterationsCompleted + 1;
      const runExecution = await executeRunIteration({
        cwd,
        currentPrompt,
        iteration: nextIteration,
        logPath,
        profile: effectiveOptions.profile,
        runRetries,
        parentSessionId: session.session_id,
        sessionDir,
        skipRepair: effectiveOptions['skip-repair'],
        autoSessionId: session.session_id
      });

      retryCount += runExecution.retryCount;
      let runSession = null;
      for (const attemptResult of runExecution.attempts) {
        runSession = await recordStep(session, {
          label: 'run',
          iteration: nextIteration,
          sessionId: attemptResult.sessionId,
          cwd,
          outputPath: attemptResult.outputPath,
          highlights: attemptResult.attempt > 1 ? [`Run attempt ${attemptResult.attempt} recorded.`] : []
        });
      }

      const runResult = runExecution.finalResult;
      if (runResult.code !== 0) {
        throw new Error(`Run main task failed with exit code ${runResult.code}`);
      }

      iterationsCompleted = nextIteration;
      session.iteration_count = iterationsCompleted;

      if (!shouldRunReview) {
        unresolvedFindings = [];
        break;
      }

      const reviewOutputPath = path.join(sessionDir, 'artifacts', `iteration-${nextIteration}-review.json`);
      const reviewResult = await runStep({
        label: 'Run repository review',
        args: ['review', '--cwd', cwd, ...toProfileArgs(effectiveOptions.profile), ...toReviewTargetArgs(effectiveOptions)],
        cwd,
        logPath,
        outputPath: reviewOutputPath,
        env: {
          OPENCODEX_PARENT_SESSION_ID: session.session_id,
          OPENCODEX_AUTO_ITERATION: String(nextIteration),
          OPENCODEX_EMIT_EARLY_SESSION_ID: '1',
          ...buildSessionContractEnv({
            layer: 'child',
            thread_kind: 'child_session',
            role: 'reviewer',
            scope: 'auto',
            supervisor_session_id: session.session_id
          })
        }
      });
      const reviewSession = await recordStep(session, {
        label: 'review',
        iteration: nextIteration,
        sessionId: reviewResult.sessionId,
        cwd,
        outputPath: reviewOutputPath
      });

      if (reviewResult.code !== 0) {
        throw new Error(`Run repository review failed with exit code ${reviewResult.code}`);
      }

      unresolvedFindings = normalizeFindings(reviewResult.outputSummary?.findings || reviewSession?.summary?.findings);
      if (!unresolvedFindings.length) {
        break;
      }

      if (iterationsCompleted >= maxIterations) {
        break;
      }

      currentPrompt = buildFollowupPrompt(prompt, unresolvedFindings, iterationsCompleted + 1);
      session.summary = {
        title: 'Auto running',
        result: `Continuing into iteration ${iterationsCompleted + 1} after review found ${unresolvedFindings.length} issue(s).`,
        status: 'running',
        highlights: [
          `Completed iterations: ${iterationsCompleted}`,
          `Remaining findings: ${unresolvedFindings.length}`,
          `Run retries used so far: ${retryCount}`,
          'Generating a follow-up run prompt from review feedback.'
        ],
        next_steps: ['Wait for the next unattended iteration to complete.'],
        findings: unresolvedFindings
      };
      session.updated_at = new Date().toISOString();
      await saveSession(cwd, session);
      void runSession;
    }

    const finalSummary = buildFinalSummary({
      shouldRunReview,
      iterationsCompleted,
      maxIterations,
      unresolvedFindings,
      failOnReview: effectiveOptions['fail-on-review'],
      childSessions: session.child_sessions,
      retryCount
    });

    session.status = finalSummary.status;
    session.summary = finalSummary;
    session.updated_at = new Date().toISOString();
    await saveSession(cwd, session);

    process.stdout.write('\nAuto workflow completed\n\n');
    process.stdout.write(renderHumanSummary(finalSummary));
    process.stdout.write(`Session: ${session.session_id}\n`);

    if (finalSummary.status === 'failed') {
      process.exitCode = 1;
    }
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const finalSummary = {
      title: 'Auto failed',
      result: message,
      status: 'failed',
      highlights: [
        `Completed iterations: ${iterationsCompleted}`,
        `Run retries used: ${retryCount}`,
        `Child sessions recorded: ${session.child_sessions.length}`
      ],
      next_steps: ['Inspect the auto session log and child sessions to continue from the last stable point.'],
      findings: unresolvedFindings
    };

    session.status = 'failed';
    session.summary = finalSummary;
    session.updated_at = new Date().toISOString();
    await saveSession(cwd, session);

    process.stdout.write('\n');
    process.stdout.write(renderHumanSummary(finalSummary));
    process.stdout.write(`Session: ${session.session_id}\n`);
    process.exitCode = 1;
  }
}

function buildInitialSummary({ cwd, maxIterations, runRetries, shouldRunReview, resumeSource, initialIterationCount = 0 }) {
  const highlights = [
    `Working directory: ${cwd}`,
    `Max iterations: ${maxIterations}`,
    `Run retries per iteration: ${runRetries}`,
    shouldRunReview ? 'Review feedback loop enabled.' : 'Run-only workflow.'
  ];

  if (resumeSource) {
    highlights.push(
      `Resuming from session: ${resumeSource.session_id}`,
      `Previous auto status: ${resumeSource.status}`
    );
    if (initialIterationCount > 0) {
      highlights.push(`Completed iterations carried in: ${initialIterationCount}`);
    }
  }

  return {
    title: 'Auto running',
    result: resumeSource
      ? `Resuming unattended workflow from ${resumeSource.session_id}.`
      : 'Unattended workflow has started.',
    status: 'running',
    highlights,
    next_steps: ['Use `opencodex session show <id>` to inspect the parent auto workflow session.'],
    findings: []
  };
}

async function resolveResumeSource(cwd, target) {
  let session;

  if (target === 'latest') {
    session = (await listSessions(cwd)).find((candidate) => isResumableAutoSession(candidate));
    if (!session) {
      throw new Error('No resumable `auto` session found for `opencodex auto --resume latest`');
    }
  } else {
    try {
      session = await loadSession(cwd, target);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        throw new Error(`Session not found for \`opencodex auto --resume\`: ${target}`);
      }
      throw error;
    }
  }

  if (session.command !== 'auto') {
    throw new Error('`opencodex auto --resume` only supports previous `auto` sessions');
  }

  if (!isResumableAutoSession(session)) {
    throw new Error('`opencodex auto --resume` only supports `auto` sessions with status `partial` or `failed`');
  }

  if (!getStoredPrompt(session)) {
    throw new Error(`Cannot resume auto session without a stored prompt: ${session.session_id}`);
  }

  return session;
}
function isResumableAutoSession(session) {
  return session?.command === 'auto' && (session.status === 'partial' || session.status === 'failed');
}

function getStoredPrompt(session) {
  return typeof session?.input?.prompt === 'string' ? session.input.prompt.trim() : '';
}

function buildResumePrompt(session, prompt) {
  const findings = normalizeFindings(session.summary?.findings);
  if (!findings.length) {
    return prompt;
  }

  const nextIteration = Number.isInteger(session.iteration_count) ? session.iteration_count + 1 : 1;
  return buildFollowupPrompt(prompt, findings, nextIteration);
}

function mergeResumeOptions(session, options, cwd) {
  const merged = {
    ...(session.input?.arguments || {}),
    ...options,
    cwd
  };
  delete merged.resume;
  return merged;
}

async function executeRunIteration({ cwd, currentPrompt, iteration, logPath, profile, runRetries, parentSessionId, sessionDir, skipRepair, autoSessionId }) {
  let retryCount = 0;
  const attempts = [];

  for (let attempt = 1; attempt <= runRetries + 1; attempt += 1) {
    const outputPath = path.join(sessionDir, 'artifacts', `iteration-${iteration}-run-attempt-${attempt}.json`);
    const runResult = await runStep({
      label: attempt === 1 ? 'Run main task' : `Retry run task (attempt ${attempt})`,
      args: ['run', '--cwd', cwd, ...toProfileArgs(profile), currentPrompt],
      cwd,
      logPath,
      outputPath,
      env: {
        OPENCODEX_PARENT_SESSION_ID: parentSessionId,
        OPENCODEX_AUTO_ITERATION: String(iteration),
        OPENCODEX_AUTO_ATTEMPT: String(attempt),
        OPENCODEX_EMIT_EARLY_SESSION_ID: '1',
        ...buildSessionContractEnv({
          layer: 'child',
          thread_kind: 'child_session',
          role: 'executor',
          scope: 'auto',
          supervisor_session_id: parentSessionId
        })
      }
    });

    attempts.push({ ...runResult, outputPath, attempt });

    if (runResult.code === 0) {
      return { finalResult: { ...runResult, outputPath }, retryCount, attempts };
    }

    if (attempt > runRetries) {
      return { finalResult: { ...runResult, outputPath }, retryCount, attempts };
    }

    retryCount += 1;
    process.stdout.write(`Retrying run after failure (${attempt}/${runRetries + 1})\n`);
    await appendFile(logPath, `Retrying run after failure (${attempt}/${runRetries + 1})\n`, 'utf8');

    if (!skipRepair) {
      await runRepairStep(cwd, logPath, `Repair stale sessions before retry ${attempt}`, 0, autoSessionId);
    }
  }

  return { finalResult: { code: 1, sessionId: '', outputSummary: null, outputPath: '' }, retryCount, attempts };
}

function getInitialIterationCount(session) {
  return Number.isInteger(session?.iteration_count) && session.iteration_count > 0 ? session.iteration_count : 0;
}

function toProfileArgs(profile) {
  return profile ? ['--profile', profile] : [];
}

function ensureSingleReviewTarget(options) {
  const selectors = [
    options.uncommitted ? '--uncommitted' : '',
    options.base ? '--base' : '',
    options.commit ? '--commit' : ''
  ].filter(Boolean);

  if (selectors.length > 1) {
    throw new Error('`opencodex auto` accepts only one review target selector: --uncommitted, --base, or --commit');
  }
}

function toReviewTargetArgs(options) {
  if (options.base) {
    return ['--base', options.base];
  }
  if (options.commit) {
    return ['--commit', options.commit];
  }
  return ['--uncommitted'];
}

async function runRepairStep(cwd, logPath, label, staleMinutes = 10, excludedSessionId = '') {
  return runStep({
    label,
    args: ['session', 'repair', '--cwd', cwd, '--stale-minutes', String(staleMinutes)],
    cwd,
    logPath,
    env: excludedSessionId ? { OPENCODEX_REPAIR_SKIP_SESSION_ID: excludedSessionId } : {}
  });
}

async function runStep({ label, args, cwd, logPath, outputPath = '', env = {} }) {
  process.stdout.write(`\n==> ${label}\n`);
  const childArgs = outputPath ? [...args, '--output', outputPath] : args;
  const result = await spawnCli(childArgs, cwd, env);
  await appendFile(logPath, `\n==> ${label}\n${result.stdout}${result.stderr}`, 'utf8');

  let outputPayload = null;
  if (outputPath) {
    try {
      outputPayload = await readJson(outputPath);
    } catch {
      outputPayload = null;
    }
  }

  return {
    ...result,
    sessionId: outputPayload?.session_id || extractSessionId(result.stdout),
    outputSummary: outputPayload?.summary || null
  };
}

function spawnCli(args, cwd, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd,
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function extractSessionId(text) {
  const matches = [...String(text || '').matchAll(/Session:\s+([^\s]+)/g)];
  return matches.at(-1)?.[1] || '';
}

async function recordNonSessionUpdate(session, cwd, { result, highlights }) {
  session.summary = {
    title: 'Auto running',
    result,
    status: 'running',
    highlights,
    next_steps: ['Continue the unattended workflow.'],
    findings: []
  };
  session.updated_at = new Date().toISOString();
  await saveSession(cwd, session);
}

async function recordStep(session, { label, iteration, sessionId, cwd, highlights = [], outputPath = '' }) {
  if (!sessionId) {
    session.updated_at = new Date().toISOString();
    await saveSession(cwd, session);
    return null;
  }

  const childSession = await loadSession(cwd, sessionId);
  session.child_sessions.push({
    label,
    iteration,
    command: childSession.command,
    session_id: childSession.session_id,
    status: childSession.status,
    session_contract: buildSessionContractSnapshot(childSession)
  });
  if (outputPath) {
    session.artifacts.push({
      type: 'step_output',
      path: outputPath,
      description: `${label} step output for iteration ${iteration}.`
    });
  }
  session.artifacts.push({
    type: 'child_session',
    path: path.join(getSessionDir(cwd, sessionId), 'session.json'),
    description: `${label} child session ${sessionId}.`
  });
  session.summary = {
    title: 'Auto running',
    result: `Finished ${label} step for iteration ${iteration || 0}.`,
    status: 'running',
    highlights: [
      ...highlights,
      `Child sessions recorded: ${session.child_sessions.length}`,
      `Latest child session: ${sessionId}`
    ],
    next_steps: ['Continue the unattended workflow or inspect the recorded child session.'],
    findings: normalizeFindings(childSession.summary?.findings)
  };
  session.updated_at = new Date().toISOString();
  await saveSession(cwd, session);
  return childSession;
}

function normalizeFindings(findings) {
  return Array.isArray(findings) ? findings : [];
}

function buildFollowupPrompt(originalPrompt, findings, nextIteration) {
  const lines = [
    originalPrompt,
    '',
    `Continue the same goal in iteration ${nextIteration}. Address these review findings before stopping:`,
    ''
  ];

  for (const finding of findings) {
    if (typeof finding === 'string') {
      lines.push(`- ${finding}`);
      continue;
    }

    const priority = finding?.priority ? `[${finding.priority}] ` : '';
    const title = finding?.title || 'Untitled finding';
    const location = formatLocation(finding?.location);
    lines.push(`- ${priority}${title}${location ? ` (${location})` : ''}`);
    if (finding?.detail) {
      for (const line of String(finding.detail).split('\n')) {
        lines.push(`  ${line}`);
      }
    }
  }

  return lines.join('\n');
}

function formatLocation(location) {
  if (!location || typeof location !== 'object' || Array.isArray(location)) {
    return '';
  }
  if (!location.path) {
    return '';
  }
  if (Number.isInteger(location.start_line)) {
    return `${location.path}:${location.start_line}-${location.end_line ?? location.start_line}`;
  }
  return String(location.path);
}

function buildFinalSummary({ shouldRunReview, iterationsCompleted, maxIterations, unresolvedFindings, failOnReview, childSessions, retryCount }) {
  if (!shouldRunReview) {
    return {
      title: 'Auto completed',
      result: `Run-only unattended workflow completed after ${iterationsCompleted} iteration(s).`,
      status: 'completed',
      highlights: [
        `Child sessions recorded: ${childSessions.length}`,
        `Run retries used: ${retryCount}`,
        'No review step was requested.'
      ],
      next_steps: ['Inspect the latest run session if more local work is needed.'],
      findings: []
    };
  }

  if (!unresolvedFindings.length) {
    return {
      title: 'Auto completed',
      result: `Unattended workflow completed after ${iterationsCompleted} iteration(s) with no remaining review findings.`,
      status: 'completed',
      highlights: [
        `Child sessions recorded: ${childSessions.length}`,
        `Run retries used: ${retryCount}`,
        `Max iterations: ${maxIterations}`,
        'Final review finished clean.'
      ],
      next_steps: ['Inspect the final run and review sessions if you want a detailed audit trail.'],
      findings: []
    };
  }

  return {
    title: failOnReview ? 'Auto failed' : 'Auto partial',
    result: `Auto workflow stopped after ${iterationsCompleted} iteration(s) with ${unresolvedFindings.length} remaining review finding(s).`,
    status: failOnReview ? 'failed' : 'partial',
    highlights: [
      `Child sessions recorded: ${childSessions.length}`,
      `Run retries used: ${retryCount}`,
      `Max iterations reached: ${maxIterations}`,
      `Remaining findings: ${unresolvedFindings.length}`
    ],
    next_steps: [
      'Increase `--max-iterations` or continue with a follow-up auto run.',
      failOnReview ? 'Resolve the remaining review findings before treating this workflow as successful.' : 'Inspect the remaining review findings before the next unattended pass.'
    ],
    findings: unresolvedFindings
  };
}

function parsePositiveInteger(value, flagName) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flagName} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInteger(value, flagName) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flagName} must be a non-negative integer`);
  }
  return parsed;
}
