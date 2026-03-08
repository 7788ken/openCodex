import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { readJson, toIsoString, writeJson } from './fs.js';

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
  return {
    session_id: createSessionId(),
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
}

export function getSessionDir(cwd, sessionId) {
  return path.join(getStoreRoot(cwd), sessionId);
}

export async function saveSession(cwd, session) {
  const sessionDir = getSessionDir(cwd, session.session_id);
  await mkdir(sessionDir, { recursive: true });
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
