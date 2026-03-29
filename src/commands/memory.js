import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { parseOptions } from '../lib/args.js';
import { ensureDir, writeJson } from '../lib/fs.js';
import { createSession, saveSession } from '../lib/session-store.js';
import { renderHumanSummary } from '../lib/summary.js';

const SYNC_OPTION_SPEC = {
  cwd: { type: 'string' },
  source: { type: 'string' },
  summary: { type: 'string' },
  state: { type: 'string' },
  json: { type: 'boolean' },
  now: { type: 'string' }
};

const COMPACT_OPTION_SPEC = {
  cwd: { type: 'string' },
  source: { type: 'string' },
  summary: { type: 'string' },
  state: { type: 'string' },
  'archive-dir': { type: 'string' },
  'retention-days': { type: 'string' },
  json: { type: 'boolean' },
  now: { type: 'string' }
};

const ENTRY_PATTERN = /^##\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s+\|\s+(.+?)\s*$/;
const FIELD_PATTERN = /^- ([^:：]+)\s*[:：]\s*(.*)$/;
const DONE_MARKERS = ['done', '完成', '已完成', 'resolved', 'closed', 'archived'];
const BLOCKED_MARKERS = ['blocked', '阻塞'];
const FOLLOW_UP_MARKERS = ['in_progress', '进行中', '待继续', '待验证', 'pending', 'todo'];
const DEFAULT_RETENTION_DAYS = 7;
const UNCLASSIFIED_PROJECT_KEY = 'unclassified';
const UNCLASSIFIED_PROJECT_LABEL = '未分类';
const MEMORY_USAGE = `Usage:
  opencodex memory sync --source <path> [--summary <path>] [--state <path>] [--cwd <dir>] [--json] [--now <timestamp>]
  opencodex memory compact --source <path> [--archive-dir <dir>] [--retention-days <days>] [--summary <path>] [--state <path>] [--cwd <dir>] [--json] [--now <timestamp>]
`;

export async function runMemoryCommand(args) {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    process.stdout.write(MEMORY_USAGE);
    return;
  }

  if (subcommand === 'sync') {
    await runMemorySyncCommand(rest);
    return;
  }

  if (subcommand === 'compact') {
    await runMemoryCompactCommand(rest);
    return;
  }

  throw new Error(`Unknown memory subcommand: ${subcommand}`);
}

export async function runMemorySyncCommand(args) {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(MEMORY_USAGE);
    return;
  }

  const { options, positionals } = parseOptions(args, SYNC_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex memory sync` does not accept positional arguments');
  }

  const cwd = path.resolve(options.cwd || process.cwd());
  const sourcePath = resolveRequiredPath(options.source, '--source', cwd);
  const summaryPath = resolveOptionalPath(options.summary, cwd, getDefaultSummaryPath(sourcePath));
  const statePath = resolveOptionalPath(options.state, cwd, getDefaultStatePath(sourcePath));
  const generatedAt = parseNow(options.now);

  const session = createMemorySession({
    cwd,
    inputPrompt: 'Sync append-only memory into summary and state artifacts.',
    argumentsPayload: {
      source: sourcePath,
      summary: summaryPath,
      state: statePath,
      json: Boolean(options.json),
      now: options.now || ''
    },
    runningSummary: {
      title: 'Memory sync running',
      result: `Syncing memory from ${sourcePath}.`,
      highlights: [`Source: ${sourcePath}`]
    }
  });

  const sessionDir = await saveSession(cwd, session);
  const artifactsDir = path.join(sessionDir, 'artifacts');
  const snapshotPath = path.join(artifactsDir, 'memory-summary.md');
  const stateArtifactPath = path.join(artifactsDir, 'memory-state.json');

  try {
    const sourceText = await readFile(sourcePath, 'utf8');
    const { entries } = parseMemoryDocument(sourceText);
    const latestEntries = buildLatestEntries(entries);
    const summaryText = renderSummary({
      entries,
      latestEntries,
      sourcePath,
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
      result: `Synced ${entries.length} memory entries into ${latestEntries.length} active topic(s) across ${statePayload.projects_active} project(s).`,
      status: 'completed',
      highlights: [
        `Source entries: ${entries.length}`,
        `Active topics: ${latestEntries.length}`,
        `Projects: ${statePayload.projects_active}`,
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
        'Grouped active topics by explicit project metadata when available.',
        'Rebuilt summary and state from source instead of patching prior output.'
      ],
      changed_files: [summaryPath, statePath],
      findings: []
    };

    await finalizeMemorySession({
      session,
      cwd,
      summary,
      artifacts: [
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
      ]
    });

    emitMemoryResult({ json: options.json, summary, sessionId: session.session_id, statePayload });
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

    await finalizeMemorySession({
      session,
      cwd,
      summary,
      artifacts: [
        {
          type: 'memory_state_snapshot',
          path: stateArtifactPath,
          description: 'Failure state captured for this memory sync session.'
        }
      ],
      status: 'failed'
    });

    emitMemoryResult({ json: options.json, summary, sessionId: session.session_id, statePayload: failedState });
    process.exitCode = 1;
  }
}

export async function runMemoryCompactCommand(args) {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(MEMORY_USAGE);
    return;
  }

  const { options, positionals } = parseOptions(args, COMPACT_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex memory compact` does not accept positional arguments');
  }

  const cwd = path.resolve(options.cwd || process.cwd());
  const sourcePath = resolveRequiredPath(options.source, '--source', cwd);
  const summaryPath = resolveOptionalPath(options.summary, cwd, getDefaultSummaryPath(sourcePath));
  const statePath = resolveOptionalPath(options.state, cwd, getDefaultStatePath(sourcePath));
  const archiveDir = resolveOptionalPath(options['archive-dir'], cwd, path.join(path.dirname(sourcePath), 'archives'));
  const generatedAt = parseNow(options.now);
  const retentionDays = parsePositiveInteger(options['retention-days'], DEFAULT_RETENTION_DAYS, '--retention-days');

  const session = createMemorySession({
    cwd,
    inputPrompt: 'Compact append-only memory into active, archive, summary, and state artifacts.',
    argumentsPayload: {
      source: sourcePath,
      summary: summaryPath,
      state: statePath,
      archive_dir: archiveDir,
      retention_days: retentionDays,
      json: Boolean(options.json),
      now: options.now || ''
    },
    runningSummary: {
      title: 'Memory compact running',
      result: `Compacting memory from ${sourcePath}.`,
      highlights: [`Source: ${sourcePath}`, `Archive dir: ${archiveDir}`]
    }
  });

  const sessionDir = await saveSession(cwd, session);
  const artifactsDir = path.join(sessionDir, 'artifacts');
  const snapshotPath = path.join(artifactsDir, 'memory-summary.md');
  const stateArtifactPath = path.join(artifactsDir, 'memory-state.json');

  try {
    const sourceText = await readFile(sourcePath, 'utf8');
    const document = parseMemoryDocument(sourceText);
    const entries = document.entries;
    const latestEntries = buildLatestEntries(entries);
    const latestEntryByTopic = new Map(latestEntries.map((entry) => [entry.topicKey, entry.sourceEntry]));
    const legacyTitleAliases = buildLegacyTitleAliases(entries);
    const cutoffTime = new Date(generatedAt.getTime() - retentionDays * 24 * 60 * 60 * 1000);

    const keptEntries = [];
    const archivedEntries = [];

    for (const entry of entries) {
      const keepBecauseRecent = entry.timestamp >= cutoffTime;
      const keepBecauseLatest = latestEntryByTopic.get(getTopicKey(entry, legacyTitleAliases)) === entry;
      if (keepBecauseRecent || keepBecauseLatest) {
        keptEntries.push(entry);
      } else {
        archivedEntries.push(entry);
      }
    }

    const archiveFiles = await writeArchiveFiles({
      archiveDir,
      sourcePath,
      entries: archivedEntries
    });

    const compactedSourceText = renderDocument({
      preambleLines: document.preambleLines,
      entries: keptEntries
    });
    await writeFile(sourcePath, compactedSourceText, 'utf8');

    const latestKeptEntries = buildLatestEntries(keptEntries);
    const summaryText = renderSummary({
      entries: keptEntries,
      latestEntries: latestKeptEntries,
      sourcePath,
      generatedAt
    });
    const statePayload = buildState({
      entries: keptEntries,
      latestEntries: latestKeptEntries,
      sourcePath,
      summaryPath,
      statePath,
      generatedAt,
      lastError: null,
      extra: {
        archive_dir: archiveDir,
        retention_days: retentionDays,
        entries_archived: archivedEntries.length,
        archive_files: archiveFiles
      }
    });

    await ensureDir(path.dirname(summaryPath));
    await ensureDir(path.dirname(statePath));
    await writeFile(summaryPath, summaryText, 'utf8');
    await writeJson(statePath, statePayload);
    await writeFile(snapshotPath, summaryText, 'utf8');
    await writeJson(stateArtifactPath, statePayload);

    const summary = {
      title: 'Memory compact completed',
      result: `Kept ${keptEntries.length} active entry(s) and archived ${archivedEntries.length} stale history entry(s) into ${archiveFiles.length} archive file(s).`,
      status: 'completed',
      highlights: [
        `Active entries kept: ${keptEntries.length}`,
        `Archived entries: ${archivedEntries.length}`,
        `Archive files: ${archiveFiles.length}`,
        `Retention days: ${retentionDays}`,
        `Projects: ${statePayload.projects_active}`
      ],
      next_steps: [
        archivedEntries.length
          ? 'Future runs can use the same compact command before sync size grows again.'
          : 'No stale superseded entries matched the archive window this run.'
      ],
      risks: [],
      validation: [
        'Preserved the newest entry for every topic key in the active source.',
        `Archived only superseded entries older than ${retentionDays} day(s).`,
        'Split archive output by project and month.',
        'Regenerated summary and state after compaction.'
      ],
      changed_files: [sourcePath, summaryPath, statePath, ...archiveFiles],
      findings: []
    };

    await finalizeMemorySession({
      session,
      cwd,
      summary,
      artifacts: [
        {
          type: 'memory_summary_snapshot',
          path: snapshotPath,
          description: 'Summary snapshot captured for this memory compact session.'
        },
        {
          type: 'memory_state_snapshot',
          path: stateArtifactPath,
          description: 'State snapshot captured for this memory compact session.'
        }
      ]
    });

    emitMemoryResult({ json: options.json, summary, sessionId: session.session_id, statePayload });
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
      lastError: message,
      extra: {
        archive_dir: archiveDir,
        retention_days: retentionDays
      }
    });
    await ensureDir(path.dirname(statePath));
    await writeJson(statePath, failedState);
    await writeJson(stateArtifactPath, failedState);

    const summary = {
      title: 'Memory compact failed',
      result: message,
      status: 'failed',
      highlights: [`Source: ${sourcePath}`, `Archive dir: ${archiveDir}`, `State: ${statePath}`],
      next_steps: ['Inspect the source memory file or archive directory settings, then rerun the compact command.'],
      risks: ['The active source may remain untrimmed because the compact run failed.'],
      validation: [],
      changed_files: [statePath],
      findings: [message]
    };

    await finalizeMemorySession({
      session,
      cwd,
      summary,
      artifacts: [
        {
          type: 'memory_state_snapshot',
          path: stateArtifactPath,
          description: 'Failure state captured for this memory compact session.'
        }
      ],
      status: 'failed'
    });

    emitMemoryResult({ json: options.json, summary, sessionId: session.session_id, statePayload: failedState });
    process.exitCode = 1;
  }
}

function createMemorySession({ cwd, inputPrompt, argumentsPayload, runningSummary }) {
  const session = createSession({
    command: 'memory',
    cwd,
    codexCliVersion: 'host-local',
    input: {
      prompt: inputPrompt,
      arguments: argumentsPayload
    }
  });
  session.status = 'running';
  session.summary = {
    title: runningSummary.title,
    result: runningSummary.result,
    status: 'running',
    highlights: runningSummary.highlights,
    next_steps: ['Wait for memory processing to finish.'],
    risks: [],
    validation: [],
    changed_files: [],
    findings: []
  };
  return session;
}

async function finalizeMemorySession({ session, cwd, summary, artifacts, status = 'completed' }) {
  session.status = status;
  session.updated_at = new Date().toISOString();
  session.summary = summary;
  session.artifacts = artifacts;
  await saveSession(cwd, session);
}

function emitMemoryResult({ json, summary, sessionId, statePayload }) {
  if (json) {
    process.stdout.write(`${JSON.stringify({ summary, session_id: sessionId, state: statePayload }, null, 2)}\n`);
    return;
  }

  process.stdout.write(renderHumanSummary(summary));
  process.stdout.write(`Session: ${sessionId}\n`);
}

function resolveRequiredPath(value, flagName, cwd) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`\`opencodex memory\` requires \`${flagName} <path>\``);
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

function parsePositiveInteger(rawValue, fallbackValue, flagName) {
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return fallbackValue;
  }

  const value = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`\`${flagName}\` must be a positive integer`);
  }
  return value;
}

export function parseEntries(text) {
  return parseMemoryDocument(text).entries;
}

export function parseMemoryDocument(text) {
  const entries = [];
  const preambleLines = [];
  let current = null;
  let currentField = '';
  let seenEntry = false;

  const flush = () => {
    if (current) {
      current.rawText = current.rawLines.join('\n').trimEnd();
      entries.push(current);
    }
    current = null;
    currentField = '';
  };

  for (const line of String(text || '').split(/\r?\n/)) {
    const headingMatch = line.match(ENTRY_PATTERN);
    if (headingMatch) {
      seenEntry = true;
      flush();
      current = {
        timestamp: parseHeadingTimestamp(headingMatch[1]),
        title: headingMatch[2].trim(),
        fields: {},
        rawLines: [line]
      };
      continue;
    }

    if (!seenEntry) {
      preambleLines.push(line);
      continue;
    }

    if (!current) {
      continue;
    }

    current.rawLines.push(line);

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
  for (const entry of entries) {
    delete entry.rawLines;
  }

  return {
    preambleLines,
    entries: entries.sort((left, right) => right.timestamp - left.timestamp)
  };
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

function normalizeProjectKey(value) {
  return normalizeTopicKey(value) || UNCLASSIFIED_PROJECT_KEY;
}

function getExplicitTopicKey(entry) {
  return normalizeTopicKey(getField(entry, '主题键', 'topic-key', 'topic_key', 'topickey'));
}

function getNormalizedTitle(entry) {
  return normalizeTopicKey(entry.title);
}

export function buildLegacyTitleAliases(entries) {
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

function getProjectDisplay(entry) {
  return getField(entry, '项目', '项目名', '项目键', 'project', 'project_name', 'project_key', 'repo', 'repository', '仓库') || UNCLASSIFIED_PROJECT_LABEL;
}

function getProjectMetadata(entry) {
  const projectDisplay = getProjectDisplay(entry);
  return {
    projectDisplay,
    projectKey: normalizeProjectKey(projectDisplay)
  };
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
    .map(([topicKey, entry]) => ({
      ...entry,
      ...getProjectMetadata(entry),
      topicKey,
      topicCount: countByTopic.get(topicKey) || 1,
      sourceEntry: entry
    }))
    .sort((left, right) => right.timestamp - left.timestamp);
}

export function renderSummary({ entries, latestEntries, sourcePath, generatedAt }) {
  const projectGroups = buildProjectGroups(latestEntries);
  const followUpEntries = latestEntries.filter((entry) => needsFollowUp(entry));
  const followUpGroups = buildProjectGroups(followUpEntries);
  const lines = [
    '# Session Memory Summary',
    '',
    `- 生成时间：${formatGeneratedAt(generatedAt)}`,
    `- 来源：${sourcePath}`,
    '- 规则：同一主题键按最新时间覆盖旧进度；若缺少主题键，则回退到标准化后的标题。summary 按项目分组，只展开当前活跃主题。',
    `- 原始条目数：${entries.length}`,
    `- 当前主题数：${latestEntries.length}`,
    `- 当前项目数：${projectGroups.length}`,
    '',
    '## 项目概览',
    ''
  ];

  if (!projectGroups.length) {
    lines.push('- 暂无可汇总条目。', '');
  } else {
    for (const group of projectGroups) {
      lines.push(`- ${group.projectDisplay}：主题=${group.entries.length}；待继续=${group.followUpCount}；最近更新=${formatEntryTimestamp(group.latestTimestamp)}`);
    }
    lines.push('');
  }

  lines.push('## 当前活跃主题', '');
  if (!projectGroups.length) {
    lines.push('- 暂无当前活跃主题。', '');
  } else {
    for (const group of projectGroups) {
      lines.push(`### ${group.projectDisplay}`);
      for (const entry of group.entries) {
        lines.push(`- ${entry.title}：进度=${getProgress(entry)}；最新=${formatEntryTimestamp(entry.timestamp)}；历史=${entry.topicCount}；下一步=${getNextStep(entry)}`);
      }
      lines.push('');
    }
  }

  lines.push('## 最近更新', '');
  if (!entries.length) {
    lines.push('- 暂无最近更新。', '');
  } else {
    for (const entry of entries.slice(0, 10)) {
      lines.push(`- ${formatEntryTimestamp(entry.timestamp)} | ${getProjectDisplay(entry)} | ${entry.title} | 进度=${getProgress(entry)} | 下一步=${getNextStep(entry)}`);
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
      return `- ${entry.projectDisplay} / ${entry.title}：${reusableRule}`;
    })
    .filter(Boolean);
  if (!rules.length) {
    lines.push('- 暂无长期规则。', '');
  } else {
    lines.push(...rules, '');
  }

  lines.push('## 待继续 / blocked', '');
  if (!followUpGroups.length) {
    lines.push('- 暂无待继续主题。', '');
  } else {
    for (const group of followUpGroups) {
      lines.push(`### ${group.projectDisplay}`);
      for (const entry of group.entries) {
        lines.push(`- ${entry.title}：进度=${getProgress(entry)}；下一步=${getNextStep(entry)}`);
      }
      lines.push('');
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function buildProjectGroups(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const existing = groups.get(entry.projectKey) || {
      projectKey: entry.projectKey,
      projectDisplay: entry.projectDisplay,
      entries: [],
      followUpCount: 0,
      latestTimestamp: entry.timestamp
    };
    existing.entries.push(entry);
    existing.followUpCount += needsFollowUp(entry) ? 1 : 0;
    if (entry.timestamp > existing.latestTimestamp) {
      existing.latestTimestamp = entry.timestamp;
    }
    groups.set(entry.projectKey, existing);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      entries: group.entries.sort((left, right) => right.timestamp - left.timestamp)
    }))
    .sort((left, right) => {
      if (right.latestTimestamp - left.latestTimestamp !== 0) {
        return right.latestTimestamp - left.latestTimestamp;
      }
      return left.projectDisplay.localeCompare(right.projectDisplay, 'zh-Hans-CN');
    });
}

export function buildState({ entries, latestEntries, sourcePath, summaryPath, statePath, generatedAt, lastError, extra = {} }) {
  const projectGroups = buildProjectGroups(latestEntries);
  const projectTopics = {};
  for (const group of projectGroups) {
    projectTopics[group.projectDisplay] = group.entries.length;
  }

  return {
    last_run_at: generatedAt.toISOString(),
    source_path: sourcePath,
    summary_path: summaryPath,
    state_path: statePath,
    entries_parsed: entries.length,
    topics_active: latestEntries.length,
    projects_active: projectGroups.length,
    project_topics: projectTopics,
    latest_entry_at: latestEntries[0] ? formatStateTimestamp(latestEntries[0].timestamp) : null,
    last_error: lastError,
    ...extra
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

function renderDocument({ preambleLines, entries }) {
  const sections = [];
  const preamble = preambleLines.join('\n').trimEnd();
  if (preamble) {
    sections.push(preamble);
  }
  for (const entry of entries.sort((left, right) => right.timestamp - left.timestamp)) {
    sections.push(String(entry.rawText || '').trimEnd());
  }
  return `${sections.filter(Boolean).join('\n\n').trimEnd()}\n`;
}

async function writeArchiveFiles({ archiveDir, sourcePath, entries }) {
  if (!entries.length) {
    return [];
  }

  const buckets = new Map();
  for (const entry of entries) {
    const { projectDisplay, projectKey } = getProjectMetadata(entry);
    const month = `${entry.timestamp.getFullYear()}-${String(entry.timestamp.getMonth() + 1).padStart(2, '0')}`;
    const archivePath = path.join(archiveDir, slugifyPathSegment(projectKey), `${month}.md`);
    const bucket = buckets.get(archivePath) || {
      archivePath,
      projectDisplay,
      month,
      entries: []
    };
    bucket.entries.push(entry);
    buckets.set(archivePath, bucket);
  }

  const writtenFiles = [];
  for (const bucket of buckets.values()) {
    await ensureDir(path.dirname(bucket.archivePath));
    const existingText = await safeReadFile(bucket.archivePath);
    const existingDocument = existingText
      ? parseMemoryDocument(existingText)
      : {
          preambleLines: buildArchivePreamble({
            projectDisplay: bucket.projectDisplay,
            month: bucket.month,
            sourcePath
          }),
          entries: []
        };

    const mergedEntries = mergeArchiveEntries(existingDocument.entries, bucket.entries);
    const archiveText = renderDocument({
      preambleLines: existingDocument.preambleLines,
      entries: mergedEntries
    });
    await writeFile(bucket.archivePath, archiveText, 'utf8');
    writtenFiles.push(bucket.archivePath);
  }

  return writtenFiles.sort();
}

function buildArchivePreamble({ projectDisplay, month, sourcePath }) {
  return [
    '# Memory Archive',
    '',
    `- 项目：${projectDisplay}`,
    `- 月份：${month}`,
    `- 来源：${sourcePath}`,
    '- 规则：本文件只保存 compact 迁出的历史记录，不参与 active source 追加。'
  ];
}

function mergeArchiveEntries(existingEntries, nextEntries) {
  const merged = new Map();
  for (const entry of [...existingEntries, ...nextEntries]) {
    const key = String(entry.rawText || '').trim();
    if (!key) {
      continue;
    }
    const previous = merged.get(key);
    if (!previous || entry.timestamp > previous.timestamp) {
      merged.set(key, entry);
    }
  }
  return [...merged.values()].sort((left, right) => right.timestamp - left.timestamp);
}

async function safeReadFile(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

function slugifyPathSegment(value) {
  return String(value || UNCLASSIFIED_PROJECT_KEY)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || UNCLASSIFIED_PROJECT_KEY;
}
