import os from 'node:os';
import path from 'node:path';
import { pathExists, readJson, toIsoString, writeJson } from './fs.js';

const REGISTRY_FILE = 'workspace-registry.json';

export function resolveWorkspaceRegistryPath({ homeDir = os.homedir() } = {}) {
  return process.env.OPENCODEX_WORKSPACE_REGISTRY_PATH
    || path.join(homeDir, '.opencodex', REGISTRY_FILE);
}

export async function registerWorkspace(cwd, metadata = {}, options = {}) {
  const normalizedCwd = typeof cwd === 'string' && cwd.trim()
    ? path.resolve(cwd.trim())
    : '';
  if (!normalizedCwd) {
    return null;
  }

  const sessionsRoot = path.join(normalizedCwd, '.opencodex', 'sessions');
  if (!(await pathExists(sessionsRoot))) {
    return null;
  }

  const registryPath = resolveWorkspaceRegistryPath(options);
  const registry = await loadWorkspaceRegistry(registryPath);
  const now = toIsoString();
  const items = Array.isArray(registry.workspaces) ? registry.workspaces : [];
  const existing = items.find((item) => normalizeWorkspaceEntryPath(item?.cwd) === normalizedCwd);
  const nextEntry = {
    cwd: normalizedCwd,
    sessions_root: sessionsRoot,
    registered_at: existing?.registered_at || now,
    last_seen_at: now,
    latest_session_id: typeof metadata.latest_session_id === 'string' ? metadata.latest_session_id : (existing?.latest_session_id || ''),
    latest_command: typeof metadata.latest_command === 'string' ? metadata.latest_command : (existing?.latest_command || ''),
    latest_updated_at: typeof metadata.latest_updated_at === 'string' ? metadata.latest_updated_at : (existing?.latest_updated_at || '')
  };

  const nextItems = items
    .filter((item) => normalizeWorkspaceEntryPath(item?.cwd) !== normalizedCwd)
    .concat(nextEntry)
    .sort((left, right) => String(right.last_seen_at || '').localeCompare(String(left.last_seen_at || '')));

  await writeJson(registryPath, {
    version: 1,
    updated_at: now,
    workspaces: nextItems
  });
  return nextEntry;
}

export async function listRegisteredWorkspaces(options = {}) {
  const registryPath = resolveWorkspaceRegistryPath(options);
  const registry = await loadWorkspaceRegistry(registryPath);
  const results = [];
  for (const item of Array.isArray(registry.workspaces) ? registry.workspaces : []) {
    const normalizedCwd = normalizeWorkspaceEntryPath(item?.cwd);
    if (!normalizedCwd) {
      continue;
    }
    const sessionsRoot = path.join(normalizedCwd, '.opencodex', 'sessions');
    if (!(await pathExists(sessionsRoot))) {
      continue;
    }
    results.push({
      cwd: normalizedCwd,
      sessions_root: sessionsRoot,
      registered_at: typeof item?.registered_at === 'string' ? item.registered_at : '',
      last_seen_at: typeof item?.last_seen_at === 'string' ? item.last_seen_at : '',
      latest_session_id: typeof item?.latest_session_id === 'string' ? item.latest_session_id : '',
      latest_command: typeof item?.latest_command === 'string' ? item.latest_command : '',
      latest_updated_at: typeof item?.latest_updated_at === 'string' ? item.latest_updated_at : ''
    });
  }
  return results.sort((left, right) => String(right.last_seen_at || '').localeCompare(String(left.last_seen_at || '')));
}

async function loadWorkspaceRegistry(registryPath) {
  try {
    const registry = await readJson(registryPath);
    return registry && typeof registry === 'object' ? registry : { version: 1, workspaces: [] };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { version: 1, workspaces: [] };
    }
    return { version: 1, workspaces: [] };
  }
}

function normalizeWorkspaceEntryPath(value) {
  return typeof value === 'string' && value.trim()
    ? path.resolve(value.trim())
    : '';
}
