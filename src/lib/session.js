import { createSessionId as createStoreSessionId, getSessionDir } from './session-store.js';

export function createSessionId(command = 'session') {
  return `${command}-${createStoreSessionId()}`;
}

export function getSessionPaths(sessionId, cwd = process.cwd()) {
  const sessionDirectory = getSessionDir(cwd, sessionId);
  return {
    sessionDirectory,
    artifactsDirectory: `${sessionDirectory}/artifacts`,
    sessionFile: `${sessionDirectory}/session.json`,
    eventsFile: `${sessionDirectory}/events.jsonl`,
    lastMessageFile: `${sessionDirectory}/last-message.txt`
  };
}
