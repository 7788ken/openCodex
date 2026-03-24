import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORE_FILE = path.join(__dirname, "codex-task-state.json");
const TASK_SYNC_BLOCK_PATTERN = /<oc_task_state>\s*(\{[\s\S]*?\})\s*<\/oc_task_state>\s*$/i;
const ALLOWED_STATUSES = new Set([
  "pending",
  "running",
  "waiting",
  "completed",
  "blocked",
  "cancelled",
]);
const MAX_LONG_TASKS = 6;
const MAX_SHORT_TASKS = 10;

const taskStore = loadTaskStore();

function loadTaskStore() {
  try {
    if (!fs.existsSync(STORE_FILE)) return {};
    return JSON.parse(fs.readFileSync(STORE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveTaskStore() {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(taskStore, null, 2), "utf-8");
  } catch {
    // Ignore persistence failures and keep the channel usable.
  }
}

export function getUserTaskState(userId) {
  return normalizeStoredTaskState(taskStore[userId]);
}

export function updateUserTaskState(userId, payload, meta = {}) {
  const currentState = getUserTaskState(userId);
  const nextState = mergeUserTaskState(currentState, payload, meta);
  taskStore[userId] = nextState;
  saveTaskStore();
  return nextState;
}

export function mergeUserTaskState(currentState, payload, meta = {}) {
  const nextState = {
    ...normalizeStoredTaskState(currentState),
    updated_at: new Date().toISOString(),
  };

  const normalizedPayload = normalizeTaskSyncPayload(payload);
  if (normalizedPayload) {
    nextState.focus = normalizedPayload.focus;
    nextState.long_tasks = normalizedPayload.long_tasks;
    nextState.short_tasks = normalizedPayload.short_tasks;
  }

  if (typeof meta.lastUserMessage === "string" && meta.lastUserMessage.trim()) {
    nextState.last_user_message = meta.lastUserMessage.trim();
  }
  if (typeof meta.lastAssistantReply === "string" && meta.lastAssistantReply.trim()) {
    nextState.last_assistant_reply = meta.lastAssistantReply.trim();
  }

  return nextState;
}

export function splitAssistantReply(text) {
  const rawText = String(text || "");
  const match = rawText.match(TASK_SYNC_BLOCK_PATTERN);
  if (!match) {
    return {
      visibleText: rawText.trim(),
      taskState: null,
    };
  }

  const visibleText = rawText.replace(TASK_SYNC_BLOCK_PATTERN, "").trim();
  let parsed = null;

  try {
    parsed = JSON.parse(match[1]);
  } catch {
    parsed = null;
  }

  return {
    visibleText,
    taskState: normalizeTaskSyncPayload(parsed),
  };
}

export function normalizeTaskSyncPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  return {
    focus: typeof payload.focus === "string" ? payload.focus.trim() : "",
    long_tasks: normalizeTaskList(payload.long_tasks, { maxItems: MAX_LONG_TASKS, fallbackStatus: "running" }),
    short_tasks: normalizeTaskList(payload.short_tasks, { maxItems: MAX_SHORT_TASKS, fallbackStatus: "pending" }),
  };
}

export function buildTaskLedgerContext(taskState) {
  const normalizedState = normalizeStoredTaskState(taskState);
  return JSON.stringify({
    focus: normalizedState.focus,
    long_tasks: normalizedState.long_tasks,
    short_tasks: normalizedState.short_tasks,
    last_user_message: normalizedState.last_user_message,
  }, null, 2);
}

function normalizeStoredTaskState(value) {
  const normalizedPayload = normalizeTaskSyncPayload(value) || {
    focus: "",
    long_tasks: [],
    short_tasks: [],
  };

  return {
    updated_at: typeof value?.updated_at === "string" && value.updated_at.trim()
      ? value.updated_at.trim()
      : "",
    focus: normalizedPayload.focus,
    long_tasks: normalizedPayload.long_tasks,
    short_tasks: normalizedPayload.short_tasks,
    last_user_message: typeof value?.last_user_message === "string" ? value.last_user_message.trim() : "",
    last_assistant_reply: typeof value?.last_assistant_reply === "string" ? value.last_assistant_reply.trim() : "",
  };
}

function normalizeTaskList(tasks, { maxItems, fallbackStatus }) {
  if (!Array.isArray(tasks)) {
    return [];
  }

  return tasks
    .map((task) => normalizeTaskEntry(task, fallbackStatus))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeTaskEntry(task, fallbackStatus) {
  if (!task || typeof task !== "object" || Array.isArray(task)) {
    return null;
  }

  const title = typeof task.title === "string" ? task.title.trim() : "";
  if (!title) {
    return null;
  }

  const normalizedStatus = normalizeStatus(task.status, fallbackStatus);
  const id = typeof task.id === "string" && task.id.trim()
    ? slugifyTaskId(task.id)
    : slugifyTaskId(title);

  return {
    id,
    title,
    status: normalizedStatus,
    summary: typeof task.summary === "string" ? task.summary.trim() : "",
    next_step: typeof task.next_step === "string" ? task.next_step.trim() : "",
    updated_at: typeof task.updated_at === "string" && task.updated_at.trim()
      ? task.updated_at.trim()
      : new Date().toISOString(),
  };
}

function normalizeStatus(value, fallbackStatus) {
  const candidate = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (ALLOWED_STATUSES.has(candidate)) {
    return candidate;
  }
  return fallbackStatus;
}

function slugifyTaskId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "task";
}
