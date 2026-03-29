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
  assert.equal(payload.state.projects_active, 1);
  assert.equal(payload.state.latest_entry_at, '2026-03-21T10:00');
  assert.equal(payload.state.state_path, path.join(cwd, 'team_summary_state.json'));

  const summaryPath = payload.state.summary_path;
  const statePath = path.join(cwd, '.opencodex', 'sessions', payload.session_id, 'artifacts', 'memory-state.json');
  const summaryText = await readFile(summaryPath, 'utf8');
  assert.match(summaryText, /## 项目概览/);
  assert.match(summaryText, /### 未分类/);
  assert.match(summaryText, /新进度：进度=done；最新=2026-03-21 10:00；历史=2；下一步=无需继续/);
  assert.match(summaryText, /## 待继续 \/ blocked/);
  assert.match(summaryText, /独立主题：进度=blocked；下一步=等待外部输入/);

  const state = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(state.entries_parsed, 3);
  assert.equal(state.topics_active, 2);
  assert.equal(state.projects_active, 1);
  assert.equal(state.latest_entry_at, '2026-03-21T10:00');
  assert.equal(state.state_path, path.join(cwd, 'team_summary_state.json'));
  assert.equal(state.last_error, null);
});

test('memory sync derives summary and state paths from an insights file name', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-memory-derived-'));
  const sourcePath = path.join(cwd, 'global_session_insights.md');
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

  const summaryPath = path.join(cwd, 'global_session_summary.md');
  const statePath = path.join(cwd, 'global_session_summary_state.json');
  const summaryText = await readFile(summaryPath, 'utf8');
  const state = JSON.parse(await readFile(statePath, 'utf8'));

  assert.match(summaryText, /原始条目数：1/);
  assert.match(summaryText, /当前项目数：1/);
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
  assert.match(summaryText, /同一主题：进度=done；最新=2026-03-21 10:00；历史=2；下一步=无/);
});

test('memory sync groups active topics by explicit project metadata', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-memory-project-'));
  const sourcePath = path.join(cwd, 'project_insights.md');
  await writeFile(sourcePath, [
    '# Memory Notes',
    '',
    '## 2026-03-21 09:00 | OpenCodex 主题',
    '- 主题键：topic-open',
    '- 项目：openCodex',
    '- 关键判断：判断',
    '- 动作：动作',
    '- 验证：验证',
    '- 进度：done',
    '- 下一步：无',
    '- 可复用规则：规则',
    '- 关键词：open',
    '',
    '## 2026-03-21 10:00 | Backend 主题',
    '- 主题键：topic-backend',
    '- 项目：Backend',
    '- 关键判断：判断',
    '- 动作：动作',
    '- 验证：验证',
    '- 进度：blocked',
    '- 下一步：等接口确认',
    '- 可复用规则：规则',
    '- 关键词：backend',
    ''
  ].join('\n'), 'utf8');

  const result = await runCli(['memory', 'sync', '--cwd', cwd, '--source', sourcePath, '--json']);
  assert.equal(result.code, 0);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.state.projects_active, 2);
  assert.deepEqual(payload.state.project_topics, {
    Backend: 1,
    openCodex: 1
  });

  const summaryText = await readFile(payload.state.summary_path, 'utf8');
  assert.match(summaryText, /- Backend：主题=1；待继续=1；最近更新=2026-03-21 10:00/);
  assert.match(summaryText, /- openCodex：主题=1；待继续=0；最近更新=2026-03-21 09:00/);
  assert.match(summaryText, /### Backend/);
  assert.match(summaryText, /### openCodex/);
});

test('memory compact archives stale superseded entries by project and month while keeping latest topic state active', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-memory-compact-'));
  const sourcePath = path.join(cwd, 'global_session_insights.md');
  await writeFile(sourcePath, [
    '# Memory Notes',
    '',
    '## 2026-03-01 09:00 | 旧方案',
    '- 主题键：topic-old',
    '- 项目：openCodex',
    '- 关键判断：旧判断',
    '- 动作：旧动作',
    '- 验证：旧验证',
    '- 进度：in_progress',
    '- 下一步：继续推进',
    '- 可复用规则：旧规则',
    '- 关键词：old',
    '',
    '## 2026-03-10 11:00 | 最新方案',
    '- 主题键：topic-old',
    '- 项目：openCodex',
    '- 关键判断：新判断',
    '- 动作：新动作',
    '- 验证：新验证',
    '- 进度：done',
    '- 下一步：无',
    '- 可复用规则：新规则',
    '- 关键词：new',
    '',
    '## 2026-03-09 08:00 | 近期主题',
    '- 主题键：topic-recent',
    '- 项目：Backend',
    '- 关键判断：近期判断',
    '- 动作：近期动作',
    '- 验证：近期验证',
    '- 进度：blocked',
    '- 下一步：等外部输入',
    '- 可复用规则：近期规则',
    '- 关键词：recent',
    ''
  ].join('\n'), 'utf8');

  const result = await runCli([
    'memory',
    'compact',
    '--cwd',
    cwd,
    '--source',
    sourcePath,
    '--retention-days',
    '7',
    '--json',
    '--now',
    '2026-03-12 12:00'
  ]);
  assert.equal(result.code, 0);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.summary.status, 'completed');
  assert.equal(payload.state.entries_parsed, 2);
  assert.equal(payload.state.entries_archived, 1);
  assert.equal(payload.state.projects_active, 2);
  assert.equal(payload.state.retention_days, 7);
  assert.equal(payload.state.archive_files.length, 1);

  const activeSource = await readFile(sourcePath, 'utf8');
  assert.doesNotMatch(activeSource, /## 2026-03-01 09:00 \| 旧方案/);
  assert.match(activeSource, /## 2026-03-10 11:00 \| 最新方案/);
  assert.match(activeSource, /## 2026-03-09 08:00 \| 近期主题/);

  const archivePath = path.join(cwd, 'archives', 'opencodex', '2026-03.md');
  const archiveText = await readFile(archivePath, 'utf8');
  assert.match(archiveText, /# Memory Archive/);
  assert.match(archiveText, /- 项目：openCodex/);
  assert.match(archiveText, /## 2026-03-01 09:00 \| 旧方案/);

  const summaryText = await readFile(payload.state.summary_path, 'utf8');
  assert.match(summaryText, /### openCodex/);
  assert.match(summaryText, /### Backend/);
  assert.match(summaryText, /近期主题：进度=blocked；下一步=等外部输入/);
});

test('memory sync prints help for sync and compact subcommands', async () => {
  const result = await runCli(['memory', 'sync', '--help']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /opencodex memory sync --source <path>/);
  assert.match(result.stdout, /opencodex memory compact --source <path>/);
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
