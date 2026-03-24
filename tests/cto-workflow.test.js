import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import {
  appendWorkflowUserMessage,
  applyWorkflowTaskResult,
  buildDefaultCtoChatSoulDocument,
  buildDefaultCtoPlannerAgentSoulDocument,
  buildDefaultCtoReplyAgentSoulDocument,
  buildTelegramCtoFinalText,
  buildTelegramCtoQuestionText,
  buildTelegramCtoWorkflowReplyPrompt,
  buildTelegramCtoStatusText,
  buildTelegramCtoMainThreadSystemPrompt,
  buildTelegramCtoPlannerPrompt,
  buildDefaultCtoWorkflowSoulDocument,
  buildDefaultCtoWorkerAgentSoulDocument,
  buildTelegramCtoSessionSummary,
  buildTelegramCtoWorkerExecutionPrompt,
  cancelTelegramWorkflowState,
  finalizeWorkflowStatus,
  loadCtoSoulBundle,
  loadCtoSoulDocument,
  loadCtoSubagentSoulDocument,
  buildTelegramCtoDirectReplyPrompt,
  resolveTelegramCtoSubagentProfile,
  summarizeWorkflowCounts,
  buildDefaultCtoSoulDocument,
  collectHistoricalStuckCtoWorkflowCandidates,
  injectHistoricalCtoRepairTask,
  isLikelyTelegramCtoCasualChatMessage,
  isLikelyTelegramNonDirectiveMessage,
  classifyTelegramCtoMessageIntent,
  isStrongTelegramCtoDirectiveMessage,
  createTelegramWorkflowState,
  normalizeTelegramCtoPlan,
  shouldKeepTelegramCtoInConversationMode,
  shouldPromoteWorkflowGoal,
  shouldResumeTelegramPendingWorkflow
} from '../src/lib/cto-workflow.js';

test('cto main thread prompt declares central orchestration ownership', () => {
  const prompt = buildTelegramCtoMainThreadSystemPrompt();
  assert.match(prompt, /dedicated openCodex CTO main thread/i);
  assert.match(prompt, /host-level supervisor/i);
  assert.match(prompt, /central orchestrator for many worker agents/i);
  assert.match(prompt, /not the CEO-facing CTO identity/i);
  assert.match(prompt, /personally generate and edit every worker prompt/i);
  assert.match(prompt, /infer the CEO intent from context/i);
  assert.match(prompt, /openclaw/i);
});

test('cto planner prompt keeps CEO context and main-thread rules', () => {
  const prompt = buildTelegramCtoPlannerPrompt({
    message: { text: '安排一下接下来的任务' },
    workflowState: {
      goal_text: '安排一下接下来的任务',
      pending_question_zh: '',
      tasks: [],
      user_messages: []
    }
  });

  assert.match(prompt, /The user is the CEO/i);
  assert.match(prompt, /main thread/i);
  assert.match(prompt, /Telegram message:/);
});

test('cto soul document loads from repo prompts and extends the main-thread prompt', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-cto-soul-'));
  await mkdir(path.join(cwd, 'prompts'), { recursive: true });
  await writeFile(path.join(cwd, 'prompts', 'cto-soul.md'), '# Soul\n\n- Stay opinionated.\n- Keep Codex CLI as the engine.\n', 'utf8');

  const soul = await loadCtoSoulDocument(cwd);
  const prompt = buildTelegramCtoMainThreadSystemPrompt({
    soulText: soul.text,
    soulPath: soul.display_path
  });

  assert.equal(soul.display_path, 'prompts/cto-soul.md');
  assert.equal(soul.builtin, false);
  assert.match(prompt, /Active CTO base soul document \(prompts\/cto-soul\.md\):/);
  assert.match(prompt, /Stay opinionated\./);
  assert.match(prompt, /Keep Codex CLI as the engine\./);
});

test('cto default soul template is based on the Codex CLI personal assistant persona', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-cto-soul-default-'));
  const soul = await loadCtoSoulDocument(cwd);
  const bundle = await loadCtoSoulBundle(cwd);
  const replySoul = await loadCtoSubagentSoulDocument(cwd, { kind: 'reply' });
  const plannerSoul = await loadCtoSubagentSoulDocument(cwd, { kind: 'planner' });
  const workerSoul = await loadCtoSubagentSoulDocument(cwd, { kind: 'worker' });
  const template = buildDefaultCtoSoulDocument();
  const chatTemplate = buildDefaultCtoChatSoulDocument();
  const workflowTemplate = buildDefaultCtoWorkflowSoulDocument();
  const replyTemplate = buildDefaultCtoReplyAgentSoulDocument();
  const plannerTemplate = buildDefaultCtoPlannerAgentSoulDocument();
  const workerTemplate = buildDefaultCtoWorkerAgentSoulDocument();

  assert.equal(soul.builtin, true);
  assert.equal(soul.display_path, 'prompts/cto-soul.md');
  assert.equal(soul.text, template);
  assert.equal(bundle.chat.display_path, 'prompts/cto-chat-soul.md');
  assert.equal(bundle.workflow.display_path, 'prompts/cto-workflow-soul.md');
  assert.equal(bundle.chat.text, chatTemplate);
  assert.equal(bundle.workflow.text, workflowTemplate);
  assert.equal(replySoul.display_path, 'prompts/cto-reply-agent-soul.md');
  assert.equal(plannerSoul.display_path, 'prompts/cto-planner-agent-soul.md');
  assert.equal(workerSoul.display_path, 'prompts/cto-worker-agent-soul.md');
  assert.equal(replySoul.text, replyTemplate);
  assert.equal(plannerSoul.text, plannerTemplate);
  assert.equal(workerSoul.text, workerTemplate);
  assert.match(template, /general-purpose Codex CLI personal assistant persona/);
  assert.match(template, /primary local execution engine/);
  assert.match(template, /CTO-style orchestrator/);
  assert.match(template, /host-supervisor layer/);
  assert.match(template, /Sandbox Codex sessions are advisors, planners, reviewers/);
  assert.match(template, /Support natural chat, discussion, and research-style exploration/);
  assert.match(template, /three interaction modes: chat, exploration, and orchestration/);
  assert.match(chatTemplate, /chat as the default control surface/i);
  assert.match(workflowTemplate, /workflow orchestration as a branch/i);
  assert.match(replyTemplate, /direct CEO replies/i);
  assert.match(plannerTemplate, /drafts workflow plans/i);
  assert.match(workerTemplate, /execute concrete subtasks/i);
});

test('cto prompt builders apply chat and workflow soul overlays separately', () => {
  const directReplyPrompt = buildTelegramCtoDirectReplyPrompt({
    message: { text: '你吃晚餐了吗' },
    soulText: '# base\n- keep continuity',
    soulPath: 'prompts/cto-soul.md',
    modeSoulText: '# chat\n- keep it human',
    modeSoulPath: 'prompts/cto-chat-soul.md',
    agentSoulText: '# reply agent\n- keep it human',
    agentSoulPath: 'prompts/cto-reply-agent-soul.md',
    replyMode: 'casual',
    chatState: { direct_reply_count: 0 }
  });
  const plannerPrompt = buildTelegramCtoPlannerPrompt({
    message: { text: '继续推进 Telegram CTO 的续跑修复' },
    workflowState: { goal_text: '继续推进 Telegram CTO 的续跑修复', tasks: [], user_messages: [] },
    soulText: '# base\n- keep continuity',
    soulPath: 'prompts/cto-soul.md',
    modeSoulText: '# workflow\n- prefer 1-4 tasks',
    modeSoulPath: 'prompts/cto-workflow-soul.md',
    agentSoulText: '# planner agent\n- plan like a grounded lead',
    agentSoulPath: 'prompts/cto-planner-agent-soul.md'
  });

  assert.match(directReplyPrompt, /Active CTO base soul document \(prompts\/cto-soul\.md\):/);
  assert.match(directReplyPrompt, /Active CTO chat-mode soul document \(prompts\/cto-chat-soul\.md\):/);
  assert.match(directReplyPrompt, /Child agent name: 阿满/);
  assert.match(directReplyPrompt, /Active child-agent soul document \(prompts\/cto-reply-agent-soul\.md\):/);
  assert.match(directReplyPrompt, /natural chat reply, not a report/i);
  assert.match(directReplyPrompt, /outcome or direct answer in the first sentence/i);
  assert.match(directReplyPrompt, /end with one explicit next action/i);
  assert.match(directReplyPrompt, /Do not use headings, labels, numbered sections, bullets, markdown/i);
  assert.doesNotMatch(directReplyPrompt, /workflow-mode soul document/);
  assert.match(plannerPrompt, /Active CTO workflow-mode soul document \(prompts\/cto-workflow-soul\.md\):/);
  assert.match(plannerPrompt, /Child agent name: 阿周/);
  assert.match(plannerPrompt, /Active child-agent soul document \(prompts\/cto-planner-agent-soul\.md\):/);
  assert.match(plannerPrompt, /Default to autonomous progress/i);
  assert.match(plannerPrompt, /Use `confirm` only for destructive or external side effects/i);
  assert.doesNotMatch(plannerPrompt, /chat-mode soul document/);
});

test('cto direct reply prompt keeps chat continuity when a workflow is already running', () => {
  const prompt = buildTelegramCtoDirectReplyPrompt({
    message: { text: '你现在在干嘛' },
    activeWorkflowState: {
      workflow_session_id: 'cto-20260324-123456-abcd12',
      status: 'running',
      goal_text: '继续推进 Telegram CTO 的主线体验修复'
    },
    replyMode: 'casual',
    chatState: { last_mode: 'workflow', direct_reply_count: 0 }
  });

  assert.match(prompt, /There is an active CTO workflow still running in the background for this chat\./);
  assert.match(prompt, /Make it clear that the running workflow remains active in the background/);
  assert.match(prompt, /Keep the conversation on the same main line/);
});

test('cto workflow reply prompt gives facts to the model and bans internal jargon', () => {
  const prompt = buildTelegramCtoWorkflowReplyPrompt({
    workflowState: {
      workflow_session_id: 'cto-123',
      status: 'waiting_for_user',
      goal_text: '继续推进 TG CTO 主线',
      plan_summary_zh: '已经推进到需要确认的一步。',
      pending_question_zh: '是否继续扩这轮状态回执。',
      tasks: [
        { id: 't1', title: 'Patch wording', status: 'completed', result: '已经做完了。', changed_files: ['src/mock.js'] }
      ],
      long_tasks: [
        { title_zh: '继续推进 TG CTO 主线', summary_zh: '已经推进到需要确认的一步。', next_step_zh: '等确认后继续。', status: 'waiting_for_user' }
      ],
      short_tasks: [
        { title: 'Patch wording', status: 'completed', summary_zh: '已经做完了。' }
      ]
    },
    replyKind: 'status',
    messageText: '主线到哪了'
  });

  assert.match(prompt, /Workflow reply mode: Telegram CTO workflow-facing reply\./);
  assert.match(prompt, /Reply kind: status/);
  assert.match(prompt, /Do not use internal project jargon such as “拍板”, “收口”, “编排”, or “续跑”/);
  assert.match(prompt, /Workflow facts \(JSON\):/);
  assert.match(prompt, /"goal_text": "继续推进 TG CTO 主线"/);
  assert.match(prompt, /"pending_question_zh": "是否继续扩这轮状态回执。"/);
});

test('cto worker prompt assigns a grounded named subagent deterministically', () => {
  const workerProfile = resolveTelegramCtoSubagentProfile({
    kind: 'worker',
    task: { id: 'fix-telegram-routing', title: 'Fix Telegram routing' }
  });
  const workerPrompt = buildTelegramCtoWorkerExecutionPrompt({
    workflowState: { goal_text: 'Fix Telegram routing' },
    task: {
      id: 'fix-telegram-routing',
      title: 'Fix Telegram routing',
      depends_on: [],
      worker_prompt: 'Update the routing logic and add regression tests.'
    },
    agentSoulText: '# worker agent\n- stay practical',
    agentSoulPath: 'prompts/cto-worker-agent-soul.md'
  });

  assert.match(workerPrompt, new RegExp(`Child agent name: ${workerProfile.name_zh}`));
  assert.match(workerPrompt, /Child agent role: implementation partner/);
  assert.match(workerPrompt, /Active child-agent soul document \(prompts\/cto-worker-agent-soul\.md\):/);
  assert.match(workerPrompt, /summary\.result.*forward almost directly to the CEO/i);
  assert.match(workerPrompt, /Avoid English boilerplate such as "completed successfully"/i);
  assert.match(workerPrompt, /plain everyday language/i);
  assert.match(workerPrompt, /describe impact with a concrete usage scene/i);
  assert.match(workerPrompt, /wording-only\. Do not alter execution logic/i);
  assert.match(workerPrompt, /Worker directive from the CTO main thread:/);
});

test('cto worker execution prompt wraps child work under the main thread', () => {
  const prompt = buildTelegramCtoWorkerExecutionPrompt({
    workflowState: {
      goal_text: 'Fix the Telegram CTO workflow'
    },
    task: {
      id: 'fix-telegram-cto',
      title: 'Fix Telegram CTO flow',
      depends_on: ['inspect-current-flow'],
      worker_prompt: 'Update the IM routing and add regression coverage.'
    }
  });

  assert.match(prompt, /sandbox-side advisor session/i);
  assert.match(prompt, /sole orchestrator/i);
  assert.match(prompt, /Workflow goal: Fix the Telegram CTO workflow/);
  assert.match(prompt, /Task id: fix-telegram-cto/);
  assert.match(prompt, /Dependencies: inspect-current-flow/);
  assert.match(prompt, /CEO-facing CTO identity/i);
  assert.match(prompt, /Default to finishing the task end-to-end inside this run/i);
  assert.match(prompt, /Do not hand routine next steps back to the CTO/i);
  assert.match(prompt, /Keep `summary\.result` within 2 short sentences/i);
  assert.match(prompt, /Worker directive from the CTO main thread:/);
  assert.match(prompt, /Update the IM routing and add regression coverage\./);
});


test('cto workflow promotes a later actionable Telegram reply into the workflow goal', () => {
  const workflowState = {
    goal_text: '很好.加油',
    latest_user_message: '很好.加油',
    updated_at: '2026-03-09T04:49:40.000Z',
    user_messages: []
  };
  const message = {
    text: '继续推进，不需要等我，遇到高风险再确认',
    update_id: 2,
    message_id: 3,
    created_at: '2026-03-09T04:51:34.000Z'
  };

  assert.equal(isLikelyTelegramNonDirectiveMessage('很好.加油'), true);
  assert.equal(shouldPromoteWorkflowGoal(workflowState, message), true);

  appendWorkflowUserMessage(workflowState, message);

  assert.equal(workflowState.goal_text, '继续推进，不需要等我，遇到高风险再确认');
  assert.equal(workflowState.latest_user_message, '继续推进，不需要等我，遇到高风险再确认');
  assert.equal(workflowState.user_messages.length, 1);
});

test('cto workflow keeps the original goal when the later Telegram reply is only acknowledgement', () => {
  const workflowState = {
    goal_text: '修复 Telegram CTO 续跑逻辑',
    latest_user_message: '修复 Telegram CTO 续跑逻辑',
    updated_at: '2026-03-09T04:49:40.000Z',
    user_messages: []
  };
  const message = {
    text: '好的，加油',
    update_id: 4,
    message_id: 5,
    created_at: '2026-03-09T04:52:34.000Z'
  };

  assert.equal(isLikelyTelegramNonDirectiveMessage(message.text), true);
  assert.equal(shouldPromoteWorkflowGoal(workflowState, message), false);

  appendWorkflowUserMessage(workflowState, message);

  assert.equal(workflowState.goal_text, '修复 Telegram CTO 续跑逻辑');
  assert.equal(workflowState.latest_user_message, '好的，加油');
  assert.equal(workflowState.user_messages.length, 1);
});

test('createTelegramWorkflowState uses current clock time for workflow freshness', () => {
  const message = {
    text: 'please inspect',
    chat_id: '123456',
    update_id: 1,
    message_id: 2,
    sender_display: 'CEO',
    created_at: '2025-03-08T12:00:00.000Z'
  };
  const before = Date.now();
  const state = createTelegramWorkflowState({
    workflowSessionId: 'cto-20260322-000000-abcd12',
    message
  });
  const after = Date.now();

  const createdAt = Date.parse(state.created_at);
  const updatedAt = Date.parse(state.updated_at);
  assert.ok(Number.isFinite(createdAt));
  assert.ok(Number.isFinite(updatedAt));
  assert.ok(createdAt >= before && createdAt <= after);
  assert.ok(updatedAt >= before && updatedAt <= after);
  assert.equal(state.user_messages[0].created_at, message.created_at);
  assert.equal(state.long_tasks.length, 1);
  assert.equal(state.short_tasks.length, 0);
});

test('pending workflow resumes only for explicit continue or question answer', () => {
  const workflowState = {
    status: 'waiting_for_user',
    pending_question_zh: '在可写环境中修改 `src/commands/service.js` 增加 weekday reminder provider'
  };

  assert.equal(shouldResumeTelegramPendingWorkflow({
    workflowState,
    messageText: '继续。'
  }), true);
  assert.equal(shouldResumeTelegramPendingWorkflow({
    workflowState,
    messageText: '好，就改 service.js。'
  }), true);
  assert.equal(shouldResumeTelegramPendingWorkflow({
    workflowState,
    messageText: '这样，帮我的电脑播放音乐。'
  }), false);
});

test('cto intent classifier treats short greeting with emoticon as casual chat', () => {
  const classified = classifyTelegramCtoMessageIntent('嘿(ಡωಡ)');
  assert.equal(classified.kind, 'casual_chat');
  assert.equal(isLikelyTelegramCtoCasualChatMessage('嘿(ಡωಡ)'), true);
});

test('cto intent classifier still treats explicit execution requests as directive', () => {
  const classified = classifyTelegramCtoMessageIntent('继续推进 Telegram CTO 的续跑修复');
  assert.equal(classified.kind, 'directive');
});

test('cto intent classifier does not downgrade progress-push directives into status queries', () => {
  const classified = classifyTelegramCtoMessageIntent('继续检查项目进度,推进项目落地,优化框架与用户体验.');
  assert.equal(classified.kind, 'directive');
});

test('cto intent classifier treats colloquial completion follow-ups as status queries', () => {
  const classified = classifyTelegramCtoMessageIntent('这个任务完成没有？');
  assert.equal(classified.kind, 'status_query');
});

test('cto intent classifier treats location-style greeting as casual chat', () => {
  const classified = classifyTelegramCtoMessageIntent('嘿，你在哪？');
  assert.equal(classified.kind, 'casual_chat');
});

test('cto intent classifier treats social small talk as casual chat instead of a workflow directive', () => {
  const classified = classifyTelegramCtoMessageIntent('你吃晚餐了吗');
  assert.equal(classified.kind, 'casual_chat');
  assert.equal(isLikelyTelegramCtoCasualChatMessage('你吃晚餐了吗'), true);
  assert.equal(shouldKeepTelegramCtoInConversationMode({
    text: '你吃晚餐了吗',
    chatState: { direct_reply_count: 0 },
    hasPendingWorkflow: false
  }), false);
});

test('cto intent classifier treats praise-only feedback as casual chat', () => {
  const classified = classifyTelegramCtoMessageIntent('你好厉害，居然能秒回。');
  assert.equal(classified.kind, 'casual_chat');
});

test('cto conversation gate keeps the first vague task-like turn in chat mode', () => {
  assert.equal(shouldKeepTelegramCtoInConversationMode({
    text: '帮我看看',
    chatState: { direct_reply_count: 0 },
    hasPendingWorkflow: false
  }), true);
});

test('cto conversation gate keeps vague follow-ups on the chat main line when the last mode was conversation', () => {
  assert.equal(shouldKeepTelegramCtoInConversationMode({
    text: '帮我看看',
    chatState: { direct_reply_count: 3, last_mode: 'conversation' },
    hasPendingWorkflow: false
  }), true);
});

test('cto conversation gate keeps vague follow-ups on the chat main line when a workflow is already active', () => {
  assert.equal(shouldKeepTelegramCtoInConversationMode({
    text: '帮我看看',
    chatState: { direct_reply_count: 3, last_mode: 'workflow' },
    hasPendingWorkflow: false,
    hasActiveWorkflow: true
  }), true);
});

test('cto conversation gate keeps context-missing problem explanations on the chat main line', () => {
  assert.equal(shouldKeepTelegramCtoInConversationMode({
    text: '解释一下这个问题。。',
    chatState: { direct_reply_count: 2 },
    hasPendingWorkflow: false
  }), true);
  assert.equal(shouldKeepTelegramCtoInConversationMode({
    text: '帮我看看这个报错怎么回事',
    chatState: { direct_reply_count: 2 },
    hasPendingWorkflow: true
  }), true);
});

test('cto conversation gate keeps references to the previous pending question on the chat main line', () => {
  assert.equal(shouldKeepTelegramCtoInConversationMode({
    text: '我觉得你可以解释一下这个待确认问题。',
    chatState: {
      direct_reply_count: 1,
      last_pending_question: '是否在可写环境中按上述最小方案修改 `src/commands/im.js`。'
    },
    hasPendingWorkflow: false
  }), true);
});

test('cto conversation gate keeps exploration turns in direct discussion mode', () => {
  assert.equal(shouldKeepTelegramCtoInConversationMode({
    text: '我们先研究一下任务栏 UI 和 Telegram 的关系',
    chatState: { direct_reply_count: 3 },
    hasPendingWorkflow: false
  }), true);
});

test('cto conversation gate keeps interaction-policy discussion on the chat main line', () => {
  assert.equal(classifyTelegramCtoMessageIntent('我希望我们即时通讯才是主线，聊天触发 workflow，但不是每句话都要触发 workflow。').kind, 'exploration');
  assert.equal(shouldKeepTelegramCtoInConversationMode({
    text: '我希望我们即时通讯才是主线，聊天触发 workflow，但不是每句话都要触发 workflow。',
    chatState: { direct_reply_count: 0 },
    hasPendingWorkflow: false
  }), true);
});

test('cto conversation gate allows strong directives to enter orchestration', () => {
  assert.equal(isStrongTelegramCtoDirectiveMessage('继续推进 Telegram CTO 续跑修复并补测试'), true);
  assert.equal(shouldKeepTelegramCtoInConversationMode({
    text: '继续推进 Telegram CTO 续跑修复并补测试',
    chatState: { direct_reply_count: 0 },
    hasPendingWorkflow: false
  }), false);
});

test('cto conversation gate allows concrete interaction-policy fix requests into orchestration', () => {
  const text = '继续处理，当前编排没有达到我的要求。1, 任务不能自行推进。2, 不能自主完成任务。3, 主线 chat 还是格式化回复。默认推进解决这些东西。';
  assert.equal(classifyTelegramCtoMessageIntent(text).kind, 'directive');
  assert.equal(shouldKeepTelegramCtoInConversationMode({
    text,
    chatState: { direct_reply_count: 0 },
    hasPendingWorkflow: false
  }), false);
});



test('cto conversation gate keeps planner-confirm triggers in orchestration', () => {
  assert.equal(shouldKeepTelegramCtoInConversationMode({
    text: 'need confirm',
    chatState: { direct_reply_count: 0 },
    hasPendingWorkflow: false
  }), false);
});

test('cto conversation gate keeps concrete inspection requests in orchestration', () => {
  assert.equal(shouldKeepTelegramCtoInConversationMode({
    text: 'CTO 检查你的思考深度是不是最高',
    chatState: { direct_reply_count: 0 },
    hasPendingWorkflow: false
  }), false);
});


test('cto workflow identifies stale historical workflows and injects a default repair task', () => {
  const candidates = collectHistoricalStuckCtoWorkflowCandidates([
    {
      session: {
        session_id: 'cto-20260309-old-running',
        command: 'cto',
        status: 'running',
        updated_at: '2026-03-09T05:00:00.000Z',
        input: { prompt: 'Repair the tray UI' }
      },
      workflowState: {
        status: 'running',
        goal_text: 'Repair the tray UI',
        pending_question_zh: '',
        updated_at: '2026-03-09T05:00:00.000Z',
        tasks: [
          { status: 'running' }
        ]
      }
    },
    {
      session: {
        session_id: 'cto-20260309-waiting',
        command: 'cto',
        status: 'partial',
        updated_at: '2026-03-09T05:00:00.000Z',
        input: { prompt: 'Need a decision' }
      },
      workflowState: {
        status: 'waiting_for_user',
        goal_text: 'Need a decision',
        pending_question_zh: '请确认是否继续。',
        updated_at: '2026-03-09T05:00:00.000Z',
        tasks: []
      }
    }
  ], {
    currentWorkflowSessionId: 'cto-current',
    staleMinutes: 30,
    now: '2026-03-09T06:00:00.000Z'
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].session_id, 'cto-20260309-old-running');
  assert.match(candidates[0].reason, /stale threshold/i);

  const plan = injectHistoricalCtoRepairTask({
    mode: 'execute',
    summary_zh: '已拆分 1 个可执行任务。',
    question_zh: '',
    task_counter: 1,
    tasks: [
      {
        id: 'inspect-repo',
        title: 'Inspect repo',
        worker_prompt: 'Inspect the repository.',
        depends_on: [],
        status: 'queued',
        session_id: '',
        summary_status: '',
        result: '',
        next_steps: [],
        changed_files: [],
        updated_at: ''
      }
    ]
  }, {
    candidates,
    cwd: '/repo/openCodex',
    currentWorkflowSessionId: 'cto-current',
    staleMinutes: 30
  });

  assert.equal(plan.tasks.length, 2);
  assert.equal(plan.tasks[0].id, 'repair-historical-workflows');
  assert.match(plan.tasks[0].title, /Repair historical stuck workflows/);
  assert.match(plan.tasks[0].worker_prompt, /session repair/);
  assert.match(plan.tasks[0].worker_prompt, /OPENCODEX_REPAIR_SKIP_SESSION_ID/);
  assert.match(plan.summary_zh, /历史卡住 workflow/);
});



test('cto cancel helper marks active tasks cancelled and renders a cancelled final reply', () => {
  const workflowState = cancelTelegramWorkflowState({
    workflow_session_id: 'cto-demo',
    goal_text: 'Cancel demo workflow',
    status: 'running',
    pending_question_zh: 'old question',
    updated_at: '2026-03-09T00:00:00.000Z',
    tasks: [
      { id: 'task-1', title: 'Queued task', status: 'queued', next_steps: ['x'] },
      { id: 'task-2', title: 'Running task', status: 'running', next_steps: ['y'] },
      { id: 'task-3', title: 'Completed task', status: 'completed', next_steps: [] }
    ]
  });

  const finalText = buildTelegramCtoFinalText(workflowState);
  assert.equal(workflowState.status, 'cancelled');
  assert.equal(workflowState.pending_question_zh, '');
  assert.equal(workflowState.tasks[0].status, 'cancelled');
  assert.equal(workflowState.tasks[1].status, 'cancelled');
  assert.equal(workflowState.tasks[2].status, 'completed');
  assert.match(finalText, /这轮先停在这里/);
  assert.match(finalText, /已取消 2 项/);
});

test('cto waiting reply uses a clear Chinese checklist', () => {
  const text = buildTelegramCtoQuestionText({
    pending_question_zh: '请确认是否继续修改本地仓库。',
    tasks: [
      { status: 'completed' },
      { status: 'failed' },
      { status: 'partial' }
    ]
  });

  assert.match(text, /这条主线我先推进到这里，现在需要你确认一件事/);
  assert.match(text, /需要你确认的是：请确认是否继续修改本地仓库/);
  assert.match(text, /我这边已经完成 1 项，失败 1 项，待跟进 1 项/);
});

test('cto status reply keeps progress natural and foregrounds the mainline with short tasks', () => {
  const text = buildTelegramCtoStatusText({
    workflow_session_id: 'cto-123',
    goal_text: '修一下 Telegram CTO 的主线陪伴感',
    status: 'waiting_for_user',
    plan_summary_zh: '已经补了主线陪伴文案，还差你确认是否继续扩范围。',
    pending_question_zh: '是否继续把同样的口吻扩到更多状态回执。',
    tasks: [
      { id: 'presence-first-patch', title: 'Patch presence reply', status: 'completed' }
    ]
  });

  assert.match(text, /^这条主线我还在跟，现在有个问题需要你确认。/);
  assert.match(text, /主线：修一下 Telegram CTO 的主线陪伴感/);
  assert.match(text, /现在到这：已经补了主线陪伴文案，还差你确认是否继续扩范围。/);
  assert.match(text, /手头短任务：/);
  assert.match(text, /\[已完成\] Patch presence reply：已经做完了。/);
  assert.match(text, /现在需要你确认：是否继续把同样的口吻扩到更多状态回执。/);
  assert.doesNotMatch(text, /openCodex CTO 工作流汇报|Workflow:/);
});

test('cto final reply summarizes multiple completed tasks in simple Chinese bullets', () => {
  const workflowState = {
    status: 'completed',
    tasks: [
      {
        id: 'task-1',
        title: 'Inspect repository',
        status: 'completed',
        result: 'The mock repository inspection completed successfully.',
        changed_files: ['src/mock-inspection.js']
      },
      {
        id: 'task-2',
        title: 'Summarize findings',
        status: 'completed',
        result: 'The mock findings summary completed successfully.',
        changed_files: ['docs/en/mock-summary.md', 'docs/zh/mock-summary.md'],
        next_steps: ['Share the summary with the CEO.']
      }
    ]
  };

  const finalText = buildTelegramCtoFinalText(workflowState);
  assert.match(finalText, /^这轮已经处理完了。/);
  assert.match(finalText, /共完成 2 项。/);
  assert.match(finalText, /本轮结果：/);
  assert.match(finalText, /已完成：Inspect repository。已经检查完了。/);
  assert.match(finalText, /已完成：Summarize findings。已经处理完，结果也整理好了。/);
  assert.match(finalText, /改动文件：/);
  assert.match(finalText, /src\/mock-inspection\.js/);
  assert.match(finalText, /后续建议：/);
  assert.match(finalText, /把整理好的结果同步给我。/);
});

test('cto partial final reply keeps blockers and next steps readable', () => {
  const finalText = buildTelegramCtoFinalText({
    status: 'partial',
    tasks: [
      {
        id: 'task-1',
        title: '修正最终回执格式',
        status: 'completed',
        result: '已经改成中文短段落和简单列表。'
      },
      {
        id: 'task-2',
        title: '确认是否保留文件列表',
        status: 'partial',
        result: '',
        next_steps: ['请确认最终回执里是否还要继续带上改动文件列表。']
      }
    ]
  });

  assert.match(finalText, /这轮先做到这里，还没完全收口。/);
  assert.match(finalText, /当前卡点：/);
  assert.match(finalText, /待跟进：确认是否保留文件列表。请确认最终回执里是否还要继续带上改动文件列表。/);
  assert.match(finalText, /已完成部分：/);
  assert.match(finalText, /已完成：修正最终回执格式。已经改成中文短段落和简单列表。/);
  assert.match(finalText, /建议下一步：/);
});

test('cto waiting final reply keeps confirmation and changed files readable', () => {
  const finalText = buildTelegramCtoFinalText({
    status: 'waiting_for_user',
    pending_question_zh: '请确认是否继续按最小改动推进。',
    tasks: [
      {
        id: 'task-1',
        title: '修正最终回执格式',
        status: 'completed',
        result: '已经改成中文短段落和简单列表。',
        changed_files: ['src/lib/cto-workflow.js']
      }
    ]
  });

  assert.match(finalText, /这轮先做到这里，现在需要你确认一下。/);
  assert.match(finalText, /需要你确认：/);
  assert.match(finalText, /请确认是否继续按最小改动推进。/);
  assert.match(finalText, /已完成部分：/);
  assert.match(finalText, /改动文件：/);
  assert.match(finalText, /src\/lib\/cto-workflow\.js/);
});

test('cto final reply stays compact instead of relying on Telegram truncation', () => {
  const workflowState = {
    status: 'completed',
    tasks: [
      {
        id: 'task-1',
        title: 'Inspect repository',
        status: 'completed',
        result: 'A'.repeat(2000)
      },
      {
        id: 'task-2',
        title: 'Summarize findings',
        status: 'completed',
        result: 'B'.repeat(2000)
      },
      {
        id: 'task-3',
        title: 'Verify reply',
        status: 'completed',
        result: 'C'.repeat(2000)
      },
      {
        id: 'task-4',
        title: 'Ship result',
        status: 'completed',
        result: 'D'.repeat(2000)
      }
    ]
  };

  const finalText = buildTelegramCtoFinalText(workflowState);
  assert.ok(finalText.length < 1200);
  assert.match(finalText, /另外还有 1 项已完成，这里先不展开。/);
});

test('cto workflow finalization does not turn failed dependency chains into waiting', () => {
  const workflowState = {
    status: 'running',
    pending_question_zh: '',
    tasks: [
      { id: 'write-patch', status: 'failed' },
      { id: 'verify-patch', status: 'queued' }
    ]
  };

  assert.equal(finalizeWorkflowStatus(workflowState), 'failed');
  assert.equal(workflowState.pending_question_zh, '');
});

test('cto session summary describes partial workflows without calling them running', () => {
  const summary = buildTelegramCtoSessionSummary({
    chat_id: '123456',
    status: 'partial',
    pending_question_zh: '',
    tasks: [
      { status: 'completed' },
      { status: 'failed' }
    ]
  });

  assert.equal(summary.status, 'partial');
  assert.match(summary.result, /needs follow-up/i);
  assert.doesNotMatch(summary.result, /running with 0 active/i);
});


test('cto rerouted tasks stay active without inflating local running counts', () => {
  const workflowState = {
    chat_id: '123456',
    status: 'running',
    pending_question_zh: '',
    tasks: [
      {
        id: 'reroute-docs',
        title: 'Reroute docs audit',
        status: 'running',
        summary_status: 'rerouted',
        result: 'Task was rerouted to the host executor queue.'
      }
    ]
  };

  const counts = summarizeWorkflowCounts(workflowState);
  assert.equal(counts.running, 0);
  assert.equal(counts.rerouted, 1);
  assert.equal(finalizeWorkflowStatus(workflowState), 'running');

  const summary = buildTelegramCtoSessionSummary(workflowState);
  assert.equal(summary.status, 'running');
  assert.match(summary.result, /1 rerouted host-executor task/i);
});

test('cto rerouted task result keeps explicit host-executor contract metadata', () => {
  const workflowState = {
    status: 'running',
    pending_question_zh: '',
    tasks: [
      {
        id: 'reroute-docs',
        title: 'Reroute docs',
        status: 'running',
        session_id: 'run-task-7-source',
        summary_status: '',
        result: '',
        next_steps: [],
        changed_files: [],
        validation: [],
        session_contract: null,
        reroute_job_id: '',
        reroute_record_path: ''
      }
    ]
  };

  applyWorkflowTaskResult(workflowState, 'reroute-docs', {
    code: 0,
    sessionId: 'run-task-7-source',
    rerouteJobId: 'host-20260309-reroute',
    rerouteRecordPath: '/tmp/host-20260309-reroute.json',
    summary: {
      status: 'rerouted',
      result: '任务已转入 host executor queue。',
      next_steps: [],
      changed_files: [],
      validation: ['host_executor:queued'],
      session_contract: {
        schema: 'opencodex/session-contract/v1',
        layer: 'host',
        scope: 'telegram_cto',
        thread_kind: 'host_executor',
        role: 'worker',
        supervisor_session_id: 'cto-20260309-rerouted'
      }
    }
  });

  assert.equal(workflowState.tasks[0].summary_status, 'rerouted');
  assert.equal(workflowState.tasks[0].status, 'running');
  assert.equal(workflowState.tasks[0].session_contract?.thread_kind, 'host_executor');
  assert.equal(workflowState.tasks[0].session_contract?.role, 'worker');
  assert.equal(workflowState.tasks[0].reroute_job_id, 'host-20260309-reroute');
});

test('cto task result adds a tone-guard warning when report-style markers appear', () => {
  const workflowState = {
    status: 'running',
    pending_question_zh: '',
    tasks: [
      {
        id: 'task-1',
        title: 'Tone check',
        status: 'running',
        summary_status: '',
        result: '',
        next_steps: [],
        changed_files: [],
        validation: []
      }
    ]
  };

  applyWorkflowTaskResult(workflowState, 'task-1', {
    code: 0,
    summary: {
      status: 'completed',
      result: '交付摘要：已更新校验路径。\n关键改动：新增守卫。',
      next_steps: [],
      changed_files: []
    }
  });

  assert.deepEqual(workflowState.tasks[0].validation, ['tone_guard:warn:report_markers']);
  const summary = buildTelegramCtoSessionSummary(workflowState);
  assert.deepEqual(summary.validation, ['task-1 tone_guard:warn:report_markers']);
});

test('cto task result adds tone-guard pass for concise plain update', () => {
  const workflowState = {
    status: 'running',
    pending_question_zh: '',
    tasks: [
      {
        id: 'task-1',
        title: 'Tone pass',
        status: 'running',
        summary_status: '',
        result: '',
        next_steps: [],
        changed_files: [],
        validation: []
      }
    ]
  };

  applyWorkflowTaskResult(workflowState, 'task-1', {
    code: 0,
    summary: {
      status: 'completed',
      result: '我把回执语气检查接到任务结果写入里了，后续再漂移会被标记出来。',
      next_steps: [],
      changed_files: []
    }
  });

  assert.deepEqual(workflowState.tasks[0].validation, ['tone_guard:pass']);
  const summary = buildTelegramCtoSessionSummary(workflowState);
  assert.deepEqual(summary.validation, []);
});

test('cto planner auto-infers a safe execute plan from an abstract inspection request', () => {
  const plan = normalizeTelegramCtoPlan({
    mode: 'confirm',
    summary_zh: '当前还缺少更具体的执行对象。',
    question_zh: '请直接给本轮要推进的具体目标。',
    tasks: []
  }, 'CTO 检查你的思考深度是不是最高', {
    task_counter: 0,
    tasks: [],
    goal_text: 'CTO 检查你的思考深度是不是最高'
  });

  assert.equal(plan.mode, 'execute');
  assert.match(plan.summary_zh, /自动推断/);
  assert.equal(plan.tasks.length, 1);
  assert.equal(plan.tasks[0].id, 'audit-cto-reasoning');
  assert.match(plan.tasks[0].title, /Audit CTO reasoning depth/);
  assert.match(plan.tasks[0].worker_prompt, /src\/lib\/cto-workflow\.js/);
});

test('cto planner auto-infers an interaction-flow repair plan from a concrete policy-fix request', () => {
  const plan = normalizeTelegramCtoPlan({
    mode: 'confirm',
    summary_zh: '当前还缺少更具体的执行对象。',
    question_zh: '请直接给本轮要推进的具体目标。',
    tasks: []
  }, '继续处理，当前编排没有达到我的要求。1, 任务不能自行推进。2, 不能自主完成任务。3, 主线 chat 还是格式化回复。默认推进解决这些东西。', {
    task_counter: 0,
    tasks: [],
    goal_text: '继续处理 CTO 交互与编排问题'
  });

  assert.equal(plan.mode, 'execute');
  assert.match(plan.summary_zh, /交互与编排修正/);
  assert.equal(plan.tasks.length, 1);
  assert.equal(plan.tasks[0].id, 'improve-cto-interaction-flow');
  assert.match(plan.tasks[0].title, /Improve CTO chat-first interaction flow/);
  assert.match(plan.tasks[0].worker_prompt, /chat stays the main continuity thread/);
});
