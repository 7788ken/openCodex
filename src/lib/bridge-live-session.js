import os from 'node:os';
import path from 'node:path';
import { appendFile } from 'node:fs/promises';
import { resolveBridgeActiveSessionPath } from './bridge-state.js';
import { ensureDir, readTextIfExists, toIsoString } from './fs.js';
import { getSessionDir, loadSession } from './session-store.js';

export function getBridgeRuntimePaths(cwd, sessionId) {
  const sessionDir = getSessionDir(cwd, sessionId);
  return {
    sessionDir,
    inboxPath: path.join(sessionDir, 'artifacts', 'bridge-inbox.jsonl'),
    controlEventsPath: path.join(sessionDir, 'artifacts', 'bridge-control-events.jsonl'),
    runtimePath: path.join(sessionDir, 'artifacts', 'bridge-runtime.json'),
    outputLogPath: path.join(sessionDir, 'artifacts', 'bridge-output.log')
  };
}

export async function inspectActiveBridgeSession({ bridgeState, statePath = '', homeDir = os.homedir() } = {}) {
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
      inbox_count: inboxMessages.length,
      delivered_count: deliveredByMessageId.size,
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

export async function queueBridgeSessionMessage({
  cwd,
  sessionId,
  text,
  source = 'external',
  metadata = null
} = {}) {
  const normalizedSessionId = String(sessionId || '').trim();
  const normalizedText = String(text || '').trim();
  if (!normalizedSessionId) {
    throw new Error('Bridge session id is required.');
  }
  if (!normalizedText) {
    throw new Error('Bridge message text must not be empty.');
  }

  const session = await loadSession(cwd, normalizedSessionId);
  if (session.command !== 'bridge') {
    throw new Error(`Session is not a bridge-owned session: ${normalizedSessionId}`);
  }
  if (session.status !== 'running') {
    throw new Error(`Bridge session is not running: ${normalizedSessionId}`);
  }

  const runtimePaths = getBridgeRuntimePaths(cwd, normalizedSessionId);
  const message = {
    message_id: createBridgeMessageId(),
    session_id: normalizedSessionId,
    created_at: toIsoString(),
    source: String(source || 'external').trim() || 'external',
    text: normalizedText
  };
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    message.metadata = metadata;
  }

  await appendBridgeRuntimeJsonl(runtimePaths.inboxPath, message);
  return {
    session,
    runtimePaths,
    message
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

function createBridgeMessageId() {
  const timestamp = new Date().toISOString().replace(/[-:.]/g, '').replace('T', '-').slice(0, 15);
  const random = Math.random().toString(36).slice(2, 8);
  return `bridge-msg-${timestamp}-${random}`;
}

function sanitizeBridgeOutputText(text) {
  return String(text || '')
    .replace(/\u0008/g, '')
    .replace(/\r/g, '');
}
