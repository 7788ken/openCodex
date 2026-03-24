import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTextIfExists } from './fs.js';

export const CTO_PLANNER_SCHEMA_PATH = fileURLToPath(new URL('../../schemas/cto-workflow-plan.schema.json', import.meta.url));
export const DEFAULT_CTO_SOUL_RELATIVE_PATH = path.join('prompts', 'cto-soul.md');
export const DEFAULT_CTO_CHAT_SOUL_RELATIVE_PATH = path.join('prompts', 'cto-chat-soul.md');
export const DEFAULT_CTO_WORKFLOW_SOUL_RELATIVE_PATH = path.join('prompts', 'cto-workflow-soul.md');
export const DEFAULT_CTO_REPLY_AGENT_SOUL_RELATIVE_PATH = path.join('prompts', 'cto-reply-agent-soul.md');
export const DEFAULT_CTO_PLANNER_AGENT_SOUL_RELATIVE_PATH = path.join('prompts', 'cto-planner-agent-soul.md');
export const DEFAULT_CTO_WORKER_AGENT_SOUL_RELATIVE_PATH = path.join('prompts', 'cto-worker-agent-soul.md');
export const DEFAULT_CTO_HISTORY_REPAIR_STALE_MINUTES = 30;
const ctoSoulDocumentCache = new Map();
const ctoSubagentSoulDocumentCache = new Map();

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
const TELEGRAM_CTO_SOCIAL_CHAT_PATTERN = /(吃(?:饭|早饭|早餐|午饭|午餐|晚饭|晚餐)|睡了吗|睡了没|最近怎么样|最近还好吗|今天怎么样|累吗|忙吗|在干嘛|在做什么|下班了吗|休息了吗|晚安|早安|午安|下午好|周末过得怎么样|心情怎么样|天气怎么样)/i;
const TELEGRAM_CTO_PRAISE_PATTERN = /(厉害|真快|好快|秒回|牛|真牛|太强了|棒|真棒|赞|靠谱|给力|优秀|nice|awesome|great job)/i;
const TELEGRAM_CTO_STATUS_HINT_PATTERN = /(状态|进度|历史|最近任务|任务历史|workflow|工作流|task\s*history|workflow\s*status|task\s*status|安排了哪些任务)/i;
const TELEGRAM_CTO_COMPLETION_STATUS_QUERY_PATTERN = /^(?:(?:这个|上个|上一条|刚才那个)?(?:任务|事情|这事|这个)?(?:完成|做完|处理完|弄完)|好了)\s*(?:没|没有|吗|了吗)(?:[啊呀嘛吧呢]*)?(?:[。.!！?？~～\s]*)$/i;
const TELEGRAM_CTO_EXPLORATION_PATTERN = /(探讨|讨论|聊聊(?:架构|方案|思路|方向|路线)?|研究一下|研究下|一起想想|脑暴|brainstorm|trade[- ]?off|方案对比|路线对比|可行性|怎么设计|怎么看|为什么|why)/i;
const TELEGRAM_FORCE_EXECUTION_PATTERN = /(直接推进|直接开始|马上开始|立刻处理|现在就做|安排员工|进入编排|开始执行|马上执行|立即执行|go\s*ahead|execute\s*now|start\s*working|ship\s*it)/i;
const TELEGRAM_WORK_OBJECT_PATTERN = /(repo|code|bug|issue|test|ui|workflow|telegram|wechat|tray|session|service|prompt|agent|review|fix|build|docs?|readme|todo|roadmap|代码|仓库|任务|工作流|文档|架构|测试|修复|实现|功能|界面|命令|续跑|手机|微信)/i;
const TELEGRAM_CTO_INTERACTION_META_PATTERN = /((?:聊天|即时通讯).{0,8}主线|主线.{0,8}(?:聊天|chat|即时通讯)|聊天主线|主线聊天|主线\s*chat|聊天是主线|chat[-\s]*first|workflow.{0,10}不是主线|工作流.{0,10}不是主线|不要每句(?:话)?都触发工作流|不是每句(?:话)?都要触发工作流|自然回复|不要.{0,8}格式化回复|别.{0,8}格式化回复|默认推进|自行推进|自主完成|不要等我|别等我|高风险再确认|风险再确认|只在高风险时确认|任务不能自行推进|不能自主完成|编排.{0,12}没有达到.{0,6}要求)/i;
const TELEGRAM_CTO_INTERACTION_EXECUTION_PATTERN = /(继续处理|继续推进|默认推进|解决这些|落地|修一下|修复|优化|实现|改一下|调整|处理这些|按这个改|推进解决)/i;
const TELEGRAM_CTO_REQUIREMENT_LIST_PATTERN = /(?:^|[\s\n])(?:1[\.\)、,:：]|一[、：]|1[、：])/;
const TELEGRAM_CTO_EXPLICIT_CONTINUE_PATTERN = /^(?:(?:好|好的|行|可以|确认|收到|明白)[，,\s]*)?(?:继续|继续吧|继续推进|继续处理|继续执行|继续做|开始吧|开始执行|开始处理|按你说的做|照这个做|就这么做|就这样做|重建当前工作流|重新派发(?:该)?任务|继续调整当前工作流)(?:[。.!！?？~～\s]*)$/i;
const TELEGRAM_CTO_DECISION_REPLY_PATTERN = /^(?:是|否|可以|不可以|要|不要|继续|重建|重派|重新派发|先别|先不要|改吧|就这样)(?:[。.!！?？~～\s]|$)/i;
const TELEGRAM_CTO_STATUS_QUERY_OVERRIDE_PATTERN = /(继续|推进|推进项目|落地|优化|处理|修复|实现|开发|发布|上线|安排|开始|启动|执行|直接)/i;
const TELEGRAM_CTO_CONTEXTLESS_REFERENCE_PATTERN = /(这个问题|这个报错|这个错误|这个情况|这个现象|这个逻辑|这段代码|这段逻辑|这里的问题|这里报错|这里为啥|这里为什么|这块问题|这块逻辑|怎么回事|什么意思|啥情况|什么情况)/i;
const TELEGRAM_CTO_CONTEXTLESS_REQUEST_PATTERN = /(解释|说说|分析|看看|看下|看一下|帮我看|帮我分析|诊断|排查|拆解|怎么回事|什么意思|为什么|为啥|原因)/i;
const TELEGRAM_CTO_PREVIOUS_PENDING_QUESTION_REFERENCE_PATTERN = /((这个|那个|上个|上一条|刚才|刚刚|你刚才|你刚刚).{0,8}(待确认问题|问题))|解释一下这个待确认问题/i;
const TELEGRAM_SHORT_CASUAL_TEXTS = new Set([
  '嘿', '嗨', '哈喽', '哈啰', 'hello', 'hi', 'hey', 'yo',
  '在吗', '你在吗', '在不', '在嘛', '你好', '辛苦了', '早', '早安', '午安', '晚安'
]);
const TELEGRAM_CTO_WORKER_PERSONA_POOL = Object.freeze([
  { name_zh: '阿杭', name_en: 'Hang', vibe_zh: '动手快、汇报实在的工程搭子。', vibe_en: 'A practical implementation partner who moves quickly and reports honestly.' },
  { name_zh: '阿宁', name_en: 'Ning', vibe_zh: '稳一点，先把边界和回滚想清楚。', vibe_en: 'A steady operator who thinks through boundaries and rollback paths first.' },
  { name_zh: '阿岳', name_en: 'Yue', vibe_zh: '擅长把杂事拆顺，推进不拖泥带水。', vibe_en: 'Good at untangling messy work and pushing it forward cleanly.' },
  { name_zh: '阿澈', name_en: 'Che', vibe_zh: '偏爱清晰实现和直接验证，不说空话。', vibe_en: 'Prefers clear implementations and direct validation over fluff.' },
  { name_zh: '阿朴', name_en: 'Pu', vibe_zh: '改动克制，先做最小可回滚的一步。', vibe_en: 'Keeps changes restrained and starts with the smallest reversible step.' },
  { name_zh: '阿原', name_en: 'Yuan', vibe_zh: '先摸清现场，再下手，不乱猜。', vibe_en: 'Maps the terrain before acting and avoids guessing.' }
]);
const TELEGRAM_CTO_TONE_GUARD_MARKER_PATTERN = /^(?:title|status|result|highlights?|next steps?|risks?|validation|changed files?|findings|交付摘要|关键改动|验证记录|风险提醒|下一步建议)\s*[：:]/i;
const TELEGRAM_CTO_TONE_GUARD_EN_BOILERPLATE_PATTERN = /\b(?:completed successfully|as requested|please let me know|report summary|validation record)\b/i;

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

function matchesTelegramCtoStatusHint(text) {
  const rawText = String(text || '').trim();
  if (!rawText) {
    return false;
  }
  return TELEGRAM_CTO_STATUS_HINT_PATTERN.test(rawText)
    || TELEGRAM_CTO_COMPLETION_STATUS_QUERY_PATTERN.test(rawText);
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
  const nowIso = new Date().toISOString();
  const workflowState = {
    workflow_session_id: workflowSessionId,
    related_workflow_id: relatedWorkflowId,
    provider: 'telegram',
    chat_id: message.chat_id,
    source_update_id: message.update_id,
    source_message_id: message.message_id,
    sender_display: message.sender_display,
    goal_text: message.text,
    latest_user_message: message.text,
    created_at: nowIso,
    updated_at: nowIso,
    status: 'planning',
    plan_mode: 'execute',
    plan_summary_zh: '',
    pending_question_zh: '',
    task_counter: 0,
    tasks: [],
    long_tasks: [],
    short_tasks: [],
    user_messages: [
      {
        update_id: message.update_id,
        message_id: message.message_id,
        text: message.text,
        created_at: message.created_at
      }
    ]
  };
  return refreshTelegramWorkflowTaskViews(workflowState);
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
  refreshTelegramWorkflowTaskViews(workflowState);
}

export function buildTelegramCtoAutoReplyText(message, continuation = false) {
  const preview = truncateInline(message.text, 120);
  if (continuation) {
    return `继续处理这轮补充：${preview}`;
  }
  return `开始处理这件事：${preview}`;
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

  if (isTelegramCtoInteractionPolicyDiscussion(rawText)
    && !isTelegramCtoConcreteInteractionExecutionRequest(rawText)
    && !TELEGRAM_FORCE_EXECUTION_PATTERN.test(rawText)) {
    return {
      kind: 'exploration',
      label_zh: '交互策略讨论',
      reason_zh: '更像在讨论聊天主线、编排方式、确认门槛或回复风格，不必立刻进入工作流。'
    };
  }

  if (matchesTelegramCtoStatusHint(rawText)
    && !TELEGRAM_CTO_STATUS_QUERY_OVERRIDE_PATTERN.test(rawText)
    && !TELEGRAM_FORCE_EXECUTION_PATTERN.test(rawText)
    && !TELEGRAM_CTO_EXPLICIT_CONTINUE_PATTERN.test(rawText)) {
    return {
      kind: 'status_query',
      label_zh: '状态/历史查询',
      reason_zh: '命中了状态、工作流或任务历史关键词。'
    };
  }

  if (TELEGRAM_CTO_CASUAL_CHAT_PATTERN.test(rawText)
    || TELEGRAM_CTO_GREETING_PATTERN.test(rawText)
    || (TELEGRAM_CTO_PRAISE_PATTERN.test(rawText)
      && !TELEGRAM_EXECUTION_HINT_PATTERN.test(rawText)
      && !TELEGRAM_ANALYSIS_INTENT_PATTERN.test(rawText)
      && !matchesTelegramCtoStatusHint(rawText))
    || isLikelyTelegramCtoSocialChatMessage(rawText)
    || TELEGRAM_SHORT_CASUAL_TEXTS.has(compactText)
    || (compactText.length <= 6 && TELEGRAM_SHORT_CASUAL_TEXTS.has(compactText))) {
    return {
      kind: 'casual_chat',
      label_zh: '轻聊天 / 寒暄',
      reason_zh: '更像打招呼、陪聊或轻反馈，不像执行请求。'
    };
  }

  if (TELEGRAM_CTO_EXPLORATION_PATTERN.test(rawText) && !TELEGRAM_FORCE_EXECUTION_PATTERN.test(rawText)) {
    return {
      kind: 'exploration',
      label_zh: '聊天 / 探讨 / 研究',
      reason_zh: '更像讨论方案、研究方向或共同推演，不必立即进入任务编排。'
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

export function isLikelyTelegramCtoSocialChatMessage(text) {
  const rawText = String(text || '').trim();
  if (!rawText) {
    return false;
  }

  if (matchesTelegramCtoStatusHint(rawText)
    || TELEGRAM_EXECUTION_HINT_PATTERN.test(rawText)
    || TELEGRAM_ANALYSIS_INTENT_PATTERN.test(rawText)
    || TELEGRAM_REASONING_TARGET_PATTERN.test(rawText)
    || TELEGRAM_ARCHITECTURE_TARGET_PATTERN.test(rawText)
    || TELEGRAM_CTO_EXPLORATION_PATTERN.test(rawText)
    || TELEGRAM_FORCE_EXECUTION_PATTERN.test(rawText)
    || TELEGRAM_WORK_OBJECT_PATTERN.test(rawText)) {
    return false;
  }

  if (TELEGRAM_CTO_SOCIAL_CHAT_PATTERN.test(rawText)) {
    return true;
  }

  return /^你(?:最近|今天|现在|刚刚)?[^。！!?？]{0,24}(?:吗|嘛|呢)[。！!?？]?$/i.test(rawText);
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

function isTelegramCtoInteractionPolicyDiscussion(text) {
  return TELEGRAM_CTO_INTERACTION_META_PATTERN.test(String(text || '').trim());
}

function isTelegramCtoConcreteInteractionExecutionRequest(text) {
  const rawText = String(text || '').trim();
  if (!rawText || !isTelegramCtoInteractionPolicyDiscussion(rawText)) {
    return false;
  }

  return TELEGRAM_CTO_INTERACTION_EXECUTION_PATTERN.test(rawText)
    && (TELEGRAM_CTO_REQUIREMENT_LIST_PATTERN.test(rawText)
      || /解决这些|默认推进|落地|修复|优化|实现|改一下|调整/.test(rawText));
}

function isContextMissingTelegramCtoRequest(text) {
  const rawText = String(text || '').trim();
  if (!rawText) {
    return false;
  }

  if (TELEGRAM_FORCE_EXECUTION_PATTERN.test(rawText)
    || TELEGRAM_CTO_EXPLICIT_CONTINUE_PATTERN.test(rawText)
    || isStrongTelegramCtoDirectiveMessage(rawText)) {
    return false;
  }

  return TELEGRAM_CTO_CONTEXTLESS_REFERENCE_PATTERN.test(rawText)
    && TELEGRAM_CTO_CONTEXTLESS_REQUEST_PATTERN.test(rawText);
}

function referencesTelegramPreviousPendingQuestion(text, chatState = null) {
  const rawText = String(text || '').trim();
  if (!rawText) {
    return false;
  }

  return Boolean(asTrimmedString(chatState?.last_pending_question))
    && TELEGRAM_CTO_PREVIOUS_PENDING_QUESTION_REFERENCE_PATTERN.test(rawText);
}

export function shouldKeepTelegramCtoInConversationMode({ text, chatState = null, hasPendingWorkflow = false, hasActiveWorkflow = false }) {
  const intent = classifyTelegramCtoMessageIntent(text);
  if (intent.kind === 'empty') {
    return true;
  }
  if (isTelegramCtoInteractionPolicyDiscussion(text)
    && !isTelegramCtoConcreteInteractionExecutionRequest(text)
    && !TELEGRAM_FORCE_EXECUTION_PATTERN.test(String(text || '').trim())) {
    return true;
  }
  if (intent.kind === 'status_query') {
    return false;
  }
  if (intent.kind === 'casual_chat') {
    return isGreetingLikeTelegramCtoMessage(text);
  }
  if (intent.kind === 'exploration') {
    return true;
  }
  if (referencesTelegramPreviousPendingQuestion(text, chatState)) {
    return true;
  }
  if (isContextMissingTelegramCtoRequest(text)) {
    return true;
  }
  if (hasPendingWorkflow && isVagueTelegramCtoDirectiveMessage(text)) {
    return true;
  }
  if (hasActiveWorkflow && !hasPendingWorkflow && isVagueTelegramCtoDirectiveMessage(text)) {
    return true;
  }
  if (isStrongTelegramCtoDirectiveMessage(text)) {
    return false;
  }

  const lastMode = String(chatState?.last_mode || '').trim();
  const hasConversationContinuity = Number(chatState?.direct_reply_count || 0) < 1
    || lastMode === 'conversation'
    || lastMode === 'exploration';

  return hasConversationContinuity && isVagueTelegramCtoDirectiveMessage(text);
}

function isGreetingLikeTelegramCtoMessage(text) {
  const rawText = String(text || '').trim();
  if (!rawText) {
    return false;
  }
  const compactText = normalizeTelegramIntentText(rawText);
  return TELEGRAM_CTO_GREETING_PATTERN.test(rawText)
    || TELEGRAM_CTO_CASUAL_CHAT_PATTERN.test(rawText)
    || TELEGRAM_SHORT_CASUAL_TEXTS.has(compactText)
    || (compactText.length <= 6 && TELEGRAM_SHORT_CASUAL_TEXTS.has(compactText));
}

export function isLikelyTelegramCtoCasualChatMessage(text) {
  return classifyTelegramCtoMessageIntent(text).kind === 'casual_chat';
}

export function buildTelegramCtoDirectReplyPrompt({
  message,
  pendingWorkflowState = null,
  activeWorkflowState = null,
  soulText = '',
  soulPath = '',
  modeSoulText = '',
  modeSoulPath = '',
  agentSoulText = '',
  agentSoulPath = '',
  replyMode = 'casual',
  chatState = null
}) {
  const agentProfile = resolveTelegramCtoSubagentProfile({ kind: 'reply', replyMode });
  const lines = [
    buildTelegramCtoMainThreadSystemPrompt({
      mode: 'chat',
      baseSoulText: soulText,
      baseSoulPath: soulPath,
      modeSoulText,
      modeSoulPath
    }),
    '',
    buildTelegramCtoSubagentIdentityBlock({
      profile: agentProfile,
      soulText: agentSoulText,
      soulPath: agentSoulPath
    }),
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
    'Put the outcome or direct answer in the first sentence.',
    'Avoid filler phrases that do not change the decision, such as ceremonial openings or repeated assurances.',
    'If the CEO needs to do something next, end with one explicit next action.',
    'The `result` field must be a natural chat reply, not a report.',
    'Do not use headings, labels, numbered sections, bullets, markdown, workflow summaries, or template wrappers inside `result`.',
    'Prefer one short paragraph. Only split into two very short paragraphs if that reads more naturally.',
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
    if (isContextMissingTelegramCtoRequest(message?.text)) {
      lines.push(
        'The message points to a problem, error, or situation without enough context.',
        'Ask for the concrete error text, symptom, related file path, or screenshot/log in one short natural sentence.'
      );
    }
    if (referencesTelegramPreviousPendingQuestion(message?.text, chatState)) {
      lines.push(
        'The CEO is referring to your immediately previous pending question, not opening a new workflow.',
        `Previous pending question: ${truncateInline(asTrimmedString(chatState?.last_pending_question), 220)}`,
        'Explain that pending question directly in plain Chinese.',
        'Do not ask which pending question they mean unless the reference is still ambiguous after using the previous question above.'
      );
    }
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
  } else if (activeWorkflowState?.workflow_session_id) {
    lines.push(
      '',
      'There is an active CTO workflow still running in the background for this chat.',
      `Workflow: ${activeWorkflowState.workflow_session_id}`,
      `Workflow status: ${asTrimmedString(activeWorkflowState.status) || '(unknown)'}`,
      `Workflow goal: ${truncateInline(asTrimmedString(activeWorkflowState.goal_text), 220) || '(none)'}`,
      'Make it clear that the running workflow remains active in the background and this chat does not block it.',
      'Keep the conversation on the same main line instead of acting like this is a brand-new detached chat.'
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
  const variant = normalizeCtoSoulVariant(options.variant);
  const overridePath = String(options.path || process.env.OPENCODEX_CTO_SOUL_PATH || '').trim();
  const cacheKey = `${resolvedCwd}::${overridePath || '(default)'}::${variant}`;
  if (ctoSoulDocumentCache.has(cacheKey)) {
    return ctoSoulDocumentCache.get(cacheKey);
  }
  const candidatePaths = [];

  if (overridePath) {
    const resolvedOverridePath = path.isAbsolute(overridePath) ? overridePath : path.resolve(resolvedCwd, overridePath);
    candidatePaths.push(resolveCtoSoulVariantPath(resolvedOverridePath, variant));
  }
  candidatePaths.push(path.resolve(resolvedCwd, getDefaultCtoSoulRelativePath(variant)));

  for (const candidatePath of candidatePaths) {
    const text = (await readTextIfExists(candidatePath))?.trim() || '';
    if (text) {
      const resolvedDocument = {
        path: candidatePath,
        display_path: path.relative(resolvedCwd, candidatePath) || path.basename(candidatePath),
        text,
        builtin: false,
        variant
      };
      ctoSoulDocumentCache.set(cacheKey, resolvedDocument);
      return resolvedDocument;
    }
  }

  const builtinDocument = {
    path: path.resolve(resolvedCwd, getDefaultCtoSoulRelativePath(variant)),
    display_path: getDefaultCtoSoulRelativePath(variant),
    text: buildDefaultCtoSoulDocument(variant),
    builtin: true,
    variant
  };
  ctoSoulDocumentCache.set(cacheKey, builtinDocument);
  return builtinDocument;
}

export async function loadCtoSoulBundle(cwd = process.cwd(), options = {}) {
  const base = await loadCtoSoulDocument(cwd, { ...options, variant: 'base' });
  const chat = await loadCtoSoulDocument(cwd, { path: base.path, variant: 'chat' });
  const workflow = await loadCtoSoulDocument(cwd, { path: base.path, variant: 'workflow' });
  return { base, chat, workflow };
}

export async function loadCtoSubagentSoulDocument(cwd = process.cwd(), options = {}) {
  const resolvedCwd = path.resolve(cwd || process.cwd());
  const kind = normalizeCtoSubagentKind(options.kind);
  const overridePath = String(options.path || process.env.OPENCODEX_CTO_SOUL_PATH || '').trim();
  const cacheKey = `${resolvedCwd}::${overridePath || '(default)'}::${kind}`;
  if (ctoSubagentSoulDocumentCache.has(cacheKey)) {
    return ctoSubagentSoulDocumentCache.get(cacheKey);
  }
  const candidatePaths = [];

  if (overridePath) {
    const resolvedOverridePath = path.isAbsolute(overridePath) ? overridePath : path.resolve(resolvedCwd, overridePath);
    candidatePaths.push(resolveCtoSubagentSoulPath(resolvedOverridePath, kind));
  }
  candidatePaths.push(path.resolve(resolvedCwd, getDefaultCtoSubagentSoulRelativePath(kind)));

  for (const candidatePath of candidatePaths) {
    const text = (await readTextIfExists(candidatePath))?.trim() || '';
    if (text) {
      const resolvedDocument = {
        path: candidatePath,
        display_path: path.relative(resolvedCwd, candidatePath) || path.basename(candidatePath),
        text,
        builtin: false,
        kind
      };
      ctoSubagentSoulDocumentCache.set(cacheKey, resolvedDocument);
      return resolvedDocument;
    }
  }

  const builtinDocument = {
    path: path.resolve(resolvedCwd, getDefaultCtoSubagentSoulRelativePath(kind)),
    display_path: getDefaultCtoSubagentSoulRelativePath(kind),
    text: buildDefaultCtoSubagentSoulDocument(kind),
    builtin: true,
    kind
  };
  ctoSubagentSoulDocumentCache.set(cacheKey, builtinDocument);
  return builtinDocument;
}

export function buildDefaultCtoSoulDocument(variant = 'base') {
  const normalizedVariant = normalizeCtoSoulVariant(variant);
  if (normalizedVariant === 'chat') {
    return buildDefaultCtoChatSoulDocument();
  }
  if (normalizedVariant === 'workflow') {
    return buildDefaultCtoWorkflowSoulDocument();
  }
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
    '- Keep CEO-facing Chinese plain, natural, and concise across chat replies, workflow summaries, and confirmation questions.',
    '- Avoid jargon-heavy, bureaucratic, or report-style wording unless the CEO explicitly asks for that format.',
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

export function buildDefaultCtoSubagentSoulDocument(kind = 'worker') {
  const normalizedKind = normalizeCtoSubagentKind(kind);
  if (normalizedKind === 'reply') {
    return buildDefaultCtoReplyAgentSoulDocument();
  }
  if (normalizedKind === 'planner') {
    return buildDefaultCtoPlannerAgentSoulDocument();
  }
  return buildDefaultCtoWorkerAgentSoulDocument();
}

export function buildDefaultCtoChatSoulDocument() {
  return [
    '# openCodex CTO Chat Soul',
    '',
    'This overlay only applies when the CTO main thread is staying in chat, casual reply, or exploration mode.',
    '',
    '## Chat Priority',
    '- Treat chat as the default control surface and primary continuity thread.',
    '- Keep chat as the main line even when background workflows are already running.',
    '- Prefer a natural, direct answer before considering workflow creation.',
    '- Do not create tasks just because the user is warm, vague, or thinking aloud.',
    '',
    '## Tone',
    '- Reply in a warm, grounded, concise way.',
    '- Avoid bureaucratic summaries, heavy templates, and premature TODO lists.',
    '- If the user is casually checking in, reply like a person, not a dispatcher.',
    '',
    '## Escalation Into Workflow',
    '- Only suggest orchestration when the user shows a concrete execution intent, asks for implementation, or wants progress on real work.',
    '- If the request is still vague, ask one short clarifying question instead of spawning a workflow.',
    '- If there is already a waiting workflow, keep the reply anchored to that existing thread instead of creating a new one.'
  ].join('\n');
}

export function buildDefaultCtoWorkflowSoulDocument() {
  return [
    '# openCodex CTO Workflow Soul',
    '',
    'This overlay only applies when the CTO main thread is planning, resuming, or supervising workflow execution.',
    '',
    '## Workflow Priority',
    '- Treat workflow orchestration as a branch triggered by the main chat thread, not as the default response mode.',
    '- A running workflow must never block the main chat thread; execution happens in the background while the CTO keeps talking on the same line.',
    '- When execution is justified, move decisively: infer the safest high-leverage path and start with the smallest meaningful task set.',
    '- Keep workflow state coherent so the CEO can always tell what is running, waiting, blocked, or complete.',
    '- Keep workflow-facing Chinese updates plain and concise so progress and decisions are understandable at a glance.',
    '',
    '## Planning Discipline',
    '- Prefer 1-4 concrete tasks at a time.',
    '- Keep tasks scoped, independently executable, and easy to resume.',
    '- Use waiting questions only when the next branch materially changes execution or external side effects.',
    '',
    '## Delegation Discipline',
    '- Child sessions are helpers, not coordinators.',
    '- Worker prompts should be explicit enough that the child does not need to invent policy.',
    '- Preserve chat-thread continuity by linking workflow output back to the main thread whenever possible.',
    '- If a waiting question is needed, phrase it in one short natural Chinese sentence without report formatting.'
  ].join('\n');
}

export function buildDefaultCtoReplyAgentSoulDocument() {
  return [
    '# openCodex CTO Reply Agent Soul',
    '',
    'This soul applies to the child agent that drafts direct CEO replies for the CTO main thread.',
    '',
    '## Role',
    '- Stay natural, grounded, and conversational.',
    '- Do not sound like a task dispatcher during casual chat.',
    '- If the message is vague, help clarify it in one short, human question.',
    '- Put the direct outcome first so the CEO can scan the decision immediately.',
    '- Keep the structure compact: one short paragraph, at most 2 short sentences.',
    '- Remove filler and opening politeness padding that does not change the decision.',
    '- If the CEO must act, end with one explicit next action in plain Chinese.',
    '',
    '## Boundaries',
    '- Do not silently escalate light chat into orchestration.',
    '- Respect an existing waiting workflow and point back to it when needed.',
    '- Keep replies short, warm, and practical.',
    '- Do not use headings, bullets, markdown wrappers, or report-style templates in direct control replies.'
  ].join('\n');
}

export function buildDefaultCtoPlannerAgentSoulDocument() {
  return [
    '# openCodex CTO Planner Agent Soul',
    '',
    'This soul applies to the child agent that drafts workflow plans for the CTO main thread.',
    '',
    '## Role',
    '- Think like a grounded project lead, not a grand strategist.',
    '- Prefer the next 1-4 concrete tasks over oversized master plans.',
    '- Keep plans easy to resume and easy to explain back to the CEO.',
    '- When you draft Chinese summary or question text for the CTO to forward, keep it plain, natural, and concise.',
    '',
    '## Boundaries',
    '- You are not the CEO-facing CTO identity.',
    '- Do not invent broad strategy when a smaller safe execution path is obvious.',
    '- Ask for confirmation only when the next branch materially changes execution or external effects.',
    '- Avoid report-style boilerplate and heavy jargon in CEO-facing Chinese phrasing.'
  ].join('\n');
}

export function buildDefaultCtoWorkerAgentSoulDocument() {
  return [
    '# openCodex CTO Worker Agent Soul',
    '',
    'This soul applies to child worker agents that execute concrete subtasks under the CTO main thread.',
    '',
    '## Role',
    '- Behave like a practical engineer or operator who owns one scoped task at a time.',
    '- Prefer the smallest reversible change that proves progress.',
    '- Validate what changed and report blockers plainly.',
    '',
    '## Boundaries',
    '- Do not take over orchestration.',
    '- Do not rewrite task scope or invent policy.',
    '- Stop when the assigned task is done, blocked, or needs a supervisor decision.'
  ].join('\n');
}

export function buildTelegramCtoMainThreadSystemPrompt({
  continuation = false,
  soulText = '',
  soulPath = '',
  baseSoulText = '',
  baseSoulPath = '',
  modeSoulText = '',
  modeSoulPath = '',
  mode = 'workflow'
} = {}) {
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
    'Keep `summary_zh` and `question_zh` plain, natural, and concise for direct CEO reading on Telegram.',
    'Use English for task titles and worker prompts.',
    'Create 1-4 concrete tasks at a time. Prefer parallel tasks when dependencies allow.',
    'Default to autonomous progress: when a safe local path is obvious, choose `execute` and keep the work moving without waiting for the CEO.',
    'Use `confirm` only for destructive or external side effects, missing external access, or a material strategy fork.',
    'You must personally generate and edit every worker prompt. Do not ask workers to invent their own mission.',
    'Each worker prompt must be self-contained, minimal, reversible, and executable by a child agent without extra clarification.',
    'Workers reply in Simplified Chinese. Project artifacts stay in English, and docs remain bilingual under docs/en and docs/zh.',
    'Infer the CEO intent from context when the request is broad but still actionable; do not ask for clarification if a safe, high-leverage default path is obvious.',
    'For requests to inspect, review, analyze, audit, prioritize, or improve, start with the most likely safe analysis task instead of bouncing the request back.',
    continuation
      ? 'Do not recreate finished tasks. Only create the next executable tasks needed after the CEO response.'
      : 'Ask one concise Chinese question only when ambiguity would materially change the execution path or create a meaningful external risk.'
  ];

  const normalizedBaseSoulText = String(baseSoulText || soulText || '').trim();
  const normalizedBaseSoulPath = String(baseSoulPath || soulPath || '').trim();
  if (normalizedBaseSoulText) {
    lines.push('', normalizedBaseSoulPath
      ? `Active CTO base soul document (${normalizedBaseSoulPath}):`
      : 'Active CTO base soul document:', normalizedBaseSoulText);
  }

  const normalizedModeSoulText = String(modeSoulText || '').trim();
  const normalizedModeSoulPath = String(modeSoulPath || '').trim();
  if (normalizedModeSoulText) {
    const modeLabel = mode === 'chat' ? 'chat-mode' : 'workflow-mode';
    lines.push('', normalizedModeSoulPath
      ? `Active CTO ${modeLabel} soul document (${normalizedModeSoulPath}):`
      : `Active CTO ${modeLabel} soul document:`, normalizedModeSoulText);
  }

  return lines.join('\n');
}

export function buildTelegramCtoPlannerPrompt({
  message,
  workflowState,
  continuationMessage = null,
  soulText = '',
  soulPath = '',
  modeSoulText = '',
  modeSoulPath = '',
  agentSoulText = '',
  agentSoulPath = ''
}) {
  const agentProfile = resolveTelegramCtoSubagentProfile({ kind: 'planner' });
  const completedTaskLines = summarizeTasksForPrompt(workflowState.tasks || []);
  const historyLines = (workflowState.user_messages || [])
    .slice(-4)
    .map((item, index) => `${index + 1}. ${item.text}`);

  if (continuationMessage) {
    return [
      buildTelegramCtoMainThreadSystemPrompt({
        continuation: true,
        mode: 'workflow',
        baseSoulText: soulText,
        baseSoulPath: soulPath,
        modeSoulText,
        modeSoulPath
      }),
      '',
      buildTelegramCtoSubagentIdentityBlock({
        profile: agentProfile,
        soulText: agentSoulText,
        soulPath: agentSoulPath
      }),
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
    buildTelegramCtoMainThreadSystemPrompt({
      mode: 'workflow',
      baseSoulText: soulText,
      baseSoulPath: soulPath,
      modeSoulText,
      modeSoulPath
    }),
    '',
    buildTelegramCtoSubagentIdentityBlock({
      profile: agentProfile,
      soulText: agentSoulText,
      soulPath: agentSoulPath
    }),
    '',
    'Telegram message:',
    message.text
  ].join('\n');
}

export function buildTelegramCtoWorkflowReplyPrompt({
  workflowState,
  replyKind = 'status',
  messageText = '',
  soulText = '',
  soulPath = '',
  modeSoulText = '',
  modeSoulPath = '',
  agentSoulText = '',
  agentSoulPath = ''
}) {
  const agentProfile = resolveTelegramCtoSubagentProfile({ kind: 'reply', replyMode: 'conversation' });
  const facts = buildTelegramCtoWorkflowReplyFacts(workflowState);
  const lines = [
    buildTelegramCtoMainThreadSystemPrompt({
      mode: 'workflow',
      baseSoulText: soulText,
      baseSoulPath: soulPath,
      modeSoulText,
      modeSoulPath
    }),
    '',
    buildTelegramCtoSubagentIdentityBlock({
      profile: agentProfile,
      soulText: agentSoulText,
      soulPath: agentSoulPath
    }),
    '',
    'Workflow reply mode: Telegram CTO workflow-facing reply.',
    `Reply kind: ${String(replyKind || 'status').trim() || 'status'}`,
    'You are drafting the final Telegram text that the CEO will read.',
    'Use the workflow facts below and write the reply in natural Simplified Chinese.',
    'Do not use report headers, markdown wrappers, numbered sections, or rigid template language inside `result`.',
    'Do not use internal project jargon such as “拍板”, “收口”, “编排”, or “续跑” unless the CEO used the same wording first.',
    'Sound like a capable human assistant, not like a dashboard or a ticketing system.',
    'Say the most important outcome first.',
    'Only mention the few facts that matter right now; do not dump the whole task table.',
    'If user confirmation is needed, say plainly what needs to be confirmed.',
    'If work is complete, say plainly what is done and what changed only if it helps the CEO.',
    'Keep the reply compact: usually 2-6 short lines.',
    'Return JSON that matches the provided schema.',
    'Set `title` to `Telegram CTO workflow reply`.',
    'Set `status` to `completed`.',
    'Put the final Telegram reply text in `result`.',
    'Leave `highlights`, `next_steps`, `risks`, `validation`, `changed_files`, and `findings` empty arrays.',
    '',
    'Trigger message:',
    truncateInline(asTrimmedString(messageText) || '(none)', 220) || '(none)',
    '',
    'Workflow facts (JSON):',
    JSON.stringify(facts, null, 2)
  ];

  if (replyKind === 'status') {
    lines.push(
      '',
      'For a status reply:',
      '- First say where the current main line stands.',
      '- Mention only the most relevant short tasks if helpful.',
      '- If the workflow is waiting for input, clearly say what needs confirmation.'
    );
  } else if (replyKind === 'question') {
    lines.push(
      '',
      'For a confirmation/question reply:',
      '- Say progress has reached a point where one confirmation is needed.',
      '- State the exact question in plain Chinese.',
      '- Briefly mention what is already done only if it helps the CEO decide.'
    );
  } else if (replyKind === 'final') {
    lines.push(
      '',
      'For a final reply:',
      '- Start with whether this round is done, paused, cancelled, partial, or failed.',
      '- Summarize the most important completed work or blocker.',
      '- Mention next action only if it is truly needed.'
    );
  }

  return lines.join('\n');
}

function normalizeCtoSoulVariant(variant) {
  return ['chat', 'workflow'].includes(String(variant || '').trim()) ? String(variant).trim() : 'base';
}

function buildTelegramCtoWorkflowReplyFacts(workflowState) {
  refreshTelegramWorkflowTaskViews(workflowState);
  const counts = summarizeWorkflowCounts(workflowState);
  const mainlineTask = Array.isArray(workflowState?.long_tasks) ? workflowState.long_tasks[0] : null;
  const shortTasks = Array.isArray(workflowState?.short_tasks) ? workflowState.short_tasks : [];
  const tasks = Array.isArray(workflowState?.tasks) ? workflowState.tasks : [];
  const changedFiles = collectWorkflowChangedFiles(workflowState).slice(0, 6);
  const nextSteps = collectWorkflowNextSteps(workflowState).slice(0, 4);

  return {
    workflow_session_id: asTrimmedString(workflowState?.workflow_session_id) || '',
    workflow_status: asTrimmedString(workflowState?.status) || '',
    goal_text: asTrimmedString(workflowState?.goal_text) || '',
    plan_summary_zh: asTrimmedString(workflowState?.plan_summary_zh) || '',
    pending_question_zh: asTrimmedString(workflowState?.pending_question_zh) || '',
    updated_at: asTrimmedString(workflowState?.updated_at) || '',
    counts,
    mainline: mainlineTask ? {
      title_zh: asTrimmedString(mainlineTask.title_zh) || '',
      summary_zh: asTrimmedString(mainlineTask.summary_zh) || '',
      next_step_zh: asTrimmedString(mainlineTask.next_step_zh) || '',
      status: asTrimmedString(mainlineTask.status) || ''
    } : null,
    short_tasks: shortTasks.slice(0, 4).map((task) => ({
      title: asTrimmedString(task?.title) || '',
      status: asTrimmedString(task?.status) || '',
      summary_zh: asTrimmedString(task?.summary_zh) || ''
    })),
    completed_tasks: tasks
      .filter((task) => task?.status === 'completed')
      .slice(0, 4)
      .map((task) => buildTelegramCtoFinalTaskLine(task)),
    issue_tasks: tasks
      .filter((task) => task?.status === 'partial' || task?.status === 'failed')
      .slice(0, 4)
      .map((task) => buildTelegramCtoFinalTaskLine(task)),
    changed_files: changedFiles,
    next_steps: nextSteps,
    recent_tasks: tasks.slice(-6).map((task) => ({
      id: asTrimmedString(task?.id) || '',
      title: asTrimmedString(task?.title) || '',
      status: asTrimmedString(task?.status) || '',
      result: truncateInline(normalizeTelegramCtoFinalTaskResultText(task?.result, {
        status: task?.status,
        changedFiles: asStringList(task?.changed_files)
      }), 180),
      next_step: truncateInline(normalizeTelegramCtoFinalNextStepText(asStringList(task?.next_steps)[0] || ''), 180)
    }))
  };
}

function getDefaultCtoSoulRelativePath(variant) {
  if (variant === 'chat') {
    return DEFAULT_CTO_CHAT_SOUL_RELATIVE_PATH;
  }
  if (variant === 'workflow') {
    return DEFAULT_CTO_WORKFLOW_SOUL_RELATIVE_PATH;
  }
  return DEFAULT_CTO_SOUL_RELATIVE_PATH;
}

export function resolveCtoSoulVariantPath(basePath, variant = 'base') {
  const normalizedVariant = normalizeCtoSoulVariant(variant);
  if (normalizedVariant === 'base') {
    return basePath;
  }
  const dir = path.dirname(basePath);
  const filename = normalizedVariant === 'chat' ? 'cto-chat-soul.md' : 'cto-workflow-soul.md';
  return path.join(dir, filename);
}

function normalizeCtoSubagentKind(kind) {
  return ['reply', 'planner'].includes(String(kind || '').trim()) ? String(kind).trim() : 'worker';
}

function getDefaultCtoSubagentSoulRelativePath(kind) {
  const normalizedKind = normalizeCtoSubagentKind(kind);
  if (normalizedKind === 'reply') {
    return DEFAULT_CTO_REPLY_AGENT_SOUL_RELATIVE_PATH;
  }
  if (normalizedKind === 'planner') {
    return DEFAULT_CTO_PLANNER_AGENT_SOUL_RELATIVE_PATH;
  }
  return DEFAULT_CTO_WORKER_AGENT_SOUL_RELATIVE_PATH;
}

export function resolveCtoSubagentSoulPath(basePath, kind = 'worker') {
  const normalizedKind = normalizeCtoSubagentKind(kind);
  const dir = path.dirname(basePath);
  if (normalizedKind === 'reply') {
    return path.join(dir, 'cto-reply-agent-soul.md');
  }
  if (normalizedKind === 'planner') {
    return path.join(dir, 'cto-planner-agent-soul.md');
  }
  return path.join(dir, 'cto-worker-agent-soul.md');
}

export function resolveTelegramCtoSubagentProfile({ kind = 'worker', task = null, replyMode = 'casual' } = {}) {
  const normalizedKind = normalizeCtoSubagentKind(kind);
  if (normalizedKind === 'reply') {
    if (replyMode === 'exploration') {
      return {
        kind: 'reply',
        name_zh: '阿研',
        name_en: 'Yan',
        role_zh: '讨论型回复搭子',
        role_en: 'discussion reply partner',
        vibe_zh: '擅长把想法聊清楚，不把闲聊硬拐成任务编排。',
        vibe_en: 'Good at talking ideas through without force-converting every exchange into orchestration.'
      };
    }
    if (replyMode === 'conversation') {
      return {
        kind: 'reply',
        name_zh: '阿桥',
        name_en: 'Qiao',
        role_zh: '意图澄清搭子',
        role_en: 'intent clarification partner',
        vibe_zh: '会先把话接住，再用一句人话问清该从哪条线开始。',
        vibe_en: 'Catches the thread first, then asks one natural clarifying question when needed.'
      };
    }
    return {
      kind: 'reply',
      name_zh: '阿满',
      name_en: 'Man',
      role_zh: '日常回复搭子',
      role_en: 'everyday reply partner',
      vibe_zh: '像个靠谱又不端着的产品伙计，接话自然，不装腔作势。',
      vibe_en: 'A grounded product-minded partner who replies naturally and without ceremony.'
    };
  }

  if (normalizedKind === 'planner') {
    return {
      kind: 'planner',
      name_zh: '阿周',
      name_en: 'Zhou',
      role_zh: '排程规划搭子',
      role_en: 'planning partner',
      vibe_zh: '像项目群里最靠谱的排期同事，先把下一步安排顺，再动手。',
      vibe_en: 'Feels like the most reliable planning partner in a project chat: line up the next steps cleanly before moving.'
    };
  }

  const selected = TELEGRAM_CTO_WORKER_PERSONA_POOL[computeDeterministicIndex(String(task?.id || task?.title || 'worker'), TELEGRAM_CTO_WORKER_PERSONA_POOL.length)];
  return {
    kind: 'worker',
    name_zh: selected.name_zh,
    name_en: selected.name_en,
    role_zh: '工程执行搭子',
    role_en: 'implementation partner',
    vibe_zh: selected.vibe_zh,
    vibe_en: selected.vibe_en
  };
}

function buildTelegramCtoSubagentIdentityBlock({ profile = null, soulText = '', soulPath = '' } = {}) {
  if (!profile) {
    return '';
  }

  const lines = [
    `Child agent name: ${profile.name_zh}${profile.name_en ? ` (${profile.name_en})` : ''}`,
    `Child agent role: ${profile.role_en || profile.role_zh || 'helper'}`,
    `Child agent vibe: ${profile.vibe_en || profile.vibe_zh || 'Grounded and practical.'}`,
    'You are operating as this child agent under the CTO main thread, not replacing the CTO identity.'
  ];

  const normalizedSoulText = String(soulText || '').trim();
  if (normalizedSoulText) {
    lines.push(soulPath
      ? `Active child-agent soul document (${soulPath}):`
      : 'Active child-agent soul document:', normalizedSoulText);
  }

  return lines.join('\n');
}

function computeDeterministicIndex(seed, size) {
  const limit = Math.max(Number(size) || 0, 1);
  let hash = 0;
  for (const char of String(seed || 'worker')) {
    hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  }
  return hash % limit;
}

function buildInferredTelegramCtoPlan({ fallbackMessageText, workflowState }) {
  const messageText = String(fallbackMessageText || '').trim();
  if (!messageText || isLikelyTelegramNonDirectiveMessage(messageText)) {
    return null;
  }

  const interactionPolicyDiscussion = isTelegramCtoInteractionPolicyDiscussion(messageText);
  const hasMetaAuditTarget = TELEGRAM_ANALYSIS_INTENT_PATTERN.test(messageText)
    || TELEGRAM_REASONING_TARGET_PATTERN.test(messageText)
    || TELEGRAM_ARCHITECTURE_TARGET_PATTERN.test(messageText)
    || interactionPolicyDiscussion;

  if (!hasMetaAuditTarget) {
    return null;
  }

  if (interactionPolicyDiscussion) {
    return {
      mode: 'execute',
      summary_zh: '已将你的要求自动推断为一次 CTO 交互与编排修正任务，并默认先执行安全的审查/改进。',
      question_zh: '',
      tasks: [
        {
          id: 'improve-cto-interaction-flow',
          title: 'Improve CTO chat-first interaction flow',
          worker_prompt: [
            `Interpret the CEO message as a request to improve the openCodex CTO interaction model: ${messageText}`,
            'Inspect at minimum `src/lib/cto-workflow.js`, `src/commands/im.js`, the CTO soul/prompt files, and the most relevant Telegram CTO tests.',
            'Focus on three outcomes: 1) chat stays the main continuity thread, 2) workflows autonomously progress and finish when safe, 3) chat-mode replies stay natural instead of templated.',
            'Implement the highest-leverage safe fixes directly in the repo with focused regression coverage.',
            'Only stop for missing external information or destructive/high-risk actions. Otherwise finish the change end-to-end.'
          ].join('\n'),
          depends_on: []
        }
      ]
    };
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
        session_contract: null,
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
      session_contract: null,
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
    refreshTelegramWorkflowTaskViews(workflowState);
    return;
  }

  workflowState.status = 'waiting_for_user';
  refreshTelegramWorkflowTaskViews(workflowState);
}

export function buildTelegramCtoPlanText(workflowState) {
  refreshTelegramWorkflowTaskViews(workflowState);
  const tasks = Array.isArray(workflowState.tasks) ? workflowState.tasks : [];
  const latestTasks = tasks.filter((task) => task.status === 'queued' || task.status === 'running').slice(-4);
  const ready = latestTasks.filter((task) => !task.depends_on.length).map((task) => task.id);
  const blocked = latestTasks.filter((task) => task.depends_on.length).map((task) => `${task.id} <= ${task.depends_on.join(', ')}`);
  const mainlineTask = Array.isArray(workflowState.long_tasks) ? workflowState.long_tasks[0] : null;

  const lines = [
    '这条主线我已经拆开，先按这个顺序往前推。',
    `主线：${truncateInline(mainlineTask?.title_zh || workflowState.goal_text || '当前主线', 160)}`,
    `我先按这个判断推进：${truncateInline(mainlineTask?.summary_zh || workflowState.plan_summary_zh || '已进入调度阶段。', 220)}`,
    '先做这几件：'
  ];

  for (const task of latestTasks) {
    lines.push(`- ${truncateInline(task.title, 80)}`);
  }

  if (ready.length) {
    lines.push(`已经开跑：${ready.join(', ')}`);
  }
  if (blocked.length) {
    lines.push('后面的要等前置完成：');
    for (const item of blocked) {
      lines.push(`- ${item}`);
    }
  }

  return lines.join('\n');
}

export function buildTelegramCtoQuestionText(workflowState) {
  refreshTelegramWorkflowTaskViews(workflowState);
  const counts = summarizeWorkflowCounts(workflowState);
  const question = truncateInline(workflowState.pending_question_zh || '请补充执行所需信息。', 500);
  const lines = [
    '这条主线我先推进到这里，现在需要你确认一件事。',
    `需要你确认的是：${question}`
  ];
  if (counts.completed > 0 || counts.failed > 0 || counts.partial > 0) {
    lines.push(`我这边已经完成 ${counts.completed} 项，失败 ${counts.failed} 项，待跟进 ${counts.partial} 项。`);
  }
  return truncateTelegramCtoReplyText(lines.join('\n'));
}

export function buildTelegramCtoStatusText(workflowState) {
  refreshTelegramWorkflowTaskViews(workflowState);
  const mainlineTask = Array.isArray(workflowState.long_tasks) ? workflowState.long_tasks[0] : null;
  const shortTasks = Array.isArray(workflowState.short_tasks) ? workflowState.short_tasks : [];
  const opening = buildTelegramCtoStatusOpening(workflowState);
  const lines = [
    opening,
    `主线：${truncateInline(mainlineTask?.title_zh || workflowState.goal_text || '当前主线', 160)}`,
    `现在到这：${truncateInline(mainlineTask?.summary_zh || '还在继续推进。', 220)}`
  ];

  if (shortTasks.length) {
    lines.push('手头短任务：');
    for (const task of shortTasks) {
      const summary = truncateInline(asTrimmedString(task?.summary_zh), 88);
      lines.push(`- [${formatTelegramShortTaskStatus(task?.status)}] ${truncateInline(task?.title || task?.id || '任务', 80)}${summary ? `：${summary}` : ''}`);
    }
  } else {
    lines.push('手头短任务：暂无。');
  }

  if (workflowState.pending_question_zh) {
    lines.push(`现在需要你确认：${truncateInline(workflowState.pending_question_zh, 220)}`);
  } else if (asTrimmedString(mainlineTask?.next_step_zh) && !['completed', 'cancelled'].includes(asTrimmedString(workflowState.status))) {
    lines.push(`下一步：${truncateInline(mainlineTask.next_step_zh, 220)}`);
  }

  return lines.join('\n');
}

function buildTelegramCtoFinalTaskLine(task) {
  const title = truncateInline(asTrimmedString(task?.title) || asTrimmedString(task?.id) || '任务', 48) || '任务';
  const result = normalizeTelegramCtoFinalTaskResultText(task?.result, {
    status: task?.status,
    changedFiles: task?.changed_files
  });
  const nextStep = normalizeTelegramCtoFinalNextStepText(asStringList(task?.next_steps)[0] || '');
  const changedFiles = asStringList(task?.changed_files);
  const statusLabel = getTelegramCtoFinalTaskStatusLabel(task);

  if (task?.status === 'failed') {
    return `${statusLabel}：${title}。${truncateInline(result || nextStep || '这项没做完，还需要继续处理。', 160)}`;
  }

  if (task?.status === 'partial') {
    return `${statusLabel}：${title}。${truncateInline(nextStep || result || '还差最后一步确认。', 160)}`;
  }

  if (task?.status === 'cancelled') {
    return `${statusLabel}：${title}。已取消。`;
  }

  if (task?.status === 'running') {
    return `${statusLabel}：${title}。还在继续处理。`;
  }

  if (task?.status === 'queued') {
    return `${statusLabel}：${title}。还没开始执行。`;
  }

  return `${statusLabel}：${title}。${truncateInline(result || (changedFiles.length > 0 ? `已处理并涉及 ${changedFiles.length} 个文件。` : '已完成。'), 160)}`;
}

function appendTelegramCtoBulletSection(lines, title, items, { limit = 3, omittedText = '' } = {}) {
  const values = (items || []).filter(Boolean);
  if (!values.length) {
    return;
  }

  lines.push('', `${title}：`);
  for (const item of values.slice(0, limit)) {
    lines.push(`- ${item}`);
  }

  const omittedCount = values.length - Math.min(values.length, limit);
  if (omittedCount > 0 && omittedText) {
    lines.push(`- ${omittedText.replace('{count}', String(omittedCount))}`);
  }
}

function getTelegramCtoFinalTaskStatusLabel(task) {
  switch (task?.status) {
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    case 'partial':
      return '待跟进';
    case 'cancelled':
      return '已取消';
    case 'running':
      return '进行中';
    case 'queued':
      return '排队中';
    default:
      return '任务';
  }
}

function truncateTelegramCtoReplyText(value, maxLength = 2200) {
  const text = String(value || '').trim();
  if (!text || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function normalizeTelegramCtoFinalTaskResultText(value, { status = '', changedFiles = [] } = {}) {
  const text = normalizeTelegramCtoReplyLine(value);
  if (!text || /[\u4e00-\u9fff]/.test(text)) {
    return text;
  }

  const translated = translateTelegramCtoCommonEnglishResult(text, { status, changedFiles });
  return translated || text;
}

function normalizeTelegramCtoFinalNextStepText(value) {
  const text = normalizeTelegramCtoReplyLine(value);
  if (!text || /[\u4e00-\u9fff]/.test(text)) {
    return text;
  }

  const translated = translateTelegramCtoCommonEnglishNextStep(text);
  return translated || text;
}

function normalizeTelegramCtoReplyLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function translateTelegramCtoCommonEnglishResult(text, { status = '', changedFiles = [] } = {}) {
  const lower = text.toLowerCase();

  if (/\brerouted to (?:the )?host executor\b/.test(lower)) {
    return '已转到宿主执行器继续处理。';
  }

  if (/\b(completed|finished) successfully\b/.test(lower)) {
    if (/\bsummary\b|\bfindings?\b/.test(lower)) {
      return '已经处理完，结果也整理好了。';
    }
    if (/\bresume/.test(lower)) {
      return '已经继续跑完了。';
    }
    if (/\barchive\b/.test(lower)) {
      return '已经归档好了。';
    }
    if (/\binspect(?:ion)?\b|\baudit\b|\breview(?:ed)?\b|\bcheck(?:ed)?\b/.test(lower)) {
      return '已经检查完了。';
    }
    if (changedFiles.length > 0) {
      return '已经处理完了。';
    }
    return '已经处理完了。';
  }

  if (/\bprepared\b/.test(lower) && /\bwaiting for\b/.test(lower)) {
    if (/\bdeploy\b/.test(lower)) {
      return '已经准备好，正在等部署确认。';
    }
    return '已经准备好，正在等确认。';
  }

  if (/^waiting for\b/.test(lower) || /\bwait for\b/.test(lower)) {
    if (/\bceo\b|\bconfirmation\b|\byour\b/.test(lower)) {
      return '还在等你确认。';
    }
    return '还在等上一步完成。';
  }

  if (/\bimplemented\b|\bfixed\b|\bpatched\b/.test(lower)) {
    return changedFiles.length > 0 ? '已经改好了。' : '已经处理完了。';
  }

  if (/\bupdated\b/.test(lower)) {
    return changedFiles.length > 0 ? '已经更新好了。' : '已经处理完了。';
  }

  if (/\brunning with\b/.test(lower)) {
    return '还在继续处理。';
  }

  if (status === 'running' && /\bstarted\b/.test(lower)) {
    return '已经开始处理。';
  }

  if (/\bfailed\b/.test(lower)) {
    return '这一步没顺利完成。';
  }

  return '';
}

function translateTelegramCtoCommonEnglishNextStep(text) {
  const lower = text.toLowerCase();

  if (/^share\b/.test(lower) && /\b(summary|findings|report|roadmap)\b/.test(lower)) {
    return '把整理好的结果同步给我。';
  }

  if (/^wait for\b/.test(lower) && (/\bceo\b/.test(lower) || /\bconfirmation\b/.test(lower))) {
    return '等你确认后再继续。';
  }

  if (/^wait for\b/.test(lower)) {
    return '等上一步完成后再继续。';
  }

  if (/^inspect failed task diagnostics\b/.test(lower)) {
    return '先看失败任务的原因。';
  }

  if (/^review changed files\b/.test(lower)) {
    return '如有需要，再过一遍改动文件。';
  }

  return '';
}

export function buildTelegramCtoFinalText(workflowState) {
  refreshTelegramWorkflowTaskViews(workflowState);
  const counts = summarizeWorkflowCounts(workflowState);
  const tasks = Array.isArray(workflowState.tasks) ? workflowState.tasks : [];
  const completedTaskLines = tasks
    .filter((task) => task?.status === 'completed')
    .map(buildTelegramCtoFinalTaskLine);
  const issueTaskLines = tasks
    .filter((task) => task?.status === 'partial' || task?.status === 'failed')
    .map(buildTelegramCtoFinalTaskLine);
  const changedFileLines = collectWorkflowChangedFiles(workflowState)
    .slice(0, 4)
    .map((filePath) => truncateInline(filePath, 88))
    .filter(Boolean);
  const nextStepLines = collectWorkflowNextSteps(workflowState)
    .slice(0, 3)
    .map((step) => truncateInline(normalizeTelegramCtoFinalNextStepText(step), 180))
    .filter(Boolean);
  const lines = [];

  if (workflowState.status === 'completed') {
    lines.push('这轮已经处理完了。');
    lines.push(counts.completed > 0
      ? `共完成 ${counts.completed} 项。`
      : '相关事项已经处理完。');
    appendTelegramCtoBulletSection(lines, '本轮结果', completedTaskLines, {
      limit: 3,
      omittedText: '另外还有 {count} 项已完成，这里先不展开。'
    });
    appendTelegramCtoBulletSection(lines, '改动文件', changedFileLines, {
      limit: 4,
      omittedText: '另外还有 {count} 个文件，这里先不展开。'
    });
    appendTelegramCtoBulletSection(lines, '后续建议', nextStepLines, {
      limit: 2,
      omittedText: '另外还有 {count} 条后续建议。'
    });
    return truncateTelegramCtoReplyText(lines.join('\n'));
  }

  if (workflowState.status === 'cancelled') {
    lines.push('这轮先停在这里了。');
    if (counts.cancelled > 0) {
      lines.push(`已取消 ${counts.cancelled} 项尚未完成的任务。`);
      if (counts.completed > 0) {
        lines.push(`在停下前已经完成了 ${counts.completed} 项。`);
      }
      appendTelegramCtoBulletSection(lines, '已完成部分', completedTaskLines, {
        limit: 2,
        omittedText: '另外还有 {count} 项已完成，这里先不展开。'
      });
      appendTelegramCtoBulletSection(lines, '改动文件', changedFileLines, {
        limit: 4,
        omittedText: '另外还有 {count} 个文件，这里先不展开。'
      });
      return truncateTelegramCtoReplyText(lines.join('\n'));
    }
    return truncateTelegramCtoReplyText(lines.join('\n'));
  }

  if (workflowState.status === 'waiting_for_user') {
    lines.push('这轮先做到这里，现在需要你确认一下。');
    if (counts.completed > 0 || counts.partial > 0 || counts.failed > 0) {
      lines.push(`已完成 ${counts.completed} 项，待继续 ${counts.partial} 项，失败 ${counts.failed} 项。`);
    }
    appendTelegramCtoBulletSection(lines, '需要你确认', [
      truncateInline(workflowState.pending_question_zh || '请确认下一步处理方式。', 180)
    ]);
    appendTelegramCtoBulletSection(lines, '已完成部分', completedTaskLines, {
      limit: 2,
      omittedText: '另外还有 {count} 项已完成，这里先不展开。'
    });
    appendTelegramCtoBulletSection(lines, '改动文件', changedFileLines, {
      limit: 4,
      omittedText: '另外还有 {count} 个文件，这里先不展开。'
    });
    return truncateTelegramCtoReplyText(lines.join('\n'));
  }

  if (workflowState.status === 'failed') {
    lines.push('这轮卡住了，还没顺利收口。');
    lines.push(counts.failed > 0
      ? `失败 ${counts.failed} 项。`
      : '执行过程中出错了。');
    appendTelegramCtoBulletSection(lines, '主要问题', issueTaskLines, {
      limit: 3,
      omittedText: '另外还有 {count} 个问题，这里先不展开。'
    });
    appendTelegramCtoBulletSection(lines, '已完成部分', completedTaskLines, {
      limit: 2,
      omittedText: '另外还有 {count} 项已完成，这里先不展开。'
    });
    appendTelegramCtoBulletSection(lines, '建议下一步', nextStepLines, {
      limit: 2,
      omittedText: '另外还有 {count} 条后续建议。'
    });
    appendTelegramCtoBulletSection(lines, '改动文件', changedFileLines, {
      limit: 4,
      omittedText: '另外还有 {count} 个文件，这里先不展开。'
    });
    return truncateTelegramCtoReplyText(lines.join('\n'));
  }

  if (workflowState.status === 'partial') {
    lines.push('这轮先做到这里，还没完全收口。');
    lines.push(`已完成 ${counts.completed} 项，待继续 ${counts.partial} 项，失败 ${counts.failed} 项。`);
    appendTelegramCtoBulletSection(lines, '当前卡点', issueTaskLines, {
      limit: 3,
      omittedText: '另外还有 {count} 个卡点，这里先不展开。'
    });
    appendTelegramCtoBulletSection(lines, '已完成部分', completedTaskLines, {
      limit: 2,
      omittedText: '另外还有 {count} 项已完成，这里先不展开。'
    });
    appendTelegramCtoBulletSection(lines, '建议下一步', nextStepLines, {
      limit: 2,
      omittedText: '另外还有 {count} 条后续建议。'
    });
    appendTelegramCtoBulletSection(lines, '改动文件', changedFileLines, {
      limit: 4,
      omittedText: '另外还有 {count} 个文件，这里先不展开。'
    });
    return truncateTelegramCtoReplyText(lines.join('\n'));
  }

  if (workflowState.status === 'running') {
    return truncateTelegramCtoReplyText(counts.rerouted > 0
      ? `这轮还在继续处理中，已有 ${counts.rerouted} 项转到宿主执行器继续跑。`
      : '这轮还在继续处理中。');
  }

  return truncateTelegramCtoReplyText('这轮还在处理中。');
}

export function buildTelegramCtoSessionSummary(workflowState) {
  refreshTelegramWorkflowTaskViews(workflowState);
  const counts = summarizeWorkflowCounts(workflowState);
  const status = mapWorkflowStatus(workflowState.status);
  const mainlineTask = Array.isArray(workflowState.long_tasks) ? workflowState.long_tasks[0] : null;
  const highlights = [
    `Chat: ${workflowState.chat_id}`,
    `Mainline: ${mainlineTask?.title_zh || asTrimmedString(workflowState.goal_text) || '(none)'}`,
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
    validation: collectWorkflowValidation(workflowState).slice(0, 4),
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
  refreshTelegramWorkflowTaskViews(workflowState);
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
    refreshTelegramWorkflowTaskViews(workflowState);
    return task;
  }
  if (summaryStatus === 'rerouted') {
    task.status = 'running';
    task.session_id = runResult?.sessionId || task.session_id || '';
    task.summary_status = summaryStatus;
    task.result = asTrimmedString(runResult?.summary?.result) || '';
    task.next_steps = asStringList(runResult?.summary?.next_steps);
    task.changed_files = asStringList(runResult?.summary?.changed_files);
    task.session_contract = runResult?.summary?.session_contract && typeof runResult.summary.session_contract === 'object'
      ? runResult.summary.session_contract
      : (task.session_contract || null);
    task.validation = mergeTaskValidationWithToneGuard(runResult?.summary?.validation, task.result);
    task.reroute_job_id = asTrimmedString(runResult?.rerouteJobId || runResult?.summary?.reroute_job_id) || task.reroute_job_id || '';
    task.reroute_record_path = asTrimmedString(runResult?.rerouteRecordPath || runResult?.summary?.reroute_record_path) || task.reroute_record_path || '';
    task.reroute_source_session_id = asTrimmedString(runResult?.sessionId) || task.reroute_source_session_id || '';
    task.updated_at = new Date().toISOString();
    workflowState.updated_at = task.updated_at;
    workflowState.status = 'running';
    workflowState.pending_question_zh = '';
    refreshTelegramWorkflowTaskViews(workflowState);
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
  task.validation = mergeTaskValidationWithToneGuard(runResult?.summary?.validation, task.result);
  task.updated_at = new Date().toISOString();
  workflowState.updated_at = task.updated_at;

  if (task.status === 'partial' || (task.status === 'failed' && task.next_steps.length > 0)) {
    workflowState.status = 'waiting_for_user';
    workflowState.pending_question_zh = task.next_steps[0] || task.result || '请确认下一步处理方式。';
  }

  refreshTelegramWorkflowTaskViews(workflowState);
  return task;
}

export function finalizeWorkflowStatus(workflowState) {
  const counts = summarizeWorkflowCounts(workflowState);

  if (workflowState.status === 'cancelled') {
    refreshTelegramWorkflowTaskViews(workflowState);
    return workflowState.status;
  }

  if (workflowState.status === 'waiting_for_user') {
    refreshTelegramWorkflowTaskViews(workflowState);
    return workflowState.status;
  }

  if (counts.running > 0 || counts.rerouted > 0) {
    workflowState.status = 'running';
    refreshTelegramWorkflowTaskViews(workflowState);
    return workflowState.status;
  }

  const blockedTasks = (workflowState.tasks || []).filter((task) => task.status === 'queued');
  if (blockedTasks.length) {
    if (counts.failed > 0 && counts.completed === 0 && counts.partial === 0) {
      workflowState.status = 'failed';
      refreshTelegramWorkflowTaskViews(workflowState);
      return workflowState.status;
    }
    if (counts.failed > 0 || counts.partial > 0) {
      workflowState.status = 'partial';
      refreshTelegramWorkflowTaskViews(workflowState);
      return workflowState.status;
    }
    if (!workflowState.pending_question_zh) {
      workflowState.pending_question_zh = '仍有任务等待依赖，请确认是否继续调整当前工作流。';
    }
    workflowState.status = 'waiting_for_user';
    refreshTelegramWorkflowTaskViews(workflowState);
    return workflowState.status;
  }

  if (counts.failed > 0 && counts.completed === 0) {
    workflowState.status = 'failed';
    refreshTelegramWorkflowTaskViews(workflowState);
    return workflowState.status;
  }

  if (counts.failed > 0 || counts.partial > 0) {
    workflowState.status = 'partial';
    refreshTelegramWorkflowTaskViews(workflowState);
    return workflowState.status;
  }

  workflowState.status = 'completed';
  refreshTelegramWorkflowTaskViews(workflowState);
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

function collectWorkflowValidation(workflowState) {
  const values = [];
  for (const task of workflowState.tasks || []) {
    const taskId = asTrimmedString(task?.id) || 'task';
    for (const item of asStringList(task?.validation)) {
      if (item.startsWith('tone_guard:warn:')) {
        values.push(`${taskId} ${item}`);
      }
    }
  }
  return dedupeList(values);
}

function mergeTaskValidationWithToneGuard(validationList, resultText) {
  const values = asStringList(validationList);
  const toneGuard = buildTelegramCtoToneGuardValidationItem(resultText);
  if (toneGuard) {
    values.push(toneGuard);
  }
  return dedupeList(values);
}

function buildTelegramCtoToneGuardValidationItem(resultText) {
  const text = asTrimmedString(resultText);
  if (!text) {
    return 'tone_guard:skip:empty_result';
  }

  const normalizedLines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (normalizedLines.some((line) => TELEGRAM_CTO_TONE_GUARD_MARKER_PATTERN.test(line))) {
    return 'tone_guard:warn:report_markers';
  }

  if (TELEGRAM_CTO_TONE_GUARD_EN_BOILERPLATE_PATTERN.test(text)) {
    return 'tone_guard:warn:english_boilerplate';
  }

  const sentenceCount = text
    .split(/[。！？!?]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .length;

  if (sentenceCount > 2 || normalizedLines.length > 3) {
    return 'tone_guard:warn:too_long_for_plain_update';
  }

  return 'tone_guard:pass';
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

  refreshTelegramWorkflowTaskViews(workflowState);
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

function refreshTelegramWorkflowTaskViews(workflowState) {
  if (!workflowState || typeof workflowState !== 'object') {
    return workflowState;
  }

  const safeWorkflowState = {
    ...workflowState,
    tasks: Array.isArray(workflowState.tasks) ? workflowState.tasks : []
  };
  const counts = summarizeWorkflowCounts(safeWorkflowState);
  workflowState.long_tasks = buildTelegramWorkflowLongTasks(safeWorkflowState, counts);
  workflowState.short_tasks = buildTelegramWorkflowShortTasks(safeWorkflowState);
  return workflowState;
}

function buildTelegramWorkflowLongTasks(workflowState, counts) {
  const title = truncateInline(
    asTrimmedString(workflowState.goal_text)
      || asTrimmedString(workflowState.plan_summary_zh)
      || '当前主线',
    88
  ) || '当前主线';

  return [
    {
      id: `${asTrimmedString(workflowState.workflow_session_id) || 'workflow'}:mainline`,
      title_zh: title,
      status: asTrimmedString(workflowState.status) || 'planning',
      summary_zh: buildTelegramWorkflowMainlineSummary(workflowState, counts),
      next_step_zh: resolveTelegramWorkflowMainlineNextStep(workflowState),
      updated_at: asTrimmedString(workflowState.updated_at) || asTrimmedString(workflowState.created_at) || new Date().toISOString()
    }
  ];
}

function buildTelegramWorkflowShortTasks(workflowState) {
  const tasks = Array.isArray(workflowState.tasks) ? workflowState.tasks : [];
  return tasks
    .map((task, index) => ({
      id: asTrimmedString(task?.id) || `task-${index + 1}`,
      title: asTrimmedString(task?.title) || asTrimmedString(task?.id) || '任务',
      status: getTaskDisplayStatus(task),
      summary_zh: buildTelegramWorkflowShortTaskSummary(task),
      updated_at: asTrimmedString(task?.updated_at) || asTrimmedString(workflowState.updated_at) || ''
    }))
    .sort((left, right) => {
      const priorityDelta = getTelegramShortTaskPriority(left.status) - getTelegramShortTaskPriority(right.status);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return String(right.updated_at || '').localeCompare(String(left.updated_at || ''));
    })
    .slice(0, 4);
}

function buildTelegramWorkflowMainlineSummary(workflowState, counts) {
  const status = asTrimmedString(workflowState.status);
  if (status === 'planning') {
    return '刚接到这条主线，正在拆下一步。';
  }
  if (status === 'waiting_for_user') {
    return asTrimmedString(workflowState.plan_summary_zh) || '已经推进到需要你确认的一步。';
  }
  if (status === 'completed') {
    return counts.completed > 0
      ? `主线已经收口，共完成 ${counts.completed} 项。`
      : '主线已经收口。';
  }
  if (status === 'failed') {
    return counts.failed > 0
      ? `主线卡住了，当前有 ${counts.failed} 项没顺利收口。`
      : '主线卡住了，还没顺利收口。';
  }
  if (status === 'partial') {
    return `主线先推进了一段，已完成 ${counts.completed} 项，但还有收口项。`;
  }
  if (status === 'cancelled') {
    return '这条主线先停下了。';
  }
  if (counts.rerouted > 0) {
    return `主线还在推进，已有 ${counts.rerouted} 项转到宿主继续跑。`;
  }
  if (counts.running > 0) {
    return `主线还在推进，当前有 ${counts.running} 项在跑。`;
  }
  if (counts.queued > 0) {
    return `主线已经拆开，后面还有 ${counts.queued} 项排着。`;
  }
  return asTrimmedString(workflowState.plan_summary_zh) || '主线还在继续推进。';
}

function resolveTelegramWorkflowMainlineNextStep(workflowState) {
  if (asTrimmedString(workflowState.pending_question_zh)) {
    return asTrimmedString(workflowState.pending_question_zh);
  }

  for (const task of workflowState.tasks || []) {
    const firstNextStep = asStringList(task?.next_steps)[0];
    if (firstNextStep) {
      return firstNextStep;
    }
  }

  const runningTask = (workflowState.tasks || []).find((task) => getTaskDisplayStatus(task) === 'running' || getTaskDisplayStatus(task) === 'rerouted');
  if (runningTask) {
    return `先把「${asTrimmedString(runningTask.title) || asTrimmedString(runningTask.id) || '当前任务'}」收口。`;
  }

  const queuedTask = (workflowState.tasks || []).find((task) => asTrimmedString(task?.status) === 'queued');
  if (queuedTask) {
    return `接下来准备做「${asTrimmedString(queuedTask.title) || asTrimmedString(queuedTask.id) || '下一项任务'}」。`;
  }

  return '';
}

function buildTelegramWorkflowShortTaskSummary(task) {
  const displayStatus = getTaskDisplayStatus(task);
  if (displayStatus === 'rerouted') {
    return '已转到宿主继续跑。';
  }
  if (displayStatus === 'running') {
    return normalizeTelegramCtoFinalTaskResultText(task?.result, {
      status: task?.status,
      changedFiles: asStringList(task?.changed_files)
    }) || '正在处理。';
  }
  if (displayStatus === 'queued') {
    return Array.isArray(task?.depends_on) && task.depends_on.length > 0
      ? `等 ${task.depends_on.join(', ')} 完成后接着做。`
      : '已经排上，准备开做。';
  }
  if (displayStatus === 'completed') {
    return normalizeTelegramCtoFinalTaskResultText(task?.result, {
      status: task?.status,
      changedFiles: asStringList(task?.changed_files)
    }) || '已经做完了。';
  }
  if (displayStatus === 'partial') {
    return normalizeTelegramCtoFinalNextStepText(asStringList(task?.next_steps)[0] || '')
      || normalizeTelegramCtoFinalTaskResultText(task?.result, {
        status: task?.status,
        changedFiles: asStringList(task?.changed_files)
      })
      || '还差最后一步确认。';
  }
  if (displayStatus === 'failed') {
    return normalizeTelegramCtoFinalTaskResultText(task?.result, {
      status: task?.status,
      changedFiles: asStringList(task?.changed_files)
    })
      || normalizeTelegramCtoFinalNextStepText(asStringList(task?.next_steps)[0] || '')
      || '这一步还没顺利做完。';
  }
  if (displayStatus === 'cancelled') {
    return '这一步先停了。';
  }
  return '';
}

function buildTelegramCtoStatusOpening(workflowState) {
  const status = asTrimmedString(workflowState.status);
  if (status === 'waiting_for_user') {
    return '这条主线我还在跟，现在有个问题需要你确认。';
  }
  if (status === 'completed') {
    return '这条主线已经收口了。';
  }
  if (status === 'failed') {
    return '这条主线卡住了，我先把卡点给你讲清楚。';
  }
  if (status === 'partial') {
    return '这条主线我还在跟，不过还没完全收口。';
  }
  if (status === 'cancelled') {
    return '这条主线先停在这里了。';
  }
  return '这条主线我还在跟。';
}

function formatTelegramShortTaskStatus(status) {
  switch (status) {
    case 'running':
      return '进行中';
    case 'rerouted':
      return '宿主执行';
    case 'queued':
      return '排队中';
    case 'completed':
      return '已完成';
    case 'partial':
      return '待跟进';
    case 'failed':
      return '失败';
    case 'cancelled':
      return '已取消';
    default:
      return status || '任务';
  }
}

function getTelegramShortTaskPriority(status) {
  switch (status) {
    case 'running':
    case 'rerouted':
      return 0;
    case 'partial':
    case 'failed':
      return 1;
    case 'queued':
      return 2;
    case 'completed':
      return 3;
    case 'cancelled':
      return 4;
    default:
      return 5;
  }
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

export function buildTelegramCtoWorkerSystemPrompt({ workflowState, task, agentSoulText = '', agentSoulPath = '' }) {
  const agentProfile = resolveTelegramCtoSubagentProfile({ kind: 'worker', task });
  return [
    'You are a sandbox-side advisor session delegated by the host-level openCodex CTO supervisor.',
    buildTelegramCtoSubagentIdentityBlock({
      profile: agentProfile,
      soulText: agentSoulText,
      soulPath: agentSoulPath
    }),
    'The CTO main thread is the sole orchestrator. You are a child helper, not the coordinator or the CEO-facing CTO identity.',
    'Execute only the assigned subtask, report concrete progress, and stop when the task scope is done or truly blocked.',
    'Reply to the maintainer in Simplified Chinese.',
    'Your structured `summary.result` must be a short, natural Simplified Chinese update that the CTO main thread can forward almost directly to the CEO.',
    'Avoid English boilerplate such as "completed successfully", report headers, and rigid template wording inside `summary.result`.',
    'Keep `summary.result` within 2 short sentences. Put file paths in `changed_files` instead of stuffing them into prose unless they are essential.',
    'Write `summary.result` in plain everyday language: keep sentences short, cut jargon, and describe impact with a concrete usage scene when possible.',
    'Keep only essential reporting info in `summary.result`: current status, key risk/impact, and the immediate next action only when needed.',
    'This reporting upgrade is wording-only. Do not alter execution logic just to make wording read better.',
    'Keep project content in English. Keep docs bilingual under docs/en and docs/zh when docs change.',
    'Prefer the smallest practical, reversible change and validate what you changed when reasonable.',
    'Default to finishing the task end-to-end inside this run when the path is safe and local.',
    'Do not hand routine next steps back to the CTO if you can execute them yourself.',
    'Use `partial`, `failed`, or `next_steps` only when you hit missing external information, destructive/high-risk actions, or a material strategy decision.',
    `Workflow goal: ${truncateInline(workflowState?.goal_text || '', 160) || '(none)'}`,
    `Task id: ${task?.id || '(unknown)'}`,
    `Task title: ${task?.title || '(untitled)'}`,
    `Dependencies: ${(task?.depends_on || []).length ? task.depends_on.join(', ') : '(none)'}`
  ].join('\n');
}

export function buildTelegramCtoWorkerExecutionPrompt({ workflowState, task, fallbackMessageText = '', agentSoulText = '', agentSoulPath = '' }) {
  return [
    buildTelegramCtoWorkerSystemPrompt({ workflowState, task, agentSoulText, agentSoulPath }),
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
