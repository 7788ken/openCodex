import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTextIfExists } from './fs.js';

export const CTO_PLANNER_SCHEMA_PATH = fileURLToPath(new URL('../../schemas/cto-workflow-plan.schema.json', import.meta.url));
export const DEFAULT_CTO_SOUL_RELATIVE_PATH = path.join('prompts', 'cto-soul.md');
export const DEFAULT_CTO_HISTORY_REPAIR_STALE_MINUTES = 30;

const MAX_TASKS = 4;
const CTO_HISTORY_REPAIR_TASK_ID = 'repair-historical-workflows';
const MAX_TITLE_LENGTH = 72;
const TELEGRAM_GENERIC_ACK_TOKENS = new Set([
  'ok',
  'okay',
  'cool',
  'great',
  'nice',
  '收到',
  '明白',
  '了解',
  '好',
  '好的',
  '好啊',
  '很好',
  '可以',
  '行',
  '嗯',
  '嗯嗯',
  '加油',
  '辛苦了',
  '谢谢'
]);
const TELEGRAM_EXECUTION_HINT_PATTERN = /(继续|推进|安排|检查|修复|处理|分析|实现|开发|发布|上线|review|fix|inspect|check|continue|ship|deploy|implement|build|plan|task)/i;
const TELEGRAM_ANALYSIS_INTENT_PATTERN = /(检查|审查|review|inspect|audit|分析|评估|evaluate|analyze|看看|诊断|研究|拆解)/i;
const TELEGRAM_REASONING_TARGET_PATTERN = /(思考|思维|推理|reasoning|深度|质量|判断|决策)/i;
const TELEGRAM_ARCHITECTURE_TARGET_PATTERN = /(架构|workflow|工作流|主线程|子线程|调度|planner|prompt|session|任务栏|telegram|cto)/i;
const TELEGRAM_CTO_CASUAL_CHAT_PATTERN = /(陪我聊聊天|陪聊|聊聊天|聊会儿|聊天吗|可以聊天吗|能聊天吗|陪我说说话|随便聊聊|你在哪|人呢|在干嘛|忙吗)/i;
const TELEGRAM_CTO_GREETING_PATTERN = /^(?:(?:cto|open\s*codex|opencodex)[,，:：\s]*)?(?:嘿|嗨|哈喽|哈啰|你在吗|在吗|在不|在嘛|你好|hello|hi|hey|yo|早上好|晚上好|午安|辛苦了)(?:[!！?？~～\s]*)$/i;
const TELEGRAM_CTO_STATUS_HINT_PATTERN = /(状态|进度|历史|最近任务|任务历史|workflow|工作流|task\s*history|workflow\s*status|task\s*status|安排了哪些任务)/i;
const TELEGRAM_CTO_EXPLORATION_PATTERN = /(探讨|讨论|聊聊(?:架构|方案|思路|方向|路线)?|研究一下|研究下|一起想想|脑暴|brainstorm|trade[- ]?off|方案对比|路线对比|可行性|怎么设计|怎么看|为什么|why)/i;
const TELEGRAM_FORCE_EXECUTION_PATTERN = /(直接推进|直接开始|马上开始|立刻处理|现在就做|安排员工|进入编排|开始执行|马上执行|立即执行|go\s*ahead|execute\s*now|start\s*working|ship\s*it)/i;
const TELEGRAM_WORK_OBJECT_PATTERN = /(repo|code|bug|issue|test|ui|workflow|telegram|wechat|tray|session|service|prompt|agent|review|fix|build|docs?|readme|todo|roadmap|代码|仓库|任务|工作流|文档|架构|测试|修复|实现|功能|界面|命令|续跑|手机|微信)/i;
const TELEGRAM_CTO_EXPLICIT_CONTINUE_PATTERN = /^(?:(?:好|好的|行|可以|确认|收到|明白)[，,\s]*)?(?:继续|继续吧|继续推进|继续处理|继续执行|继续做|开始吧|开始执行|开始处理|按你说的做|照这个做|就这么做|就这样做|重建当前工作流|重新派发(?:该)?任务|继续调整当前工作流)(?:[。.!！?？~～\s]*)$/i;
const TELEGRAM_CTO_DECISION_REPLY_PATTERN = /^(?:是|否|可以|不可以|要|不要|继续|重建|重派|重新派发|先别|先不要|改吧|就这样)(?:[。.!！?？~～\s]|$)/i;
const TELEGRAM_SHORT_CASUAL_TEXTS = new Set([
  '嘿', '嗨', '哈喽', '哈啰', 'hello', 'hi', 'hey', 'yo',
  '在吗', '你在吗', '在不', '在嘛', '你好', '辛苦了', '早', '早安', '午安', '晚安'
]);

export function isLikelyTelegramNonDirectiveMessage(text) {
  const rawText = String(text || '').trim();
  if (!rawText) {
    return true;
  }

  if (TELEGRAM_EXECUTION_HINT_PATTERN.test(rawText)) {
    return false;
  }

  const tokens = rawText
    .toLowerCase()
    .split(/[\s,，。.!！?？、;；:：\-—]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (!tokens.length) {
    return true;
  }

  return tokens.every((token) => TELEGRAM_GENERIC_ACK_TOKENS.has(token));
}

export function shouldPromoteWorkflowGoal(workflowState, message) {
  const nextText = String(message?.text || '').trim();
  if (!nextText) {
    return false;
  }

  const currentGoal = String(workflowState?.goal_text || '').trim();
  if (!currentGoal) {
    return true;
  }

  return isLikelyTelegramNonDirectiveMessage(currentGoal)
    && !isLikelyTelegramNonDirectiveMessage(nextText);
}

export function shouldResumeTelegramPendingWorkflow({ workflowState, messageText }) {
  const rawText = String(messageText || '').trim();
  if (!workflowState || workflowState.status !== 'waiting_for_user' || !rawText) {
    return false;
  }

  if (isLikelyTelegramNonDirectiveMessage(rawText)) {
    return false;
  }

  if (TELEGRAM_CTO_EXPLICIT_CONTINUE_PATTERN.test(rawText)) {
    return true;
  }

  const pendingQuestion = asTrimmedString(workflowState.pending_question_zh);
  if (!pendingQuestion) {
    return false;
  }

  if (TELEGRAM_CTO_DECISION_REPLY_PATTERN.test(rawText)) {
    return true;
  }

  return extractTelegramQuestionHints(pendingQuestion)
    .some((hint) => rawText.toLowerCase().includes(hint));
}

export function createTelegramWorkflowState({ workflowSessionId, relatedWorkflowId = '', message }) {
  return {
    workflow_session_id: workflowSessionId,
    related_workflow_id: relatedWorkflowId,
    provider: 'telegram',
    chat_id: message.chat_id,
    source_update_id: message.update_id,
    source_message_id: message.message_id,
    sender_display: message.sender_display,
    goal_text: message.text,
    latest_user_message: message.text,
    created_at: message.created_at,
    updated_at: message.created_at,
    status: 'planning',
    plan_mode: 'execute',
    plan_summary_zh: '',
    pending_question_zh: '',
    task_counter: 0,
    tasks: [],
    user_messages: [
      {
        update_id: message.update_id,
        message_id: message.message_id,
        text: message.text,
        created_at: message.created_at
      }
    ]
  };
}

export function appendWorkflowUserMessage(workflowState, message) {
  if (shouldPromoteWorkflowGoal(workflowState, message)) {
    workflowState.goal_text = message.text;
  }

  workflowState.latest_user_message = message.text;
  workflowState.updated_at = message.created_at;
  if (!Array.isArray(workflowState.user_messages)) {
    workflowState.user_messages = [];
  }
  workflowState.user_messages.push({
    update_id: message.update_id,
    message_id: message.message_id,
    text: message.text,
    created_at: message.created_at
  });
}

export function buildTelegramCtoAutoReplyText(message, continuation = false) {
  const preview = truncateInline(message.text, 120);
  if (continuation) {
    return `收到，openCodex CTO 主线程已收到你的补充，继续调度：${preview}`;
  }
  return `收到，openCodex CTO 主线程已接管，正在拆任务并调度：${preview}`;
}

export function classifyTelegramCtoMessageIntent(text) {
  const rawText = String(text || '').trim();
  if (!rawText) {
    return {
      kind: 'empty',
      label_zh: '空消息',
      reason_zh: '消息为空。'
    };
  }

  const compactText = normalizeTelegramIntentText(rawText);

  if (TELEGRAM_CTO_STATUS_HINT_PATTERN.test(rawText)) {
    return {
      kind: 'status_query',
      label_zh: '状态/历史查询',
      reason_zh: '命中了状态、工作流或任务历史关键词。'
    };
  }

  if (TELEGRAM_CTO_EXPLORATION_PATTERN.test(rawText) && !TELEGRAM_FORCE_EXECUTION_PATTERN.test(rawText)) {
    return {
      kind: 'exploration',
      label_zh: '聊天 / 探讨 / 研究',
      reason_zh: '更像讨论方案、研究方向或共同推演，不必立即进入任务编排。'
    };
  }

  if (TELEGRAM_CTO_CASUAL_CHAT_PATTERN.test(rawText)
    || TELEGRAM_CTO_GREETING_PATTERN.test(rawText)
    || TELEGRAM_SHORT_CASUAL_TEXTS.has(compactText)
    || (compactText.length <= 6 && TELEGRAM_SHORT_CASUAL_TEXTS.has(compactText))) {
    return {
      kind: 'casual_chat',
      label_zh: '轻聊天 / 寒暄',
      reason_zh: '更像打招呼、陪聊或轻反馈，不像执行请求。'
    };
  }

  if (isLikelyTelegramNonDirectiveMessage(rawText)) {
    return {
      kind: 'casual_chat',
      label_zh: '轻反馈 / 寒暄',
      reason_zh: '缺少执行意图，更像反馈、点赞或寒暄。'
    };
  }

  if (TELEGRAM_EXECUTION_HINT_PATTERN.test(rawText)
    || TELEGRAM_ANALYSIS_INTENT_PATTERN.test(rawText)
    || TELEGRAM_REASONING_TARGET_PATTERN.test(rawText)
    || TELEGRAM_ARCHITECTURE_TARGET_PATTERN.test(rawText)) {
    return {
      kind: 'directive',
      label_zh: '执行 / 分析请求',
      reason_zh: '命中了执行、分析、推理或架构类关键词。'
    };
  }

  return {
    kind: 'directive',
    label_zh: '可能是执行请求',
    reason_zh: '当前未命中状态、控制或轻聊天规则，所以会按执行型消息处理。'
  };
}

export function isStrongTelegramCtoDirectiveMessage(text) {
  const rawText = String(text || '').trim();
  if (!rawText) {
    return false;
  }

  if (!TELEGRAM_EXECUTION_HINT_PATTERN.test(rawText)) {
    return false;
  }

  if (TELEGRAM_FORCE_EXECUTION_PATTERN.test(rawText)) {
    return true;
  }

  return rawText.length >= 12 && TELEGRAM_WORK_OBJECT_PATTERN.test(rawText);
}

function isVagueTelegramCtoDirectiveMessage(text) {
  const rawText = String(text || '').trim();
  if (!rawText) {
    return false;
  }

  const compactText = normalizeTelegramIntentText(rawText);
  if (compactText.length > 6) {
    return false;
  }

  return /(帮我看看|帮我看下|看一下|看下|看看|瞅瞅|想想|过目)/i.test(rawText);
}

export function shouldKeepTelegramCtoInConversationMode({ text, chatState = null, hasPendingWorkflow = false }) {
  if (hasPendingWorkflow) {
    return false;
  }

  const intent = classifyTelegramCtoMessageIntent(text);
  if (intent.kind === 'empty') {
    return true;
  }
  if (intent.kind === 'status_query') {
    return false;
  }
  if (intent.kind === 'casual_chat') {
    return Number(chatState?.direct_reply_count || 0) < 1;
  }
  if (intent.kind === 'exploration') {
    return true;
  }
  if (isStrongTelegramCtoDirectiveMessage(text)) {
    return false;
  }

  return Number(chatState?.direct_reply_count || 0) < 1
    && isVagueTelegramCtoDirectiveMessage(text);
}

export function isLikelyTelegramCtoCasualChatMessage(text) {
  return classifyTelegramCtoMessageIntent(text).kind === 'casual_chat';
}

export function buildTelegramCtoDirectReplyPrompt({ message, pendingWorkflowState = null, soulText = '', soulPath = '', replyMode = 'casual', chatState = null }) {
  const lines = [
    buildTelegramCtoMainThreadSystemPrompt({ soulText, soulPath }),
    '',
    replyMode === 'exploration'
      ? 'Exploration mode: Telegram CTO discussion and research reply.'
      : (replyMode === 'conversation'
        ? 'Conversation gate mode: Telegram CTO pre-orchestration reply.'
        : 'Direct mode: Telegram CTO direct reply.'),
    replyMode === 'exploration'
      ? 'This Telegram message is asking for discussion, research, comparison, or architectural exploration before execution.'
      : (replyMode === 'conversation'
        ? 'This Telegram message is not yet clear enough to justify spawning a workflow on the first turn.'
        : 'This Telegram message is casual chat, not a workflow-planning request.'),
    'Do not create tasks, plans, workflows, TODO lists, or execution steps unless the mode explicitly changes later.',
    'Reply in Simplified Chinese.',
    'Be warm, grounded, and concise.',
    replyMode === 'exploration' ? 'Keep the reply within 5 short lines.' : 'Keep the reply within 3 short lines.',
    'Return JSON that matches the provided schema.',
    'Set `title` to `Telegram CTO direct reply`.',
    'Set `status` to `completed`.',
    'Put the exact Telegram reply text in `result`.',
    'Leave `highlights`, `next_steps`, `risks`, `validation`, `changed_files`, and `findings` empty arrays.'
  ];

  if (replyMode === 'conversation') {
    lines.push(
      '',
      'This is the first-stage conversation gate for the CTO main thread.',
      'Do not start orchestration yet. Help the CEO clarify intent naturally.',
      'If the CEO only greets you, respond naturally and say you can switch into execution once they give a concrete goal.',
      'If the message hints at work but is still vague, ask one short clarifying question about which lane to start with.',
      `Direct-reply turns so far in this listener session: ${Number(chatState?.direct_reply_count || 0)}`
    );
  }

  if (replyMode === 'exploration') {
    lines.push(
      '',
      'This is the CTO discussion and research mode.',
      'Do not start orchestration yet unless the CEO explicitly asks to execute or delegate concrete work.',
      'You should support chatting, discussing trade-offs, exploring architecture, comparing options, and framing lightweight research questions.',
      'Prefer a natural answer first. You may end with one concise suggestion for what to investigate next if helpful.'
    );
  }

  if (pendingWorkflowState?.workflow_session_id) {
    lines.push(
      '',
      'There is already a waiting CTO workflow for this chat.',
      `Workflow: ${pendingWorkflowState.workflow_session_id}`,
      `Pending question: ${asTrimmedString(pendingWorkflowState.pending_question_zh) || '(none)'}`,
      'You must clearly say that this workflow remains unchanged and waiting.',
      'If the CEO wants to continue execution, tell them to answer the pending question directly.'
    );
  } else {
    lines.push(
      '',
      'There is no active waiting workflow for this chat.',
      'If the CEO wants execution, tell them to send a concrete goal.',
      'If the CEO wants status, tell them they can ask about workflow or task status.'
    );
  }

  lines.push('', 'Telegram message:', asTrimmedString(message?.text));
  return lines.join('\n');
}

export async function loadCtoSoulDocument(cwd = process.cwd(), options = {}) {
  const resolvedCwd = path.resolve(cwd || process.cwd());
  const overridePath = String(options.path || process.env.OPENCODEX_CTO_SOUL_PATH || '').trim();
  const candidatePaths = [];

  if (overridePath) {
    candidatePaths.push(path.isAbsolute(overridePath) ? overridePath : path.resolve(resolvedCwd, overridePath));
  }
  candidatePaths.push(path.resolve(resolvedCwd, DEFAULT_CTO_SOUL_RELATIVE_PATH));

  for (const candidatePath of candidatePaths) {
    const text = (await readTextIfExists(candidatePath))?.trim() || '';
    if (text) {
      return {
        path: candidatePath,
        display_path: path.relative(resolvedCwd, candidatePath) || path.basename(candidatePath),
        text,
        builtin: false
      };
    }
  }

  return {
    path: path.resolve(resolvedCwd, DEFAULT_CTO_SOUL_RELATIVE_PATH),
    display_path: DEFAULT_CTO_SOUL_RELATIVE_PATH,
    text: buildDefaultCtoSoulDocument(),
    builtin: true
  };
}

export function buildDefaultCtoSoulDocument() {
  return [
    '# openCodex CTO Soul',
    '',
    'You are the openCodex CTO main thread.',
    '',
    '## Base Persona',
    '- Start from the general-purpose Codex CLI personal assistant persona: capable, practical, concise, and reliable for day-to-day local work.',
    '- Preserve Codex CLI as the primary local execution engine instead of rebuilding that engine inside openCodex.',
    '- Extend that assistant persona into a CTO-style orchestrator that plans, delegates, supervises, and follows through.',
    '',
    '## Identity',
    '- Stay in the CTO role and behave like the long-lived orchestrator for the CEO.',
    '- Keep openCodex as a thin orchestration layer inspired by openclaw.',
    '- The CTO identity lives at the host-supervisor layer, not inside a sandbox child session.',
    '- Treat the Telegram channel and tray UI as persistent control surfaces for the same host-level CTO thread.',
    '',
    '## Operating Style',
    '- Prefer non-blocking delegation, visible progress, and reversible implementation steps.',
    '- Support natural chat, discussion, and research-style exploration before orchestration when that better matches the CEO intent.',
    '- Infer intent when a safe, high-leverage default path is obvious.',
    '- Ask for confirmation only when external side effects, safety, or strategy would materially change.',
    '- Maintain awareness of running, waiting, blocked, and rerouted workflows.',
    '',
    '## Interaction Modes',
    '- The CTO should support three interaction modes: chat, exploration, and orchestration.',
    '',
    '## Language Policy',
    '- Reply to the CEO in Simplified Chinese on the control channel.',
    '- Keep task titles, implementation prompts, and project artifacts in English.',
    '- Keep documentation bilingual under docs/en and docs/zh when docs change.',
    '',
    '## Delegation Policy',
    '- The host-level CTO supervisor owns planning policy, workflow state, and edits every worker prompt.',
    '- Sandbox Codex sessions are advisors, planners, reviewers, or narrowly scoped helpers for the host supervisor.',
    '- Sandbox child sessions are not the CEO-facing CTO identity and must not replace the supervisor role.',
    '- If a sandbox child proposes a plan, patch, or answer, the host supervisor decides whether to adopt it, reroute it, continue, or ask the CEO.',
    '- Keep worker prompts concrete, scoped, and independently executable.'
  ].join('\n');
}

export function buildTelegramCtoMainThreadSystemPrompt({ continuation = false, soulText = '', soulPath = '' } = {}) {
  const lines = [
    'You are the dedicated openCodex CTO main thread operating through the Telegram control channel.',
    'You are the host-level supervisor for the CEO-facing CTO thread and must stay in the CTO role.',
    'You are the central orchestrator for many worker agents and must stay in the CTO role.',
    'openCodex is a thin orchestration layer on top of Codex CLI, inspired by openclaw.',
    'Sandbox Codex sessions are advisory or helper sessions for you; they are not the CEO-facing CTO identity.',
    'Your job is to decide, sequence, and supervise non-blocking local tasks instead of doing every implementation step yourself.',
    'You must also support natural chat, architecture discussion, and research-style exploration when the CEO is thinking aloud or comparing options.',
    continuation
      ? 'You are continuing an existing workflow after the CEO replied.'
      : 'The user is the CEO and this Telegram message is the active remote control path.',
    'Return JSON that matches the provided schema.',
    'Use Simplified Chinese for `summary_zh` and `question_zh`.',
    'Use English for task titles and worker prompts.',
    'Create 1-4 concrete tasks at a time. Prefer parallel tasks when dependencies allow.',
    'You must personally generate and edit every worker prompt. Do not ask workers to invent their own mission.',
    'Each worker prompt must be self-contained, minimal, reversible, and executable by a child agent without extra clarification.',
    'Workers reply in Simplified Chinese. Project artifacts stay in English, and docs remain bilingual under docs/en and docs/zh.',
    'Infer the CEO intent from context when the request is broad but still actionable; do not ask for clarification if a safe, high-leverage default path is obvious.',
    'For requests to inspect, review, analyze, audit, prioritize, or improve, start with the most likely safe analysis task instead of bouncing the request back.',
    continuation
      ? 'Do not recreate finished tasks. Only create the next executable tasks needed after the CEO response.'
      : 'Ask one concise Chinese question only when ambiguity would materially change the execution path or create a meaningful external risk.'
  ];

  const normalizedSoulText = String(soulText || '').trim();
  if (normalizedSoulText) {
    lines.push('', soulPath
      ? `Active CTO soul document (${soulPath}):`
      : 'Active CTO soul document:', normalizedSoulText);
  }

  return lines.join('\n');
}

export function buildTelegramCtoPlannerPrompt({ message, workflowState, continuationMessage = null, soulText = '', soulPath = '' }) {
  const completedTaskLines = summarizeTasksForPrompt(workflowState.tasks || []);
  const historyLines = (workflowState.user_messages || [])
    .slice(-4)
    .map((item, index) => `${index + 1}. ${item.text}`);

  if (continuationMessage) {
    return [
      buildTelegramCtoMainThreadSystemPrompt({ continuation: true, soulText, soulPath }),
      '',
      'Original Telegram goal:',
      workflowState.goal_text,
      '',
      'Pending question for the CEO:',
      workflowState.pending_question_zh || '(none)',
      '',
      'CEO response:',
      continuationMessage.text,
      '',
      'Recent Telegram message history:',
      historyLines.length ? historyLines.join('\n') : '(none)',
      '',
      'Completed or existing workflow tasks:',
      completedTaskLines || '(none)'
    ].join('\n');
  }

  return [
    buildTelegramCtoMainThreadSystemPrompt({ soulText, soulPath }),
    '',
    'Telegram message:',
    message.text
  ].join('\n');
}

function buildInferredTelegramCtoPlan({ fallbackMessageText, workflowState }) {
  const messageText = String(fallbackMessageText || '').trim();
  if (!messageText || isLikelyTelegramNonDirectiveMessage(messageText)) {
    return null;
  }

  if (!TELEGRAM_ANALYSIS_INTENT_PATTERN.test(messageText)) {
    return null;
  }

  if (TELEGRAM_REASONING_TARGET_PATTERN.test(messageText)) {
    return {
      mode: 'execute',
      summary_zh: '已将你的问题自动推断为一次 CTO 推理深度与决策策略审查，并先执行安全的分析任务。',
      question_zh: '',
      tasks: [
        {
          id: 'audit-cto-reasoning',
          title: 'Audit CTO reasoning depth',
          worker_prompt: [
            `Interpret the CEO message as a request to audit the depth and quality of the openCodex CTO reasoning: ${messageText}`,
            'Inspect at minimum `src/lib/cto-workflow.js`, `src/commands/im.js`, and the related CTO workflow tests.',
            'Judge whether the current intent inference, confirmation threshold, delegation policy, and task planning depth are strong enough.',
            'Produce a concise Simplified Chinese report with: 1) strengths, 2) weaknesses, 3) the single highest-leverage safe improvement to make next.',
            'If one improvement is clearly safe, local, and high leverage, implement it with focused tests before finishing.'
          ].join('\n'),
          depends_on: []
        }
      ]
    };
  }

  if (TELEGRAM_ARCHITECTURE_TARGET_PATTERN.test(messageText)) {
    return {
      mode: 'execute',
      summary_zh: '已根据你的抽象指令自动推断为一次 CTO 工作流与架构检查，并先从安全分析切入。',
      question_zh: '',
      tasks: [
        {
          id: 'audit-cto-workflow',
          title: 'Audit CTO workflow architecture',
          worker_prompt: [
            `Interpret the CEO message using the current repository context: ${messageText}`,
            'Inspect the openCodex CTO workflow, orchestration, and implementation surface related to this request.',
            'Review at minimum `src/lib/cto-workflow.js`, `src/commands/im.js`, and the most relevant related tests.',
            'Start with analysis. If one safe, highest-leverage improvement is obvious, implement it with focused tests; otherwise stop after the audit with a concrete recommendation.'
          ].join('\n'),
          depends_on: []
        }
      ]
    };
  }

  return {
    mode: 'execute',
    summary_zh: '已根据你的抽象指令自动推断出可执行检查任务，并先从安全分析切入。',
    question_zh: '',
    tasks: [
      {
        id: 'inspect-inferred-intent',
        title: 'Inspect inferred CEO intent',
        worker_prompt: [
          `Recover the most likely actionable CTO intent from the CEO message: ${messageText}`,
          `Use the current workflow goal as context when helpful: ${truncateInline(workflowState?.goal_text || messageText, 160) || messageText}`,
          'Start with a safe analysis task, inspect the most relevant repository area, and avoid asking the CEO for more detail unless execution would be materially risky.',
          'If one safe, high-leverage improvement is obvious, implement it with focused tests before finishing.'
        ].join('\n'),
        depends_on: []
      }
    ]
  };
}


export function collectHistoricalStuckCtoWorkflowCandidates(workflows, options = {}) {
  const currentWorkflowSessionId = asTrimmedString(options.currentWorkflowSessionId);
  const parsedStaleMinutes = Number(options.staleMinutes);
  const staleMinutes = Number.isFinite(parsedStaleMinutes) && parsedStaleMinutes >= 0
    ? parsedStaleMinutes
    : DEFAULT_CTO_HISTORY_REPAIR_STALE_MINUTES;
  const nowTime = resolveWorkflowRepairTimeValue(options.now);

  return (workflows || [])
    .map((item) => buildHistoricalStuckCtoWorkflowCandidate(item, {
      currentWorkflowSessionId,
      staleMinutes,
      nowTime
    }))
    .filter(Boolean)
    .sort((left, right) => String(left.updated_at || '').localeCompare(String(right.updated_at || '')));
}

function buildHistoricalStuckCtoWorkflowCandidate(item, { currentWorkflowSessionId, staleMinutes, nowTime }) {
  const session = item?.session;
  const workflowState = item?.workflowState;
  if (!session || session.command !== 'cto') {
    return null;
  }
  if (session.session_id === currentWorkflowSessionId) {
    return null;
  }

  const updatedAt = asTrimmedString(workflowState?.updated_at) || asTrimmedString(session.updated_at);
  if (!updatedAt || !isWorkflowOlderThan(updatedAt, staleMinutes, nowTime)) {
    return null;
  }

  const sessionStatus = asTrimmedString(session.status);
  const workflowStatus = asTrimmedString(workflowState?.status) || sessionStatus;
  const pendingQuestion = asTrimmedString(workflowState?.pending_question_zh);
  const counts = summarizeWorkflowCounts(workflowState || { tasks: [] });
  const reason = deriveHistoricalCtoWorkflowReason({
    sessionStatus,
    workflowStatus,
    pendingQuestion,
    counts
  });
  if (!reason) {
    return null;
  }

  return {
    session_id: session.session_id,
    status: workflowStatus || sessionStatus || 'unknown',
    updated_at: updatedAt,
    goal_text: asTrimmedString(workflowState?.goal_text) || asTrimmedString(session.input?.prompt),
    pending_question: pendingQuestion,
    reason,
    running_task_count: counts.running,
    queued_task_count: counts.queued,
    completed_task_count: counts.completed,
    partial_task_count: counts.partial,
    failed_task_count: counts.failed
  };
}

function deriveHistoricalCtoWorkflowReason({ sessionStatus, workflowStatus, pendingQuestion, counts }) {
  if (pendingQuestion) {
    return '';
  }

  if (sessionStatus === 'queued' || workflowStatus === 'planning') {
    return 'workflow stayed queued past the stale threshold';
  }

  if (sessionStatus === 'running' || workflowStatus === 'running') {
    if (counts.running > 0) {
      return 'running task state stayed active past the stale threshold';
    }
    if (counts.failed > 0 || counts.partial > 0 || counts.queued > 0) {
      return 'workflow still has unresolved task state without a CEO question';
    }
    return 'workflow remained running without observable progress';
  }

  if (sessionStatus === 'partial' || workflowStatus === 'partial' || workflowStatus === 'waiting_for_user') {
    if (counts.failed > 0 || counts.partial > 0 || counts.queued > 0) {
      return 'partial workflow has unresolved task state but no pending CEO question';
    }
    return 'partial workflow has no pending CEO question';
  }

  return '';
}

function isWorkflowOlderThan(updatedAt, staleMinutes, nowTime) {
  const updatedTime = Date.parse(updatedAt);
  if (!Number.isFinite(updatedTime)) {
    return false;
  }
  return (nowTime - updatedTime) >= staleMinutes * 60 * 1000;
}

function resolveWorkflowRepairTimeValue(value) {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Date.now();
}

export function injectHistoricalCtoRepairTask(plan, options = {}) {
  if (!plan || plan.mode !== 'execute') {
    return plan;
  }

  const candidates = Array.isArray(options.candidates)
    ? options.candidates.filter(Boolean)
    : [];
  if (!candidates.length) {
    return plan;
  }

  const existingTasks = Array.isArray(plan.tasks) ? plan.tasks : [];
  if (existingTasks.some((task) => String(task?.id || '') === CTO_HISTORY_REPAIR_TASK_ID)) {
    return plan;
  }

  const parsedStaleMinutes = Number(options.staleMinutes);
  const staleMinutes = Number.isFinite(parsedStaleMinutes) && parsedStaleMinutes >= 0
    ? parsedStaleMinutes
    : DEFAULT_CTO_HISTORY_REPAIR_STALE_MINUTES;
  const nextTaskCounter = Number.isInteger(plan.task_counter)
    ? plan.task_counter + 1
    : existingTasks.length + 1;
  const seenIds = new Set(existingTasks.map((task) => task.id));
  const taskId = ensureUniqueTaskId(CTO_HISTORY_REPAIR_TASK_ID, seenIds, nextTaskCounter);
  const summaryPrefix = `已发现 ${candidates.length} 条历史卡住 workflow，已默认加入清理/修复任务。`;

  return {
    ...plan,
    summary_zh: [summaryPrefix, asTrimmedString(plan.summary_zh)].filter(Boolean).join(' '),
    task_counter: nextTaskCounter,
    tasks: [
      {
        id: taskId,
        title: 'Repair historical stuck workflows',
        worker_prompt: buildHistoricalCtoRepairTaskPrompt({
          candidates,
          cwd: asTrimmedString(options.cwd),
          currentWorkflowSessionId: asTrimmedString(options.currentWorkflowSessionId),
          staleMinutes
        }),
        depends_on: [],
        status: 'queued',
        session_id: '',
        summary_status: '',
        result: '',
        next_steps: [],
        changed_files: [],
        reroute_job_id: '',
        reroute_record_path: '',
        reroute_source_session_id: '',
        updated_at: ''
      },
      ...existingTasks
    ]
  };
}

function buildHistoricalCtoRepairTaskPrompt({ candidates, cwd, currentWorkflowSessionId, staleMinutes }) {
  const commandParts = [];
  if (currentWorkflowSessionId) {
    commandParts.push(`OPENCODEX_REPAIR_SKIP_SESSION_ID=${JSON.stringify(currentWorkflowSessionId)}`);
  }
  commandParts.push('node ./bin/opencodex.js session repair');
  if (cwd) {
    commandParts.push(`--cwd ${JSON.stringify(cwd)}`);
  }
  commandParts.push(`--stale-minutes ${staleMinutes}`);
  commandParts.push('--json');

  const lines = [
    'Inspect and repair historical stuck openCodex CTO workflows as a default maintenance pass.',
    'Do not destructively delete workflow history. Prefer safe repair, diagnosis, and a clear next-step summary.',
    currentWorkflowSessionId
      ? `Never modify or repair the current workflow session itself: ${currentWorkflowSessionId}`
      : 'If the current workflow session can be identified later, exclude it from repair.',
    `First run this command exactly once: ${commandParts.join(' ')}`,
    'Then inspect each targeted workflow session.json and artifacts/cto-workflow.json to confirm which workflows were repaired.',
    'Summarize: 1) repaired workflows, 2) workflows still blocked, 3) the safest follow-up action.',
    'If a workflow still cannot be repaired safely, diagnose the blocker instead of guessing or rewriting history.',
    'Target workflows:'
  ];

  for (const candidate of candidates.slice(0, 6)) {
    lines.push(
      `- ${candidate.session_id} | ${candidate.status} | updated ${candidate.updated_at} | reason: ${candidate.reason}`
    );
  }

  if (candidates.length > 6) {
    lines.push(`- ...and ${candidates.length - 6} more historical workflow(s)`);
  }

  return lines.join('\n');
}

export function normalizeTelegramCtoPlan(rawPlan, fallbackMessageText, workflowState) {
  const effectiveRawPlan = rawPlan?.mode === 'confirm'
    ? (buildInferredTelegramCtoPlan({ fallbackMessageText, workflowState }) || rawPlan)
    : rawPlan;
  const nextTaskCounter = Number.isInteger(workflowState?.task_counter) ? workflowState.task_counter : 0;
  const rawTasks = Array.isArray(effectiveRawPlan?.tasks) ? effectiveRawPlan.tasks : [];
  const seenIds = new Set((workflowState?.tasks || []).map((task) => task.id));
  const normalizedTasks = [];
  let counter = nextTaskCounter;

  for (const rawTask of rawTasks.slice(0, MAX_TASKS)) {
    if (!rawTask || typeof rawTask !== 'object' || Array.isArray(rawTask)) {
      continue;
    }

    counter += 1;
    const proposedId = sanitizeTaskId(rawTask.id, counter);
    const taskId = ensureUniqueTaskId(proposedId, seenIds, counter);
    seenIds.add(taskId);

    const title = truncateInline(rawTask.title || `Task ${counter}`, MAX_TITLE_LENGTH) || `Task ${counter}`;
    const workerPrompt = asTrimmedString(rawTask.worker_prompt)
      || buildFallbackWorkerDirective({ title, fallbackMessageText });
    const dependsOn = Array.isArray(rawTask.depends_on)
      ? rawTask.depends_on.map((item) => String(item || '').trim()).filter(Boolean)
      : [];

    normalizedTasks.push({
      id: taskId,
      title,
      worker_prompt: workerPrompt,
      depends_on: dependsOn,
      status: 'queued',
      session_id: '',
      summary_status: '',
      result: '',
      next_steps: [],
      changed_files: [],
      updated_at: ''
    });
  }

  if (!normalizedTasks.length) {
    counter += 1;
    normalizedTasks.push({
      id: ensureUniqueTaskId(`task-${counter}`, seenIds, counter),
      title: truncateInline(fallbackMessageText || 'Local task', MAX_TITLE_LENGTH) || `Task ${counter}`,
      worker_prompt: buildFallbackWorkerDirective({ fallbackMessageText }),
      depends_on: [],
      status: 'queued',
      session_id: '',
      summary_status: '',
      result: '',
      next_steps: [],
      changed_files: [],
      updated_at: ''
    });
  }

  const validIds = new Set([...(workflowState?.tasks || []).map((task) => task.id), ...normalizedTasks.map((task) => task.id)]);
  for (const task of normalizedTasks) {
    task.depends_on = task.depends_on.filter((item) => validIds.has(item));
  }

  const mode = effectiveRawPlan?.mode === 'confirm' ? 'confirm' : 'execute';
  const question = asTrimmedString(effectiveRawPlan?.question_zh);
  const summary = asTrimmedString(effectiveRawPlan?.summary_zh)
    || (mode === 'confirm'
      ? '当前步骤需要你先确认下一步。'
      : `已拆分 ${normalizedTasks.length} 个可执行任务。`);

  return {
    mode,
    summary_zh: summary,
    question_zh: mode === 'confirm'
      ? (question || '请补充当前任务的关键决策信息。')
      : '',
    tasks: normalizedTasks,
    task_counter: counter
  };
}

export function appendPlanTasksToWorkflow(workflowState, plan) {
  workflowState.plan_mode = plan.mode;
  workflowState.plan_summary_zh = plan.summary_zh;
  workflowState.pending_question_zh = plan.question_zh || '';
  workflowState.task_counter = plan.task_counter;
  workflowState.updated_at = new Date().toISOString();

  if (!Array.isArray(workflowState.tasks)) {
    workflowState.tasks = [];
  }

  if (plan.mode === 'execute') {
    workflowState.tasks.push(...plan.tasks);
    workflowState.status = 'running';
    return;
  }

  workflowState.status = 'waiting_for_user';
}

export function buildTelegramCtoPlanText(workflowState) {
  const tasks = Array.isArray(workflowState.tasks) ? workflowState.tasks : [];
  const latestTasks = tasks.filter((task) => task.status === 'queued' || task.status === 'running').slice(-4);
  const ready = latestTasks.filter((task) => !task.depends_on.length).map((task) => task.id);
  const blocked = latestTasks.filter((task) => task.depends_on.length).map((task) => `${task.id} <= ${task.depends_on.join(', ')}`);

  const lines = [
    'openCodex CTO 已完成任务拆解',
    `目标：${truncateInline(workflowState.goal_text, 160)}`,
    `摘要：${truncateInline(workflowState.plan_summary_zh || '已进入调度阶段。', 220)}`,
    '任务：'
  ];

  for (const task of latestTasks) {
    lines.push(`- ${task.id} ${truncateInline(task.title, 80)}`);
  }

  if (ready.length) {
    lines.push(`已启动：${ready.join(', ')}`);
  }
  if (blocked.length) {
    lines.push('等待依赖：');
    for (const item of blocked) {
      lines.push(`- ${item}`);
    }
  }

  lines.push(`Workflow: ${workflowState.workflow_session_id}`);
  return lines.join('\n');
}

export function buildTelegramCtoQuestionText(workflowState) {
  const lines = [
    'openCodex CTO 需要你确认下一步',
    `问题：${truncateInline(workflowState.pending_question_zh || '请补充执行所需信息。', 500)}`,
    `当前目标：${truncateInline(workflowState.goal_text, 160)}`,
    `Workflow: ${workflowState.workflow_session_id}`
  ];

  const counts = summarizeWorkflowCounts(workflowState);
  if (counts.completed > 0 || counts.failed > 0) {
    lines.splice(3, 0, `进度：completed ${counts.completed}, partial ${counts.partial}, failed ${counts.failed}`);
  }

  return lines.join('\n');
}

export function buildTelegramCtoStatusText(workflowState) {
  const counts = summarizeWorkflowCounts(workflowState);
  const latestTasks = Array.isArray(workflowState.tasks)
    ? workflowState.tasks.slice(-6)
    : [];
  const summary = workflowState.plan_summary_zh || buildWorkflowResultLine(workflowState, counts);
  const lines = [
    'openCodex CTO 工作流汇报',
    `目标：${truncateInline(workflowState.goal_text, 160)}`,
    `状态：${formatTelegramWorkflowStatus(workflowState.status)}`,
    `摘要：${truncateInline(summary, 220)}`,
    `进度：queued ${counts.queued}, running ${counts.running}, rerouted ${counts.rerouted}, completed ${counts.completed}, partial ${counts.partial}, failed ${counts.failed}, cancelled ${counts.cancelled}`
  ];

  if (latestTasks.length) {
    lines.push('任务：');
    for (const task of latestTasks) {
      lines.push(`- [${getTaskDisplayStatus(task)}] ${task.id} ${truncateInline(task.title, 80)}`);
    }
  } else {
    lines.push('任务：暂无');
  }

  if (workflowState.pending_question_zh) {
    lines.push(`待确认：${truncateInline(workflowState.pending_question_zh, 220)}`);
  }

  lines.push(`Workflow: ${workflowState.workflow_session_id}`);
  return lines.join('\n');
}

export function buildTelegramCtoFinalText(workflowState) {
  const counts = summarizeWorkflowCounts(workflowState);
  const statusTitle = workflowState.status === 'completed'
    ? 'openCodex CTO 工作流已完成'
    : workflowState.status === 'waiting_for_user'
      ? 'openCodex CTO 工作流待确认'
      : workflowState.status === 'cancelled'
        ? 'openCodex CTO 工作流已取消'
        : 'openCodex CTO 工作流已结束';

  const lines = [
    statusTitle,
    `目标：${truncateInline(workflowState.goal_text, 160)}`,
    `进度：completed ${counts.completed}, rerouted ${counts.rerouted}, partial ${counts.partial}, failed ${counts.failed}, cancelled ${counts.cancelled}, queued ${counts.queued}`
  ];

  const highlights = collectWorkflowHighlights(workflowState).slice(0, 4);
  if (highlights.length) {
    lines.push('要点：');
    for (const item of highlights) {
      lines.push(`- ${truncateInline(item, 220)}`);
    }
  }

  const changedFiles = collectWorkflowChangedFiles(workflowState).slice(0, 4);
  if (changedFiles.length) {
    lines.push('改动：');
    for (const item of changedFiles) {
      lines.push(`- ${truncateInline(item, 220)}`);
    }
  }

  const nextSteps = collectWorkflowNextSteps(workflowState).slice(0, 4);
  if (nextSteps.length) {
    lines.push('下一步：');
    for (const item of nextSteps) {
      lines.push(`- ${truncateInline(item, 220)}`);
    }
  }

  lines.push(`Workflow: ${workflowState.workflow_session_id}`);
  return lines.join('\n');
}

export function buildTelegramCtoSessionSummary(workflowState) {
  const counts = summarizeWorkflowCounts(workflowState);
  const status = mapWorkflowStatus(workflowState.status);
  const highlights = [
    `Chat: ${workflowState.chat_id}`,
    `Tasks: ${counts.total}`,
    `Completed: ${counts.completed}`,
    `Rerouted: ${counts.rerouted}`,
    `Partial: ${counts.partial}`,
    `Failed: ${counts.failed}`,
    `Cancelled: ${counts.cancelled}`
  ];

  const nextSteps = collectWorkflowNextSteps(workflowState).slice(0, 4);
  if (!nextSteps.length && status === 'running') {
    nextSteps.push(counts.rerouted > 0
      ? 'Wait for the rerouted host-executor tasks to finish.'
      : 'Wait for the running workflow tasks to finish.');
  }
  if (!nextSteps.length && status === 'partial') {
    nextSteps.push(counts.failed > 0
      ? 'Inspect failed task diagnostics; the workflow is no longer waiting for CEO input.'
      : 'Wait for the CEO reply on the Telegram control channel.');
  }

  return {
    title: status === 'completed'
      ? 'CTO workflow completed'
      : status === 'partial'
        ? 'CTO workflow needs follow-up'
        : status === 'failed'
          ? 'CTO workflow failed'
          : status === 'cancelled'
            ? 'CTO workflow cancelled'
            : 'CTO workflow running',
    result: buildWorkflowResultLine(workflowState, counts),
    status,
    highlights,
    next_steps: nextSteps,
    risks: collectWorkflowRisks(workflowState).slice(0, 4),
    validation: [],
    changed_files: collectWorkflowChangedFiles(workflowState).slice(0, 8),
    findings: []
  };
}

function getTaskDisplayStatus(task) {
  if (asTrimmedString(task?.summary_status) === 'rerouted') {
    return 'rerouted';
  }
  return asTrimmedString(task?.status) || 'unknown';
}

export function findPendingWorkflowForChat(workflows, chatId) {
  const items = Array.from(workflows || []);
  return items
    .filter((workflow) => workflow?.state?.chat_id === chatId && workflow.state.status === 'waiting_for_user')
    .sort((left, right) => String(right.state.updated_at || '').localeCompare(String(left.state.updated_at || '')))[0] || null;
}

export function getReadyWorkflowTasks(workflowState) {
  if (workflowState?.status === 'cancelled') {
    return [];
  }

  const completedTaskIds = new Set((workflowState.tasks || [])
    .filter((task) => task.status === 'completed')
    .map((task) => task.id));

  return (workflowState.tasks || []).filter((task) => {
    if (task.status !== 'queued') {
      return false;
    }
    return (task.depends_on || []).every((dependencyId) => completedTaskIds.has(dependencyId));
  });
}

export function markWorkflowTaskRunning(workflowState, taskId, sessionId = '') {
  if (workflowState?.status === 'cancelled') {
    return null;
  }

  const task = findTask(workflowState, taskId);
  if (!task) {
    return null;
  }
  task.status = 'running';
  task.session_id = sessionId || task.session_id || '';
  task.updated_at = new Date().toISOString();
  workflowState.status = 'running';
  workflowState.updated_at = task.updated_at;
  return task;
}

export function applyWorkflowTaskResult(workflowState, taskId, runResult) {
  const task = findTask(workflowState, taskId);
  if (!task) {
    return null;
  }

  const summaryStatus = asTrimmedString(runResult?.summary?.status)
    || asTrimmedString(runResult?.childStatus)
    || (runResult?.code === 0 ? 'completed' : 'failed');

  if (workflowState?.status === 'cancelled') {
    task.session_id = runResult?.sessionId || task.session_id || '';
    task.summary_status = summaryStatus;
    task.updated_at = new Date().toISOString();
    workflowState.updated_at = task.updated_at;
    return task;
  }
  if (summaryStatus === 'rerouted') {
    task.status = 'running';
    task.session_id = runResult?.sessionId || task.session_id || '';
    task.summary_status = summaryStatus;
    task.result = asTrimmedString(runResult?.summary?.result) || '';
    task.next_steps = asStringList(runResult?.summary?.next_steps);
    task.changed_files = asStringList(runResult?.summary?.changed_files);
    task.reroute_job_id = asTrimmedString(runResult?.rerouteJobId || runResult?.summary?.reroute_job_id) || task.reroute_job_id || '';
    task.reroute_record_path = asTrimmedString(runResult?.rerouteRecordPath || runResult?.summary?.reroute_record_path) || task.reroute_record_path || '';
    task.reroute_source_session_id = asTrimmedString(runResult?.sessionId) || task.reroute_source_session_id || '';
    task.updated_at = new Date().toISOString();
    workflowState.updated_at = task.updated_at;
    workflowState.status = 'running';
    workflowState.pending_question_zh = '';
    return task;
  }

  task.status = ['completed', 'failed', 'partial'].includes(summaryStatus)
    ? summaryStatus
    : (runResult?.code === 0 ? 'completed' : 'failed');
  task.session_id = runResult?.sessionId || task.session_id || '';
  task.summary_status = summaryStatus;
  task.result = asTrimmedString(runResult?.summary?.result) || '';
  task.next_steps = asStringList(runResult?.summary?.next_steps);
  task.changed_files = asStringList(runResult?.summary?.changed_files);
  task.updated_at = new Date().toISOString();
  workflowState.updated_at = task.updated_at;

  if (task.status === 'partial' || (task.status === 'failed' && task.next_steps.length > 0)) {
    workflowState.status = 'waiting_for_user';
    workflowState.pending_question_zh = task.next_steps[0] || task.result || '请确认下一步处理方式。';
  }

  return task;
}

export function finalizeWorkflowStatus(workflowState) {
  const counts = summarizeWorkflowCounts(workflowState);

  if (workflowState.status === 'cancelled') {
    return workflowState.status;
  }

  if (workflowState.status === 'waiting_for_user') {
    return workflowState.status;
  }

  if (counts.running > 0 || counts.rerouted > 0) {
    workflowState.status = 'running';
    return workflowState.status;
  }

  const blockedTasks = (workflowState.tasks || []).filter((task) => task.status === 'queued');
  if (blockedTasks.length) {
    if (counts.failed > 0 && counts.completed === 0 && counts.partial === 0) {
      workflowState.status = 'failed';
      return workflowState.status;
    }
    if (counts.failed > 0 || counts.partial > 0) {
      workflowState.status = 'partial';
      return workflowState.status;
    }
    if (!workflowState.pending_question_zh) {
      workflowState.pending_question_zh = '仍有任务等待依赖，请确认是否继续调整当前工作流。';
    }
    workflowState.status = 'waiting_for_user';
    return workflowState.status;
  }

  if (counts.failed > 0 && counts.completed === 0) {
    workflowState.status = 'failed';
    return workflowState.status;
  }

  if (counts.failed > 0 || counts.partial > 0) {
    workflowState.status = 'partial';
    return workflowState.status;
  }

  workflowState.status = 'completed';
  return workflowState.status;
}

export function summarizeWorkflowCounts(workflowState) {
  const counts = {
    total: 0,
    queued: 0,
    running: 0,
    rerouted: 0,
    completed: 0,
    partial: 0,
    failed: 0,
    cancelled: 0
  };

  for (const task of workflowState.tasks || []) {
    counts.total += 1;
    if (asTrimmedString(task?.summary_status) === 'rerouted') {
      counts.rerouted += 1;
      continue;
    }
    if (Object.hasOwn(counts, task?.status)) {
      counts[task.status] += 1;
    }
  }

  return counts;
}

function collectWorkflowHighlights(workflowState) {
  return (workflowState.tasks || [])
    .filter((task) => task.result)
    .map((task) => `${task.id} ${task.title}: ${task.result}`);
}

function collectWorkflowChangedFiles(workflowState) {
  const values = new Set();
  for (const task of workflowState.tasks || []) {
    for (const filePath of task.changed_files || []) {
      values.add(filePath);
    }
  }
  return [...values];
}

function collectWorkflowNextSteps(workflowState) {
  const values = [];
  if (workflowState.pending_question_zh) {
    values.push(workflowState.pending_question_zh);
  }
  for (const task of workflowState.tasks || []) {
    for (const item of task.next_steps || []) {
      values.push(item);
    }
  }
  return dedupeList(values);
}


export function cancelTelegramWorkflowState(workflowState) {
  const now = new Date().toISOString();
  workflowState.status = 'cancelled';
  workflowState.pending_question_zh = '';
  workflowState.updated_at = now;

  for (const task of workflowState.tasks || []) {
    if (task?.status === 'queued' || task?.status === 'running') {
      task.status = 'cancelled';
      task.summary_status = task.summary_status || 'cancelled';
      task.updated_at = now;
      task.next_steps = [];
    }
  }

  return workflowState;
}

function collectWorkflowRisks(workflowState) {
  const values = [];
  for (const task of workflowState.tasks || []) {
    if (task.status === 'failed') {
      values.push(`${task.id} failed: ${task.result || 'Task execution failed.'}`);
    }
    if (task.status === 'partial') {
      values.push(`${task.id} needs confirmation: ${task.next_steps[0] || task.result || 'Pending decision.'}`);
    }
  }
  return dedupeList(values);
}

function buildWorkflowResultLine(workflowState, counts) {
  if (workflowState.status === 'waiting_for_user') {
    return workflowState.pending_question_zh || 'Waiting for the CEO to confirm the next step.';
  }

  if (workflowState.status === 'completed') {
    return `Completed ${counts.completed}/${counts.total} workflow task(s).`;
  }

  if (workflowState.status === 'failed') {
    return counts.failed > 0
      ? `Workflow failed after ${counts.failed} failed task(s).`
      : 'Workflow failed before task execution completed.';
  }

  if (workflowState.status === 'cancelled') {
    return counts.cancelled > 0
      ? `Workflow was cancelled after ${counts.cancelled} task(s) were marked cancelled.`
      : 'Workflow was cancelled by the CEO.';
  }

  if (workflowState.status === 'partial') {
    if (counts.partial > 0 || counts.failed > 0) {
      return `Workflow needs follow-up after ${counts.completed} completed, ${counts.partial} partial, and ${counts.failed} failed task(s).`;
    }
    return 'Workflow needs follow-up before it can be marked completed.';
  }

  if (counts.rerouted > 0) {
    return `Workflow is running with ${counts.running} active task(s) and ${counts.rerouted} rerouted host-executor task(s).`;
  }

  return `Workflow is running with ${counts.running} active task(s).`;
}

function mapWorkflowStatus(status) {
  if (status === 'waiting_for_user' || status === 'partial') {
    return 'partial';
  }
  if (status === 'completed' || status === 'failed' || status === 'running' || status === 'cancelled') {
    return status;
  }
  return 'running';
}

function formatTelegramWorkflowStatus(status) {
  switch (status) {
    case 'planning':
      return 'planning（规划中）';
    case 'running':
      return 'running（执行中）';
    case 'waiting_for_user':
      return 'waiting_for_user（等待 CEO 确认）';
    case 'completed':
      return 'completed（已完成）';
    case 'failed':
      return 'failed（失败）';
    case 'cancelled':
      return 'cancelled（已取消）';
    case 'partial':
      return 'partial（部分完成）';
    default:
      return `${status || 'unknown'}（状态未知）`;
  }
}

function summarizeTasksForPrompt(tasks) {
  return (tasks || []).map((task) => {
    const result = task.result ? ` — ${truncateInline(task.result, 140)}` : '';
    return `- ${task.id} [${getTaskDisplayStatus(task)}] ${task.title}${result}`;
  }).join('\n');
}

function findTask(workflowState, taskId) {
  return (workflowState.tasks || []).find((task) => task.id === taskId) || null;
}

export function buildTelegramCtoWorkerSystemPrompt({ workflowState, task }) {
  return [
    'You are a sandbox-side advisor session delegated by the host-level openCodex CTO supervisor.',
    'The CTO main thread is the sole orchestrator. You are a child helper, not the coordinator or the CEO-facing CTO identity.',
    'Execute only the assigned subtask, report concrete progress, and stop when the task scope is done or blocked.',
    'Reply to the maintainer in Simplified Chinese.',
    'Keep project content in English. Keep docs bilingual under docs/en and docs/zh when docs change.',
    'Prefer the smallest practical, reversible change and validate what you changed when reasonable.',
    `Workflow goal: ${truncateInline(workflowState?.goal_text || '', 160) || '(none)'}`,
    `Task id: ${task?.id || '(unknown)'}`,
    `Task title: ${task?.title || '(untitled)'}`,
    `Dependencies: ${(task?.depends_on || []).length ? task.depends_on.join(', ') : '(none)'}`
  ].join('\n');
}

export function buildTelegramCtoWorkerExecutionPrompt({ workflowState, task, fallbackMessageText = '' }) {
  return [
    buildTelegramCtoWorkerSystemPrompt({ workflowState, task }),
    '',
    'Worker directive from the CTO main thread:',
    asTrimmedString(task?.worker_prompt) || buildFallbackWorkerDirective({
      title: task?.title || 'Local task',
      fallbackMessageText
    })
  ].join('\n');
}

function buildFallbackWorkerDirective({ title = 'Local task', fallbackMessageText = '' }) {
  return [
    'Primary instruction from the CTO main thread:',
    fallbackMessageText || title,
    '',
    'Execution constraints:',
    '- Reply in Simplified Chinese.',
    '- Keep project content in English.',
    '- Keep docs bilingual under docs/en and docs/zh when docs change.',
    '- Prefer the smallest practical, reversible progress and validate what changed when reasonable.'
  ].join('\n');
}

function sanitizeTaskId(value, index) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);

  return normalized || `task-${index}`;
}

function ensureUniqueTaskId(baseId, seenIds, index) {
  if (!seenIds.has(baseId)) {
    return baseId;
  }

  let suffix = 2;
  while (seenIds.has(`${baseId}-${suffix}`)) {
    suffix += 1;
  }
  return `${baseId}-${suffix}` || `task-${index}`;
}

function normalizeTelegramIntentText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\(（\[【][^\)）\]】]{0,24}[\)）\]】]/g, '')
    .replace(/[\s,，。.!！?？、;；:：\-—_~～'"`]+/g, '')
    .trim();
}

function truncateInline(value, maxLength = 160) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function asTrimmedString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function asStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function dedupeList(values) {
  return [...new Set((values || []).map((item) => String(item || '').trim()).filter(Boolean))];
}

function extractTelegramQuestionHints(text) {
  return dedupeList([
    ...(String(text || '').toLowerCase().match(/[a-z][a-z0-9._/-]{2,}/g) || []),
    ...(String(text || '').match(/(?:重建当前工作流|重新派发该任务|继续调整当前工作流|可写环境|修改|service\.js|im\.js)/g) || [])
      .map((item) => item.toLowerCase())
  ]);
}
