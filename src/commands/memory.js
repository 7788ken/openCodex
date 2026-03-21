import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { parseOptions } from '../lib/args.js';
import { ensureDir, writeJson } from '../lib/fs.js';
import { createSession, saveSession } from '../lib/session-store.js';
import { renderHumanSummary } from '../lib/summary.js';

const OPTION_SPEC = {
  cwd: { type: 'string' },
  source: { type: 'string' },
  summary: { type: 'string' },
  state: { type: 'string' },
  json: { type: 'boolean' },
  now: { type: 'string' }
};

const ENTRY_PATTERN = /^##\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s+\|\s+(.+?)\s*$/;
const FIELD_PATTERN = /^- ([^:：]+)\s*[:：]\s*(.*)$/;
const DONE_MARKERS = ['done', '完成', '已完成', 'resolved', 'closed', 'archived'];
const BLOCKED_MARKERS = ['blocked', '阻塞'];
const FOLLOW_UP_MARKERS = ['in_progress', '进行中', '待继续', '待验证', 'pending', 'todo'];
const MEMORY_SYNC_USAGE = 'Usage:\n  opencodex memory sync --source <path> [--summary <path>] [--state <path>] [--cwd <dir>] [--json] [--now <timestamp>]\n';

export async function runMemoryCommand(args) {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    process.stdout.write(MEMORY_SYNC_USAGE);
    return;
  }

  if (subcommand !== 'sync') {
    throw new Error(`Unknown memory subcommand: ${subcommand}`);
  }

  await runMemorySyncCommand(rest);
}

export async function runMemorySyncCommand(args) {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(MEMORY_SYNC_USAGE);
    return;
  }

  const { options, positionals } = parseOptions(args, OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex memory sync` does not accept positional arguments');
  }

  const cwd = path.resolve(options.cwd || process.cwd());
  const sourcePath = resolveRequiredPath(options.source, '--source', cwd);
  const summaryPath = resolveOptionalPath(options.summary, cwd, getDefaultSummaryPath(sourcePath));
  const statePath = resolveOptionalPath(options.state, cwd, getDefaultStatePath(sourcePath));
  const generatedAt = parseNow(options.now);

  const session = createSession({
    command: 'memory',
    cwd,
    codexCliVersion: 'host-local',
    input: {
      prompt: 'Sync append-only memory into summary and state artifacts.',
      arguments: {
        source: sourcePath,
        summary: summaryPath,
        state: statePath,
        json: Boolean(options.json),
        now: options.now || ''
      }
    }
  });
  session.status = 'running';
  session.summary = {
    title: 'Memory sync running',
    result: `Syncing memory from ${sourcePath}.`,
    status: 'running',
    highlights: [`Source: ${sourcePath}`],
    next_steps: ['Wait for summary and state generation to finish.'],
    risks: [],
    validation: [],
    changed_files: [],
    findings: []
  };

  const sessionDir = await saveSession(cwd, session);
  const artifactsDir = path.join(sessionDir, 'artifacts');
  const snapshotPath = path.join(artifactsDir, 'memory-summary.md');
  const stateArtifactPath = path.join(artifactsDir, 'memory-state.json');

  try {
    const sourceText = await readFile(sourcePath, 'utf8');
    const entries = parseEntries(sourceText);
    const latestEntries = buildLatestEntries(entries);
    const summaryText = renderSummary({
      entries,
      latestEntries,
      sourcePath,
      summaryPath,
      generatedAt
    });
    const statePayload = buildState({
      entries,
      latestEntries,
      sourcePath,
      summaryPath,
      statePath,
      generatedAt,
      lastError: null
    });

    await ensureDir(path.dirname(summaryPath));
    await ensureDir(path.dirname(statePath));
    await writeFile(summaryPath, summaryText, 'utf8');
    await writeJson(statePath, statePayload);
    await writeFile(snapshotPath, summaryText, 'utf8');
    await writeJson(stateArtifactPath, statePayload);

    const summary = {
      title: 'Memory sync completed',
      result: `Synced ${entries.length} memory entries into ${latestEntries.length} active topic(s).`,
      status: 'completed',
      highlights: [
        `Source entries: ${entries.length}`,
        `Active topics: ${latestEntries.length}`,
        `Summary: ${summaryPath}`,
        `State: ${statePath}`
      ],
      next_steps: latestEntries.some((entry) => needsFollowUp(entry))
        ? ['Review the `待继续 / blocked` section in the generated summary.']
        : ['No pending follow-up topics were detected in the latest summary.'],
      risks: [],
      validation: [
        'Parsed append-only memory headings.',
        'Grouped records by topic key and merged legacy title-only entries when the title mapped to one topic.',
        'Rebuilt summary and state from source instead of patching prior output.'
      ],
      changed_files: [summaryPath, statePath],
      findings: []
    };

    session.status = 'completed';
    session.updated_at = new Date().toISOString();
    session.summary = summary;
    session.artifacts = [
      {
        type: 'memory_summary_snapshot',
        path: snapshotPath,
        description: 'Summary snapshot captured for this memory sync session.'
      },
      {
        type: 'memory_state_snapshot',
        path: stateArtifactPath,
        description: 'State snapshot captured for this memory sync session.'
      }
    ];
    await saveSession(cwd, session);

    if (options.json) {
      process.stdout.write(`${JSON.stringify({ summary, session_id: session.session_id, state: statePayload }, null, 2)}\n`);
    } else {
      process.stdout.write(renderHumanSummary(summary));
      process.stdout.write(`Session: ${session.session_id}\n`);
    }
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedState = buildState({
      entries: [],
      latestEntries: [],
      sourcePath,
      summaryPath,
      statePath,
      generatedAt,
      lastError: message
    });
    await ensureDir(path.dirname(statePath));
    await writeJson(statePath, failedState);
    await writeJson(stateArtifactPath, failedState);

    const summary = {
      title: 'Memory sync failed',
      result: message,
      status: 'failed',
      highlights: [`Source: ${sourcePath}`, `State: ${statePath}`],
      next_steps: ['Inspect the source memory file and rerun the sync command after fixing the input.'],
      risks: ['Generated summary may be stale because the latest sync failed.'],
      validation: [],
      changed_files: [statePath],
      findings: [message]
    };

    session.status = 'failed';
    session.updated_at = new Date().toISOString();
    session.summary = summary;
    session.artifacts = [
      {
        type: 'memory_state_snapshot',
        path: stateArtifactPath,
        description: 'Failure state captured for this memory sync session.'
      }
    ];
    await saveSession(cwd, session);

    if (options.json) {
      process.stdout.write(`${JSON.stringify({ summary, session_id: session.session_id, state: failedState }, null, 2)}\n`);
    } else {
      process.stdout.write(renderHumanSummary(summary));
      process.stdout.write(`Session: ${session.session_id}\n`);
    }
    process.exitCode = 1;
  }
}

function resolveRequiredPath(value, flagName, cwd) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`\`opencodex memory sync\` requires \`${flagName} <path>\``);
  }
  return resolvePathFromCwd(value, cwd);
}

function resolveOptionalPath(value, cwd, fallbackPath) {
  if (typeof value !== 'string' || !value.trim()) {
    return fallbackPath;
  }
  return resolvePathFromCwd(value, cwd);
}

function resolvePathFromCwd(value, cwd) {
  return path.resolve(cwd, value.trim());
}

function getDefaultSummaryPath(sourcePath) {
  const directory = path.dirname(sourcePath);
  const extension = path.extname(sourcePath);
  const basename = path.basename(sourcePath, extension);
  return path.join(directory, `${basename.replace(/_insights$/, '')}_summary${extension || '.md'}`);
}

function getDefaultStatePath(sourcePath) {
  const directory = path.dirname(sourcePath);
  const extension = path.extname(sourcePath);
  const basename = path.basename(sourcePath, extension);
  return path.join(directory, `${basename.replace(/_insights$/, '')}_summary_state.json`);
}

function parseNow(rawValue) {
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return new Date();
  }
  const direct = new Date(rawValue);
  if (!Number.isNaN(direct.getTime())) {
    return direct;
  }
  const normalized = rawValue.trim().replace(' ', 'T');
  const normalizedDate = new Date(normalized);
  if (!Number.isNaN(normalizedDate.getTime())) {
    return normalizedDate;
  }
  throw new Error(`Unsupported --now value: ${rawValue}`);
}

export function parseEntries(text) {
  const entries = [];
  let current = null;
  let currentField = '';

  const flush = () => {
    if (current) {
      entries.push(current);
    }
    current = null;
    currentField = '';
  };

  for (const line of String(text || '').split(/\r?\n/)) {
    const headingMatch = line.match(ENTRY_PATTERN);
    if (headingMatch) {
      flush();
      current = {
        timestamp: parseHeadingTimestamp(headingMatch[1]),
        title: headingMatch[2].trim(),
        fields: {}
      };
      continue;
    }

    if (!current) {
      continue;
    }

    const fieldMatch = line.match(FIELD_PATTERN);
    if (fieldMatch) {
      currentField = normalizeFieldName(fieldMatch[1]);
      current.fields[currentField] = fieldMatch[2].trim();
      continue;
    }

    const trimmed = line.trim();
    if (trimmed && currentField) {
      current.fields[currentField] = `${current.fields[currentField]} ${trimmed}`.trim();
    }
  }

  flush();
  return entries.sort((left, right) => right.timestamp - left.timestamp);
}

function parseHeadingTimestamp(value) {
  const [datePart, timePart] = value.trim().split(/\s+/);
  const [year, month, day] = datePart.split('-').map((item) => Number.parseInt(item, 10));
  const [hour, minute] = timePart.split(':').map((item) => Number.parseInt(item, 10));
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function normalizeFieldName(name) {
  return String(name || '').replace(/\s+/g, '').trim();
}

function getField(entry, ...names) {
  const normalizedNames = new Set(names.map((name) => normalizeFieldName(name)));
  for (const [key, value] of Object.entries(entry.fields || {})) {
    if (normalizedNames.has(normalizeFieldName(key))) {
      return String(value || '').trim();
    }
  }
  return '';
}

function normalizeTopicKey(value) {
  return String(value || '')
    .replace(/[|｜]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function getExplicitTopicKey(entry) {
  return normalizeTopicKey(getField(entry, '主题键', 'topic-key', 'topic_key', 'topickey'));
}

function getNormalizedTitle(entry) {
  return normalizeTopicKey(entry.title);
}

function buildLegacyTitleAliases(entries) {
  const explicitByTitle = new Map();

  for (const entry of entries) {
    const explicitTopicKey = getExplicitTopicKey(entry);
    if (!explicitTopicKey) {
      continue;
    }

    const normalizedTitle = getNormalizedTitle(entry);
    if (!normalizedTitle) {
      continue;
    }

    const topicKeys = explicitByTitle.get(normalizedTitle) || new Set();
    topicKeys.add(explicitTopicKey);
    explicitByTitle.set(normalizedTitle, topicKeys);
  }

  const aliases = new Map();
  for (const [normalizedTitle, topicKeys] of explicitByTitle.entries()) {
    if (topicKeys.size === 1) {
      aliases.set(normalizedTitle, [...topicKeys][0]);
    }
  }
  return aliases;
}

export function getTopicKey(entry, legacyTitleAliases = new Map()) {
  const explicitTopicKey = getExplicitTopicKey(entry);
  if (explicitTopicKey) {
    return explicitTopicKey;
  }

  const normalizedTitle = getNormalizedTitle(entry);
  return legacyTitleAliases.get(normalizedTitle) || normalizedTitle;
}

function getDisplayTopicKey(entry) {
  return getField(entry, '主题键', 'topic-key', 'topic_key', 'topickey') || entry.title;
}

export function buildLatestEntries(entries) {
  const legacyTitleAliases = buildLegacyTitleAliases(entries);
  const latestByTopic = new Map();
  const countByTopic = new Map();

  for (const entry of entries) {
    const topicKey = getTopicKey(entry, legacyTitleAliases);
    countByTopic.set(topicKey, (countByTopic.get(topicKey) || 0) + 1);
    const existing = latestByTopic.get(topicKey);
    if (!existing || entry.timestamp > existing.timestamp) {
      latestByTopic.set(topicKey, entry);
    }
  }

  return [...latestByTopic.entries()]
    .map(([topicKey, entry]) => ({ ...entry, topicKey, topicCount: countByTopic.get(topicKey) || 1 }))
    .sort((left, right) => right.timestamp - left.timestamp);
}

export function renderSummary({ entries, latestEntries, sourcePath, generatedAt }) {
  const followUpEntries = latestEntries.filter((entry) => needsFollowUp(entry));
  const lines = [
    '# Session Memory Summary',
    '',
    `- 生成时间：${formatGeneratedAt(generatedAt)}`,
    `- 来源：${sourcePath}`,
    '- 规则：同一主题键按最新时间覆盖旧进度；若缺少主题键，则回退到标准化后的标题。原始记录保留不删。',
    `- 原始条目数：${entries.length}`,
    `- 当前主题数：${latestEntries.length}`,
    '',
    '## 当前活跃主题',
    ''
  ];

  if (!latestEntries.length) {
    lines.push('- 暂无可汇总条目。', '');
  } else {
    for (const entry of latestEntries) {
      lines.push(`### ${entry.title}`);
      lines.push(`- 主题键：${getDisplayTopicKey(entry)}`);
      lines.push(`- 最新时间：${formatEntryTimestamp(entry.timestamp)}`);
      lines.push(`- 当前进度：${getProgress(entry)}`);
      lines.push(`- 最新关键判断：${getField(entry, '关键判断') || '未填写'}`);
      lines.push(`- 最近动作：${getField(entry, '动作') || '未填写'}`);
      lines.push(`- 当前验证：${getField(entry, '验证') || '未填写'}`);
      lines.push(`- 下一步：${getNextStep(entry)}`);
      lines.push(`- 可复用规则：${getField(entry, '可复用规则') || '未填写'}`);
      lines.push(`- 历史条数：${entry.topicCount}`);
      lines.push(`- 关键词：${getField(entry, '关键词') || '未填写'}`);
      lines.push('');
    }
  }

  lines.push('## 最近更新', '');
  if (!entries.length) {
    lines.push('- 暂无最近更新。', '');
  } else {
    for (const entry of entries.slice(0, 10)) {
      lines.push(`- ${formatEntryTimestamp(entry.timestamp)} | ${entry.title} | 进度=${getProgress(entry)} | 下一步=${getNextStep(entry)}`);
    }
    lines.push('');
  }

  lines.push('## 长期规则', '');
  const rules = latestEntries
    .map((entry) => {
      const reusableRule = getField(entry, '可复用规则');
      if (!reusableRule) {
        return '';
      }
      return `- ${entry.title}：${reusableRule}`;
    })
    .filter(Boolean);
  if (!rules.length) {
    lines.push('- 暂无长期规则。', '');
  } else {
    lines.push(...rules, '');
  }

  lines.push('## 待继续 / blocked', '');
  if (!followUpEntries.length) {
    lines.push('- 暂无待继续主题。', '');
  } else {
    for (const entry of followUpEntries) {
      lines.push(`- ${entry.title}：进度=${getProgress(entry)}；下一步=${getNextStep(entry)}`);
    }
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

export function buildState({ entries, latestEntries, sourcePath, summaryPath, statePath, generatedAt, lastError }) {
  return {
    last_run_at: generatedAt.toISOString(),
    source_path: sourcePath,
    summary_path: summaryPath,
    state_path: statePath,
    entries_parsed: entries.length,
    topics_active: latestEntries.length,
    latest_entry_at: latestEntries[0] ? formatStateTimestamp(latestEntries[0].timestamp) : null,
    last_error: lastError
  };
}

function getProgress(entry) {
  return getField(entry, '进度', 'progress') || '未填写';
}

function getNextStep(entry) {
  return getField(entry, '下一步', 'next', 'nextstep') || '未填写';
}

function needsFollowUp(entry) {
  const progress = getProgress(entry).toLowerCase();
  if (BLOCKED_MARKERS.some((marker) => progress.includes(marker))) {
    return true;
  }
  if (FOLLOW_UP_MARKERS.some((marker) => progress.includes(marker))) {
    return true;
  }
  if (DONE_MARKERS.some((marker) => progress.includes(marker))) {
    return false;
  }
  const nextStep = getNextStep(entry);
  return nextStep && !['未填写', '无', 'none'].includes(nextStep.toLowerCase());
}

function formatGeneratedAt(value) {
  const offsetMinutes = -value.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  const hour = String(Math.floor(absolute / 60)).padStart(2, '0');
  const minute = String(absolute % 60).padStart(2, '0');
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')} ${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')} ${sign}${hour}${minute}`;
}

function formatEntryTimestamp(value) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')} ${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
}

function formatStateTimestamp(value) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}T${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
}
