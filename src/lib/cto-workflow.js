import { fileURLToPath } from 'node:url';

export const CTO_PLANNER_SCHEMA_PATH = fileURLToPath(new URL('../../schemas/cto-workflow-plan.schema.json', import.meta.url));

const MAX_TASKS = 4;
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

export function buildTelegramCtoMainThreadSystemPrompt({ continuation = false } = {}) {
  return [
    'You are the dedicated openCodex CTO main thread operating through the Telegram control channel.',
    'You are the central orchestrator for many worker agents and must stay in the CTO role.',
    'openCodex is a thin orchestration layer on top of Codex CLI, inspired by openclaw.',
    'Your job is to decide, sequence, and supervise non-blocking local tasks instead of doing every implementation step yourself.',
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
  ].join('\n');
}

export function buildTelegramCtoPlannerPrompt({ message, workflowState, continuationMessage = null }) {
  const completedTaskLines = summarizeTasksForPrompt(workflowState.tasks || []);
  const historyLines = (workflowState.user_messages || [])
    .slice(-4)
    .map((item, index) => `${index + 1}. ${item.text}`);

  if (continuationMessage) {
    return [
      buildTelegramCtoMainThreadSystemPrompt({ continuation: true }),
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
    buildTelegramCtoMainThreadSystemPrompt(),
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
    `进度：queued ${counts.queued}, running ${counts.running}, completed ${counts.completed}, partial ${counts.partial}, failed ${counts.failed}`
  ];

  if (latestTasks.length) {
    lines.push('任务：');
    for (const task of latestTasks) {
      lines.push(`- [${task.status}] ${task.id} ${truncateInline(task.title, 80)}`);
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
      : 'openCodex CTO 工作流已结束';

  const lines = [
    statusTitle,
    `目标：${truncateInline(workflowState.goal_text, 160)}`,
    `进度：completed ${counts.completed}, partial ${counts.partial}, failed ${counts.failed}, queued ${counts.queued}`
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
    `Partial: ${counts.partial}`,
    `Failed: ${counts.failed}`
  ];

  const nextSteps = collectWorkflowNextSteps(workflowState).slice(0, 4);
  if (!nextSteps.length && status === 'running') {
    nextSteps.push('Wait for the running workflow tasks to finish.');
  }
  if (!nextSteps.length && status === 'partial') {
    nextSteps.push('Wait for the CEO reply on the Telegram control channel.');
  }

  return {
    title: status === 'completed'
      ? 'CTO workflow completed'
      : status === 'partial'
        ? 'CTO workflow waiting'
        : status === 'failed'
          ? 'CTO workflow failed'
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

export function findPendingWorkflowForChat(workflows, chatId) {
  const items = Array.from(workflows || []);
  return items
    .filter((workflow) => workflow?.state?.chat_id === chatId && workflow.state.status === 'waiting_for_user')
    .sort((left, right) => String(right.state.updated_at || '').localeCompare(String(left.state.updated_at || '')))[0] || null;
}

export function getReadyWorkflowTasks(workflowState) {
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

  if (workflowState.status === 'waiting_for_user') {
    return workflowState.status;
  }

  if (counts.running > 0) {
    workflowState.status = 'running';
    return workflowState.status;
  }

  const blockedTasks = (workflowState.tasks || []).filter((task) => task.status === 'queued');
  if (blockedTasks.length) {
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
    completed: 0,
    partial: 0,
    failed: 0
  };

  for (const task of workflowState.tasks || []) {
    counts.total += 1;
    if (Object.hasOwn(counts, task.status)) {
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

  return `Workflow is running with ${counts.running} active task(s).`;
}

function mapWorkflowStatus(status) {
  if (status === 'waiting_for_user' || status === 'partial') {
    return 'partial';
  }
  if (status === 'completed' || status === 'failed' || status === 'running') {
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
    case 'partial':
      return 'partial（部分完成）';
    default:
      return `${status || 'unknown'}（状态未知）`;
  }
}

function summarizeTasksForPrompt(tasks) {
  return (tasks || []).map((task) => {
    const result = task.result ? ` — ${truncateInline(task.result, 140)}` : '';
    return `- ${task.id} [${task.status}] ${task.title}${result}`;
  }).join('\n');
}

function findTask(workflowState, taskId) {
  return (workflowState.tasks || []).find((task) => task.id === taskId) || null;
}

export function buildTelegramCtoWorkerSystemPrompt({ workflowState, task }) {
  return [
    'You are an openCodex worker agent delegated by the openCodex CTO main thread.',
    'The CTO main thread is the sole orchestrator. You are a child worker, not the coordinator.',
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
