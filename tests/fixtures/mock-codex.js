#!/usr/bin/env node
import { writeFileSync } from 'node:fs';

const rawArgs = process.argv.slice(2);
const args = stripGlobalArgs(rawArgs);

if (rawArgs[0] === '--version') {
  console.log('codex-cli 0.116.0');
  process.exit(0);
}

if (args[0] === 'login' && args[1] === 'status') {
  console.log('Logged in using an API key - sk-test');
  process.exit(0);
}

if (args[0] === 'mcp' && args[1] === 'list' && args[2] === '--json') {
  console.log('[]');
  process.exit(0);
}

if (args[0] === 'exec') {
  const outputSchemaIndex = args.indexOf('--output-schema');
  const lastMessageIndex = args.indexOf('--output-last-message');
  const schemaPath = outputSchemaIndex >= 0 ? args[outputSchemaIndex + 1] : null;
  const lastMessagePath = lastMessageIndex >= 0 ? args[lastMessageIndex + 1] : null;
  const prompt = args.at(-1) || '';

  if (schemaPath) {
    console.log(JSON.stringify({ type: 'schema', path: schemaPath }));
  }

  if (schemaPath && schemaPath.includes('cto-workflow-plan.schema.json')) {
    const plan = buildPlannerPayload(prompt);
    if (lastMessagePath) {
      writeFileSync(lastMessagePath, JSON.stringify(plan, null, 2));
    }
    console.log(JSON.stringify({ type: 'event', message: 'mock cto planner event' }));
    process.exit(0);
  }

  maybeSleep(prompt);

  if (lastMessagePath) {
    writeFileSync(lastMessagePath, JSON.stringify(buildRunPayload(prompt), null, 2));
  }

  console.log(JSON.stringify({ type: 'event', message: 'mock execution event' }));
  process.exit(0);
}

if (args[0] === 'review') {
  console.log([
    'codex',
    'Potential issue: missing tests around edge paths.',
    '',
    'Full review comments:',
    '',
    '- [P2] Add regression coverage for empty summaries — tests/review.test.js:39-56',
    '  The current review path stores a summary, but it does not assert the empty-summary branch.',
    '  Add a regression test so later parser changes do not silently drop fallback behavior.'
  ].join('\n'));
  process.exit(0);
}

console.error(`Unsupported mock codex invocation: ${rawArgs.join(' ')}`);
process.exit(1);

function buildPlannerPayload(prompt) {
  if (prompt.includes('思考深度')) {
    return {
      mode: 'confirm',
      summary_zh: '当前还缺少更具体的执行对象。',
      question_zh: '请直接给本轮要推进的具体目标。',
      tasks: []
    };
  }
  if (prompt.includes('need confirm') || prompt.includes('ask before editing')) {
    return {
      mode: 'confirm',
      summary_zh: '当前需要你先确认关键决策。',
      question_zh: '请确认是否继续修改本地仓库。',
      tasks: []
    };
  }

  if (prompt.includes('Pending question for the CEO:') && !prompt.includes('Pending question for the CEO:\n(none)')) {
    return {
      mode: 'execute',
      summary_zh: '已根据你的回复恢复执行。',
      question_zh: '',
      tasks: [
        {
          id: 'resume-work',
          title: 'Resume workflow',
          worker_prompt: 'MOCK_WORKER resume-flow',
          depends_on: []
        }
      ]
    };
  }

  if (prompt.includes('parallel slow')) {
    return {
      mode: 'execute',
      summary_zh: '已拆分为慢任务工作流。',
      question_zh: '',
      tasks: [
        {
          id: 'slow-task',
          title: 'Slow task',
          worker_prompt: 'MOCK_WORKER slow-500',
          depends_on: []
        }
      ]
    };
  }

  if (prompt.includes('parallel fast')) {
    return {
      mode: 'execute',
      summary_zh: '已拆分为快速工作流。',
      question_zh: '',
      tasks: [
        {
          id: 'fast-task',
          title: 'Fast task',
          worker_prompt: 'MOCK_WORKER fast',
          depends_on: []
        }
      ]
    };
  }

  if (prompt.includes('restart chain')) {
    return {
      mode: 'execute',
      summary_zh: '已拆分为可恢复的串行工作流。',
      question_zh: '',
      tasks: [
        {
          id: 'slow-task',
          title: 'Slow task',
          worker_prompt: 'MOCK_WORKER slow-500',
          depends_on: []
        },
        {
          id: 'fast-task',
          title: 'Fast task',
          worker_prompt: 'MOCK_WORKER fast',
          depends_on: ['slow-task']
        }
      ]
    };
  }

  if (prompt.includes('下载文件夹') || /save(?: the)? .*downloads/i.test(prompt)) {
    return {
      mode: 'execute',
      summary_zh: '已准备导出到下载文件夹。',
      question_zh: '',
      tasks: [
        {
          id: 'export-downloads',
          title: 'Export documents to Downloads',
          worker_prompt: 'MOCK_WORKER export-downloads',
          depends_on: []
        }
      ]
    };
  }

  return {
    mode: 'execute',
    summary_zh: '已拆分任务并开始调度。',
    question_zh: '',
    tasks: [
      {
        id: 'inspect-repo',
        title: 'Inspect repository',
        worker_prompt: 'MOCK_WORKER inspect-repo',
        depends_on: []
      },
      {
        id: 'summarize-findings',
        title: 'Summarize findings',
        worker_prompt: 'MOCK_WORKER summarize-findings',
        depends_on: ['inspect-repo']
      }
    ]
  };
}

function buildRunPayload(prompt) {
  if (prompt.includes('MOCK_WORKER slow-500')) {
    return {
      title: 'Mock slow task completed',
      result: 'The mock slow worker finished successfully.',
      status: 'completed',
      highlights: ['Slow mock task completed.'],
      next_steps: [],
      risks: [],
      validation: [],
      changed_files: ['src/mock-slow.js'],
      findings: []
    };
  }

  if (prompt.includes('MOCK_WORKER fast')) {
    return {
      title: 'Mock fast task completed',
      result: 'The mock fast worker finished successfully.',
      status: 'completed',
      highlights: ['Fast mock task completed.'],
      next_steps: [],
      risks: [],
      validation: [],
      changed_files: ['src/mock-fast.js'],
      findings: []
    };
  }

  if (prompt.includes('MOCK_WORKER inspect-repo')) {
    return {
      title: 'Mock repo inspection completed',
      result: 'The mock repository inspection completed successfully.',
      status: 'completed',
      highlights: ['Repository scan finished.'],
      next_steps: [],
      risks: [],
      validation: [],
      changed_files: ['src/mock-inspection.js'],
      findings: []
    };
  }

  if (prompt.includes('MOCK_WORKER export-downloads')) {
    if (process.env.OPENCODEX_HOST_EXECUTOR_JOB_ID) {
      return {
        title: 'Mock export completed',
        result: 'The export to Downloads completed successfully.',
        status: 'completed',
        highlights: ['Downloads export finished.'],
        next_steps: [],
        risks: [],
        validation: [],
        changed_files: ['/Users/lijianqian/Downloads/mock-report.md'],
        findings: []
      };
    }

    return {
      title: 'Mock export blocked',
      result: '实际复制被当前只读沙箱拦住了，没能写入 Downloads。',
      status: 'partial',
      highlights: ['The export is blocked by the current sandbox.'],
      next_steps: ['请切到宿主环境继续导出到 Downloads。'],
      risks: ['当前环境无法写入 Downloads。'],
      validation: ['cp "/tmp/mock-report.md" "/Users/lijianqian/Downloads/mock-report.md" -> Operation not permitted'],
      changed_files: [],
      findings: ['下载目录导出被只读沙箱阻断']
    };
  }

  if (prompt.includes('MOCK_WORKER summarize-findings')) {
    return {
      title: 'Mock summary completed',
      result: 'The mock findings summary completed successfully.',
      status: 'completed',
      highlights: ['Summary task finished.'],
      next_steps: [],
      risks: [],
      validation: [],
      changed_files: ['docs/en/mock-summary.md', 'docs/zh/mock-summary.md'],
      findings: []
    };
  }

  if (prompt.includes('MOCK_WORKER resume-flow')) {
    return {
      title: 'Mock resumed workflow completed',
      result: 'The resumed mock workflow finished successfully.',
      status: 'completed',
      highlights: ['Resume task finished.'],
      next_steps: [],
      risks: [],
      validation: [],
      changed_files: ['src/mock-resume.js'],
      findings: []
    };
  }

  if (prompt.includes('Conversation gate mode: Telegram CTO pre-orchestration reply.')) {
    if (prompt.includes('The message points to a problem, error, or situation without enough context.')) {
      return {
        title: 'Telegram CTO direct reply',
        result: '先不急着开 workflow。\n请把“这个问题”的具体内容发我：报错、现象、相关文件路径，或直接贴截图/日志。',
        status: 'completed',
        highlights: [],
        next_steps: [],
        risks: [],
        validation: [],
        changed_files: [],
        findings: []
      };
    }
    if (prompt.includes('The CEO is referring to your immediately previous pending question, not opening a new workflow.')) {
      return {
        title: 'Telegram CTO direct reply',
        result: '我说的待确认问题，是想确认是否就在可写环境里按最小方案改 `src/commands/im.js`。\n因为这一步一旦开改，就从分析进入真实实现了。\n你如果同意，我就按那条最小改法继续推进。',
        status: 'completed',
        highlights: [],
        next_steps: [],
        risks: [],
        validation: [],
        changed_files: [],
        findings: []
      };
    }
    return {
      title: 'Telegram CTO direct reply',
      result: '我在，先不急着进入员工编排。\n你可以先告诉我想聊聊方向，或者直接给一个具体目标。\n等意图明确后，我再切到编排模式并持续汇报进度。',
      status: 'completed',
      highlights: [],
      next_steps: [],
      risks: [],
      validation: [],
      changed_files: [],
      findings: []
    };
  }

  if (prompt.includes('Workflow reply mode: Telegram CTO workflow-facing reply.')) {
    const replyKind = prompt.match(/Reply kind:\s*([a-z-]+)/i)?.[1] || 'status';
    const facts = extractWorkflowReplyFacts(prompt);
    return {
      title: 'Telegram CTO workflow reply',
      result: buildWorkflowReplyResult(replyKind, facts),
      status: 'completed',
      highlights: [],
      next_steps: [],
      risks: [],
      validation: [],
      changed_files: [],
      findings: []
    };
  }

  if (prompt.includes('Direct mode: Telegram CTO direct reply.')) {
    const hasPendingWorkflow = prompt.includes('There is already a waiting CTO workflow for this chat.');
    const hasActiveWorkflow = prompt.includes('There is an active CTO workflow still running in the background for this chat.');
    return {
      title: 'Telegram CTO direct reply',
      result: hasPendingWorkflow
        ? '可以，我在。\n当前 Workflow 仍保持等待中；如果要继续，请直接回复待确认问题。\n我不会因为这条闲聊消息改写当前工作流。'
        : (hasActiveWorkflow
          ? '我在。\n后台那条主线我还在继续推进，不会因为现在聊天停下来。\n你继续说，我这边边跑边跟，不阻塞。'
          : '可以，我在。\n如果你要我执行，请直接告诉我明确目标。\n如果要查进度，也可以直接问我当前 workflow 状态。'),
      status: 'completed',
      highlights: [],
      next_steps: [],
      risks: [],
      validation: [],
      changed_files: [],
      findings: []
    };
  }

  return {
    title: 'Mock run completed',
    result: 'The mock Codex binary executed successfully.',
    status: 'completed',
    highlights: ['Structured result returned by mock codex.'],
    next_steps: ['Replace mock binary with real Codex CLI.'],
    risks: [],
    validation: [],
    changed_files: [],
    findings: []
  };
}

function extractWorkflowReplyFacts(prompt) {
  const match = String(prompt || '').match(/Workflow facts \(JSON\):\n([\s\S]+?)(?:\n\nFor a|\nFor a|$)/);
  if (!match) {
    return {};
  }
  try {
    return JSON.parse(match[1]);
  } catch {
    return {};
  }
}

function buildWorkflowReplyResult(replyKind, facts) {
  if (replyKind === 'question') {
    const lines = [
      '这条主线我先推进到这里，现在需要你确认一件事。',
      `需要你确认的是：${facts.pending_question_zh || '请补充执行所需信息。'}`
    ];
    if (facts?.counts && (facts.counts.completed > 0 || facts.counts.failed > 0 || facts.counts.partial > 0)) {
      lines.push(`我这边已经完成 ${facts.counts.completed || 0} 项，失败 ${facts.counts.failed || 0} 项，待跟进 ${facts.counts.partial || 0} 项。`);
    }
    return lines.join('\n');
  }

  if (replyKind === 'final') {
    return buildWorkflowFinalReplyResult(facts);
  }

  return buildWorkflowStatusReplyResult(facts);
}

function buildWorkflowStatusReplyResult(facts) {
  const lines = [
    buildWorkflowStatusOpening(facts.workflow_status),
    `主线：${facts?.mainline?.title_zh || facts.goal_text || '当前主线'}`,
    `现在到这：${facts?.mainline?.summary_zh || facts.plan_summary_zh || '还在继续推进。'}`
  ];

  if (Array.isArray(facts.short_tasks) && facts.short_tasks.length > 0) {
    lines.push('手头短任务：');
    for (const task of facts.short_tasks.slice(0, 4)) {
      lines.push(`- [${formatWorkflowShortTaskStatus(task.status)}] ${task.title || '任务'}${task.summary_zh ? `：${task.summary_zh}` : ''}`);
    }
  } else {
    lines.push('手头短任务：暂无。');
  }

  if (facts.pending_question_zh) {
    lines.push(`现在需要你确认：${facts.pending_question_zh}`);
  } else if (facts?.mainline?.next_step_zh && !['completed', 'cancelled'].includes(String(facts.workflow_status || '').trim())) {
    lines.push(`下一步：${facts.mainline.next_step_zh}`);
  }

  return lines.join('\n');
}

function buildWorkflowFinalReplyResult(facts) {
  const status = String(facts.workflow_status || '').trim();
  const counts = facts.counts || {};
  const completedTasks = Array.isArray(facts.completed_tasks) ? facts.completed_tasks : [];
  const issueTasks = Array.isArray(facts.issue_tasks) ? facts.issue_tasks : [];
  const changedFiles = Array.isArray(facts.changed_files) ? facts.changed_files : [];
  const nextSteps = Array.isArray(facts.next_steps) ? facts.next_steps : [];
  const lines = [];

  if (status === 'completed') {
    lines.push('这轮已经处理完了。');
    lines.push(counts.completed > 0 ? `共完成 ${counts.completed} 项。` : '相关事项已经处理完。');
    appendSection(lines, '本轮结果', completedTasks, 3);
    appendSection(lines, '改动文件', changedFiles, 4);
    appendSection(lines, '后续建议', nextSteps, 2);
    return lines.join('\n');
  }

  if (status === 'cancelled') {
    lines.push('这轮先停在这里了。');
    if ((counts.cancelled || 0) > 0) {
      lines.push(`已取消 ${counts.cancelled} 项尚未完成的任务。`);
    }
    appendSection(lines, '已完成部分', completedTasks, 2);
    appendSection(lines, '改动文件', changedFiles, 4);
    return lines.join('\n');
  }

  if (status === 'waiting_for_user') {
    lines.push('这轮先做到这里，现在需要你确认一下。');
    lines.push(`已完成 ${counts.completed || 0} 项，待继续 ${counts.partial || 0} 项，失败 ${counts.failed || 0} 项。`);
    appendSection(lines, '需要你确认', [facts.pending_question_zh || '请确认下一步处理方式。'], 1);
    appendSection(lines, '已完成部分', completedTasks, 2);
    appendSection(lines, '改动文件', changedFiles, 4);
    return lines.join('\n');
  }

  if (status === 'failed') {
    lines.push('这轮卡住了，还没顺利收口。');
    lines.push(counts.failed > 0 ? `失败 ${counts.failed} 项。` : '执行过程中出错了。');
    appendSection(lines, '主要问题', issueTasks, 3);
    appendSection(lines, '已完成部分', completedTasks, 2);
    appendSection(lines, '建议下一步', nextSteps, 2);
    appendSection(lines, '改动文件', changedFiles, 4);
    return lines.join('\n');
  }

  if (status === 'partial') {
    lines.push('这轮先做到这里，还没完全结束。');
    lines.push(`已完成 ${counts.completed || 0} 项，待继续 ${counts.partial || 0} 项，失败 ${counts.failed || 0} 项。`);
    appendSection(lines, '当前卡点', issueTasks, 3);
    appendSection(lines, '已完成部分', completedTasks, 2);
    appendSection(lines, '建议下一步', nextSteps, 2);
    appendSection(lines, '改动文件', changedFiles, 4);
    return lines.join('\n');
  }

  return buildWorkflowStatusReplyResult(facts);
}

function buildWorkflowStatusOpening(status) {
  switch (String(status || '').trim()) {
    case 'waiting_for_user':
      return '这条主线我还在跟，现在有个问题需要你确认。';
    case 'completed':
      return '这条主线已经收口了。';
    case 'failed':
      return '这条主线卡住了，我先把卡点给你讲清楚。';
    case 'partial':
      return '这条主线我还在跟，不过还没完全收口。';
    case 'cancelled':
      return '这条主线先停在这里了。';
    default:
      return '这条主线我还在跟。';
  }
}

function formatWorkflowShortTaskStatus(status) {
  switch (String(status || '').trim()) {
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

function appendSection(lines, title, items, limit = 3) {
  const values = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!values.length) {
    return;
  }
  lines.push('', `${title}：`);
  for (const item of values.slice(0, limit)) {
    lines.push(`- ${item}`);
  }
}

function maybeSleep(prompt) {
  const match = String(prompt || '').match(/slow-(\d+)/);
  const duration = match ? Number.parseInt(match[1], 10) : 0;
  if (!duration || !Number.isFinite(duration) || duration <= 0) {
    return;
  }

  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, duration);
}

function stripGlobalArgs(argv) {
  const result = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '-a' || token === '-s' || token === '-c') {
      index += 1;
      continue;
    }

    result.push(token);
  }

  return result;
}
