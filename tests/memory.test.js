import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const cli = path.resolve('bin/opencodex.js');

test('memory sync keeps the newest entry for the same topic key', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-memory-'));
  const sourcePath = path.join(cwd, 'team_insights.md');
  await writeFile(sourcePath, [
    '# Memory Notes',
    '',
    '## 2026-03-21 09:00 | 旧进度',
    '- 主题键：topic-a',
    '- 关键判断：旧判断',
    '- 动作：旧动作',
    '- 验证：旧验证',
    '- 进度：in_progress',
    '- 下一步：继续推进',
    '- 可复用规则：旧规则',
    '- 关键词：alpha',
    '',
    '## 2026-03-21 10:00 | 新进度',
    '- 主题键：topic-a',
    '- 关键判断：新判断',
    '- 动作：新动作',
    '- 验证：新验证',
    '- 进度：done',
    '- 下一步：无需继续',
    '- 可复用规则：新规则',
    '- 关键词：alpha,beta',
    '',
    '## 2026-03-21 08:30 | 独立主题',
    '- 主题键：topic-b',
    '- 关键判断：独立判断',
    '- 动作：独立动作',
    '- 验证：独立验证',
    '- 进度：blocked',
    '- 下一步：等待外部输入',
    '- 可复用规则：独立规则',
    '- 关键词：gamma',
    ''
  ].join('\n'), 'utf8');

  const result = await runCli(['memory', 'sync', '--cwd', cwd, '--source', sourcePath, '--json'], {});
  assert.equal(result.code, 0);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.summary.status, 'completed');
  assert.equal(payload.state.entries_parsed, 3);
  assert.equal(payload.state.topics_active, 2);
  assert.equal(payload.state.latest_entry_at, '2026-03-21T10:00');
  assert.equal(payload.state.state_path, path.join(cwd, 'team_summary_state.json'));

  const summaryPath = payload.state.summary_path;
  const statePath = path.join(cwd, '.opencodex', 'sessions', payload.session_id, 'artifacts', 'memory-state.json');
  const summaryText = await readFile(summaryPath, 'utf8');
  assert.match(summaryText, /### 新进度/);
  assert.match(summaryText, /历史条数：2/);
  assert.match(summaryText, /当前进度：done/);
  assert.match(summaryText, /## 待继续 \/ blocked/);
  assert.match(summaryText, /独立主题：进度=blocked；下一步=等待外部输入/);

  const state = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(state.entries_parsed, 3);
  assert.equal(state.topics_active, 2);
  assert.equal(state.latest_entry_at, '2026-03-21T10:00');
  assert.equal(state.state_path, path.join(cwd, 'team_summary_state.json'));
  assert.equal(state.last_error, null);
});

test('memory sync derives summary and state paths from an insights file name', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-memory-derived-'));
  const sourcePath = path.join(cwd, 'ewallet_session_insights.md');
  await writeFile(sourcePath, [
    '# Memory Notes',
    '',
    '## 2026-03-21 09:00 | 单条记录',
    '- 主题键：topic-one',
    '- 关键判断：判断',
    '- 动作：动作',
    '- 验证：验证',
    '- 进度：done',
    '- 下一步：无',
    '- 可复用规则：规则',
    '- 关键词：one',
    ''
  ].join('\n'), 'utf8');

  const result = await runCli(['memory', 'sync', '--cwd', cwd, '--source', sourcePath], {});
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Memory sync completed/);

  const summaryPath = path.join(cwd, 'ewallet_session_summary.md');
  const statePath = path.join(cwd, 'ewallet_session_summary_state.json');
  const summaryText = await readFile(summaryPath, 'utf8');
  const state = JSON.parse(await readFile(statePath, 'utf8'));

  assert.match(summaryText, /原始条目数：1/);
  assert.equal(state.summary_path, summaryPath);
  assert.equal(state.state_path, statePath);
  assert.equal(state.entries_parsed, 1);
});

test('memory sync resolves relative source, summary, and state paths from --cwd', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-memory-relative-'));
  const sourcePath = path.join(cwd, 'notes', 'session_insights.md');
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, [
    '# Memory Notes',
    '',
    '## 2026-03-21 09:00 | 相对路径主题',
    '- 主题键：relative-topic',
    '- 关键判断：判断',
    '- 动作：动作',
    '- 验证：验证',
    '- 进度：done',
    '- 下一步：无',
    '- 可复用规则：规则',
    '- 关键词：relative',
    ''
  ].join('\n'), 'utf8');

  const result = await runCli([
    'memory',
    'sync',
    '--cwd',
    cwd,
    '--source',
    'notes/session_insights.md',
    '--summary',
    'generated/out.md',
    '--state',
    'generated/out.json',
    '--json'
  ]);
  assert.equal(result.code, 0);

  const payload = JSON.parse(result.stdout);
  const summaryPath = path.join(cwd, 'generated', 'out.md');
  const statePath = path.join(cwd, 'generated', 'out.json');
  assert.equal(payload.state.summary_path, summaryPath);
  assert.equal(payload.state.state_path, statePath);
  assert.match(await readFile(summaryPath, 'utf8'), /相对路径主题/);
  assert.equal(JSON.parse(await readFile(statePath, 'utf8')).source_path, sourcePath);
});

test('memory sync merges legacy title-only entries into a uniquely keyed topic', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-memory-legacy-'));
  const sourcePath = path.join(cwd, 'legacy_insights.md');
  await writeFile(sourcePath, [
    '# Memory Notes',
    '',
    '## 2026-03-21 09:00 | 同一主题',
    '- 关键判断：旧判断',
    '- 动作：旧动作',
    '- 验证：旧验证',
    '- 进度：in_progress',
    '- 下一步：继续推进',
    '- 可复用规则：旧规则',
    '- 关键词：legacy',
    '',
    '## 2026-03-21 10:00 | 同一主题',
    '- 主题键：stable-topic',
    '- 关键判断：新判断',
    '- 动作：新动作',
    '- 验证：新验证',
    '- 进度：done',
    '- 下一步：无',
    '- 可复用规则：新规则',
    '- 关键词：stable',
    ''
  ].join('\n'), 'utf8');

  const result = await runCli(['memory', 'sync', '--cwd', cwd, '--source', sourcePath, '--json']);
  assert.equal(result.code, 0);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.state.topics_active, 1);
  const summaryText = await readFile(payload.state.summary_path, 'utf8');
  assert.match(summaryText, /### 同一主题/);
  assert.match(summaryText, /历史条数：2/);
});

test('memory sync prints help for the sync subcommand', async () => {
  const result = await runCli(['memory', 'sync', '--help']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /opencodex memory sync --source <path>/);
  assert.equal(result.stderr, '');
});

function runCli(args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [cli, ...args], {
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}
