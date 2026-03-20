import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { parseOptions } from '../lib/args.js';
import { ensureDir, readTextIfExists, toIsoString } from '../lib/fs.js';
import { createSession, getSessionDir, isTerminalSessionStatus, listSessions, saveSession } from '../lib/session-store.js';

const SERVE_OPTION_SPEC = {
  cwd: { type: 'string' },
  host: { type: 'string' },
  port: { type: 'string' },
  token: { type: 'string' },
  json: { type: 'boolean' }
};

const INBOX_OPTION_SPEC = {
  cwd: { type: 'string' },
  json: { type: 'boolean' },
  limit: { type: 'string' },
  'session-id': { type: 'string' }
};

const STATUS_OPTION_SPEC = {
  cwd: { type: 'string' },
  json: { type: 'boolean' },
  'session-id': { type: 'string' }
};

export async function runRemoteCommand(args) {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    process.stdout.write('Usage:\n  opencodex remote serve [--cwd <dir>] [--host <host>] [--port <n>] [--token <value>] [--json]\n  opencodex remote inbox [--cwd <dir>] [--limit <n>] [--session-id <id|latest>] [--json]\n  opencodex remote status [--cwd <dir>] [--session-id <id|latest>] [--json]\n');
    return;
  }

  if (subcommand === 'serve') {
    await runRemoteServe(rest);
    return;
  }

  if (subcommand === 'inbox') {
    await runRemoteInbox(rest);
    return;
  }

  if (subcommand === 'status') {
    await runRemoteStatus(rest);
    return;
  }

  throw new Error(`Unknown remote subcommand: ${subcommand}`);
}

async function runRemoteServe(args) {
  const { options, positionals } = parseOptions(args, SERVE_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex remote serve` does not accept positional arguments');
  }

  const cwd = path.resolve(options.cwd || process.cwd());
  const host = (options.host || '0.0.0.0').trim() || '0.0.0.0';
  const requestedPort = parsePort(options.port || '3789');
  const token = (typeof options.token === 'string' && options.token.trim()) || randomBytes(16).toString('hex');

  const session = createSession({
    command: 'remote',
    cwd,
    codexCliVersion: 'embedded-http',
    input: {
      prompt: '',
      arguments: {
        host,
        port: requestedPort,
        auth: 'token',
        token_configured: Boolean(options.token)
      }
    }
  });

  session.status = 'running';
  const sessionDir = await saveSession(cwd, session);
  const messagesPath = path.join(sessionDir, 'artifacts', 'messages.jsonl');
  await ensureDir(path.dirname(messagesPath));

  let messageCount = 0;
  let lastMessage = null;

  session.summary = buildRemoteRunningSummary({ host, port: requestedPort, messageCount, lastMessage });
  session.artifacts = [
    {
      type: 'messages_log',
      path: messagesPath,
      description: 'Remote messages received by the mobile bridge.'
    }
  ];
  await saveSession(cwd, session);

  const state = {
    cwd,
    host,
    port: requestedPort,
    token,
    session,
    messagesPath,
    get messageCount() {
      return messageCount;
    },
    set messageCount(value) {
      messageCount = value;
    },
    get lastMessage() {
      return lastMessage;
    },
    set lastMessage(value) {
      lastMessage = value;
    }
  };

  const server = http.createServer((req, res) => {
    void handleRemoteRequest(req, res, state).catch(async (error) => {
      writeJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  });

  try {
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };

      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(requestedPort, host);
    });
  } catch (error) {
    session.status = 'failed';
    session.updated_at = toIsoString();
    session.summary = {
      title: 'Remote bridge failed',
      result: error instanceof Error ? error.message : String(error),
      status: 'failed',
      highlights: [`Requested bind: ${host}:${requestedPort}`],
      next_steps: ['Choose a different port or inspect the local network setup.'],
      findings: []
    };
    await saveSession(cwd, session);
    throw error;
  }

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : requestedPort;
  state.port = actualPort;
  session.input.arguments.port = actualPort;
  session.updated_at = toIsoString();
  session.summary = buildRemoteRunningSummary({ host, port: actualPort, messageCount, lastMessage });
  await saveSession(cwd, session);

  outputRemoteStartup({ host, port: actualPort, token, sessionId: session.session_id, asJson: options.json });

  await new Promise((resolve) => {
    let stopping = false;

    const shutdown = async (reason) => {
      if (stopping) {
        return;
      }
      stopping = true;

      server.close(async () => {
        session.status = 'completed';
        session.updated_at = toIsoString();
        session.summary = buildRemoteCompletedSummary({ host, port: actualPort, messageCount, lastMessage, reason });
        await saveSession(cwd, session);
        process.stdout.write('Remote bridge stopped\n');
        resolve();
      });
    };

    process.once('SIGINT', () => {
      void shutdown('Stopped by SIGINT.');
    });
    process.once('SIGTERM', () => {
      void shutdown('Stopped by SIGTERM.');
    });
  });
}

async function runRemoteInbox(args) {
  const { options, positionals } = parseOptions(args, INBOX_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex remote inbox` does not accept positional arguments');
  }

  const cwd = path.resolve(options.cwd || process.cwd());
  const limit = parsePositiveInteger(options.limit || '20', '--limit');
  const requestedSessionId = typeof options['session-id'] === 'string' ? options['session-id'].trim() : '';
  const remoteSelection = await resolvePreferredRemoteSession(cwd, 'opencodex remote inbox', {
    sessionIdSelector: requestedSessionId
  });
  const remoteSession = remoteSelection.session;

  const messagesPath = resolveMessagesPath(cwd, remoteSession);
  const messages = (await readMessageLog(messagesPath)).slice(-limit);
  const payload = {
    session_id: remoteSession.session_id,
    status: remoteSession.status,
    session_selection: remoteSelection.selection,
    count: messages.length,
    messages
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  process.stdout.write(`Remote inbox for ${remoteSession.session_id}\n`);
  process.stdout.write(`Session selection: ${renderSessionSelectionText(remoteSelection.selection)}\n`);
  process.stdout.write(`Session candidates: ${renderSessionCandidateText(remoteSelection.selection)}\n`);
  if (!messages.length) {
    process.stdout.write('\nNo messages received yet.\n');
    return;
  }

  for (const message of messages) {
    process.stdout.write(`\n- ${message.created_at}  ${message.sender}\n`);
    process.stdout.write(`  ${message.text}\n`);
  }
}

async function runRemoteStatus(args) {
  const { options, positionals } = parseOptions(args, STATUS_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex remote status` does not accept positional arguments');
  }

  const cwd = path.resolve(options.cwd || process.cwd());
  const requestedSessionId = typeof options['session-id'] === 'string' ? options['session-id'].trim() : '';
  const remoteSelection = await resolvePreferredRemoteSession(cwd, 'opencodex remote status', {
    sessionIdSelector: requestedSessionId
  });
  const remoteSession = remoteSelection.session;

  const host = String(remoteSession?.input?.arguments?.host || '');
  const port = Number.parseInt(String(remoteSession?.input?.arguments?.port || ''), 10);
  const exposure = classifyRemoteExposure(host);
  const urls = Number.isInteger(port) && port >= 0 ? buildSuggestedUrls(host || '127.0.0.1', port) : [];
  const messagesPath = resolveMessagesPath(cwd, remoteSession);
  const messages = await readMessageLog(messagesPath);
  const latestMessage = messages.length ? messages[messages.length - 1] : null;
  const healthProbe = await probeRemoteHealth({ host, port, sessionStatus: remoteSession.status });

  const payload = {
    session_id: remoteSession.session_id,
    status: remoteSession.status,
    session_selection: remoteSelection.selection,
    host: host || null,
    port: Number.isInteger(port) ? port : null,
    exposure,
    urls,
    message_count: messages.length,
    latest_message: latestMessage
      ? {
          created_at: latestMessage.created_at || null,
          sender: latestMessage.sender || null,
          text: latestMessage.text || null
        }
      : null,
    health_probe: healthProbe,
    warnings: [
      ...buildRemoteExposureWarnings(exposure, healthProbe),
      ...buildRemoteSelectionWarnings(remoteSelection.selection, remoteSession.status)
    ],
    success_checks: buildRemoteSuccessChecks({ host, port, urls }),
    common_failures: buildRemoteCommonFailures()
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  process.stdout.write(`Remote status for ${payload.session_id}\n`);
  process.stdout.write(`Status: ${payload.status}\n`);
  process.stdout.write(`Session selection: ${renderSessionSelectionText(payload.session_selection)}\n`);
  process.stdout.write(`Session candidates: ${renderSessionCandidateText(payload.session_selection)}\n`);
  process.stdout.write(`Bind: ${payload.host || 'unknown'}:${payload.port ?? 'unknown'}\n`);
  process.stdout.write(`Exposure: ${payload.exposure.label}\n`);
  process.stdout.write(`Messages received: ${payload.message_count}\n`);
  if (payload.health_probe?.attempted) {
    process.stdout.write(`Health probe: ${payload.health_probe.ok ? 'ok' : 'failed'}  ${payload.health_probe.url || ''}\n`);
    if (Number.isFinite(payload.health_probe.duration_ms)) {
      process.stdout.write(`  latency: ${payload.health_probe.duration_ms} ms`);
      if (payload.health_probe.probed_at) {
        process.stdout.write(` at ${payload.health_probe.probed_at}`);
      }
      process.stdout.write('\n');
    }
    if (!payload.health_probe.ok && payload.health_probe.error) {
      process.stdout.write(`  ${payload.health_probe.error}\n`);
    }
  } else if (payload.health_probe?.skipped_reason) {
    process.stdout.write(`Health probe: skipped (${payload.health_probe.skipped_reason})\n`);
  }
  if (payload.latest_message) {
    process.stdout.write(`Latest message: ${payload.latest_message.created_at}  ${payload.latest_message.sender}\n`);
    process.stdout.write(`  ${payload.latest_message.text}\n`);
  }

  if (payload.warnings.length) {
    process.stdout.write('\nWarnings:\n');
    for (const warning of payload.warnings) {
      process.stdout.write(`- ${warning}\n`);
    }
  }

  process.stdout.write('\nSuccess checks:\n');
  for (const check of payload.success_checks) {
    process.stdout.write(`- ${check}\n`);
  }

  process.stdout.write('\nCommon failures:\n');
  for (const failure of payload.common_failures) {
    process.stdout.write(`- ${failure}\n`);
  }
}

async function handleRemoteRequest(req, res, state) {
  const method = req.method || 'GET';
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (method === 'GET' && url.pathname === '/health') {
    writeJson(res, 200, { ok: true, session_id: state.session.session_id, status: state.session.status });
    return;
  }

  if (method === 'GET' && url.pathname === '/api/messages') {
    if (!isAuthorized(req, url, null, state.token)) {
      writeJson(res, 401, { ok: false, error: 'Unauthorized' });
      return;
    }
    const messages = await readMessageLog(state.messagesPath);
    writeJson(res, 200, { ok: true, count: messages.length, messages: messages.slice(-20) });
    return;
  }

  if (method === 'POST' && (url.pathname === '/api/messages' || url.pathname === '/send')) {
    const bodyText = await readRequestBody(req);
    const payload = parseRequestPayload(req, bodyText);
    if (!isAuthorized(req, url, payload, state.token)) {
      if (url.pathname === '/send') {
        writeHtml(res, 401, renderRemotePage({
          token: String(payload.token || url.searchParams.get('token') || ''),
          statusMessage: 'Unauthorized token.',
          statusTone: 'error',
          messages: []
        }));
        return;
      }
      writeJson(res, 401, { ok: false, error: 'Unauthorized' });
      return;
    }

    const text = typeof payload.text === 'string' ? payload.text.trim() : '';
    if (!text) {
      if (url.pathname === '/send') {
        writeHtml(res, 400, renderRemotePage({
          token: state.token,
          statusMessage: 'Message text is required.',
          statusTone: 'error',
          messages: await readMessageLog(state.messagesPath)
        }));
        return;
      }
      writeJson(res, 400, { ok: false, error: 'Message text is required' });
      return;
    }

    const message = await saveInboundMessage(state, req, {
      sender: typeof payload.sender === 'string' && payload.sender.trim() ? payload.sender.trim() : 'phone',
      text
    });

    if (url.pathname === '/send') {
      redirect(res, `/?token=${encodeURIComponent(state.token)}&sent=1`);
      return;
    }

    writeJson(res, 200, {
      ok: true,
      session_id: state.session.session_id,
      message_id: message.message_id
    });
    return;
  }

  if (method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    const token = String(url.searchParams.get('token') || '');
    const messages = token === state.token ? await readMessageLog(state.messagesPath) : [];
    const sent = url.searchParams.get('sent') === '1';
    writeHtml(res, 200, renderRemotePage({
      token,
      statusMessage: sent ? 'Message delivered to openCodex.' : '',
      statusTone: sent ? 'success' : 'idle',
      messages
    }));
    return;
  }

  if (method === 'GET' && url.pathname === '/favicon.ico') {
    res.statusCode = 204;
    res.end();
    return;
  }

  writeJson(res, 404, { ok: false, error: 'Not found' });
}

async function saveInboundMessage(state, req, payload) {
  const message = {
    message_id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    session_id: state.session.session_id,
    created_at: toIsoString(),
    sender: payload.sender,
    text: payload.text,
    source: 'remote_http',
    remote_address: req.socket.remoteAddress || '',
    user_agent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : ''
  };

  await appendFile(state.messagesPath, `${JSON.stringify(message)}\n`, 'utf8');
  state.messageCount += 1;
  state.lastMessage = message;
  state.session.updated_at = toIsoString();
  state.session.summary = buildRemoteRunningSummary({
    host: state.host,
    port: state.port,
    messageCount: state.messageCount,
    lastMessage: state.lastMessage
  });
  await saveSession(state.cwd, state.session);
  return message;
}

function buildRemoteRunningSummary({ host, port, messageCount, lastMessage }) {
  const highlights = [
    `Listening on ${host}:${port}`,
    'Token-authenticated mobile bridge enabled.',
    `Messages received: ${messageCount}`
  ];

  if (lastMessage?.sender) {
    highlights.push(`Latest sender: ${lastMessage.sender}`);
  }

  return {
    title: 'Remote bridge running',
    result: messageCount > 0
      ? `Received ${messageCount} remote message(s) so far.`
      : 'Waiting for mobile messages.',
    status: 'running',
    highlights,
    next_steps: ['Keep this process running while your phone sends messages into openCodex.'],
    findings: []
  };
}

function buildRemoteCompletedSummary({ host, port, messageCount, lastMessage, reason }) {
  const highlights = [
    `Last bind: ${host}:${port}`,
    `Messages received: ${messageCount}`
  ];

  if (lastMessage?.sender) {
    highlights.push(`Latest sender: ${lastMessage.sender}`);
  }

  return {
    title: 'Remote bridge completed',
    result: reason || `Remote bridge stopped after receiving ${messageCount} message(s).`,
    status: 'completed',
    highlights,
    next_steps: ['Use `opencodex remote inbox` to inspect recent mobile messages.'],
    findings: []
  };
}

function parsePort(value) {
  const port = Number.parseInt(String(value || ''), 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('`--port` must be an integer between 0 and 65535');
  }
  return port;
}

function parsePositiveInteger(value, optionName) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer`);
  }
  return parsed;
}

async function resolvePreferredRemoteSession(cwd, commandLabel, options = {}) {
  const sessionIdSelector = typeof options.sessionIdSelector === 'string'
    ? options.sessionIdSelector.trim()
    : '';
  const remoteSessions = listRemoteSessions(await listSessions(cwd));
  if (!remoteSessions.length) {
    throw new Error(`No remote bridge session found for \`${commandLabel}\``);
  }

  if (sessionIdSelector) {
    return withSelectionStats(
      selectRemoteSessionBySelector(remoteSessions, sessionIdSelector, commandLabel),
      remoteSessions
    );
  }

  const remoteSelection = selectPreferredRemoteSession(remoteSessions);
  if (!remoteSelection) {
    throw new Error(`No remote bridge session found for \`${commandLabel}\``);
  }
  return withSelectionStats(remoteSelection, remoteSessions);
}

function listRemoteSessions(sessions) {
  return Array.isArray(sessions)
    ? sessions.filter((session) => session?.command === 'remote')
    : [];
}

function selectPreferredRemoteSession(remoteSessions) {
  if (!remoteSessions.length) {
    return null;
  }

  const activeSession = remoteSessions.find((session) => !isTerminalSessionStatus(session?.status));
  if (activeSession) {
    return {
      session: activeSession,
      selection: {
        mode: 'active',
        description: 'Selected active remote session (running or queued).'
      }
    };
  }

  return {
    session: remoteSessions[0],
    selection: {
      mode: 'latest_history',
      description: 'No active remote session found; selected latest historical remote session.'
    }
  };
}

function selectRemoteSessionBySelector(remoteSessions, sessionIdSelector, commandLabel) {
  if (sessionIdSelector === 'latest') {
    return {
      session: remoteSessions[0],
      selection: {
        mode: 'explicit_latest',
        description: 'Selected latest remote session by update time via --session-id latest.',
        requested: 'latest'
      }
    };
  }

  const matched = remoteSessions.find((session) => session?.session_id === sessionIdSelector);
  if (!matched) {
    throw new Error(`Remote bridge session not found for \`${commandLabel}\`: ${sessionIdSelector}`);
  }

  return {
    session: matched,
    selection: {
      mode: 'explicit_id',
      description: 'Selected remote session via --session-id.',
      requested: sessionIdSelector
    }
  };
}

function withSelectionStats(remoteSelection, remoteSessions) {
  if (!remoteSelection?.selection) {
    return remoteSelection;
  }
  const stats = buildRemoteSessionSelectionStats(remoteSessions);
  return {
    ...remoteSelection,
    selection: {
      ...remoteSelection.selection,
      ...stats
    }
  };
}

function buildRemoteSessionSelectionStats(remoteSessions) {
  const candidateCount = remoteSessions.length;
  const activeCandidateCount = remoteSessions.filter((session) => !isTerminalSessionStatus(session?.status)).length;
  return {
    candidate_count: candidateCount,
    active_candidate_count: activeCandidateCount
  };
}

function renderSessionSelectionText(selection) {
  if (!selection || typeof selection.mode !== 'string') {
    return 'unknown';
  }
  if (typeof selection.requested === 'string' && selection.requested) {
    return `${selection.mode} (${selection.requested})`;
  }
  return selection.mode;
}

function renderSessionCandidateText(selection) {
  const total = selection?.candidate_count;
  const active = selection?.active_candidate_count;
  if (!Number.isInteger(total) || total < 0 || !Number.isInteger(active) || active < 0) {
    return 'unknown';
  }
  return `total ${total}, active ${active}`;
}

function resolveMessagesPath(cwd, session) {
  const artifact = Array.isArray(session.artifacts)
    ? session.artifacts.find((item) => item?.type === 'messages_log' && typeof item.path === 'string' && item.path)
    : null;

  return artifact?.path || path.join(getSessionDir(cwd, session.session_id), 'artifacts', 'messages.jsonl');
}

async function readMessageLog(messagesPath) {
  const text = (await readTextIfExists(messagesPath)) || '';
  return text
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

async function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > 64 * 1024) {
        reject(new Error('Request body is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseRequestPayload(req, bodyText) {
  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType === 'application/json') {
    if (!bodyText.trim()) {
      return {};
    }
    return JSON.parse(bodyText);
  }

  if (contentType === 'application/x-www-form-urlencoded') {
    return Object.fromEntries(new URLSearchParams(bodyText));
  }

  return { text: bodyText };
}

function isAuthorized(req, url, payload, token) {
  const authHeader = String(req.headers.authorization || '');
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const provided = bearerToken
    || String(payload?.token || '')
    || String(url.searchParams.get('token') || '');
  return provided === token;
}

function writeJson(res, statusCode, value) {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(`${JSON.stringify(value)}\n`);
}

function writeHtml(res, statusCode, html) {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(html);
}

function redirect(res, location) {
  res.statusCode = 303;
  res.setHeader('location', location);
  res.end();
}

function outputRemoteStartup({ host, port, token, sessionId, asJson }) {
  const urls = buildSuggestedUrls(host, port);
  if (asJson) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      host,
      port,
      token,
      session_id: sessionId,
      urls
    }, null, 2)}\n`);
    return;
  }

  process.stdout.write('Remote bridge started\n');
  process.stdout.write(`Host: ${host}\n`);
  process.stdout.write(`Port: ${port}\n`);
  for (const url of urls) {
    process.stdout.write(`Open: ${url}/?token=${token}\n`);
  }
  process.stdout.write(`Token: ${token}\n`);
  process.stdout.write(`Session: ${sessionId}\n`);
}

function classifyRemoteExposure(hostInput) {
  const host = String(hostInput || '').trim().toLowerCase();
  if (!host) {
    return {
      mode: 'unknown',
      label: 'Unknown bind scope'
    };
  }

  if (host === '127.0.0.1' || host === 'localhost' || host === '::1') {
    return {
      mode: 'local_only',
      label: 'Localhost only'
    };
  }

  if (host === '0.0.0.0' || host === '::') {
    return {
      mode: 'network_wide',
      label: 'All interfaces (LAN or wider)'
    };
  }

  if (isPrivateAddress(host)) {
    return {
      mode: 'private_interface',
      label: 'Specific private interface'
    };
  }

  return {
    mode: 'specific_interface',
    label: 'Specific interface (review network exposure)'
  };
}

function buildRemoteExposureWarnings(exposure, healthProbe = null) {
  const warnings = [];
  if (exposure.mode === 'network_wide') {
    warnings.push(
      'Bridge is bound to all interfaces. Keep it behind private network or a controlled tunnel.',
      'Do not share the token in chat logs, screenshots, or public notes.'
    );
  } else if (exposure.mode === 'specific_interface') {
    warnings.push(
      'Bridge is bound to a specific interface that may be publicly reachable. Verify routing and firewall policy.'
    );
  } else if (exposure.mode === 'private_interface') {
    warnings.push(
      'Bridge is reachable from a private interface. Keep host firewall and token hygiene enabled.'
    );
  }

  if (healthProbe?.attempted && !healthProbe.ok) {
    warnings.push('Health probe failed. Verify that the remote bridge process is still running and listening on the expected host/port.');
  }

  return warnings;
}

function buildRemoteSelectionWarnings(selection, sessionStatus) {
  const warnings = [];
  if (!selection || typeof selection.mode !== 'string') {
    return warnings;
  }

  const hasActiveCandidates = Number.isInteger(selection.active_candidate_count) && selection.active_candidate_count > 0;
  if (selection.mode === 'explicit_latest' && hasActiveCandidates && isTerminalSessionStatus(sessionStatus)) {
    warnings.push('`--session-id latest` selected a historical remote session while active sessions still exist. Omit `--session-id` to inspect the active bridge by default.');
  }

  return warnings;
}

function buildRemoteSuccessChecks({ host, port, urls }) {
  const checks = [];
  const primaryUrl = urls[0] || (host && Number.isInteger(port) ? `http://${host}:${port}` : null);
  if (primaryUrl) {
    checks.push(`Open ${primaryUrl}/health and expect {"ok":true}.`);
    checks.push(`Open ${primaryUrl}/?token=<token> and submit a test message.`);
  } else {
    checks.push('Start `opencodex remote serve` and confirm host/port are shown in startup output.');
  }
  checks.push('Run `opencodex remote inbox --limit 5` and confirm your latest message is visible.');
  return checks;
}

function buildRemoteCommonFailures() {
  return [
    '401 Unauthorized: token mismatch between phone request and bridge process.',
    'Connection refused or timeout: bridge process stopped, wrong host/port, or local firewall blocks access.',
    'Phone cannot reach host: phone not on same private network or tunnel/VPN route is missing.',
    'Messages accepted but not visible in CLI: inspect remote session artifacts and run `opencodex session latest`.'
  ];
}

function buildSuggestedUrls(host, port) {
  if (host !== '0.0.0.0' && host !== '::') {
    return [`http://${host}:${port}`];
  }

  const urls = new Set([`http://127.0.0.1:${port}`]);
  for (const address of getLanAddresses()) {
    urls.add(`http://${address}:${port}`);
  }
  return [...urls];
}

async function probeRemoteHealth({ host, port, sessionStatus }) {
  if (sessionStatus !== 'running') {
    return {
      attempted: false,
      ok: false,
      skipped_reason: `session_status_${String(sessionStatus || 'unknown')}`
    };
  }

  if (!Number.isInteger(port) || port < 0) {
    return {
      attempted: false,
      ok: false,
      skipped_reason: 'missing_port'
    };
  }

  const probeBaseUrl = buildRemoteProbeBaseUrl(host, port);
  if (!probeBaseUrl) {
    return {
      attempted: false,
      ok: false,
      skipped_reason: 'unsupported_host'
    };
  }

  const url = `${probeBaseUrl}/health`;
  const startedAtMs = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);
  timeout.unref?.();

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal
    });
    const body = await response.json().catch(() => ({}));
    return {
      attempted: true,
      ok: response.ok && body?.ok === true,
      url,
      probed_at: toIsoString(),
      duration_ms: Date.now() - startedAtMs,
      status_code: response.status,
      response_ok: body?.ok === true
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error';
    const message = error instanceof Error ? error.message : String(error);
    return {
      attempted: true,
      ok: false,
      url,
      probed_at: toIsoString(),
      duration_ms: Date.now() - startedAtMs,
      error: `${name}: ${message}`
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildRemoteProbeBaseUrl(hostInput, port) {
  const host = String(hostInput || '').trim().toLowerCase();
  if (!host) {
    return null;
  }

  if (host === '0.0.0.0' || host === '::') {
    return `http://127.0.0.1:${port}`;
  }

  if (host === 'localhost' || host === '127.0.0.1') {
    return `http://127.0.0.1:${port}`;
  }

  if (host === '::1') {
    return `http://[::1]:${port}`;
  }

  if (isPrivateAddress(host)) {
    return `http://${host}:${port}`;
  }

  return null;
}

function isPrivateAddress(host) {
  if (host.startsWith('fe80:') || host.startsWith('fd') || host.startsWith('fc')) {
    return true;
  }

  const ipv4 = host.match(/^(\d{1,3})(\.\d{1,3}){3}$/);
  if (!ipv4) {
    return false;
  }

  const parts = host.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.some((value) => value < 0 || value > 255)) {
    return false;
  }

  if (parts[0] === 10) {
    return true;
  }

  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
    return true;
  }

  if (parts[0] === 192 && parts[1] === 168) {
    return true;
  }

  return false;
}

function getLanAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry && entry.family === 'IPv4' && !entry.internal) {
        addresses.push(entry.address);
      }
    }
  }
  return addresses;
}

function renderRemotePage({ token, statusMessage, statusTone, messages }) {
  const recent = messages.slice(-20).reverse();
  const listItems = recent.length
    ? recent.map((message) => `<li><strong>${escapeHtml(message.sender)}</strong><br><span>${escapeHtml(message.text)}</span><br><small>${escapeHtml(message.created_at)}</small></li>`).join('')
    : '<li>No messages yet.</li>';
  const banner = statusMessage
    ? `<p class="status ${statusTone}">${escapeHtml(statusMessage)}</p>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>openCodex Remote Bridge</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 0; background: #0f172a; color: #e2e8f0; }
    main { max-width: 720px; margin: 0 auto; padding: 24px 16px 40px; }
    h1 { margin-bottom: 8px; }
    p, li, label, input, textarea, button { font-size: 16px; }
    form, .panel { background: rgba(15, 23, 42, 0.82); border: 1px solid #334155; border-radius: 16px; padding: 16px; margin-top: 16px; }
    label { display: block; margin-top: 12px; margin-bottom: 6px; }
    input, textarea, button { width: 100%; box-sizing: border-box; border-radius: 12px; border: 1px solid #475569; padding: 12px; background: #111827; color: inherit; }
    textarea { min-height: 140px; resize: vertical; }
    button { margin-top: 16px; background: #2563eb; border: none; font-weight: 600; }
    ul { padding-left: 20px; }
    .status { border-radius: 12px; padding: 12px; }
    .status.success { background: rgba(34, 197, 94, 0.2); }
    .status.error { background: rgba(239, 68, 68, 0.2); }
    small { color: #94a3b8; }
  </style>
</head>
<body>
  <main>
    <h1>openCodex Remote Bridge</h1>
    <p>Send a message from your phone into this openCodex workspace.</p>
    ${banner}
    <form method="post" action="/send">
      <label for="token">Token</label>
      <input id="token" name="token" type="text" value="${escapeHtml(token)}" autocomplete="off" required>

      <label for="sender">Sender</label>
      <input id="sender" name="sender" type="text" value="phone" autocomplete="off">

      <label for="text">Message</label>
      <textarea id="text" name="text" placeholder="Tell openCodex what to do next..." required></textarea>

      <button type="submit">Send to openCodex</button>
    </form>

    <section class="panel">
      <h2>Recent Messages</h2>
      <ul>${listItems}</ul>
    </section>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
