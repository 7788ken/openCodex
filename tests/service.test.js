import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const cli = path.resolve('bin/opencodex.js');

test('service telegram install writes launchd files with full-access as the default permission mode', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-service-install-'));
  const cwd = path.join(root, 'repo');
  const stateDir = path.join(root, 'state');
  const launchAgentDir = path.join(root, 'LaunchAgents');
  const applicationsDir = path.join(root, 'Applications');
  const launchctlState = path.join(root, 'launchctl-state.json');
  const launchctl = await writeMockLaunchctl(path.join(root, 'mock-launchctl.js'), launchctlState);

  await mkdir(cwd, { recursive: true });

  const result = await runCli([
    'service', 'telegram', 'install',
    '--cwd', cwd,
    '--chat-id', '1379564094',
    '--bot-token', 'test-token',
    '--state-dir', stateDir,
    '--launch-agent-dir', launchAgentDir,
    '--applications-dir', applicationsDir,
    '--no-load',
    '--json'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.installed, true);
  assert.equal(payload.loaded, false);
  assert.equal(payload.profile, 'full-access');

  const config = JSON.parse(await readFile(path.join(stateDir, 'service.json'), 'utf8'));
  const envFile = await readFile(path.join(stateDir, 'telegram.env'), 'utf8');
  const wrapper = await readFile(path.join(stateDir, 'telegram-listener.sh'), 'utf8');
  const plist = await readFile(path.join(launchAgentDir, 'com.opencodex.telegram.cto.plist'), 'utf8');

  assert.equal(config.chat_id, '1379564094');
  assert.equal(config.profile, 'full-access');
  assert.equal(config.permission_mode, 'full-access');
  assert.match(envFile, /OPENCODEX_TELEGRAM_BOT_TOKEN='test-token'/);
  assert.match(wrapper, /im telegram listen/);
  assert.match(wrapper, /--cto/);
  assert.match(wrapper, /--profile 'full-access'/);
  assert.match(plist, /com\.opencodex\.telegram\.cto/);
});

test('service telegram status includes workflow counts and latest workflow details', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-service-status-'));
  const cwd = path.join(root, 'repo');
  const stateDir = path.join(root, 'state');
  const launchAgentDir = path.join(root, 'LaunchAgents');
  const applicationsDir = path.join(root, 'Applications');
  const launchctlState = path.join(root, 'launchctl-state.json');
  const launchctl = await writeMockLaunchctl(path.join(root, 'mock-launchctl.js'), launchctlState);

  await mkdir(cwd, { recursive: true });
  await seedWorkflowSessions(cwd);

  await runCli([
    'service', 'telegram', 'install',
    '--cwd', cwd,
    '--chat-id', '1379564094',
    '--bot-token', 'test-token',
    '--state-dir', stateDir,
    '--launch-agent-dir', launchAgentDir,
    '--applications-dir', applicationsDir,
    '--no-load'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });

  const status = await runCli([
    'service', 'telegram', 'status',
    '--state-dir', stateDir,
    '--json'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });

  assert.equal(status.code, 0);
  const payload = JSON.parse(status.stdout);
  assert.equal(payload.running_workflow_count, 1);
  assert.equal(payload.waiting_workflow_count, 1);
  assert.equal(payload.running_task_count, 1);
  assert.equal(payload.queued_task_count, 2);
  assert.equal(payload.tracked_task_count, 5);
  assert.equal(payload.dispatch_history_count, 6);
  assert.equal(payload.recent_dispatch_count, 5);
  assert.equal(payload.recent_dispatches.length, 5);
  assert.match(payload.recent_dispatches[0].label, /^\[(completed|running)\]/);
  assert.match(payload.recent_dispatches[0].path, /\.opencodex\/sessions\/.*\/session\.json$/);
  assert.equal(payload.active_main_thread_count, 1);
  assert.equal(payload.main_thread_count, 2);
  assert.equal(payload.active_child_thread_count, 1);
  assert.equal(payload.child_session_count, 5);
  assert.equal(payload.child_thread_count, 5);
  assert.equal(payload.latest_workflow_session_id, 'cto-20260309-100500-waiting');
  assert.equal(payload.latest_workflow_status, 'waiting');
  assert.equal(payload.latest_workflow_goal, 'Deploy change after confirmation');
  assert.equal(payload.latest_workflow_pending_question, '请确认是否继续发布');
  assert.match(payload.latest_workflow_path, /cto-workflow\.json$/);
  assert.equal(payload.latest_listener_session_id, 'im-20260309-100100-listener');
});

test('service telegram dispatch-detail returns task execution details for UI viewing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-service-dispatch-detail-'));
  const cwd = path.join(root, 'repo');
  const stateDir = path.join(root, 'state');
  const launchAgentDir = path.join(root, 'LaunchAgents');
  const applicationsDir = path.join(root, 'Applications');
  const launchctlState = path.join(root, 'launchctl-state.json');
  const launchctl = await writeMockLaunchctl(path.join(root, 'mock-launchctl.js'), launchctlState);

  await mkdir(cwd, { recursive: true });
  await seedWorkflowSessions(cwd);

  await runCli([
    'service', 'telegram', 'install',
    '--cwd', cwd,
    '--chat-id', '1379564094',
    '--bot-token', 'test-token',
    '--state-dir', stateDir,
    '--launch-agent-dir', launchAgentDir,
    '--applications-dir', applicationsDir,
    '--no-load'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });

  const status = await runCli([
    'service', 'telegram', 'status',
    '--state-dir', stateDir,
    '--json'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });

  assert.equal(status.code, 0);
  const statusPayload = JSON.parse(status.stdout);
  const dispatchIndex = statusPayload.recent_dispatches.findIndex((item) => item.task_id === 'prepare-release');
  assert.notEqual(dispatchIndex, -1);

  const detail = await runCli([
    'service', 'telegram', 'dispatch-detail',
    '--state-dir', stateDir,
    '--index', String(dispatchIndex + 1),
    '--json'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });

  assert.equal(detail.code, 0);
  const payload = JSON.parse(detail.stdout);
  assert.equal(payload.index, dispatchIndex + 1);
  assert.equal(payload.workflow_session_id, 'cto-20260309-100500-waiting');
  assert.equal(payload.task_id, 'prepare-release');
  assert.equal(payload.title, 'Prepare release');
  assert.equal(payload.status, 'completed');
  assert.equal(payload.session_id, 'run-task-2');
  assert.match(payload.result, /Release checklist prepared/);
  assert.match(payload.workflow_goal, /Deploy change after confirmation/);
  assert.match(payload.pending_question, /请确认是否继续发布/);
  assert.deepEqual(payload.changed_files, ['docs/en/release-plan.md', 'docs/zh/release-plan.md']);
  assert.match(payload.record_path, /run-task-2\/session\.json$/);
  assert.match(payload.events_path, /run-task-2\/events\.jsonl$/);
  assert.match(payload.last_message_path, /run-task-2\/last-message\.txt$/);
  assert.ok(payload.recent_activity.some((item) => item.includes('Checklist updated')));
  assert.match(payload.last_message, /Waiting for CEO confirmation/);
});

test('service telegram task-history returns the full task history for UI browsing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-service-task-history-'));
  const cwd = path.join(root, 'repo');
  const stateDir = path.join(root, 'state');
  const launchAgentDir = path.join(root, 'LaunchAgents');
  const applicationsDir = path.join(root, 'Applications');
  const launchctlState = path.join(root, 'launchctl-state.json');
  const launchctl = await writeMockLaunchctl(path.join(root, 'mock-launchctl.js'), launchctlState);

  await mkdir(cwd, { recursive: true });
  await seedWorkflowSessions(cwd);

  await runCli([
    'service', 'telegram', 'install',
    '--cwd', cwd,
    '--chat-id', '1379564094',
    '--bot-token', 'test-token',
    '--state-dir', stateDir,
    '--launch-agent-dir', launchAgentDir,
    '--applications-dir', applicationsDir,
    '--no-load'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });

  const history = await runCli([
    'service', 'telegram', 'task-history',
    '--state-dir', stateDir,
    '--json'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });

  assert.equal(history.code, 0);
  const payload = JSON.parse(history.stdout);
  assert.equal(payload.total_count, 6);
  assert.equal(payload.items.length, 6);
  const reviewIndex = payload.items.findIndex((item) => item.task_id === 'review-docs');
  assert.notEqual(reviewIndex, -1);
  assert.match(payload.items[reviewIndex].label, /review-docs/);

  const detail = await runCli([
    'service', 'telegram', 'dispatch-detail',
    '--state-dir', stateDir,
    '--index', String(reviewIndex + 1),
    '--json'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });

  assert.equal(detail.code, 0);
  const detailPayload = JSON.parse(detail.stdout);
  assert.equal(detailPayload.task_id, 'review-docs');
  assert.equal(detailPayload.session_id, 'run-task-4');
  assert.match(detailPayload.result, /Documentation review completed/);
});

test('service telegram set-profile updates the wrapper and restarts a loaded service', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-service-profile-'));
  const cwd = path.join(root, 'repo');
  const stateDir = path.join(root, 'state');
  const launchAgentDir = path.join(root, 'LaunchAgents');
  const applicationsDir = path.join(root, 'Applications');
  const launchctlState = path.join(root, 'launchctl-state.json');
  const launchctl = await writeMockLaunchctl(path.join(root, 'mock-launchctl.js'), launchctlState);

  await mkdir(cwd, { recursive: true });

  await runCli([
    'service', 'telegram', 'install',
    '--cwd', cwd,
    '--chat-id', '1379564094',
    '--bot-token', 'test-token',
    '--state-dir', stateDir,
    '--launch-agent-dir', launchAgentDir,
    '--applications-dir', applicationsDir,
    '--no-load'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });

  const start = await runCli([
    'service', 'telegram', 'start',
    '--state-dir', stateDir,
    '--json'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });
  assert.equal(start.code, 0);
  assert.equal(JSON.parse(start.stdout).loaded, true);

  const setProfile = await runCli([
    'service', 'telegram', 'set-profile',
    '--state-dir', stateDir,
    '--profile', 'safe',
    '--json'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });
  assert.equal(setProfile.code, 0);
  const setProfilePayload = JSON.parse(setProfile.stdout);
  assert.equal(setProfilePayload.loaded, true);
  assert.equal(setProfilePayload.profile, 'safe');
  assert.equal(setProfilePayload.permission_mode, 'safe');
  assert.equal(setProfilePayload.previous_profile, 'full-access');

  const config = JSON.parse(await readFile(path.join(stateDir, 'service.json'), 'utf8'));
  const wrapper = await readFile(path.join(stateDir, 'telegram-listener.sh'), 'utf8');
  assert.equal(config.profile, 'safe');
  assert.equal(config.permission_mode, 'safe');
  assert.match(wrapper, /--profile 'safe'/);

  const status = await runCli([
    'service', 'telegram', 'status',
    '--state-dir', stateDir,
    '--json'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });
  const statusPayload = JSON.parse(status.stdout);
  assert.equal(statusPayload.loaded, true);
  assert.equal(statusPayload.state, 'running');
  assert.equal(statusPayload.pid, 4242);
  assert.equal(statusPayload.permission_mode, 'safe');

  const stop = await runCli([
    'service', 'telegram', 'stop',
    '--state-dir', stateDir,
    '--json'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });
  assert.equal(stop.code, 0);
  assert.equal(JSON.parse(stop.stdout).loaded, false);

  const uninstall = await runCli([
    'service', 'telegram', 'uninstall',
    '--state-dir', stateDir,
    '--json'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });
  assert.equal(uninstall.code, 0);
  const uninstallPayload = JSON.parse(uninstall.stdout);
  assert.equal(uninstallPayload.installed, false);
});

test('service telegram send-status sends the current workflow snapshot back to Telegram', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-service-send-status-'));
  const cwd = path.join(root, 'repo');
  const stateDir = path.join(root, 'state');
  const launchAgentDir = path.join(root, 'LaunchAgents');
  const applicationsDir = path.join(root, 'Applications');
  const launchctlState = path.join(root, 'launchctl-state.json');
  const launchctl = await writeMockLaunchctl(path.join(root, 'mock-launchctl.js'), launchctlState);
  const telegram = await startTelegramMockServer({ updates: [] });

  await mkdir(cwd, { recursive: true });
  await seedWorkflowSessions(cwd);

  await runCli([
    'service', 'telegram', 'install',
    '--cwd', cwd,
    '--chat-id', '1379564094',
    '--bot-token', 'test-token',
    '--state-dir', stateDir,
    '--launch-agent-dir', launchAgentDir,
    '--applications-dir', applicationsDir,
    '--no-load'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });

  const result = await runCli([
    'service', 'telegram', 'send-status',
    '--state-dir', stateDir,
    '--json'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState,
    OPENCODEX_TELEGRAM_API_BASE_URL: telegram.baseUrl
  });

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.sent, true);
  assert.equal(telegram.state.sentMessages.length, 1);
  assert.equal(telegram.state.sentMessages[0].chat_id, '1379564094');
  assert.match(telegram.state.sentMessages[0].text, /openCodex CTO 状态回执/);
  assert.match(telegram.state.sentMessages[0].text, /工作流：running 1 \/ waiting 1/);
  assert.match(telegram.state.sentMessages[0].text, /任务：running 1 \/ queued 2/);
  assert.match(telegram.state.sentMessages[0].text, /线程：主活跃 1 \/ 子活跃 1 \/ 子累计 5/);
  assert.match(telegram.state.sentMessages[0].text, /Deploy change after confirmation/);

  await telegram.close();
});

test('service telegram install can compile the menu bar app and expose workflow actions in the source script', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-service-menubar-'));
  const cwd = path.join(root, 'repo');
  const stateDir = path.join(root, 'state');
  const launchAgentDir = path.join(root, 'LaunchAgents');
  const applicationsDir = path.join(root, 'Applications');
  const launchctlState = path.join(root, 'launchctl-state.json');
  const launchctl = await writeMockLaunchctl(path.join(root, 'mock-launchctl.js'), launchctlState);
  const osacompile = await writeMockOsacompile(path.join(root, 'mock-osacompile.js'));

  await mkdir(cwd, { recursive: true });

  const result = await runCli([
    'service', 'telegram', 'install',
    '--cwd', cwd,
    '--chat-id', '1379564094',
    '--bot-token', 'test-token',
    '--state-dir', stateDir,
    '--launch-agent-dir', launchAgentDir,
    '--applications-dir', applicationsDir,
    '--install-menubar',
    '--no-load',
    '--json'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState,
    OPENCODEX_OSACOMPILE_BIN: osacompile
  });

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.menubar_installed, true);
  assert.equal(payload.profile, 'full-access');

  const infoPlist = await readFile(path.join(applicationsDir, 'OpenCodex Tray.app', 'Contents', 'Info.plist'), 'utf8');
  const scriptSource = await readFile(path.join(stateDir, 'OpenCodexTray.applescript'), 'utf8');
  assert.match(infoPlist, /LSUIElement/);
  assert.match(infoPlist, /<true\/>/);
  assert.match(scriptSource, /Use Safe Mode/);
  assert.match(scriptSource, /Use Full Access Mode/);
  assert.match(scriptSource, /Open Latest Workflow/);
  assert.match(scriptSource, /Send Status Reply/);
  assert.match(scriptSource, /Running Workflows:/);
  assert.match(scriptSource, /Running Tasks:/);
  assert.match(scriptSource, /Recent Dispatches/);
  assert.match(scriptSource, /openDispatch1_/);
  assert.match(scriptSource, /dispatch-detail --index/);
  assert.match(scriptSource, /task-history --state-dir/);
  assert.match(scriptSource, /Browse Task History/);
  assert.match(scriptSource, /choose from list historyItems/);
  assert.match(scriptSource, /display dialog summaryText buttons \{"Sections", "Paths", "Close"\}/);
  assert.match(scriptSource, /browseDispatchSections/);
  assert.match(scriptSource, /browseDispatchArtifacts/);
  assert.match(scriptSource, /dispatchSummaryText/);
  assert.match(scriptSource, /dispatchSectionNames/);
  assert.match(scriptSource, /dispatchSectionText/);
  assert.match(scriptSource, /choose from list sectionNames/);
  assert.match(scriptSource, /choose from list artifactChoices/);
  assert.match(scriptSource, /Record — /);
  assert.match(scriptSource, /Events — /);
  assert.match(scriptSource, /Last Message — /);
  assert.doesNotMatch(scriptSource, /Open Message/);
  assert.match(scriptSource, /Active Main Threads:/);
  assert.match(scriptSource, /Active Child Threads:/);
  assert.match(scriptSource, /Child Sessions:/);
  assert.match(scriptSource, /Threads: main active/);
  assert.match(scriptSource, /runningTaskCount/);
  assert.match(scriptSource, /totalChildCount/);
  assert.match(scriptSource, /service telegram send-status/);
  assert.match(scriptSource, /OC⚡/);
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

async function seedWorkflowSessions(cwd) {
  await writeSessionFixture(cwd, {
    session_id: 'im-20260309-100100-listener',
    command: 'im',
    status: 'running',
    updated_at: '2026-03-09T10:01:00.000Z',
    created_at: '2026-03-09T10:01:00.000Z',
    input: {
      prompt: '',
      arguments: {
        provider: 'telegram',
        delegate_mode: 'cto',
        profile: 'full-access'
      }
    },
    summary: {
      title: 'Telegram listening',
      result: 'Waiting for Telegram messages.',
      status: 'running',
      highlights: [],
      next_steps: []
    }
  });

  await writeSessionFixture(cwd, {
    session_id: 'cto-20260309-100300-running',
    command: 'cto',
    status: 'running',
    updated_at: '2026-03-09T10:03:30.000Z',
    created_at: '2026-03-09T10:03:00.000Z',
    input: {
      prompt: 'Inspect repository changes',
      arguments: {
        provider: 'telegram'
      }
    },
    child_sessions: [
      { session_id: 'run-plan-1' },
      { session_id: 'run-task-1' }
    ],
    summary: {
      title: 'CTO workflow running',
      result: 'Workflow is running with active tasks.',
      status: 'running',
      highlights: [],
      next_steps: []
    },
    workflow_state: {
      status: 'running',
      goal_text: 'Inspect repository changes',
      pending_question_zh: '',
      updated_at: '2026-03-09T10:03:30.000Z',
      tasks: [
        {
          id: 'inspect-repo',
          title: 'Inspect repository',
          status: 'completed',
          session_id: 'run-task-0',
          updated_at: '2026-03-09T10:03:10.000Z'
        },
        {
          id: 'summarize-findings',
          title: 'Summarize findings',
          status: 'running',
          updated_at: '2026-03-09T10:03:30.000Z'
        }
      ]
    }
  });

  await writeSessionFixture(cwd, {
    session_id: 'cto-20260309-100500-waiting',
    command: 'cto',
    status: 'partial',
    updated_at: '2026-03-09T10:05:30.000Z',
    created_at: '2026-03-09T10:05:00.000Z',
    input: {
      prompt: 'Deploy change after confirmation',
      arguments: {
        provider: 'telegram'
      }
    },
    child_sessions: [
      { session_id: 'run-plan-2' },
      { session_id: 'run-task-2' },
      { session_id: 'run-task-3' }
    ],
    summary: {
      title: 'CTO workflow waiting',
      result: 'Waiting for the CEO to confirm the next step.',
      status: 'partial',
      highlights: [],
      next_steps: []
    },
    workflow_state: {
      status: 'waiting_for_user',
      goal_text: 'Deploy change after confirmation',
      pending_question_zh: '请确认是否继续发布',
      updated_at: '2026-03-09T10:05:30.000Z',
      tasks: [
        {
          id: 'prepare-release',
          title: 'Prepare release',
          status: 'completed',
          session_id: 'run-task-2',
          updated_at: '2026-03-09T10:05:10.000Z'
        },
        {
          id: 'deploy-change',
          title: 'Deploy change',
          status: 'queued',
          updated_at: '2026-03-09T10:05:20.000Z'
        },
        {
          id: 'announce-release',
          title: 'Announce release',
          status: 'queued',
          updated_at: '2026-03-09T10:05:30.000Z'
        }
      ]
    }
  });

  await writeSessionFixture(cwd, {
    session_id: 'cto-20260309-095900-completed',
    command: 'cto',
    status: 'completed',
    updated_at: '2026-03-09T09:59:50.000Z',
    created_at: '2026-03-09T09:59:00.000Z',
    input: {
      prompt: 'Review docs and sync roadmap',
      arguments: {
        provider: 'telegram'
      }
    },
    child_sessions: [
      { session_id: 'run-task-4' },
      { session_id: 'run-task-5' },
      { session_id: 'run-task-6' }
    ],
    summary: {
      title: 'CTO workflow completed',
      result: 'Completed the documentation and roadmap follow-up tasks.',
      status: 'completed',
      highlights: [],
      next_steps: []
    },
    workflow_state: {
      status: 'completed',
      goal_text: 'Review docs and sync roadmap',
      pending_question_zh: '',
      updated_at: '2026-03-09T09:59:50.000Z',
      tasks: [
        {
          id: 'review-docs',
          title: 'Review docs',
          status: 'completed',
          session_id: 'run-task-4',
          updated_at: '2026-03-09T09:59:40.000Z'
        },
        {
          id: 'sync-roadmap',
          title: 'Sync roadmap',
          status: 'completed',
          session_id: 'run-task-5',
          updated_at: '2026-03-09T09:59:30.000Z'
        },
        {
          id: 'archive-notes',
          title: 'Archive notes',
          status: 'completed',
          session_id: 'run-task-6',
          updated_at: '2026-03-09T09:59:20.000Z'
        }
      ]
    }
  });

  await writeSessionFixture(cwd, {
    session_id: 'run-task-0',
    command: 'run',
    status: 'completed',
    updated_at: '2026-03-09T10:03:10.000Z',
    created_at: '2026-03-09T10:03:05.000Z',
    input: {
      prompt: 'Inspect repository',
      arguments: {
        profile: 'full-access'
      }
    },
    summary: {
      title: 'Inspect repository',
      result: 'Repository inspection completed and findings were prepared for the CTO.',
      status: 'completed',
      highlights: ['Mapped menu bar handlers in `src/commands/service.js`.'],
      next_steps: ['Share the findings summary with the CTO.'],
      validation: ['Static inspection completed.'],
      changed_files: [],
      findings: []
    },
    events: [
      JSON.stringify({ type: 'turn.started', message: 'Started repository inspection.' }),
      JSON.stringify({ type: 'analysis', text: 'Mapped the recent dispatch menu hooks.' }),
      JSON.stringify({ type: 'turn.completed', message: 'Inspection completed and findings are ready.' })
    ],
    last_message: 'Inspected the repository and mapped the recent dispatch hooks.'
  });

  await writeSessionFixture(cwd, {
    session_id: 'run-task-2',
    command: 'run',
    status: 'completed',
    updated_at: '2026-03-09T10:05:10.000Z',
    created_at: '2026-03-09T10:05:05.000Z',
    input: {
      prompt: 'Prepare release',
      arguments: {
        profile: 'full-access'
      }
    },
    summary: {
      title: 'Prepare release',
      result: 'Release checklist prepared and waiting for confirmation to deploy.',
      status: 'completed',
      highlights: ['Prepared the release checklist for the next deployment.'],
      next_steps: ['Wait for CEO confirmation before deployment.'],
      validation: ['Checklist reviewed for deploy readiness.'],
      changed_files: ['docs/en/release-plan.md', 'docs/zh/release-plan.md'],
      findings: []
    },
    events: [
      JSON.stringify({ type: 'turn.started', message: 'Started preparing release.' }),
      JSON.stringify({ type: 'tool.result', message: 'Checklist updated for release approval.' }),
      JSON.stringify({ type: 'turn.completed', message: 'Release checklist prepared and ready for confirmation.' })
    ],
    last_message: 'Prepared the release checklist.\nWaiting for CEO confirmation before deployment.'
  });

  await writeSessionFixture(cwd, {
    session_id: 'run-task-4',
    command: 'run',
    status: 'completed',
    updated_at: '2026-03-09T09:59:40.000Z',
    created_at: '2026-03-09T09:59:10.000Z',
    input: {
      prompt: 'Review docs',
      arguments: {
        profile: 'full-access'
      }
    },
    summary: {
      title: 'Review docs',
      result: 'Documentation review completed and follow-up notes were captured.',
      status: 'completed',
      highlights: ['Validated the release and architecture documents.'],
      next_steps: ['Sync the roadmap notes with the team.'],
      validation: ['Reviewed the docs change set.'],
      changed_files: ['docs/en/architecture.md'],
      findings: []
    },
    events: [
      JSON.stringify({ type: 'turn.started', message: 'Started documentation review.' }),
      JSON.stringify({ type: 'analysis', text: 'Validated architecture and release docs.' }),
      JSON.stringify({ type: 'turn.completed', message: 'Documentation review completed.' })
    ],
    last_message: 'Documentation review completed and notes were captured.'
  });

  await writeSessionFixture(cwd, {
    session_id: 'run-task-5',
    command: 'run',
    status: 'completed',
    updated_at: '2026-03-09T09:59:30.000Z',
    created_at: '2026-03-09T09:59:12.000Z',
    input: {
      prompt: 'Sync roadmap',
      arguments: {
        profile: 'full-access'
      }
    },
    summary: {
      title: 'Sync roadmap',
      result: 'Roadmap sync notes were prepared for the next planning pass.',
      status: 'completed',
      highlights: ['Aligned the roadmap notes with the latest CTO decisions.'],
      next_steps: ['Share the roadmap summary.'],
      validation: ['Roadmap notes reviewed.'],
      changed_files: ['docs/en/roadmap.md'],
      findings: []
    },
    events: [
      JSON.stringify({ type: 'turn.started', message: 'Started roadmap sync.' }),
      JSON.stringify({ type: 'tool.result', message: 'Roadmap notes updated.' }),
      JSON.stringify({ type: 'turn.completed', message: 'Roadmap sync completed.' })
    ],
    last_message: 'Roadmap sync completed.'
  });

  await writeSessionFixture(cwd, {
    session_id: 'run-task-6',
    command: 'run',
    status: 'completed',
    updated_at: '2026-03-09T09:59:20.000Z',
    created_at: '2026-03-09T09:59:14.000Z',
    input: {
      prompt: 'Archive notes',
      arguments: {
        profile: 'full-access'
      }
    },
    summary: {
      title: 'Archive notes',
      result: 'Archived notes for the completed workflow.',
      status: 'completed',
      highlights: ['Stored the workflow wrap-up notes.'],
      next_steps: [],
      validation: ['Archive path verified.'],
      changed_files: [],
      findings: []
    },
    events: [
      JSON.stringify({ type: 'turn.started', message: 'Started note archive.' }),
      JSON.stringify({ type: 'turn.completed', message: 'Notes archived.' })
    ],
    last_message: 'Archived the workflow notes.'
  });
}

async function writeSessionFixture(cwd, fixture) {
  const sessionDir = path.join(cwd, '.opencodex', 'sessions', fixture.session_id);
  const artifactsDir = path.join(sessionDir, 'artifacts');
  await mkdir(artifactsDir, { recursive: true });

  const artifacts = [];
  if (fixture.workflow_state) {
    const workflowPath = path.join(artifactsDir, 'cto-workflow.json');
    await writeFile(workflowPath, JSON.stringify(fixture.workflow_state, null, 2) + '\n');
    artifacts.push({
      type: 'cto_workflow',
      path: workflowPath,
      description: 'Workflow state fixture.'
    });
  }

  if (Array.isArray(fixture.events)) {
    const eventsPath = path.join(sessionDir, 'events.jsonl');
    await writeFile(eventsPath, fixture.events.join('\n') + '\n');
    artifacts.push({
      type: 'jsonl_events',
      path: eventsPath,
      description: 'Raw task event fixture.'
    });
  }

  if (typeof fixture.last_message === 'string') {
    const lastMessagePath = path.join(sessionDir, 'last-message.txt');
    await writeFile(lastMessagePath, fixture.last_message, 'utf8');
    artifacts.push({
      type: 'last_message',
      path: lastMessagePath,
      description: 'Task final message fixture.'
    });
  }

  const session = {
    session_id: fixture.session_id,
    command: fixture.command,
    status: fixture.status,
    created_at: fixture.created_at,
    updated_at: fixture.updated_at,
    working_directory: cwd,
    input: fixture.input,
    summary: fixture.summary,
    artifacts,
    child_sessions: fixture.child_sessions || []
  };

  await writeFile(path.join(sessionDir, 'session.json'), JSON.stringify(session, null, 2) + '\n');
}

async function startTelegramMockServer({ updates, webhookUrl = '' }) {
  const state = {
    updates: [...updates],
    webhookUrl,
    sentMessages: [],
    deleteWebhookCalls: 0
  };

  const server = http.createServer(async (request, response) => {
    const rawBody = await readRequestBody(request);
    const body = rawBody ? JSON.parse(rawBody) : {};
    const [, botToken, methodName] = (request.url || '').match(/^\/bot([^/]+)\/([^?]+)/) || [];

    if (botToken !== 'test-token') {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: false, description: 'bad token' }));
      return;
    }

    if (methodName === 'sendMessage') {
      state.sentMessages.push({
        chat_id: String(body.chat_id),
        text: body.text,
        ...(body.reply_to_message_id ? { reply_to_message_id: body.reply_to_message_id } : {})
      });
      return writeTelegram(response, {
        message_id: 900,
        date: 1741435201,
        text: body.text,
        chat: { id: body.chat_id }
      });
    }

    if (methodName === 'getMe') {
      return writeTelegram(response, { id: 77, is_bot: true, username: 'openCodexBot', first_name: 'openCodex' });
    }

    if (methodName === 'getWebhookInfo') {
      return writeTelegram(response, { url: state.webhookUrl });
    }

    if (methodName === 'deleteWebhook') {
      state.deleteWebhookCalls += 1;
      state.webhookUrl = '';
      return writeTelegram(response, true);
    }

    if (methodName === 'getUpdates') {
      const offset = Number(body.offset || 0);
      const nextUpdates = state.updates.filter((item) => item.update_id >= offset);
      state.updates = state.updates.filter((item) => item.update_id < offset);
      return writeTelegram(response, nextUpdates);
    }

    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: false, description: `unknown method ${methodName}` }));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    state,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })
  };
}

function writeTelegram(response, result) {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ ok: true, result }));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

async function writeMockLaunchctl(filePath, statePath) {
  const source = `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const statePath = process.env.OPENCODEX_MOCK_LAUNCHCTL_STATE;
const state = readState(statePath);

if (args[0] === 'print') {
  const label = String(args[1] || '').split('/').pop();
  const item = state[label];
  if (!item || !item.loaded) {
    console.error('service not loaded');
    process.exit(1);
  }
  console.log(label + ' = {');
  console.log('\tpid = 4242');
  console.log('\tstate = running');
  console.log('}');
  process.exit(0);
}

if (args[0] === 'bootstrap') {
  const plistPath = args[2];
  const label = plistPath.split('/').pop().replace(/\.plist$/, '');
  state[label] = { loaded: true };
  writeState(statePath, state);
  process.exit(0);
}

if (args[0] === 'kickstart') {
  process.exit(0);
}

if (args[0] === 'bootout') {
  const label = String(args[1] || '').split('/').pop();
  state[label] = { loaded: false };
  writeState(statePath, state);
  process.exit(0);
}

console.error('unsupported launchctl invocation: ' + args.join(' '));
process.exit(1);

function readState(target) {
  try {
    return JSON.parse(readFileSync(target, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(target, value) {
  writeFileSync(target, JSON.stringify(value));
}
`;
  await writeFile(filePath, source, { mode: 0o755 });
  return filePath;
}

async function writeMockOsacompile(filePath) {
  const source = `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const outputIndex = args.indexOf('-o');
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : '';
if (!outputPath) {
  console.error('missing -o app path');
  process.exit(1);
}
mkdirSync(path.join(outputPath, 'Contents'), { recursive: true });
writeFileSync(path.join(outputPath, 'Contents', 'Info.plist'), '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict></dict></plist>');
process.exit(0);
`;
  await writeFile(filePath, source, { mode: 0o755 });
  return filePath;
}
