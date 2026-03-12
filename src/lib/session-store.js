import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { readJson, toIsoString, writeJson } from './fs.js';
import { applySessionContract, readSessionContractFromEnv } from './session-contract.js';

const TERMINAL_SESSION_STATUSES = new Set(['completed', 'failed', 'cancelled']);

export function getStoreRoot(cwd) {
  return path.join(cwd, '.opencodex', 'sessions');
}

export function createSessionId() {
  const timestamp = new Date().toISOString().replace(/[-:.]/g, '').replace('T', '-').slice(0, 15);
  const random = Math.random().toString(36).slice(2, 8);
  return `${timestamp}-${random}`;
}

export function createSession({ command, cwd, input, codexCliVersion }) {
  const now = toIsoString();
  const session = {
    session_id: `${command}-${createSessionId()}`,
    command,
    status: 'queued',
    created_at: now,
    updated_at: now,
    working_directory: cwd,
    codex_cli_version: codexCliVersion,
    input,
    summary: {
      title: `${command} queued`,
      result: 'Session created.',
      status: 'queued',
      highlights: [],
      next_steps: []
    },
    artifacts: []
  };

  const contract = readSessionContractFromEnv(process.env);
  applySessionContract(session, contract);

  return session;
}

export function getSessionDir(cwd, sessionId) {
  return path.join(getStoreRoot(cwd), sessionId);
}

export async function saveSession(cwd, session) {
  const sessionDir = getSessionDir(cwd, session.session_id);
  await mkdir(path.join(sessionDir, 'artifacts'), { recursive: true });
  await writeJson(path.join(sessionDir, 'session.json'), session);
  return sessionDir;
}

export async function listSessions(cwd) {
  const storeRoot = getStoreRoot(cwd);
  try {
    const entries = await readdir(storeRoot, { withFileTypes: true });
    const sessions = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      try {
        const session = await readJson(path.join(storeRoot, entry.name, 'session.json'));
        sessions.push(session);
      } catch {
      }
    }
    return sessions.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function loadSession(cwd, sessionId) {
  return readJson(path.join(getStoreRoot(cwd), sessionId, 'session.json'));
}

export function isTerminalSessionStatus(status) {
  return TERMINAL_SESSION_STATUSES.has(String(status || '').trim());
}

export async function pruneEndedSessions(cwd, options = {}) {
  const sessions = await listSessions(cwd);
  if (!sessions.length) {
    return {
      pruned: [],
      preserved_session_ids: []
    };
  }

  const includeCommands = Array.isArray(options.includeCommands) && options.includeCommands.length
    ? new Set(options.includeCommands.map((command) => String(command || '').trim()).filter(Boolean))
    : null;
  const olderThanMinutes = Number.isFinite(options.olderThanMinutes)
    ? Math.max(0, Math.trunc(options.olderThanMinutes))
    : 24 * 60;
  const keepRecentPerCommand = Number.isFinite(options.keepRecentPerCommand)
    ? Math.max(0, Math.trunc(options.keepRecentPerCommand))
    : 0;
  const preserveSessionIds = new Set(
    (Array.isArray(options.preserveSessionIds) ? options.preserveSessionIds : [])
      .map((sessionId) => String(sessionId || '').trim())
      .filter(Boolean)
  );

  preserveActiveSessionLineage(sessions, preserveSessionIds);

  const nowMs = resolveNowMs(options.now);
  const keptByCommand = new Map();
  const pruned = [];

  for (const session of sessions) {
    if (!session?.session_id || !isTerminalSessionStatus(session.status)) {
      continue;
    }

    if (includeCommands && !includeCommands.has(String(session.command || '').trim())) {
      continue;
    }

    if (preserveSessionIds.has(session.session_id)) {
      continue;
    }

    const commandKey = String(session.command || '').trim();
    const keptCount = keptByCommand.get(commandKey) || 0;
    if (keptCount < keepRecentPerCommand) {
      keptByCommand.set(commandKey, keptCount + 1);
      continue;
    }

    if (!isOlderThanMinutes(session.updated_at || session.created_at, olderThanMinutes, nowMs)) {
      continue;
    }

    await rm(getSessionDir(cwd, session.session_id), { recursive: true, force: true });
    pruned.push({
      session_id: session.session_id,
      command: commandKey,
      status: String(session.status || '').trim()
    });
  }

  return {
    pruned,
    preserved_session_ids: [...preserveSessionIds]
  };
}

function preserveActiveSessionLineage(sessions, preserveSessionIds) {
  const { parentByChild, childrenByParent } = buildSessionLinks(sessions);

  for (const session of sessions) {
    if (!session?.session_id || isTerminalSessionStatus(session.status)) {
      continue;
    }

    preserveSessionIds.add(session.session_id);
    if (session.command === 'im') {
      continue;
    }

    markAncestorSessions(session.session_id, parentByChild, preserveSessionIds);
    markDescendantSessions(session.session_id, childrenByParent, preserveSessionIds);
  }
}

function buildSessionLinks(sessions) {
  const parentByChild = new Map();
  const childrenByParent = new Map();

  for (const session of sessions) {
    if (typeof session?.parent_session_id === 'string' && session.parent_session_id) {
      addSessionLink(childrenByParent, parentByChild, session.parent_session_id, session.session_id, false);
    }
  }

  for (const session of sessions) {
    for (const child of normalizeChildSessions(session?.child_sessions)) {
      addSessionLink(childrenByParent, parentByChild, session.session_id, child.session_id, true);
    }
  }

  return { parentByChild, childrenByParent };
}

function addSessionLink(childrenByParent, parentByChild, parentSessionId, childSessionId, isFallback) {
  if (!parentSessionId || !childSessionId || parentSessionId === childSessionId) {
    return;
  }

  const childIds = childrenByParent.get(parentSessionId) || [];
  if (!childIds.includes(childSessionId)) {
    childIds.push(childSessionId);
    childrenByParent.set(parentSessionId, childIds);
  }

  if (!isFallback || !parentByChild.has(childSessionId)) {
    parentByChild.set(childSessionId, parentSessionId);
  }
}

function normalizeChildSessions(childSessions) {
  if (!Array.isArray(childSessions)) {
    return [];
  }

  return childSessions.filter((child) => typeof child?.session_id === 'string' && child.session_id);
}

function markAncestorSessions(sessionId, parentByChild, preserveSessionIds) {
  let currentSessionId = sessionId;
  const visited = new Set();

  while (currentSessionId && !visited.has(currentSessionId)) {
    visited.add(currentSessionId);
    const parentSessionId = parentByChild.get(currentSessionId);
    if (!parentSessionId) {
      break;
    }
    preserveSessionIds.add(parentSessionId);
    currentSessionId = parentSessionId;
  }
}

function markDescendantSessions(sessionId, childrenByParent, preserveSessionIds) {
  const pending = [...(childrenByParent.get(sessionId) || [])];

  while (pending.length) {
    const childSessionId = pending.pop();
    if (!childSessionId || preserveSessionIds.has(childSessionId)) {
      continue;
    }
    preserveSessionIds.add(childSessionId);
    pending.push(...(childrenByParent.get(childSessionId) || []));
  }
}

function resolveNowMs(now) {
  if (now instanceof Date) {
    return now.getTime();
  }
  if (typeof now === 'string' && now.trim()) {
    const parsed = Date.parse(now);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  if (typeof now === 'number' && Number.isFinite(now)) {
    return now;
  }
  return Date.now();
}

function isOlderThanMinutes(value, olderThanMinutes, nowMs) {
  if (olderThanMinutes < 0 || typeof value !== 'string' || !value.trim()) {
    return false;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return false;
  }

  return nowMs - parsed >= olderThanMinutes * 60 * 1000;
}
