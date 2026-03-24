import fs from "fs";
import path from "path";
import net from "net";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import {
  buildTaskLedgerContext,
  getUserTaskState,
  splitAssistantReply,
  updateUserTaskState,
} from "./task-state.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TIMEOUT_MS = 120_000;
const STORE_FILE = path.join(__dirname, "codex-threads.json");
const APP_SERVER_HOST = "127.0.0.1";
const DEFAULT_MODEL = process.env.CODEX_MODEL || "gpt-5-codex";

let child = null;
let ws = null;
let connectionPromise = null;
let requestId = 1;
const pending = new Map();
const notificationListeners = new Set();

const threadStore = loadThreadStore();

function log(msg) {
  process.stderr.write(`[codex-session] ${msg}\n`);
}

function loadThreadStore() {
  try {
    if (!fs.existsSync(STORE_FILE)) return {};
    return JSON.parse(fs.readFileSync(STORE_FILE, "utf-8"));
  } catch (err) {
    log(`读取 thread store 失败，改用空状态: ${String(err)}`);
    return {};
  }
}

function saveThreadStore() {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(threadStore, null, 2), "utf-8");
  } catch (err) {
    log(`写入 thread store 失败: ${String(err)}`);
  }
}

function buildTurnInput(userMessage, taskState) {
  return [
    "[内部上下文，不能直接复述给用户]",
    "你现在通过微信与同一个用户持续对话。",
    "目标有两个：",
    "1. 先像得力助手一样说人话，直接回答，不要像工单系统。",
    "2. 维护长期主线任务(long_tasks)和临时短任务(short_tasks)两套账本。",
    "默认不要输出“交付摘要 / 关键改动 / 验证记录 / 风险提醒”这类模板化标题，除非用户明确要求。",
    "如果用户是在追问、抱怨、确认、讨论或闲聊，先自然回应，再决定是否推进任务。",
    "回复正文结束后，必须追加一段内部同步块，格式固定为：<oc_task_state>{...}</oc_task_state>",
    "同步块中的 JSON 必须包含 long_tasks 和 short_tasks 两个数组，以及可选的 focus 字段。",
    "long_tasks 只保留跨多轮、持续推进的主线任务；short_tasks 只保留当前或最近需要跟进的临时动作。",
    "任务状态只允许：pending、running、waiting、completed、blocked、cancelled。",
    "同步块不要解释，不要加 Markdown，不要加代码围栏。系统会自动截走它，用户只会看到前面的正文。",
    "当前任务账本：",
    buildTaskLedgerContext(taskState),
    "[用户消息开始]",
    userMessage,
    "[用户消息结束]",
  ].join("\n");
}

function resetConnectionState(error) {
  if (ws) {
    try {
      ws.close();
    } catch {}
  }
  ws = null;
  connectionPromise = null;
  notificationListeners.clear();

  for (const [, entry] of pending) {
    entry.reject(error);
  }
  pending.clear();
}

function cleanupChild() {
  if (!child) return;
  try {
    child.kill("SIGTERM");
  } catch {}
  child = null;
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, APP_SERVER_HOST, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((err) => {
        if (err) return reject(err);
        if (!port) return reject(new Error("无法获取空闲端口"));
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

async function ensureServer() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    return;
  }
  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = (async () => {
    const port = await getFreePort();
    const url = `ws://${APP_SERVER_HOST}:${port}`;

    child = spawn("codex", ["app-server", "--listen", url], {
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (data) => {
      const text = data.toString().trim();
      if (text) log(`[app-server] ${text}`);
    });

    child.stderr.on("data", (data) => {
      const text = data.toString().trim();
      if (text) log(`[app-server] ${text}`);
    });

    child.once("exit", (code, signal) => {
      const err = new Error(`codex app-server 已退出 (code=${code}, signal=${signal})`);
      resetConnectionState(err);
      child = null;
    });

    await connectWebSocket(url);
    await sendRequest("initialize", {
      clientInfo: {
        name: "wechat-agent-channel",
        title: "WeChat Agent Channel",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
  })();

  try {
    await connectionPromise;
  } catch (err) {
    cleanupChild();
    resetConnectionState(err);
    throw err;
  } finally {
    connectionPromise = null;
  }
}

async function connectWebSocket(url) {
  let lastError = null;

  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        const socket = new WebSocket(url);

        socket.onopen = () => {
          ws = socket;
          attachSocketHandlers(socket);
          resolve();
        };

        socket.onerror = () => {
          socket.close();
          reject(new Error(`连接 ${url} 失败`));
        };
      });
      return;
    } catch (err) {
      lastError = err;
      await sleep(250);
    }
  }

  throw lastError || new Error(`连接 ${url} 超时`);
}

function attachSocketHandlers(socket) {
  socket.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data.toString());
    } catch (err) {
      log(`收到无法解析的消息: ${String(err)}`);
      return;
    }

    if (msg.id !== undefined) {
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);

      if (msg.error) {
        entry.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      } else {
        entry.resolve(msg.result);
      }
      return;
    }

    for (const listener of notificationListeners) {
      try {
        listener(msg);
      } catch (err) {
        log(`通知监听器异常: ${String(err)}`);
      }
    }
  };

  socket.onclose = () => {
    if (ws === socket) {
      resetConnectionState(new Error("Codex app-server 连接已关闭"));
    }
  };
}

function sendRequest(method, params, { timeoutMs = TIMEOUT_MS } = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("Codex app-server 未连接"));
  }

  const id = requestId++;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} 超时`));
    }, timeoutMs);

    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });

    ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  });
}

async function ensureThread(userId) {
  const existingThreadId = threadStore[userId];
  if (existingThreadId) {
    return existingThreadId;
  }

  const result = await sendRequest("thread/start", {
    cwd: process.cwd(),
    model: DEFAULT_MODEL,
    approvalPolicy: "never",
    experimentalRawEvents: false,
    persistExtendedHistory: true,
    developerInstructions: [
      "你通过微信与用户交流。",
      "默认用中文回复，除非用户明确使用其他语言。",
      "把自己当成用户的长期得力助手，不要像机器人或工单分发器。",
      "默认直接说人话，短句、自然、能听懂；除非用户要求，否则不要用模板化小标题和报告体。",
      "先理解用户是在聊天、追问、抱怨、讨论，还是明确下任务；不要动不动就摆出流程化汇报。",
      "如果用户在问进度或回看历史，优先基于当前已知任务账本回答，不要假装不知道。",
      "内部要维护长任务和短任务两类状态，并在每次回复末尾追加 `<oc_task_state>{...}</oc_task_state>` 同步块。",
      "微信不渲染 Markdown，尽量输出纯文本。",
    ].join("\n"),
  });

  const threadId = result?.thread?.id;
  if (!threadId) {
    throw new Error("thread/start 未返回 threadId");
  }

  threadStore[userId] = threadId;
  saveThreadStore();
  return threadId;
}

function buildTurnResult(state) {
  const text = state.messageOrder
    .map((itemId) => state.messages.get(itemId) || "")
    .join("")
    .trim();

  if (text) return text;
  if (state.error) return `❌ Codex 执行失败：${state.error}`;
  return "Codex 已完成，但没有返回可发送的文本。";
}

async function startTurn(threadId, userMessage, taskState) {
  const state = {
    messages: new Map(),
    messageOrder: [],
    error: "",
  };

  let currentTurnId = null;

  return new Promise(async (resolve, reject) => {
    const timer = setTimeout(() => {
      notificationListeners.delete(onNotification);
      reject(new Error("等待 turn/completed 超时"));
    }, TIMEOUT_MS);

    const finish = (fn, value) => {
      clearTimeout(timer);
      notificationListeners.delete(onNotification);
      fn(value);
    };

    const onNotification = (msg) => {
      const params = msg.params || {};
      if (params.threadId !== threadId) return;
      if (currentTurnId && params.turnId && params.turnId !== currentTurnId) return;

      if (msg.method === "item/agentMessage/delta") {
        const itemId = params.itemId;
        if (!state.messages.has(itemId)) {
          state.messages.set(itemId, "");
          state.messageOrder.push(itemId);
        }
        state.messages.set(itemId, state.messages.get(itemId) + (params.delta || ""));
        return;
      }

      if (msg.method === "item/completed" && params.item?.type === "agentMessage") {
        const itemId = params.item.id;
        if (!state.messages.has(itemId)) {
          state.messageOrder.push(itemId);
        }
        state.messages.set(itemId, params.item.text || state.messages.get(itemId) || "");
        return;
      }

      if (msg.method === "error") {
        state.error = params.error?.message || "未知错误";
        return;
      }

      if (msg.method === "turn/completed") {
        finish(resolve, buildTurnResult(state));
      }
    };

    notificationListeners.add(onNotification);

    try {
      const result = await sendRequest("turn/start", {
        threadId,
        input: [
          {
            type: "text",
            text: buildTurnInput(userMessage, taskState),
            text_elements: [],
          },
        ],
      });
      currentTurnId = result?.turn?.id || null;
    } catch (err) {
      finish(reject, err);
    }
  });
}

async function runOnce(userId, userMessage) {
  await ensureServer();
  const threadId = await ensureThread(userId);
  const taskState = getUserTaskState(userId);
  const rawReply = await startTurn(threadId, userMessage, taskState);
  const { visibleText, taskState: nextTaskState } = splitAssistantReply(rawReply);
  const finalReply = visibleText || "我在。你继续说，我按这条主线接着跟。";
  updateUserTaskState(userId, nextTaskState, {
    lastUserMessage: userMessage,
    lastAssistantReply: finalReply,
  });
  return finalReply;
}

export async function run(userId, userMessage) {
  try {
    return await runOnce(userId, userMessage);
  } catch (err) {
    log(`首次执行失败，尝试重建线程: ${String(err)}`);
    delete threadStore[userId];
    saveThreadStore();

    try {
      return await runOnce(userId, userMessage);
    } catch (retryErr) {
      return `❌ Codex 执行失败：${retryErr.message || String(retryErr)}`;
    }
  }
}

export function clearSession(userId) {
  delete threadStore[userId];
  saveThreadStore();
}

export function getSessionStats() {
  const stats = {};
  for (const [userId, threadId] of Object.entries(threadStore)) {
    stats[userId.split("@")[0]] = threadId;
  }
  return stats;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

for (const signal of ["SIGINT", "SIGTERM", "exit"]) {
  process.on(signal, () => {
    cleanupChild();
  });
}
