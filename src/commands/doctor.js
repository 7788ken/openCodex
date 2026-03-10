import os from 'node:os';
import path from 'node:path';
import { access } from 'node:fs/promises';
import { parseOptions } from '../lib/args.js';
import { getCodexBin, runCommandCapture } from '../lib/codex.js';
import { readJson, writeJson } from '../lib/fs.js';
import { describeOpenCodexLauncher, describeOpenCodexPath } from '../lib/launcher.js';
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

  const launcher = describeOpenCodexLauncher(process.argv[1] || '');
  checks.push(toCheck(
    'opencodex_launcher',
    launcher.launcherScope === 'project_checkout' ? 'warn' : 'pass',
    false,
    launcher.launcherScope === 'project_checkout'
      ? `Current openCodex launcher comes from a source checkout: ${launcher.cliPath}`
      : `Current openCodex launcher is detached from a source checkout: ${launcher.cliPath}`
  ));

  checks.push(await inspectTelegramServiceLauncherCheck());
  checks.push(await inspectTelegramServiceWorkspaceCheck());

  const failedRequired = checks.filter((check) => check.required && check.status === 'fail');
  const warnings = checks.filter((check) => check.status === 'warn');
  const summaryStatus = failedRequired.length ? 'failed' : warnings.length ? 'partial' : 'completed';

  const summary = {
    title: `Doctor ${summaryStatus}`,
    result: buildDoctorResult(checks),
    status: summaryStatus,
    highlights: checks.map((check) => `${check.status.toUpperCase()} ${check.name}: ${check.details}`),
    next_steps: await buildDoctorNextSteps(checks),
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

async function buildDoctorNextSteps(checks) {
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
  if (byName.opencodex_launcher?.status === 'warn') {
    const detachedInstall = await findDetachedInstallHints();
    if (detachedInstall.installed) {
      const installedTargets = [
        detachedInstall.shimExists ? detachedInstall.shimPath : '',
        detachedInstall.appInstalled ? detachedInstall.appPath : '',
        detachedInstall.currentCliExists ? detachedInstall.currentCliPath : ''
      ].filter(Boolean);
      nextSteps.push(`Use the detached openCodex launcher instead of the source checkout: ${installedTargets.join(' or ')}.`);
    } else {
      nextSteps.push('Run `node ./bin/opencodex.js install detached` from the source checkout, then use the detached runtime for long-lived services.');
    }
  }
  if (byName.telegram_service_launcher?.status === 'warn') {
    nextSteps.push('Reinstall or relink the Telegram service from a detached openCodex CLI so it no longer points at a project checkout.');
  }
  if (byName.telegram_service_workspace?.status === 'warn') {
    nextSteps.push('Run `opencodex service telegram set-workspace --cwd ~/.opencodex/workspaces/telegram-cto` from the detached launcher if you want the installed product fully detached from the development checkout.');
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

async function inspectTelegramServiceLauncherCheck() {
  const configPath = path.join(os.homedir(), '.opencodex', 'service', 'telegram', 'service.json');
  if (!(await fileExists(configPath))) {
    return toCheck('telegram_service_launcher', 'pass', false, 'No installed Telegram service found.');
  }

  try {
    const config = await readJson(configPath);
    const launcher = describeOpenCodexLauncher(config?.cli_path || '');
    if (launcher.launcherScope === 'project_checkout') {
      return toCheck('telegram_service_launcher', 'warn', false, `Installed Telegram service is bound to a source checkout: ${launcher.cliPath}`);
    }
    return toCheck('telegram_service_launcher', 'pass', false, `Installed Telegram service launcher: ${launcher.cliPath}`);
  } catch {
    return toCheck('telegram_service_launcher', 'warn', false, `Installed Telegram service config could not be parsed: ${configPath}`);
  }
}

async function inspectTelegramServiceWorkspaceCheck() {
  const configPath = path.join(os.homedir(), '.opencodex', 'service', 'telegram', 'service.json');
  if (!(await fileExists(configPath))) {
    return toCheck('telegram_service_workspace', 'pass', false, 'No installed Telegram service workspace found.');
  }

  try {
    const config = await readJson(configPath);
    const workspacePath = typeof config?.cwd === 'string' && config.cwd.trim() ? config.cwd.trim() : '';
    if (!workspacePath) {
      return toCheck('telegram_service_workspace', 'warn', false, `Installed Telegram service workspace is missing from config: ${configPath}`);
    }
    const workspace = describeOpenCodexPath(workspacePath, workspacePath);
    if (workspace.pathScope === 'project_checkout') {
      return toCheck('telegram_service_workspace', 'warn', false, `Installed Telegram service workspace still points at the openCodex development checkout: ${workspace.path}`);
    }
    return toCheck('telegram_service_workspace', 'pass', false, `Installed Telegram service workspace: ${workspace.path}`);
  } catch {
    return toCheck('telegram_service_workspace', 'warn', false, `Installed Telegram service config could not be parsed: ${configPath}`);
  }
}

async function findDetachedInstallHints() {
  const homeDir = os.homedir();
  const rootDir = path.join(homeDir, 'Library', 'Application Support', 'OpenCodex');
  const currentCliPath = path.join(rootDir, 'current', 'bin', 'opencodex.js');
  const shimPath = path.join(homeDir, '.local', 'bin', 'opencodex');
  const appPath = path.join(homeDir, 'Applications', 'OpenCodex.app');
  const [currentCliExists, shimExists, appInstalled] = await Promise.all([
    fileExists(currentCliPath),
    fileExists(shimPath),
    fileExists(appPath)
  ]);

  return {
    installed: currentCliExists || shimExists || appInstalled,
    currentCliExists,
    currentCliPath,
    shimExists,
    shimPath,
    appInstalled,
    appPath
  };
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
