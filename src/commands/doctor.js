import os from 'node:os';
import path from 'node:path';
import { access } from 'node:fs/promises';
import { parseOptions } from '../lib/args.js';
import { getCodexBin, runCommandCapture } from '../lib/codex.js';
import { writeJson } from '../lib/fs.js';
import { createSession, saveSession } from '../lib/session-store.js';
import { renderHumanSummary } from '../lib/summary.js';

const OPTION_SPEC = {
  json: { type: 'boolean' },
  verbose: { type: 'boolean' },
  cwd: { type: 'string' }
};

export async function runDoctorCommand(args) {
  const { options, positionals } = parseOptions(args, OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex doctor` does not accept positional arguments');
  }

  const cwd = path.resolve(options.cwd || process.cwd());
  const codexBin = getCodexBin();
  const versionResult = await runCommandCapture(codexBin, ['--version'], { cwd });
  const versionText = pickFirstMeaningfulLine(versionResult.stdout) || pickFirstMeaningfulLine(versionResult.stderr) || 'unknown';

  const session = createSession({
    command: 'doctor',
    cwd,
    codexCliVersion: versionText,
    input: {
      prompt: 'Validate local openCodex readiness.',
      arguments: options
    }
  });

  const checks = [];
  checks.push(toCheck('codex_cli', versionResult.code === 0 ? 'pass' : 'fail', true, versionText));

  const loginResult = versionResult.code === 0
    ? await runCommandCapture(codexBin, ['login', 'status'], { cwd })
    : { code: 1, stdout: '', stderr: 'Skipped because Codex CLI was not available.' };
  checks.push(toCheck('codex_login', loginResult.code === 0 ? 'pass' : 'fail', true, pickFirstMeaningfulLine(loginResult.stdout || loginResult.stderr)));

  const mcpResult = versionResult.code === 0
    ? await runCommandCapture(codexBin, ['mcp', 'list', '--json'], { cwd })
    : { code: 1, stdout: '', stderr: 'Skipped because Codex CLI was not available.' };
  checks.push(toCheck('mcp_visibility', mcpResult.code === 0 ? 'pass' : 'warn', false, describeMcpResult(mcpResult.stdout, mcpResult.stderr)));

  const gitResult = await runCommandCapture('git', ['rev-parse', '--show-toplevel'], { cwd });
  checks.push(toCheck('git_workspace', gitResult.code === 0 ? 'pass' : 'warn', false, pickFirstMeaningfulLine(gitResult.stdout || gitResult.stderr) || 'Current directory is not a Git repository.'));

  const configPath = path.join(os.homedir(), '.codex', 'config.toml');
  const configExists = await fileExists(configPath);
  checks.push(toCheck('codex_config', configExists ? 'pass' : 'warn', false, configExists ? configPath : 'Config file not found at ~/.codex/config.toml'));

  const failedRequired = checks.filter((check) => check.required && check.status === 'fail');
  const warnings = checks.filter((check) => check.status === 'warn');
  const summaryStatus = failedRequired.length ? 'failed' : warnings.length ? 'partial' : 'completed';

  const summary = {
    title: `Doctor ${summaryStatus}`,
    result: buildDoctorResult(checks),
    status: summaryStatus,
    highlights: checks.map((check) => `${check.status.toUpperCase()} ${check.name}: ${check.details}`),
    next_steps: buildDoctorNextSteps(checks),
    validation: checks.map((check) => `${check.name}:${check.status}`)
  };

  session.status = summaryStatus;
  session.updated_at = new Date().toISOString();
  session.summary = summary;

  const sessionDir = await saveSession(cwd, session);
  const reportPath = path.join(sessionDir, 'artifacts', 'doctor-report.json');
  await writeJson(reportPath, { checks });
  session.artifacts = [
    {
      type: 'doctor_report',
      path: reportPath,
      description: 'Structured doctor check results.'
    }
  ];
  await saveSession(cwd, session);

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ summary, checks, session_id: session.session_id }, null, 2)}\n`);
  } else {
    process.stdout.write(renderHumanSummary(summary));
    if (options.verbose) {
      for (const check of checks) {
        process.stdout.write(`- ${check.name}: ${check.status} (${check.details})\n`);
      }
    }
    process.stdout.write(`\nSession: ${session.session_id}\n`);
  }

  if (summaryStatus === 'failed') {
    process.exitCode = 1;
  }
}

function buildDoctorResult(checks) {
  const passed = checks.filter((check) => check.status === 'pass').length;
  const warned = checks.filter((check) => check.status === 'warn').length;
  const failed = checks.filter((check) => check.status === 'fail').length;
  return `Completed ${checks.length} checks: ${passed} passed, ${warned} warned, ${failed} failed.`;
}

function buildDoctorNextSteps(checks) {
  const nextSteps = [];
  const byName = Object.fromEntries(checks.map((check) => [check.name, check]));

  if (byName.codex_cli?.status === 'fail') {
    nextSteps.push('Install Codex CLI and verify `codex --version`.');
  }
  if (byName.codex_login?.status === 'fail') {
    nextSteps.push('Run `codex login` or provide an API key before using openCodex run flows.');
  }
  if (byName.git_workspace?.status === 'warn') {
    nextSteps.push('Run openCodex inside a Git repository for repo-aware workflows.');
  }
  if (byName.codex_config?.status === 'warn') {
    nextSteps.push('Create `~/.codex/config.toml` if you need persistent Codex CLI defaults.');
  }
  if (!nextSteps.length) {
    nextSteps.push('Environment looks ready for the first openCodex wrapper flows.');
  }

  return nextSteps;
}

function toCheck(name, status, required, details) {
  return { name, status, required, details };
}

function pickFirstMeaningfulLine(value) {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('WARNING: proceeding,')) || '';
}

function describeMcpResult(stdout, stderr) {
  try {
    const servers = JSON.parse(stdout);
    if (Array.isArray(servers)) {
      return `${servers.length} configured server(s).`;
    }
  } catch {
  }
  return pickFirstMeaningfulLine(stdout || stderr) || 'No MCP data available.';
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
