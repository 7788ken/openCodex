import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { parseOptions } from '../lib/args.js';
import { ensureDir, pathExists, readJson, readTextIfExists, writeJson } from '../lib/fs.js';
import { getCodexBin, runCommandCapture } from '../lib/codex.js';
import { resolveCodexProfile } from '../lib/profile.js';
import { getSessionDir, listSessions } from '../lib/session-store.js';

const CLI_PATH = fileURLToPath(new URL('../../bin/opencodex.js', import.meta.url));
const DEFAULT_LABEL = 'com.opencodex.telegram.cto';
const DEFAULT_MENU_BAR_APP_NAME = 'OpenCodex Tray.app';
const SERVICE_CONFIG_FILE = 'service.json';
const DEFAULT_POLL_TIMEOUT = 30;
const DEFAULT_PROFILE = 'full-access';

const TELEGRAM_INSTALL_OPTION_SPEC = {
  cwd: { type: 'string' },
  'chat-id': { type: 'string' },
  'bot-token': { type: 'string' },
  'poll-timeout': { type: 'string' },
  profile: { type: 'string' },
  label: { type: 'string' },
  'launch-agent-dir': { type: 'string' },
  'state-dir': { type: 'string' },
  'applications-dir': { type: 'string' },
  'install-menubar': { type: 'boolean' },
  'open-menubar': { type: 'boolean' },
  'no-load': { type: 'boolean' },
  json: { type: 'boolean' }
};

const TELEGRAM_SERVICE_OPTION_SPEC = {
  label: { type: 'string' },
  profile: { type: 'string' },
  'launch-agent-dir': { type: 'string' },
  'state-dir': { type: 'string' },
  'applications-dir': { type: 'string' },
  'remove-menubar': { type: 'boolean' },
  json: { type: 'boolean' }
};


const TELEGRAM_DISPATCH_DETAIL_OPTION_SPEC = {
  label: { type: 'string' },
  profile: { type: 'string' },
  'launch-agent-dir': { type: 'string' },
  'state-dir': { type: 'string' },
  'applications-dir': { type: 'string' },
  index: { type: 'string' },
  json: { type: 'boolean' }
};

const TELEGRAM_TASK_HISTORY_OPTION_SPEC = {
  label: { type: 'string' },
  profile: { type: 'string' },
  'launch-agent-dir': { type: 'string' },
  'state-dir': { type: 'string' },
  'applications-dir': { type: 'string' },
  limit: { type: 'string' },
  json: { type: 'boolean' }
};

export async function runServiceCommand(args) {
  const [provider, subcommand, ...rest] = args;

  if (!provider || provider === '--help' || provider === '-h') {
    process.stdout.write(
      'Usage:\n' +
      '  opencodex service telegram install --cwd <dir> --chat-id <id> [--bot-token <token>] [--poll-timeout <seconds>] [--profile <name>] [--install-menubar] [--open-menubar]\n' +
      '  opencodex service telegram status [--json]\n' +
      '  opencodex service telegram start [--json]\n' +
      '  opencodex service telegram stop [--json]\n' +
      '  opencodex service telegram restart [--json]\n' +
      '  opencodex service telegram set-profile --profile <name> [--json]\n' +
      '  opencodex service telegram send-status [--json]\n' +
      '  opencodex service telegram task-history [--limit <n>] [--json]\n' +
      '  opencodex service telegram dispatch-detail --index <n> [--json]\n' +
      '  opencodex service telegram uninstall [--remove-menubar] [--json]\n'
    );
    return;
  }

  if (provider !== 'telegram') {
    throw new Error(`Unknown service provider: ${provider}`);
  }

  if (subcommand === 'install') {
    await runTelegramServiceInstall(rest);
    return;
  }

  if (subcommand === 'status') {
    await runTelegramServiceStatus(rest);
    return;
  }

  if (subcommand === 'start') {
    await runTelegramServiceStart(rest);
    return;
  }

  if (subcommand === 'stop') {
    await runTelegramServiceStop(rest);
    return;
  }

  if (subcommand === 'restart') {
    await runTelegramServiceRestart(rest);
    return;
  }

  if (subcommand === 'set-profile') {
    await runTelegramServiceSetProfile(rest);
    return;
  }

  if (subcommand === 'send-status') {
    await runTelegramServiceSendStatus(rest);
    return;
  }

  if (subcommand === 'task-history') {
    await runTelegramServiceTaskHistory(rest);
    return;
  }

  if (subcommand === 'dispatch-detail') {
    await runTelegramServiceDispatchDetail(rest);
    return;
  }

  if (subcommand === 'uninstall') {
    await runTelegramServiceUninstall(rest);
    return;
  }

  throw new Error(`Unknown telegram service subcommand: ${subcommand || ''}`.trim());
}

async function runTelegramServiceInstall(args) {
  const { options, positionals } = parseOptions(args, TELEGRAM_INSTALL_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex service telegram install` does not accept positional arguments');
  }

  const cwd = path.resolve(options.cwd || process.cwd());
  if (!(await pathExists(cwd))) {
    throw new Error(`Working directory does not exist: ${cwd}`);
  }
  const chatId = normalizeChatId(options['chat-id']);
  if (!chatId) {
    throw new Error('`opencodex service telegram install` requires `--chat-id <id>`');
  }

  const botToken = resolveTelegramBotToken(options['bot-token']);
  const service = resolveTelegramServiceSettings({ ...options, cwd });
  const envAssignments = collectServiceEnvironment(botToken);

  await ensureDir(service.stateDir);
  await ensureDir(service.launchAgentDir);
  await writeFile(service.envPath, buildEnvironmentFile(envAssignments), 'utf8');
  await chmod(service.envPath, 0o600);

  await writeFile(service.wrapperPath, buildWrapperScript(service), 'utf8');
  await chmod(service.wrapperPath, 0o755);

  await writeFile(service.plistPath, buildLaunchAgentPlist(service), 'utf8');

  if (options['install-menubar']) {
    await compileMenuBarApp(service);
  }

  await writeJson(service.configPath, buildServiceConfig(service, { installed_at: new Date().toISOString() }));

  let launchState = await inspectService(service);
  if (!options['no-load']) {
    launchState = await startService(service);
  }

  if (options['install-menubar'] && options['open-menubar']) {
    await openPath(service.menubarAppPath);
  }

  const payload = {
    ok: true,
    action: 'install',
    installed: true,
    loaded: launchState.loaded,
    label: service.label,
    plist_path: service.plistPath,
    state_dir: service.stateDir,
    menubar_installed: await pathExists(service.menubarAppPath),
    menubar_app_path: service.menubarAppPath,
    stdout_path: service.stdoutPath,
    stderr_path: service.stderrPath,
    cwd: service.cwd,
    chat_id: service.chatId,
    profile: service.profile
  };

  renderServiceOutput(payload, options.json, 'Telegram CTO service installed');
}

async function runTelegramServiceStatus(args) {
  const { options, positionals } = parseOptions(args, TELEGRAM_SERVICE_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex service telegram status` does not accept positional arguments');
  }

  const service = await loadInstalledService(options);
  const payload = await inspectService(service);
  renderServiceOutput(payload, options.json, 'Telegram CTO service status');
}

async function runTelegramServiceStart(args) {
  const { options, positionals } = parseOptions(args, TELEGRAM_SERVICE_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex service telegram start` does not accept positional arguments');
  }

  const service = await loadInstalledService(options);
  const payload = await startService(service);
  renderServiceOutput({ ...payload, action: 'start' }, options.json, 'Telegram CTO service started');
}

async function runTelegramServiceStop(args) {
  const { options, positionals } = parseOptions(args, TELEGRAM_SERVICE_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex service telegram stop` does not accept positional arguments');
  }

  const service = await loadInstalledService(options);
  const payload = await stopService(service);
  renderServiceOutput({ ...payload, action: 'stop' }, options.json, 'Telegram CTO service stopped');
}

async function runTelegramServiceRestart(args) {
  const { options, positionals } = parseOptions(args, TELEGRAM_SERVICE_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex service telegram restart` does not accept positional arguments');
  }

  const service = await loadInstalledService(options);
  await stopService(service, { quietIfStopped: true });
  const payload = await startService(service);
  renderServiceOutput({ ...payload, action: 'restart' }, options.json, 'Telegram CTO service restarted');
}

async function runTelegramServiceSetProfile(args) {
  const { options, positionals } = parseOptions(args, TELEGRAM_SERVICE_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex service telegram set-profile` does not accept positional arguments');
  }

  if (typeof options.profile !== 'string' || !options.profile.trim()) {
    throw new Error('`opencodex service telegram set-profile` requires `--profile <name>`');
  }

  const service = await loadInstalledService(options);
  const existingConfig = await readExistingServiceConfig(service);
  const nextProfile = normalizeProfileName(options.profile, service.cwd);
  const previousProfile = service.profile;

  service.profile = nextProfile;
  await writeFile(service.wrapperPath, buildWrapperScript(service), 'utf8');
  await chmod(service.wrapperPath, 0o755);
  await writeJson(service.configPath, buildServiceConfig(service, {
    ...existingConfig,
    installed_at: existingConfig.installed_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  }));

  const wasLoaded = (await inspectService({ ...service, profile: previousProfile })).loaded;
  let payload = await inspectService(service);
  if (wasLoaded) {
    await stopService({ ...service, profile: previousProfile }, { quietIfStopped: true });
    payload = await startService(service);
  }

  renderServiceOutput({
    ...payload,
    action: 'set-profile',
    previous_profile: previousProfile,
    profile: nextProfile,
    permission_mode: nextProfile
  }, options.json, 'Telegram CTO permission mode updated');
}

async function runTelegramServiceSendStatus(args) {
  const { options, positionals } = parseOptions(args, TELEGRAM_SERVICE_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex service telegram send-status` does not accept positional arguments');
  }

  const service = await loadInstalledService(options);
  const payload = await inspectService(service);
  const environment = await loadServiceEnvironment(service);
  const botToken = (environment.OPENCODEX_TELEGRAM_BOT_TOKEN || '').trim();
  if (!botToken) {
    throw new Error('Telegram bot token is missing from the installed service environment file. Reinstall the service or update the token.');
  }

  const result = await runCommandCapture(process.execPath, [
    CLI_PATH,
    'im', 'telegram', 'send',
    '--cwd', service.cwd,
    '--bot-token', botToken,
    '--chat-id', service.chatId,
    buildTelegramServiceStatusReply(payload)
  ], {
    cwd: service.cwd,
    env: { ...process.env, ...environment }
  });
  if (result.code !== 0) {
    throw new Error(`Telegram status reply failed: ${pickCommandFailure(result)}`);
  }

  renderServiceOutput({
    ...payload,
    ok: true,
    action: 'send-status',
    sent: true,
    status_reply: buildTelegramServiceStatusReply(payload)
  }, options.json, 'Telegram CTO status reply sent');
}

async function runTelegramServiceTaskHistory(args) {
  const { options, positionals } = parseOptions(args, TELEGRAM_TASK_HISTORY_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex service telegram task-history` does not accept positional arguments');
  }

  const limit = typeof options.limit === 'string' && options.limit.trim()
    ? parsePositiveInteger(options.limit, '--limit')
    : 30;
  const service = await loadInstalledService(options);
  const history = await collectDispatchHistory(service.cwd);
  const items = history.slice(0, limit);
  renderTaskHistoryOutput({ ok: true, total_count: history.length, items }, options.json, 'Telegram CTO task history');
}

async function runTelegramServiceDispatchDetail(args) {
  const { options, positionals } = parseOptions(args, TELEGRAM_DISPATCH_DETAIL_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex service telegram dispatch-detail` does not accept positional arguments');
  }

  const index = parsePositiveInteger(options.index, '--index');
  const service = await loadInstalledService(options);
  const items = await collectDispatchHistory(service.cwd);
  const dispatch = Array.isArray(items) ? items[index - 1] : null;
  if (!dispatch) {
    throw new Error(`Dispatch index out of range: ${index}`);
  }

  const detailPayload = await buildDispatchDetailPayload(service.cwd, dispatch, index);
  renderDispatchDetailOutput(detailPayload, options.json, `Telegram CTO dispatch detail #${index}`);
}

async function runTelegramServiceUninstall(args) {
  const { options, positionals } = parseOptions(args, TELEGRAM_SERVICE_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex service telegram uninstall` does not accept positional arguments');
  }

  const service = await loadInstalledService(options);
  await stopService(service, { quietIfStopped: true });
  await rm(service.plistPath, { force: true });
  await rm(service.wrapperPath, { force: true });
  await rm(service.envPath, { force: true });
  await rm(service.configPath, { force: true });
  await rm(service.menubarSourcePath, { force: true });
  if (options['remove-menubar']) {
    await rm(service.menubarAppPath, { recursive: true, force: true });
  }

  const payload = {
    ok: true,
    action: 'uninstall',
    installed: false,
    loaded: false,
    label: service.label,
    plist_path: service.plistPath,
    state_dir: service.stateDir,
    menubar_installed: await pathExists(service.menubarAppPath),
    menubar_app_path: service.menubarAppPath
  };

  renderServiceOutput(payload, options.json, 'Telegram CTO service uninstalled');
}

function resolveTelegramServiceSettings(options) {
  const homeDir = path.resolve(options['home-dir'] || os.homedir());
  const stateDir = path.resolve(options['state-dir'] || path.join(homeDir, '.opencodex', 'service', 'telegram'));
  const launchAgentDir = path.resolve(options['launch-agent-dir'] || path.join(homeDir, 'Library', 'LaunchAgents'));
  const applicationsDir = path.resolve(options['applications-dir'] || path.join(homeDir, 'Applications'));
  const label = typeof options.label === 'string' && options.label.trim() ? options.label.trim() : DEFAULT_LABEL;
  const chatId = normalizeChatId(options['chat-id']);
  const pollTimeout = parseNonNegativeInteger(options['poll-timeout'] || DEFAULT_POLL_TIMEOUT, '--poll-timeout');
  const requestedProfile = typeof options.profile === 'string' && options.profile.trim() ? options.profile.trim() : DEFAULT_PROFILE;
  const profile = normalizeProfileName(requestedProfile, options.cwd || process.cwd());

  return {
    homeDir,
    cwd: path.resolve(options.cwd || process.cwd()),
    label,
    chatId,
    pollTimeout,
    profile,
    stateDir,
    launchAgentDir,
    applicationsDir,
    configPath: path.join(stateDir, SERVICE_CONFIG_FILE),
    plistPath: path.join(launchAgentDir, `${label}.plist`),
    envPath: path.join(stateDir, 'telegram.env'),
    wrapperPath: path.join(stateDir, 'telegram-listener.sh'),
    stdoutPath: path.join(stateDir, 'service.stdout.log'),
    stderrPath: path.join(stateDir, 'service.stderr.log'),
    menubarAppPath: path.join(applicationsDir, DEFAULT_MENU_BAR_APP_NAME),
    menubarSourcePath: path.join(stateDir, 'OpenCodexTray.applescript')
  };
}

async function loadInstalledService(options) {
  const service = resolveTelegramServiceSettings(options);
  if (await pathExists(service.configPath)) {
    const config = await readJson(service.configPath);
    return {
      ...service,
      cwd: config.cwd || service.cwd,
      label: config.label || service.label,
      chatId: config.chat_id || service.chatId,
      pollTimeout: Number.isInteger(config.poll_timeout) ? config.poll_timeout : service.pollTimeout,
      profile: config.profile || config.permission_mode || service.profile,
      launchAgentDir: config.launch_agent_dir || service.launchAgentDir,
      stateDir: config.state_dir || service.stateDir,
      applicationsDir: config.applications_dir || service.applicationsDir,
      configPath: service.configPath,
      plistPath: config.plist_path || service.plistPath,
      envPath: config.env_path || service.envPath,
      wrapperPath: config.wrapper_path || service.wrapperPath,
      stdoutPath: config.stdout_path || service.stdoutPath,
      stderrPath: config.stderr_path || service.stderrPath,
      menubarAppPath: config.menubar_app_path || service.menubarAppPath,
      menubarSourcePath: config.menubar_source_path || service.menubarSourcePath
    };
  }

  if (!(await pathExists(service.plistPath))) {
    throw new Error('No installed Telegram CTO service found. Run `opencodex service telegram install` first.');
  }

  return service;
}

async function readExistingServiceConfig(service) {
  if (!(await pathExists(service.configPath))) {
    return {};
  }

  try {
    return await readJson(service.configPath);
  } catch {
    return {};
  }
}

function buildServiceConfig(service, overrides = {}) {
  return {
    ...overrides,
    provider: 'telegram',
    label: service.label,
    cwd: service.cwd,
    chat_id: service.chatId,
    poll_timeout: service.pollTimeout,
    profile: service.profile,
    permission_mode: service.profile,
    launch_agent_dir: service.launchAgentDir,
    state_dir: service.stateDir,
    applications_dir: service.applicationsDir,
    plist_path: service.plistPath,
    env_path: service.envPath,
    wrapper_path: service.wrapperPath,
    stdout_path: service.stdoutPath,
    stderr_path: service.stderrPath,
    menubar_app_path: service.menubarAppPath,
    menubar_source_path: service.menubarSourcePath,
    node_path: process.execPath,
    cli_path: CLI_PATH,
    codex_bin: getCodexBin()
  };
}

function normalizeProfileName(profileName, cwd) {
  return resolveCodexProfile(profileName, 'run', cwd).name;
}

function formatPermissionMode(profileName) {
  if (profileName === 'full-access') {
    return 'Full Access';
  }
  if (profileName === 'balanced') {
    return 'Balanced';
  }
  if (profileName === 'safe') {
    return 'Safe';
  }
  return profileName || 'Unknown';
}

async function inspectService(service) {
  const installed = await pathExists(service.plistPath);
  const menubarInstalled = await pathExists(service.menubarAppPath);
  const workflowStats = await collectWorkflowStats(service);
  if (!installed) {
    return {
      ok: true,
      installed: false,
      loaded: false,
      state: 'missing',
      pid: null,
      label: service.label,
      plist_path: service.plistPath,
      state_dir: service.stateDir,
      stdout_path: service.stdoutPath,
      stderr_path: service.stderrPath,
      menubar_installed: menubarInstalled,
      menubar_app_path: service.menubarAppPath,
      cwd: service.cwd,
      chat_id: service.chatId,
      profile: service.profile,
      permission_mode: service.profile,
      ...workflowStats
    };
  }

  const launchctl = resolveLaunchctlBin();
  const domainTarget = buildLaunchdTarget(service.label);
  const result = await runCommandCapture(launchctl, ['print', domainTarget], { cwd: service.cwd });
  const rawOutput = `${result.stdout || ''}${result.stderr || ''}`;
  const pidMatch = rawOutput.match(/pid\s*=\s*(\d+)/);
  const stateMatch = rawOutput.match(/state\s*=\s*([^\n]+)/);

  return {
    ok: true,
    installed: true,
    loaded: result.code === 0,
    state: result.code === 0 ? (stateMatch?.[1]?.trim() || 'loaded') : 'stopped',
    pid: pidMatch ? Number.parseInt(pidMatch[1], 10) : null,
    label: service.label,
    plist_path: service.plistPath,
    state_dir: service.stateDir,
    stdout_path: service.stdoutPath,
    stderr_path: service.stderrPath,
    menubar_installed: menubarInstalled,
    menubar_app_path: service.menubarAppPath,
    cwd: service.cwd,
    chat_id: service.chatId,
    profile: service.profile,
    permission_mode: service.profile,
    launchctl_output: rawOutput.trim(),
    ...workflowStats
  };
}

async function loadWorkflowInfos(cwd, sessions, limit = 24) {
  return Promise.all((sessions || []).slice(0, limit).map(async (session) => ({
    session,
    ...(await resolveWorkflowStateInfo(cwd, session))
  })));
}

async function collectDispatchHistory(cwd, options = {}) {
  let sessions = [];
  try {
    sessions = await listSessions(cwd);
  } catch {
    sessions = [];
  }

  const workflowInfos = await loadWorkflowInfos(cwd, sessions.filter((session) => session.command === 'cto'), options.workflow_limit || 100);
  const history = collectRecentDispatchRecords(cwd, workflowInfos);
  return typeof options.limit === 'number' ? history.slice(0, options.limit) : history;
}

async function collectWorkflowStats(service) {
  let sessions = [];
  try {
    sessions = await listSessions(service.cwd);
  } catch {
    sessions = [];
  }

  const ctoSessions = sessions.filter((session) => session.command === 'cto');
  const runningSessions = ctoSessions.filter((session) => session.status === 'running');
  const waitingSessions = ctoSessions.filter((session) => session.status === 'partial');
  const trackedSessions = [...runningSessions, ...waitingSessions];
  const latestWorkflow = ctoSessions[0] || null;
  const latestListener = sessions.find((session) => session.command === 'im' && session.input?.arguments?.provider === 'telegram') || null;
  const latestWorkflowInfo = latestWorkflow ? await resolveLatestWorkflowInfo(service.cwd, latestWorkflow) : null;
  const workflowInfos = await loadWorkflowInfos(service.cwd, ctoSessions, 24);
  const trackedWorkflowStates = workflowInfos
    .filter((item) => item.session.status === 'running' || item.session.status === 'partial')
    .map((item) => item.workflowState);
  const taskTotals = trackedWorkflowStates.reduce((sum, workflowState) => {
    const counts = summarizeWorkflowTaskCounts(workflowState);
    sum.running += counts.running;
    sum.queued += counts.queued;
    sum.total += counts.total;
    return sum;
  }, { running: 0, queued: 0, total: 0 });
  const dispatchHistory = collectRecentDispatchRecords(service.cwd, workflowInfos);
  const recentDispatches = dispatchHistory.slice(0, 5);

  return {
    running_workflow_count: runningSessions.length,
    waiting_workflow_count: waitingSessions.length,
    running_task_count: taskTotals.running,
    queued_task_count: taskTotals.queued,
    tracked_task_count: taskTotals.total,
    dispatch_history_count: dispatchHistory.length,
    recent_dispatch_count: recentDispatches.length,
    recent_dispatches: recentDispatches,
    main_thread_count: trackedSessions.length,
    child_thread_count: trackedSessions.reduce((sum, session) => sum + normalizeChildSessionRefs(session.child_sessions).length, 0),
    latest_listener_session_id: latestListener?.session_id || '',
    latest_listener_session_path: latestListener ? path.join(getSessionDir(service.cwd, latestListener.session_id), 'session.json') : '',
    latest_workflow_session_id: latestWorkflowInfo?.session_id || '',
    latest_workflow_status: latestWorkflowInfo?.status || '',
    latest_workflow_goal: latestWorkflowInfo?.goal || '',
    latest_workflow_result: latestWorkflowInfo?.result || '',
    latest_workflow_updated_at: latestWorkflowInfo?.updated_at || '',
    latest_workflow_path: latestWorkflowInfo?.path || '',
    latest_workflow_state_path: latestWorkflowInfo?.state_path || '',
    latest_workflow_session_path: latestWorkflowInfo?.session_path || '',
    latest_workflow_pending_question: latestWorkflowInfo?.pending_question || '',
    latest_workflow_child_thread_count: latestWorkflowInfo?.child_thread_count || 0
  };
}

async function resolveLatestWorkflowInfo(cwd, session) {
  const workflowInfo = await resolveWorkflowStateInfo(cwd, session);
  const { sessionPath, workflowStatePath, workflowState } = workflowInfo;

  return {
    session_id: session.session_id,
    status: workflowState?.status === 'waiting_for_user' || session.status === 'partial' ? 'waiting' : session.status,
    goal: workflowState?.goal_text || session.input?.prompt || '',
    result: session.summary?.result || '',
    updated_at: workflowState?.updated_at || session.updated_at || '',
    path: workflowStatePath || sessionPath,
    state_path: workflowStatePath,
    session_path: sessionPath,
    pending_question: workflowState?.pending_question_zh || '',
    child_thread_count: normalizeChildSessionRefs(session.child_sessions).length
  };
}

async function resolveWorkflowStateInfo(cwd, session) {
  const sessionPath = path.join(getSessionDir(cwd, session.session_id), 'session.json');
  const workflowArtifact = Array.isArray(session.artifacts)
    ? session.artifacts.find((item) => item?.type === 'cto_workflow' && typeof item.path === 'string' && item.path)
    : null;
  const workflowStatePath = workflowArtifact?.path || '';
  let workflowState = session.workflow_state && typeof session.workflow_state === 'object'
    ? session.workflow_state
    : null;

  if ((!workflowState || !Array.isArray(workflowState.tasks)) && workflowStatePath && await pathExists(workflowStatePath)) {
    try {
      workflowState = await readJson(workflowStatePath);
    } catch {
      workflowState = workflowState || null;
    }
  }

  return {
    sessionPath,
    workflowStatePath,
    workflowState
  };
}

function normalizeChildSessionRefs(childSessions) {
  if (!Array.isArray(childSessions)) {
    return [];
  }

  return childSessions.filter((entry) => typeof entry?.session_id === 'string' && entry.session_id);
}
function summarizeWorkflowTaskCounts(workflowState) {
  const counts = {
    total: 0,
    queued: 0,
    running: 0
  };

  if (!Array.isArray(workflowState?.tasks)) {
    return counts;
  }

  for (const task of workflowState.tasks) {
    counts.total += 1;
    if (task?.status === 'queued') {
      counts.queued += 1;
    }
    if (task?.status === 'running') {
      counts.running += 1;
    }
  }

  return counts;
}

function collectRecentDispatchRecords(cwd, workflowInfos) {
  return (workflowInfos || [])
    .flatMap((workflowInfo) => buildDispatchRecordsFromWorkflowInfo(cwd, workflowInfo))
    .sort((left, right) => String(right.updated_at || '').localeCompare(String(left.updated_at || '')));
}

function buildDispatchRecordsFromWorkflowInfo(cwd, workflowInfo) {
  const workflowState = workflowInfo?.workflowState;
  const session = workflowInfo?.session;
  const workflowStatePath = workflowInfo?.workflowStatePath || '';
  const sessionPath = workflowInfo?.sessionPath || '';
  if (!session || !Array.isArray(workflowState?.tasks)) {
    return [];
  }

  return workflowState.tasks
    .filter((task) => isDispatchRecord(task))
    .map((task) => {
      const sessionId = typeof task?.session_id === 'string' ? task.session_id : '';
      const childSessionPath = sessionId ? path.join(getSessionDir(cwd, sessionId), 'session.json') : '';
      const fallbackPath = workflowStatePath || sessionPath;
      const status = normalizeDispatchStatus(task?.status);
      const taskId = typeof task?.id === 'string' ? task.id : '';
      const title = typeof task?.title === 'string' ? task.title : '';
      return {
        workflow_session_id: session.session_id,
        task_id: taskId,
        title,
        status,
        session_id: sessionId,
        path: childSessionPath || fallbackPath,
        updated_at: typeof task?.updated_at === 'string' && task.updated_at ? task.updated_at : (workflowState?.updated_at || session.updated_at || ''),
        label: `[${status}] ${truncateInline(taskId || title || 'task', 32)} — ${truncateInline(title || taskId || 'Untitled task', 72)}`
      };
    });
}

function isDispatchRecord(task) {
  if (!task || typeof task !== 'object') {
    return false;
  }
  if (typeof task.session_id === 'string' && task.session_id) {
    return true;
  }
  return ['running', 'completed', 'failed', 'partial'].includes(task.status);
}

function normalizeDispatchStatus(status) {
  if (typeof status !== 'string' || !status) {
    return 'unknown';
  }
  return status;
}

async function startService(service) {
  const current = await inspectService(service);
  if (current.loaded) {
    return current;
  }

  const launchctl = resolveLaunchctlBin();
  const domain = buildLaunchdDomain();
  const bootstrap = await runCommandCapture(launchctl, ['bootstrap', domain, service.plistPath], { cwd: service.cwd });
  if (bootstrap.code !== 0) {
    throw new Error(`launchctl bootstrap failed: ${pickCommandFailure(bootstrap)}`);
  }

  const kickstart = await runCommandCapture(launchctl, ['kickstart', '-k', buildLaunchdTarget(service.label)], { cwd: service.cwd });
  if (kickstart.code !== 0) {
    throw new Error(`launchctl kickstart failed: ${pickCommandFailure(kickstart)}`);
  }

  return inspectService(service);
}

async function stopService(service, options = {}) {
  const current = await inspectService(service);
  if (!current.loaded) {
    if (options.quietIfStopped) {
      return current;
    }
    return current;
  }

  const launchctl = resolveLaunchctlBin();
  const bootout = await runCommandCapture(launchctl, ['bootout', buildLaunchdTarget(service.label)], { cwd: service.cwd });
  if (bootout.code !== 0) {
    throw new Error(`launchctl bootout failed: ${pickCommandFailure(bootout)}`);
  }

  return inspectService(service);
}

function renderServiceOutput(payload, json, title) {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  const lines = [title, ''];
  lines.push(`Installed: ${payload.installed ? 'yes' : 'no'}`);
  lines.push(`Loaded: ${payload.loaded ? 'yes' : 'no'}`);
  lines.push(`Label: ${payload.label}`);
  if (payload.state) {
    lines.push(`State: ${payload.state}`);
  }
  if (payload.pid) {
    lines.push(`PID: ${payload.pid}`);
  }
  if (payload.chat_id) {
    lines.push(`Chat: ${payload.chat_id}`);
  }
  if (payload.permission_mode || payload.profile) {
    lines.push(`Permission Mode: ${formatPermissionMode(payload.permission_mode || payload.profile)}`);
    lines.push(`Profile: ${payload.profile || payload.permission_mode}`);
  }
  lines.push(`Running Workflows: ${payload.running_workflow_count ?? 0}`);
  lines.push(`Waiting Workflows: ${payload.waiting_workflow_count ?? 0}`);
  lines.push(`Running Tasks: ${payload.running_task_count ?? 0}`);
  lines.push(`Queued Tasks: ${payload.queued_task_count ?? 0}`);
  lines.push(`Task History: ${payload.dispatch_history_count ?? 0}`);
  lines.push(`Main Threads: ${payload.main_thread_count ?? 0}`);
  lines.push(`Child Threads: ${payload.child_thread_count ?? 0}`);
  if (payload.latest_workflow_session_id) {
    lines.push(`Latest Workflow: ${payload.latest_workflow_session_id}`);
    lines.push(`Latest Workflow Status: ${payload.latest_workflow_status || 'unknown'}`);
    if (payload.latest_workflow_goal) {
      lines.push(`Latest Workflow Goal: ${truncateInline(payload.latest_workflow_goal, 160)}`);
    }
    if (payload.latest_workflow_pending_question) {
      lines.push(`Latest Workflow Pending: ${truncateInline(payload.latest_workflow_pending_question, 160)}`);
    }
    if (payload.latest_workflow_updated_at) {
      lines.push(`Latest Workflow Updated: ${payload.latest_workflow_updated_at}`);
    }
    if (payload.latest_workflow_path) {
      lines.push(`Latest Workflow Path: ${payload.latest_workflow_path}`);
    }
  }
  if (payload.latest_listener_session_id) {
    lines.push(`Latest Listener Session: ${payload.latest_listener_session_id}`);
  }
  if (Array.isArray(payload.recent_dispatches)) {
    payload.recent_dispatches.slice(0, 5).forEach((dispatch, index) => {
      lines.push(`Dispatch ${index + 1}: ${dispatch.label}`);
      if (dispatch.path) {
        lines.push(`Dispatch ${index + 1} Path: ${dispatch.path}`);
      }
    });
  }
  lines.push(`Plist: ${payload.plist_path}`);
  lines.push(`State Dir: ${payload.state_dir}`);
  lines.push(`Stdout Log: ${payload.stdout_path}`);
  lines.push(`Stderr Log: ${payload.stderr_path}`);
  lines.push(`Menu Bar App: ${payload.menubar_installed ? 'installed' : 'missing'}`);
  if (payload.menubar_app_path) {
    lines.push(`Menu Bar Path: ${payload.menubar_app_path}`);
  }
  if (payload.action === 'send-status' && payload.sent) {
    lines.push('Status Reply: sent');
  }
  process.stdout.write(lines.join('\n') + '\n');
}

function renderTaskHistoryOutput(payload, json, title) {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  const lines = [title, ''];
  lines.push(`Total: ${payload.total_count ?? 0}`);
  if (Array.isArray(payload.items)) {
    payload.items.forEach((item, index) => {
      lines.push(`History ${index + 1}: ${item.label}`);
      if (item.updated_at) {
        lines.push(`History ${index + 1} Updated: ${item.updated_at}`);
      }
      if (item.workflow_session_id) {
        lines.push(`History ${index + 1} Workflow: ${item.workflow_session_id}`);
      }
      if (item.session_id) {
        lines.push(`History ${index + 1} Session: ${item.session_id}`);
      }
    });
  }

  process.stdout.write(lines.join('\n') + '\n');
}

async function buildDispatchDetailPayload(cwd, dispatch, index) {
  const workflowSessionId = typeof dispatch?.workflow_session_id === 'string' ? dispatch.workflow_session_id : '';
  const workflowSessionPath = workflowSessionId ? path.join(getSessionDir(cwd, workflowSessionId), 'session.json') : '';
  const workflowSession = await loadJsonIfExists(workflowSessionPath);
  const workflowInfo = workflowSession
    ? await resolveWorkflowStateInfo(cwd, workflowSession)
    : { sessionPath: workflowSessionPath, workflowStatePath: '', workflowState: null };

  let sessionId = typeof dispatch?.session_id === 'string' ? dispatch.session_id : '';
  let sessionPath = sessionId ? path.join(getSessionDir(cwd, sessionId), 'session.json') : '';
  let session = await loadJsonIfExists(sessionPath);

  if (!session && typeof dispatch?.path === 'string' && dispatch.path.endsWith('session.json')) {
    sessionPath = dispatch.path;
    session = await loadJsonIfExists(sessionPath);
    if (!sessionId) {
      sessionId = typeof session?.session_id === 'string' ? session.session_id : '';
    }
  }

  const sessionDir = sessionPath ? path.dirname(sessionPath) : (sessionId ? getSessionDir(cwd, sessionId) : '');
  const eventsArtifactPath = Array.isArray(session?.artifacts)
    ? session.artifacts.find((item) => item?.type === 'jsonl_events' && typeof item.path === 'string' && item.path)?.path || ''
    : '';
  const lastMessageArtifactPath = Array.isArray(session?.artifacts)
    ? session.artifacts.find((item) => item?.type === 'last_message' && typeof item.path === 'string' && item.path)?.path || ''
    : '';
  const eventsPath = await resolveFirstExistingPath([
    eventsArtifactPath,
    sessionDir ? path.join(sessionDir, 'events.jsonl') : ''
  ]);
  const lastMessagePath = await resolveFirstExistingPath([
    lastMessageArtifactPath,
    sessionDir ? path.join(sessionDir, 'last-message.txt') : ''
  ]);
  const workflowState = workflowInfo.workflowState && typeof workflowInfo.workflowState === 'object'
    ? workflowInfo.workflowState
    : null;
  const summary = session?.summary && typeof session.summary === 'object'
    ? session.summary
    : {};
  const lastMessage = (await readTextIfExists(lastMessagePath)) || '';
  const recentActivity = summarizeRecentEvents((await readTextIfExists(eventsPath)) || '');
  const recordPath = await resolveFirstExistingPath([
    typeof dispatch?.path === 'string' ? dispatch.path : '',
    sessionPath,
    workflowInfo.workflowStatePath,
    workflowInfo.sessionPath
  ]);

  return {
    ok: true,
    index,
    workflow_session_id: workflowSessionId,
    workflow_session_path: workflowInfo.sessionPath || workflowSessionPath,
    workflow_state_path: workflowInfo.workflowStatePath || '',
    workflow_goal: workflowState?.goal_text || workflowSession?.input?.prompt || '',
    workflow_status: workflowState?.status || workflowSession?.status || '',
    pending_question: workflowState?.pending_question_zh || '',
    task_id: typeof dispatch?.task_id === 'string' ? dispatch.task_id : '',
    title: typeof dispatch?.title === 'string' && dispatch.title ? dispatch.title : (summary.title || ''),
    status: typeof dispatch?.status === 'string' && dispatch.status ? dispatch.status : (summary.status || session?.status || 'unknown'),
    session_id: sessionId,
    updated_at: typeof dispatch?.updated_at === 'string' && dispatch.updated_at ? dispatch.updated_at : (session?.updated_at || workflowState?.updated_at || workflowSession?.updated_at || ''),
    result: typeof summary.result === 'string' ? summary.result : '',
    highlights: Array.isArray(summary.highlights) ? summary.highlights : [],
    validation: Array.isArray(summary.validation) ? summary.validation : [],
    changed_files: Array.isArray(summary.changed_files) ? summary.changed_files : [],
    next_steps: Array.isArray(summary.next_steps) ? summary.next_steps : [],
    findings: Array.isArray(summary.findings) ? summary.findings : [],
    recent_activity: recentActivity,
    last_message: truncateMultiline(lastMessage, 360, 5),
    record_path: recordPath,
    session_path: sessionPath,
    events_path: eventsPath,
    last_message_path: lastMessagePath
  };
}

function renderDispatchDetailOutput(payload, json, title) {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  const lines = [title, ''];
  lines.push(`Index: ${payload.index}`);
  if (payload.workflow_session_id) {
    lines.push(`Workflow: ${payload.workflow_session_id}`);
  }
  if (payload.workflow_status) {
    lines.push(`Workflow Status: ${payload.workflow_status}`);
  }
  if (payload.workflow_goal) {
    lines.push(`Workflow Goal: ${truncateInline(payload.workflow_goal, 160)}`);
  }
  if (payload.pending_question) {
    lines.push(`Pending Question: ${truncateInline(payload.pending_question, 160)}`);
  }
  if (payload.task_id) {
    lines.push(`Task: ${payload.task_id}`);
  }
  if (payload.title) {
    lines.push(`Title: ${truncateInline(payload.title, 160)}`);
  }
  lines.push(`Status: ${payload.status || 'unknown'}`);
  if (payload.updated_at) {
    lines.push(`Updated: ${payload.updated_at}`);
  }
  if (payload.session_id) {
    lines.push(`Session: ${payload.session_id}`);
  }
  if (payload.result) {
    lines.push(`Result: ${truncateInline(payload.result, 220)}`);
  }
  appendDispatchDetailSection(lines, 'Highlights', payload.highlights, 3, 120);
  appendDispatchDetailSection(lines, 'Validation', payload.validation, 3, 120);
  appendDispatchDetailSection(lines, 'Changed Files', payload.changed_files, 5, 140);
  appendDispatchDetailSection(lines, 'Next Steps', payload.next_steps, 3, 120);
  appendDispatchDetailSection(lines, 'Recent Activity', payload.recent_activity, 4, 140);
  if (payload.last_message) {
    lines.push('Last Message:');
    for (const line of payload.last_message.split('\n')) {
      if (line.trim()) {
        lines.push(`- ${line}`);
      }
    }
  }
  if (payload.record_path) {
    lines.push(`Record Path: ${payload.record_path}`);
  }
  if (payload.session_path) {
    lines.push(`Session Path: ${payload.session_path}`);
  }
  if (payload.events_path) {
    lines.push(`Events Path: ${payload.events_path}`);
  }
  if (payload.last_message_path) {
    lines.push(`Last Message Path: ${payload.last_message_path}`);
  }

  process.stdout.write(lines.join('\n') + '\n');
}

function appendDispatchDetailSection(lines, heading, items, maxCount, maxLength) {
  const entries = Array.isArray(items)
    ? items.map((item) => truncateInline(item, maxLength)).filter(Boolean).slice(0, maxCount)
    : [];
  if (!entries.length) {
    return;
  }

  lines.push(`${heading}:`);
  for (const entry of entries) {
    lines.push(`- ${entry}`);
  }
}

async function loadJsonIfExists(filePath) {
  if (!filePath) {
    return null;
  }
  if (!(await pathExists(filePath))) {
    return null;
  }
  try {
    return await readJson(filePath);
  } catch {
    return null;
  }
}

async function resolveFirstExistingPath(candidates) {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate) {
      continue;
    }
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return candidates.find((candidate) => typeof candidate === 'string' && candidate) || '';
}

function summarizeRecentEvents(rawEvents) {
  const rawLines = String(rawEvents || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (!rawLines.length) {
    return [];
  }

  const recent = [];
  for (const line of rawLines.slice(-12)) {
    const summary = summarizeEventLine(line);
    if (!summary || recent.includes(summary)) {
      continue;
    }
    recent.push(summary);
  }

  return recent.slice(-4);
}

function summarizeEventLine(line) {
  let parsed = null;
  try {
    parsed = JSON.parse(line);
  } catch {
    parsed = null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return truncateInline(line, 140);
  }

  const eventType = typeof parsed.type === 'string' && parsed.type ? parsed.type : (typeof parsed.event === 'string' ? parsed.event : 'event');
  const eventText = extractEventText(parsed);
  if (!eventText) {
    return `[${eventType}]`;
  }
  return `[${eventType}] ${truncateInline(eventText, 120)}`;
}

function extractEventText(value, depth = 0) {
  if (depth > 4 || value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = extractEventText(item, depth + 1);
      if (nested) {
        return nested;
      }
    }
    return '';
  }
  if (typeof value !== 'object') {
    return '';
  }

  for (const key of ['message', 'text', 'delta', 'content', 'result', 'summary', 'title']) {
    if (Object.hasOwn(value, key)) {
      const nested = extractEventText(value[key], depth + 1);
      if (nested) {
        return nested;
      }
    }
  }

  for (const nestedValue of Object.values(value)) {
    const nested = extractEventText(nestedValue, depth + 1);
    if (nested) {
      return nested;
    }
  }

  return '';
}

function truncateMultiline(value, maxLength = 360, maxLines = 5) {
  const normalizedLines = String(value || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (!normalizedLines.length) {
    return '';
  }

  let text = normalizedLines.slice(0, maxLines).join('\n');
  if (normalizedLines.length > maxLines || text.length > maxLength) {
    text = `${text.slice(0, maxLength - 1).trimEnd()}…`;
  }
  return text;
}

function collectServiceEnvironment(botToken) {

  const environment = new Map();
  environment.set('PATH', process.env.PATH || '');
  environment.set('OPENCODEX_TELEGRAM_BOT_TOKEN', botToken);
  environment.set('NODE_USE_ENV_PROXY', process.env.NODE_USE_ENV_PROXY || '1');

  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'OPENCODEX_CODEX_BIN']) {
    if (typeof process.env[key] === 'string' && process.env[key].trim()) {
      environment.set(key, process.env[key]);
    }
  }

  return environment;
}

function buildEnvironmentFile(environment) {
  const lines = ['#!/bin/zsh', 'set -euo pipefail'];
  for (const [key, value] of environment.entries()) {
    lines.push(`export ${key}=${shellQuote(value)}`);
  }
  return `${lines.join('\n')}\n`;
}

function buildWrapperScript(service) {
  return [
    '#!/bin/zsh',
    'set -euo pipefail',
    `source ${shellQuote(service.envPath)}`,
    `cd ${shellQuote(service.cwd)}`,
    `exec ${shellQuote(process.execPath)} ${shellQuote(CLI_PATH)} im telegram listen --cwd ${shellQuote(service.cwd)} --chat-id ${shellQuote(service.chatId)} --poll-timeout ${shellQuote(String(service.pollTimeout))} --cto --profile ${shellQuote(service.profile)}`
  ].join('\n') + '\n';
}

function buildLaunchAgentPlist(service) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(service.label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(service.wrapperPath)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>${escapeXml(service.cwd)}</string>
  <key>StandardOutPath</key>
  <string>${escapeXml(service.stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(service.stderrPath)}</string>
  <key>ProcessType</key>
  <string>Background</string>
  <key>ThrottleInterval</key>
  <integer>5</integer>
</dict>
</plist>
`;
}

async function compileMenuBarApp(service) {
  await ensureDir(service.applicationsDir);
  await writeFile(service.menubarSourcePath, buildMenuBarAppleScript(service), 'utf8');
  await rm(service.menubarAppPath, { recursive: true, force: true });

  const osacompile = resolveOsacompileBin();
  const compiled = await runCommandCapture(osacompile, ['-s', '-o', service.menubarAppPath, service.menubarSourcePath], {
    cwd: service.cwd
  });
  if (compiled.code !== 0) {
    throw new Error(`osacompile failed: ${pickCommandFailure(compiled)}`);
  }

  const infoPlistPath = path.join(service.menubarAppPath, 'Contents', 'Info.plist');
  if (await pathExists(infoPlistPath)) {
    const infoPlist = await readFile(infoPlistPath, 'utf8');
    if (!infoPlist.includes('<key>LSUIElement</key>')) {
      const patched = infoPlist.replace('</dict>', '  <key>LSUIElement</key>\n  <true/>\n</dict>');
      await writeFile(infoPlistPath, patched, 'utf8');
    }
  }
}

function buildMenuBarAppleScript(service) {
  return `use AppleScript version "2.4"
use framework "Foundation"
use framework "AppKit"
use scripting additions

property statusItem : missing value
property statusMenu : missing value
property nodePath : ${appleScriptString(process.execPath)}
property cliPath : ${appleScriptString(CLI_PATH)}
property stateDir : ${appleScriptString(service.stateDir)}
property repoPath : ${appleScriptString(service.cwd)}
property stdoutPath : ${appleScriptString(service.stdoutPath)}
property appTitle : "openCodex CTO"

on run
	my setupMenuBar()
end run

on reopen
	my refreshStatus()
end reopen

on idle
	my refreshStatus()
	return 15
end idle

on setupMenuBar()
	set theApp to current application's NSApplication's sharedApplication()
	theApp's setActivationPolicy_(current application's NSApplicationActivationPolicyAccessory)
	set statusItem to current application's NSStatusBar's systemStatusBar()'s statusItemWithLength_(current application's NSVariableStatusItemLength)
	set statusMenu to current application's NSMenu's alloc()'s initWithTitle_(appTitle)
	statusItem's setMenu_(statusMenu)
	my refreshStatus()
end setupMenuBar

on rebuildMenu(statusText)
	statusMenu's removeAllItems()
	my addInfoItem("Service: " & my lineValue(statusText, "State: ", "unknown") & " • " & my detectMode(statusText))
	my addInfoItem("Workflows: running " & my lineValue(statusText, "Running Workflows: ", "0") & " • waiting " & my lineValue(statusText, "Waiting Workflows: ", "0"))
	my addInfoItem("Tasks: running " & my lineValue(statusText, "Running Tasks: ", "0") & " • queued " & my lineValue(statusText, "Queued Tasks: ", "0"))
	my addInfoItem("History: total " & my lineValue(statusText, "Task History: ", "0"))
	my addInfoItem("Threads: main " & my lineValue(statusText, "Main Threads: ", "0") & " • child " & my lineValue(statusText, "Child Threads: ", "0"))
	set latestWorkflowId to my lineValue(statusText, "Latest Workflow: ", "")
	if latestWorkflowId is not "" then
		set latestWorkflowStatus to my lineValue(statusText, "Latest Workflow Status: ", "unknown")
		my addInfoItem("Latest: " & latestWorkflowId & " (" & latestWorkflowStatus & ")")
		set latestGoal to my lineValue(statusText, "Latest Workflow Goal: ", "")
		if latestGoal is not "" then my addInfoItem("Goal: " & my truncateText(latestGoal, 72))
	end if
	set firstDispatch to my lineValue(statusText, "Dispatch 1: ", "")
	if firstDispatch is not "" then
		my addSeparator()
		my addInfoItem("Recent Dispatches")
		repeat with dispatchIndex from 1 to 5
			set dispatchTitle to my lineValue(statusText, "Dispatch " & dispatchIndex & ": ", "")
			if dispatchTitle is not "" then
				my addMenuItem(my truncateText(dispatchTitle, 84), "openDispatch" & dispatchIndex & ":")
			end if
		end repeat
	end if
	my addMenuItem("Browse Task History… (" & my lineValue(statusText, "Task History: ", "0") & ")", "browseTaskHistory:")
	my addSeparator()
	my addMenuItem("Show Status", "showStatus:")
	my addMenuItem("Start CTO Service", "startService:")
	my addMenuItem("Stop CTO Service", "stopService:")
	my addMenuItem("Restart CTO Service", "restartService:")
	my addSeparator()
	my addMenuItem("Use Safe Mode (Read-Only)", "useSafeMode:")
	my addMenuItem("Use Balanced Mode", "useBalancedMode:")
	my addMenuItem("Use Full Access Mode", "useFullAccessMode:")
	my addSeparator()
	my addMenuItem("Open Repo", "openRepo:")
	my addMenuItem("Open Logs", "openLogs:")
	my addMenuItem("Open Latest Workflow", "openLatestWorkflow:")
	my addMenuItem("Send Status Reply", "sendStatusReply:")
	my addSeparator()
	my addMenuItem("Quit", "quitApp:")
end rebuildMenu

on addMenuItem(titleText, actionName)
	set menuItem to current application's NSMenuItem's alloc()'s initWithTitle_action_keyEquivalent_(titleText, actionName, "")
	menuItem's setTarget_(me)
	statusMenu's addItem_(menuItem)
end addMenuItem

on addInfoItem(titleText)
	set menuItem to current application's NSMenuItem's alloc()'s initWithTitle_action_keyEquivalent_(titleText, missing value, "")
	menuItem's setEnabled_(false)
	statusMenu's addItem_(menuItem)
end addInfoItem

on addSeparator()
	statusMenu's addItem_(current application's NSMenuItem's separatorItem())
end addSeparator

on refreshStatus()
	set statusText to my runStatusCommand(false)
	set button to statusItem's button()
	my rebuildMenu(statusText)
	set modeLabel to my detectMode(statusText)
	set serviceState to my lineValue(statusText, "State: ", "stopped")
	set runningCount to my lineValue(statusText, "Running Workflows: ", "0")
	set waitingCount to my lineValue(statusText, "Waiting Workflows: ", "0")
	set runningTaskCount to my lineValue(statusText, "Running Tasks: ", "0")
	set queuedTaskCount to my lineValue(statusText, "Queued Tasks: ", "0")
	set mainCount to my lineValue(statusText, "Main Threads: ", "0")
	set childCount to my lineValue(statusText, "Child Threads: ", "0")
	if serviceState is "running" then
		set titlePrefix to "OC●"
		if modeLabel is "full-access" then
			set titlePrefix to "OC⚡"
		else if modeLabel is "safe" then
			set titlePrefix to "OC△"
		end if
		if runningTaskCount is not "0" then
			button's setTitle_(titlePrefix & runningTaskCount)
		else
			button's setTitle_(titlePrefix)
		end if
	else
		button's setTitle_("OC○")
	end if
	button's setToolTip_("openCodex CTO • " & serviceState & " • wf " & runningCount & "/" & waitingCount & " • task " & runningTaskCount & "/" & queuedTaskCount & " • main " & mainCount & " • child " & childCount & " • " & modeLabel)
end refreshStatus

on runStatusCommand(asJson)
	set commandText to quoted form of nodePath & space & quoted form of cliPath & " service telegram status --state-dir " & quoted form of stateDir
	if asJson then set commandText to commandText & " --json"
	try
		return do shell script commandText
	on error errorMessage
		return errorMessage
	end try
end runStatusCommand

on showStatus_(sender)
	set responseText to my runStatusCommand(false)
	display dialog responseText buttons {"OK"} default button "OK" with title appTitle
	my refreshStatus()
end showStatus_

on startService_(sender)
	my runServiceCommand("start")
end startService_

on stopService_(sender)
	my runServiceCommand("stop")
end stopService_

on restartService_(sender)
	my runServiceCommand("restart")
end restartService_

on useSafeMode_(sender)
	my runProfileCommand("safe")
end useSafeMode_

on useBalancedMode_(sender)
	my runProfileCommand("balanced")
end useBalancedMode_

on useFullAccessMode_(sender)
	my runProfileCommand("full-access")
end useFullAccessMode_

on runProfileCommand(profileName)
	set commandText to quoted form of nodePath & space & quoted form of cliPath & " service telegram set-profile --profile " & quoted form of profileName & " --state-dir " & quoted form of stateDir
	try
		set outputText to do shell script commandText
		display notification outputText with title appTitle
	on error errorMessage
		display notification errorMessage with title appTitle
	end try
	my refreshStatus()
end runProfileCommand

on detectMode(statusText)
	if statusText contains "Profile: full-access" then
		return "full-access"
	else if statusText contains "Profile: safe" then
		return "safe"
	else if statusText contains "Profile: balanced" then
		return "balanced"
	end if
	return "balanced"
end detectMode

on runServiceCommand(subcommand)
	set commandText to quoted form of nodePath & space & quoted form of cliPath & " service telegram " & subcommand & " --state-dir " & quoted form of stateDir
	try
		set outputText to do shell script commandText
		display notification outputText with title appTitle
	on error errorMessage
		display notification errorMessage with title appTitle
	end try
	my refreshStatus()
end runServiceCommand

on runDispatchDetailCommand(dispatchIndex)
	set commandText to quoted form of nodePath & space & quoted form of cliPath & " service telegram dispatch-detail --index " & (dispatchIndex as string) & " --state-dir " & quoted form of stateDir
	return do shell script commandText
end runDispatchDetailCommand

on runTaskHistoryCommand()
	set commandText to quoted form of nodePath & space & quoted form of cliPath & " service telegram task-history --state-dir " & quoted form of stateDir
	return do shell script commandText
end runTaskHistoryCommand

on openRepo_(sender)
	do shell script "open " & quoted form of repoPath
end openRepo_

on openLogs_(sender)
	do shell script "open -R " & quoted form of stdoutPath
end openLogs_

on openLatestWorkflow_(sender)
	set statusText to my runStatusCommand(false)
	set workflowPath to my lineValue(statusText, "Latest Workflow Path: ", "")
	if workflowPath is "" then
		display notification "No workflow session found yet." with title appTitle
	else
		do shell script "open -R " & quoted form of workflowPath
	end if
end openLatestWorkflow_

on openDispatch1_(sender)
	my openDispatchRecord(1)
end openDispatch1_

on openDispatch2_(sender)
	my openDispatchRecord(2)
end openDispatch2_

on openDispatch3_(sender)
	my openDispatchRecord(3)
end openDispatch3_

on openDispatch4_(sender)
	my openDispatchRecord(4)
end openDispatch4_

on openDispatch5_(sender)
	my openDispatchRecord(5)
end openDispatch5_

on browseTaskHistory_(sender)
	try
		set historyText to my runTaskHistoryCommand()
	on error errorMessage
		display dialog errorMessage buttons {"OK"} default button "OK" with title appTitle
		return
	end try

	set historyItems to my collectPrefixedLines(historyText, "History ")
	if (count of historyItems) is 0 then
		display notification "No task history found yet." with title appTitle
		return
	end if

	set picked to choose from list historyItems with title appTitle with prompt "Select a task to inspect" OK button name "Open Detail" cancel button name "Cancel"
	if picked is false then return

	set selectedIndex to my historyIndexFromLine(item 1 of picked)
	if selectedIndex is 0 then
		display notification "Unable to parse the selected task history item." with title appTitle
		return
	end if

	my openDispatchRecord(selectedIndex)
end browseTaskHistory_

on openDispatchRecord(dispatchIndex)
	try
		set detailText to my runDispatchDetailCommand(dispatchIndex)
	on error errorMessage
		display dialog errorMessage buttons {"OK"} default button "OK" with title appTitle
		return
	end try

	set recordPath to my lineValue(detailText, "Record Path: ", "")
	set eventsPath to my lineValue(detailText, "Events Path: ", "")
	set actionButtons to {"Close"}
	if recordPath is not "" then set end of actionButtons to "Open Record"
	if eventsPath is not "" then set end of actionButtons to "Open Events"

	try
		set dialogResult to display dialog detailText buttons actionButtons default button "Close" with title appTitle
	on error number -128
		return
	end try

	set selectedButton to button returned of dialogResult
	if selectedButton is "Open Record" then
		do shell script "open -R " & quoted form of recordPath
	else if selectedButton is "Open Events" then
		do shell script "open -R " & quoted form of eventsPath
	end if
end openDispatchRecord

on sendStatusReply_(sender)
	set commandText to quoted form of nodePath & space & quoted form of cliPath & " service telegram send-status --state-dir " & quoted form of stateDir
	try
		set outputText to do shell script commandText
		display notification outputText with title appTitle
	on error errorMessage
		display notification errorMessage with title appTitle
	end try
	my refreshStatus()
end sendStatusReply_

on collectPrefixedLines(inputText, prefixText)
	set matchedLines to {}
	repeat with oneLine in paragraphs of inputText
		set currentLine to contents of oneLine
		if currentLine starts with prefixText then set end of matchedLines to currentLine
	end repeat
	return matchedLines
end collectPrefixedLines

on historyIndexFromLine(lineText)
	set colonOffset to offset of ":" in lineText
	if colonOffset is 0 then return 0
	try
		return (text 9 thru (colonOffset - 1) of lineText) as integer
	on error
		return 0
	end try
end historyIndexFromLine

on lineValue(statusText, prefixText, fallbackText)
	repeat with oneLine in paragraphs of statusText
		set currentLine to contents of oneLine
		if currentLine starts with prefixText then
			return text ((length of prefixText) + 1) thru -1 of currentLine
		end if
	end repeat
	return fallbackText
end lineValue

on truncateText(inputText, maxLength)
	if (length of inputText) ≤ maxLength then return inputText
	return text 1 thru (maxLength - 1) of inputText & "…"
end truncateText

on quitApp_(sender)
	continue quit
end quitApp_
`;
}

async function loadServiceEnvironment(service) {
  if (!(await pathExists(service.envPath))) {
    return {};
  }

  const text = await readFile(service.envPath, 'utf8');
  const environment = {};
  for (const line of text.split('\n')) {
    const match = line.match(/^export\s+([A-Z0-9_]+)=(.*)$/);
    if (!match) {
      continue;
    }
    environment[match[1]] = parseExportValue(match[2]);
  }
  return environment;
}

function parseExportValue(rawValue) {
  const value = String(rawValue || '').trim();
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/'"'"'/g, "'");
  }
  return value;
}

function buildTelegramServiceStatusReply(payload) {
  const lines = [
    'openCodex CTO 状态回执',
    `服务：${payload.loaded ? (payload.state || 'running') : 'stopped'}`,
    `权限：${payload.profile || payload.permission_mode || 'unknown'}`,
    `工作流：running ${payload.running_workflow_count ?? 0} / waiting ${payload.waiting_workflow_count ?? 0}`,
    `任务：running ${payload.running_task_count ?? 0} / queued ${payload.queued_task_count ?? 0}`,
    `线程：主 ${payload.main_thread_count ?? 0} / 子 ${payload.child_thread_count ?? 0}`
  ];

  if (payload.latest_workflow_session_id) {
    lines.push(`最近工作流：${payload.latest_workflow_session_id} (${payload.latest_workflow_status || 'unknown'})`);
  }
  if (payload.latest_workflow_goal) {
    lines.push(`目标：${truncateInline(payload.latest_workflow_goal, 120)}`);
  }
  if (payload.latest_workflow_pending_question) {
    lines.push(`待确认：${truncateInline(payload.latest_workflow_pending_question, 120)}`);
  }

  return lines.join('\n');
}

function truncateInline(value, maxLength = 160) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function resolveLaunchctlBin() {

  return process.env.OPENCODEX_LAUNCHCTL_BIN || 'launchctl';
}

function resolveOsacompileBin() {
  return process.env.OPENCODEX_OSACOMPILE_BIN || '/usr/bin/osacompile';
}

function buildLaunchdDomain() {
  return `gui/${process.getuid()}`;
}

function buildLaunchdTarget(label) {
  return `${buildLaunchdDomain()}/${label}`;
}

function pickCommandFailure(result) {
  return String(result.stderr || result.stdout || 'Unknown command error').trim() || 'Unknown command error';
}

async function openPath(targetPath) {
  const result = await runCommandCapture('open', [targetPath], { cwd: process.cwd() });
  if (result.code !== 0) {
    throw new Error(`open failed: ${pickCommandFailure(result)}`);
  }
}

function normalizeChatId(value) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return '';
}

function resolveTelegramBotToken(flagValue) {
  const token = (typeof flagValue === 'string' && flagValue.trim())
    || (typeof process.env.OPENCODEX_TELEGRAM_BOT_TOKEN === 'string' && process.env.OPENCODEX_TELEGRAM_BOT_TOKEN.trim())
    || '';
  if (!token) {
    throw new Error('Telegram bot token is required. Pass `--bot-token <token>` or set `OPENCODEX_TELEGRAM_BOT_TOKEN`.');
  }
  return token;
}

function parsePositiveInteger(value, optionName) {
  const parsed = parseNonNegativeInteger(value, optionName);
  if (parsed < 1) {
    throw new Error(`${optionName} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInteger(value, optionName) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${optionName} must be zero or a positive integer`);
  }
  return parsed;
}

function shellQuote(value) {
  return `'${String(value || '').replace(/'/g, `'"'"'`)}'`;
}

function escapeXml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function appleScriptString(value) {
  return `"${String(value || '').replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}
