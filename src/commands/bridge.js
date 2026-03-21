import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { chmod, rm, writeFile } from 'node:fs/promises';
import { parseOptions } from '../lib/args.js';
import {
  CODEX_BRIDGE_SHIM_MARKER,
  inspectBridgeShim,
  inspectCurrentCodexCandidate,
  inspectRegisteredBridge,
  isOpenCodexCodexBridgeShim,
  persistBridgeShimState,
  registerCodexBridge,
  resolveBridgeBinDir,
  resolveBridgeStatePath,
  resolveBridgeStateRoot,
  resolveCodexShimPath
} from '../lib/bridge-state.js';
import { ensureDir } from '../lib/fs.js';
import { canonicalizeCliLauncherPath, describeOpenCodexLauncher } from '../lib/launcher.js';

const STATUS_OPTION_SPEC = {
  json: { type: 'boolean' },
  cwd: { type: 'string' },
  'bin-dir': { type: 'string' }
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

export async function runBridgeCommand(args) {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    process.stdout.write(
      'Usage:\n' +
      '  opencodex bridge status [--json] [--cwd <dir>] [--bin-dir <dir>]\n' +
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
  const payload = buildBridgeStatusPayload({
    homeDir,
    bridgeRecord,
    detectedCodex,
    shimInspection
  });

  renderBridgePayload(payload, options.json);
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

  await spawnRealCodex(realCodexPath, args, {
    cwd,
    env: {
      ...process.env,
      OPENCODEX_CODEX_BRIDGE_ACTIVE: '1',
      OPENCODEX_CODEX_BRIDGE_REAL_PATH: realCodexPath,
      OPENCODEX_CODEX_BRIDGE_STATE_PATH: bridgeRecord.statePath
    }
  });
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

function buildBridgeStatusPayload({ homeDir, bridgeRecord, detectedCodex, shimInspection }) {
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
      active_session_updated_at: '',
      bin_dir: resolveBridgeBinDir({ homeDir }),
      shim_path: resolveCodexShimPath({ homeDir }),
      shim_installed_at: '',
      controller_path: '',
      controller_scope: ''
    },
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

  basePayload.next_steps.push('Bridge state and codex shim look ready for the live-session phase.');
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

async function spawnRealCodex(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: 'inherit'
    });

    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      if (typeof code === 'number') {
        process.exitCode = code;
      }
      resolve();
    });
  });
}
