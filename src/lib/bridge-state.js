import os from 'node:os';
import path from 'node:path';
import { access, readFile, realpath } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { canonicalizeCliLauncherPath, describeOpenCodexLauncher } from './launcher.js';
import { getCodexBin, runCommandCapture } from './codex.js';
import { readTextIfExists, toIsoString, writeJson } from './fs.js';

export const BRIDGE_STATE_SCHEMA = 'opencodex/bridge-state/v1';
export const CODEX_BRIDGE_SHIM_MARKER = '# openCodex codex bridge shim';

export function resolveBridgeStateRoot({ homeDir = os.homedir() } = {}) {
  return path.join(homeDir, '.opencodex', 'bridge');
}

export function resolveBridgeStatePath(options = {}) {
  return path.join(resolveBridgeStateRoot(options), 'bridge.json');
}

export function resolveBridgeBinDir({ homeDir = os.homedir(), binDir = '' } = {}) {
  return path.resolve(binDir || path.join(homeDir, '.local', 'bin'));
}

export function resolveCodexShimPath(options = {}) {
  return path.join(resolveBridgeBinDir(options), 'codex');
}

export async function readBridgeStateRecord(options = {}) {
  const statePath = resolveBridgeStatePath(options);
  const raw = await readTextIfExists(statePath);

  if (raw === null) {
    return {
      statePath,
      exists: false,
      state: null,
      error: null
    };
  }

  try {
    return {
      statePath,
      exists: true,
      state: JSON.parse(raw),
      error: null
    };
  } catch (error) {
    return {
      statePath,
      exists: true,
      state: null,
      error
    };
  }
}

export async function inspectCurrentCodexCandidate({ cwd = process.cwd(), env = process.env, pathValue = '' } = {}) {
  const requestedPath = typeof pathValue === 'string' && pathValue.trim()
    ? pathValue.trim()
    : getCodexBin();
  const source = determineCodexTargetSource({ env, pathValue });
  return inspectCodexLauncher({
    cwd,
    env,
    requestedPath,
    source
  });
}

export async function inspectCommandOnPath(commandName, { cwd = process.cwd(), env = process.env } = {}) {
  return inspectCodexLauncher({
    cwd,
    env,
    requestedPath: commandName,
    source: 'path_lookup',
    probeVersion: false
  });
}

export async function inspectRegisteredBridge({ cwd = process.cwd(), env = process.env, homeDir = os.homedir() } = {}) {
  const record = await readBridgeStateRecord({ homeDir });
  if (!record.exists || record.error || !record.state) {
    return {
      statePath: record.statePath,
      exists: record.exists,
      error: record.error,
      state: record.state,
      registration: null
    };
  }

  const registration = await inspectCodexLauncher({
    cwd,
    env,
    requestedPath: record.state?.codex?.resolved_path || record.state?.codex?.path || '',
    source: typeof record.state?.codex?.source === 'string' && record.state.codex.source.trim()
      ? record.state.codex.source.trim()
      : 'manual_register'
  });

  return {
    statePath: record.statePath,
    exists: true,
    error: null,
    state: record.state,
    registration
  };
}

export async function inspectBridgeShim({
  cwd = process.cwd(),
  env = process.env,
  homeDir = os.homedir(),
  binDir = ''
} = {}) {
  const bridgeRecord = await inspectRegisteredBridge({ cwd, env, homeDir });
  const shimPath = resolveCodexShimPath({ homeDir, binDir: binDir || bridgeRecord.state?.bridge?.bin_dir || '' });
  const shimExists = await pathExists(shimPath);
  const canonicalShimPath = shimExists
    ? await canonicalizeFilePath(shimPath)
    : path.resolve(shimPath);
  const shimContent = shimExists ? (await readTextIfExists(shimPath)) || '' : '';
  const markerPresent = shimContent.includes(CODEX_BRIDGE_SHIM_MARKER);
  const controllerPath = asTrimmedString(bridgeRecord.state?.bridge?.controller_path);
  const controllerMatch = markerPresent && controllerPath
    ? shimContent.includes(controllerPath)
    : false;
  const pathCommand = await inspectCommandOnPath('codex', { cwd, env });
  const registeredTargetPath = bridgeRecord.registration?.resolved_path || '';
  const registeredTargetIsShim = registeredTargetPath
    ? await isOpenCodexCodexBridgeShim(registeredTargetPath)
    : false;
  const recursionRisk = matchesKnownPath(registeredTargetPath, shimPath, canonicalShimPath) || registeredTargetIsShim;
  const pathPrecedence = !pathCommand.resolved_path
    ? 'missing'
    : matchesKnownPath(pathCommand.resolved_path, shimPath, canonicalShimPath)
      ? 'bridge_shim'
      : 'other';

  return {
    shim_path: shimPath,
    shim_exists: shimExists,
    marker_present: markerPresent,
    controller_match: controllerMatch,
    valid: shimExists && markerPresent && controllerMatch && !recursionRisk,
    recursion_risk: recursionRisk,
    path_precedence: pathPrecedence,
    path_command: pathCommand,
    controller_path: controllerPath,
    controller_scope: asTrimmedString(bridgeRecord.state?.bridge?.controller_scope),
    installed_at: asTrimmedString(bridgeRecord.state?.bridge?.shim_installed_at),
    registered_target_is_shim: registeredTargetIsShim
  };
}

export async function registerCodexBridge({ cwd = process.cwd(), env = process.env, homeDir = os.homedir(), pathValue = '' } = {}) {
  const registration = await inspectCurrentCodexCandidate({ cwd, env, pathValue });
  if (!registration.valid) {
    throw new Error(buildRegistrationFailureMessage(registration));
  }

  if (await isOpenCodexCodexBridgeShim(registration.resolved_path)) {
    throw new Error(`Refusing to register an openCodex codex shim as the real Codex launcher: ${registration.resolved_path}`);
  }

  const previous = await readBridgeStateRecord({ homeDir });
  const now = toIsoString();
  const nextState = {
    schema: BRIDGE_STATE_SCHEMA,
    created_at: previous.state?.created_at || now,
    updated_at: now,
    codex: {
      path: registration.path,
      resolved_path: registration.resolved_path,
      source: registration.source,
      version: registration.version,
      validated_at: now,
      exists: registration.exists,
      executable: registration.executable
    },
    bridge: {
      default_surface: previous.state?.bridge?.default_surface || 'cli',
      active_session_id: previous.state?.bridge?.active_session_id || '',
      active_session_updated_at: previous.state?.bridge?.active_session_updated_at || '',
      bin_dir: previous.state?.bridge?.bin_dir || '',
      shim_path: previous.state?.bridge?.shim_path || '',
      shim_installed_at: previous.state?.bridge?.shim_installed_at || '',
      controller_path: previous.state?.bridge?.controller_path || '',
      controller_scope: previous.state?.bridge?.controller_scope || ''
    }
  };

  const statePath = resolveBridgeStatePath({ homeDir });
  await writeJson(statePath, nextState);

  return {
    statePath,
    stateRoot: resolveBridgeStateRoot({ homeDir }),
    state: nextState,
    registration
  };
}

export async function persistBridgeShimState({
  cwd = process.cwd(),
  env = process.env,
  homeDir = os.homedir(),
  binDir = '',
  controllerPath = process.argv[1] || '',
  shimInstalledAt = toIsoString()
} = {}) {
  const bridgeRecord = await inspectRegisteredBridge({ cwd, env, homeDir });
  if (!bridgeRecord.exists || bridgeRecord.error || !bridgeRecord.state || !bridgeRecord.registration?.valid) {
    throw new Error('Cannot persist bridge shim state before a valid real Codex launcher is registered.');
  }

  const resolvedControllerPath = canonicalizeCliLauncherPath(controllerPath, controllerPath);
  const controllerScope = describeOpenCodexLauncher(resolvedControllerPath, resolvedControllerPath).launcherScope;
  const nextState = {
    ...bridgeRecord.state,
    updated_at: toIsoString(),
    bridge: {
      ...bridgeRecord.state.bridge,
      default_surface: bridgeRecord.state?.bridge?.default_surface || 'cli',
      active_session_id: bridgeRecord.state?.bridge?.active_session_id || '',
      active_session_updated_at: bridgeRecord.state?.bridge?.active_session_updated_at || '',
      bin_dir: resolveBridgeBinDir({ homeDir, binDir }),
      shim_path: resolveCodexShimPath({ homeDir, binDir }),
      shim_installed_at: shimInstalledAt,
      controller_path: resolvedControllerPath,
      controller_scope: controllerScope
    }
  };

  const statePath = resolveBridgeStatePath({ homeDir });
  await writeJson(statePath, nextState);
  return {
    statePath,
    stateRoot: resolveBridgeStateRoot({ homeDir }),
    state: nextState
  };
}

export async function isOpenCodexCodexBridgeShim(targetPath) {
  const normalized = asTrimmedString(targetPath);
  if (!normalized) {
    return false;
  }

  try {
    const content = await readFile(normalized, 'utf8');
    return content.includes(CODEX_BRIDGE_SHIM_MARKER);
  } catch {
    return false;
  }
}

function determineCodexTargetSource({ env = process.env, pathValue = '' } = {}) {
  if (typeof pathValue === 'string' && pathValue.trim()) {
    return 'manual_register';
  }
  if (typeof env.OPENCODEX_CODEX_BIN === 'string' && env.OPENCODEX_CODEX_BIN.trim()) {
    return 'env_override';
  }
  return 'path_lookup';
}

async function inspectCodexLauncher({
  cwd = process.cwd(),
  env = process.env,
  requestedPath = '',
  source = '',
  probeVersion = true
} = {}) {
  const requested = String(requestedPath || '').trim();
  const resolvedPath = requested
    ? await resolveExecutablePath(requested, { cwd, env })
    : '';
  const exists = resolvedPath ? await pathExists(resolvedPath) : false;
  const executable = resolvedPath ? await isExecutablePath(resolvedPath) : false;
  const bridgeShim = resolvedPath
    ? await isOpenCodexCodexBridgeShim(resolvedPath)
    : false;
  let versionResult = { code: 0, stdout: '', stderr: '' };
  if (resolvedPath && executable && probeVersion && !bridgeShim) {
    versionResult = await runCommandCapture(resolvedPath, ['--version'], { cwd, env });
  } else if (probeVersion && !bridgeShim) {
    versionResult = {
      code: 1,
      stdout: '',
      stderr: resolvedPath
        ? 'Executable path is not runnable.'
        : 'Launcher path could not be resolved.'
    };
  }
  const version = probeVersion && !bridgeShim
    ? pickFirstMeaningfulLine(versionResult.stdout || versionResult.stderr)
    : '';
  const validationError = !requested
    ? 'No Codex launcher path was provided or discovered.'
    : !resolvedPath
      ? `Launcher path could not be resolved from ${requested}.`
      : !exists
        ? `Resolved launcher path does not exist: ${resolvedPath}`
        : !executable
          ? `Executable path is not runnable: ${resolvedPath}`
          : bridgeShim
            ? `Resolved Codex launcher is an openCodex bridge shim: ${resolvedPath}`
            : probeVersion && versionResult.code !== 0
              ? (version || `Failed to validate Codex launcher at ${resolvedPath}.`)
              : '';

  return {
    path: requested,
    resolved_path: resolvedPath,
    source,
    exists,
    executable,
    bridge_shim: bridgeShim,
    version,
    valid: Boolean(resolvedPath) && exists && executable && !bridgeShim && (!probeVersion || versionResult.code === 0),
    validation_error: validationError
  };
}

async function resolveExecutablePath(requestedPath, { cwd = process.cwd(), env = process.env } = {}) {
  if (!requestedPath) {
    return '';
  }

  if (hasPathSeparator(requestedPath)) {
    const absolutePath = path.resolve(cwd, requestedPath);
    return canonicalizeFilePath(absolutePath);
  }

  const searchPaths = String(env.PATH || '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const extensions = process.platform === 'win32'
    ? String(env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
      .split(';')
      .map((value) => value.trim())
      .filter(Boolean)
    : [''];

  for (const searchPath of searchPaths) {
    for (const extension of extensions) {
      const candidate = path.join(searchPath, requestedPath.endsWith(extension) ? requestedPath : `${requestedPath}${extension}`);
      if (await isExecutablePath(candidate)) {
        return canonicalizeFilePath(candidate);
      }
    }
  }

  return '';
}

async function canonicalizeFilePath(targetPath) {
  try {
    return await realpath(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

function hasPathSeparator(value) {
  return value.includes(path.sep) || value.includes('/') || value.includes('\\');
}

async function isExecutablePath(targetPath) {
  try {
    await access(targetPath, process.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function pathExists(targetPath) {
  try {
    await access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function buildRegistrationFailureMessage(registration) {
  if (!registration.path) {
    return 'No Codex launcher path was provided or discovered.';
  }

  if (!registration.resolved_path) {
    return `Could not resolve Codex launcher from ${registration.path}.`;
  }

  return registration.validation_error || `Failed to validate Codex launcher at ${registration.resolved_path}.`;
}

function pickFirstMeaningfulLine(value) {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('WARNING: proceeding,')) || '';
}

function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function matchesKnownPath(value, ...candidates) {
  const normalized = asTrimmedString(value);
  if (!normalized) {
    return false;
  }

  return candidates.some((candidate) => normalized === asTrimmedString(candidate));
}
