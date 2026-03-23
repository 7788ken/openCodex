import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { access, realpath } from 'node:fs/promises';
import { appendFile, chmod, rm, writeFile } from 'node:fs/promises';
import { parseOptions } from '../lib/args.js';
import {
  CODEX_BRIDGE_SHIM_MARKER,
  inspectBridgeShim,
  inspectCurrentCodexCandidate,
  inspectRegisteredBridge,
  isOpenCodexCodexBridgeShim,
  persistBridgeShimState,
  resolveBridgeActiveSessionPath,
  registerCodexBridge,
  resolveBridgeBinDir,
  resolveBridgeStatePath,
  resolveBridgeStateRoot,
  resolveCodexShimPath
} from '../lib/bridge-state.js';
import { queueBridgeSessionMessage, waitForBridgeMessageDelivery } from '../lib/bridge-live-session.js';
import { ensureDir, readTextIfExists, toIsoString, writeJson } from '../lib/fs.js';
import { canonicalizeCliLauncherPath, describeOpenCodexLauncher } from '../lib/launcher.js';
import { applySessionContract, buildSessionContract } from '../lib/session-contract.js';
import { createSession, getSessionDir, listSessions, loadSession, saveSession } from '../lib/session-store.js';

const STATUS_OPTION_SPEC = {
  json: { type: 'boolean' },
  cwd: { type: 'string' },
  'bin-dir': { type: 'string' }
};

const TAIL_OPTION_SPEC = {
  json: { type: 'boolean' },
  cwd: { type: 'string' },
  limit: { type: 'string' },
  'session-id': { type: 'string' }
};

const INBOX_OPTION_SPEC = {
  json: { type: 'boolean' },
  cwd: { type: 'string' },
  limit: { type: 'string' },
  'session-id': { type: 'string' }
};

const SEND_OPTION_SPEC = {
  json: { type: 'boolean' },
  cwd: { type: 'string' },
  'session-id': { type: 'string' }
};

const REGISTER_CODEX_OPTION_SPEC = {
  json: { type: 'boolean' },
  cwd: { type: 'string' },
  path: { type: 'string' }
};

const INSTALL_SHIM_OPTION_SPEC = {
  json: { type: 'boolean' },
  cwd: { type: 'string' },
  'bin-dir': { type: 'string' },
  force: { type: 'boolean' }
};

const REPAIR_SHIM_OPTION_SPEC = {
  json: { type: 'boolean' },
  cwd: { type: 'string' },
  'bin-dir': { type: 'string' }
};

const RECENT_BRIDGE_MESSAGE_LIMIT = 3;

export async function runBridgeCommand(args) {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    process.stdout.write(
      'Usage:\n' +
      '  opencodex bridge status [--json] [--cwd <dir>] [--bin-dir <dir>]\n' +
      '  opencodex bridge tail [--json] [--cwd <dir>] [--limit <n>] [--session-id <id|active|latest>]\n' +
      '  opencodex bridge inbox [--json] [--cwd <dir>] [--limit <n>] [--session-id <id|active|latest>]\n' +
      '  opencodex bridge send [--json] [--cwd <dir>] [--session-id <id|active>] <text>\n' +
      '  opencodex bridge register-codex [--path <path>] [--json] [--cwd <dir>]\n' +
      '  opencodex bridge install-shim [--bin-dir <dir>] [--force] [--json] [--cwd <dir>]\n' +
      '  opencodex bridge repair-shim [--bin-dir <dir>] [--json] [--cwd <dir>]\n'
    );
    return;
  }

  if (subcommand === 'status') {
    await runBridgeStatus(rest);
    return;
  }

  if (subcommand === 'tail') {
    await runBridgeTail(rest);
    return;
  }

  if (subcommand === 'inbox') {
    await runBridgeInbox(rest);
    return;
  }

  if (subcommand === 'send') {
    await runBridgeSend(rest);
    return;
  }

  if (subcommand === 'register-codex') {
    await runBridgeRegisterCodex(rest);
    return;
  }

  if (subcommand === 'install-shim') {
    await runBridgeInstallShim(rest);
    return;
  }

  if (subcommand === 'repair-shim') {
    await runBridgeRepairShim(rest);
    return;
  }

  if (subcommand === 'exec-codex') {
    await runBridgeExecCodex(rest);
    return;
  }

  throw new Error(`Unknown bridge subcommand: ${subcommand}`);
}

async function runBridgeStatus(args) {
  const { options, positionals } = parseOptions(args, STATUS_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex bridge status` does not accept positional arguments');
  }

  const cwd = path.resolve(options.cwd || process.cwd());
  const homeDir = os.homedir();
  const bridgeRecord = await inspectRegisteredBridge({ cwd, env: process.env, homeDir });
  const detectedCodex = !bridgeRecord.exists || bridgeRecord.error || !bridgeRecord.registration?.valid
    ? await inspectCurrentCodexCandidate({ cwd, env: process.env })
    : null;
  const shimInspection = await inspectBridgeShim({
    cwd,
    env: process.env,
    homeDir,
    binDir: options['bin-dir'] || ''
  });
  const activeSession = await inspectActiveBridgeSession({
    bridgeState: bridgeRecord.state?.bridge,
    statePath: bridgeRecord.statePath,
    homeDir
  });
  const payload = buildBridgeStatusPayload({
    homeDir,
    bridgeRecord,
    detectedCodex,
    shimInspection,
    activeSession
  });

  renderBridgePayload(payload, options.json);
}

async function runBridgeTail(args) {
  const { options, positionals } = parseOptions(args, TAIL_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex bridge tail` does not accept positional arguments');
  }

  const cwd = path.resolve(options.cwd || process.cwd());
  const homeDir = os.homedir();
  const limit = parsePositiveInteger(options.limit || '20', '--limit');
  const selection = await resolvePreferredBridgeSession({
    cwd,
    homeDir,
    commandLabel: 'opencodex bridge tail',
    sessionIdSelector: typeof options['session-id'] === 'string' ? options['session-id'].trim() : '',
    requireActive: false
  });
  const runtimePaths = getBridgeRuntimePaths(selection.session.working_directory, selection.session.session_id);
  const lines = await readBridgeOutputTail(runtimePaths.outputLogPath, limit);
  const payload = {
    ok: true,
    action: 'tail',
    session_id: selection.session.session_id,
    session_selection: selection.selection,
    count: lines.length,
    lines
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  process.stdout.write(`Bridge tail for ${payload.session_id}\n`);
  process.stdout.write(`Session selection: ${renderBridgeSessionSelectionText(payload.session_selection)}\n`);
  if (!lines.length) {
    process.stdout.write('\nNo bridge output captured yet.\n');
    return;
  }
  process.stdout.write('\n');
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
}

async function runBridgeInbox(args) {
  const { options, positionals } = parseOptions(args, INBOX_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex bridge inbox` does not accept positional arguments');
  }

  const cwd = path.resolve(options.cwd || process.cwd());
  const homeDir = os.homedir();
  const limit = parsePositiveInteger(options.limit || '20', '--limit');
  const selection = await resolvePreferredBridgeSession({
    cwd,
    homeDir,
    commandLabel: 'opencodex bridge inbox',
    sessionIdSelector: typeof options['session-id'] === 'string' ? options['session-id'].trim() : '',
    requireActive: false
  });
  const runtimePaths = getBridgeRuntimePaths(selection.session.working_directory, selection.session.session_id);
  const inboxMessages = (await readBridgeInboxMessages(runtimePaths.inboxPath)).slice(-limit);
  const deliveredByMessageId = await readBridgeDeliveryMap(runtimePaths.controlEventsPath);
  const messages = inboxMessages.map((message) => ({
    ...message,
    delivered_at: deliveredByMessageId.get(message.message_id) || ''
  }));

  const payload = {
    ok: true,
    action: 'inbox',
    session_id: selection.session.session_id,
    session_selection: selection.selection,
    count: messages.length,
    messages
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  process.stdout.write(`Bridge inbox for ${payload.session_id}\n`);
  process.stdout.write(`Session selection: ${renderBridgeSessionSelectionText(payload.session_selection)}\n`);
  if (!messages.length) {
    process.stdout.write('\nNo external bridge messages recorded yet.\n');
    return;
  }

  for (const message of messages) {
    process.stdout.write(`\n- ${message.created_at}  ${message.source}\n`);
    process.stdout.write(`  ${message.text}\n`);
    if (message.delivered_at) {
      process.stdout.write(`  delivered: ${message.delivered_at}\n`);
    }
  }
}

async function runBridgeSend(args) {
  const { options, positionals } = parseOptions(args, SEND_OPTION_SPEC);
  const text = positionals.join(' ').trim();
  if (!text) {
    throw new Error('`opencodex bridge send` requires a non-empty text payload');
  }

  const cwd = path.resolve(options.cwd || process.cwd());
  const homeDir = os.homedir();
  const selection = await resolvePreferredBridgeSession({
    cwd,
    homeDir,
    commandLabel: 'opencodex bridge send',
    sessionIdSelector: typeof options['session-id'] === 'string' ? options['session-id'].trim() : '',
    requireActive: true
  });
  const session = selection.session;
  if (session.status !== 'running') {
    throw new Error(`Bridge session is not running: ${session.session_id}`);
  }

  const queued = await queueBridgeSessionMessage({
    cwd: session.working_directory,
    sessionId: session.session_id,
    text,
    source: 'bridge_send'
  });
  const delivery = await waitForBridgeMessageDelivery({
    controlEventsPath: queued.runtimePaths.controlEventsPath,
    messageId: queued.message.message_id
  });

  const payload = {
    ok: true,
    action: 'send',
    session_id: session.session_id,
    session_selection: selection.selection,
    message: {
      ...queued.message,
      delivery_status: delivery.delivery_status,
      delivered_at: delivery.delivered_at
    },
    next_steps: [
      `Use \`opencodex bridge inbox --session-id ${session.session_id}\` to inspect the queued and delivered external messages.`
    ]
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  const deliveryLabel = delivery.delivery_status === 'delivered'
    ? `Bridge message delivered to ${session.session_id}`
    : `Bridge message queued for ${session.session_id}`;
  process.stdout.write(`${deliveryLabel}\n`);
  process.stdout.write(`Selection: ${renderBridgeSessionSelectionText(selection.selection)}\n`);
  process.stdout.write(`Text: ${text}\n`);
}

async function runBridgeRegisterCodex(args) {
  const { options, positionals } = parseOptions(args, REGISTER_CODEX_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex bridge register-codex` does not accept positional arguments');
  }

  const cwd = path.resolve(options.cwd || process.cwd());
  const result = await registerCodexBridge({
    cwd,
    env: process.env,
    homeDir: os.homedir(),
    pathValue: options.path || ''
  });

  const payload = {
    ok: true,
    action: 'register-codex',
    registered: true,
    state_root: result.stateRoot,
    state_path: result.statePath,
    state_schema: result.state.schema,
    codex: {
      ...result.state.codex,
      valid: result.registration.valid,
      validation_error: result.registration.validation_error
    },
    bridge: result.state.bridge,
    next_steps: [
      'Use `opencodex bridge status` to inspect the saved launcher state.',
      'Run `opencodex bridge install-shim` to add the transparent `codex` entrypoint.'
    ]
  };

  renderBridgePayload(payload, options.json);
}

async function runBridgeInstallShim(args) {
  const { options, positionals } = parseOptions(args, INSTALL_SHIM_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex bridge install-shim` does not accept positional arguments');
  }

  const payload = await installOrRepairShim({
    cwd: path.resolve(options.cwd || process.cwd()),
    homeDir: os.homedir(),
    binDir: options['bin-dir'] || '',
    force: Boolean(options.force),
    mode: 'install-shim'
  });

  renderBridgePayload(payload, options.json);
}

async function runBridgeRepairShim(args) {
  const { options, positionals } = parseOptions(args, REPAIR_SHIM_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex bridge repair-shim` does not accept positional arguments');
  }

  const payload = await installOrRepairShim({
    cwd: path.resolve(options.cwd || process.cwd()),
    homeDir: os.homedir(),
    binDir: options['bin-dir'] || '',
    force: true,
    mode: 'repair-shim'
  });

  renderBridgePayload(payload, options.json);
}

async function runBridgeExecCodex(args) {
  const cwd = process.cwd();
  const homeDir = os.homedir();
  const bridgeRecord = await inspectRegisteredBridge({ cwd, env: process.env, homeDir });
  if (!bridgeRecord.exists || bridgeRecord.error || !bridgeRecord.registration?.valid) {
    throw new Error('No valid real Codex launcher is registered. Run `opencodex bridge register-codex --path <real-codex-path>` first.');
  }

  const shimInspection = await inspectBridgeShim({ cwd, env: process.env, homeDir });
  const realCodexPath = bridgeRecord.registration.resolved_path;
  if (!realCodexPath) {
    throw new Error('The registered Codex launcher is empty.');
  }
  if (realCodexPath === shimInspection.shim_path || shimInspection.registered_target_is_shim || await isOpenCodexCodexBridgeShim(realCodexPath)) {
    throw new Error(`Refusing to execute because the registered real Codex launcher points back to the bridge shim: ${realCodexPath}`);
  }

  const session = createSession({
    command: 'bridge',
    cwd,
    codexCliVersion: bridgeRecord.registration.version || bridgeRecord.state?.codex?.version || 'unknown',
    input: {
      prompt: '',
      arguments: {
        surface: 'codex_cli',
        launch_mode: 'bridge_shim',
        passthrough_args: args,
        real_codex_path: realCodexPath,
        bridge_state_path: bridgeRecord.statePath
      }
    }
  });
  applySessionContract(session, buildSessionContract({
    layer: 'host',
    scope: 'codex_bridge',
    thread_kind: 'host_workflow',
    role: 'bridge_supervisor'
  }));
  session.status = 'running';

  const sessionDir = await saveSession(cwd, session);
  const runtimeArtifactPath = path.join(sessionDir, 'artifacts', 'bridge-runtime.json');
  const eventsPath = path.join(sessionDir, 'events.jsonl');
  const inboxPath = path.join(sessionDir, 'artifacts', 'bridge-inbox.jsonl');
  const controlEventsPath = path.join(sessionDir, 'artifacts', 'bridge-control-events.jsonl');
  const outputLogPath = path.join(sessionDir, 'artifacts', 'bridge-output.log');
  session.summary = buildBridgeSessionSummary({
    status: 'running',
    realCodexPath,
    args
  });
  session.artifacts = [
    {
      type: 'bridge_runtime',
      path: runtimeArtifactPath,
      description: 'Bridge-owned live Codex session metadata.'
    },
    {
      type: 'jsonl_events',
      path: eventsPath,
      description: 'Bridge runtime lifecycle events.'
    },
    {
      type: 'bridge_inbox',
      path: inboxPath,
      description: 'External messages queued for the running bridge session.'
    },
    {
      type: 'bridge_control_events',
      path: controlEventsPath,
      description: 'Bridge control delivery events for the running session.'
    },
    {
      type: 'bridge_output_log',
      path: outputLogPath,
      description: 'Captured bridge session output stream.'
    }
  ];
  await saveSession(cwd, session);

  const startedAt = session.created_at || toIsoString();
  const activeSessionPath = resolveBridgeActiveSessionPath({ statePath: bridgeRecord.statePath, homeDir });
  await writeJson(runtimeArtifactPath, {
    session_id: session.session_id,
    surface: 'codex_cli',
    launch_mode: 'bridge_shim',
    working_directory: cwd,
    real_codex_path: realCodexPath,
    passthrough_args: args,
    bridge_state_path: bridgeRecord.statePath,
    started_at: startedAt,
    updated_at: startedAt,
    status: 'running',
    pid: 0
  });
  await appendBridgeLifecycleEvent(eventsPath, {
    type: 'bridge.session.started',
    created_at: startedAt,
    session_id: session.session_id,
    working_directory: cwd,
    real_codex_path: realCodexPath,
    passthrough_args: args
  });
  await writeJson(activeSessionPath, {
    session_id: session.session_id,
    working_directory: cwd,
    command: args.join(' '),
    started_at: startedAt,
    updated_at: startedAt,
    bridge_state_path: bridgeRecord.statePath,
    status: 'running',
      pid: 0,
      transport: 'pty_inbox',
      output_log_path: outputLogPath
    });

  let runtime = null;
  try {
    runtime = spawnBridgeRuntime(realCodexPath, args, {
      cwd,
      env: {
        ...process.env,
        OPENCODEX_CODEX_BRIDGE_ACTIVE: '1',
        OPENCODEX_CODEX_BRIDGE_REAL_PATH: realCodexPath,
        OPENCODEX_CODEX_BRIDGE_STATE_PATH: bridgeRecord.statePath,
        OPENCODEX_PARENT_SESSION_ID: session.session_id
      },
      inboxPath,
      controlEventsPath,
      outputLogPath
    });

    await writeJson(runtimeArtifactPath, {
      session_id: session.session_id,
      surface: 'codex_cli',
      launch_mode: 'bridge_shim',
      working_directory: cwd,
      real_codex_path: realCodexPath,
      passthrough_args: args,
      bridge_state_path: bridgeRecord.statePath,
      started_at: startedAt,
      updated_at: toIsoString(),
      status: 'running',
      pid: runtime.child.pid || 0,
      transport: runtime.transport,
      inbox_path: inboxPath,
      control_events_path: controlEventsPath,
      output_log_path: outputLogPath
    });
    await writeJson(activeSessionPath, {
      session_id: session.session_id,
      working_directory: cwd,
      command: args.join(' '),
      started_at: startedAt,
      updated_at: toIsoString(),
      bridge_state_path: bridgeRecord.statePath,
      status: 'running',
      pid: runtime.child.pid || 0,
      transport: runtime.transport,
      output_log_path: outputLogPath
    });

    const result = await runtime.completion;
    session.status = resolveBridgeSessionStatus(result);
    session.updated_at = toIsoString();
    session.summary = buildBridgeSessionSummary({
      status: session.status,
      realCodexPath,
      args,
      exitCode: result.code,
      signal: result.signal
    });
    await appendBridgeLifecycleEvent(eventsPath, {
      type: 'bridge.session.exited',
      created_at: session.updated_at,
      session_id: session.session_id,
      exit_code: result.code,
      signal: result.signal || '',
      status: session.status
    });
    await writeJson(runtimeArtifactPath, {
      session_id: session.session_id,
      surface: 'codex_cli',
      launch_mode: 'bridge_shim',
      working_directory: cwd,
      real_codex_path: realCodexPath,
      passthrough_args: args,
      bridge_state_path: bridgeRecord.statePath,
      started_at: startedAt,
      updated_at: session.updated_at,
      finished_at: session.updated_at,
      status: session.status,
      pid: runtime.child.pid || 0,
      transport: runtime.transport,
      inbox_path: inboxPath,
      control_events_path: controlEventsPath,
      output_log_path: outputLogPath,
      exit_code: result.code,
      signal: result.signal || ''
    });
    await saveSession(cwd, session);

    if (result.signal) {
      process.kill(process.pid, result.signal);
      return;
    }
    process.exitCode = result.code;
    return;
  } catch (error) {
    session.status = 'failed';
    session.updated_at = toIsoString();
    session.summary = buildBridgeSessionSummary({
      status: 'failed',
      realCodexPath,
      args,
      errorMessage: error instanceof Error ? error.message : String(error)
    });
    await appendBridgeLifecycleEvent(eventsPath, {
      type: 'bridge.session.failed',
      created_at: session.updated_at,
      session_id: session.session_id,
      error: error instanceof Error ? error.message : String(error)
    });
    await writeJson(runtimeArtifactPath, {
      session_id: session.session_id,
      surface: 'codex_cli',
      launch_mode: 'bridge_shim',
      working_directory: cwd,
      real_codex_path: realCodexPath,
      passthrough_args: args,
      bridge_state_path: bridgeRecord.statePath,
      started_at: startedAt,
      updated_at: session.updated_at,
      finished_at: session.updated_at,
      status: 'failed',
      pid: runtime?.child?.pid || 0,
      transport: runtime?.transport || '',
      inbox_path: inboxPath,
      control_events_path: controlEventsPath,
      output_log_path: outputLogPath,
      error: error instanceof Error ? error.message : String(error)
    });
    await saveSession(cwd, session);
    throw error;
  } finally {
    await clearActiveBridgeSessionFile(activeSessionPath, session.session_id);
  }
}

async function installOrRepairShim({ cwd, homeDir, binDir, force, mode }) {
  const bridgeRecord = await inspectRegisteredBridge({ cwd, env: process.env, homeDir });
  if (!bridgeRecord.exists || bridgeRecord.error || !bridgeRecord.state || !bridgeRecord.registration?.valid) {
    throw new Error('A valid real Codex launcher must be registered before installing the bridge shim.');
  }

  const normalizedBinDir = resolveBridgeBinDir({ homeDir, binDir });
  const shimPath = resolveCodexShimPath({ homeDir, binDir });
  const controllerPath = canonicalizeCliLauncherPath(process.argv[1] || '', process.argv[1] || '');
  const controller = describeOpenCodexLauncher(controllerPath, controllerPath);
  const realCodexPath = bridgeRecord.registration.resolved_path;

  if (!realCodexPath) {
    throw new Error('The registered real Codex launcher path is empty.');
  }
  if (realCodexPath === shimPath || await isOpenCodexCodexBridgeShim(realCodexPath)) {
    throw new Error(`Refusing to install a shim that would recurse into itself: ${realCodexPath}`);
  }

  const shimExists = await fileExists(shimPath);
  if (shimExists && !force) {
    throw new Error(`Codex bridge shim already exists: ${shimPath}. Pass --force or use \`opencodex bridge repair-shim\`.`);
  }

  await ensureDir(normalizedBinDir);
  await writeFile(shimPath, buildCodexBridgeShim(controllerPath), 'utf8');
  await chmod(shimPath, 0o755);

  const persisted = await persistBridgeShimState({
    cwd,
    env: process.env,
    homeDir,
    binDir,
    controllerPath
  });
  const shimInspection = await inspectBridgeShim({
    cwd,
    env: process.env,
    homeDir,
    binDir
  });

  return {
    ok: true,
    action: mode,
    registered: true,
    state_root: persisted.stateRoot,
    state_path: persisted.statePath,
    state_schema: persisted.state.schema,
    codex: {
      ...persisted.state.codex,
      valid: bridgeRecord.registration.valid,
      validation_error: bridgeRecord.registration.validation_error
    },
    bridge: persisted.state.bridge,
    shim: {
      path: shimPath,
      exists: shimInspection.shim_exists,
      valid: shimInspection.valid,
      path_precedence: shimInspection.path_precedence,
      controller_path: shimInspection.controller_path,
      controller_scope: shimInspection.controller_scope,
      recursion_risk: shimInspection.recursion_risk
    },
    next_steps: [
      `Place ${normalizedBinDir} ahead of other Codex launchers on PATH if you want \`codex\` to route through openCodex by default.`,
      'Use `opencodex bridge status` to confirm PATH precedence and shim health.'
    ]
  };
}

function buildBridgeStatusPayload({ homeDir, bridgeRecord, detectedCodex, shimInspection, activeSession }) {
  const basePayload = {
    ok: true,
    action: 'status',
    registered: Boolean(bridgeRecord.exists && !bridgeRecord.error && bridgeRecord.state),
    state_root: resolveBridgeStateRoot({ homeDir }),
    state_path: resolveBridgeStatePath({ homeDir }),
    state_schema: bridgeRecord.state?.schema || '',
    codex: bridgeRecord.state?.codex || null,
    bridge: bridgeRecord.state?.bridge || {
      default_surface: 'cli',
      active_session_id: '',
      active_session_cwd: '',
      active_session_command: '',
      active_session_started_at: '',
      active_session_updated_at: '',
      bin_dir: resolveBridgeBinDir({ homeDir }),
      shim_path: resolveCodexShimPath({ homeDir }),
      shim_installed_at: '',
      controller_path: '',
      controller_scope: ''
    },
    active_session: activeSession,
    codex_valid: Boolean(bridgeRecord.registration?.valid),
    validation_error: bridgeRecord.registration?.validation_error || '',
    detected_codex: detectedCodex,
    shim: {
      path: shimInspection.shim_path,
      exists: shimInspection.shim_exists,
      valid: shimInspection.valid,
      marker_present: shimInspection.marker_present,
      controller_match: shimInspection.controller_match,
      path_precedence: shimInspection.path_precedence,
      recursion_risk: shimInspection.recursion_risk,
      path_command: shimInspection.path_command,
      controller_path: shimInspection.controller_path,
      controller_scope: shimInspection.controller_scope,
      installed_at: shimInspection.installed_at
    },
    next_steps: []
  };

  if (bridgeRecord.error) {
    basePayload.validation_error = `Bridge state could not be parsed: ${bridgeRecord.error.message}`;
    basePayload.next_steps.push('Repair the bridge state with `opencodex bridge register-codex --path <real-codex-path>`.');
    return basePayload;
  }

  if (!basePayload.registered) {
    if (detectedCodex?.valid) {
      basePayload.next_steps.push(`Run \`opencodex bridge register-codex --path ${detectedCodex.resolved_path}\` to persist the current Codex launcher.`);
    } else {
      basePayload.next_steps.push('Run `opencodex bridge register-codex --path <real-codex-path>` after confirming the installed Codex CLI path.');
    }
    return basePayload;
  }

  if (!bridgeRecord.registration?.valid) {
    basePayload.next_steps.push('Repair the bridge state with `opencodex bridge register-codex --path <real-codex-path>`.');
    return basePayload;
  }

  if (!basePayload.shim.exists) {
    basePayload.next_steps.push('Run `opencodex bridge install-shim` to add the transparent `codex` entrypoint.');
    return basePayload;
  }

  if (basePayload.shim.recursion_risk) {
    basePayload.validation_error = `The registered real Codex launcher points back to the bridge shim: ${bridgeRecord.registration.resolved_path}`;
    basePayload.next_steps.push('Re-register the real Codex binary with `opencodex bridge register-codex --path <real-codex-path>` and then run `opencodex bridge repair-shim`.');
    return basePayload;
  }

  if (!basePayload.shim.valid) {
    basePayload.next_steps.push('Run `opencodex bridge repair-shim` to rewrite the installed codex bridge shim.');
    return basePayload;
  }

  if (basePayload.shim.path_precedence !== 'bridge_shim') {
    basePayload.next_steps.push(`Move ${path.dirname(basePayload.shim.path)} ahead of other Codex launchers on PATH if you want \`codex\` to route through openCodex by default.`);
    return basePayload;
  }

  if (basePayload.active_session?.record_found && basePayload.active_session.status === 'running') {
    basePayload.next_steps.push(`Bridge currently owns active session ${basePayload.active_session.session_id}. Use \`opencodex session show ${basePayload.active_session.session_id}\` in ${basePayload.active_session.working_directory} to inspect it.`);
    return basePayload;
  }

  basePayload.next_steps.push('Bridge state and codex shim look ready for the next bridge-owned Codex launch.');
  return basePayload;
}

function renderBridgePayload(payload, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  const lines = [];
  lines.push(resolveBridgeTitle(payload.action));
  lines.push('');
  lines.push(`Registered: ${payload.registered ? 'yes' : 'no'}`);
  lines.push(`State Root: ${payload.state_root}`);
  lines.push(`State Path: ${payload.state_path}`);

  if (payload.codex) {
    lines.push(`Codex Path: ${payload.codex.path || '(none)'}`);
    lines.push(`Resolved Path: ${payload.codex.resolved_path || '(none)'}`);
    lines.push(`Source: ${payload.codex.source || '(none)'}`);
    lines.push(`Version: ${payload.codex.version || '(unknown)'}`);
    lines.push(`Valid: ${payload.codex_valid ? 'yes' : 'no'}`);
  }

  if (payload.shim) {
    lines.push(`Shim Path: ${payload.shim.path}`);
    lines.push(`Shim Exists: ${payload.shim.exists ? 'yes' : 'no'}`);
    lines.push(`Shim Valid: ${payload.shim.valid ? 'yes' : 'no'}`);
    lines.push(`PATH Precedence: ${payload.shim.path_precedence}`);
  }

  if (payload.active_session?.session_id) {
    lines.push(`Active Session: ${payload.active_session.session_id}`);
    lines.push(`Active Session Status: ${payload.active_session.status || 'unknown'}`);
    lines.push(`Active Session CWD: ${payload.active_session.working_directory || '(unknown)'}`);
    if (payload.active_session.command) {
      lines.push(`Active Session Command: ${payload.active_session.command}`);
    }
    if (Number.isInteger(payload.active_session.inbox_count)) {
      lines.push(`Active Session Inbox: ${payload.active_session.inbox_count} queued`);
    }
    if (Number.isInteger(payload.active_session.delivered_count)) {
      lines.push(`Active Session Delivered: ${payload.active_session.delivered_count}`);
    }
    if (Number.isInteger(payload.active_session.pending_count)) {
      lines.push(`Active Session Pending: ${payload.active_session.pending_count}`);
    }
    if (Array.isArray(payload.active_session.recent_inbox_messages) && payload.active_session.recent_inbox_messages.length) {
      lines.push('Recent External Messages:');
      for (const message of payload.active_session.recent_inbox_messages) {
        const suffix = message.delivery_status === 'delivered'
          ? ` delivered ${message.delivered_at || ''}`.trimEnd()
          : ' pending';
        lines.push(`- ${message.created_at || '(unknown)'}  ${message.source || 'external'}  ${suffix}`);
        lines.push(`  ${message.text || ''}`);
      }
    }
    if (Array.isArray(payload.active_session.recent_output_lines) && payload.active_session.recent_output_lines.length) {
      lines.push('Recent Output:');
      for (const line of payload.active_session.recent_output_lines) {
        lines.push(`- ${line}`);
      }
    }
  }

  if (payload.detected_codex?.resolved_path) {
    lines.push(`Detected Codex: ${payload.detected_codex.resolved_path}`);
  }

  if (payload.validation_error) {
    lines.push(`Validation Error: ${payload.validation_error}`);
  }

  if (Array.isArray(payload.next_steps) && payload.next_steps.length) {
    lines.push('Next Steps:');
    for (const step of payload.next_steps) {
      lines.push(`- ${step}`);
    }
  }

  process.stdout.write(`${lines.join('\n')}\n`);
}

function resolveBridgeTitle(action) {
  if (action === 'register-codex') {
    return 'Codex bridge registered';
  }
  if (action === 'install-shim') {
    return 'Codex bridge shim installed';
  }
  if (action === 'repair-shim') {
    return 'Codex bridge shim repaired';
  }
  return 'Codex bridge status';
}

function buildCodexBridgeShim(controllerPath) {
  return [
    '#!/bin/zsh',
    CODEX_BRIDGE_SHIM_MARKER,
    'set -euo pipefail',
    `exec /usr/bin/env node ${shellQuote(controllerPath)} bridge exec-codex "$@"`
  ].join('\n') + '\n';
}

function shellQuote(value) {
  return `'${String(value || '').replace(/'/g, `'\\''`)}'`;
}

async function fileExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function resolveBridgeRuntimeStrategy({
  platform = process.platform,
  stdinIsTTY = Boolean(process.stdin?.isTTY)
} = {}) {
  if (platform === 'win32' || !stdinIsTTY) {
    return {
      launcher: 'pipe',
      transport: 'pipe_inbox'
    };
  }

  if (platform === 'darwin') {
    return {
      launcher: 'expect',
      transport: 'pty_inbox'
    };
  }

  return {
    launcher: 'script',
    transport: 'pty_inbox'
  };
}

function spawnBridgeRuntime(command, args, options = {}) {
  const strategy = resolveBridgeRuntimeStrategy();
  if (strategy.launcher === 'pipe') {
    return spawnPipeBridgeRuntime(command, args, options);
  }

  const child = strategy.launcher === 'expect'
    ? spawnExpectBridgeRuntime(command, args, options)
    : spawnScriptBridgeRuntime(command, args, options);

  const stopLocalInput = forwardLocalBridgeInput(child);
  const stopInboxRelay = startBridgeInboxRelay({
    child,
    inboxPath: options.inboxPath,
    controlEventsPath: options.controlEventsPath
  });

  child.stdout.on('data', (chunk) => {
    void teeBridgeOutput(chunk, process.stdout, options.outputLogPath);
  });
  child.stderr.on('data', (chunk) => {
    void teeBridgeOutput(chunk, process.stderr, options.outputLogPath);
  });

  const completion = new Promise((resolve, reject) => {
    child.on('error', (error) => {
      stopInboxRelay();
      stopLocalInput();
      reject(error);
    });
    child.on('close', (code, signal) => {
      stopInboxRelay();
      stopLocalInput();
      resolve({
        code: typeof code === 'number' ? code : 1,
        signal: signal || '',
        pid: child.pid || 0
      });
    });
  });

  return {
    child,
    completion,
    transport: strategy.transport
  };
}

function spawnScriptBridgeRuntime(command, args, options = {}) {
  return spawn('script', ['-q', '/dev/null', command, ...args], {
    cwd: options.cwd,
    env: options.env || process.env,
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

function spawnExpectBridgeRuntime(command, args, options = {}) {
  return spawn('/usr/bin/expect', ['-c', buildExpectBridgeRuntimeScript(command, args)], {
    cwd: options.cwd,
    env: options.env || process.env,
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

function buildExpectBridgeRuntimeScript(command, args) {
  const argvList = [command, ...args].map((value) => tclDoubleQuote(value)).join(' ');
  return [
    'log_user 1',
    'set timeout -1',
    'fconfigure stdin -blocking 0 -buffering none -translation binary -encoding binary',
    'proc relay_stdin {spawn_id} {',
    '  if {[eof stdin]} { return }',
    '  set chunk [read stdin]',
    '  if {$chunk eq ""} { return }',
    '  send -i $spawn_id -- $chunk',
    '}',
    `set command [list ${argvList}]`,
    'spawn -noecho {*}$command',
    'set bridge_spawn_id $spawn_id',
    'fileevent stdin readable [list relay_stdin $bridge_spawn_id]',
    'expect eof',
    'catch wait result',
    'exit [lindex $result 3]'
  ].join('\n');
}

function tclDoubleQuote(value) {
  return `"${String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')}"`;
}

function spawnPipeBridgeRuntime(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const stopLocalInput = forwardLocalBridgeInput(child);
  const stopInboxRelay = startBridgeInboxRelay({
    child,
    inboxPath: options.inboxPath,
    controlEventsPath: options.controlEventsPath
  });

  child.stdout.on('data', (chunk) => {
    void teeBridgeOutput(chunk, process.stdout, options.outputLogPath);
  });
  child.stderr.on('data', (chunk) => {
    void teeBridgeOutput(chunk, process.stderr, options.outputLogPath);
  });

  const completion = new Promise((resolve, reject) => {
    child.on('error', (error) => {
      stopInboxRelay();
      stopLocalInput();
      reject(error);
    });
    child.on('close', (code, signal) => {
      stopInboxRelay();
      stopLocalInput();
      resolve({
        code: typeof code === 'number' ? code : 1,
        signal: signal || '',
        pid: child.pid || 0
      });
    });
  });

  return {
    child,
    completion,
    transport: 'pipe_inbox'
  };
}

async function inspectActiveBridgeSession({ bridgeState, statePath = '', homeDir = os.homedir() } = {}) {
  const activeSessionPath = resolveBridgeActiveSessionPath({ statePath, homeDir });
  const activeSessionRaw = await readTextIfExists(activeSessionPath);
  if (!activeSessionRaw) {
    return null;
  }

  let activeSession = null;
  try {
    activeSession = JSON.parse(activeSessionRaw);
  } catch {
    return {
      session_id: '',
      working_directory: '',
      command: '',
      started_at: '',
      updated_at: '',
      status: 'invalid',
      session_path: '',
      record_found: false,
      state_path: activeSessionPath
    };
  }

  const sessionId = typeof activeSession?.session_id === 'string' ? activeSession.session_id.trim() : '';
  const sessionCwd = typeof activeSession?.working_directory === 'string' ? activeSession.working_directory.trim() : '';
  if (!sessionId) {
    return null;
  }

  const sessionPath = sessionCwd ? path.join(getSessionDir(sessionCwd, sessionId), 'session.json') : '';
  try {
    const session = sessionCwd ? await loadSession(sessionCwd, sessionId) : null;
    const runtimePaths = session ? getBridgeRuntimePaths(sessionCwd, sessionId) : null;
    const inboxMessages = runtimePaths ? await readBridgeInboxMessages(runtimePaths.inboxPath) : [];
    const deliveredByMessageId = runtimePaths ? await readBridgeDeliveryMap(runtimePaths.controlEventsPath) : new Map();
    const recentOutputLines = runtimePaths ? await readBridgeOutputTail(runtimePaths.outputLogPath, 5) : [];
    const inboxSnapshot = buildBridgeInboxSnapshot(inboxMessages, deliveredByMessageId);
    return {
      session_id: sessionId,
      working_directory: session?.working_directory || sessionCwd,
      command: typeof activeSession?.command === 'string' && activeSession.command.trim()
        ? activeSession.command
        : (typeof bridgeState?.active_session_command === 'string' ? bridgeState.active_session_command : ''),
      started_at: typeof activeSession?.started_at === 'string' && activeSession.started_at.trim()
        ? activeSession.started_at
        : (typeof bridgeState?.active_session_started_at === 'string' ? bridgeState.active_session_started_at : ''),
      updated_at: session?.updated_at || activeSession?.updated_at || bridgeState?.active_session_updated_at || '',
      status: session?.status || '',
      session_path: sessionPath,
      record_found: Boolean(session),
      state_path: activeSessionPath,
      inbox_count: inboxSnapshot.inbox_count,
      delivered_count: inboxSnapshot.delivered_count,
      pending_count: inboxSnapshot.pending_count,
      recent_inbox_messages: inboxSnapshot.recent_messages,
      recent_output_lines: recentOutputLines
    };
  } catch {
    return {
      session_id: sessionId,
      working_directory: sessionCwd,
      command: typeof activeSession?.command === 'string' ? activeSession.command : '',
      started_at: typeof activeSession?.started_at === 'string' ? activeSession.started_at : '',
      updated_at: typeof activeSession?.updated_at === 'string' ? activeSession.updated_at : '',
      status: 'missing',
      session_path: sessionPath,
      record_found: false,
      state_path: activeSessionPath
    };
  }
}

function buildBridgeSessionSummary({ status, realCodexPath, args, exitCode, signal, errorMessage = '' }) {
  const normalizedStatus = String(status || '').trim() || 'running';
  const highlights = [
    `Real Codex: ${realCodexPath}.`,
    args.length ? `Args: ${args.join(' ')}` : 'Args: (none).'
  ];

  if (normalizedStatus === 'running') {
    return {
      title: 'Bridge session running',
      result: 'Bridge-owned Codex CLI session is running.',
      status: 'running',
      highlights,
      next_steps: ['Use `opencodex bridge status` to inspect the active bridge pointer.'],
      risks: [],
      validation: [],
      changed_files: [],
      findings: []
    };
  }

  if (normalizedStatus === 'completed') {
    return {
      title: 'Bridge session completed',
      result: `Bridge-owned Codex CLI session exited cleanly with code ${Number.isInteger(exitCode) ? exitCode : 0}.`,
      status: 'completed',
      highlights,
      next_steps: [],
      risks: [],
      validation: ['bridge_process_exit:0'],
      changed_files: [],
      findings: []
    };
  }

  if (normalizedStatus === 'cancelled') {
    return {
      title: 'Bridge session cancelled',
      result: `Bridge-owned Codex CLI session stopped because the child process ended with signal ${signal || 'unknown'}.`,
      status: 'cancelled',
      highlights,
      next_steps: ['Re-run `codex ...` if you need to resume the bridge-owned session.'],
      risks: [],
      validation: [signal ? `bridge_process_signal:${signal}` : 'bridge_process_signal:unknown'],
      changed_files: [],
      findings: []
    };
  }

  return {
    title: 'Bridge session failed',
    result: errorMessage || `Bridge-owned Codex CLI session exited with code ${Number.isInteger(exitCode) ? exitCode : 1}.`,
    status: 'failed',
    highlights,
    next_steps: ['Inspect the bridge session artifacts and the direct terminal output for the failure cause.'],
    risks: [],
    validation: [Number.isInteger(exitCode) ? `bridge_process_exit:${exitCode}` : 'bridge_process_exit:unknown'],
    changed_files: [],
    findings: []
  };
}

function resolveBridgeSessionStatus(result) {
  if (result?.signal) {
    return 'cancelled';
  }
  return result?.code === 0 ? 'completed' : 'failed';
}

async function appendBridgeLifecycleEvent(eventsPath, event) {
  await appendFile(eventsPath, `${JSON.stringify(event)}\n`, 'utf8');
}

async function clearActiveBridgeSessionFile(activeSessionPath, sessionId) {
  const raw = await readTextIfExists(activeSessionPath);
  if (!raw) {
    return;
  }

  try {
    const payload = JSON.parse(raw);
    if (payload?.session_id && payload.session_id !== sessionId) {
      return;
    }
  } catch {
  }

  await rm(activeSessionPath, { force: true });
}

function forwardLocalBridgeInput(child) {
  if (!process.stdin || !child?.stdin) {
    return () => {};
  }

  const onData = (chunk) => {
    if (!child.stdin.destroyed) {
      child.stdin.write(chunk);
    }
  };
  const restoreRawMode = process.stdin.isTTY && typeof process.stdin.setRawMode === 'function'
    ? Boolean(process.stdin.isRaw)
    : null;

  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function' && !process.stdin.isRaw) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.on('data', onData);

  return () => {
    process.stdin.off('data', onData);
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function' && restoreRawMode === false) {
      process.stdin.setRawMode(false);
    }
  };
}

function startBridgeInboxRelay({ child, inboxPath = '', controlEventsPath = '' } = {}) {
  if (!inboxPath || !child?.stdin) {
    return () => {};
  }

  const deliveredMessageIds = new Set();
  let stopped = false;
  let busy = false;

  const timer = setInterval(() => {
    void flushInbox();
  }, 100);

  void flushInbox();

  return () => {
    stopped = true;
    clearInterval(timer);
  };

  async function flushInbox() {
    if (stopped || busy) {
      return;
    }
    busy = true;
    try {
      const messages = await readBridgeInboxMessages(inboxPath);
      for (const message of messages) {
        if (!message?.message_id || deliveredMessageIds.has(message.message_id)) {
          continue;
        }
        if (!child.stdin.destroyed) {
          child.stdin.write(`${message.text}\n`);
        }
        deliveredMessageIds.add(message.message_id);
        if (controlEventsPath) {
          await appendBridgeRuntimeJsonl(controlEventsPath, {
            type: 'bridge.inbox.delivered',
            created_at: toIsoString(),
            message_id: message.message_id,
            session_id: message.session_id || '',
            text: message.text || ''
          });
        }
      }
    } finally {
      busy = false;
    }
  }
}

function getBridgeRuntimePaths(cwd, sessionId) {
  const sessionDir = getSessionDir(cwd, sessionId);
  return {
    sessionDir,
    inboxPath: path.join(sessionDir, 'artifacts', 'bridge-inbox.jsonl'),
    controlEventsPath: path.join(sessionDir, 'artifacts', 'bridge-control-events.jsonl'),
    runtimePath: path.join(sessionDir, 'artifacts', 'bridge-runtime.json'),
    outputLogPath: path.join(sessionDir, 'artifacts', 'bridge-output.log')
  };
}

async function readBridgeInboxMessages(filePath) {
  return readBridgeRuntimeJsonl(filePath);
}

async function readBridgeDeliveryMap(filePath) {
  const events = await readBridgeRuntimeJsonl(filePath);
  const deliveredByMessageId = new Map();
  for (const event of events) {
    if (event?.type !== 'bridge.inbox.delivered' || !event?.message_id) {
      continue;
    }
    deliveredByMessageId.set(event.message_id, event.created_at || '');
  }
  return deliveredByMessageId;
}

function buildBridgeInboxSnapshot(inboxMessages, deliveredByMessageId) {
  const messages = Array.isArray(inboxMessages) ? inboxMessages : [];
  const deliveredMap = deliveredByMessageId instanceof Map ? deliveredByMessageId : new Map();
  const recentMessages = messages
    .map((message) => {
      const deliveredAt = message?.message_id ? (deliveredMap.get(message.message_id) || '') : '';
      return {
        message_id: message?.message_id || '',
        created_at: message?.created_at || '',
        source: message?.source || '',
        text: message?.text || '',
        delivered_at: deliveredAt,
        delivery_status: deliveredAt ? 'delivered' : 'pending'
      };
    })
    .slice(-RECENT_BRIDGE_MESSAGE_LIMIT)
    .reverse();

  return {
    inbox_count: messages.length,
    delivered_count: deliveredMap.size,
    pending_count: messages.reduce((count, message) => (
      deliveredMap.has(message?.message_id) ? count : count + 1
    ), 0),
    recent_messages: recentMessages
  };
}

async function readBridgeRuntimeJsonl(filePath) {
  const raw = await readTextIfExists(filePath);
  if (!raw) {
    return [];
  }

  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function appendBridgeRuntimeJsonl(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await appendFile(filePath, `${JSON.stringify(value)}\n`, 'utf8');
}

async function readBridgeOutputTail(filePath, limit) {
  const raw = await readTextIfExists(filePath);
  if (!raw) {
    return [];
  }

  return sanitizeBridgeOutputText(raw)
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-Math.max(1, limit));
}

async function resolvePreferredBridgeSession({
  cwd,
  homeDir = os.homedir(),
  commandLabel,
  sessionIdSelector = '',
  requireActive = false
}) {
  const requested = String(sessionIdSelector || '').trim();
  const activeSession = await inspectActiveBridgeSession({ homeDir });

  if (!requested || requested === 'active') {
    if (activeSession?.session_id) {
      return {
        session: {
          session_id: activeSession.session_id,
          status: activeSession.status,
          working_directory: activeSession.working_directory
        },
        selection: {
          mode: requested === 'active' ? 'explicit_active' : 'active',
          requested: requested || '',
          description: requested === 'active'
            ? `explicit_active(${requested})`
            : 'active'
        }
      };
    }

  if (requireActive) {
      throw new Error(`No active bridge session found for \`${commandLabel}\``);
    }
  }

  const sessions = await listBridgeSessionsForLookup(cwd);

  if (requested && requested !== 'active' && requested !== 'latest') {
    const explicit = sessions.find((session) => session.session_id === requested);
    if (!explicit) {
      throw new Error(`Bridge session not found for \`${commandLabel}\`: ${requested}`);
    }
    return {
      session: explicit,
      selection: {
        mode: 'explicit_id',
        requested,
        description: `explicit_id(${requested})`
      }
    };
  }

  if (!sessions.length) {
    throw new Error(`No bridge session found for \`${commandLabel}\``);
  }

  return {
    session: sessions[0],
    selection: {
      mode: requested === 'latest' ? 'explicit_latest' : 'latest_history',
      requested: requested || '',
      description: requested === 'latest'
        ? `explicit_latest(${requested})`
        : 'latest_history'
    }
  };
}

function parsePositiveInteger(value, flagName) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flagName} must be a positive integer`);
  }
  return parsed;
}

function renderBridgeSessionSelectionText(selection) {
  return selection?.description || selection?.mode || 'unknown';
}

function createBridgeMessageId() {
  const timestamp = new Date().toISOString().replace(/[-:.]/g, '').replace('T', '-').slice(0, 15);
  const random = Math.random().toString(36).slice(2, 8);
  return `bridge-msg-${timestamp}-${random}`;
}

async function listBridgeSessionsForLookup(cwd) {
  const lookupRoots = [path.resolve(cwd)];
  try {
    const realCwd = await realpath(cwd);
    if (!lookupRoots.includes(realCwd)) {
      lookupRoots.push(realCwd);
    }
  } catch {
  }

  const seenIds = new Set();
  const sessions = [];
  for (const root of lookupRoots) {
    for (const session of await listSessions(root)) {
      if (session?.command !== 'bridge' || !session?.session_id || seenIds.has(session.session_id)) {
        continue;
      }
      seenIds.add(session.session_id);
      sessions.push(session);
    }
  }

  return sessions.sort((left, right) => String(right.updated_at || '').localeCompare(String(left.updated_at || '')));
}

async function teeBridgeOutput(chunk, stream, outputLogPath = '') {
  const text = chunk.toString();
  stream.write(text);
  if (!outputLogPath) {
    return;
  }

  const normalized = sanitizeBridgeOutputText(text);
  if (normalized) {
    await appendFile(outputLogPath, normalized, 'utf8');
  }
}

function sanitizeBridgeOutputText(text) {
  return String(text || '')
    .replace(/\u0008/g, '')
    .replace(/\r/g, '');
}
