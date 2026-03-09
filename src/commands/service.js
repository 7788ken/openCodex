import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { parseOptions } from '../lib/args.js';
import { ensureDir, pathExists, readJson, readTextIfExists, writeJson } from '../lib/fs.js';
import { getCodexBin, runCommandCapture } from '../lib/codex.js';
import { resolveCodexProfile } from '../lib/profile.js';
import { DEFAULT_CTO_SOUL_RELATIVE_PATH, buildDefaultCtoSoulDocument, classifyTelegramCtoMessageIntent, loadCtoSoulDocument } from '../lib/cto-workflow.js';
import { getSessionDir, listSessions } from '../lib/session-store.js';

const CLI_PATH = fileURLToPath(new URL('../../bin/opencodex.js', import.meta.url));
const DEFAULT_LABEL = 'com.opencodex.telegram.cto';
const DEFAULT_MENU_BAR_APP_NAME = 'OpenCodex Tray.app';
const SERVICE_CONFIG_FILE = 'service.json';
const DEFAULT_POLL_TIMEOUT = 30;
const DEFAULT_PROFILE = 'full-access';
const DEFAULT_SERVICE_SETTINGS = Object.freeze({
  ui_language: 'en',
  badge_mode: 'tasks',
  refresh_interval_seconds: 15,
  show_workflow_ids: true,
  show_paths: true
});

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

const TELEGRAM_SET_SETTING_OPTION_SPEC = {
  label: { type: 'string' },
  profile: { type: 'string' },
  'launch-agent-dir': { type: 'string' },
  'state-dir': { type: 'string' },
  'applications-dir': { type: 'string' },
  key: { type: 'string' },
  value: { type: 'string' },
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

const TELEGRAM_WORKFLOW_HISTORY_OPTION_SPEC = {
  label: { type: 'string' },
  profile: { type: 'string' },
  'launch-agent-dir': { type: 'string' },
  'state-dir': { type: 'string' },
  'applications-dir': { type: 'string' },
  limit: { type: 'string' },
  json: { type: 'boolean' }
};

const TELEGRAM_WORKFLOW_DETAIL_OPTION_SPEC = {
  label: { type: 'string' },
  profile: { type: 'string' },
  'launch-agent-dir': { type: 'string' },
  'state-dir': { type: 'string' },
  'applications-dir': { type: 'string' },
  index: { type: 'string' },
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
      '  opencodex service telegram set-setting --key <name> --value <value> [--json]\n' +
      '  opencodex service telegram send-status [--json]\n' +
      '  opencodex service telegram workflow-history [--limit <n>] [--json]\n' +
      '  opencodex service telegram workflow-detail --index <n> [--json]\n' +
      '  opencodex service telegram task-history [--limit <n>] [--json]\n' +
      '  opencodex service telegram dispatch-detail --index <n> [--json]\n' +
      '  opencodex service telegram reset-cto-soul [--json]\n' +
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

  if (subcommand === 'set-setting') {
    await runTelegramServiceSetSetting(rest);
    return;
  }

  if (subcommand === 'send-status') {
    await runTelegramServiceSendStatus(rest);
    return;
  }

  if (subcommand === 'workflow-history') {
    await runTelegramServiceWorkflowHistory(rest);
    return;
  }

  if (subcommand === 'workflow-detail') {
    await runTelegramServiceWorkflowDetail(rest);
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

  if (subcommand === 'reset-cto-soul') {
    await runTelegramServiceResetCtoSoul(rest);
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

async function runTelegramServiceSetSetting(args) {
  const { options, positionals } = parseOptions(args, TELEGRAM_SET_SETTING_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex service telegram set-setting` does not accept positional arguments');
  }

  if (typeof options.key !== 'string' || !options.key.trim()) {
    throw new Error('`opencodex service telegram set-setting` requires `--key <name>`');
  }
  if (typeof options.value !== 'string' || !options.value.trim()) {
    throw new Error('`opencodex service telegram set-setting` requires `--value <value>`');
  }

  const service = await loadInstalledService(options);
  const existingConfig = await readExistingServiceConfig(service);
  const { settingKey, settingValue, settings } = applyServiceSetting(service.settings, options.key, options.value);
  service.settings = settings;

  await writeJson(service.configPath, buildServiceConfig(service, {
    ...existingConfig,
    installed_at: existingConfig.installed_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  }));

  const payload = await inspectService(service);
  renderServiceOutput({
    ...payload,
    action: 'set-setting',
    setting_key: settingKey,
    setting_value: settingValue
  }, options.json, 'Telegram CTO tray setting updated');
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

async function runTelegramServiceWorkflowHistory(args) {
  const { options, positionals } = parseOptions(args, TELEGRAM_WORKFLOW_HISTORY_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex service telegram workflow-history` does not accept positional arguments');
  }

  const limit = typeof options.limit === 'string' && options.limit.trim()
    ? parsePositiveInteger(options.limit, '--limit')
    : 30;
  const service = await loadInstalledService(options);
  const history = await collectWorkflowHistory(service.cwd);
  const items = history.slice(0, limit);
  renderWorkflowHistoryOutput({ ok: true, total_count: history.length, items }, options.json, 'Telegram CTO workflow history');
}

async function runTelegramServiceWorkflowDetail(args) {
  const { options, positionals } = parseOptions(args, TELEGRAM_WORKFLOW_DETAIL_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex service telegram workflow-detail` does not accept positional arguments');
  }

  const index = parsePositiveInteger(options.index, '--index');
  const service = await loadInstalledService(options);
  const items = await collectWorkflowHistory(service.cwd);
  const workflow = Array.isArray(items) ? items[index - 1] : null;
  if (!workflow) {
    throw new Error(`Workflow index out of range: ${index}`);
  }

  const detailPayload = await buildWorkflowDetailPayload(service.cwd, workflow, index);
  renderWorkflowDetailOutput(detailPayload, options.json, `Telegram CTO workflow detail #${index}`);
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

async function runTelegramServiceResetCtoSoul(args) {
  const { options, positionals } = parseOptions(args, TELEGRAM_SERVICE_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex service telegram reset-cto-soul` does not accept positional arguments');
  }

  const service = await loadInstalledService(options);
  const soulPath = path.join(service.cwd, DEFAULT_CTO_SOUL_RELATIVE_PATH);
  await ensureDir(path.dirname(soulPath));
  await writeFile(soulPath, `${buildDefaultCtoSoulDocument()}\n`, 'utf8');

  const payload = await inspectService(service);
  renderServiceOutput({
    ...payload,
    action: 'reset-cto-soul',
    cto_soul_reset: true
  }, options.json, 'Telegram CTO soul template restored');
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
    settings: defaultServiceSettings(),
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
      settings: normalizeServiceSettings(config.settings),
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
    settings: normalizeServiceSettings(service.settings),
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

function defaultServiceSettings() {
  return { ...DEFAULT_SERVICE_SETTINGS };
}

function normalizeServiceSettings(settings = {}) {
  const raw = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
  return {
    ui_language: normalizeUiLanguage(raw.ui_language),
    badge_mode: normalizeBadgeMode(raw.badge_mode),
    refresh_interval_seconds: normalizeRefreshInterval(raw.refresh_interval_seconds),
    show_workflow_ids: normalizeBooleanSetting(raw.show_workflow_ids, DEFAULT_SERVICE_SETTINGS.show_workflow_ids),
    show_paths: normalizeBooleanSetting(raw.show_paths, DEFAULT_SERVICE_SETTINGS.show_paths)
  };
}

function flattenServiceSettings(settings = {}) {
  const normalized = normalizeServiceSettings(settings);
  return {
    ui_language: normalized.ui_language,
    badge_mode: normalized.badge_mode,
    refresh_interval_seconds: normalized.refresh_interval_seconds,
    show_workflow_ids: normalized.show_workflow_ids,
    show_paths: normalized.show_paths
  };
}

function applyServiceSetting(currentSettings, key, value) {
  const normalized = normalizeServiceSettings(currentSettings);
  const settingKey = normalizeSettingKey(key);
  if (settingKey === 'ui_language') {
    normalized.ui_language = normalizeUiLanguage(value);
    return { settingKey, settingValue: normalized.ui_language, settings: normalized };
  }
  if (settingKey === 'badge_mode') {
    normalized.badge_mode = normalizeBadgeMode(value);
    return { settingKey, settingValue: normalized.badge_mode, settings: normalized };
  }
  if (settingKey === 'refresh_interval_seconds') {
    normalized.refresh_interval_seconds = normalizeRefreshInterval(value);
    return { settingKey, settingValue: String(normalized.refresh_interval_seconds), settings: normalized };
  }
  if (settingKey === 'show_workflow_ids') {
    normalized.show_workflow_ids = normalizeBooleanSetting(value, DEFAULT_SERVICE_SETTINGS.show_workflow_ids);
    return { settingKey, settingValue: normalized.show_workflow_ids ? 'on' : 'off', settings: normalized };
  }
  if (settingKey === 'show_paths') {
    normalized.show_paths = normalizeBooleanSetting(value, DEFAULT_SERVICE_SETTINGS.show_paths);
    return { settingKey, settingValue: normalized.show_paths ? 'on' : 'off', settings: normalized };
  }

  throw new Error(`Unknown tray setting: ${key}`);
}

function normalizeSettingKey(key) {
  const value = String(key || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  if (value in DEFAULT_SERVICE_SETTINGS) {
    return value;
  }
  if (value === 'language' || value === 'ui') {
    return 'ui_language';
  }
  if (value === 'badge') {
    return 'badge_mode';
  }
  if (value === 'refresh_interval' || value === 'refresh' || value === 'interval') {
    return 'refresh_interval_seconds';
  }
  if (value === 'workflow_ids' || value === 'show_ids') {
    return 'show_workflow_ids';
  }
  if (value === 'paths') {
    return 'show_paths';
  }
  return value;
}

function normalizeUiLanguage(value) {
  return String(value || '').trim().toLowerCase() === 'zh' ? 'zh' : 'en';
}

function normalizeBadgeMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'workflows' || normalized === 'workflow') {
    return 'workflows';
  }
  if (normalized === 'none' || normalized === 'off') {
    return 'none';
  }
  return 'tasks';
}

function normalizeRefreshInterval(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if ([5, 15, 30, 60].includes(parsed)) {
    return parsed;
  }
  return DEFAULT_SERVICE_SETTINGS.refresh_interval_seconds;
}

function normalizeBooleanSetting(value, fallback) {
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'show', 'enabled'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off', 'hide', 'disabled'].includes(normalized)) {
    return false;
  }
  return fallback;
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
  const ctoSoul = await loadCtoSoulDocument(service.cwd);
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
      cto_soul_path: ctoSoul.path,
      cto_soul_source: ctoSoul.builtin ? 'builtin' : 'file',
      ...flattenServiceSettings(service.settings),
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
    cto_soul_path: ctoSoul.path,
    cto_soul_source: ctoSoul.builtin ? 'builtin' : 'file',
    ...flattenServiceSettings(service.settings),
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

async function collectWorkflowHistory(cwd, options = {}) {
  let sessions = [];
  try {
    sessions = await listSessions(cwd);
  } catch {
    sessions = [];
  }

  const workflowInfos = await loadWorkflowInfos(cwd, sessions.filter((session) => session.command === 'cto'), options.workflow_limit || 100);
  const history = buildWorkflowHistoryRecords(workflowInfos);
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
  const latestWorkflow = ctoSessions[0] || null;
  const latestListener = sessions.find((session) => session.command === 'im' && session.input?.arguments?.provider === 'telegram') || null;
  const latestWorkflowInfo = latestWorkflow ? await resolveLatestWorkflowInfo(service.cwd, latestWorkflow) : null;
  const workflowInfos = await loadWorkflowInfos(service.cwd, ctoSessions, 24);
  const workflowHistory = buildWorkflowHistoryRecords(workflowInfos);
  const runningWorkflowInfos = workflowInfos.filter((item) => normalizeWorkflowHistoryStatus(item.workflowState?.status || item.session?.status || '') === 'running');
  const waitingWorkflowInfos = workflowInfos.filter((item) => normalizeWorkflowHistoryStatus(item.workflowState?.status || item.session?.status || '') === 'waiting');
  const trackedSessions = [...runningWorkflowInfos, ...waitingWorkflowInfos].map((item) => item.session).filter(Boolean);
  const trackedWorkflowStates = [...runningWorkflowInfos, ...waitingWorkflowInfos]
    .map((item) => item.workflowState)
    .filter(Boolean);
  const taskTotals = trackedWorkflowStates.reduce((sum, workflowState) => {
    const counts = summarizeWorkflowTaskCounts(workflowState);
    sum.running += counts.running;
    sum.queued += counts.queued;
    sum.total += counts.total;
    return sum;
  }, { running: 0, queued: 0, total: 0 });
  const childSessionStats = collectChildSessionStats({
    sessions,
    trackedSessions,
    fallbackActiveChildCount: taskTotals.running
  });
  const dispatchHistory = collectRecentDispatchRecords(service.cwd, workflowInfos);
  const recentDispatches = dispatchHistory.slice(0, 5);

  return {
    running_workflow_count: runningWorkflowInfos.length,
    waiting_workflow_count: waitingWorkflowInfos.length,
    running_task_count: taskTotals.running,
    queued_task_count: taskTotals.queued,
    tracked_task_count: taskTotals.total,
    workflow_history_count: workflowHistory.length,
    dispatch_history_count: dispatchHistory.length,
    recent_dispatch_count: recentDispatches.length,
    recent_dispatches: recentDispatches,
    active_main_thread_count: runningWorkflowInfos.length,
    main_thread_count: trackedSessions.length,
    active_child_thread_count: childSessionStats.active,
    child_session_count: childSessionStats.total,
    child_thread_count: childSessionStats.total,
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
    status: normalizeWorkflowHistoryStatus(workflowState?.status || session.status || ''),
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

function collectChildSessionStats({ sessions, trackedSessions, fallbackActiveChildCount = 0 }) {
  const trackedSessionIds = new Set((trackedSessions || [])
    .map((session) => typeof session?.session_id === 'string' ? session.session_id : '')
    .filter(Boolean));
  const childSessionIds = new Set();
  const sessionMap = new Map((sessions || [])
    .filter((session) => typeof session?.session_id === 'string' && session.session_id)
    .map((session) => [session.session_id, session]));

  for (const session of trackedSessions || []) {
    for (const entry of normalizeChildSessionRefs(session?.child_sessions)) {
      childSessionIds.add(entry.session_id);
    }
  }

  for (const session of sessions || []) {
    if (trackedSessionIds.has(session?.parent_session_id)) {
      childSessionIds.add(session.session_id);
    }
  }

  let activeChildCount = 0;
  for (const childSessionId of childSessionIds) {
    const childSession = sessionMap.get(childSessionId);
    if (childSession?.status === 'running' || childSession?.status === 'partial') {
      activeChildCount += 1;
    }
  }

  return {
    active: Math.max(activeChildCount, fallbackActiveChildCount || 0),
    total: childSessionIds.size
  };
}

function summarizeWorkflowTaskCounts(workflowState) {
  const counts = {
    total: 0,
    queued: 0,
    running: 0,
    completed: 0,
    partial: 0,
    failed: 0
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
    if (task?.status === 'completed') {
      counts.completed += 1;
    }
    if (task?.status === 'partial') {
      counts.partial += 1;
    }
    if (task?.status === 'failed') {
      counts.failed += 1;
    }
  }

  return counts;
}

function buildWorkflowHistoryRecords(workflowInfos) {
  return (workflowInfos || [])
    .map((workflowInfo) => buildWorkflowHistoryRecord(workflowInfo))
    .filter(Boolean)
    .sort((left, right) => String(right.updated_at || '').localeCompare(String(left.updated_at || '')));
}

function buildWorkflowHistoryRecord(workflowInfo) {
  const session = workflowInfo?.session;
  const workflowState = workflowInfo?.workflowState;
  if (!session?.session_id) {
    return null;
  }

  const counts = summarizeWorkflowTaskCounts(workflowState);
  const status = normalizeWorkflowHistoryStatus(workflowState?.status || session.status);
  const goal = typeof workflowState?.goal_text === 'string' && workflowState.goal_text
    ? workflowState.goal_text
    : (typeof session?.input?.prompt === 'string' ? session.input.prompt : '');
  const pendingQuestion = typeof workflowState?.pending_question_zh === 'string' ? workflowState.pending_question_zh : '';
  const updatedAt = typeof workflowState?.updated_at === 'string' && workflowState.updated_at
    ? workflowState.updated_at
    : (typeof session.updated_at === 'string' ? session.updated_at : '');
  const childThreadCount = normalizeChildSessionRefs(session.child_sessions).length;
  const pathValue = workflowInfo?.workflowStatePath || workflowInfo?.sessionPath || '';

  return {
    workflow_session_id: session.session_id,
    status,
    goal,
    pending_question: pendingQuestion,
    updated_at: updatedAt,
    path: pathValue,
    session_path: workflowInfo?.sessionPath || '',
    workflow_state_path: workflowInfo?.workflowStatePath || '',
    child_thread_count: childThreadCount,
    task_total_count: counts.total,
    running_task_count: counts.running,
    queued_task_count: counts.queued,
    completed_task_count: counts.completed,
    partial_task_count: counts.partial,
    failed_task_count: counts.failed,
    label: `[${status}] ${truncateInline(session.session_id, 32)} — ${truncateInline(goal || session.summary?.title || 'Untitled workflow', 72)}`
  };
}

function normalizeWorkflowHistoryStatus(status) {
  if (status === 'waiting_for_user') {
    return 'waiting';
  }
  if (typeof status !== 'string' || !status) {
    return 'unknown';
  }
  return status;
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
  lines.push(`UI Language: ${payload.ui_language || DEFAULT_SERVICE_SETTINGS.ui_language}`);
  lines.push(`Badge Mode: ${payload.badge_mode || DEFAULT_SERVICE_SETTINGS.badge_mode}`);
  lines.push(`Refresh Interval: ${payload.refresh_interval_seconds || DEFAULT_SERVICE_SETTINGS.refresh_interval_seconds}`);
  lines.push(`Show Workflow IDs: ${payload.show_workflow_ids === false ? 'off' : 'on'}`);
  lines.push(`Show Paths: ${payload.show_paths === false ? 'off' : 'on'}`);
  if (payload.cto_soul_source) {
    lines.push(`CTO Soul Source: ${payload.cto_soul_source}`);
  }
  if (payload.cto_soul_path) {
    lines.push(`CTO Soul Path: ${payload.cto_soul_path}`);
  }
  lines.push(`Running Workflows: ${payload.running_workflow_count ?? 0}`);
  lines.push(`Waiting Workflows: ${payload.waiting_workflow_count ?? 0}`);
  lines.push(`Running Tasks: ${payload.running_task_count ?? 0}`);
  lines.push(`Queued Tasks: ${payload.queued_task_count ?? 0}`);
  lines.push(`Workflow History: ${payload.workflow_history_count ?? 0}`);
  lines.push(`Task History: ${payload.dispatch_history_count ?? 0}`);
  lines.push(`Active Main Threads: ${payload.active_main_thread_count ?? payload.running_workflow_count ?? 0}`);
  lines.push(`Tracked Main Threads: ${payload.main_thread_count ?? 0}`);
  lines.push(`Active Child Threads: ${payload.active_child_thread_count ?? payload.running_task_count ?? 0}`);
  lines.push(`Child Sessions: ${payload.child_session_count ?? payload.child_thread_count ?? 0}`);
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

function renderWorkflowHistoryOutput(payload, json, title) {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  const lines = [title, ''];
  lines.push(`Total: ${payload.total_count ?? 0}`);
  if (Array.isArray(payload.items)) {
    payload.items.forEach((item, index) => {
      lines.push(`Workflow ${index + 1}: ${item.label}`);
      if (item.updated_at) {
        lines.push(`Workflow ${index + 1} Updated: ${item.updated_at}`);
      }
      lines.push(`Workflow ${index + 1} Tasks: total ${item.task_total_count ?? 0} • running ${item.running_task_count ?? 0} • queued ${item.queued_task_count ?? 0} • completed ${item.completed_task_count ?? 0} • partial ${item.partial_task_count ?? 0} • failed ${item.failed_task_count ?? 0}`);
      if (item.workflow_session_id) {
        lines.push(`Workflow ${index + 1} Session: ${item.workflow_session_id}`);
      }
    });
  }

  process.stdout.write(lines.join('\n') + '\n');
}

async function buildWorkflowDetailPayload(cwd, workflow, index) {
  const workflowSessionId = typeof workflow?.workflow_session_id === 'string' ? workflow.workflow_session_id : '';
  const workflowSessionPath = workflowSessionId ? path.join(getSessionDir(cwd, workflowSessionId), 'session.json') : '';
  const workflowSession = await loadJsonIfExists(workflowSessionPath);
  const workflowInfo = workflowSession
    ? await resolveWorkflowStateInfo(cwd, workflowSession)
    : { sessionPath: workflowSessionPath, workflowStatePath: '', workflowState: null };
  const workflowState = workflowInfo.workflowState && typeof workflowInfo.workflowState === 'object'
    ? workflowInfo.workflowState
    : null;
  const summary = workflowSession?.summary && typeof workflowSession.summary === 'object'
    ? workflowSession.summary
    : {};
  const workflowDir = workflowSessionPath ? path.dirname(workflowSessionPath) : (workflowSessionId ? getSessionDir(cwd, workflowSessionId) : '');
  const eventsArtifactPath = Array.isArray(workflowSession?.artifacts)
    ? workflowSession.artifacts.find((item) => item?.type === 'jsonl_events' && typeof item.path === 'string' && item.path)?.path || ''
    : '';
  const lastMessageArtifactPath = Array.isArray(workflowSession?.artifacts)
    ? workflowSession.artifacts.find((item) => item?.type === 'last_message' && typeof item.path === 'string' && item.path)?.path || ''
    : '';
  const eventsPath = await resolveFirstExistingPath([
    eventsArtifactPath,
    workflowDir ? path.join(workflowDir, 'events.jsonl') : ''
  ]);
  const lastMessagePath = await resolveFirstExistingPath([
    lastMessageArtifactPath,
    workflowDir ? path.join(workflowDir, 'last-message.txt') : ''
  ]);
  const lastMessage = (await readTextIfExists(lastMessagePath)) || '';
  const recentActivity = summarizeRecentEvents((await readTextIfExists(eventsPath)) || '');
  const taskCounts = summarizeWorkflowTaskCounts(workflowState);
  const tasks = Array.isArray(workflowState?.tasks)
    ? workflowState.tasks.map((task) => {
        const sessionId = typeof task?.session_id === 'string' ? task.session_id : '';
        const childSessionPath = sessionId ? path.join(getSessionDir(cwd, sessionId), 'session.json') : '';
        const taskId = typeof task?.id === 'string' ? task.id : '';
        const title = typeof task?.title === 'string' && task.title ? task.title : (taskId || 'Untitled task');
        const status = normalizeDispatchStatus(task?.status);
        return {
          task_id: taskId,
          title,
          status,
          session_id: sessionId,
          path: childSessionPath,
          updated_at: typeof task?.updated_at === 'string' && task.updated_at ? task.updated_at : '',
          label: `[${status}] ${truncateInline(taskId || title || 'task', 32)} — ${truncateInline(title || taskId || 'Untitled task', 72)}`
        };
      })
    : [];

  const goal = workflowState?.goal_text || workflowSession?.input?.prompt || workflow?.goal || '';
  const inferredIntent = classifyTelegramCtoMessageIntent(goal);
  const normalizedStatus = normalizeWorkflowHistoryStatus(workflowState?.status || workflowSession?.status || workflow?.status || '');

  return {
    ok: true,
    index,
    workflow_session_id: workflowSessionId,
    status: normalizedStatus,
    goal,
    inferred_intent: inferredIntent.kind,
    inferred_intent_zh: inferredIntent.label_zh,
    routing_hint_zh: buildWorkflowRoutingHintZh({ goal, status: normalizedStatus, inferredIntent }),
    pending_question: workflowState?.pending_question_zh || workflow?.pending_question || '',
    updated_at: workflow?.updated_at || workflowState?.updated_at || workflowSession?.updated_at || '',
    child_thread_count: typeof workflow?.child_thread_count === 'number' ? workflow.child_thread_count : normalizeChildSessionRefs(workflowSession?.child_sessions).length,
    task_counts: taskCounts,
    result: typeof summary.result === 'string' ? summary.result : '',
    highlights: Array.isArray(summary.highlights) ? summary.highlights : [],
    validation: Array.isArray(summary.validation) ? summary.validation : [],
    changed_files: Array.isArray(summary.changed_files) ? summary.changed_files : [],
    next_steps: Array.isArray(summary.next_steps) ? summary.next_steps : [],
    findings: Array.isArray(summary.findings) ? summary.findings : [],
    tasks,
    recent_activity: recentActivity,
    last_message: truncateMultiline(lastMessage, 360, 5),
    record_path: workflow?.path || workflowInfo.workflowStatePath || workflowInfo.sessionPath || '',
    session_path: workflowInfo.sessionPath || workflowSessionPath,
    workflow_state_path: workflowInfo.workflowStatePath || '',
    events_path: eventsPath,
    last_message_path: lastMessagePath
  };
}

function buildWorkflowRoutingHintZh({ goal, status, inferredIntent }) {
  if (!goal) {
    return '';
  }

  if (inferredIntent?.kind === 'casual_chat') {
    return ['running', 'waiting'].includes(String(status || ''))
      ? '这条消息本身更像轻聊天；如果它仍进入 workflow，通常表示旧规则误判，或当时没有命中轻聊天分流。'
      : '这条消息更像轻聊天，正常情况下应直接回复而不是进入 workflow。';
  }

  if (inferredIntent?.kind === 'status_query') {
    return '这条消息更像状态/历史查询，正常情况下应直接汇报现有 workflow。';
  }

  if (inferredIntent?.kind === 'directive') {
    return '这条消息被识别为执行/分析型请求，所以 CTO 主线程会新建或续跑 workflow。';
  }

  return inferredIntent?.reason_zh || '';
}

function renderWorkflowDetailOutput(payload, json, title) {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  const lines = [title, ''];
  lines.push(`Index: ${payload.index}`);
  if (payload.workflow_session_id) {
    lines.push(`Workflow: ${payload.workflow_session_id}`);
  }
  lines.push(`Status: ${payload.status || 'unknown'}`);
  if (payload.goal) {
    lines.push(`Goal: ${truncateInline(payload.goal, 160)}`);
  }
  if (payload.inferred_intent_zh) {
    lines.push(`Interpreted Intent: ${payload.inferred_intent_zh}`);
  }
  if (payload.routing_hint_zh) {
    lines.push(`Routing Hint: ${truncateInline(payload.routing_hint_zh, 200)}`);
  }
  if (payload.pending_question) {
    lines.push(`Pending Question: ${truncateInline(payload.pending_question, 160)}`);
  }
  if (payload.updated_at) {
    lines.push(`Updated: ${payload.updated_at}`);
  }
  lines.push(`Child Threads: ${payload.child_thread_count ?? 0}`);
  const counts = payload.task_counts || {};
  lines.push(`Tasks: total ${counts.total ?? 0} • running ${counts.running ?? 0} • queued ${counts.queued ?? 0} • completed ${counts.completed ?? 0} • partial ${counts.partial ?? 0} • failed ${counts.failed ?? 0}`);
  if (payload.result) {
    lines.push(`Result: ${truncateInline(payload.result, 220)}`);
  }
  appendDispatchDetailSection(lines, 'Highlights', payload.highlights, 3, 120);
  appendDispatchDetailSection(lines, 'Validation', payload.validation, 3, 120);
  appendDispatchDetailSection(lines, 'Changed Files', payload.changed_files, 5, 140);
  appendDispatchDetailSection(lines, 'Next Steps', payload.next_steps, 4, 120);
  appendDispatchDetailSection(lines, 'Recent Tasks', Array.isArray(payload.tasks) ? payload.tasks.map((item) => item.label) : [], 8, 140);
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
  if (payload.workflow_state_path) {
    lines.push(`Workflow State Path: ${payload.workflow_state_path}`);
  }
  if (payload.events_path) {
    lines.push(`Events Path: ${payload.events_path}`);
  }
  if (payload.last_message_path) {
    lines.push(`Last Message Path: ${payload.last_message_path}`);
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
property ctoSoulPath : ${appleScriptString(path.join(service.cwd, DEFAULT_CTO_SOUL_RELATIVE_PATH))}
property stdoutPath : ${appleScriptString(service.stdoutPath)}
property appTitle : "openCodex CTO"

on run
	my setupMenuBar()
end run

on reopen
	my refreshStatus()
end reopen

on idle
	return my refreshStatus()
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
	my addInfoItem(my localizedText(statusText, "Service", "服务") & ": " & my lineValue(statusText, "State: ", "unknown") & " • " & my detectMode(statusText))
	my addInfoItem(my localizedText(statusText, "Workflows", "工作流") & ": running " & my lineValue(statusText, "Running Workflows: ", "0") & " • waiting " & my lineValue(statusText, "Waiting Workflows: ", "0"))
	my addInfoItem(my localizedText(statusText, "Tasks", "任务") & ": running " & my lineValue(statusText, "Running Tasks: ", "0") & " • queued " & my lineValue(statusText, "Queued Tasks: ", "0"))
	my addInfoItem(my localizedText(statusText, "History", "历史") & ": " & my localizedText(statusText, "workflow", "工作流") & " " & my lineValue(statusText, "Workflow History: ", "0") & " • " & my localizedText(statusText, "task", "任务") & " " & my lineValue(statusText, "Task History: ", "0"))
	my addInfoItem(my localizedText(statusText, "Threads", "线程") & ": " & my localizedText(statusText, "main active", "主活跃") & " " & my lineValue(statusText, "Active Main Threads: ", "0") & " • " & my localizedText(statusText, "child active", "子活跃") & " " & my lineValue(statusText, "Active Child Threads: ", "0") & " • " & my localizedText(statusText, "child total", "子累计") & " " & my lineValue(statusText, "Child Sessions: ", "0"))
	set latestWorkflowId to my lineValue(statusText, "Latest Workflow: ", "")
	set showWorkflowIds to my settingEnabled(statusText, "Show Workflow IDs: ", true)
	if latestWorkflowId is not "" then
		set latestWorkflowStatus to my lineValue(statusText, "Latest Workflow Status: ", "unknown")
		if showWorkflowIds then
			my addInfoItem(my localizedText(statusText, "Latest", "最近") & ": " & latestWorkflowId & " (" & latestWorkflowStatus & ")")
		else
			my addInfoItem(my localizedText(statusText, "Latest Workflow", "最近工作流") & ": " & latestWorkflowStatus)
		end if
		set latestGoal to my lineValue(statusText, "Latest Workflow Goal: ", "")
		if latestGoal is not "" then my addInfoItem(my localizedText(statusText, "Goal", "目标") & ": " & my truncateText(latestGoal, 72))
	end if
	set firstDispatch to my lineValue(statusText, "Dispatch 1: ", "")
	if firstDispatch is not "" then
		my addSeparator()
		my addInfoItem(my localizedText(statusText, "Recent Dispatches", "最近派发"))
		repeat with dispatchIndex from 1 to 5
			set dispatchTitle to my lineValue(statusText, "Dispatch " & dispatchIndex & ": ", "")
			if dispatchTitle is not "" then
				my addMenuItem(my truncateText(dispatchTitle, 84), "openDispatch" & dispatchIndex & ":")
			end if
		end repeat
	end if
	my addMenuItem(my localizedText(statusText, "Browse Workflows…", "浏览工作流…") & " (" & my lineValue(statusText, "Workflow History: ", "0") & ")", "browseWorkflowHistory:")
	my addMenuItem(my localizedText(statusText, "Browse Tasks…", "浏览任务列表…") & " (" & my lineValue(statusText, "Task History: ", "0") & ")", "browseTaskHistory:")
	my addMenuItem(my localizedText(statusText, "Settings…", "设置…"), "openSettings:")
	my addSeparator()
	my addMenuItem(my localizedText(statusText, "Show Status", "查看状态"), "showStatus:")
	my addMenuItem(my localizedText(statusText, "Start CTO Service", "启动 CTO 服务"), "startService:")
	my addMenuItem(my localizedText(statusText, "Stop CTO Service", "停止 CTO 服务"), "stopService:")
	my addMenuItem(my localizedText(statusText, "Restart CTO Service", "重启 CTO 服务"), "restartService:")
	my addSeparator()
	my addMenuItem(my localizedText(statusText, "Use Safe Mode (Read-Only)", "切换到 Safe 模式（只读）"), "useSafeMode:")
	my addMenuItem(my localizedText(statusText, "Use Balanced Mode", "切换到 Balanced 模式"), "useBalancedMode:")
	my addMenuItem(my localizedText(statusText, "Use Full Access Mode", "切换到 Full Access 模式"), "useFullAccessMode:")
	my addSeparator()
	my addMenuItem(my localizedText(statusText, "Open Repo", "打开仓库"), "openRepo:")
	my addMenuItem(my localizedText(statusText, "Open Logs", "打开日志"), "openLogs:")
	my addMenuItem(my localizedText(statusText, "Open Latest Workflow", "打开最近工作流"), "openLatestWorkflow:")
	my addMenuItem(my localizedText(statusText, "Edit CTO Soul", "编辑 CTO 灵魂文档"), "openCtoSoul:")
	my addMenuItem(my localizedText(statusText, "Restore Default CTO Soul", "恢复默认 CTO 灵魂模板"), "resetCtoSoul:")
	my addMenuItem(my localizedText(statusText, "Send Status Reply", "发送状态回执"), "sendStatusReply:")
	my addSeparator()
	my addMenuItem(my localizedText(statusText, "Quit", "退出"), "quitApp:")
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

on currentUiLanguage(statusText)
	set configuredLanguage to my lineValue(statusText, "UI Language: ", "en")
	if configuredLanguage is "zh" then return "zh"
	return "en"
end currentUiLanguage

on localizedText(statusText, englishText, chineseText)
	if my currentUiLanguage(statusText) is "zh" then return chineseText
	return englishText
end localizedText

on settingEnabled(statusText, prefixText, fallbackValue)
	set rawValue to my lineValue(statusText, prefixText, "")
	if rawValue is "on" then return true
	if rawValue is "off" then return false
	return fallbackValue
end settingEnabled

on describeUiLanguage(statusText)
	set currentValue to my lineValue(statusText, "UI Language: ", "en")
	if currentValue is "zh" then return my localizedText(statusText, "Language: Chinese", "语言：中文")
	return my localizedText(statusText, "Language: English", "语言：英文")
end describeUiLanguage

on describeBadgeMode(statusText)
	set currentValue to my lineValue(statusText, "Badge Mode: ", "tasks")
	if currentValue is "workflows" then return my localizedText(statusText, "Badge: Running workflows", "角标：运行中的工作流")
	if currentValue is "none" then return my localizedText(statusText, "Badge: Off", "角标：关闭")
	return my localizedText(statusText, "Badge: Running tasks", "角标：运行中的任务")
end describeBadgeMode

on describeRefreshInterval(statusText)
	set currentValue to my lineValue(statusText, "Refresh Interval: ", "15")
	return my localizedText(statusText, "Refresh: every ", "刷新：每 ") & currentValue & my localizedText(statusText, "s", " 秒")
end describeRefreshInterval

on describeWorkflowIds(statusText)
	if my settingEnabled(statusText, "Show Workflow IDs: ", true) then
		return my localizedText(statusText, "Workflow IDs: On", "工作流 ID：显示")
	end if
	return my localizedText(statusText, "Workflow IDs: Off", "工作流 ID：隐藏")
end describeWorkflowIds

on describePaths(statusText)
	if my settingEnabled(statusText, "Show Paths: ", true) then
		return my localizedText(statusText, "Path Shortcuts: On", "路径快捷入口：显示")
	end if
	return my localizedText(statusText, "Path Shortcuts: Off", "路径快捷入口：隐藏")
end describePaths

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
	set mainCount to my lineValue(statusText, "Active Main Threads: ", "0")
	set childCount to my lineValue(statusText, "Active Child Threads: ", "0")
	set totalChildCount to my lineValue(statusText, "Child Sessions: ", "0")
	set badgeMode to my lineValue(statusText, "Badge Mode: ", "tasks")
	set refreshIntervalValue to my lineValue(statusText, "Refresh Interval: ", "15")
	if serviceState is "running" then
		set titlePrefix to "OC●"
		if modeLabel is "full-access" then
			set titlePrefix to "OC⚡"
		else if modeLabel is "safe" then
			set titlePrefix to "OC△"
		end if
		if badgeMode is "workflows" then
			if runningCount is not "0" then
				button's setTitle_(titlePrefix & runningCount)
			else
				button's setTitle_(titlePrefix)
			end if
		else if badgeMode is "none" then
			button's setTitle_(titlePrefix)
		else if runningTaskCount is not "0" then
			button's setTitle_(titlePrefix & runningTaskCount)
		else
			button's setTitle_(titlePrefix)
		end if
	else
		button's setTitle_("OC○")
	end if
	button's setToolTip_("openCodex CTO • " & serviceState & " • wf " & runningCount & "/" & waitingCount & " • task " & runningTaskCount & "/" & queuedTaskCount & " • main active " & mainCount & " • child active " & childCount & " • child total " & totalChildCount & " • " & modeLabel)
	try
		return refreshIntervalValue as integer
	on error
		return 15
	end try
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

on openSettings_(sender)
	set statusText to my runStatusCommand(false)
	repeat
		set settingChoices to {my describeUiLanguage(statusText), my describeBadgeMode(statusText), my describeRefreshInterval(statusText), my describeWorkflowIds(statusText), my describePaths(statusText)}
		set picked to choose from list settingChoices with title appTitle with prompt (my localizedText(statusText, "Choose a tray setting to change", "选择要修改的任务栏设置")) OK button name (my localizedText(statusText, "Change", "修改")) cancel button name (my localizedText(statusText, "Close", "关闭"))
		if picked is false then return
		set selectedChoice to item 1 of picked
		if selectedChoice is item 1 of settingChoices then
			my chooseUiLanguage(statusText)
		else if selectedChoice is item 2 of settingChoices then
			my chooseBadgeMode(statusText)
		else if selectedChoice is item 3 of settingChoices then
			my chooseRefreshInterval(statusText)
		else if selectedChoice is item 4 of settingChoices then
			my chooseWorkflowIds(statusText)
		else if selectedChoice is item 5 of settingChoices then
			my choosePaths(statusText)
		end if
		set statusText to my runStatusCommand(false)
	end repeat
end openSettings_

on chooseUiLanguage(statusText)
	set choices to {my localizedText(statusText, "English", "英文"), my localizedText(statusText, "Chinese", "中文")}
	set picked to choose from list choices with title appTitle with prompt (my localizedText(statusText, "Choose the tray language", "选择任务栏语言")) OK button name (my localizedText(statusText, "Apply", "应用")) cancel button name (my localizedText(statusText, "Back", "返回"))
	if picked is false then return
	if (item 1 of picked) is item 1 of choices then
		my runSettingCommand("ui_language", "en")
	else
		my runSettingCommand("ui_language", "zh")
	end if
end chooseUiLanguage

on chooseBadgeMode(statusText)
	set choices to {my localizedText(statusText, "Running Tasks", "运行中的任务"), my localizedText(statusText, "Running Workflows", "运行中的工作流"), my localizedText(statusText, "No Badge Count", "不显示数字角标")}
	set picked to choose from list choices with title appTitle with prompt (my localizedText(statusText, "Choose the menu bar badge mode", "选择菜单栏角标模式")) OK button name (my localizedText(statusText, "Apply", "应用")) cancel button name (my localizedText(statusText, "Back", "返回"))
	if picked is false then return
	if (item 1 of picked) is item 1 of choices then
		my runSettingCommand("badge_mode", "tasks")
	else if (item 1 of picked) is item 2 of choices then
		my runSettingCommand("badge_mode", "workflows")
	else
		my runSettingCommand("badge_mode", "none")
	end if
end chooseBadgeMode

on chooseRefreshInterval(statusText)
	set choices to {"5s", "15s", "30s", "60s"}
	set picked to choose from list choices with title appTitle with prompt (my localizedText(statusText, "Choose the refresh interval", "选择刷新间隔")) OK button name (my localizedText(statusText, "Apply", "应用")) cancel button name (my localizedText(statusText, "Back", "返回"))
	if picked is false then return
	set choiceValue to item 1 of picked
	if choiceValue ends with "s" then set choiceValue to text 1 thru -2 of choiceValue
	my runSettingCommand("refresh_interval_seconds", choiceValue)
end chooseRefreshInterval

on chooseWorkflowIds(statusText)
	set choices to {my localizedText(statusText, "Show Workflow IDs", "显示工作流 ID"), my localizedText(statusText, "Hide Workflow IDs", "隐藏工作流 ID")}
	set picked to choose from list choices with title appTitle with prompt (my localizedText(statusText, "Choose workflow ID visibility", "选择工作流 ID 显示方式")) OK button name (my localizedText(statusText, "Apply", "应用")) cancel button name (my localizedText(statusText, "Back", "返回"))
	if picked is false then return
	if (item 1 of picked) is item 1 of choices then
		my runSettingCommand("show_workflow_ids", "on")
	else
		my runSettingCommand("show_workflow_ids", "off")
	end if
end chooseWorkflowIds

on choosePaths(statusText)
	set choices to {my localizedText(statusText, "Show Path Shortcuts", "显示路径快捷入口"), my localizedText(statusText, "Hide Path Shortcuts", "隐藏路径快捷入口")}
	set picked to choose from list choices with title appTitle with prompt (my localizedText(statusText, "Choose path shortcut visibility", "选择路径快捷入口显示方式")) OK button name (my localizedText(statusText, "Apply", "应用")) cancel button name (my localizedText(statusText, "Back", "返回"))
	if picked is false then return
	if (item 1 of picked) is item 1 of choices then
		my runSettingCommand("show_paths", "on")
	else
		my runSettingCommand("show_paths", "off")
	end if
end choosePaths

on runSettingCommand(settingKey, settingValue)
	set commandText to quoted form of nodePath & space & quoted form of cliPath & " service telegram set-setting --key " & quoted form of settingKey & " --value " & quoted form of settingValue & " --state-dir " & quoted form of stateDir
	set statusText to my runStatusCommand(false)
	try
		set outputText to do shell script commandText
		display notification outputText with title appTitle
	on error errorMessage
		display notification errorMessage with title appTitle
	end try
	my refreshStatus()
end runSettingCommand

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

on runWorkflowHistoryCommand()
	set commandText to quoted form of nodePath & space & quoted form of cliPath & " service telegram workflow-history --state-dir " & quoted form of stateDir
	return do shell script commandText
end runWorkflowHistoryCommand

on runWorkflowDetailCommand(workflowIndex)
	set commandText to quoted form of nodePath & space & quoted form of cliPath & " service telegram workflow-detail --index " & (workflowIndex as string) & " --state-dir " & quoted form of stateDir
	return do shell script commandText
end runWorkflowDetailCommand

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
		display notification (my localizedText(my runStatusCommand(false), "No workflow session found yet.", "还没有工作流会话。")) with title appTitle
	else
		do shell script "open -R " & quoted form of workflowPath
	end if
end openLatestWorkflow_

on openCtoSoul_(sender)
	try
		do shell script "open " & quoted form of ctoSoulPath
	on error errorMessage
		display notification errorMessage with title appTitle
	end try
end openCtoSoul_

on resetCtoSoul_(sender)
	set statusText to my runStatusCommand(false)
	try
		set dialogResult to display dialog (my localizedText(statusText, "Restore the default Codex-CLI-based CTO soul template? This will overwrite the current file.", "恢复基于 Codex CLI 的默认 CTO 灵魂模板？这会覆盖当前文件。")) buttons {(my localizedText(statusText, "Cancel", "取消")), (my localizedText(statusText, "Restore", "恢复"))} default button (my localizedText(statusText, "Restore", "恢复")) with title appTitle
	on error number -128
		return
	end try
	if button returned of dialogResult is not (my localizedText(statusText, "Restore", "恢复")) then return
	my runServiceCommand("reset-cto-soul")
end resetCtoSoul_

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

on browseWorkflowHistory_(sender)
	try
		set workflowText to my runWorkflowHistoryCommand()
	on error errorMessage
		display dialog errorMessage buttons {"OK"} default button "OK" with title appTitle
		return
	end try

	set workflowItems to my collectPrefixedLines(workflowText, "Workflow ")
	set workflowItems to my filterIndexedLines(workflowItems)
	if (count of workflowItems) is 0 then
		display notification (my localizedText(my runStatusCommand(false), "No workflow history found yet.", "还没有工作流历史。")) with title appTitle
		return
	end if

	set statusText to my runStatusCommand(false)
	set picked to choose from list workflowItems with title appTitle with prompt (my localizedText(statusText, "Select a workflow to inspect", "选择要查看的工作流")) OK button name (my localizedText(statusText, "Open Detail", "打开详情")) cancel button name (my localizedText(statusText, "Cancel", "取消"))
	if picked is false then return

	set selectedIndex to my indexedLineNumber(item 1 of picked)
	if selectedIndex is 0 then
		display notification (my localizedText(my runStatusCommand(false), "Unable to parse the selected workflow history item.", "无法解析所选工作流历史项。")) with title appTitle
		return
	end if

	my openWorkflowRecord(selectedIndex)
end browseWorkflowHistory_

on browseTaskHistory_(sender)
	try
		set historyText to my runTaskHistoryCommand()
	on error errorMessage
		display dialog errorMessage buttons {"OK"} default button "OK" with title appTitle
		return
	end try

	set historyItems to my collectPrefixedLines(historyText, "History ")
	set historyItems to my filterIndexedLines(historyItems)
	if (count of historyItems) is 0 then
		display notification (my localizedText(my runStatusCommand(false), "No task history found yet.", "还没有任务历史。")) with title appTitle
		return
	end if

	set statusText to my runStatusCommand(false)
	set picked to choose from list historyItems with title appTitle with prompt (my localizedText(statusText, "Select a task to inspect", "选择要查看的任务")) OK button name (my localizedText(statusText, "Open Detail", "打开详情")) cancel button name (my localizedText(statusText, "Cancel", "取消"))
	if picked is false then return

	set selectedIndex to my historyIndexFromLine(item 1 of picked)
	if selectedIndex is 0 then
		display notification (my localizedText(my runStatusCommand(false), "Unable to parse the selected task history item.", "无法解析所选任务历史项。")) with title appTitle
		return
	end if

	my openDispatchRecord(selectedIndex)
end browseTaskHistory_

on openWorkflowRecord(workflowIndex)
	try
		set detailText to my runWorkflowDetailCommand(workflowIndex)
	on error errorMessage
		display dialog errorMessage buttons {"OK"} default button "OK" with title appTitle
		return
	end try

	set summaryText to my workflowSummaryText(detailText)
	set statusText to my runStatusCommand(false)
	set pathsVisible to my settingEnabled(statusText, "Show Paths: ", true)
	if pathsVisible then
		set actionButtons to {my localizedText(statusText, "Sections", "分段"), my localizedText(statusText, "Paths", "路径"), my localizedText(statusText, "Close", "关闭")}
	else
		set actionButtons to {my localizedText(statusText, "Sections", "分段"), my localizedText(statusText, "Close", "关闭")}
	end if
	repeat
		try
			set dialogResult to display dialog summaryText buttons actionButtons default button (item 1 of actionButtons) with title appTitle
		on error number -128
			return
		end try

		set selectedButton to button returned of dialogResult
		if selectedButton is my localizedText(statusText, "Close", "关闭") then
			return
		else if pathsVisible and selectedButton is my localizedText(statusText, "Paths", "路径") then
			my browseWorkflowArtifacts(detailText)
		else if selectedButton is my localizedText(statusText, "Sections", "分段") then
			set panelAction to my browseWorkflowSections(detailText)
			if panelAction is "close" then return
		end if
	end repeat
end openWorkflowRecord

on openDispatchRecord(dispatchIndex)
	try
		set detailText to my runDispatchDetailCommand(dispatchIndex)
	on error errorMessage
		display dialog errorMessage buttons {"OK"} default button "OK" with title appTitle
		return
	end try

	set summaryText to my dispatchSummaryText(detailText)
	set statusText to my runStatusCommand(false)
	set pathsVisible to my settingEnabled(statusText, "Show Paths: ", true)
	if pathsVisible then
		set actionButtons to {my localizedText(statusText, "Sections", "分段"), my localizedText(statusText, "Paths", "路径"), my localizedText(statusText, "Close", "关闭")}
	else
		set actionButtons to {my localizedText(statusText, "Sections", "分段"), my localizedText(statusText, "Close", "关闭")}
	end if
	repeat
		try
			set dialogResult to display dialog summaryText buttons actionButtons default button (item 1 of actionButtons) with title appTitle
		on error number -128
			return
		end try

		set selectedButton to button returned of dialogResult
		if selectedButton is my localizedText(statusText, "Close", "关闭") then
			return
		else if pathsVisible and selectedButton is my localizedText(statusText, "Paths", "路径") then
			my browseDispatchArtifacts(detailText)
		else if selectedButton is my localizedText(statusText, "Sections", "分段") then
			set panelAction to my browseDispatchSections(detailText)
			if panelAction is "close" then return
		end if
	end repeat
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

on browseDispatchSections(detailText)
	repeat
		set sectionNames to my dispatchSectionNames(detailText)
		if (count of sectionNames) is 0 then
			display notification (my localizedText(my runStatusCommand(false), "No extra sections available for this task.", "这个任务没有更多分段内容。")) with title appTitle
			return "back"
		end if

		set statusText to my runStatusCommand(false)
		set picked to choose from list sectionNames with title appTitle with prompt (my localizedText(statusText, "Select a detail section", "选择详情分段")) OK button name (my localizedText(statusText, "View", "查看")) cancel button name (my localizedText(statusText, "Back", "返回"))
		if picked is false then return "back"
		set sectionName to item 1 of picked
		set sectionText to my dispatchSectionText(detailText, sectionName)

		repeat
			set pathsVisible to my settingEnabled(statusText, "Show Paths: ", true)
			if pathsVisible then
				set sectionButtons to {my localizedText(statusText, "Back", "返回"), my localizedText(statusText, "Paths", "路径"), my localizedText(statusText, "Close", "关闭")}
			else
				set sectionButtons to {my localizedText(statusText, "Back", "返回"), my localizedText(statusText, "Close", "关闭")}
			end if
			try
				set dialogResult to display dialog sectionText buttons sectionButtons default button (item 1 of sectionButtons) with title (appTitle & " — " & sectionName)
			on error number -128
				return "back"
			end try

			set selectedButton to button returned of dialogResult
			if selectedButton is my localizedText(statusText, "Back", "返回") then
				exit repeat
			else if pathsVisible and selectedButton is my localizedText(statusText, "Paths", "路径") then
				my browseDispatchArtifacts(detailText)
			else if selectedButton is my localizedText(statusText, "Close", "关闭") then
				return "close"
			end if
		end repeat
	end repeat
end browseDispatchSections

on browseDispatchArtifacts(detailText)
	set artifactChoices to {}
	set recordPath to my lineValue(detailText, "Record Path: ", "")
	set sessionPath to my lineValue(detailText, "Session Path: ", "")
	set eventsPath to my lineValue(detailText, "Events Path: ", "")
	set messagePath to my lineValue(detailText, "Last Message Path: ", "")

	if recordPath is not "" then set end of artifactChoices to "Record — " & my truncateText(recordPath, 72)
	if sessionPath is not "" and sessionPath is not recordPath then set end of artifactChoices to "Session — " & my truncateText(sessionPath, 72)
	if eventsPath is not "" then set end of artifactChoices to "Events — " & my truncateText(eventsPath, 72)
	if messagePath is not "" then set end of artifactChoices to "Last Message — " & my truncateText(messagePath, 72)

	if (count of artifactChoices) is 0 then
		display notification (my localizedText(my runStatusCommand(false), "No artifact paths available for this task.", "这个任务没有可打开的路径。")) with title appTitle
		return
	end if

	set statusText to my runStatusCommand(false)
	set picked to choose from list artifactChoices with title appTitle with prompt (my localizedText(statusText, "Reveal a task artifact in Finder", "在 Finder 中显示任务产物")) OK button name (my localizedText(statusText, "Open", "打开")) cancel button name (my localizedText(statusText, "Back", "返回"))
	if picked is false then return
	set selectedArtifact to item 1 of picked

	if selectedArtifact starts with "Record — " then
		do shell script "open -R " & quoted form of recordPath
	else if selectedArtifact starts with "Session — " then
		do shell script "open -R " & quoted form of sessionPath
	else if selectedArtifact starts with "Events — " then
		do shell script "open -R " & quoted form of eventsPath
	else if selectedArtifact starts with "Last Message — " then
		do shell script "open -R " & quoted form of messagePath
	end if
end browseDispatchArtifacts

on browseWorkflowSections(detailText)
	repeat
		set sectionNames to my workflowSectionNames(detailText)
		if (count of sectionNames) is 0 then
			display notification (my localizedText(my runStatusCommand(false), "No extra sections available for this workflow.", "这个工作流没有更多分段内容。")) with title appTitle
			return "back"
		end if

		set statusText to my runStatusCommand(false)
		set picked to choose from list sectionNames with title appTitle with prompt (my localizedText(statusText, "Select a workflow detail section", "选择工作流详情分段")) OK button name (my localizedText(statusText, "View", "查看")) cancel button name (my localizedText(statusText, "Back", "返回"))
		if picked is false then return "back"
		set sectionName to item 1 of picked
		set sectionText to my workflowSectionText(detailText, sectionName)

		repeat
			set pathsVisible to my settingEnabled(statusText, "Show Paths: ", true)
			if pathsVisible then
				set sectionButtons to {my localizedText(statusText, "Back", "返回"), my localizedText(statusText, "Paths", "路径"), my localizedText(statusText, "Close", "关闭")}
			else
				set sectionButtons to {my localizedText(statusText, "Back", "返回"), my localizedText(statusText, "Close", "关闭")}
			end if
			try
				set dialogResult to display dialog sectionText buttons sectionButtons default button (item 1 of sectionButtons) with title (appTitle & " — " & sectionName)
			on error number -128
				return "back"
			end try

			set selectedButton to button returned of dialogResult
			if selectedButton is my localizedText(statusText, "Back", "返回") then
				exit repeat
			else if pathsVisible and selectedButton is my localizedText(statusText, "Paths", "路径") then
				my browseWorkflowArtifacts(detailText)
			else if selectedButton is my localizedText(statusText, "Close", "关闭") then
				return "close"
			end if
		end repeat
	end repeat
end browseWorkflowSections

on browseWorkflowArtifacts(detailText)
	set recordPath to my lineValue(detailText, "Record Path: ", "")
	set sessionPath to my lineValue(detailText, "Session Path: ", "")
	set workflowStatePath to my lineValue(detailText, "Workflow State Path: ", "")
	set eventsPath to my lineValue(detailText, "Events Path: ", "")
	set messagePath to my lineValue(detailText, "Last Message Path: ", "")

	set artifactChoices to {}
	if recordPath is not "" then set end of artifactChoices to "Record — " & my truncateText(recordPath, 72)
	if sessionPath is not "" then set end of artifactChoices to "Session — " & my truncateText(sessionPath, 72)
	if workflowStatePath is not "" then set end of artifactChoices to "Workflow State — " & my truncateText(workflowStatePath, 72)
	if eventsPath is not "" then set end of artifactChoices to "Events — " & my truncateText(eventsPath, 72)
	if messagePath is not "" then set end of artifactChoices to "Last Message — " & my truncateText(messagePath, 72)

	if (count of artifactChoices) is 0 then
		display notification (my localizedText(my runStatusCommand(false), "No artifact paths available for this workflow.", "这个工作流没有可打开的路径。")) with title appTitle
		return
	end if

	set statusText to my runStatusCommand(false)
	set picked to choose from list artifactChoices with title appTitle with prompt (my localizedText(statusText, "Reveal a workflow artifact in Finder", "在 Finder 中显示工作流产物")) OK button name (my localizedText(statusText, "Open", "打开")) cancel button name (my localizedText(statusText, "Back", "返回"))
	if picked is false then return
	set selectedArtifact to item 1 of picked

	if selectedArtifact starts with "Record — " then
		do shell script "open -R " & quoted form of recordPath
	else if selectedArtifact starts with "Session — " then
		do shell script "open -R " & quoted form of sessionPath
	else if selectedArtifact starts with "Workflow State — " then
		do shell script "open -R " & quoted form of workflowStatePath
	else if selectedArtifact starts with "Events — " then
		do shell script "open -R " & quoted form of eventsPath
	else if selectedArtifact starts with "Last Message — " then
		do shell script "open -R " & quoted form of messagePath
	end if
end browseWorkflowArtifacts

on workflowSectionNames(detailText)
	set names to {"Summary"}
	if detailText contains "Highlights:" then set end of names to "Highlights"
	if detailText contains "Validation:" then set end of names to "Validation"
	if detailText contains "Changed Files:" then set end of names to "Changed Files"
	if detailText contains "Next Steps:" then set end of names to "Next Steps"
	if detailText contains "Recent Tasks:" then set end of names to "Recent Tasks"
	if detailText contains "Recent Activity:" then set end of names to "Recent Activity"
	if detailText contains "Last Message:" then set end of names to "Last Message"
	return names
end workflowSectionNames

on workflowSummaryText(detailText)
	set summaryLines to {}
	repeat with oneLine in paragraphs of detailText
		set currentLine to contents of oneLine
		if my isWorkflowSectionHeader(currentLine) or my isWorkflowPathLine(currentLine) then exit repeat
		set end of summaryLines to currentLine
	end repeat
	if (count of summaryLines) is 0 then return detailText
	return my joinLines(summaryLines)
end workflowSummaryText

on workflowSectionText(detailText, sectionName)
	if sectionName is "Summary" then return my workflowSummaryText(detailText)

	set targetHeader to sectionName & ":"
	set sectionLines to {}
	set captureLines to false
	repeat with oneLine in paragraphs of detailText
		set currentLine to contents of oneLine
		if currentLine is targetHeader then
			set captureLines to true
			set end of sectionLines to currentLine
		else if captureLines then
			if my isWorkflowSectionHeader(currentLine) or my isWorkflowPathLine(currentLine) then exit repeat
			set end of sectionLines to currentLine
		end if
	end repeat
	if (count of sectionLines) is 0 then return sectionName & ": unavailable"
	return my joinLines(sectionLines)
end workflowSectionText

on isWorkflowSectionHeader(lineText)
	if lineText is "Highlights:" then return true
	if lineText is "Validation:" then return true
	if lineText is "Changed Files:" then return true
	if lineText is "Next Steps:" then return true
	if lineText is "Recent Tasks:" then return true
	if lineText is "Recent Activity:" then return true
	if lineText is "Last Message:" then return true
	return false
end isWorkflowSectionHeader

on isWorkflowPathLine(lineText)
	if lineText starts with "Record Path: " then return true
	if lineText starts with "Session Path: " then return true
	if lineText starts with "Workflow State Path: " then return true
	if lineText starts with "Events Path: " then return true
	if lineText starts with "Last Message Path: " then return true
	return false
end isWorkflowPathLine

on dispatchSectionNames(detailText)
	set names to {"Summary"}
	if detailText contains "Highlights:" then set end of names to "Highlights"
	if detailText contains "Validation:" then set end of names to "Validation"
	if detailText contains "Changed Files:" then set end of names to "Changed Files"
	if detailText contains "Next Steps:" then set end of names to "Next Steps"
	if detailText contains "Recent Activity:" then set end of names to "Recent Activity"
	if detailText contains "Last Message:" then set end of names to "Last Message"
	return names
end dispatchSectionNames

on dispatchSummaryText(detailText)
	set summaryLines to {}
	repeat with oneLine in paragraphs of detailText
		set currentLine to contents of oneLine
		if my isDispatchSectionHeader(currentLine) or my isDispatchPathLine(currentLine) then exit repeat
		set end of summaryLines to currentLine
	end repeat
	if (count of summaryLines) is 0 then return detailText
	return my joinLines(summaryLines)
end dispatchSummaryText

on dispatchSectionText(detailText, sectionName)
	if sectionName is "Summary" then return my dispatchSummaryText(detailText)

	set targetHeader to sectionName & ":"
	set sectionLines to {}
	set captureLines to false
	repeat with oneLine in paragraphs of detailText
		set currentLine to contents of oneLine
		if currentLine is targetHeader then
			set captureLines to true
			set end of sectionLines to currentLine
		else if captureLines then
			if my isDispatchSectionHeader(currentLine) or my isDispatchPathLine(currentLine) then exit repeat
			set end of sectionLines to currentLine
		end if
	end repeat
	if (count of sectionLines) is 0 then return sectionName & ": unavailable"
	return my joinLines(sectionLines)
end dispatchSectionText

on isDispatchSectionHeader(lineText)
	if lineText is "Highlights:" then return true
	if lineText is "Validation:" then return true
	if lineText is "Changed Files:" then return true
	if lineText is "Next Steps:" then return true
	if lineText is "Recent Activity:" then return true
	if lineText is "Last Message:" then return true
	return false
end isDispatchSectionHeader

on isDispatchPathLine(lineText)
	if lineText starts with "Record Path: " then return true
	if lineText starts with "Session Path: " then return true
	if lineText starts with "Events Path: " then return true
	if lineText starts with "Last Message Path: " then return true
	return false
end isDispatchPathLine

on joinLines(lineItems)
	set AppleScript's text item delimiters to linefeed
	set outputText to lineItems as text
	set AppleScript's text item delimiters to ""
	return outputText
end joinLines

on collectPrefixedLines(inputText, prefixText)
	set matchedLines to {}
	repeat with oneLine in paragraphs of inputText
		set currentLine to contents of oneLine
		if currentLine starts with prefixText then set end of matchedLines to currentLine
	end repeat
	return matchedLines
end collectPrefixedLines

on filterIndexedLines(lineItems)
	set filteredLines to {}
	repeat with oneLine in lineItems
		set currentLine to contents of oneLine
		set currentIndex to my indexedLineNumber(currentLine)
		if currentIndex is not 0 then
			set suffixText to text ((offset of ":" in currentLine) + 1) thru -1 of currentLine
			if suffixText does not start with " Updated" and suffixText does not start with " Tasks" and suffixText does not start with " Workflow" and suffixText does not start with " Session" then
				set end of filteredLines to currentLine
			end if
		end if
	end repeat
	return filteredLines
end filterIndexedLines

on indexedLineNumber(lineText)
	set colonOffset to offset of ":" in lineText
	if colonOffset is 0 then return 0
	set prefixText to text 1 thru (colonOffset - 1) of lineText
	set spaceOffset to offset of " " in prefixText
	if spaceOffset is 0 then return 0
	try
		return (text (spaceOffset + 1) thru -1 of prefixText) as integer
	on error
		return 0
	end try
end indexedLineNumber

on historyIndexFromLine(lineText)
	return my indexedLineNumber(lineText)
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
    `线程：主活跃 ${payload.active_main_thread_count ?? payload.running_workflow_count ?? 0} / 子活跃 ${payload.active_child_thread_count ?? payload.running_task_count ?? 0} / 子累计 ${payload.child_session_count ?? payload.child_thread_count ?? 0}`
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
