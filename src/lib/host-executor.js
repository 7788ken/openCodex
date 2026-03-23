import path from 'node:path';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { ensureDir, pathExists, readJson, toIsoString, writeJson } from './fs.js';
import { buildSessionContractSnapshot } from './session-contract.js';

const HOST_EXECUTOR_DIRNAME = 'host-executor';
const HOST_EXECUTOR_JOBS_DIRNAME = 'jobs';
const HOST_EXECUTOR_CLAIM_LEASE_TTL_MS = 90 * 1000;
const SANDBOX_ENV_KEYS = ['OPENCODEX_HOST_SANDBOX_MODE', 'CODEX_SANDBOX_MODE', 'SANDBOX_MODE'];

export function isHostExecutorEnabled({ env = process.env } = {}) {
  const raw = String(env?.OPENCODEX_HOST_EXECUTOR_ENABLED || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(raw)) {
    return true;
  }

  return typeof env?.OPENCODEX_SERVICE_STATE_DIR === 'string' && Boolean(env.OPENCODEX_SERVICE_STATE_DIR.trim());
}

export function resolveHostExecutorRoot({ cwd = process.cwd(), env = process.env } = {}) {
  const serviceStateDir = typeof env?.OPENCODEX_SERVICE_STATE_DIR === 'string' && env.OPENCODEX_SERVICE_STATE_DIR.trim()
    ? path.resolve(env.OPENCODEX_SERVICE_STATE_DIR.trim())
    : '';
  if (serviceStateDir) {
    return path.join(serviceStateDir, HOST_EXECUTOR_DIRNAME);
  }

  const customStateDir = typeof env?.OPENCODEX_HOST_EXECUTOR_STATE_DIR === 'string' && env.OPENCODEX_HOST_EXECUTOR_STATE_DIR.trim()
    ? path.resolve(env.OPENCODEX_HOST_EXECUTOR_STATE_DIR.trim())
    : '';
  if (customStateDir) {
    return customStateDir;
  }

  return path.join(path.resolve(cwd), '.opencodex', HOST_EXECUTOR_DIRNAME);
}

export async function ensureHostExecutorState(rootDir) {
  const root = path.resolve(rootDir);
  const jobsDir = path.join(root, HOST_EXECUTOR_JOBS_DIRNAME);
  await ensureDir(jobsDir);
  return {
    root,
    jobs_dir: jobsDir
  };
}

export async function enqueueHostExecutorJob({
  rootDir,
  cwd,
  workflowSessionId,
  parentSessionId,
  task,
  message,
  profile,
  prompt,
  outputPath,
  sessionContract = null,
  sourceSessionId = '',
  sourceSummary = null
}) {
  const state = await ensureHostExecutorState(rootDir);
  const jobId = createHostExecutorJobId();
  const jobPath = path.join(state.jobs_dir, `${jobId}.json`);
  const createdAt = toIsoString();
  const job = {
    job_id: jobId,
    kind: 'telegram_cto_task',
    status: 'pending',
    created_at: createdAt,
    updated_at: createdAt,
    cwd: path.resolve(cwd),
    workflow_session_id: workflowSessionId || '',
    parent_session_id: parentSessionId || '',
    task_id: typeof task?.id === 'string' ? task.id : '',
    task_title: typeof task?.title === 'string' ? task.title : '',
    profile: profile || '',
    prompt: String(prompt || ''),
    output_path: outputPath || '',
    session_contract: buildSessionContractSnapshot(sessionContract),
    source_session_id: sourceSessionId || '',
    source_summary: sourceSummary && typeof sourceSummary === 'object' ? sourceSummary : null,
    update_id: Number.isInteger(message?.update_id) ? message.update_id : 0,
    message_id: Number.isInteger(message?.message_id) ? message.message_id : 0,
    chat_id: typeof message?.chat_id === 'string' ? message.chat_id : '',
    sender_display: typeof message?.sender_display === 'string' ? message.sender_display : '',
    host_session_id: '',
    host_session_path: '',
    result_summary: null,
    error_message: '',
    attempt_count: 0,
    record_path: jobPath
  };

  await writeJson(jobPath, job);
  return {
    job,
    jobPath
  };
}

export async function listHostExecutorJobs(rootDir) {
  const state = await ensureHostExecutorState(rootDir);
  let entries = [];
  try {
    entries = await readdir(state.jobs_dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const jobs = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }
    const filePath = path.join(state.jobs_dir, entry.name);
    try {
      const job = await readJson(filePath);
      jobs.push({ ...job, record_path: filePath });
    } catch {
    }
  }

  return jobs.sort((left, right) => String(left.created_at || '').localeCompare(String(right.created_at || '')));
}

export async function loadHostExecutorJob(jobPath) {
  if (!jobPath) {
    return null;
  }
  if (!(await pathExists(jobPath))) {
    return null;
  }
  try {
    return await readJson(jobPath);
  } catch {
    return null;
  }
}

export async function claimNextPendingHostExecutorJob(rootDir) {
  const jobs = await listHostExecutorJobs(rootDir);
  for (const nextJob of jobs) {
    if (nextJob?.status !== 'pending' || !nextJob?.record_path) {
      continue;
    }

    const claimed = await claimHostExecutorJob(nextJob.record_path);
    if (claimed) {
      return claimed;
    }
  }

  return null;
}

export async function claimHostExecutorJob(jobPath) {
  if (!jobPath) {
    return null;
  }

  const claimLease = await tryClaimHostExecutorJob(jobPath);
  if (!claimLease) {
    return null;
  }

  try {
    const currentJob = await loadHostExecutorJob(jobPath);
    if (!currentJob || currentJob.status !== 'pending') {
      return null;
    }

    const claimedJob = {
      ...currentJob,
      status: 'running',
      updated_at: toIsoString(),
      attempt_count: Number.isInteger(currentJob.attempt_count) ? currentJob.attempt_count + 1 : 1
    };
    await writeJson(jobPath, claimedJob);
    return {
      job: claimedJob,
      jobPath
    };
  } finally {
    await releaseHostExecutorJobClaim(claimLease);
  }
}

export async function updateHostExecutorJob(jobPath, patch = {}) {
  if (!jobPath) {
    return null;
  }

  const current = await loadHostExecutorJob(jobPath);
  if (!current) {
    return null;
  }

  const nextJob = {
    ...current,
    ...patch,
    updated_at: patch.updated_at || toIsoString(),
    record_path: jobPath
  };
  await writeJson(jobPath, nextJob);
  return nextJob;
}

export function buildHostExecutorEnv(extraEnv = {}, env = process.env) {
  const nextEnv = { ...env, ...extraEnv };
  for (const key of SANDBOX_ENV_KEYS) {
    delete nextEnv[key];
    nextEnv[key] = '';
  }

  const overrideSandboxMode = typeof env?.OPENCODEX_HOST_EXECUTOR_SANDBOX_MODE === 'string'
    ? env.OPENCODEX_HOST_EXECUTOR_SANDBOX_MODE.trim()
    : '';
  if (overrideSandboxMode) {
    nextEnv.OPENCODEX_HOST_SANDBOX_MODE = overrideSandboxMode;
  }

  return nextEnv;
}

async function tryClaimHostExecutorJob(jobPath) {
  const lockDir = `${jobPath}.claim`;
  const leasePath = path.join(lockDir, 'lease.json');

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(lockDir, { recursive: false });
      const lease = buildHostExecutorClaimLease();
      await writeJson(leasePath, lease);
      return { lockDir, leasePath };
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }

      let existingLease = null;
      try {
        existingLease = await readJson(leasePath);
      } catch {
        existingLease = null;
      }

      if (!isExpiredHostExecutorClaimLease(existingLease)) {
        return null;
      }

      if (!existingLease && !(await isExpiredHostExecutorClaimDir(lockDir))) {
        return null;
      }

      await rm(lockDir, { recursive: true, force: true });
    }
  }

  return null;
}

async function releaseHostExecutorJobClaim(claimLease) {
  if (!claimLease?.lockDir) {
    return;
  }
  await rm(claimLease.lockDir, { recursive: true, force: true });
}

function buildHostExecutorClaimLease() {
  const now = Date.now();
  return {
    acquired_at: new Date(now).toISOString(),
    expires_at: new Date(now + HOST_EXECUTOR_CLAIM_LEASE_TTL_MS).toISOString()
  };
}

function isExpiredHostExecutorClaimLease(lease) {
  const expiresAt = Date.parse(String(lease?.expires_at || ''));
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now();
}

async function isExpiredHostExecutorClaimDir(lockDir) {
  try {
    const metadata = await stat(lockDir);
    return metadata.mtimeMs + HOST_EXECUTOR_CLAIM_LEASE_TTL_MS <= Date.now();
  } catch {
    return true;
  }
}

function createHostExecutorJobId() {
  const timestamp = new Date().toISOString().replace(/[-:.]/g, '').replace('T', '-').slice(0, 15);
  const random = Math.random().toString(36).slice(2, 8);
  return `host-${timestamp}-${random}`;
}
