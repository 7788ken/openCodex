import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { pruneEndedSessions } from '../src/lib/session-store.js';

const FIXED_NOW = '2026-03-11T12:00:00.000Z';

test('pruneEndedSessions removes only old ended sessions while preserving active workflow lineage', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-session-store-prune-'));

  await writeSessionFixture(cwd, {
    session_id: 'im-running-listener',
    command: 'im',
    status: 'running',
    created_at: '2026-03-11T11:00:00.000Z',
    updated_at: '2026-03-11T11:00:00.000Z',
    input: {
      prompt: '',
      arguments: {
        provider: 'telegram',
        mode: 'listen'
      }
    }
  });

  await writeSessionFixture(cwd, {
    session_id: 'cto-waiting-workflow',
    command: 'cto',
    status: 'partial',
    parent_session_id: 'im-running-listener',
    created_at: '2026-03-10T08:00:00.000Z',
    updated_at: '2026-03-10T08:30:00.000Z',
    child_sessions: [
      {
        session_id: 'run-preserved-child',
        command: 'run',
        status: 'completed'
      }
    ]
  }, [
    {
      name: 'cto-workflow.json',
      type: 'cto_workflow',
      json: {
        workflow_session_id: 'cto-waiting-workflow',
        status: 'waiting_for_user',
        updated_at: '2026-03-10T08:30:00.000Z',
        tasks: []
      }
    }
  ]);

  await writeSessionFixture(cwd, {
    session_id: 'run-preserved-child',
    command: 'run',
    status: 'completed',
    parent_session_id: 'cto-waiting-workflow',
    created_at: '2026-03-10T08:05:00.000Z',
    updated_at: '2026-03-10T08:25:00.000Z'
  });

  await writeSessionFixture(cwd, {
    session_id: 'cto-old-completed',
    command: 'cto',
    status: 'completed',
    parent_session_id: 'im-running-listener',
    created_at: '2026-03-10T06:00:00.000Z',
    updated_at: '2026-03-10T06:30:00.000Z'
  }, [
    {
      name: 'cto-workflow.json',
      type: 'cto_workflow',
      json: {
        workflow_session_id: 'cto-old-completed',
        status: 'completed',
        updated_at: '2026-03-10T06:30:00.000Z',
        tasks: []
      }
    }
  ]);

  await writeSessionFixture(cwd, {
    session_id: 'run-old-completed',
    command: 'run',
    status: 'completed',
    parent_session_id: 'cto-old-completed',
    created_at: '2026-03-10T06:05:00.000Z',
    updated_at: '2026-03-10T06:25:00.000Z'
  });

  await writeSessionFixture(cwd, {
    session_id: 'im-explicit-preserve',
    command: 'im',
    status: 'completed',
    created_at: '2026-03-10T05:00:00.000Z',
    updated_at: '2026-03-10T05:10:00.000Z',
    input: {
      prompt: '',
      arguments: {
        provider: 'telegram',
        mode: 'listen'
      }
    }
  });

  const result = await pruneEndedSessions(cwd, {
    includeCommands: ['im', 'cto', 'run'],
    olderThanMinutes: 0,
    keepRecentPerCommand: 0,
    preserveSessionIds: ['im-explicit-preserve'],
    now: FIXED_NOW
  });

  assert.deepEqual(
    result.pruned.map((item) => item.session_id).sort(),
    ['cto-old-completed', 'run-old-completed']
  );

  const sessionIds = (await readdir(path.join(cwd, '.opencodex', 'sessions'))).sort();
  assert.deepEqual(sessionIds, [
    'cto-waiting-workflow',
    'im-explicit-preserve',
    'im-running-listener',
    'run-preserved-child'
  ]);
});

test('pruneEndedSessions keeps the newest ended sessions for each command', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-session-store-keep-'));

  await writeSessionFixture(cwd, {
    session_id: 'run-most-recent',
    command: 'run',
    status: 'completed',
    created_at: '2026-03-11T11:20:00.000Z',
    updated_at: '2026-03-11T11:20:00.000Z'
  });

  await writeSessionFixture(cwd, {
    session_id: 'run-middle',
    command: 'run',
    status: 'completed',
    created_at: '2026-03-11T10:20:00.000Z',
    updated_at: '2026-03-11T10:20:00.000Z'
  });

  await writeSessionFixture(cwd, {
    session_id: 'run-oldest',
    command: 'run',
    status: 'completed',
    created_at: '2026-03-11T09:20:00.000Z',
    updated_at: '2026-03-11T09:20:00.000Z'
  });

  const result = await pruneEndedSessions(cwd, {
    includeCommands: ['run'],
    olderThanMinutes: 0,
    keepRecentPerCommand: 1,
    now: FIXED_NOW
  });

  assert.deepEqual(
    result.pruned.map((item) => item.session_id).sort(),
    ['run-middle', 'run-oldest']
  );

  const sessionIds = await readdir(path.join(cwd, '.opencodex', 'sessions'));
  assert.deepEqual(sessionIds, ['run-most-recent']);
});

async function writeSessionFixture(cwd, session, artifactFiles = []) {
  const sessionDir = path.join(cwd, '.opencodex', 'sessions', session.session_id);
  const artifactsDir = path.join(sessionDir, 'artifacts');
  await mkdir(artifactsDir, { recursive: true });

  const artifacts = Array.isArray(session.artifacts) ? [...session.artifacts] : [];
  for (const artifactFile of artifactFiles) {
    const artifactPath = path.join(artifactsDir, artifactFile.name);
    await mkdir(path.dirname(artifactPath), { recursive: true });
    const content = Object.hasOwn(artifactFile, 'json')
      ? `${JSON.stringify(artifactFile.json, null, 2)}\n`
      : String(artifactFile.text || '');
    await writeFile(artifactPath, content, 'utf8');
    if (artifactFile.type) {
      artifacts.push({
        type: artifactFile.type,
        path: artifactPath,
        description: artifactFile.description || ''
      });
    }
  }

  const normalizedSession = {
    session_id: session.session_id,
    command: session.command,
    status: session.status,
    created_at: session.created_at,
    updated_at: session.updated_at,
    working_directory: cwd,
    codex_cli_version: 'test',
    input: session.input || { prompt: '', arguments: {} },
    summary: session.summary || {
      title: `${session.command} ${session.status}`,
      result: session.status,
      status: session.status,
      highlights: [],
      next_steps: []
    },
    artifacts,
    ...(session.parent_session_id ? { parent_session_id: session.parent_session_id } : {}),
    ...(Array.isArray(session.child_sessions) ? { child_sessions: session.child_sessions } : {})
  };

  await writeFile(path.join(sessionDir, 'session.json'), `${JSON.stringify(normalizedSession, null, 2)}\n`, 'utf8');
}
