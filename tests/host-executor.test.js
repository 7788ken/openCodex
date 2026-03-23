import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { enqueueHostExecutorJob, claimNextPendingHostExecutorJob, loadHostExecutorJob, resolveHostExecutorRoot } from '../src/lib/host-executor.js';
import { writeJson } from '../src/lib/fs.js';

test('claimNextPendingHostExecutorJob only lets one concurrent claimer take the same pending job', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-host-executor-claim-'));
  const rootDir = resolveHostExecutorRoot({ cwd, env: {} });

  const { jobPath } = await enqueueHostExecutorJob({
    rootDir,
    cwd,
    workflowSessionId: 'cto-claim-race',
    parentSessionId: 'cto-claim-race',
    task: { id: 'race-task', title: 'Race task' },
    message: { update_id: 1, message_id: 1, chat_id: '123', sender_display: 'Tester' },
    profile: 'full-access',
    prompt: 'do the thing',
    outputPath: path.join(cwd, 'race-output.json')
  });

  const [firstClaim, secondClaim] = await Promise.all([
    claimNextPendingHostExecutorJob(rootDir),
    claimNextPendingHostExecutorJob(rootDir)
  ]);

  const successfulClaims = [firstClaim, secondClaim].filter(Boolean);
  assert.equal(successfulClaims.length, 1);
  assert.equal(successfulClaims[0].job.status, 'running');
  assert.equal(successfulClaims[0].job.task_id, 'race-task');

  const storedJob = await loadHostExecutorJob(jobPath);
  assert.equal(storedJob.status, 'running');
  assert.equal(storedJob.attempt_count, 1);
});

test('claimNextPendingHostExecutorJob can recover from an expired stale claim lease', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-host-executor-stale-claim-'));
  const rootDir = resolveHostExecutorRoot({ cwd, env: {} });

  const { jobPath } = await enqueueHostExecutorJob({
    rootDir,
    cwd,
    workflowSessionId: 'cto-stale-claim',
    parentSessionId: 'cto-stale-claim',
    task: { id: 'stale-task', title: 'Stale task' },
    message: { update_id: 2, message_id: 2, chat_id: '123', sender_display: 'Tester' },
    profile: 'full-access',
    prompt: 'recover the stale lock',
    outputPath: path.join(cwd, 'stale-output.json')
  });

  const claimDir = `${jobPath}.claim`;
  await mkdir(claimDir, { recursive: true });
  await writeJson(path.join(claimDir, 'lease.json'), {
    acquired_at: '2026-03-01T00:00:00.000Z',
    expires_at: '2026-03-01T00:00:01.000Z'
  });

  const claimed = await claimNextPendingHostExecutorJob(rootDir);
  assert.ok(claimed);
  assert.equal(claimed.job.status, 'running');
  assert.equal(claimed.job.task_id, 'stale-task');

  const storedJob = await loadHostExecutorJob(jobPath);
  assert.equal(storedJob.status, 'running');
  assert.equal(storedJob.attempt_count, 1);
});

test('enqueueHostExecutorJob persists explicit host-executor session contract metadata', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-host-executor-contract-'));
  const rootDir = resolveHostExecutorRoot({ cwd, env: {} });

  const { jobPath } = await enqueueHostExecutorJob({
    rootDir,
    cwd,
    workflowSessionId: 'cto-contract',
    parentSessionId: 'cto-contract',
    task: { id: 'contract-task', title: 'Contract task' },
    message: { update_id: 4, message_id: 4, chat_id: '123', sender_display: 'Tester' },
    profile: 'full-access',
    prompt: 'persist explicit contract metadata',
    outputPath: path.join(cwd, 'contract-output.json'),
    sessionContract: {
      schema: 'opencodex/session-contract/v1',
      layer: 'host',
      scope: 'telegram_cto',
      thread_kind: 'host_executor',
      role: 'worker',
      supervisor_session_id: 'cto-contract'
    }
  });

  const storedJob = await loadHostExecutorJob(jobPath);
  assert.equal(storedJob.session_contract?.schema, 'opencodex/session-contract/v1');
  assert.equal(storedJob.session_contract?.layer, 'host');
  assert.equal(storedJob.session_contract?.scope, 'telegram_cto');
  assert.equal(storedJob.session_contract?.thread_kind, 'host_executor');
  assert.equal(storedJob.session_contract?.role, 'worker');
  assert.equal(storedJob.session_contract?.supervisor_session_id, 'cto-contract');
});

test('claimNextPendingHostExecutorJob leaves a fresh claim directory without lease to the active claimer', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-host-executor-fresh-claim-dir-'));
  const rootDir = resolveHostExecutorRoot({ cwd, env: {} });

  const { jobPath } = await enqueueHostExecutorJob({
    rootDir,
    cwd,
    workflowSessionId: 'cto-fresh-claim-dir',
    parentSessionId: 'cto-fresh-claim-dir',
    task: { id: 'fresh-claim-task', title: 'Fresh claim task' },
    message: { update_id: 3, message_id: 3, chat_id: '123', sender_display: 'Tester' },
    profile: 'full-access',
    prompt: 'respect the in-flight claim directory',
    outputPath: path.join(cwd, 'fresh-claim-output.json')
  });

  await mkdir(`${jobPath}.claim`, { recursive: true });

  const claimed = await claimNextPendingHostExecutorJob(rootDir);
  assert.equal(claimed, null);

  const storedJob = await loadHostExecutorJob(jobPath);
  assert.equal(storedJob.status, 'pending');
  assert.equal(storedJob.attempt_count, 0);
});
