import os from 'node:os';
import path from 'node:path';
import { listDirectories, pathExists, readJson } from './fs.js';
import { listSessions, isTerminalSessionStatus, getSessionDir } from './session-store.js';
import { listRegisteredWorkspaces } from './workspace-registry.js';

const DONE_WINDOW_MS = 10 * 60 * 1000;

export async function collectGlobalIslandStatus(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const homeDir = path.resolve(options.homeDir || os.homedir());
  const workspaces = await discoverGlobalWorkspaces({ cwd, homeDir });
  const enrichedSessions = [];

  for (const workspace of workspaces) {
    const sessions = await listSessions(workspace.cwd);
    for (const session of sessions) {
      enrichedSessions.push(await enrichSessionForIsland(session, workspace.cwd));
    }
  }

  enrichedSessions.sort((left, right) => String(right.updated_at || '').localeCompare(String(left.updated_at || '')));
  const taskSessions = enrichedSessions.filter((session) => !isPassiveOperationalSession(session));
  const waitingSessions = taskSessions.filter((session) => session.display_status === 'waiting');
  const runningSessions = taskSessions.filter((session) => session.display_status === 'running');
  const activeSessions = taskSessions.filter((session) => !isTerminalSessionStatus(session.display_status));
  const latestCompleted = taskSessions.find((session) => session.display_status === 'completed') || null;
  const latestCompletedIsRecent = latestCompleted ? isRecentTimestamp(latestCompleted.updated_at, DONE_WINDOW_MS) : false;
  const focusSession = waitingSessions[0] || runningSessions[0] || (latestCompletedIsRecent ? latestCompleted : taskSessions[0] || null);
  const state = waitingSessions.length > 0
    ? 'attention'
    : runningSessions.length > 0 || activeSessions.length > 0
      ? 'active'
      : latestCompletedIsRecent
        ? 'done'
        : 'idle';

  return {
    ok: true,
    state,
    title: buildIslandTitle(state, { activeCount: activeSessions.length, waitingCount: waitingSessions.length }),
    subtitle: buildIslandSubtitle(state, { activeCount: activeSessions.length, waitingCount: waitingSessions.length, runningCount: runningSessions.length, workspaceCount: workspaces.length }),
    detail: buildIslandDetail(state, focusSession),
    pending_messages: waitingSessions.map(buildIslandPendingMessagePayload),
    updated_at: new Date().toISOString(),
    counts: {
      workspaces_count: workspaces.length,
      known_sessions_count: enrichedSessions.length,
      task_sessions_count: taskSessions.length,
      active_count: activeSessions.length,
      waiting_count: waitingSessions.length,
      running_count: runningSessions.length
    },
    focus: focusSession ? buildIslandFocusPayload(focusSession) : null,
    workspaces
  };
}

export async function discoverGlobalWorkspaces(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const homeDir = path.resolve(options.homeDir || os.homedir());
  const workspaceMap = new Map();

  await addWorkspaceCandidate(workspaceMap, cwd);

  const defaultWorkspacesRoot = path.join(homeDir, '.opencodex', 'workspaces');
  if (await pathExists(defaultWorkspacesRoot)) {
    for (const name of await listDirectories(defaultWorkspacesRoot)) {
      await addWorkspaceCandidate(workspaceMap, path.join(defaultWorkspacesRoot, name));
    }
  }

  for (const registered of await listRegisteredWorkspaces({ homeDir })) {
    await addWorkspaceCandidate(workspaceMap, registered.cwd);
  }

  const telegramServiceConfigPath = path.join(homeDir, '.opencodex', 'service', 'telegram', 'service.json');
  try {
    const serviceConfig = await readJson(telegramServiceConfigPath);
    if (typeof serviceConfig?.cwd === 'string' && serviceConfig.cwd) {
      await addWorkspaceCandidate(workspaceMap, serviceConfig.cwd);
    }
  } catch {
  }

  return [...workspaceMap.values()].sort((left, right) => left.cwd.localeCompare(right.cwd));
}

async function addWorkspaceCandidate(workspaceMap, cwd) {
  const normalizedCwd = typeof cwd === 'string' && cwd.trim()
    ? path.resolve(cwd.trim())
    : '';
  if (!normalizedCwd || workspaceMap.has(normalizedCwd)) {
    return;
  }
  const sessionsRoot = path.join(normalizedCwd, '.opencodex', 'sessions');
  if (!(await pathExists(sessionsRoot))) {
    return;
  }
  workspaceMap.set(normalizedCwd, {
    cwd: normalizedCwd,
    sessions_root: sessionsRoot
  });
}

async function enrichSessionForIsland(session, workspaceCwd) {
  const workflowState = await loadWorkflowState(workspaceCwd, session);
  const displayStatus = normalizeIslandSessionStatus(session, workflowState);
  const pendingQuestion = typeof workflowState?.pending_question_zh === 'string' ? workflowState.pending_question_zh.trim() : '';
  const title = resolveIslandSessionTitle(session, workflowState);
  const detail = resolveIslandSessionDetail(session, workflowState, pendingQuestion);
  return {
    ...session,
    workspace_cwd: workspaceCwd,
    display_status: displayStatus,
    pending_question: pendingQuestion,
    island_title: title,
    island_detail: detail,
    updated_at: resolveIslandUpdatedAt(session, workflowState),
    workflow_state: workflowState || null,
    session_path: path.join(getSessionDir(workspaceCwd, session.session_id), 'session.json')
  };
}

async function loadWorkflowState(cwd, session) {
  if (session?.workflow_state && typeof session.workflow_state === 'object') {
    return session.workflow_state;
  }

  const artifactPath = Array.isArray(session?.artifacts)
    ? session.artifacts.find((item) => item?.type === 'cto_workflow' && typeof item?.path === 'string' && item.path)?.path
    : '';
  const candidates = [
    artifactPath,
    path.join(getSessionDir(cwd, session.session_id), 'artifacts', 'cto-workflow.json')
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return await readJson(candidate);
    } catch {
    }
  }
  return null;
}

function normalizeIslandSessionStatus(session, workflowState) {
  const workflowStatus = String(workflowState?.status || '').trim();
  if (workflowStatus === 'waiting_for_user') {
    return 'waiting';
  }
  if (workflowStatus) {
    return workflowStatus === 'partial' ? 'partial' : workflowStatus;
  }
  const sessionStatus = String(session?.status || '').trim();
  if (sessionStatus === 'partial' && String(workflowState?.pending_question_zh || '').trim()) {
    return 'waiting';
  }
  return sessionStatus || 'unknown';
}

function resolveIslandSessionTitle(session, workflowState) {
  const workflowGoal = typeof workflowState?.goal_text === 'string' ? workflowState.goal_text.trim() : '';
  const summaryTitle = typeof session?.summary?.title === 'string' ? session.summary.title.trim() : '';
  const prompt = typeof session?.input?.prompt === 'string' ? session.input.prompt.trim() : '';
  return workflowGoal || summaryTitle || prompt || `${session?.command || 'session'} task`;
}

function resolveIslandSessionDetail(session, workflowState, pendingQuestion) {
  if (pendingQuestion) {
    return pendingQuestion;
  }
  const result = typeof session?.summary?.result === 'string' ? session.summary.result.trim() : '';
  if (result) {
    return result;
  }
  return typeof workflowState?.goal_text === 'string' ? workflowState.goal_text.trim() : '';
}

function resolveIslandUpdatedAt(session, workflowState) {
  if (typeof workflowState?.updated_at === 'string' && workflowState.updated_at) {
    return workflowState.updated_at;
  }
  if (typeof session?.updated_at === 'string' && session.updated_at) {
    return session.updated_at;
  }
  return session?.created_at || '';
}

function isPassiveOperationalSession(session) {
  if (session?.command !== 'im') {
    return false;
  }
  return !String(session?.input?.prompt || '').trim();
}

function buildIslandTitle(state, counts) {
  if (state === 'attention') {
    return `Codex • ${counts.waitingCount} waiting`;
  }
  if (state === 'active') {
    return `Codex • ${counts.activeCount} active`;
  }
  if (state === 'done') {
    return 'Codex • done';
  }
  return 'Codex';
}

function buildIslandSubtitle(state, counts) {
  if (state === 'attention') {
    return `${counts.runningCount} running across ${counts.workspaceCount} workspace(s)`;
  }
  if (state === 'active') {
    return `${counts.runningCount} running across ${counts.workspaceCount} workspace(s)`;
  }
  if (state === 'done') {
    return `Watching ${counts.workspaceCount} workspace(s)`;
  }
  return counts.workspaceCount > 0
    ? `Watching ${counts.workspaceCount} workspace(s)`
    : 'No known task workspace yet';
}

function buildIslandDetail(state, focusSession) {
  if (!focusSession) {
    return state === 'idle' ? 'No active Codex task.' : 'Waiting for the next update.';
  }
  return focusSession.island_detail || focusSession.island_title;
}

function buildIslandFocusPayload(session) {
  return {
    session_id: session.session_id,
    command: session.command || '',
    display_status: session.display_status,
    title: session.island_title,
    detail: session.island_detail,
    pending_question: session.pending_question || '',
    updated_at: session.updated_at || '',
    workspace_cwd: session.workspace_cwd,
    session_path: session.session_path
  };
}

function buildIslandPendingMessagePayload(session) {
  return {
    session_id: session.session_id,
    title: session.island_title,
    detail: session.island_detail,
    pending_question: session.pending_question || '',
    updated_at: session.updated_at || '',
    workspace_cwd: session.workspace_cwd
  };
}

function isRecentTimestamp(value, windowMs) {
  const timestamp = Date.parse(String(value || ''));
  if (!Number.isFinite(timestamp)) {
    return false;
  }
  return Date.now() - timestamp <= windowMs;
}
