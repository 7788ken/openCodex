import { spawn } from 'node:child_process';
import { appendFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOptions } from '../lib/args.js';
import { readJson, readTextIfExists, writeJson, toIsoString } from '../lib/fs.js';
import {
  appendPlanTasksToWorkflow,
  appendWorkflowUserMessage,
  buildTelegramCtoFinalText,
  buildTelegramCtoPlanText,
  buildTelegramCtoPlannerPrompt,
  buildTelegramCtoWorkerExecutionPrompt,
  buildTelegramCtoQuestionText,
  buildTelegramCtoSessionSummary,
  buildTelegramCtoStatusText,
  cancelTelegramWorkflowState,
  collectHistoricalStuckCtoWorkflowCandidates,
  createTelegramWorkflowState,
  CTO_PLANNER_SCHEMA_PATH,
  DEFAULT_CTO_HISTORY_REPAIR_STALE_MINUTES,
  finalizeWorkflowStatus,
  findPendingWorkflowForChat,
  getReadyWorkflowTasks,
  injectHistoricalCtoRepairTask,
  classifyTelegramCtoMessageIntent,
  isLikelyTelegramCtoCasualChatMessage,
  shouldKeepTelegramCtoInConversationMode,
  markWorkflowTaskRunning,
  normalizeTelegramCtoPlan,
  applyWorkflowTaskResult,
  loadCtoSoulDocument
} from '../lib/cto-workflow.js';
import { createSession, getSessionDir, listSessions, loadSession, saveSession } from '../lib/session-store.js';
import {
  buildHostExecutorEnv,
  claimNextPendingHostExecutorJob,
  enqueueHostExecutorJob,
  ensureHostExecutorState,
  isHostExecutorEnabled,
  loadHostExecutorJob,
  resolveHostExecutorRoot,
  updateHostExecutorJob
} from '../lib/host-executor.js';

const CLI_PATH = fileURLToPath(new URL('../../bin/opencodex.js', import.meta.url));
const TELEGRAM_MAX_TEXT_LENGTH = 3900;
const MAX_PARALLEL_CTO_TASKS = 3;
const DEFAULT_TELEGRAM_CTO_HISTORY_REPAIR_STALE_MINUTES = Number.isFinite(Number(process.env.OPENCODEX_CTO_HISTORY_REPAIR_STALE_MINUTES))
  ? Math.max(0, Number(process.env.OPENCODEX_CTO_HISTORY_REPAIR_STALE_MINUTES))
  : DEFAULT_CTO_HISTORY_REPAIR_STALE_MINUTES;

const TELEGRAM_LISTEN_OPTION_SPEC = {
  cwd: { type: 'string' },
  'bot-token': { type: 'string' },
  'chat-id': { type: 'string' },
  'poll-timeout': { type: 'string' },
  'api-base-url': { type: 'string' },
  'clear-webhook': { type: 'boolean' },
  cto: { type: 'boolean' },
  profile: { type: 'string' },
  json: { type: 'boolean' }
};

const TELEGRAM_INBOX_OPTION_SPEC = {
  cwd: { type: 'string' },
  limit: { type: 'string' },
  json: { type: 'boolean' }
};

const TELEGRAM_SEND_OPTION_SPEC = {
  cwd: { type: 'string' },
  'bot-token': { type: 'string' },
  'chat-id': { type: 'string' },
  'api-base-url': { type: 'string' },
  'reply-to-message-id': { type: 'string' },
  json: { type: 'boolean' }
};

export async function runImCommand(args) {
  const [provider, subcommand, ...rest] = args;

  if (!provider || provider === '--help' || provider === '-h') {
    process.stdout.write('Usage:\n  opencodex im telegram listen [--cwd <dir>] [--bot-token <token>] [--chat-id <id>] [--poll-timeout <seconds>] [--clear-webhook] [--cto] [--profile <name>]\n  opencodex im telegram inbox [--cwd <dir>] [--limit <n>] [--json]\n  opencodex im telegram send --chat-id <id> [--cwd <dir>] [--bot-token <token>] [--reply-to-message-id <id>] <text>\n');
    return;
  }

  if (provider !== 'telegram') {
    throw new Error(`Unknown IM provider: ${provider}`);
  }

  if (subcommand === 'listen') {
    await runTelegramListen(rest);
    return;
  }

  if (subcommand === 'inbox') {
    await runTelegramInbox(rest);
    return;
  }

  if (subcommand === 'send') {
    await runTelegramSend(rest);
    return;
  }

  throw new Error(`Unknown telegram subcommand: ${subcommand || ''}`.trim());
}

async function runTelegramListen(args) {
  const { options, positionals } = parseOptions(args, TELEGRAM_LISTEN_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex im telegram listen` does not accept positional arguments');
  }

  const cwd = path.resolve(options.cwd || process.cwd());
  const botToken = resolveTelegramBotToken(options['bot-token']);
  const apiBaseUrl = resolveTelegramApiBaseUrl(options['api-base-url']);
  const pollTimeout = parseNonNegativeInteger(options['poll-timeout'] || '30', '--poll-timeout');
  const allowedChatId = normalizeChatId(options['chat-id']);
  const delegateMode = options.cto ? 'cto' : 'ack';
  const delegateProfile = typeof options.profile === 'string' && options.profile.trim()
    ? options.profile.trim()
    : (delegateMode === 'cto' ? 'full-access' : 'balanced');

  if (delegateMode === 'cto' && !allowedChatId) {
    throw new Error('`opencodex im telegram listen --cto` requires `--chat-id <id>` for safety.');
  }

  const me = await callTelegramApi(apiBaseUrl, botToken, 'getMe');
  const webhookInfo = await callTelegramApi(apiBaseUrl, botToken, 'getWebhookInfo');
  const activeWebhookUrl = typeof webhookInfo.url === 'string' ? webhookInfo.url.trim() : '';
  if (activeWebhookUrl) {
    if (!options['clear-webhook']) {
      throw new Error('Telegram webhook is currently set for this bot. Re-run with `--clear-webhook` or clear the webhook before using long polling.');
    }
    await callTelegramApi(apiBaseUrl, botToken, 'deleteWebhook', { drop_pending_updates: false });
  }

  const session = createSession({
    command: 'im',
    cwd,
    codexCliVersion: 'telegram-bot-api',
    input: {
      prompt: '',
      arguments: {
        provider: 'telegram',
        mode: 'listen',
        bot_token: '[redacted]',
        chat_id: allowedChatId || '',
        poll_timeout: pollTimeout,
        delegate_mode: delegateMode,
        profile: delegateMode === 'cto' ? delegateProfile : ''
      }
    }
  });
  session.status = 'running';
  session.child_sessions = [];

  const sessionDir = await saveSession(cwd, session);
  const updatesPath = path.join(sessionDir, 'artifacts', 'telegram-updates.jsonl');
  const repliesPath = path.join(sessionDir, 'artifacts', 'telegram-replies.jsonl');
  const statePath = path.join(sessionDir, 'artifacts', 'telegram-state.json');
  const logPath = path.join(sessionDir, 'artifacts', 'telegram-log.txt');
  const runsPath = path.join(sessionDir, 'artifacts', 'telegram-runs.jsonl');
  let updateCount = 0;
  let lastOffset = 0;
  let lastMessage = null;
  let finalized = false;
  const workflowRuntimes = new Map();
  const chatStates = new Map();
  const hostExecutor = delegateMode === 'cto' && isHostExecutorEnabled()
    ? await ensureHostExecutorState(resolveHostExecutorRoot({ cwd }))
    : null;
  await rehydratePendingTelegramCtoWorkflows(cwd, workflowRuntimes);

  const writeListenerState = async () => {
    await writeJson(statePath, createTelegramListenerStatePayload({
      me,
      lastOffset,
      allowedChatId,
      delegateMode,
      delegateProfile,
      workflows: workflowRuntimes.values(),
      chatStates: chatStates.values()
    }));
  };

  const persistListenerSession = async () => {
    session.updated_at = toIsoString();
    session.summary = buildTelegramListenSummary({
      me,
      pollTimeout,
      allowedChatId,
      updateCount,
      lastMessage,
      delegateMode,
      delegateProfile,
      childSessionCount: Array.isArray(session.child_sessions) ? session.child_sessions.length : 0
    });
    await saveSession(cwd, session);
    await writeListenerState();
  };

  const trackWorkflowPromise = (promise) => {
    promise.catch(async (error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await appendFile(logPath, `[${toIsoString()}] cto workflow error: ${errorMessage}\n`, 'utf8');
      process.stdout.write(`CTO workflow error: ${errorMessage}\n`);
    }).finally(async () => {
      try {
        await persistListenerSession();
      } catch {
      }
    });
  };

  session.summary = buildTelegramListenSummary({
    me,
    pollTimeout,
    allowedChatId,
    updateCount,
    lastMessage,
    delegateMode,
    delegateProfile,
    childSessionCount: session.child_sessions.length
  });
  session.artifacts = [
    { type: 'telegram_updates', path: updatesPath, description: 'Telegram updates stored as JSONL.' },
    { type: 'telegram_replies', path: repliesPath, description: 'Telegram replies stored as JSONL.' },
    { type: 'telegram_state', path: statePath, description: 'Telegram polling state for the active IM session.' },
    { type: 'telegram_log', path: logPath, description: 'Telegram polling lifecycle log.' }
  ];
  if (delegateMode === 'cto') {
    session.artifacts.push({
      type: 'telegram_runs',
      path: runsPath,
      description: 'Delegated CTO planning and task runs triggered from Telegram messages.'
    });
  }
  await writeFile(logPath, '', 'utf8');
  if (delegateMode === 'cto') {
    await writeFile(runsPath, '', 'utf8');
  }
  await persistListenerSession();

  process.stdout.write('Telegram listener started\n');
  process.stdout.write(`Bot: @${me.username || 'unknown'}\n`);
  if (allowedChatId) {
    process.stdout.write(`Allowed chat: ${allowedChatId}\n`);
  }
  process.stdout.write(`Poll timeout: ${pollTimeout}s\n`);
  process.stdout.write(`Delegate mode: ${delegateMode === 'cto' ? `CTO via Codex CLI (${delegateProfile})` : 'ack-only'}\n`);
  process.stdout.write(`Session: ${session.session_id}\n`);
  process.stdout.write('Send a Telegram message to this bot from your phone.\n');

  const finalize = async (status, result) => {
    if (finalized) {
      return;
    }
    finalized = true;
    session.status = status;
    session.updated_at = toIsoString();
    session.summary = buildTelegramFinalSummary({
      me,
      pollTimeout,
      allowedChatId,
      updateCount,
      lastMessage,
      status,
      result,
      delegateMode,
      delegateProfile,
      childSessionCount: Array.isArray(session.child_sessions) ? session.child_sessions.length : 0
    });
    await saveSession(cwd, session);
    await writeListenerState();
  };

  const stop = async (signal) => {
    await appendFile(logPath, `[${toIsoString()}] stopping on ${signal}\n`, 'utf8');
    await finalize('completed', `Telegram listener stopped after receiving ${updateCount} update(s).`);
  };

  let stopRequested = false;
  const onSigint = () => { stopRequested = true; };
  const onSigterm = () => { stopRequested = true; };
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);

  try {
    while (!stopRequested) {
      if (delegateMode === 'cto' && hostExecutor) {
        await processTelegramHostExecutorQueue({
          cwd,
          profile: delegateProfile,
          hostExecutor,
          workflowRuntimes,
          repliesPath,
          runsPath,
          logPath,
          apiBaseUrl,
          botToken,
          persistListenerSession
        });
      }

      const updates = await callTelegramApi(apiBaseUrl, botToken, 'getUpdates', {
        offset: lastOffset > 0 ? lastOffset : undefined,
        timeout: pollTimeout,
        allowed_updates: ['message']
      });

      for (const update of Array.isArray(updates) ? updates : []) {
        if (!update || !Number.isInteger(update.update_id)) {
          continue;
        }
        lastOffset = update.update_id + 1;
        await writeListenerState();

        const normalizedMessage = normalizeTelegramUpdate(update);
        if (!normalizedMessage) {
          continue;
        }
        if (allowedChatId && normalizedMessage.chat_id !== allowedChatId) {
          await appendFile(logPath, `[${toIsoString()}] ignored chat ${normalizedMessage.chat_id}\n`, 'utf8');
          continue;
        }

        updateCount += 1;
        lastMessage = normalizedMessage;
        const chatState = delegateMode === 'cto'
          ? noteTelegramChatInbound(chatStates, normalizedMessage)
          : null;
        await appendFile(updatesPath, `${JSON.stringify(normalizedMessage)}\n`, 'utf8');
        await appendFile(logPath, `[${normalizedMessage.created_at}] update ${normalizedMessage.update_id} chat ${normalizedMessage.chat_id}\n`, 'utf8');
        process.stdout.write(`Message ${normalizedMessage.update_id} from chat ${normalizedMessage.chat_id}: ${normalizedMessage.text}\n`);

        const workflowControlReply = delegateMode === 'cto'
          ? await resolveTelegramCtoControlReply({
            cwd,
            message: normalizedMessage,
            workflowRuntimes,
            persistWorkflowRuntime: async (runtime) => {
              await persistTelegramWorkflowRuntime(cwd, runtime);
              await persistListenerSession();
            }
          })
          : null;

        if (workflowControlReply) {
          try {
            const controlReply = await sendTelegramTextMessage({
              apiBaseUrl,
              botToken,
              chatId: normalizedMessage.chat_id,
              text: workflowControlReply.text,
              replyToMessageId: normalizedMessage.message_id
            });
            await appendTelegramReply(repliesPath, controlReply);
            await appendFile(logPath, `[${toIsoString()}] workflow control reply ${workflowControlReply.workflowId || 'none'} for update ${normalizedMessage.update_id}\n`, 'utf8');
            process.stdout.write(`Handled CTO workflow control for update ${normalizedMessage.update_id}\n`);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            await appendFile(logPath, `[${toIsoString()}] workflow control reply error for update ${normalizedMessage.update_id}: ${errorMessage}\n`, 'utf8');
            process.stdout.write(`Workflow control reply failed for update ${normalizedMessage.update_id}: ${errorMessage}\n`);
          }
          await persistListenerSession();
          continue;
        }

        const workflowStatusReply = delegateMode === 'cto'
          ? await resolveTelegramCtoStatusReply({
            cwd,
            message: normalizedMessage,
            workflowRuntimes
          })
          : null;

        if (workflowStatusReply) {
          try {
            const statusReply = await sendTelegramTextMessage({
              apiBaseUrl,
              botToken,
              chatId: normalizedMessage.chat_id,
              text: workflowStatusReply.text,
              replyToMessageId: normalizedMessage.message_id
            });
            await appendTelegramReply(repliesPath, statusReply);
            await appendFile(logPath, `[${toIsoString()}] workflow status reply ${workflowStatusReply.workflowId || 'none'} for update ${normalizedMessage.update_id}\n`, 'utf8');
            process.stdout.write(`Reported CTO workflow status for update ${normalizedMessage.update_id}\n`);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            await appendFile(logPath, `[${toIsoString()}] workflow status reply error for update ${normalizedMessage.update_id}: ${errorMessage}\n`, 'utf8');
            process.stdout.write(`Workflow status reply failed for update ${normalizedMessage.update_id}: ${errorMessage}\n`);
          }
          await persistListenerSession();
          continue;
        }

        const pendingWorkflow = delegateMode === 'cto'
          ? findPendingWorkflowForChat(workflowRuntimes.values(), normalizedMessage.chat_id)
          : null;

        const workflowDirectReply = delegateMode === 'cto'
          ? await resolveTelegramCtoDirectReply({
            cwd,
            parentSession: session,
            message: normalizedMessage,
            pendingWorkflow,
            workflowRuntimes,
            chatState,
            runsPath,
            logPath
          })
          : null;

        if (workflowDirectReply) {
          try {
            const directReply = await sendTelegramTextMessage({
              apiBaseUrl,
              botToken,
              chatId: normalizedMessage.chat_id,
              text: workflowDirectReply.text,
              replyToMessageId: normalizedMessage.message_id
            });
            await appendTelegramReply(repliesPath, directReply);
            await appendFile(logPath, `[${toIsoString()}] workflow direct reply ${workflowDirectReply.workflowId || 'none'} for update ${normalizedMessage.update_id}\n`, 'utf8');
            process.stdout.write(`Handled CTO casual chat for update ${normalizedMessage.update_id}\n`);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            await appendFile(logPath, `[${toIsoString()}] workflow direct reply error for update ${normalizedMessage.update_id}: ${errorMessage}\n`, 'utf8');
            process.stdout.write(`Workflow direct reply failed for update ${normalizedMessage.update_id}: ${errorMessage}\n`);
          }
          if (chatState) {
            noteTelegramChatDirectReply(chatState, normalizedMessage, workflowDirectReply.replyMode || 'casual');
          }
          await persistListenerSession();
          continue;
        }

        try {
          const acknowledgement = await sendTelegramAutoReply({
            apiBaseUrl,
            botToken,
            message: normalizedMessage,
            delegateMode,
            continuation: Boolean(pendingWorkflow)
          });
          await appendTelegramReply(repliesPath, acknowledgement);
          if (acknowledgement.kind === 'reaction') {
            await appendFile(logPath, `[${toIsoString()}] reaction ${acknowledgement.reaction || '👍'} on chat ${acknowledgement.chat_id} message ${acknowledgement.message_id}\n`, 'utf8');
            process.stdout.write(`Reacted to chat ${acknowledgement.chat_id} message ${acknowledgement.message_id} with ${acknowledgement.reaction || '👍'}\n`);
          } else {
            await appendFile(logPath, `[${toIsoString()}] reply ${acknowledgement.message_id} to chat ${acknowledgement.chat_id}\n`, 'utf8');
            process.stdout.write(`Replied to chat ${acknowledgement.chat_id} with message ${acknowledgement.message_id}\n`);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          await appendFile(logPath, `[${toIsoString()}] reply error for update ${normalizedMessage.update_id}: ${errorMessage}\n`, 'utf8');
          process.stdout.write(`Reply failed for update ${normalizedMessage.update_id}: ${errorMessage}\n`);
        }

        if (delegateMode === 'cto') {
          const workflowPromise = handleTelegramCtoMessage({
            cwd,
            profile: delegateProfile,
            parentSession: session,
            message: { ...normalizedMessage, chat_state: chatState },
            pendingWorkflow,
            apiBaseUrl,
            botToken,
            repliesPath,
            runsPath,
            logPath,
            workflowRuntimes,
            persistListenerSession,
            hostExecutor
          });
          trackWorkflowPromise(workflowPromise);
        }

        await persistListenerSession();
      }
    }

    await stop('signal');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendFile(logPath, `[${toIsoString()}] error: ${message}\n`, 'utf8');
    await finalize('failed', message);
    throw error;
  } finally {
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
  }
}

async function runTelegramInbox(args) {
  const { options, positionals } = parseOptions(args, TELEGRAM_INBOX_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex im telegram inbox` does not accept positional arguments');
  }

  const cwd = path.resolve(options.cwd || process.cwd());
  const limit = parsePositiveInteger(options.limit || '20', '--limit');
  const session = await findLatestTelegramSession(cwd);
  if (!session) {
    throw new Error('No telegram IM session found for `opencodex im telegram inbox`');
  }

  const updatesPath = resolveTelegramUpdatesPath(cwd, session);
  const messages = (await readJsonl(updatesPath)).slice(-limit).reverse();
  const payload = {
    session_id: session.session_id,
    status: session.status,
    count: messages.length,
    messages
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  process.stdout.write(`Telegram inbox for ${session.session_id}\n`);
  if (!messages.length) {
    process.stdout.write('\nNo Telegram messages received yet.\n');
    return;
  }

  for (const message of messages) {
    process.stdout.write(`\n- ${message.created_at}  chat ${message.chat_id}  ${message.sender_display}\n`);
    process.stdout.write(`  ${message.text}\n`);
  }
}

async function runTelegramSend(args) {
  const { options, positionals } = parseOptions(args, TELEGRAM_SEND_OPTION_SPEC);
  const text = positionals.join(' ').trim();
  if (!text) {
    throw new Error('`opencodex im telegram send` requires message text');
  }

  const cwd = path.resolve(options.cwd || process.cwd());
  const botToken = resolveTelegramBotToken(options['bot-token']);
  const apiBaseUrl = resolveTelegramApiBaseUrl(options['api-base-url']);
  const chatId = normalizeChatId(options['chat-id']);
  if (!chatId) {
    throw new Error('`opencodex im telegram send` requires `--chat-id <id>`');
  }

  const response = await callTelegramApi(apiBaseUrl, botToken, 'sendMessage', {
    chat_id: chatId,
    text,
    reply_to_message_id: options['reply-to-message-id'] ? parsePositiveInteger(options['reply-to-message-id'], '--reply-to-message-id') : undefined
  });

  const payload = {
    ok: true,
    chat_id: String(response.chat?.id ?? chatId),
    message_id: response.message_id,
    date: response.date || null,
    text: response.text || text,
    working_directory: cwd
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  process.stdout.write('Telegram message sent\n');
  process.stdout.write(`Chat: ${payload.chat_id}\n`);
  process.stdout.write(`Message: ${payload.message_id}\n`);
}

async function callTelegramApi(apiBaseUrl, botToken, methodName, params = undefined) {
  const response = await fetch(`${apiBaseUrl}/bot${botToken}/${methodName}`, {
    method: params ? 'POST' : 'GET',
    headers: params ? { 'content-type': 'application/json' } : undefined,
    body: params ? JSON.stringify(sanitizeTelegramParams(params)) : undefined
  });

  if (!response.ok) {
    throw new Error(`Telegram ${methodName} failed with HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(`Telegram ${methodName} failed: ${payload.description || 'Unknown error'}`);
  }

  return payload.result;
}

function sanitizeTelegramParams(params) {
  const next = {};
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    next[key] = value;
  }
  return next;
}

async function sendTelegramAutoReply({ apiBaseUrl, botToken, message, delegateMode, continuation = false }) {
  try {
    return await sendTelegramMessageReaction({
      apiBaseUrl,
      botToken,
      chatId: message.chat_id,
      messageId: message.message_id,
      emoji: '👍'
    });
  } catch {
    const replyText = buildTelegramAutoReplyText(message, delegateMode, continuation);
    return sendTelegramTextMessage({
      apiBaseUrl,
      botToken,
      chatId: message.chat_id,
      text: replyText
    });
  }
}

async function sendTelegramMessageReaction({ apiBaseUrl, botToken, chatId, messageId, emoji }) {
  await callTelegramApi(apiBaseUrl, botToken, 'setMessageReaction', {
    chat_id: chatId,
    message_id: messageId,
    reaction: [{ type: 'emoji', emoji }],
    is_big: false
  });

  return {
    provider: 'telegram',
    kind: 'reaction',
    chat_id: String(chatId),
    message_id: messageId,
    created_at: toIsoString(),
    reaction: emoji
  };
}

async function sendTelegramTextMessage({ apiBaseUrl, botToken, chatId, text, replyToMessageId = undefined }) {
  const safeText = truncateTelegramText(text);
  const response = await callTelegramApi(apiBaseUrl, botToken, 'sendMessage', {
    chat_id: chatId,
    text: safeText,
    reply_to_message_id: replyToMessageId
  });

  return {
    provider: 'telegram',
    message_id: response.message_id,
    chat_id: String(response.chat?.id ?? chatId),
    reply_to_message_id: replyToMessageId,
    created_at: typeof response.date === 'number' ? new Date(response.date * 1000).toISOString() : toIsoString(),
    text: response.text || safeText
  };
}

function buildTelegramAutoReplyText(message, delegateMode, continuation = false) {
  return '👍';
}

async function handleTelegramCtoMessage({
  cwd,
  profile,
  parentSession,
  message,
  pendingWorkflow,
  apiBaseUrl,
  botToken,
  repliesPath,
  runsPath,
  logPath,
  workflowRuntimes,
  persistListenerSession,
  hostExecutor
}) {
  if (pendingWorkflow) {
    await appendFile(logPath, `[${toIsoString()}] continue workflow ${pendingWorkflow.session.session_id} from update ${message.update_id}\n`, 'utf8');
    process.stdout.write(`Continuing CTO workflow ${pendingWorkflow.session.session_id} from update ${message.update_id}\n`);
    await continueTelegramCtoWorkflow({
      cwd,
      profile,
      message,
      runtime: pendingWorkflow,
      apiBaseUrl,
      botToken,
      repliesPath,
      runsPath,
      logPath,
      workflowRuntimes,
      persistListenerSession,
      hostExecutor
    });
    return;
  }

  const runtime = await createTelegramCtoRuntime({
    cwd,
    profile,
    parentSession,
    message
  });
  workflowRuntimes.set(runtime.session.session_id, runtime);
  await recordTelegramChildSession(parentSession, cwd, {
    sessionId: runtime.session.session_id,
    updateId: message.update_id,
    label: `Telegram workflow ${message.update_id}`
  });
  await persistListenerSession();

  if (message.chat_state && typeof message.chat_state === 'object') {
    noteTelegramChatWorkflowStart(message.chat_state, runtime.session.session_id, message);
  }

  await appendFile(logPath, `[${toIsoString()}] started workflow ${runtime.session.session_id} for update ${message.update_id}\n`, 'utf8');
  process.stdout.write(`started workflow ${runtime.session.session_id} for update ${message.update_id}\n`);

  await processTelegramCtoWorkflow({
    cwd,
    profile,
    rootMessage: message,
    triggerMessage: message,
    runtime,
    apiBaseUrl,
    botToken,
    repliesPath,
    runsPath,
    logPath,
    workflowRuntimes,
    persistListenerSession,
    hostExecutor,
    continuationMessage: null
  });
}

async function continueTelegramCtoWorkflow({
  cwd,
  profile,
  message,
  runtime,
  apiBaseUrl,
  botToken,
  repliesPath,
  runsPath,
  logPath,
  workflowRuntimes,
  persistListenerSession,
  hostExecutor
}) {
  appendWorkflowUserMessage(runtime.state, message);
  runtime.state.status = 'planning';
  runtime.state.pending_question_zh = '';
  await persistTelegramWorkflowRuntime(cwd, runtime);
  await persistListenerSession();

  await processTelegramCtoWorkflow({
    cwd,
    profile,
    rootMessage: runtime.rootMessage,
    triggerMessage: message,
    runtime,
    apiBaseUrl,
    botToken,
    repliesPath,
    runsPath,
    logPath,
    workflowRuntimes,
    persistListenerSession,
    hostExecutor,
    continuationMessage: message
  });
}

async function createTelegramCtoRuntime({ cwd, profile, parentSession, message }) {
  const workflowSession = createSession({
    command: 'cto',
    cwd,
    codexCliVersion: parentSession.codex_cli_version || 'telegram-cto',
    input: {
      prompt: message.text,
      arguments: {
        provider: 'telegram',
        profile,
        update_id: message.update_id,
        chat_id: message.chat_id,
        sender: message.sender_display
      }
    }
  });
  workflowSession.parent_session_id = parentSession.session_id;
  workflowSession.status = 'running';
  workflowSession.child_sessions = [];

  const workflowState = createTelegramWorkflowState({
    workflowSessionId: workflowSession.session_id,
    message
  });
  const workflowSessionDir = await saveSession(cwd, workflowSession);
  const workflowStatePath = path.join(workflowSessionDir, 'artifacts', 'cto-workflow.json');
  maybeAddArtifact(workflowSession, {
    type: 'cto_workflow',
    path: workflowStatePath,
    description: 'Telegram CTO workflow state and task graph.'
  });

  const runtime = {
    rootMessage: message,
    session: workflowSession,
    sessionDir: workflowSessionDir,
    state: workflowState,
    statePath: workflowStatePath
  };

  await persistTelegramWorkflowRuntime(cwd, runtime);
  return runtime;
}

async function persistTelegramWorkflowRuntime(cwd, workflowRuntime) {
  workflowRuntime.session.updated_at = toIsoString();
  workflowRuntime.session.summary = buildTelegramCtoSessionSummary(workflowRuntime.state);
  workflowRuntime.session.status = workflowRuntime.session.summary.status;
  await writeJson(workflowRuntime.statePath, workflowRuntime.state);
  await saveSession(cwd, workflowRuntime.session);
}

async function processTelegramCtoWorkflow({
  cwd,
  profile,
  rootMessage,
  triggerMessage,
  runtime,
  apiBaseUrl,
  botToken,
  repliesPath,
  runsPath,
  logPath,
  workflowRuntimes,
  persistListenerSession,
  hostExecutor,
  continuationMessage
}) {
  try {
    const planResult = await planTelegramCtoWorkflow({
      cwd,
      profile,
      message: rootMessage,
      triggerMessage,
      continuationMessage,
      runtime,
      runsPath,
      logPath
    });

    if (runtime.state.status === 'cancelled') {
      await persistTelegramWorkflowRuntime(cwd, runtime);
      await persistListenerSession();
      workflowRuntimes.delete(runtime.session.session_id);
      await appendFile(logPath, `[${toIsoString()}] workflow ${runtime.session.session_id} cancelled before plan commit\n`, 'utf8');
      process.stdout.write(`CTO workflow ${runtime.session.session_id} cancelled before plan commit\n`);
      return;
    }

    appendPlanTasksToWorkflow(runtime.state, planResult.plan);
    await persistTelegramWorkflowRuntime(cwd, runtime);
    await persistListenerSession();

    if (planResult.plan.mode === 'confirm') {
      if (runtime.state.status === 'cancelled') {
        await persistTelegramWorkflowRuntime(cwd, runtime);
        await persistListenerSession();
        workflowRuntimes.delete(runtime.session.session_id);
        return;
      }

      const questionReply = await sendTelegramTextMessage({
        apiBaseUrl,
        botToken,
        chatId: triggerMessage.chat_id,
        text: buildTelegramCtoQuestionText(runtime.state),
        replyToMessageId: triggerMessage.message_id
      });
      await appendTelegramReply(repliesPath, questionReply);
      await appendFile(logPath, `[${toIsoString()}] workflow ${runtime.session.session_id} waiting for user confirmation\n`, 'utf8');
      process.stdout.write(`CTO workflow ${runtime.session.session_id} is waiting for confirmation\n`);
      return;
    }

    const planReply = await sendTelegramTextMessage({
      apiBaseUrl,
      botToken,
      chatId: triggerMessage.chat_id,
      text: buildTelegramCtoPlanText(runtime.state),
      replyToMessageId: triggerMessage.message_id
    });
    await appendTelegramReply(repliesPath, planReply);

    await executeTelegramCtoTasks({
      cwd,
      profile,
      message: rootMessage,
      runtime,
      runsPath,
      logPath,
      hostExecutor
    });

    if (runtime.state.status === 'cancelled') {
      await persistTelegramWorkflowRuntime(cwd, runtime);
      await persistListenerSession();
      workflowRuntimes.delete(runtime.session.session_id);
      await appendFile(logPath, `[${toIsoString()}] workflow ${runtime.session.session_id} cancelled during execution\n`, 'utf8');
      process.stdout.write(`CTO workflow ${runtime.session.session_id} cancelled during execution\n`);
      return;
    }

    finalizeWorkflowStatus(runtime.state);
    await persistTelegramWorkflowRuntime(cwd, runtime);
    await persistListenerSession();

    if (hasReroutedWorkflowTasks(runtime.state)) {
      const rerouteReply = await sendTelegramTextMessage({
        apiBaseUrl,
        botToken,
        chatId: triggerMessage.chat_id,
        text: buildTelegramCtoRerouteText(runtime.state),
        replyToMessageId: triggerMessage.message_id
      });
      await appendTelegramReply(repliesPath, rerouteReply);
      await appendFile(logPath, `[${toIsoString()}] workflow ${runtime.session.session_id} rerouted work to the host executor
`, 'utf8');
      process.stdout.write(`CTO workflow ${runtime.session.session_id} rerouted work to the host executor
`);
      return;
    }

    if (runtime.state.status === 'waiting_for_user') {
      const questionReply = await sendTelegramTextMessage({
        apiBaseUrl,
        botToken,
        chatId: triggerMessage.chat_id,
        text: buildTelegramCtoQuestionText(runtime.state),
        replyToMessageId: triggerMessage.message_id
      });
      await appendTelegramReply(repliesPath, questionReply);
      await appendFile(logPath, `[${toIsoString()}] workflow ${runtime.session.session_id} paused for confirmation after task execution\n`, 'utf8');
      process.stdout.write(`CTO workflow ${runtime.session.session_id} paused for confirmation\n`);
      return;
    }

    const finalReply = await sendTelegramTextMessage({
      apiBaseUrl,
      botToken,
      chatId: triggerMessage.chat_id,
      text: buildTelegramCtoFinalText(runtime.state),
      replyToMessageId: triggerMessage.message_id
    });
    await appendTelegramReply(repliesPath, finalReply);
    await appendFile(logPath, `[${toIsoString()}] workflow ${runtime.session.session_id} finished with status ${runtime.state.status}\n`, 'utf8');
    process.stdout.write(`CTO workflow ${runtime.session.session_id} finished with status ${runtime.state.status}\n`);
    workflowRuntimes.delete(runtime.session.session_id);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    runtime.state.status = 'failed';
    runtime.state.pending_question_zh = '';
    runtime.state.updated_at = toIsoString();
    await persistTelegramWorkflowRuntime(cwd, runtime);
    await persistListenerSession();
    workflowRuntimes.delete(runtime.session.session_id);

    const failureReply = await sendTelegramTextMessage({
      apiBaseUrl,
      botToken,
      chatId: triggerMessage.chat_id,
      text: truncateTelegramText([
        'openCodex CTO 工作流处理失败',
        `结果：${truncateInline(errorMessage, 900)}`,
        `Workflow: ${runtime.session.session_id}`
      ].join('\n')),
      replyToMessageId: triggerMessage.message_id
    });
    await appendTelegramReply(repliesPath, failureReply);
    await appendFile(logPath, `[${toIsoString()}] workflow ${runtime.session.session_id} failed: ${errorMessage}\n`, 'utf8');
    process.stdout.write(`CTO workflow ${runtime.session.session_id} failed: ${errorMessage}\n`);
  }
}

async function planTelegramCtoWorkflow({ cwd, message, triggerMessage, continuationMessage, runtime, runsPath, logPath }) {
  const ctoSoul = await loadCtoSoulDocument(cwd);
  runtime.state.cto_soul_path = ctoSoul.display_path;

  const result = await spawnCliCapture([
    'run',
    '--cwd',
    cwd,
    '--profile',
    'safe',
    '--schema',
    CTO_PLANNER_SCHEMA_PATH,
    buildTelegramCtoPlannerPrompt({
      message,
      workflowState: runtime.state,
      continuationMessage,
      soulText: ctoSoul.text,
      soulPath: ctoSoul.display_path
    })
  ], cwd, {
    OPENCODEX_PARENT_SESSION_ID: runtime.session.session_id,
    OPENCODEX_IM_SOURCE: 'telegram',
    OPENCODEX_IM_UPDATE_ID: String(triggerMessage.update_id),
    OPENCODEX_CTO_STAGE: continuationMessage ? 'continue-plan' : 'plan'
  });

  const sessionId = extractSessionId(result.stdout);
  let childSession = null;
  let rawPlanText = '';
  if (sessionId) {
    await recordTelegramChildSession(runtime.session, cwd, {
      sessionId,
      updateId: triggerMessage.update_id,
      label: continuationMessage ? `Continue workflow ${triggerMessage.update_id}` : `Plan workflow ${triggerMessage.update_id}`
    });
    rawPlanText = (await readTextIfExists(path.join(getSessionDir(cwd, sessionId), 'last-message.txt'))) || '';
    try {
      childSession = await loadSession(cwd, sessionId);
    } catch {
      childSession = null;
    }
    await persistTelegramWorkflowRuntime(cwd, runtime);
  }

  let plan = normalizeTelegramCtoPlan(
    tryParseJson(rawPlanText),
    continuationMessage ? continuationMessage.text : message.text,
    runtime.state
  );
  const historicalRepairCandidates = await collectTelegramCtoHistoryRepairCandidates({
    cwd,
    currentWorkflowSessionId: runtime.session.session_id
  });
  plan = injectHistoricalCtoRepairTask(plan, {
    candidates: historicalRepairCandidates,
    cwd,
    currentWorkflowSessionId: runtime.session.session_id,
    staleMinutes: DEFAULT_TELEGRAM_CTO_HISTORY_REPAIR_STALE_MINUTES
  });
  const runRecord = buildTelegramRunRecord(triggerMessage, {
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    sessionId,
    childStatus: childSession?.status || '',
    summary: childSession?.summary || null
  }, {
    workflowSessionId: runtime.session.session_id,
    stage: continuationMessage ? 'continue-plan' : 'plan'
  });
  await appendFile(runsPath, `${JSON.stringify(runRecord)}\n`, 'utf8');
  await appendFile(logPath, `[${toIsoString()}] workflow ${runtime.session.session_id} planned ${plan.tasks.length} task(s) via ${sessionId || 'no-session'}\n`, 'utf8');
  return { plan, sessionId };
}

async function executeTelegramCtoTasks({ cwd, profile, message, runtime, runsPath, logPath, hostExecutor }) {
  const runningTasks = new Map();
  let schedulingEnabled = true;

  const startTask = async (task) => {
    markWorkflowTaskRunning(runtime.state, task.id);
    await persistTelegramWorkflowRuntime(cwd, runtime);

    const runResult = await runTelegramCtoTask({
      cwd,
      profile,
      parentSessionId: runtime.session.session_id,
      sessionDir: runtime.sessionDir,
      message,
      task,
      workflowState: runtime.state,
      hostExecutor
    });

    if (runResult.rerouteRecordPath) {
      maybeAddArtifact(runtime.session, {
        type: 'host_executor_job',
        path: runResult.rerouteRecordPath,
        description: `Host executor queue record for task ${task.id}.`
      });
    }

    if (runResult.sessionId) {
      await recordTelegramChildSession(runtime.session, cwd, {
        sessionId: runResult.sessionId,
        updateId: message.update_id,
        label: `Task ${task.id}`
      });
    }

    applyWorkflowTaskResult(runtime.state, task.id, runResult);
    await appendFile(runsPath, `${JSON.stringify(buildTelegramRunRecord(message, runResult, {
      workflowSessionId: runtime.session.session_id,
      stage: 'task',
      taskId: task.id,
      taskTitle: task.title
    }))}\n`, 'utf8');
    await appendFile(logPath, `[${toIsoString()}] workflow ${runtime.session.session_id} task ${task.id} -> ${runResult.sessionId || 'no-session'} (${runResult.summary?.status || runResult.childStatus || runResult.code})\n`, 'utf8');
    await persistTelegramWorkflowRuntime(cwd, runtime);
    process.stdout.write(`CTO workflow ${runtime.session.session_id} task ${task.id} finished with ${(runtime.state.tasks.find((item) => item.id === task.id) || {}).status || 'unknown'}\n`);
    if (runtime.state.status === 'waiting_for_user' || runtime.state.status === 'cancelled') {
      schedulingEnabled = false;
    }
    return runResult;
  };

  while (true) {
    if (runtime.state.status === 'cancelled') {
      schedulingEnabled = false;
    }

    if (schedulingEnabled) {
      const readyTasks = getReadyWorkflowTasks(runtime.state);
      while (readyTasks.length > 0 && runningTasks.size < MAX_PARALLEL_CTO_TASKS) {
        const task = readyTasks.shift();
        const taskPromise = startTask(task).finally(() => {
          runningTasks.delete(task.id);
        });
        runningTasks.set(task.id, taskPromise);
      }
    }

    if (!runningTasks.size) {
      break;
    }

    await Promise.race(runningTasks.values());
  }
}

async function runTelegramCtoTask({ cwd, profile, parentSessionId, sessionDir, message, task, workflowState, hostExecutor }) {
  const outputPath = path.join(sessionDir, 'artifacts', `telegram-task-${sanitizeFileComponent(task.id)}.json`);
  const workerPrompt = buildTelegramCtoWorkerExecutionPrompt({
    workflowState,
    task,
    fallbackMessageText: message.text
  });
  const result = await spawnCliCapture([
    'run',
    '--cwd',
    cwd,
    '--profile',
    profile,
    '--output',
    outputPath,
    workerPrompt
  ], cwd, {
    OPENCODEX_PARENT_SESSION_ID: parentSessionId,
    OPENCODEX_IM_SOURCE: 'telegram',
    OPENCODEX_IM_UPDATE_ID: String(message.update_id),
    OPENCODEX_CTO_STAGE: 'task',
    OPENCODEX_CTO_TASK_ID: task.id
  });

  let outputPayload = null;
  try {
    outputPayload = await readJson(outputPath);
  } catch {
    outputPayload = null;
  }

  const sessionId = outputPayload?.session_id || extractSessionId(result.stdout);
  let childSession = null;
  if (sessionId) {
    try {
      childSession = await loadSession(cwd, sessionId);
    } catch {
      childSession = null;
    }
  }

  const runResult = {
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    sessionId,
    outputPath,
    childStatus: childSession?.status || '',
    summary: outputPayload?.summary || childSession?.summary || null
  };

  if (hostExecutor?.root && isHostExecutorRerouteCandidate(runResult) && !process.env.OPENCODEX_HOST_EXECUTOR_JOB_ID) {
    const queuedJob = await enqueueHostExecutorJob({
      rootDir: hostExecutor.root,
      cwd,
      workflowSessionId: parentSessionId,
      parentSessionId,
      task,
      message,
      profile,
      prompt: workerPrompt,
      outputPath,
      sourceSessionId: sessionId,
      sourceSummary: runResult.summary
    });

    return {
      ...runResult,
      code: 0,
      rerouteJobId: queuedJob.job.job_id,
      rerouteRecordPath: queuedJob.jobPath,
      summary: buildHostExecutorRerouteSummary({
        task,
        queuedJob: queuedJob.job,
        sourceSummary: runResult.summary
      })
    };
  }

  return runResult;
}

function isHostExecutorRerouteCandidate(runResult) {
  const summary = runResult?.summary && typeof runResult.summary === 'object'
    ? runResult.summary
    : null;
  if (!summary || summary.status !== 'failed') {
    return false;
  }

  if (summary.title === 'Run blocked by host sandbox') {
    return true;
  }

  const validation = Array.isArray(summary.validation) ? summary.validation : [];
  if (validation.some((item) => String(item || '').startsWith('sandbox_detection:'))) {
    return true;
  }

  return /更严格的外层沙箱|host sandbox/i.test(String(summary.result || ''));
}

function hasReroutedWorkflowTasks(workflowState) {
  return Array.isArray(workflowState?.tasks)
    && workflowState.tasks.some((task) => String(task?.summary_status || '') === 'rerouted');
}

function buildHostExecutorRerouteSummary({ task, queuedJob, sourceSummary }) {
  const blockedReason = typeof sourceSummary?.result === 'string' && sourceSummary.result.trim()
    ? sourceSummary.result.trim()
    : 'Worker execution was blocked by the stricter host sandbox.';
  return {
    title: 'Task rerouted to host executor',
    result: `已检测到当前 worker 所在环境的宿主沙箱更严格，任务已自动转入 host executor queue，CTO 主线程会继续跟踪并在完成后主动汇报。\n原始原因：${blockedReason}`,
    status: 'rerouted',
    highlights: [
      `Queue Job: ${queuedJob.job_id}.`,
      `Task: ${typeof task?.id === 'string' ? task.id : 'unknown'}.`
    ],
    next_steps: [],
    risks: [],
    validation: ['host_executor:queued'],
    changed_files: [],
    findings: [],
    reroute_job_id: queuedJob.job_id,
    reroute_record_path: queuedJob.record_path || ''
  };
}

function buildTelegramCtoRerouteText(workflowState) {
  return truncateTelegramText([
    'openCodex CTO 已转交宿主执行器继续处理',
    `目标：${truncateInline(workflowState.goal_text, 160)}`,
    `进度：已有任务进入 host executor queue，我会继续跟踪并在完成后主动回报。`,
    `Workflow: ${workflowState.workflow_session_id}`
  ].join('\n'));
}

async function processTelegramHostExecutorQueue({
  cwd,
  profile,
  hostExecutor,
  workflowRuntimes,
  repliesPath,
  runsPath,
  logPath,
  apiBaseUrl,
  botToken,
  persistListenerSession
}) {
  while (true) {
    const claimed = await claimNextPendingHostExecutorJob(hostExecutor.root);
    if (!claimed) {
      return;
    }

    const { job, jobPath } = claimed;
    const runtime = workflowRuntimes.get(job.workflow_session_id);
    if (!runtime) {
      await updateHostExecutorJob(jobPath, {
        status: 'failed',
        error_message: 'Workflow runtime is no longer active for this queued host job.'
      });
      continue;
    }

    const task = Array.isArray(runtime.state?.tasks)
      ? runtime.state.tasks.find((item) => item?.id === job.task_id)
      : null;
    if (!task) {
      await updateHostExecutorJob(jobPath, {
        status: 'failed',
        error_message: 'Workflow task could not be found for this queued host job.'
      });
      continue;
    }

    await appendFile(logPath, `[${toIsoString()}] host executor claimed ${job.job_id} for workflow ${job.workflow_session_id} task ${job.task_id}\n`, 'utf8');
    process.stdout.write(`Host executor claimed ${job.job_id} for workflow ${job.workflow_session_id} task ${job.task_id}\n`);

    const result = await spawnCliCapture([
      'run',
      '--cwd',
      job.cwd,
      '--profile',
      job.profile || profile,
      '--output',
      job.output_path,
      job.prompt
    ], job.cwd || cwd, buildHostExecutorEnv({
      OPENCODEX_PARENT_SESSION_ID: job.parent_session_id || runtime.session.session_id,
      OPENCODEX_IM_SOURCE: 'telegram',
      OPENCODEX_IM_UPDATE_ID: String(job.update_id || runtime.rootMessage.update_id || 0),
      OPENCODEX_CTO_STAGE: 'host-executor',
      OPENCODEX_CTO_TASK_ID: job.task_id || '',
      OPENCODEX_HOST_EXECUTOR_JOB_ID: job.job_id
    }));

    let outputPayload = null;
    try {
      outputPayload = await readJson(job.output_path);
    } catch {
      outputPayload = null;
    }

    const sessionId = outputPayload?.session_id || extractSessionId(result.stdout);
    let childSession = null;
    if (sessionId) {
      try {
        childSession = await loadSession(job.cwd || cwd, sessionId);
      } catch {
        childSession = null;
      }
    }

    const runResult = {
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      sessionId,
      outputPath: job.output_path,
      childStatus: childSession?.status || '',
      summary: outputPayload?.summary || childSession?.summary || null
    };

    await updateHostExecutorJob(jobPath, {
      status: runResult.summary?.status || runResult.childStatus || (runResult.code === 0 ? 'completed' : 'failed'),
      host_session_id: sessionId || '',
      host_session_path: sessionId ? path.join(getSessionDir(job.cwd || cwd, sessionId), 'session.json') : '',
      result_summary: runResult.summary || childSession?.summary || null,
      error_message: typeof runResult.summary?.result === 'string' ? runResult.summary.result : ''
    });

    if (runResult.sessionId) {
      await recordTelegramChildSession(runtime.session, job.cwd || cwd, {
        sessionId: runResult.sessionId,
        updateId: job.update_id || runtime.rootMessage.update_id || 0,
        label: `Host executor ${job.task_id}`
      });
    }

    applyWorkflowTaskResult(runtime.state, task.id, runResult);
    await appendFile(runsPath, `${JSON.stringify(buildTelegramRunRecord(runtime.rootMessage, runResult, {
      workflowSessionId: runtime.session.session_id,
      stage: 'host-executor',
      taskId: task.id,
      taskTitle: task.title
    }))}\n`, 'utf8');
    await appendFile(logPath, `[${toIsoString()}] host executor finished ${job.job_id} -> ${runResult.sessionId || 'no-session'} (${runResult.summary?.status || runResult.childStatus || runResult.code})\n`, 'utf8');

    if (runtime.state.status !== 'cancelled') {
      await executeTelegramCtoTasks({
        cwd: job.cwd || cwd,
        profile,
        message: runtime.rootMessage,
        runtime,
        runsPath,
        logPath,
        hostExecutor
      });
    }

    finalizeWorkflowStatus(runtime.state);
    await persistTelegramWorkflowRuntime(job.cwd || cwd, runtime);
    await persistListenerSession();

    if (runtime.state.status === 'waiting_for_user') {
      const questionReply = await sendTelegramTextMessage({
        apiBaseUrl,
        botToken,
        chatId: runtime.rootMessage.chat_id,
        text: buildTelegramCtoQuestionText(runtime.state),
        replyToMessageId: runtime.rootMessage.message_id
      });
      await appendTelegramReply(repliesPath, questionReply);
      await appendFile(logPath, `[${toIsoString()}] workflow ${runtime.session.session_id} paused for confirmation after host executor processing\n`, 'utf8');
      process.stdout.write(`CTO workflow ${runtime.session.session_id} paused for confirmation after host executor processing\n`);
      workflowRuntimes.delete(runtime.session.session_id);
      continue;
    }

    if (runtime.state.status !== 'running') {
      const finalReply = await sendTelegramTextMessage({
        apiBaseUrl,
        botToken,
        chatId: runtime.rootMessage.chat_id,
        text: buildTelegramCtoFinalText(runtime.state),
        replyToMessageId: runtime.rootMessage.message_id
      });
      await appendTelegramReply(repliesPath, finalReply);
      await appendFile(logPath, `[${toIsoString()}] workflow ${runtime.session.session_id} finished with status ${runtime.state.status} after host executor processing\n`, 'utf8');
      process.stdout.write(`CTO workflow ${runtime.session.session_id} finished with status ${runtime.state.status} after host executor processing\n`);
      workflowRuntimes.delete(runtime.session.session_id);
    }
  }
}

async function collectTelegramCtoHistoryRepairCandidates({ cwd, currentWorkflowSessionId }) {
  const sessions = await listSessions(cwd);
  const workflowItems = await Promise.all(
    sessions
      .filter((session) => session.command === 'cto' && session.session_id !== currentWorkflowSessionId)
      .map(async (session) => ({
        session,
        workflowState: await loadTelegramCtoWorkflowState(cwd, session)
      }))
  );

  return collectHistoricalStuckCtoWorkflowCandidates(workflowItems, {
    currentWorkflowSessionId,
    staleMinutes: DEFAULT_TELEGRAM_CTO_HISTORY_REPAIR_STALE_MINUTES
  });
}

async function loadTelegramCtoWorkflowState(cwd, session) {
  const artifactPath = Array.isArray(session?.artifacts)
    ? session.artifacts.find((artifact) => artifact?.type === 'cto_workflow' && typeof artifact.path === 'string' && artifact.path)?.path
    : '';
  if (session?.workflow_state && typeof session.workflow_state === 'object') {
    return session.workflow_state;
  }
  if (!artifactPath) {
    return null;
  }
  const resolvedArtifactPath = path.isAbsolute(artifactPath)
    ? artifactPath
    : path.join(getSessionDir(cwd, session.session_id), artifactPath);
  try {
    return await readJson(resolvedArtifactPath);
  } catch {
    return null;
  }
}

function buildTelegramRunRecord(message, runResult, extra = {}) {
  return {
    provider: 'telegram',
    update_id: message.update_id,
    message_id: message.message_id,
    chat_id: message.chat_id,
    workflow_session_id: extra.workflowSessionId || '',
    stage: extra.stage || 'task',
    task_id: extra.taskId || '',
    task_title: extra.taskTitle || '',
    created_at: toIsoString(),
    session_id: runResult.sessionId || '',
    status: runResult.summary?.status || runResult.childStatus || (runResult.code === 0 ? 'completed' : 'failed'),
    title: typeof runResult.summary?.title === 'string' ? runResult.summary.title : '',
    result: typeof runResult.summary?.result === 'string' ? truncateInline(runResult.summary.result, 500) : '',
    code: runResult.code
  };
}

async function appendTelegramReply(repliesPath, reply) {
  await appendFile(repliesPath, `${JSON.stringify(reply)}\n`, 'utf8');
}

async function recordTelegramChildSession(session, cwd, { sessionId, updateId, label = '' }) {
  if (!sessionId) {
    return;
  }

  let childSession = null;
  try {
    childSession = await loadSession(cwd, sessionId);
  } catch {
    childSession = null;
  }

  if (!Array.isArray(session.child_sessions)) {
    session.child_sessions = [];
  }

  if (!session.child_sessions.some((entry) => entry?.session_id === sessionId)) {
    session.child_sessions.push({
      label: label || `Telegram update ${updateId}`,
      update_id: updateId,
      command: childSession?.command || 'run',
      session_id: sessionId,
      status: childSession?.status || 'unknown'
    });
  }

  maybeAddArtifact(session, {
    type: 'child_session',
    path: path.join(getSessionDir(cwd, sessionId), 'session.json'),
    description: `Telegram delegated child session ${sessionId}.`
  });
}

function maybeAddArtifact(session, artifact) {
  if (!artifact?.path) {
    return;
  }
  if (!Array.isArray(session.artifacts)) {
    session.artifacts = [];
  }
  if (session.artifacts.some((item) => item?.path === artifact.path && item?.type === artifact.type)) {
    return;
  }
  session.artifacts.push(artifact);
}

function spawnCliCapture(args, cwd, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd,
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function extractSessionId(text) {
  const matches = [...String(text || '').matchAll(/Session:\s+([^\s]+)/g)];
  return matches.at(-1)?.[1] || '';
}

function truncateTelegramText(value, maxLength = TELEGRAM_MAX_TEXT_LENGTH) {
  const text = String(value || '').trim();
  if (!text || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function truncateInline(value, maxLength = 160) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function asStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => typeof item === 'string' && item.trim());
}

function normalizeTelegramUpdate(update) {
  const message = update.message;
  const text = typeof message?.text === 'string' ? message.text.trim() : '';
  const chatId = message?.chat?.id;
  if (!text || (typeof chatId !== 'number' && typeof chatId !== 'string')) {
    return null;
  }

  const senderParts = [message.from?.first_name, message.from?.last_name]
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => item.trim());
  const senderDisplay = senderParts.join(' ') || (typeof message.from?.username === 'string' ? `@${message.from.username}` : 'telegram-user');

  return {
    provider: 'telegram',
    update_id: update.update_id,
    message_id: message.message_id,
    created_at: typeof message.date === 'number' ? new Date(message.date * 1000).toISOString() : toIsoString(),
    chat_id: String(chatId),
    chat_type: typeof message.chat?.type === 'string' ? message.chat.type : 'unknown',
    chat_title: typeof message.chat?.title === 'string' ? message.chat.title : '',
    sender_id: typeof message.from?.id === 'number' || typeof message.from?.id === 'string' ? String(message.from.id) : '',
    sender_username: typeof message.from?.username === 'string' ? message.from.username : '',
    sender_display: senderDisplay,
    text
  };
}

function buildTelegramListenSummary({ me, pollTimeout, allowedChatId, updateCount, lastMessage, delegateMode, delegateProfile, childSessionCount }) {
  const highlights = [
    `Bot: @${me.username || 'unknown'}`,
    `Poll timeout: ${pollTimeout}s`,
    `Messages received: ${updateCount}`,
    `Delegate mode: ${delegateMode === 'cto' ? `cto (${delegateProfile})` : 'ack-only'}`,
    ...(allowedChatId ? [`Allowed chat: ${allowedChatId}`] : ['Allowed chat: any'])
  ];
  if (delegateMode === 'cto') {
    highlights.push(`Child sessions: ${childSessionCount || 0}`);
  }
  if (lastMessage) {
    highlights.push(`Latest chat: ${lastMessage.chat_id}`, `Latest sender: ${lastMessage.sender_display}`);
  }

  return {
    title: 'Telegram listening',
    result: updateCount > 0
      ? `Received ${updateCount} Telegram message(s) so far.`
      : 'Waiting for Telegram messages.',
    status: 'running',
    highlights,
    next_steps: [delegateMode === 'cto'
      ? 'Send a message to the Telegram bot from your phone; openCodex CTO will process it through Codex CLI.'
      : 'Send a message to the Telegram bot from your phone.'],
    findings: []
  };
}

function buildTelegramFinalSummary({ me, pollTimeout, allowedChatId, updateCount, lastMessage, status, result, delegateMode, delegateProfile, childSessionCount }) {
  const highlights = [
    `Bot: @${me.username || 'unknown'}`,
    `Poll timeout: ${pollTimeout}s`,
    `Messages received: ${updateCount}`,
    `Delegate mode: ${delegateMode === 'cto' ? `cto (${delegateProfile})` : 'ack-only'}`,
    ...(allowedChatId ? [`Allowed chat: ${allowedChatId}`] : ['Allowed chat: any'])
  ];
  if (delegateMode === 'cto') {
    highlights.push(`Child sessions: ${childSessionCount || 0}`);
  }
  if (lastMessage) {
    highlights.push(`Latest chat: ${lastMessage.chat_id}`, `Latest sender: ${lastMessage.sender_display}`);
  }

  return {
    title: status === 'completed' ? 'Telegram completed' : 'Telegram failed',
    result,
    status,
    highlights,
    next_steps: status === 'completed'
      ? ['Use `opencodex im telegram inbox` to inspect recent Telegram messages.']
      : ['Inspect the telegram session artifacts and verify the bot token or webhook settings.'],
    findings: []
  };
}

function createTelegramListenerStatePayload({ me, lastOffset, allowedChatId, delegateMode, delegateProfile, workflows, chatStates }) {
  const workflowItems = Array.from(workflows || [])
    .map((runtime) => ({
      workflow_session_id: runtime.session.session_id,
      chat_id: runtime.state.chat_id,
      status: runtime.state.status,
      pending_question_zh: runtime.state.pending_question_zh || '',
      updated_at: runtime.state.updated_at
    }))
    .sort((left, right) => String(right.updated_at || '').localeCompare(String(left.updated_at || '')));

  const activeWorkflowCount = workflowItems.filter((item) => item.status === 'planning' || item.status === 'running').length;
  const waitingWorkflowCount = workflowItems.filter((item) => item.status === 'waiting_for_user').length;

  const chatItems = Array.from(chatStates || [])
    .map((state) => ({
      chat_id: state.chat_id,
      message_count: state.message_count || 0,
      direct_reply_count: state.direct_reply_count || 0,
      workflow_start_count: state.workflow_start_count || 0,
      last_mode: state.last_mode || '',
      last_intent: state.last_intent || '',
      last_updated_at: state.last_updated_at || ''
    }))
    .sort((left, right) => String(right.last_updated_at || '').localeCompare(String(left.last_updated_at || '')));

  return {
    provider: 'telegram',
    bot_username: me.username || '',
    last_offset: lastOffset,
    allowed_chat_id: allowedChatId || '',
    delegate_mode: delegateMode,
    profile: delegateMode === 'cto' ? delegateProfile : '',
    active_workflow_count: activeWorkflowCount,
    waiting_workflow_count: waitingWorkflowCount,
    conversation_chat_count: chatItems.filter((item) => item.last_mode === 'conversation').length,
    chat_states: chatItems,
    workflows: workflowItems
  };
}

function getOrCreateTelegramChatState(chatStates, chatId) {
  if (!chatStates.has(chatId)) {
    chatStates.set(chatId, {
      chat_id: chatId,
      message_count: 0,
      direct_reply_count: 0,
      workflow_start_count: 0,
      last_mode: '',
      last_intent: '',
      last_user_message: '',
      last_workflow_session_id: '',
      last_updated_at: ''
    });
  }
  return chatStates.get(chatId);
}

function noteTelegramChatInbound(chatStates, message) {
  const chatState = getOrCreateTelegramChatState(chatStates, message.chat_id);
  chatState.message_count = Number(chatState.message_count || 0) + 1;
  chatState.last_intent = classifyTelegramCtoMessageIntent(message.text).kind;
  chatState.last_user_message = message.text;
  chatState.last_updated_at = message.created_at || toIsoString();
  return chatState;
}

function noteTelegramChatDirectReply(chatState, message, mode = 'casual') {
  if (!chatState) {
    return;
  }
  chatState.direct_reply_count = Number(chatState.direct_reply_count || 0) + 1;
  chatState.last_mode = ['conversation', 'exploration'].includes(mode) ? mode : 'casual';
  chatState.last_user_message = message.text;
  chatState.last_updated_at = message.created_at || toIsoString();
}

function noteTelegramChatWorkflowStart(chatState, workflowSessionId, message) {
  if (!chatState) {
    return;
  }
  chatState.workflow_start_count = Number(chatState.workflow_start_count || 0) + 1;
  chatState.last_mode = 'workflow';
  chatState.last_workflow_session_id = workflowSessionId || '';
  chatState.last_user_message = message.text;
  chatState.last_updated_at = message.created_at || toIsoString();
}

async function resolveTelegramCtoControlReply({ cwd, message, workflowRuntimes, persistWorkflowRuntime }) {
  const intent = parseTelegramCtoControlIntent(message.text);
  if (!intent.isCancelQuery) {
    return null;
  }

  const runtime = await findTelegramWorkflowForCancel({
    cwd,
    chatId: message.chat_id,
    workflowId: intent.workflowId,
    workflowRuntimes
  });

  if (!runtime) {
    return {
      workflowId: intent.workflowId,
      text: buildTelegramMissingWorkflowCancelText({
        chatId: message.chat_id,
        workflowId: intent.workflowId
      })
    };
  }

  if (!isTelegramWorkflowCancellable(runtime.state)) {
    return {
      workflowId: runtime.session.session_id,
      text: buildTelegramNonCancellableWorkflowText({
        workflowId: runtime.session.session_id,
        chatId: message.chat_id,
        status: runtime.state.status
      })
    };
  }

  cancelTelegramWorkflowState(runtime.state);
  await persistWorkflowRuntime(runtime);
  workflowRuntimes.delete(runtime.session.session_id);

  return {
    workflowId: runtime.session.session_id,
    text: buildTelegramCtoFinalText(runtime.state)
  };
}

function parseTelegramCtoControlIntent(text) {
  const value = String(text || '').trim();
  const workflowId = extractReferencedWorkflowId(value);
  const cancelPatterns = [
    /^(取消|停止|终止|中止)(当前)?(工作流|workflow|任务)?$/i,
    /(取消|停止|终止|中止).{0,8}(工作流|workflow|任务)?/i,
    /(workflow|工作流).{0,8}(取消|停止|终止|中止)/i,
    /\b(cancel|stop|abort)\b/i
  ];

  return {
    workflowId,
    isCancelQuery: cancelPatterns.some((pattern) => pattern.test(value))
  };
}

async function findTelegramWorkflowForCancel({ cwd, chatId, workflowId, workflowRuntimes }) {
  if (workflowId) {
    const activeRuntime = workflowRuntimes.get(workflowId);
    if (activeRuntime?.state?.chat_id === chatId) {
      return activeRuntime;
    }
    const runtime = await loadTelegramWorkflowRuntime(cwd, workflowId, chatId);
    return isTelegramWorkflowCancellable(runtime?.state) ? runtime : runtime || null;
  }

  const activeRuntime = Array.from(workflowRuntimes.values())
    .filter((runtime) => runtime?.state?.chat_id === chatId && isTelegramWorkflowCancellable(runtime.state))
    .sort((left, right) => String(right.state.updated_at || '').localeCompare(String(left.state.updated_at || '')))[0] || null;
  if (activeRuntime) {
    return activeRuntime;
  }

  const sessions = await listSessions(cwd);
  for (const session of sessions) {
    if (session.command !== 'cto') {
      continue;
    }
    if (String(session.input?.arguments?.chat_id || '') !== String(chatId)) {
      continue;
    }

    const runtime = await loadTelegramWorkflowRuntime(cwd, session.session_id, chatId);
    if (isTelegramWorkflowCancellable(runtime?.state)) {
      return runtime;
    }
  }

  return null;
}

function isTelegramWorkflowCancellable(workflowState) {
  if (!workflowState || typeof workflowState !== 'object') {
    return false;
  }
  return !['completed', 'failed', 'cancelled'].includes(String(workflowState.status || ''));
}

function buildTelegramMissingWorkflowCancelText({ chatId, workflowId = '' }) {
  const lines = [
    workflowId
      ? 'openCodex CTO 未找到可取消的工作流'
      : 'openCodex CTO 当前没有可取消的工作流'
  ];

  if (workflowId) {
    lines.push(`Workflow: ${workflowId}`);
  }
  lines.push(`Chat: ${chatId}`);
  lines.push('说明：当前没有匹配的进行中或待确认 CTO 工作流。');
  return lines.join('\n');
}

function buildTelegramNonCancellableWorkflowText({ workflowId, chatId, status }) {
  return [
    'openCodex CTO 工作流不可取消',
    `Workflow: ${workflowId}`,
    `Chat: ${chatId}`,
    `状态：${status || 'unknown'}`,
    '说明：该工作流已经结束，无需再次取消。'
  ].join('\n');
}

async function resolveTelegramCtoStatusReply({ cwd, message, workflowRuntimes }) {
  const intent = parseTelegramCtoStatusIntent(message.text);
  if (!intent.isStatusQuery) {
    return null;
  }

  if (intent.isHistoryQuery && !intent.workflowId) {
    const historyItems = await collectTelegramTaskHistory({
      cwd,
      chatId: message.chat_id,
      workflowRuntimes,
      limit: 6
    });
    return {
      workflowId: '',
      text: historyItems.length
        ? buildTelegramTaskHistoryText({ chatId: message.chat_id, items: historyItems })
        : buildTelegramMissingTaskHistoryText({ chatId: message.chat_id })
    };
  }

  const runtime = await findTelegramWorkflowForStatus({
    cwd,
    chatId: message.chat_id,
    workflowId: intent.workflowId,
    workflowRuntimes
  });

  if (!runtime) {
    return {
      workflowId: intent.workflowId,
      text: buildTelegramMissingWorkflowStatusText({
        chatId: message.chat_id,
        workflowId: intent.workflowId
      })
    };
  }

  return {
    workflowId: runtime.session.session_id,
    text: buildTelegramCtoStatusText(runtime.state)
  };
}

async function resolveTelegramCtoDirectReply({ message, pendingWorkflow, chatState, logPath }) {
  const replyMode = determineTelegramCtoReplyMode({
    text: message.text,
    pendingWorkflow,
    chatState
  });
  if (!replyMode) {
    return null;
  }

  await appendFile(logPath, `[${toIsoString()}] local direct reply ${replyMode} for update ${message.update_id}\n`, 'utf8');

  return {
    workflowId: pendingWorkflow?.session?.session_id || '',
    replyMode,
    text: buildTelegramCtoDirectReplyFallbackText(pendingWorkflow, replyMode)
  };
}

function determineTelegramCtoReplyMode({ text, pendingWorkflow, chatState }) {
  const intent = classifyTelegramCtoMessageIntent(text);
  if (intent.kind === 'exploration') {
    return 'exploration';
  }
  if (shouldKeepTelegramCtoInConversationMode({
    text,
    chatState,
    hasPendingWorkflow: Boolean(pendingWorkflow)
  })) {
    return 'conversation';
  }
  if (isLikelyTelegramCtoCasualChatMessage(text)) {
    return 'casual';
  }
  return '';
}

function pickTelegramCtoDirectReplyText(resultText, pendingWorkflow, replyMode = 'casual') {
  const value = String(resultText || '').trim();
  return value || buildTelegramCtoDirectReplyFallbackText(pendingWorkflow, replyMode);
}

function buildTelegramCtoDirectReplyFallbackText(pendingWorkflow, replyMode = 'casual') {
  const workflowId = pendingWorkflow?.session?.session_id || '';
  const pendingQuestion = truncateInline(pendingWorkflow?.state?.pending_question_zh || '请直接回复当前待确认问题。', 120);

  if (workflowId) {
    return [
      '可以，我在。',
      `当前 Workflow 仍保持等待中。Workflow: ${workflowId}；待确认：${pendingQuestion}`,
      '如果要继续，请直接回答这个问题。'
    ].join('\n');
  }

  if (replyMode === 'conversation') {
    return [
      '我在，先不急着进入员工编排。',
      '你可以先告诉我想聊聊方向，或者直接给一个具体目标。',
      '等意图明确后，我再切到编排模式并持续汇报进度。'
    ].join('\n');
  }

  return [
    '可以，我在。',
    '这条 Telegram CTO 通道也支持简短交流。',
    '如果要我执行，请直接发明确目标；如果要查进度，也可以直接问我工作流状态。'
  ].join('\n');
}

function parseTelegramCtoStatusIntent(text) {
  const value = String(text || '').trim();
  const workflowId = extractReferencedWorkflowId(value);
  const historyPatterns = [
    /(最近|历史).{0,6}(任务|派发)/i,
    /任务历史/i,
    /task\s*history/i,
    /recent\s+tasks/i,
    /dispatch\s*history/i
  ];
  const statusPatterns = [
    /安排了哪些任务/i,
    /安排了什么任务/i,
    /有哪些任务/i,
    /什么任务/i,
    /(当前|现在|最新|最近).{0,8}(状态|进度|任务)/i,
    /(汇报|同步|查看|看看|告诉我).{0,8}(状态|进度|任务|安排)/i,
    /任务(状态|进度|列表|安排)/i,
    /workflow\s*status/i,
    /task\s*list/i,
    /task\s*status/i,
    /what\s+tasks/i,
    /which\s+tasks/i,
    /\b(status|progress|report|summary)\b/i
  ];

  const bareWorkflowReference = Boolean(workflowId)
    && !value
      .replaceAll(workflowId, '')
      .replace(/workflow[:：]?/ig, '')
      .trim();
  const isHistoryQuery = historyPatterns.some((pattern) => pattern.test(value));

  return {
    workflowId,
    isHistoryQuery,
    isStatusQuery: bareWorkflowReference || isHistoryQuery || statusPatterns.some((pattern) => pattern.test(value))
  };
}

function extractReferencedWorkflowId(text) {
  const match = String(text || '').match(/\bcto-\d{8}-\d{6}-[a-z0-9]{4,8}\b/i);
  return match ? match[0] : '';
}

async function collectTelegramTaskHistory({ cwd, chatId, workflowRuntimes, limit = 6 }) {
  const runtimes = new Map();

  for (const runtime of workflowRuntimes.values()) {
    if (String(runtime?.state?.chat_id || '') !== String(chatId)) {
      continue;
    }
    runtimes.set(runtime.session.session_id, runtime);
  }

  const sessions = await listSessions(cwd);
  for (const session of sessions) {
    if (session.command !== 'cto') {
      continue;
    }
    if (String(session.input?.arguments?.chat_id || '') !== String(chatId)) {
      continue;
    }
    if (runtimes.has(session.session_id)) {
      continue;
    }

    const runtime = await loadTelegramWorkflowRuntime(cwd, session.session_id, chatId);
    if (runtime) {
      runtimes.set(session.session_id, runtime);
    }
  }

  return Array.from(runtimes.values())
    .flatMap((runtime) => buildTelegramTaskHistoryItems(runtime.state))
    .sort((left, right) => String(right.updated_at || '').localeCompare(String(left.updated_at || '')))
    .slice(0, limit);
}

function buildTelegramTaskHistoryItems(workflowState) {
  if (!Array.isArray(workflowState?.tasks)) {
    return [];
  }

  return workflowState.tasks
    .filter((task) => task && typeof task === 'object' && (task.session_id || ['running', 'completed', 'failed', 'partial', 'cancelled'].includes(task.status)))
    .map((task) => ({
      workflow_session_id: workflowState.workflow_session_id || '',
      task_id: typeof task.id === 'string' ? task.id : '',
      title: typeof task.title === 'string' ? task.title : '',
      status: typeof task.status === 'string' && task.status ? task.status : 'unknown',
      updated_at: typeof task.updated_at === 'string' ? task.updated_at : (workflowState.updated_at || '')
    }));
}

function buildTelegramTaskHistoryText({ chatId, items }) {
  const lines = [
    'openCodex CTO 最近任务',
    `Chat: ${chatId}`,
    `数量：${items.length}`
  ];

  for (const item of items) {
    const workflowSuffix = item.workflow_session_id ? ` (${item.workflow_session_id})` : '';
    lines.push(`- [${item.status}] ${item.task_id} ${truncateInline(item.title, 64)}${workflowSuffix}`.trim());
  }

  return lines.join('\n');
}

function buildTelegramMissingTaskHistoryText({ chatId }) {
  return [
    'openCodex CTO 当前没有可汇报的任务历史',
    `Chat: ${chatId}`,
    '说明：当前没有匹配的 CTO 任务历史记录可供汇报。'
  ].join('\n');
}

async function findTelegramWorkflowForStatus({ cwd, chatId, workflowId, workflowRuntimes }) {
  if (workflowId) {
    const activeRuntime = workflowRuntimes.get(workflowId);
    if (activeRuntime?.state?.chat_id === chatId) {
      return activeRuntime;
    }
    return loadTelegramWorkflowRuntime(cwd, workflowId, chatId);
  }

  const activeRuntime = Array.from(workflowRuntimes.values())
    .filter((runtime) => runtime?.state?.chat_id === chatId)
    .sort((left, right) => String(right.state.updated_at || '').localeCompare(String(left.state.updated_at || '')))[0] || null;
  if (activeRuntime) {
    return activeRuntime;
  }

  const sessions = await listSessions(cwd);
  for (const session of sessions) {
    if (session.command !== 'cto') {
      continue;
    }
    if (String(session.input?.arguments?.chat_id || '') !== String(chatId)) {
      continue;
    }

    const runtime = await loadTelegramWorkflowRuntime(cwd, session.session_id, chatId);
    if (runtime) {
      return runtime;
    }
  }

  return null;
}

async function loadTelegramWorkflowRuntime(cwd, sessionId, chatId = '') {
  let session = null;
  try {
    session = await loadSession(cwd, sessionId);
  } catch {
    return null;
  }

  if (!session || session.command !== 'cto') {
    return null;
  }

  const artifact = Array.isArray(session.artifacts)
    ? session.artifacts.find((item) => item?.type === 'cto_workflow' && typeof item.path === 'string' && item.path)
    : null;
  const workflowStatePath = artifact?.path || path.join(getSessionDir(cwd, session.session_id), 'artifacts', 'cto-workflow.json');

  let workflowState = null;
  try {
    workflowState = await readJson(workflowStatePath);
  } catch {
    return null;
  }

  if (!workflowState || (chatId && String(workflowState.chat_id || '') !== String(chatId))) {
    return null;
  }

  return {
    rootMessage: null,
    session,
    sessionDir: getSessionDir(cwd, session.session_id),
    state: workflowState,
    statePath: workflowStatePath
  };
}

function buildTelegramMissingWorkflowStatusText({ chatId, workflowId = '' }) {
  const lines = [
    workflowId
      ? 'openCodex CTO 未找到可汇报的工作流'
      : 'openCodex CTO 当前没有可汇报的工作流'
  ];

  if (workflowId) {
    lines.push(`Workflow: ${workflowId}`);
  }
  lines.push(`Chat: ${chatId}`);
  lines.push('说明：当前没有匹配的 CTO 工作流状态可供汇报。');
  return lines.join('\n');
}

function tryParseJson(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function sanitizeFileComponent(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'task';
}

function resolveTelegramBotToken(flagValue) {
  const token = (typeof flagValue === 'string' && flagValue.trim())
    || (typeof process.env.OPENCODEX_TELEGRAM_BOT_TOKEN === 'string' && process.env.OPENCODEX_TELEGRAM_BOT_TOKEN.trim())
    || '';
  if (!token) {
    throw new Error('Telegram bot token is required. Pass `--bot-token <token>` or set `OPENCODEX_TELEGRAM_BOT_TOKEN`.');
  }
  return token;
}

function resolveTelegramApiBaseUrl(flagValue) {
  const candidate = (typeof flagValue === 'string' && flagValue.trim())
    || (typeof process.env.OPENCODEX_TELEGRAM_API_BASE_URL === 'string' && process.env.OPENCODEX_TELEGRAM_API_BASE_URL.trim())
    || 'https://api.telegram.org';
  return candidate.replace(/\/$/, '');
}

function normalizeChatId(value) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return '';
}

function parseNonNegativeInteger(value, optionName) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${optionName} must be zero or a positive integer`);
  }
  return parsed;
}

function parsePositiveInteger(value, optionName) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer`);
  }
  return parsed;
}

async function rehydratePendingTelegramCtoWorkflows(cwd, workflowRuntimes) {
  const sessions = await listSessions(cwd);

  for (const session of sessions) {
    if (session.command !== 'cto') {
      continue;
    }

    const artifact = Array.isArray(session.artifacts)
      ? session.artifacts.find((item) => item?.type === 'cto_workflow' && typeof item.path === 'string' && item.path)
      : null;
    const workflowStatePath = artifact?.path || path.join(getSessionDir(cwd, session.session_id), 'artifacts', 'cto-workflow.json');

    let workflowState = null;
    try {
      workflowState = await readJson(workflowStatePath);
    } catch {
      workflowState = null;
    }

    const shouldResumeWaiting = session.status === 'partial' && workflowState?.status === 'waiting_for_user';
    const shouldResumeRerouted = workflowState?.status === 'running' && hasReroutedWorkflowTasks(workflowState);
    if (!workflowState || (!shouldResumeWaiting && !shouldResumeRerouted)) {
      continue;
    }

    const firstMessage = Array.isArray(workflowState.user_messages) && workflowState.user_messages[0]
      ? workflowState.user_messages[0]
      : null;
    const rootMessage = {
      provider: 'telegram',
      update_id: firstMessage?.update_id || workflowState.source_update_id || 0,
      message_id: firstMessage?.message_id || workflowState.source_message_id || 0,
      created_at: firstMessage?.created_at || workflowState.created_at || toIsoString(),
      chat_id: workflowState.chat_id,
      chat_type: 'private',
      chat_title: '',
      sender_id: '',
      sender_username: '',
      sender_display: workflowState.sender_display || 'telegram-user',
      text: workflowState.goal_text || session.input?.prompt || ''
    };

    workflowRuntimes.set(session.session_id, {
      rootMessage,
      session,
      sessionDir: getSessionDir(cwd, session.session_id),
      state: workflowState,
      statePath: workflowStatePath
    });
  }
}

async function findLatestTelegramSession(cwd) {
  const sessions = await listSessions(cwd);
  return sessions.find((session) => session.command === 'im' && session.input?.arguments?.provider === 'telegram') || null;
}

function resolveTelegramUpdatesPath(cwd, session) {
  const artifact = Array.isArray(session.artifacts)
    ? session.artifacts.find((item) => item?.type === 'telegram_updates' && typeof item.path === 'string' && item.path)
    : null;
  if (artifact?.path) {
    return artifact.path;
  }
  return path.join(cwd, '.opencodex', 'sessions', session.session_id, 'artifacts', 'telegram-updates.jsonl');
}

async function readJsonl(filePath) {
  const text = (await readTextIfExists(filePath)) || '';
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
