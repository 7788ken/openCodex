import os from 'node:os';
import path from 'node:path';
import { appendFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { resolveBridgeActiveSessionPath } from './bridge-state.js';
import { ensureDir, readTextIfExists, toIsoString } from './fs.js';
import { getSessionDir, loadSession } from './session-store.js';

const RECENT_BRIDGE_MESSAGE_LIMIT = 3;
const DEFAULT_BRIDGE_DELIVERY_WAIT_TIMEOUT_MS = 1200;
const DEFAULT_BRIDGE_DELIVERY_POLL_INTERVAL_MS = 50;

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

  return inspectBridgeSession({
    cwd: sessionCwd,
    sessionId,
    fallback: {
      command: typeof activeSession?.command === 'string' && activeSession.command.trim()
        ? activeSession.command
        : (typeof bridgeState?.active_session_command === 'string' ? bridgeState.active_session_command : ''),
      started_at: typeof activeSession?.started_at === 'string' && activeSession.started_at.trim()
        ? activeSession.started_at
        : (typeof bridgeState?.active_session_started_at === 'string' ? bridgeState.active_session_started_at : ''),
      updated_at: activeSession?.updated_at || bridgeState?.active_session_updated_at || '',
      state_path: activeSessionPath
    }
  });
}

export async function inspectBridgeSession({ cwd, sessionId, fallback = null } = {}) {
  const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
  const normalizedCwd = typeof cwd === 'string' ? cwd.trim() : '';
  if (!normalizedSessionId) {
    return null;
  }

  const sessionPath = normalizedCwd ? path.join(getSessionDir(normalizedCwd, normalizedSessionId), 'session.json') : '';
  try {
    const session = normalizedCwd ? await loadSession(normalizedCwd, normalizedSessionId) : null;
    const runtimePaths = session ? getBridgeRuntimePaths(normalizedCwd, normalizedSessionId) : null;
    const inboxMessages = runtimePaths ? await readBridgeInboxMessages(runtimePaths.inboxPath) : [];
    const deliveredByMessageId = runtimePaths ? await readBridgeDeliveryMap(runtimePaths.controlEventsPath) : new Map();
    const recentOutputLines = runtimePaths ? await readBridgeOutputTail(runtimePaths.outputLogPath, 5) : [];
    const inboxSnapshot = buildBridgeInboxSnapshot(inboxMessages, deliveredByMessageId);
    return {
      session_id: normalizedSessionId,
      working_directory: session?.working_directory || normalizedCwd,
      command: fallback?.command || '',
      started_at: fallback?.started_at || '',
      updated_at: session?.updated_at || fallback?.updated_at || '',
      status: session?.status || '',
      session_path: sessionPath,
      record_found: Boolean(session),
      state_path: fallback?.state_path || '',
      inbox_count: inboxSnapshot.inbox_count,
      delivered_count: inboxSnapshot.delivered_count,
      pending_count: inboxSnapshot.pending_count,
      recent_inbox_messages: inboxSnapshot.recent_messages,
      recent_output_lines: recentOutputLines
    };
  } catch {
    return {
      session_id: normalizedSessionId,
      working_directory: normalizedCwd,
      command: fallback?.command || '',
      started_at: fallback?.started_at || '',
      updated_at: fallback?.updated_at || '',
      status: 'missing',
      session_path: sessionPath,
      record_found: false,
      state_path: fallback?.state_path || ''
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

export async function waitForBridgeMessageDelivery({
  controlEventsPath,
  messageId,
  timeoutMs = DEFAULT_BRIDGE_DELIVERY_WAIT_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_BRIDGE_DELIVERY_POLL_INTERVAL_MS
} = {}) {
  const normalizedMessageId = typeof messageId === 'string' ? messageId.trim() : '';
  if (!normalizedMessageId) {
    return {
      delivery_status: 'pending',
      delivered_at: ''
    };
  }

  const maxWaitMs = Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : DEFAULT_BRIDGE_DELIVERY_WAIT_TIMEOUT_MS;
  const waitStepMs = Number.isFinite(pollIntervalMs)
    ? Math.max(10, pollIntervalMs)
    : DEFAULT_BRIDGE_DELIVERY_POLL_INTERVAL_MS;
  const deadline = Date.now() + maxWaitMs;

  while (true) {
    const deliveredByMessageId = await readBridgeDeliveryMap(controlEventsPath);
    const deliveredAt = deliveredByMessageId.get(normalizedMessageId) || '';
    if (deliveredAt) {
      return {
        delivery_status: 'delivered',
        delivered_at: deliveredAt
      };
    }
    if (Date.now() >= deadline) {
      return {
        delivery_status: 'pending',
        delivered_at: ''
      };
    }
    await sleep(waitStepMs);
  }
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
