import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { ensureDir, listDirectories, pathExists, readJson, writeJson } from './fs.js';

export const sessionRoot = path.resolve('.opencodex', 'sessions');

export function createSessionId(command) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const random = Math.random().toString(36).slice(2, 8);
  return `${command}-${stamp}-${random}`;
}

export function getSessionPaths(sessionId) {
  const sessionDirectory = path.join(sessionRoot, sessionId);

  return {
    sessionDirectory,
    artifactsDirectory: path.join(sessionDirectory, 'artifacts'),
    sessionFile: path.join(sessionDirectory, 'session.json'),
    eventsFile: path.join(sessionDirectory, 'events.jsonl'),
    lastMessageFile: path.join(sessionDirectory, 'last-message.txt')
  };
}

export async function createSession(command, payload) {
  const sessionId = createSessionId(command);
  const paths = getSessionPaths(sessionId);
  const createdAt = new Date().toISOString();

  await ensureDir(paths.artifactsDirectory);

  const session = {
    session_id: sessionId,
    command,
    status: 'queued',
    created_at: createdAt,
    updated_at: createdAt,
    ...payload
  };

  await writeJson(paths.sessionFile, session);
  return { session, paths };
}

export async function updateSession(paths, updater) {
  const current = await readJson(paths.sessionFile);
  const next = {
    ...current,
    ...updater,
    updated_at: new Date().toISOString()
  };
  await writeJson(paths.sessionFile, next);
  return next;
}

export async function writeArtifact(filePath, content) {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, content, 'utf8');
}

export async function readSession(sessionId) {
  const paths = getSessionPaths(sessionId);
  return readJson(paths.sessionFile);
}

export async function listSessions() {
  const exists = await pathExists(sessionRoot);
  if (!exists) {
    return [];
  }

  const directories = await listDirectories(sessionRoot);
  const sessions = [];

  for (const directory of directories) {
    const filePath = getSessionPaths(directory).sessionFile;
    if (await pathExists(filePath)) {
      sessions.push(await readJson(filePath));
    }
  }

  return sessions;
}

export async function readMaybeText(filePath) {
  if (!(await pathExists(filePath))) {
    return null;
  }

  return readFile(filePath, 'utf8');
}
