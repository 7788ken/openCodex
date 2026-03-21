import os from 'node:os';
import path from 'node:path';
import { access, realpath } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { getCodexBin, runCommandCapture } from './codex.js';
import { readTextIfExists, toIsoString, writeJson } from './fs.js';

export const BRIDGE_STATE_SCHEMA = 'opencodex/bridge-state/v1';

export function resolveBridgeStateRoot({ homeDir = os.homedir() } = {}) {
  return path.join(homeDir, '.opencodex', 'bridge');
}

export function resolveBridgeStatePath(options = {}) {
  return path.join(resolveBridgeStateRoot(options), 'bridge.json');
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

export async function registerCodexBridge({ cwd = process.cwd(), env = process.env, homeDir = os.homedir(), pathValue = '' } = {}) {
  const registration = await inspectCurrentCodexCandidate({ cwd, env, pathValue });
  if (!registration.valid) {
    throw new Error(buildRegistrationFailureMessage(registration));
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
      active_session_updated_at: previous.state?.bridge?.active_session_updated_at || ''
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

function determineCodexTargetSource({ env = process.env, pathValue = '' } = {}) {
  if (typeof pathValue === 'string' && pathValue.trim()) {
    return 'manual_register';
  }
  if (typeof env.OPENCODEX_CODEX_BIN === 'string' && env.OPENCODEX_CODEX_BIN.trim()) {
    return 'env_override';
  }
  return 'path_lookup';
}

async function inspectCodexLauncher({ cwd = process.cwd(), env = process.env, requestedPath = '', source = '' } = {}) {
  const requested = String(requestedPath || '').trim();
  const resolvedPath = requested
    ? await resolveExecutablePath(requested, { cwd, env })
    : '';
  const exists = resolvedPath ? await pathExists(resolvedPath) : false;
  const executable = resolvedPath ? await isExecutablePath(resolvedPath) : false;
  const versionResult = resolvedPath && executable
    ? await runCommandCapture(resolvedPath, ['--version'], { cwd, env })
    : { code: 1, stdout: '', stderr: resolvedPath ? 'Executable path is not runnable.' : 'Launcher path could not be resolved.' };
  const version = pickFirstMeaningfulLine(versionResult.stdout || versionResult.stderr);

  return {
    path: requested,
    resolved_path: resolvedPath,
    source,
    exists,
    executable,
    version,
    valid: Boolean(resolvedPath) && exists && executable && versionResult.code === 0,
    validation_error: versionResult.code === 0 ? '' : (version || `Failed to validate Codex launcher from ${requested || '(empty)'}.`)
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
