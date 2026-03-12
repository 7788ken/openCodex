import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { parseOptions } from '../lib/args.js';
import { getCodexBin, runCommandCapture } from '../lib/codex.js';
import { writeJson } from '../lib/fs.js';
import { resolveCodexProfile } from '../lib/profile.js';
import { applySessionContract, buildSessionContractFromEnv, isTruthyEnv } from '../lib/session-contract.js';
import { createSession, saveSession } from '../lib/session-store.js';
import { renderHumanSummary } from '../lib/summary.js';

const OPTION_SPEC = {
  profile: { type: 'string' },
  uncommitted: { type: 'boolean' },
  base: { type: 'string' },
  commit: { type: 'string' },
  title: { type: 'string' },
  output: { type: 'string' },
  cwd: { type: 'string' }
};

export async function runReviewCommand(args) {
  const { options, positionals } = parseOptions(args, OPTION_SPEC);
  const prompt = positionals.join(' ').trim();
  const cwd = path.resolve(options.cwd || process.cwd());
  const codexBin = getCodexBin();
  const profile = resolveCodexProfile(options.profile, 'review', cwd);
  const codexArgs = buildReviewArgs(prompt, { ...options, cwd, profile: profile.name });
  const versionResult = await runCommandCapture(codexBin, ['--version'], { cwd });
  const codexCliVersion = pickFirstMeaningfulLine(versionResult.stdout) || pickFirstMeaningfulLine(versionResult.stderr) || 'unknown';

  const session = createSession({
    command: 'review',
    cwd,
    codexCliVersion,
    input: {
      prompt,
      arguments: {
        ...options,
        profile: profile.name
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
  applySessionContract(session, buildSessionContractFromEnv());
  session.status = 'running';
  const shouldEmitEarlySessionId = isTruthyEnv(process.env.OPENCODEX_EMIT_EARLY_SESSION_ID);

  const sessionDir = await saveSession(cwd, session);
  const reportPath = path.join(sessionDir, 'artifacts', 'review-report.txt');
  const stderrPath = path.join(sessionDir, 'artifacts', 'codex-stderr.log');

  session.summary = {
    title: 'Review running',
    result: 'Codex CLI review has started.',
    status: 'running',
    highlights: [profile.name === 'safe' ? 'Profile: safe (read-only).' : `Profile: ${profile.name}.`],
    next_steps: ['Use `opencodex session show <id>` to inspect live artifact paths.'],
    findings: []
  };
  session.artifacts = [
    {
      type: 'review_report',
      path: reportPath,
      description: 'Raw Codex CLI review output.'
    },
    {
      type: 'log',
      path: stderrPath,
      description: 'Codex CLI stderr output.'
    }
  ];
  await saveSession(cwd, session);

  if (shouldEmitEarlySessionId) {
    process.stdout.write(`Session: ${session.session_id}\n`);
  }

  const result = await runCommandCapture(codexBin, codexArgs, { cwd });

  const stdoutText = stripCodexWarnings(result.stdout).trim();
  const stderrText = stripCodexWarnings(result.stderr).trim();
  await writeFile(reportPath, buildReviewArtifactText(stdoutText, stderrText, result.code), 'utf8');
  if (stderrText) {
    await writeFile(stderrPath, stderrText, 'utf8');
  }

  const summary = buildReviewSummary(stdoutText, stderrText, result.code, codexCliVersion, options);
  session.status = summary.status;
  session.updated_at = new Date().toISOString();
  session.summary = summary;
  session.artifacts = [
    {
      type: 'review_report',
      path: reportPath,
      description: 'Raw Codex CLI review output.'
    }
  ];

  if (stderrText) {
    session.artifacts.push({
      type: 'log',
      path: stderrPath,
      description: 'Codex CLI stderr output.'
    });
  }

  if (options.output) {
    const outputPath = path.resolve(options.output);
    await writeJson(outputPath, { session_id: session.session_id, summary });
    session.artifacts.push({
      type: 'review_summary',
      path: outputPath,
      description: 'Exported normalized review summary.'
    });
  }

  await saveSession(cwd, session);

  process.stdout.write(renderHumanSummary(summary));
  if (!shouldEmitEarlySessionId) {
    process.stdout.write(`\nSession: ${session.session_id}\n`);
  }

  if (summary.status === 'failed') {
    process.exitCode = 1;
  }
}

export function buildReviewArgs(prompt, options = {}) {
  const profile = resolveCodexProfile(options.profile, 'review', options.cwd);
  ensureSingleReviewTarget(options);
  const args = [...profile.args, 'review'];

  if (options.uncommitted) {
    args.push('--uncommitted');
  }
  if (options.base) {
    args.push('--base', options.base);
  }
  if (options.commit) {
    args.push('--commit', options.commit);
  }
  if (options.title) {
    args.push('--title', options.title);
  }
  if (prompt) {
    args.push(prompt);
  }

  return args;
}

export function buildReviewSummary(stdoutText, stderrText, exitCode, codexCliVersion, options = {}) {
  const reviewBody = extractReviewBody(stdoutText || stderrText);
  const parsed = parseReviewOutput(reviewBody);
  const status = exitCode === 0 ? 'completed' : 'failed';
  const failureDiagnostic = status === 'failed' ? pickFirstMeaningfulLine(extractReviewBody(stderrText) || stderrText) : '';
  const reviewHighlights = buildReviewHighlights(parsed);
  const result = buildFailedReviewResult(parsed.result || (status === 'completed'
    ? 'Codex review completed without textual output.'
    : 'Codex review failed before producing readable output.'), failureDiagnostic, status);

  return {
    title: status === 'completed' ? 'Review completed' : 'Review failed',
    result,
    status,
    highlights: [
      `Target: ${describeReviewTarget(options)}`,
      ...(codexCliVersion ? [`Codex CLI version: ${codexCliVersion}`] : []),
      ...buildFailureDiagnosticHighlights(reviewHighlights, failureDiagnostic, status),
      ...reviewHighlights
    ],
    next_steps: status === 'completed'
      ? ['Inspect the review report artifact for the full review text.', 'Address the reported findings before the next run.']
      : ['Inspect the review report and stderr artifacts to diagnose the failure.'],
    findings: parsed.findings
  };
}

export function extractReviewBody(text) {
  const lines = String(text || '').split('\n');
  const lastCodexIndex = lines.map((line) => line.trim()).lastIndexOf('codex');
  if (lastCodexIndex >= 0 && lastCodexIndex < lines.length - 1) {
    return lines.slice(lastCodexIndex + 1).join('\n').trim();
  }

  return lines
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed
        && trimmed !== 'user'
        && trimmed !== 'thinking'
        && trimmed !== 'exec'
        && trimmed !== 'current changes'
        && trimmed !== '--------'
        && !trimmed.startsWith('OpenAI Codex')
        && !trimmed.startsWith('workdir:')
        && !trimmed.startsWith('model:')
        && !trimmed.startsWith('provider:')
        && !trimmed.startsWith('approval:')
        && !trimmed.startsWith('sandbox:')
        && !trimmed.startsWith('reasoning effort:')
        && !trimmed.startsWith('reasoning summaries:')
        && !trimmed.startsWith('session id:')
        && !trimmed.startsWith('mcp:')
        && !trimmed.startsWith('mcp startup:')
        && !trimmed.startsWith('/bin/zsh -lc')
        && !trimmed.startsWith('diff --git')
        && !trimmed.startsWith('index ')
        && !trimmed.startsWith('--- ')
        && !trimmed.startsWith('+++ ')
        && !trimmed.startsWith('@@ ');
    })
    .join('\n')
    .trim();
}

function describeReviewTarget(options) {
  if (options.uncommitted) {
    return 'uncommitted changes';
  }
  if (options.base) {
    return `changes against ${options.base}`;
  }
  if (options.commit) {
    return `commit ${options.commit}`;
  }
  return 'default repository target';
}

function ensureSingleReviewTarget(options) {
  const selectors = [
    options.uncommitted ? '--uncommitted' : '',
    options.base ? '--base' : '',
    options.commit ? '--commit' : ''
  ].filter(Boolean);

  if (selectors.length > 1) {
    throw new Error('`opencodex review` accepts only one target selector: --uncommitted, --base, or --commit');
  }
}

function parseReviewOutput(text) {
  const lines = String(text || '').split('\n');
  const markerIndex = lines.findIndex((line) => line.trim() === 'Full review comments:');
  const summaryLines = markerIndex >= 0 ? lines.slice(0, markerIndex) : lines;
  const commentLines = markerIndex >= 0 ? lines.slice(markerIndex + 1) : [];
  const result = extractReviewResult(summaryLines);
  const findings = parseReviewFindings(commentLines);

  if (!findings.length) {
    const fallbackFinding = createFallbackFinding(result, markerIndex >= 0 ? commentLines : summaryLines);
    if (fallbackFinding) {
      findings.push(fallbackFinding);
    }
  }

  return {
    lines: collectReviewLines(text),
    result,
    findings
  };
}

function extractReviewResult(lines) {
  const paragraphs = [];
  let current = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (current.length) {
        paragraphs.push(current.join(' '));
        current = [];
      }
      continue;
    }

    current.push(trimmed);
  }

  if (current.length) {
    paragraphs.push(current.join(' '));
  }

  return paragraphs[0] || '';
}

function parseReviewFindings(lines) {
  const findings = [];
  let currentHeader = '';
  let detailLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed && !currentHeader) {
      continue;
    }

    if (trimmed.startsWith('- [P')) {
      pushFinding(findings, currentHeader, detailLines);
      currentHeader = trimmed;
      detailLines = [];
      continue;
    }

    if (currentHeader) {
      detailLines.push(line);
    }
  }

  pushFinding(findings, currentHeader, detailLines);
  return findings;
}

function pushFinding(findings, header, detailLines) {
  const finding = createFinding(header, detailLines);
  if (finding) {
    findings.push(finding);
  }
}

function createFinding(header, detailLines) {
  const match = String(header || '').match(/^\- \[(P\d+)\]\s+(.+)$/);
  if (!match) {
    return null;
  }

  const { title, locationText } = splitFindingTitleAndLocation(match[2]);
  const detail = normalizeFindingDetail(detailLines);
  const location = parseFindingLocation(locationText);

  return {
    priority: match[1],
    title,
    ...(location ? { location } : {}),
    ...(detail ? { detail } : {})
  };
}

function splitFindingTitleAndLocation(text) {
  const value = String(text || '').trim();

  for (const separator of [' — ', ' - ']) {
    const separatorIndex = value.lastIndexOf(separator);
    if (separatorIndex <= 0) {
      continue;
    }

    const title = value.slice(0, separatorIndex).trim();
    const locationText = value.slice(separatorIndex + separator.length).trim();
    if (title && looksLikeFindingLocation(locationText)) {
      return { title, locationText };
    }
  }

  return { title: value };
}

function looksLikeFindingLocation(text) {
  return /:\d+(?:-\d+)?$/.test(String(text || '').trim());
}

function parseFindingLocation(text) {
  const match = String(text || '').trim().match(/^(.*?):(\d+)(?:-(\d+))?$/);
  if (!match) {
    return null;
  }

  const startLine = Number(match[2]);
  const endLine = Number(match[3] || match[2]);

  return {
    path: match[1],
    start_line: startLine,
    end_line: endLine
  };
}

function normalizeFindingDetail(lines) {
  const normalized = String(lines?.join('\n') || '')
    .split('\n')
    .map((line) => line.trimEnd())
    .map((line) => line.replace(/^\s+/, ''));

  while (normalized.length && !normalized[0].trim()) {
    normalized.shift();
  }
  while (normalized.length && !normalized.at(-1)?.trim()) {
    normalized.pop();
  }

  return normalized.join('\n').trim();
}

function createFallbackFinding(result, lines) {
  const fallbackText = String(result || collectReviewLines(String(lines?.join('\n') || '')).join(' ')).trim();
  if (!fallbackText || isExplicitCleanReview(fallbackText)) {
    return null;
  }

  return fallbackText;
}

function isExplicitCleanReview(text) {
  const value = String(text || '').trim();
  if (!value) {
    return false;
  }

  const normalized = value.replace(/\s+/g, ' ');

  return [
    /^no\s+(?:blocking\s+|remaining\s+|material\s+)?issues?\s+(?:remain|left|found)(?:\s+after\b[^.!?]*)?[.!?]*$/i,
    /^no\s+(?:review\s+)?findings?(?:\s+(?:remain|left|found))?[.!?]*$/i,
    /^no\s+(?:further\s+)?action\s+(?:is\s+)?needed[.!?]*$/i,
    /^nothing\s+to\s+fix[.!?]*$/i,
    /^(?:looks good(?:\s+overall)?|lgtm|clean pass)[.!?]*$/i
  ].some((pattern) => pattern.test(normalized));
}

function buildReviewHighlights(parsed) {
  const findingHighlights = parsed.findings
    .slice(0, 3)
    .map((finding) => formatFindingHighlight(finding))
    .filter(Boolean);

  if (findingHighlights.length) {
    return findingHighlights;
  }

  return parsed.lines.slice(0, 3);
}

function buildFailedReviewResult(result, failureDiagnostic, status) {
  if (status !== 'failed' || !failureDiagnostic) {
    return result;
  }

  if (result.includes(failureDiagnostic)) {
    return result;
  }

  return `${result} Stderr: ${failureDiagnostic}`;
}

function buildFailureDiagnosticHighlights(reviewHighlights, failureDiagnostic, status) {
  if (status !== 'failed' || !failureDiagnostic) {
    return [];
  }

  if (reviewHighlights.some((highlight) => highlight.includes(failureDiagnostic))) {
    return [];
  }

  return [`Stderr: ${failureDiagnostic}`];
}

function buildReviewArtifactText(stdoutText, stderrText, exitCode) {
  if (exitCode === 0 || !stdoutText || !stderrText) {
    return stdoutText || stderrText || '';
  }

  return `${stdoutText}\n\nstderr:\n${stderrText}`;
}

function formatFindingHighlight(finding) {
  if (typeof finding === 'string') {
    return finding.trim();
  }

  const location = finding.location ? ` (${formatFindingLocation(finding.location)})` : '';
  return `[${finding.priority}] ${finding.title}${location}`;
}

function formatFindingLocation(location) {
  return `${location.path}:${location.start_line}-${location.end_line}`;
}

function collectReviewLines(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function pickFirstMeaningfulLine(text) {
  return collectReviewLines(stripCodexWarnings(text))[0] || '';
}

function stripCodexWarnings(text) {
  return String(text || '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('WARNING: proceeding,'))
    .join('\n');
}
