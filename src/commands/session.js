import path from 'node:path';
import { parseOptions } from '../lib/args.js';
import { listSessions, loadSession, saveSession, getSessionDir } from '../lib/session-store.js';
import { readJson, readTextIfExists, writeJson } from '../lib/fs.js';
import { buildTelegramCtoSessionSummary, classifyTelegramCtoMessageIntent, finalizeWorkflowStatus, summarizeWorkflowCounts } from '../lib/cto-workflow.js';
import { buildSummaryFromMessage } from './run.js';
import { buildReviewSummary } from './review.js';
import { renderHumanSummary } from '../lib/summary.js';

const OPTION_SPEC = {
  json: { type: 'boolean' },
  cwd: { type: 'string' },
  'stale-minutes': { type: 'string' }
};

export async function runSessionCommand(args) {
  const [subcommand, ...rest] = args;
  const cwd = path.resolve(process.cwd());

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    process.stdout.write('Usage:\n  opencodex session list [--json] [--cwd <dir>]\n  opencodex session show <id> [--json] [--cwd <dir>]\n  opencodex session tree <id> [--json] [--cwd <dir>]\n  opencodex session latest [--json] [--cwd <dir>]\n  opencodex session repair [--json] [--cwd <dir>] [--stale-minutes <n>]\n');
    return;
  }

  if (subcommand === 'list') {
    const { options, positionals } = parseOptions(rest, OPTION_SPEC);
    if (positionals.length) {
      throw new Error('`opencodex session list` does not accept positional arguments');
    }
    const targetCwd = path.resolve(options.cwd || cwd);
    const sessions = await listSessions(targetCwd);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);
      return;
    }
    if (!sessions.length) {
      process.stdout.write('No sessions found.\n');
      return;
    }
    for (const session of sessions) {
      process.stdout.write(`${session.session_id}  ${session.command}  ${session.status}  ${session.updated_at}\n`);
    }
    return;
  }

  if (subcommand === 'show') {
    const { options, positionals } = parseOptions(rest, OPTION_SPEC);
    const [sessionId] = positionals;
    if (!sessionId) {
      throw new Error('`opencodex session show` requires a session id');
    }
    const targetCwd = path.resolve(options.cwd || cwd);
    const session = await loadSession(targetCwd, sessionId);
    outputSession(session, options.json);
    return;
  }

  if (subcommand === 'tree') {
    const { options, positionals } = parseOptions(rest, OPTION_SPEC);
    const [sessionId] = positionals;
    if (!sessionId) {
      throw new Error('`opencodex session tree` requires a session id');
    }
    const targetCwd = path.resolve(options.cwd || cwd);
    const tree = await resolveSessionTree(targetCwd, sessionId);
    outputSessionTree(tree, options.json);
    return;
  }

  if (subcommand === 'latest') {
    const { options, positionals } = parseOptions(rest, OPTION_SPEC);
    if (positionals.length) {
      throw new Error('`opencodex session latest` does not accept positional arguments');
    }
    const targetCwd = path.resolve(options.cwd || cwd);
    const sessions = await listSessions(targetCwd);
    if (!sessions.length) {
      throw new Error('No sessions found for `opencodex session latest`');
    }
    outputSession(sessions[0], options.json);
    return;
  }

  if (subcommand === 'repair') {
    const { options, positionals } = parseOptions(rest, OPTION_SPEC);
    if (positionals.length) {
      throw new Error('`opencodex session repair` does not accept positional arguments');
    }
    const targetCwd = path.resolve(options.cwd || cwd);
    const staleMinutes = Number(options['stale-minutes'] || 10);
    if (!Number.isFinite(staleMinutes) || staleMinutes < 0) {
      throw new Error('`--stale-minutes` must be zero or a positive number');
    }

    const repaired = await repairSessions(targetCwd, staleMinutes);
    const payload = {
      repaired_count: repaired.length,
      repaired,
      repaired_sessions: repaired,
      stale_minutes: staleMinutes
    };

    if (options.json) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      return;
    }
    if (!repaired.length) {
      process.stdout.write('No stale sessions required repair.\n');
      return;
    }
    for (const item of repaired) {
      process.stdout.write(`${item.session_id}  ${item.from} -> ${item.to}  ${item.reason}\n`);
    }
    return;
  }

  throw new Error(`Unknown session subcommand: ${subcommand}`);
}

async function repairSessions(cwd, staleMinutes) {
  const sessions = sortRepairCandidates(await listSessions(cwd));
  const repairs = [];
  const excludedSessionId = typeof process.env.OPENCODEX_REPAIR_SKIP_SESSION_ID === 'string'
    ? process.env.OPENCODEX_REPAIR_SKIP_SESSION_ID.trim()
    : '';
  for (const session of sessions) {
    if (excludedSessionId && session.session_id === excludedSessionId) {
      continue;
    }
    if (!shouldRepairStaleSession(session)) {
      continue;
    }
    if (!isOlderThan(session.updated_at, staleMinutes)) {
      continue;
    }

    const repair = await deriveRepair(cwd, session);
    if (!repair) {
      continue;
    }

    const nextSummary = repair.summary || {
      title: repair.title || 'Session repaired as stale',
      result: repair.reason,
      status: repair.status,
      highlights: repair.highlights,
      next_steps: repair.next_steps,
      findings: []
    };
    const statusChanged = session.status !== repair.status;
    const summaryChanged = JSON.stringify(session.summary || null) !== JSON.stringify(nextSummary);
    const childSessionsChanged = Array.isArray(repair.child_sessions)
      && JSON.stringify(session.child_sessions || []) !== JSON.stringify(repair.child_sessions);
    const iterationChanged = Number.isInteger(repair.iteration_count)
      && repair.iteration_count !== session.iteration_count;
    const workflowChanged = Boolean(repair.workflow_state && repair.workflow_state_path);

    if (!statusChanged && !summaryChanged && !childSessionsChanged && !iterationChanged && !workflowChanged) {
      continue;
    }

    session.status = repair.status;
    session.updated_at = new Date().toISOString();
    session.summary = nextSummary;
    if (Array.isArray(repair.child_sessions)) {
      session.child_sessions = repair.child_sessions;
    }
    if (Number.isInteger(repair.iteration_count)) {
      session.iteration_count = repair.iteration_count;
    }
    if (repair.workflow_state && repair.workflow_state_path) {
      await writeJson(repair.workflow_state_path, repair.workflow_state);
    }
    await saveSession(cwd, session);
    repairs.push({
      session_id: session.session_id,
      from: repair.from,
      to: repair.status,
      reason: repair.reason
    });
  }
  return repairs;
}

function sortRepairCandidates(sessions) {
  return [...sessions].sort((left, right) => {
    const commandCompare = compareRepairCommand(left?.command, right?.command);
    if (commandCompare !== 0) {
      return commandCompare;
    }

    const createdAtCompare = String(right?.created_at || '').localeCompare(String(left?.created_at || ''));
    if (createdAtCompare !== 0) {
      return createdAtCompare;
    }

    return String(right?.session_id || '').localeCompare(String(left?.session_id || ''));
  });
}

function compareRepairCommand(leftCommand, rightCommand) {
  const leftPriority = leftCommand === 'auto' ? 1 : 0;
  const rightPriority = rightCommand === 'auto' ? 1 : 0;
  return leftPriority - rightPriority;
}

async function resolveSessionTree(cwd, requestedSessionId) {
  const sessions = await listSessions(cwd);
  const requestedSession = sessions.find((session) => session.session_id === requestedSessionId)
    || await loadSession(cwd, requestedSessionId);
  const allSessions = sessions.some((session) => session.session_id === requestedSession.session_id)
    ? sessions
    : [...sessions, requestedSession];
  const sessionMap = new Map(allSessions.map((session) => [session.session_id, session]));
  const { parentByChild, childrenByParent } = buildSessionLinks(allSessions);
  const rootSessionId = findRootSessionId(requestedSession.session_id, parentByChild);
  return buildSessionTreeNode(rootSessionId, sessionMap, parentByChild, childrenByParent);
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

function findRootSessionId(sessionId, parentByChild) {
  const visited = new Set();
  let currentSessionId = sessionId;

  while (currentSessionId && !visited.has(currentSessionId)) {
    visited.add(currentSessionId);
    const parentSessionId = parentByChild.get(currentSessionId);
    if (!parentSessionId) {
      break;
    }
    currentSessionId = parentSessionId;
  }

  return currentSessionId;
}


function compareSessionCreatedAt(leftSession, rightSession, leftId, rightId) {
  const leftCreatedAt = typeof leftSession?.created_at === 'string' ? leftSession.created_at : '';
  const rightCreatedAt = typeof rightSession?.created_at === 'string' ? rightSession.created_at : '';
  const compareCreatedAt = leftCreatedAt.localeCompare(rightCreatedAt);
  if (compareCreatedAt !== 0) {
    return compareCreatedAt;
  }
  return String(leftId || '').localeCompare(String(rightId || ''));
}

function buildSessionTreeNode(sessionId, sessionMap, parentByChild, childrenByParent, lineage = new Set()) {
  const session = sessionMap.get(sessionId);
  const nextLineage = new Set(lineage);
  nextLineage.add(sessionId);
  const childIds = (childrenByParent.get(sessionId) || [])
    .filter((childSessionId) => {
      return parentByChild.get(childSessionId) === sessionId && !nextLineage.has(childSessionId);
    })
    .sort((left, right) => compareSessionCreatedAt(sessionMap.get(left), sessionMap.get(right), left, right));

  return {
    session_id: sessionId,
    command: session?.command || 'unknown',
    status: session?.status || 'missing',
    updated_at: session?.updated_at || null,
    parent_session_id: parentByChild.get(sessionId) || session?.parent_session_id || null,
    children: childIds.map((childSessionId) => {
      return buildSessionTreeNode(childSessionId, sessionMap, parentByChild, childrenByParent, nextLineage);
    })
  };
}

async function deriveRepair(cwd, session, lineage = new Set()) {
  if (lineage.has(session.session_id)) {
    return null;
  }

  const nextLineage = new Set(lineage);
  nextLineage.add(session.session_id);

  if (session.command === 'review') {
    return deriveReviewRepair(cwd, session);
  }

  if (session.command === 'auto') {
    return deriveAutoRepair(cwd, session, nextLineage);
  }

  if (session.command === 'cto') {
    return deriveCtoRepair(cwd, session, nextLineage);
  }

  return deriveRunRepair(cwd, session);
}


function shouldRepairStaleSession(session) {
  if (['queued', 'running'].includes(session?.status)) {
    return true;
  }
  if (session?.command === 'cto' && ['partial', 'failed'].includes(session?.status)) {
    return true;
  }
  return session?.command === 'run' && session?.status === 'failed';
}

async function deriveCtoRepair(cwd, session, lineage) {
  const workflowStatePath = getCtoWorkflowStatePath(cwd, session);
  if (!workflowStatePath) {
    return null;
  }

  let workflowState = session.workflow_state && typeof session.workflow_state === 'object'
    ? structuredClone(session.workflow_state)
    : null;
  if (!workflowState) {
    try {
      workflowState = await readJson(workflowStatePath);
    } catch {
      workflowState = null;
    }
  }
  if (!workflowState || !Array.isArray(workflowState.tasks)) {
    return null;
  }

  const originalWorkflowState = JSON.stringify(workflowState);
  const originalChildSessions = JSON.stringify(normalizeChildSessions(session.child_sessions));
  const childSessions = normalizeChildSessions(session.child_sessions).map((child) => ({ ...child }));
  const childSessionById = new Map(childSessions.map((child) => [child.session_id, child]));
  const childSessionByTaskId = new Map(
    childSessions
      .map((child) => [extractTaskIdFromChildLabel(child.label), child])
      .filter(([taskId]) => taskId)
  );

  for (const task of workflowState.tasks) {
    await repairCtoWorkflowTask(cwd, task, childSessionById, childSessionByTaskId, lineage);
  }

  for (const child of childSessions) {
    if (!child?.session_id) {
      continue;
    }
    let childSession = null;
    try {
      childSession = await loadSession(cwd, child.session_id);
    } catch {
      childSession = null;
    }
    if (!childSession) {
      continue;
    }
    const resolvedChild = await resolveRepairSnapshot(cwd, childSession, lineage);
    child.status = resolvedChild.status || child.status || 'unknown';
    child.command = resolvedChild.command || child.command || 'run';
  }

  const misroutedChatRepair = repairMisroutedCasualChatWorkflow(session, workflowState);
  if (misroutedChatRepair) {
    const workflowChanged = JSON.stringify(workflowState) !== originalWorkflowState;
    const childSessionsChanged = JSON.stringify(childSessions) !== originalChildSessions;
    const summaryChanged = JSON.stringify(session.summary || null) !== JSON.stringify(misroutedChatRepair.summary);
    if (!workflowChanged && !childSessionsChanged && !summaryChanged && session.status === misroutedChatRepair.status) {
      return null;
    }
    workflowState.updated_at = new Date().toISOString();
    return {
      from: session.status,
      status: misroutedChatRepair.status,
      reason: misroutedChatRepair.reason,
      summary: misroutedChatRepair.summary,
      workflow_state: workflowState,
      workflow_state_path: workflowStatePath,
      child_sessions: childSessions
    };
  }

  const derivedPendingQuestion = deriveCtoPendingQuestion(workflowState.tasks);
  if (!asTrimmedString(workflowState.pending_question_zh) && derivedPendingQuestion) {
    workflowState.pending_question_zh = derivedPendingQuestion;
    workflowState.status = 'waiting_for_user';
  } else if (workflowState.status !== 'waiting_for_user') {
    workflowState.pending_question_zh = '';
  }

  if (workflowState.status !== 'waiting_for_user' || !asTrimmedString(workflowState.pending_question_zh)) {
    if (!asTrimmedString(workflowState.pending_question_zh)) {
      workflowState.pending_question_zh = '';
    }
    finalizeWorkflowStatus(workflowState);
  }

  workflowState.updated_at = new Date().toISOString();
  const summary = buildTelegramCtoSessionSummary(workflowState);
  const workflowChanged = JSON.stringify(workflowState) != originalWorkflowState;
  const childSessionsChanged = JSON.stringify(childSessions) != originalChildSessions;
  if (!workflowChanged && !childSessionsChanged && session.status === summary.status) {
    return null;
  }

  return {
    from: session.status,
    status: summary.status,
    reason: summary.result,
    summary,
    workflow_state: workflowState,
    workflow_state_path: workflowStatePath,
    child_sessions: childSessions
  };
}

function repairMisroutedCasualChatWorkflow(session, workflowState) {
  const inferredIntent = classifyTelegramCtoMessageIntent(workflowState?.goal_text || '');
  if (inferredIntent.kind !== 'casual_chat') {
    return null;
  }

  const counts = summarizeWorkflowCounts(workflowState);
  if (counts.completed > 0 || counts.running > 0 || counts.rerouted > 0 || counts.queued > 0) {
    return null;
  }
  if (counts.failed + counts.partial === 0) {
    return null;
  }

  const hasChangedFiles = (workflowState.tasks || []).some((task) => normalizeStringList(task?.changed_files).length > 0);
  if (hasChangedFiles) {
    return null;
  }

  for (const task of workflowState.tasks || []) {
    task.next_steps = [];
  }

  workflowState.status = 'failed';
  workflowState.pending_question_zh = '';

  const result = '这条历史 Telegram 消息更像轻聊天，本不该进入 workflow；已停止后续等待，不再要求 CEO 跟进。';
  const summary = {
    title: 'CTO workflow repaired as chat-only',
    result,
    status: 'failed',
    highlights: [
      `Chat: ${workflowState.chat_id || ''}`,
      `Intent: ${inferredIntent.label_zh}`,
      `Tasks: ${counts.total}`,
      `Failed: ${counts.failed}`,
      `Partial: ${counts.partial}`
    ].filter(Boolean),
    next_steps: [],
    risks: [],
    validation: ['chat_routing:casual_chat_repair'],
    changed_files: [],
    findings: []
  };

  return {
    status: 'failed',
    reason: result,
    summary
  };
}

async function repairCtoWorkflowTask(cwd, task, childSessionById, childSessionByTaskId, lineage) {
  if (!task || typeof task !== 'object') {
    return;
  }

  let taskSessionId = asTrimmedString(task.session_id);
  if (!taskSessionId) {
    const linkedChildSession = childSessionByTaskId.get(task.id);
    taskSessionId = asTrimmedString(linkedChildSession?.session_id);
    if (taskSessionId) {
      task.session_id = taskSessionId;
    }
  }

  if (!taskSessionId) {
    if (task.status === 'running') {
      markCtoTaskAsStalled(task, 'Task dispatch stalled before the worker session was created.');
    }
    return;
  }

  let childSession = null;
  try {
    childSession = await loadSession(cwd, taskSessionId);
  } catch {
    childSession = null;
  }
  if (!childSession) {
    if (task.status === 'running') {
      markCtoTaskAsStalled(task, 'Task worker session could not be found during repair.');
    }
    return;
  }

  const resolvedChild = await resolveRepairSnapshot(cwd, childSession, lineage);
  const childMetadata = childSessionById.get(taskSessionId);
  if (childMetadata) {
    childMetadata.status = resolvedChild.status || childMetadata.status || 'unknown';
    childMetadata.command = resolvedChild.command || childMetadata.command || 'run';
  }
  syncCtoTaskFromChild(task, resolvedChild);
}

function syncCtoTaskFromChild(task, childSession) {
  const summaryStatus = asTrimmedString(childSession?.summary?.status) || asTrimmedString(childSession?.status);
  const mappedStatus = ['completed', 'failed', 'partial'].includes(summaryStatus)
    ? summaryStatus
    : ['completed', 'failed', 'partial'].includes(childSession?.status)
      ? childSession.status
      : '';

  if (!mappedStatus) {
    if (asTrimmedString(childSession?.status) === 'running' && task.status !== 'running') {
      task.status = 'running';
    }
    task.summary_status = summaryStatus || task.summary_status || '';
    task.updated_at = childSession?.updated_at || task.updated_at || new Date().toISOString();
    return;
  }

  task.status = mappedStatus;
  task.summary_status = summaryStatus || mappedStatus;
  task.result = asTrimmedString(childSession?.summary?.result) || task.result || '';
  task.next_steps = normalizeStringList(childSession?.summary?.next_steps);
  task.changed_files = normalizeStringList(childSession?.summary?.changed_files);
  task.updated_at = childSession?.updated_at || new Date().toISOString();
}

function markCtoTaskAsStalled(task, reason) {
  task.status = 'partial';
  task.summary_status = 'partial';
  task.result = asTrimmedString(task.result) || reason;
  task.next_steps = normalizeStringList(task.next_steps);
  if (!task.next_steps.length) {
    task.next_steps = ['请确认是否重新派发该任务，或重建当前工作流。'];
  }
  task.changed_files = normalizeStringList(task.changed_files);
  task.updated_at = new Date().toISOString();
}

function deriveCtoPendingQuestion(tasks) {
  let sawFailedTask = false;

  for (const task of tasks || []) {
    const nextSteps = normalizeStringList(task?.next_steps);
    if ((task?.status === 'partial' || task?.status === 'failed') && nextSteps.length) {
      return nextSteps[0];
    }
    if ((task?.status === 'partial' || task?.status === 'failed') && asTrimmedString(task?.result)) {
      return task.result.trim();
    }
    if (task?.status === 'failed') {
      sawFailedTask = true;
    }
  }

  if (sawFailedTask) {
    return '检测到失败任务但缺少明确下一步，请确认是否重新派发失败任务。';
  }

  return '';
}

function getCtoWorkflowStatePath(cwd, session) {
  const artifactPath = Array.isArray(session?.artifacts)
    ? session.artifacts.find((artifact) => artifact?.type === 'cto_workflow' && typeof artifact.path === 'string' && artifact.path)?.path
    : '';
  if (artifactPath) {
    return artifactPath;
  }
  if (!session?.session_id) {
    return '';
  }
  return path.join(getSessionDir(cwd, session.session_id), 'artifacts', 'cto-workflow.json');
}

function extractTaskIdFromChildLabel(label) {
  const match = String(label || '').match(/^Task\s+(.+?)(?:\s+·\s+.+)?$/i);
  return match?.[1]?.trim() || '';
}

function asTrimmedString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

async function deriveRunRepair(cwd, session) {
  const sessionDir = getSessionDir(cwd, session.session_id);
  const eventsPath = path.join(sessionDir, 'events.jsonl');
  const lastMessagePath = path.join(sessionDir, 'last-message.txt');
  const eventsText = await readTextIfExists(eventsPath);
  const rawLastMessage = (await readTextIfExists(lastMessagePath))?.trim() || '';
  const lines = String(eventsText || '').split('\n').filter(Boolean);
  const eventObjects = lines.map(parseJsonLine).filter(Boolean);
  const failureMessages = eventObjects.flatMap(extractRunFailureMessages);

  const hasTurnFailed = eventObjects.some((item) => item.type === 'turn.failed');
  const hasTurnCompleted = eventObjects.some((item) => item.type === 'turn.completed');

  if (hasTurnFailed) {
    const reason = failureMessages.at(-1) || 'A previous Codex run failed before the wrapper updated the session state.';
    return {
      from: session.status,
      status: 'failed',
      reason,
      highlights: ['Detected terminal failure event in events.jsonl.'],
      next_steps: ['Inspect events.jsonl and stderr artifacts for the original failure.']
    };
  }

  if (hasTurnCompleted) {
    if (rawLastMessage) {
      const summary = buildSummaryFromMessage(rawLastMessage, 'completed', session.codex_cli_version);
      return {
        from: session.status,
        status: summary.status,
        reason: summary.result,
        summary
      };
    }

    return {
      from: session.status,
      status: 'partial',
      reason: 'The Codex turn completed, but the wrapper did not finish writing a final session status.',
      highlights: ['Detected a completed turn without a finalized wrapper status.'],
      next_steps: ['Inspect the session artifacts and re-run if a normalized summary is needed.']
    };
  }

  return null;
}

function extractRunFailureMessages(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return [];
  }

  const messages = [];
  if (event.type === 'error' && typeof event.message === 'string' && event.message.trim()) {
    messages.push(event.message.trim());
  }

  if (event.type === 'turn.failed') {
    if (typeof event.message === 'string' && event.message.trim()) {
      messages.push(event.message.trim());
    }
    if (typeof event.error?.message === 'string' && event.error.message.trim()) {
      const nestedMessage = event.error.message.trim();
      if (!messages.includes(nestedMessage)) {
        messages.push(nestedMessage);
      }
    }
  }

  return messages;
}

async function deriveReviewRepair(cwd, session) {
  const sessionDir = getSessionDir(cwd, session.session_id);
  const reportPath = resolveArtifactPath(session, sessionDir, 'review_report', 'review-report.txt');
  const stderrPath = resolveArtifactPath(session, sessionDir, 'log', 'codex-stderr.log');
  const rawReportText = (await readTextIfExists(reportPath))?.trim() || '';
  const rawStderrText = (await readTextIfExists(stderrPath))?.trim() || '';
  const { reportText, stderrText, hasEmbeddedStderr } = splitReviewArtifact(rawReportText, rawStderrText);

  if (!reportText && !stderrText) {
    return null;
  }

  const exitCode = inferReviewExitCode(reportText, stderrText, hasEmbeddedStderr);
  const summary = buildReviewSummary(
    reportText,
    stderrText,
    exitCode,
    session.codex_cli_version,
    session.input?.arguments || {}
  );

  return {
    from: session.status,
    status: summary.status,
    reason: summary.result,
    summary
  };
}

async function deriveAutoRepair(cwd, session, lineage) {
  const sessionDir = getSessionDir(cwd, session.session_id);
  const autoLogPath = resolveArtifactPath(session, sessionDir, 'auto_log', 'auto-log.txt');
  const autoLogText = (await readTextIfExists(autoLogPath))?.trim() || '';
  const childSessions = await collectAutoChildSessions(cwd, session, lineage);

  if (!childSessions.length) {
    return buildAutoLogOnlyRepair(session, autoLogText);
  }

  const options = readAutoRepairOptions(session);
  const retryCount = inferAutoRetryCount(childSessions, autoLogText);
  const iterationsCompleted = countCompletedAutoIterations(childSessions);
  const lastChild = childSessions.at(-1);
  const repairedChildSessions = childSessions.map((child) => ({
    label: child.repair_label || child.command,
    iteration: getAutoIteration(child),
    command: child.command,
    session_id: child.session_id,
    status: child.status
  }));

  if (lastChild?.status === 'failed') {
    return {
      from: session.status,
      status: 'failed',
      reason: formatAutoFailureResult(lastChild),
      summary: buildAutoFailedSummary({
        child: lastChild,
        iterationsCompleted,
        retryCount,
        childCount: childSessions.length
      }),
      child_sessions: repairedChildSessions,
      iteration_count: iterationsCompleted
    };
  }

  if (!options.shouldRunReview) {
    if (lastChild?.command !== 'run' || lastChild.status !== 'completed') {
      return buildAutoStoppedRepair({
        session,
        childSessions,
        retryCount,
        iterationsCompleted,
        reason: 'Auto workflow stopped before the final run result was recorded.',
        nextStep: 'Inspect the auto session log and latest run child session before resuming.',
        childSessionPayload: repairedChildSessions
      });
    }

    return {
      from: session.status,
      status: 'completed',
      reason: `Run-only unattended workflow completed after ${iterationsCompleted} iteration(s).`,
      summary: buildAutoCompletedSummary({ childCount: childSessions.length, retryCount, iterationsCompleted }),
      child_sessions: repairedChildSessions,
      iteration_count: iterationsCompleted
    };
  }

  const lastReview = [...childSessions].reverse().find((child) => child.command === 'review');
  if (!lastReview || !['completed', 'failed'].includes(lastReview.status)) {
    return buildAutoStoppedRepair({
      session,
      childSessions,
      retryCount,
      iterationsCompleted,
      reason: 'Auto workflow stopped before the review step produced a terminal child session.',
      nextStep: 'Inspect the auto session log and latest run child session before resuming review.',
      childSessionPayload: repairedChildSessions
    });
  }

  const findings = normalizeFindings(lastReview.summary?.findings);
  if (!findings.length) {
    return {
      from: session.status,
      status: 'completed',
      reason: `Unattended workflow completed after ${iterationsCompleted} iteration(s) with no remaining review findings.`,
      summary: buildAutoReviewedCompletionSummary({
        childCount: childSessions.length,
        retryCount,
        iterationsCompleted,
        maxIterations: options.maxIterations
      }),
      child_sessions: repairedChildSessions,
      iteration_count: iterationsCompleted
    };
  }

  const exhaustedIterations = iterationsCompleted >= options.maxIterations;
  const summary = buildAutoRemainingFindingsSummary({
    childCount: childSessions.length,
    retryCount,
    iterationsCompleted,
    maxIterations: options.maxIterations,
    failOnReview: options.failOnReview,
    exhaustedIterations,
    findings
  });

  return {
    from: session.status,
    status: summary.status,
    reason: summary.result,
    summary,
    child_sessions: repairedChildSessions,
    iteration_count: iterationsCompleted
  };
}

function resolveArtifactPath(session, sessionDir, type, fallbackName) {
  const artifact = Array.isArray(session.artifacts)
    ? session.artifacts.find((item) => item?.type === type && typeof item.path === 'string' && item.path)
    : null;

  return artifact?.path || path.join(sessionDir, 'artifacts', fallbackName);
}

function splitReviewArtifact(reportText, stderrText) {
  const normalizedReport = String(reportText || '').trim();
  const normalizedStderr = String(stderrText || '').trim();
  const separator = '\n\nstderr:\n';
  const separatorIndex = normalizedReport.lastIndexOf(separator);

  if (separatorIndex < 0) {
    return {
      reportText: normalizedReport,
      stderrText: normalizedStderr,
      hasEmbeddedStderr: false
    };
  }

  const embeddedReportText = normalizedReport.slice(0, separatorIndex).trim();
  const embeddedStderrText = normalizedReport.slice(separatorIndex + separator.length).trim();

  return {
    reportText: embeddedReportText,
    stderrText: normalizedStderr || embeddedStderrText,
    hasEmbeddedStderr: Boolean(embeddedStderrText)
  };
}

function inferReviewExitCode(reportText, stderrText, hasEmbeddedStderr = false) {
  if (hasEmbeddedStderr) {
    return 1;
  }

  if (!stderrText) {
    return 0;
  }

  if (!reportText || reportText === stderrText) {
    return 1;
  }

  return looksLikeReviewOutput(reportText) ? 0 : 1;
}

function looksLikeReviewOutput(text) {
  const normalizedText = String(text || '').trim();
  if (!normalizedText) {
    return false;
  }

  return normalizedText.startsWith('codex')
    || normalizedText.includes('Full review comments:')
    || /^[-*]\s+\[P\d+\]/m.test(normalizedText);
}

async function collectAutoChildSessions(cwd, session, lineage) {
  const sessions = await listSessions(cwd);
  const childMetadata = new Map(normalizeChildSessions(session.child_sessions).map((child) => [child.session_id, child]));
  const children = sessions
    .filter((candidate) => candidate.parent_session_id === session.session_id || childMetadata.has(candidate.session_id))
    .sort((left, right) => compareSessionCreatedAt(left, right, left?.session_id, right?.session_id));

  const repairedChildren = [];
  for (const child of children) {
    const metadata = childMetadata.get(child.session_id) || {};
    const resolvedChild = await resolveRepairSnapshot(cwd, {
      ...child,
      repair_label: metadata.label || child.command,
      repair_iteration: metadata.iteration
    }, lineage);
    repairedChildren.push(resolvedChild);
  }

  return repairedChildren;
}

async function resolveRepairSnapshot(cwd, session, lineage) {
  if (!shouldRepairStaleSession(session)) {
    return session;
  }

  const repair = await deriveRepair(cwd, session, lineage);
  if (!repair) {
    return session;
  }

  return {
    ...session,
    status: repair.status,
    summary: repair.summary || {
      title: repair.title || 'Session repaired as stale',
      result: repair.reason,
      status: repair.status,
      highlights: repair.highlights,
      next_steps: repair.next_steps,
      findings: []
    },
    child_sessions: Array.isArray(repair.child_sessions) ? repair.child_sessions : session.child_sessions,
    iteration_count: Number.isInteger(repair.iteration_count) ? repair.iteration_count : session.iteration_count
  };
}

function readAutoRepairOptions(session) {
  const argumentsObject = session.input?.arguments || {};
  const maxIterations = parseSessionInteger(argumentsObject['max-iterations'], 1);
  const failOnReview = Boolean(argumentsObject['fail-on-review']);
  const shouldRunReview = Boolean(
    argumentsObject.review
      || argumentsObject.uncommitted
      || argumentsObject.base
      || argumentsObject.commit
      || maxIterations > 1
      || failOnReview
  );

  return { shouldRunReview, maxIterations, failOnReview };
}

function parseSessionInteger(value, fallbackValue) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallbackValue;
}

function countCompletedAutoIterations(childSessions) {
  const iterations = new Set(
    childSessions
      .filter((child) => child.command === 'run' && child.status === 'completed')
      .map((child) => getAutoIteration(child))
  );
  return iterations.size;
}

function inferAutoRetryCount(childSessions, autoLogText) {
  const attemptsByIteration = new Map();
  let retryCount = 0;

  for (const child of childSessions) {
    if (child.command !== 'run') {
      continue;
    }

    if (Number.isInteger(child.auto_attempt)) {
      if (child.auto_attempt > 1) {
        retryCount += 1;
      }
      continue;
    }

    const iteration = getAutoIteration(child);
    attemptsByIteration.set(iteration, (attemptsByIteration.get(iteration) || 0) + 1);
  }

  if (retryCount === 0) {
    for (const attempts of attemptsByIteration.values()) {
      retryCount += Math.max(attempts - 1, 0);
    }
  }

  const logRetryCount = [...String(autoLogText || '').matchAll(/Retrying run after failure/g)].length;
  return Math.max(retryCount, logRetryCount);
}

function getAutoIteration(session) {
  if (Number.isInteger(session.auto_iteration)) {
    return session.auto_iteration;
  }

  if (Number.isInteger(session.repair_iteration)) {
    return session.repair_iteration;
  }

  return 1;
}

function formatAutoFailureResult(child) {
  const childResult = child.summary?.result || `Child session ${child.session_id} failed.`;
  return `Detected failed ${child.command} child session ${child.session_id}: ${childResult}`;
}

function buildAutoFailedSummary({ child, iterationsCompleted, retryCount, childCount }) {
  return {
    title: 'Auto failed',
    result: formatAutoFailureResult(child),
    status: 'failed',
    highlights: [
      `Completed iterations: ${iterationsCompleted}`,
      `Run retries used: ${retryCount}`,
      `Child sessions recorded: ${childCount}`,
      `Failed child session: ${child.session_id}`
    ],
    next_steps: ['Inspect the auto session log and child sessions to continue from the last stable point.'],
    findings: normalizeFindings(child.summary?.findings)
  };
}

function buildAutoCompletedSummary({ childCount, retryCount, iterationsCompleted }) {
  return {
    title: 'Auto completed',
    result: `Run-only unattended workflow completed after ${iterationsCompleted} iteration(s).`,
    status: 'completed',
    highlights: [
      `Child sessions recorded: ${childCount}`,
      `Run retries used: ${retryCount}`,
      'No review step was requested.'
    ],
    next_steps: ['Inspect the latest run session if more local work is needed.'],
    findings: []
  };
}

function buildAutoReviewedCompletionSummary({ childCount, retryCount, iterationsCompleted, maxIterations }) {
  return {
    title: 'Auto completed',
    result: `Unattended workflow completed after ${iterationsCompleted} iteration(s) with no remaining review findings.`,
    status: 'completed',
    highlights: [
      `Child sessions recorded: ${childCount}`,
      `Run retries used: ${retryCount}`,
      `Max iterations: ${maxIterations}`,
      'Final review finished clean.'
    ],
    next_steps: ['Inspect the final run and review sessions if you want a detailed audit trail.'],
    findings: []
  };
}

function buildAutoRemainingFindingsSummary({ childCount, retryCount, iterationsCompleted, maxIterations, failOnReview, exhaustedIterations, findings }) {
  return {
    title: failOnReview ? 'Auto failed' : 'Auto partial',
    result: exhaustedIterations
      ? `Auto workflow stopped after ${iterationsCompleted} iteration(s) with ${findings.length} remaining review finding(s).`
      : `Auto workflow stopped after ${iterationsCompleted} iteration(s); ${findings.length} review finding(s) remain before the next unattended pass.`,
    status: failOnReview ? 'failed' : 'partial',
    highlights: [
      `Child sessions recorded: ${childCount}`,
      `Run retries used: ${retryCount}`,
      exhaustedIterations ? `Max iterations reached: ${maxIterations}` : `Next iteration pending: ${iterationsCompleted + 1}`,
      `Remaining findings: ${findings.length}`
    ],
    next_steps: [
      exhaustedIterations
        ? 'Increase `--max-iterations` or continue with a follow-up auto run.'
        : 'Resume the auto workflow to continue from the latest completed review.',
      failOnReview
        ? 'Resolve the remaining review findings before treating this workflow as successful.'
        : 'Inspect the remaining review findings before the next unattended pass.'
    ],
    findings
  };
}

function buildAutoStoppedRepair({ session, childSessions, retryCount, iterationsCompleted, reason, nextStep, childSessionPayload }) {
  const findings = normalizeFindings(childSessions.at(-1)?.summary?.findings || session.summary?.findings);
  return {
    from: session.status,
    status: 'partial',
    reason,
    summary: {
      title: 'Auto partial',
      result: reason,
      status: 'partial',
      highlights: [
        `Child sessions recorded: ${childSessions.length}`,
        `Run retries used: ${retryCount}`,
        `Completed iterations: ${iterationsCompleted}`
      ],
      next_steps: [nextStep],
      findings
    },
    child_sessions: childSessionPayload,
    iteration_count: iterationsCompleted
  };
}

function buildAutoLogOnlyRepair(session, autoLogText) {
  const lastStep = extractLastAutoStep(autoLogText);
  if (!lastStep) {
    return null;
  }

  const reason = `Auto workflow stopped after step: ${lastStep}.`;
  return {
    from: session.status,
    status: 'partial',
    reason,
    summary: {
      title: 'Auto partial',
      result: reason,
      status: 'partial',
      highlights: [
        'Recovered from auto-log artifact.',
        `Last recorded step: ${lastStep}`
      ],
      next_steps: ['Inspect the auto session log and child sessions before resuming the workflow.'],
      findings: normalizeFindings(session.summary?.findings)
    },
    iteration_count: Number.isInteger(session.iteration_count) ? session.iteration_count : 0
  };
}

function extractLastAutoStep(autoLogText) {
  const matches = [...String(autoLogText || '').matchAll(/^==>\s+(.+)$/gm)];
  return matches.at(-1)?.[1]?.trim() || '';
}

function normalizeFindings(findings) {
  return Array.isArray(findings) ? findings : [];
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function isOlderThan(isoTimestamp, minutes) {
  const ageMs = Date.now() - new Date(isoTimestamp).getTime();
  return ageMs >= Math.max(minutes, 0) * 60 * 1000;
}

function outputSession(session, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(session, null, 2)}\n`);
    return;
  }
  process.stdout.write(renderHumanSummary(session.summary));
  process.stdout.write(`\nSession: ${session.session_id}\n`);
  if (session.artifacts?.length) {
    process.stdout.write('\nArtifacts:\n');
    for (const artifact of session.artifacts) {
      process.stdout.write(`- ${artifact.type}: ${artifact.path}\n`);
    }
  }
}

function outputSessionTree(tree, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(tree, null, 2)}\n`);
    return;
  }

  const lines = [];
  renderSessionTree(tree, '', true, lines);
  process.stdout.write(`${lines.join('\n')}\n`);
}

function renderSessionTree(node, prefix, isLastChild, lines) {
  const label = `${node.session_id}  ${node.command}  ${node.status}`;
  if (!prefix) {
    lines.push(label);
  } else {
    lines.push(`${prefix}${isLastChild ? '└─ ' : '├─ '}${label}`);
  }

  const childPrefix = prefix + (isLastChild ? '   ' : '│  ');
  node.children.forEach((child, index) => {
    renderSessionTree(child, childPrefix, index === node.children.length - 1, lines);
  });
}
