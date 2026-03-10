#!/usr/bin/env node
import { writeFileSync } from 'node:fs';

const rawArgs = process.argv.slice(2);
const args = stripGlobalArgs(rawArgs);

if (rawArgs[0] === '--version') {
  console.log('codex-cli 0.111.0');
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

  if (prompt.includes('Direct mode: Telegram CTO direct reply.')) {
    const hasPendingWorkflow = prompt.includes('There is already a waiting CTO workflow for this chat.');
    return {
      title: 'Telegram CTO direct reply',
      result: hasPendingWorkflow
        ? '可以，我在。\n当前 Workflow 仍保持等待中；如果要继续，请直接回复待确认问题。\n我不会因为这条闲聊消息改写当前工作流。'
        : '可以，我在。\n如果你要我执行，请直接告诉我明确目标。\n如果要查进度，也可以直接问我当前 workflow 状态。',
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
