import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const cli = path.resolve('bin/opencodex.js');

test('service telegram install refuses to bind a long-lived service to the current project checkout by default', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-service-install-refuse-'));
  const cwd = path.join(root, 'repo');
  const stateDir = path.join(root, 'state');
  const launchAgentDir = path.join(root, 'LaunchAgents');
  const applicationsDir = path.join(root, 'Applications');

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
  ]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /refuses to bind a long-lived service to the current project checkout/);
});

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
    '--allow-project-cli',
    '--cwd', cwd,
    '--chat-id', '1379564094',
    '--bot-token', 'test-token',
    '--supervisor-interval', '300',
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
  assert.equal(payload.supervisor_loaded, false);
  assert.equal(payload.profile, 'full-access');
  assert.equal(payload.launcher_scope, 'project_checkout');
  assert.match(payload.launcher_warning, /development checkout/);

  const config = JSON.parse(await readFile(path.join(stateDir, 'service.json'), 'utf8'));
  const envFile = await readFile(path.join(stateDir, 'telegram.env'), 'utf8');
  const wrapper = await readFile(path.join(stateDir, 'telegram-listener.sh'), 'utf8');
  const supervisorWrapper = await readFile(path.join(stateDir, 'telegram-supervisor.sh'), 'utf8');
  const plist = await readFile(path.join(launchAgentDir, 'com.opencodex.telegram.cto.plist'), 'utf8');
  const supervisorPlist = await readFile(path.join(launchAgentDir, 'com.opencodex.telegram.cto.supervisor.plist'), 'utf8');

  assert.equal(config.chat_id, '1379564094');
  assert.equal(config.profile, 'full-access');
  assert.equal(config.permission_mode, 'full-access');
  assert.equal(config.supervisor_label, 'com.opencodex.telegram.cto.supervisor');
  assert.equal(config.supervisor_interval_seconds, 300);
  assert.deepEqual(config.settings, {
    ui_language: 'en',
    badge_mode: 'tasks',
    refresh_interval_seconds: 15,
    show_workflow_ids: false,
    show_paths: false
  });
  assert.equal(config.cli_path, cli);
  assert.match(config.cto_soul_path, /state\/cto-soul\.md$/);
  assert.match(config.cto_chat_soul_path, /state\/cto-chat-soul\.md$/);
  assert.match(config.cto_workflow_soul_path, /state\/cto-workflow-soul\.md$/);
  assert.match(config.cto_reply_agent_soul_path, /state\/cto-reply-agent-soul\.md$/);
  assert.match(config.cto_planner_agent_soul_path, /state\/cto-planner-agent-soul\.md$/);
  assert.match(config.cto_worker_agent_soul_path, /state\/cto-worker-agent-soul\.md$/);
  assert.match(envFile, /OPENCODEX_TELEGRAM_BOT_TOKEN='test-token'/);
  assert.match(envFile, /OPENCODEX_TELEGRAM_SERVICE_MODE='1'/);
  assert.match(envFile, /OPENCODEX_CTO_SOUL_PATH='.*state\/cto-soul\.md'/);
  assert.ok(envFile.includes(`export OPENCODEX_SERVICE_STATE_DIR='${stateDir}'`));
  assert.match(envFile, /OPENCODEX_HOST_EXECUTOR_ENABLED='1'/);
  assert.match(wrapper, /im telegram listen/);
  assert.match(supervisorWrapper, /im telegram supervise/);
  assert.match(wrapper, /--cto/);
  assert.match(wrapper, /--profile 'full-access'/);
  assert.match(plist, /com\.opencodex\.telegram\.cto/);
  assert.match(supervisorPlist, /com\.opencodex\.telegram\.cto\.supervisor/);
  assert.match(supervisorPlist, /<key>StartInterval<\/key>\s*<integer>300<\/integer>/);
});

test('service telegram install defaults to a user workspace outside the repository when --cwd is omitted', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-service-install-default-cwd-'));
  const homeDir = path.join(root, 'home');
  const stateDir = path.join(root, 'state');
  const launchAgentDir = path.join(root, 'LaunchAgents');
  const applicationsDir = path.join(root, 'Applications');
  const launchctlState = path.join(root, 'launchctl-state.json');
  const launchctl = await writeMockLaunchctl(path.join(root, 'mock-launchctl.js'), launchctlState);
  const expectedWorkspace = path.join(homeDir, '.opencodex', 'workspaces', 'telegram-cto');

  const result = await runCli([
    'service', 'telegram', 'install',
    '--allow-project-cli',
    '--chat-id', '1379564094',
    '--bot-token', 'test-token',
    '--state-dir', stateDir,
    '--launch-agent-dir', launchAgentDir,
    '--applications-dir', applicationsDir,
    '--no-load',
    '--json'
  ], {
    HOME: homeDir,
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.cwd, expectedWorkspace);
  assert.equal(payload.workspace_scope, 'workspace');
  assert.equal(payload.workspace_warning, '');

  const config = JSON.parse(await readFile(path.join(stateDir, 'service.json'), 'utf8'));
  const envFile = await readFile(path.join(stateDir, 'telegram.env'), 'utf8');
  const wrapper = await readFile(path.join(stateDir, 'telegram-listener.sh'), 'utf8');
  const plist = await readFile(path.join(launchAgentDir, 'com.opencodex.telegram.cto.plist'), 'utf8');
  assert.equal(config.cwd, expectedWorkspace);
  assert.equal(config.cto_soul_path, path.join(stateDir, 'cto-soul.md'));
  assert.equal(config.cto_chat_soul_path, path.join(stateDir, 'cto-chat-soul.md'));
  assert.equal(config.cto_workflow_soul_path, path.join(stateDir, 'cto-workflow-soul.md'));
  assert.equal(config.cto_reply_agent_soul_path, path.join(stateDir, 'cto-reply-agent-soul.md'));
  assert.equal(config.cto_planner_agent_soul_path, path.join(stateDir, 'cto-planner-agent-soul.md'));
  assert.equal(config.cto_worker_agent_soul_path, path.join(stateDir, 'cto-worker-agent-soul.md'));
  assert.match(envFile, /OPENCODEX_CTO_SOUL_PATH='.*state\/cto-soul\.md'/);
  assert.match(wrapper, new RegExp(`--cwd '${expectedWorkspace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
  assert.match(plist, new RegExp(`<key>WorkingDirectory</key>\\s*<string>${expectedWorkspace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</string>`));
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
    '--allow-project-cli',
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
  assert.equal(payload.rerouted_task_count, 0);
  assert.equal(payload.queued_task_count, 2);
  assert.equal(payload.tracked_task_count, 5);
  assert.equal(payload.workflow_history_count, 3);
  assert.equal(payload.dispatch_history_count, 6);
  assert.equal(payload.recent_dispatch_count, 5);
  assert.equal(payload.recent_dispatches.length, 5);
  assert.match(payload.recent_dispatches[0].label, /^\[(completed|running)\]/);
  assert.match(payload.recent_dispatches[0].path, /\.opencodex\/sessions\/.*\/session\.json$/);
  assert.equal(payload.recent_dispatches[0].thread_kind, 'child_session');
  assert.equal(payload.recent_dispatches[0].thread_kind_label, 'child session');
  assert.equal(payload.recent_dispatches[0].execution_surface, 'child_session');
  assert.equal(payload.recent_dispatches[0].session_contract_source, 'fallback');
  assert.equal(payload.active_main_thread_count, 1);
  assert.equal(payload.main_thread_count, 2);
  assert.equal(payload.active_child_thread_count, 1);
  assert.equal(payload.child_session_count, 5);
  assert.equal(payload.child_thread_count, 5);
  assert.equal(payload.ui_language, 'en');
  assert.equal(payload.badge_mode, 'tasks');
  assert.equal(payload.refresh_interval_seconds, 15);
  assert.equal(payload.show_workflow_ids, false);
  assert.equal(payload.show_paths, false);
  assert.equal(payload.supervisor_loaded, false);
  assert.equal(payload.supervisor_state, 'stopped');
  assert.equal(payload.supervisor_interval_seconds, 60);
  assert.equal(payload.cto_soul_source, 'file');
  assert.match(payload.cto_soul_path, /state\/cto-soul\.md$/);
  assert.equal(payload.cto_chat_soul_source, 'file');
  assert.match(payload.cto_chat_soul_path, /state\/cto-chat-soul\.md$/);
  assert.equal(payload.cto_workflow_soul_source, 'file');
  assert.match(payload.cto_workflow_soul_path, /state\/cto-workflow-soul\.md$/);
  assert.equal(payload.cto_reply_agent_soul_source, 'file');
  assert.match(payload.cto_reply_agent_soul_path, /state\/cto-reply-agent-soul\.md$/);
  assert.equal(payload.cto_planner_agent_soul_source, 'file');
  assert.match(payload.cto_planner_agent_soul_path, /state\/cto-planner-agent-soul\.md$/);
  assert.equal(payload.cto_worker_agent_soul_source, 'file');
  assert.match(payload.cto_worker_agent_soul_path, /state\/cto-worker-agent-soul\.md$/);
  assert.equal(payload.latest_workflow_session_id, 'cto-20260309-100500-waiting');
  assert.equal(payload.latest_workflow_status, 'waiting');
  assert.equal(payload.latest_workflow_goal, 'Deploy change after confirmation');
  assert.equal(payload.latest_workflow_pending_question, '请确认是否继续发布');
  assert.match(payload.latest_workflow_path, /cto-workflow\.json$/);
  assert.equal(payload.latest_listener_session_id, 'im-20260309-100100-listener');

  const humanStatus = await runCli([
    'service', 'telegram', 'status',
    '--state-dir', stateDir
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });

  assert.equal(humanStatus.code, 0);
  assert.match(humanStatus.stdout, /Show Workflow IDs: off/);
  assert.match(humanStatus.stdout, /Show Paths: off/);
  assert.match(humanStatus.stdout, /Supervisor Loaded: no/);
  assert.match(humanStatus.stdout, /Latest Workflow Status: waiting/);
  assert.doesNotMatch(humanStatus.stdout, /Latest Workflow: cto-/);
  assert.doesNotMatch(humanStatus.stdout, /Latest Listener Session:/);
  assert.doesNotMatch(humanStatus.stdout, /Latest Workflow Path:/);
  assert.doesNotMatch(humanStatus.stdout, /CLI Path:/);
  assert.doesNotMatch(humanStatus.stdout, /CTO Soul Source:/);
  assert.doesNotMatch(humanStatus.stdout, /CTO Soul Path:/);
});

test('service telegram status prefers the recorded workflow artifact path over a stale local fallback file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-service-status-artifact-path-'));
  const cwd = path.join(root, 'repo');
  const stateDir = path.join(root, 'state');
  const launchAgentDir = path.join(root, 'LaunchAgents');
  const applicationsDir = path.join(root, 'Applications');
  const launchctlState = path.join(root, 'launchctl-state.json');
  const launchctl = await writeMockLaunchctl(path.join(root, 'mock-launchctl.js'), launchctlState);

  await mkdir(cwd, { recursive: true });

  await runCli([
    'service', 'telegram', 'install',
    '--allow-project-cli',
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

  await writeSessionFixture(cwd, {
    session_id: 'cto-20260309-100700-shadowed',
    command: 'cto',
    status: 'partial',
    updated_at: '2026-03-09T10:07:30.000Z',
    created_at: '2026-03-09T10:07:00.000Z',
    input: {
      prompt: 'Shadowed workflow',
      arguments: {
        provider: 'telegram'
      }
    },
    summary: {
      title: 'CTO workflow needs follow-up',
      result: 'Shadowed workflow should stay partial.',
      status: 'partial',
      highlights: [],
      next_steps: []
    },
    workflow_state: {
      status: 'running',
      goal_text: 'Shadowed workflow',
      pending_question_zh: '',
      updated_at: '2026-03-09T10:07:30.000Z',
      tasks: [
        {
          id: 'task-1',
          title: 'Shadowed task',
          status: 'running',
          result: '',
          next_steps: [],
          changed_files: [],
          updated_at: '2026-03-09T10:07:30.000Z'
        }
      ]
    }
  });

  const externalArtifactsDir = path.join(root, 'migrated-artifacts');
  const externalWorkflowPath = path.join(externalArtifactsDir, 'shadowed-workflow.json');
  await mkdir(externalArtifactsDir, { recursive: true });
  await writeFile(externalWorkflowPath, JSON.stringify({
    status: 'partial',
    goal_text: 'Shadowed workflow',
    pending_question_zh: '',
    updated_at: '2026-03-09T10:08:00.000Z',
    tasks: [
      {
        id: 'task-1',
        title: 'Shadowed task',
        status: 'partial',
        result: 'Recovered from the recorded artifact path.',
        next_steps: ['Resume from the recovered artifact path.'],
        changed_files: [],
        updated_at: '2026-03-09T10:08:00.000Z'
      }
    ]
  }, null, 2) + '\n', 'utf8');

  const sessionPath = path.join(cwd, '.opencodex', 'sessions', 'cto-20260309-100700-shadowed', 'session.json');
  const session = JSON.parse(await readFile(sessionPath, 'utf8'));
  session.artifacts = (session.artifacts || []).map((artifact) => artifact?.type === 'cto_workflow'
    ? { ...artifact, path: externalWorkflowPath }
    : artifact);
  await writeFile(sessionPath, JSON.stringify(session, null, 2) + '\n', 'utf8');

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
  assert.equal(payload.running_workflow_count, 0);
  assert.equal(payload.waiting_workflow_count, 0);
  assert.equal(payload.running_task_count, 0);
  assert.equal(payload.latest_workflow_session_id, 'cto-20260309-100700-shadowed');
  assert.equal(payload.latest_workflow_status, 'partial');
  assert.equal(payload.latest_workflow_path, externalWorkflowPath);
  assert.equal(payload.latest_workflow_state_path, externalWorkflowPath);
});

test('service telegram workflow-history returns the full workflow history for UI browsing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-service-workflow-history-'));
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
    '--allow-project-cli',
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
    'service', 'telegram', 'workflow-history',
    '--state-dir', stateDir,
    '--json'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });

  assert.equal(history.code, 0);
  const payload = JSON.parse(history.stdout);
  assert.equal(payload.total_count, 3);
  assert.equal(payload.items.length, 3);
  assert.equal(payload.items[0].workflow_session_id, 'cto-20260309-100500-waiting');
  assert.equal(payload.items[0].status, 'waiting');
  assert.equal(payload.items[0].task_total_count, 3);
  assert.equal(payload.items[0].queued_task_count, 2);
  assert.equal(payload.items[0].completed_task_count, 1);
  assert.match(payload.items[0].label, /^\[waiting\]/);
});

test('service telegram workflow-detail returns workflow execution details for UI viewing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-service-workflow-detail-'));
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
    '--allow-project-cli',
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

  const detail = await runCli([
    'service', 'telegram', 'workflow-detail',
    '--state-dir', stateDir,
    '--index', '1',
    '--json'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });

  assert.equal(detail.code, 0);
  const payload = JSON.parse(detail.stdout);
  assert.equal(payload.workflow_session_id, 'cto-20260309-100500-waiting');
  assert.equal(payload.status, 'waiting');
  assert.equal(payload.goal, 'Deploy change after confirmation');
  assert.equal(payload.inferred_intent, 'directive');
  assert.equal(payload.inferred_intent_zh, '执行 / 分析请求');
  assert.match(payload.routing_hint_zh, /执行\/分析型请求/);
  assert.equal(payload.pending_question, '请确认是否继续发布');
  assert.equal(payload.main_thread_session_id, 'im-20260309-100100-listener');
  assert.match(payload.main_thread_session_path, /im-20260309-100100-listener\/session\.json$/);
  assert.equal(payload.thread_kind, 'host_workflow');
  assert.equal(payload.thread_kind_label, 'host workflow');
  assert.equal(payload.session_role, 'cto_supervisor');
  assert.equal(payload.session_contract_source, 'inferred');
  assert.equal(payload.task_counts.total, 3);
  assert.equal(payload.task_counts.queued, 2);
  assert.equal(payload.task_counts.completed, 1);
  assert.equal(payload.tasks.length, 3);
  assert.match(payload.tasks[0].label, /^\[completed\]/);
  assert.equal(payload.tasks[0].thread_kind, 'child_session');
  assert.equal(payload.tasks[0].session_role, 'worker');
  assert.equal(payload.tasks[0].session_contract_source, 'fallback');
  assert.equal(payload.tasks[1].thread_kind, 'host_workflow');
  assert.equal(payload.tasks[1].execution_surface, 'host_workflow');
  assert.equal(payload.tasks[1].session_contract_source, 'fallback');
  assert.match(payload.workflow_state_path, /cto-workflow\.json$/);
  assert.match(payload.session_path, /cto-20260309-100500-waiting\/session\.json$/);
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
    '--allow-project-cli',
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
  assert.equal(payload.execution_surface, 'child_session');
  assert.equal(payload.session_id, 'run-task-2');
  assert.equal(payload.thread_kind, 'child_session');
  assert.equal(payload.thread_kind_label, 'child session');
  assert.equal(payload.session_role, 'worker');
  assert.equal(payload.session_contract_source, 'fallback');
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


test('service telegram surfaces rerouted host-executor tasks in status, history, and detail views', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-service-rerouted-'));
  const cwd = path.join(root, 'repo');
  const stateDir = path.join(root, 'state');
  const launchAgentDir = path.join(root, 'LaunchAgents');
  const applicationsDir = path.join(root, 'Applications');
  const launchctlState = path.join(root, 'launchctl-state.json');
  const launchctl = await writeMockLaunchctl(path.join(root, 'mock-launchctl.js'), launchctlState);

  await mkdir(cwd, { recursive: true });
  await seedWorkflowSessions(cwd);
  const { jobPath } = await seedReroutedWorkflowFixture(cwd, stateDir);

  await runCli([
    'service', 'telegram', 'install',
    '--allow-project-cli',
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
  assert.equal(statusPayload.rerouted_task_count, 1);
  const reroutedIndex = statusPayload.recent_dispatches.findIndex((item) => item.task_id === 'reroute-docs');
  assert.notEqual(reroutedIndex, -1);
  assert.equal(statusPayload.recent_dispatches[reroutedIndex].status, 'rerouted');
  assert.equal(statusPayload.recent_dispatches[reroutedIndex].path, jobPath);
  assert.match(statusPayload.recent_dispatches[reroutedIndex].label, /^\[rerouted\]/);
  assert.equal(statusPayload.recent_dispatches[reroutedIndex].thread_kind, 'host_executor');
  assert.equal(statusPayload.recent_dispatches[reroutedIndex].execution_surface, 'host_executor');
  assert.equal(statusPayload.recent_dispatches[reroutedIndex].session_contract_source, 'fallback');

  const workflowDetail = await runCli([
    'service', 'telegram', 'workflow-detail',
    '--state-dir', stateDir,
    '--index', '1',
    '--json'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });

  assert.equal(workflowDetail.code, 0);
  const workflowPayload = JSON.parse(workflowDetail.stdout);
  assert.equal(workflowPayload.workflow_session_id, 'cto-20260309-101000-rerouted');
  assert.equal(workflowPayload.task_counts.rerouted, 1);
  assert.match(workflowPayload.tasks[0].label, /^\[rerouted\]/);
  assert.equal(workflowPayload.tasks[0].thread_kind, 'host_executor');
  assert.equal(workflowPayload.tasks[0].execution_surface, 'host_executor');
  assert.equal(workflowPayload.tasks[0].session_contract_source, 'fallback');

  const detail = await runCli([
    'service', 'telegram', 'dispatch-detail',
    '--state-dir', stateDir,
    '--index', String(reroutedIndex + 1),
    '--json'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });

  assert.equal(detail.code, 0);
  const detailPayload = JSON.parse(detail.stdout);
  assert.equal(detailPayload.task_id, 'reroute-docs');
  assert.equal(detailPayload.status, 'rerouted');
  assert.equal(detailPayload.execution_surface, 'host_executor');
  assert.equal(detailPayload.thread_kind, 'host_executor');
  assert.equal(detailPayload.thread_kind_label, 'host executor');
  assert.equal(detailPayload.session_contract_source, 'fallback');
  assert.equal(detailPayload.record_path, jobPath);
  assert.equal(detailPayload.session_id, 'run-task-7-source');
  assert.match(detailPayload.result, /host executor queue/);
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
    '--allow-project-cli',
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
    '--allow-project-cli',
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
  const startPayload = JSON.parse(start.stdout);
  assert.equal(startPayload.loaded, true);
  assert.equal(startPayload.supervisor_loaded, true);

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
  assert.equal(setProfilePayload.supervisor_loaded, true);
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
  assert.equal(statusPayload.supervisor_loaded, true);
  assert.equal(statusPayload.state, 'running');
  assert.equal(statusPayload.supervisor_state, 'running');
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
  const stopPayload = JSON.parse(stop.stdout);
  assert.equal(stopPayload.loaded, false);
  assert.equal(stopPayload.supervisor_loaded, false);

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

test('service telegram relink updates the installed launcher away from the project checkout', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-service-relink-'));
  const cwd = path.join(root, 'repo');
  const stateDir = path.join(root, 'state');
  const launchAgentDir = path.join(root, 'LaunchAgents');
  const applicationsDir = path.join(root, 'Applications');
  const launchctlState = path.join(root, 'launchctl-state.json');
  const launchctl = await writeMockLaunchctl(path.join(root, 'mock-launchctl.js'), launchctlState);
  const detachedCli = await writeDetachedCliFixture(path.join(root, 'detached-cli'));

  await mkdir(cwd, { recursive: true });

  await runCli([
    'service', 'telegram', 'install',
    '--allow-project-cli',
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

  const legacyEnvPath = path.join(stateDir, 'telegram.env');
  const legacyEnv = await readFile(legacyEnvPath, 'utf8');
  await writeFile(
    legacyEnvPath,
    legacyEnv
      .split('\n')
      .filter((line) => !line.includes('OPENCODEX_TELEGRAM_SERVICE_MODE'))
      .join('\n'),
    'utf8'
  );

  const relink = await runCli([
    'service', 'telegram', 'relink',
    '--state-dir', stateDir,
    '--cli-path', detachedCli,
    '--json'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });

  assert.equal(relink.code, 0);
  const payload = JSON.parse(relink.stdout);
  assert.equal(payload.action, 'relink');
  assert.equal(payload.launcher_scope, 'installed_cli');
  assert.equal(payload.previous_launcher_scope, 'project_checkout');
  assert.match(payload.cli_path, /detached-cli\/bin\/opencodex\.js$/);

  const config = JSON.parse(await readFile(path.join(stateDir, 'service.json'), 'utf8'));
  const envFile = await readFile(path.join(stateDir, 'telegram.env'), 'utf8');
  const wrapper = await readFile(path.join(stateDir, 'telegram-listener.sh'), 'utf8');
  assert.equal(config.cli_path, payload.cli_path);
  assert.match(envFile, /OPENCODEX_TELEGRAM_SERVICE_MODE='1'/);
  assert.match(wrapper, new RegExp(payload.cli_path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const status = await runCli([
    'service', 'telegram', 'status',
    '--state-dir', stateDir,
    '--json'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });

  assert.equal(status.code, 0);
  assert.equal(JSON.parse(status.stdout).launcher_scope, 'installed_cli');
});

test('service telegram relink preserves a detached current symlink path for future upgrades', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-service-relink-current-'));
  const cwd = path.join(root, 'repo');
  const stateDir = path.join(root, 'state');
  const launchAgentDir = path.join(root, 'LaunchAgents');
  const applicationsDir = path.join(root, 'Applications');
  const launchctlState = path.join(root, 'launchctl-state.json');
  const launchctl = await writeMockLaunchctl(path.join(root, 'mock-launchctl.js'), launchctlState);
  const detachedInstall = await writeDetachedInstallFixture(path.join(root, 'OpenCodex'));

  await mkdir(cwd, { recursive: true });

  await runCli([
    'service', 'telegram', 'install',
    '--allow-project-cli',
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

  const relink = await runCli([
    'service', 'telegram', 'relink',
    '--state-dir', stateDir,
    '--cli-path', detachedInstall.currentCliPath,
    '--json'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });

  assert.equal(relink.code, 0);
  const payload = JSON.parse(relink.stdout);
  assert.equal(payload.action, 'relink');
  assert.equal(payload.launcher_scope, 'installed_cli');
  assert.equal(payload.cli_path, detachedInstall.currentCliPath);

  const config = JSON.parse(await readFile(path.join(stateDir, 'service.json'), 'utf8'));
  const wrapper = await readFile(path.join(stateDir, 'telegram-listener.sh'), 'utf8');
  assert.equal(config.cli_path, detachedInstall.currentCliPath);
  assert.match(wrapper, new RegExp(detachedInstall.currentCliPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(wrapper, new RegExp(detachedInstall.runtimeCliPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

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
  assert.equal(statusPayload.launcher_scope, 'installed_cli');
  assert.equal(statusPayload.cli_path, detachedInstall.currentCliPath);
});

test('service telegram set-workspace migrates the service workspace and preserves the active CTO soul text', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-service-set-workspace-'));
  const cwd = path.join(root, 'repo');
  const nextWorkspace = path.join(root, 'workspace');
  const stateDir = path.join(root, 'state');
  const launchAgentDir = path.join(root, 'LaunchAgents');
  const applicationsDir = path.join(root, 'Applications');
  const launchctlState = path.join(root, 'launchctl-state.json');
  const launchctl = await writeMockLaunchctl(path.join(root, 'mock-launchctl.js'), launchctlState);

  await mkdir(path.join(cwd, 'prompts'), { recursive: true });
  await writeFile(path.join(cwd, 'prompts', 'cto-soul.md'), '# custom\n\n- keep this text\n', 'utf8');
  await seedWorkflowSessions(cwd);

  await runCli([
    'service', 'telegram', 'install',
    '--allow-project-cli',
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
    'service', 'telegram', 'set-workspace',
    '--state-dir', stateDir,
    '--cwd', nextWorkspace,
    '--json'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.action, 'set-workspace');
  assert.equal(payload.previous_cwd, cwd);
  assert.equal(payload.previous_workspace_scope, 'workspace');
  assert.equal(payload.cwd, nextWorkspace);
  assert.equal(payload.workspace_scope, 'workspace');
  assert.equal(payload.workspace_warning, '');
  assert.equal(payload.sessions_migrated, true);
  assert.match(payload.cto_soul_path, /state\/cto-soul\.md$/);

  const config = JSON.parse(await readFile(path.join(stateDir, 'service.json'), 'utf8'));
  const envFile = await readFile(path.join(stateDir, 'telegram.env'), 'utf8');
  const wrapper = await readFile(path.join(stateDir, 'telegram-listener.sh'), 'utf8');
  const plist = await readFile(path.join(launchAgentDir, 'com.opencodex.telegram.cto.plist'), 'utf8');
  const soulText = await readFile(path.join(stateDir, 'cto-soul.md'), 'utf8');
  const chatSoulText = await readFile(path.join(stateDir, 'cto-chat-soul.md'), 'utf8');
  const workflowSoulText = await readFile(path.join(stateDir, 'cto-workflow-soul.md'), 'utf8');
  const replyAgentSoulText = await readFile(path.join(stateDir, 'cto-reply-agent-soul.md'), 'utf8');
  const plannerAgentSoulText = await readFile(path.join(stateDir, 'cto-planner-agent-soul.md'), 'utf8');
  const workerAgentSoulText = await readFile(path.join(stateDir, 'cto-worker-agent-soul.md'), 'utf8');
  assert.equal(config.cwd, nextWorkspace);
  assert.equal(config.cto_soul_path, path.join(stateDir, 'cto-soul.md'));
  assert.equal(config.cto_chat_soul_path, path.join(stateDir, 'cto-chat-soul.md'));
  assert.equal(config.cto_workflow_soul_path, path.join(stateDir, 'cto-workflow-soul.md'));
  assert.equal(config.cto_reply_agent_soul_path, path.join(stateDir, 'cto-reply-agent-soul.md'));
  assert.equal(config.cto_planner_agent_soul_path, path.join(stateDir, 'cto-planner-agent-soul.md'));
  assert.equal(config.cto_worker_agent_soul_path, path.join(stateDir, 'cto-worker-agent-soul.md'));
  assert.match(envFile, /OPENCODEX_CTO_SOUL_PATH='.*state\/cto-soul\.md'/);
  assert.match(wrapper, new RegExp(`--cwd '${nextWorkspace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
  assert.doesNotMatch(wrapper, new RegExp(`--cwd '${cwd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
  assert.match(plist, new RegExp(`<key>WorkingDirectory</key>\\s*<string>${nextWorkspace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</string>`));
  assert.doesNotMatch(plist, new RegExp(`<key>WorkingDirectory</key>\\s*<string>${cwd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</string>`));
  assert.match(soulText, /keep this text/);
  assert.match(chatSoulText, /default control surface/i);
  assert.match(workflowSoulText, /workflow orchestration as a branch/i);
  assert.match(replyAgentSoulText, /direct CEO replies/i);
  assert.match(plannerAgentSoulText, /drafts workflow plans/i);
  assert.match(workerAgentSoulText, /execute concrete subtasks/i);

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
  assert.equal(statusPayload.cwd, nextWorkspace);
  assert.equal(statusPayload.workspace_scope, 'workspace');
  assert.equal(statusPayload.cto_soul_path, path.join(stateDir, 'cto-soul.md'));
  assert.equal(statusPayload.cto_chat_soul_path, path.join(stateDir, 'cto-chat-soul.md'));
  assert.equal(statusPayload.cto_workflow_soul_path, path.join(stateDir, 'cto-workflow-soul.md'));
  assert.equal(statusPayload.cto_reply_agent_soul_path, path.join(stateDir, 'cto-reply-agent-soul.md'));
  assert.equal(statusPayload.cto_planner_agent_soul_path, path.join(stateDir, 'cto-planner-agent-soul.md'));
  assert.equal(statusPayload.cto_worker_agent_soul_path, path.join(stateDir, 'cto-worker-agent-soul.md'));
  assert.equal(statusPayload.workflow_history_count, 3);
  assert.equal(statusPayload.dispatch_history_count, 6);
  assert.match(statusPayload.latest_listener_session_path, new RegExp(`${nextWorkspace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*/\\.opencodex/sessions/`));
  assert.match(statusPayload.latest_workflow_path, new RegExp(`${nextWorkspace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*/\\.opencodex/sessions/`));
  assert.ok(statusPayload.recent_dispatches.every((item) => typeof item.path === 'string' && item.path.includes(`${nextWorkspace}/.opencodex/sessions/`)));
});

test('service telegram reset-cto-soul restores the default Codex-CLI-based template', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-service-reset-cto-soul-'));
  const cwd = path.join(root, 'repo');
  const stateDir = path.join(root, 'state');
  const launchAgentDir = path.join(root, 'LaunchAgents');
  const applicationsDir = path.join(root, 'Applications');
  const launchctlState = path.join(root, 'launchctl-state.json');
  const launchctl = await writeMockLaunchctl(path.join(root, 'mock-launchctl.js'), launchctlState);

  await mkdir(path.join(cwd, 'prompts'), { recursive: true });
  await writeFile(path.join(cwd, 'prompts', 'cto-soul.md'), '# custom\n\n- old content\n', 'utf8');

  await runCli([
    'service', 'telegram', 'install',
    '--allow-project-cli',
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
    'service', 'telegram', 'reset-cto-soul',
    '--state-dir', stateDir,
    '--json'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.action, 'reset-cto-soul');
  assert.equal(payload.cto_soul_source, 'file');
  assert.match(payload.cto_soul_path, /state\/cto-soul\.md$/);
  assert.match(payload.cto_chat_soul_path, /state\/cto-chat-soul\.md$/);
  assert.match(payload.cto_workflow_soul_path, /state\/cto-workflow-soul\.md$/);
  assert.match(payload.cto_reply_agent_soul_path, /state\/cto-reply-agent-soul\.md$/);
  assert.match(payload.cto_planner_agent_soul_path, /state\/cto-planner-agent-soul\.md$/);
  assert.match(payload.cto_worker_agent_soul_path, /state\/cto-worker-agent-soul\.md$/);

  const soulText = await readFile(path.join(stateDir, 'cto-soul.md'), 'utf8');
  const chatSoulText = await readFile(path.join(stateDir, 'cto-chat-soul.md'), 'utf8');
  const workflowSoulText = await readFile(path.join(stateDir, 'cto-workflow-soul.md'), 'utf8');
  const replyAgentSoulText = await readFile(path.join(stateDir, 'cto-reply-agent-soul.md'), 'utf8');
  const plannerAgentSoulText = await readFile(path.join(stateDir, 'cto-planner-agent-soul.md'), 'utf8');
  const workerAgentSoulText = await readFile(path.join(stateDir, 'cto-worker-agent-soul.md'), 'utf8');
  assert.match(soulText, /general-purpose Codex CLI personal assistant persona/);
  assert.match(soulText, /CTO-style orchestrator/);
  assert.doesNotMatch(soulText, /old content/);
  assert.match(chatSoulText, /default control surface/i);
  assert.match(workflowSoulText, /workflow orchestration as a branch/i);
  assert.match(replyAgentSoulText, /direct CEO replies/i);
  assert.match(plannerAgentSoulText, /drafts workflow plans/i);
  assert.match(workerAgentSoulText, /execute concrete subtasks/i);
});

test('service telegram status backfills missing subagent soul files for legacy installs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-service-legacy-subagent-soul-'));
  const cwd = path.join(root, 'repo');
  const stateDir = path.join(root, 'state');
  const launchAgentDir = path.join(root, 'LaunchAgents');
  const applicationsDir = path.join(root, 'Applications');
  const launchctlState = path.join(root, 'launchctl-state.json');
  const launchctl = await writeMockLaunchctl(path.join(root, 'mock-launchctl.js'), launchctlState);

  await mkdir(cwd, { recursive: true });

  await runCli([
    'service', 'telegram', 'install',
    '--allow-project-cli',
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

  const legacyConfigPath = path.join(stateDir, 'service.json');
  const legacyConfig = JSON.parse(await readFile(legacyConfigPath, 'utf8'));
  delete legacyConfig.cto_reply_agent_soul_path;
  delete legacyConfig.cto_planner_agent_soul_path;
  delete legacyConfig.cto_worker_agent_soul_path;
  await writeFile(legacyConfigPath, `${JSON.stringify(legacyConfig, null, 2)}\n`, 'utf8');
  await writeFile(path.join(stateDir, 'cto-reply-agent-soul.md'), '', 'utf8');
  await writeFile(path.join(stateDir, 'cto-planner-agent-soul.md'), '', 'utf8');
  await writeFile(path.join(stateDir, 'cto-worker-agent-soul.md'), '', 'utf8');

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
  assert.equal(payload.cto_reply_agent_soul_source, 'file');
  assert.equal(payload.cto_planner_agent_soul_source, 'file');
  assert.equal(payload.cto_worker_agent_soul_source, 'file');
  assert.equal(payload.cto_reply_agent_soul_path, path.join(stateDir, 'cto-reply-agent-soul.md'));
  assert.equal(payload.cto_planner_agent_soul_path, path.join(stateDir, 'cto-planner-agent-soul.md'));
  assert.equal(payload.cto_worker_agent_soul_path, path.join(stateDir, 'cto-worker-agent-soul.md'));

  const healedConfig = JSON.parse(await readFile(legacyConfigPath, 'utf8'));
  assert.equal(healedConfig.cto_reply_agent_soul_path, path.join(stateDir, 'cto-reply-agent-soul.md'));
  assert.equal(healedConfig.cto_planner_agent_soul_path, path.join(stateDir, 'cto-planner-agent-soul.md'));
  assert.equal(healedConfig.cto_worker_agent_soul_path, path.join(stateDir, 'cto-worker-agent-soul.md'));

  const replyAgentSoulText = await readFile(path.join(stateDir, 'cto-reply-agent-soul.md'), 'utf8');
  const plannerAgentSoulText = await readFile(path.join(stateDir, 'cto-planner-agent-soul.md'), 'utf8');
  const workerAgentSoulText = await readFile(path.join(stateDir, 'cto-worker-agent-soul.md'), 'utf8');
  assert.match(replyAgentSoulText, /direct CEO replies/i);
  assert.match(plannerAgentSoulText, /drafts workflow plans/i);
  assert.match(workerAgentSoulText, /execute concrete subtasks/i);
});

test('service telegram set-setting persists tray settings and exposes them in status', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-service-settings-'));
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
    '--allow-project-cli',
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

  const updated = await runCli([
    'service', 'telegram', 'set-setting',
    '--state-dir', stateDir,
    '--key', 'ui_language',
    '--value', 'zh',
    '--json'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });

  assert.equal(updated.code, 0);
  const updatedPayload = JSON.parse(updated.stdout);
  assert.equal(updatedPayload.action, 'set-setting');
  assert.equal(updatedPayload.setting_key, 'ui_language');
  assert.equal(updatedPayload.setting_value, 'zh');
  assert.equal(updatedPayload.ui_language, 'zh');

  await runCli([
    'service', 'telegram', 'set-setting',
    '--state-dir', stateDir,
    '--key', 'badge_mode',
    '--value', 'workflows'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });
  await runCli([
    'service', 'telegram', 'set-setting',
    '--state-dir', stateDir,
    '--key', 'refresh_interval_seconds',
    '--value', '30'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });
  await runCli([
    'service', 'telegram', 'set-setting',
    '--state-dir', stateDir,
    '--key', 'show_workflow_ids',
    '--value', 'off'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });
  await runCli([
    'service', 'telegram', 'set-setting',
    '--state-dir', stateDir,
    '--key', 'show_paths',
    '--value', 'off'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });
  await runCli([
    'service', 'telegram', 'set-setting',
    '--state-dir', stateDir,
    '--key', 'supervisor_interval_seconds',
    '--value', '300'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });

  const config = JSON.parse(await readFile(path.join(stateDir, 'service.json'), 'utf8'));
  assert.deepEqual(config.settings, {
    ui_language: 'zh',
    badge_mode: 'workflows',
    refresh_interval_seconds: 30,
    show_workflow_ids: false,
    show_paths: false
  });
  assert.equal(config.supervisor_interval_seconds, 300);
  assert.equal(config.supervisor_enabled, true);
  const supervisorPlist = await readFile(path.join(launchAgentDir, 'com.opencodex.telegram.cto.supervisor.plist'), 'utf8');
  assert.match(supervisorPlist, /<key>StartInterval<\/key>\s*<integer>300<\/integer>/);

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
  assert.equal(payload.ui_language, 'zh');
  assert.equal(payload.badge_mode, 'workflows');
  assert.equal(payload.refresh_interval_seconds, 30);
  assert.equal(payload.supervisor_interval_seconds, 300);
  assert.equal(payload.supervisor_enabled, true);
  assert.equal(payload.show_workflow_ids, false);
  assert.equal(payload.show_paths, false);
});

test('service telegram set-setting can disable and re-enable the periodic supervisor agent without stopping the listener', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-service-supervisor-toggle-'));
  const cwd = path.join(root, 'repo');
  const stateDir = path.join(root, 'state');
  const launchAgentDir = path.join(root, 'LaunchAgents');
  const applicationsDir = path.join(root, 'Applications');
  const launchctlState = path.join(root, 'launchctl-state.json');
  const launchctl = await writeMockLaunchctl(path.join(root, 'mock-launchctl.js'), launchctlState);

  await mkdir(cwd, { recursive: true });

  await runCli([
    'service', 'telegram', 'install',
    '--allow-project-cli',
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

  const started = await runCli([
    'service', 'telegram', 'start',
    '--state-dir', stateDir,
    '--json'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });
  const startedPayload = JSON.parse(started.stdout);
  assert.equal(startedPayload.loaded, true);
  assert.equal(startedPayload.supervisor_loaded, true);
  assert.equal(startedPayload.supervisor_enabled, true);

  const disabled = await runCli([
    'service', 'telegram', 'set-setting',
    '--state-dir', stateDir,
    '--key', 'supervisor_enabled',
    '--value', 'off',
    '--json'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });
  assert.equal(disabled.code, 0);
  const disabledPayload = JSON.parse(disabled.stdout);
  assert.equal(disabledPayload.loaded, true);
  assert.equal(disabledPayload.supervisor_enabled, false);
  assert.equal(disabledPayload.supervisor_loaded, false);
  assert.equal(disabledPayload.supervisor_state, 'disabled');

  const configAfterDisable = JSON.parse(await readFile(path.join(stateDir, 'service.json'), 'utf8'));
  assert.equal(configAfterDisable.supervisor_enabled, false);

  const enabled = await runCli([
    'service', 'telegram', 'set-setting',
    '--state-dir', stateDir,
    '--key', 'supervisor_enabled',
    '--value', 'on',
    '--json'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState
  });
  assert.equal(enabled.code, 0);
  const enabledPayload = JSON.parse(enabled.stdout);
  assert.equal(enabledPayload.loaded, true);
  assert.equal(enabledPayload.supervisor_enabled, true);
  assert.equal(enabledPayload.supervisor_loaded, true);
  assert.equal(enabledPayload.supervisor_state, 'running');

  const configAfterEnable = JSON.parse(await readFile(path.join(stateDir, 'service.json'), 'utf8'));
  assert.equal(configAfterEnable.supervisor_enabled, true);
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
    '--allow-project-cli',
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
  assert.match(telegram.state.sentMessages[0].text, /任务：running 1 \/ rerouted 0 \/ queued 2/);
  assert.match(telegram.state.sentMessages[0].text, /线程：主活跃 1 \/ 子活跃 1 \/ 子累计 5/);
  assert.match(telegram.state.sentMessages[0].text, /最近工作流状态：waiting/);
  assert.match(telegram.state.sentMessages[0].text, /Deploy change after confirmation/);
  assert.doesNotMatch(telegram.state.sentMessages[0].text, /cto-20260309-100500-waiting/);

  await telegram.close();
});

test('service telegram supervise runs a one-shot host supervisor tick from the installed service config', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-service-supervise-'));
  const cwd = path.join(root, 'repo');
  const stateDir = path.join(root, 'state');
  const launchAgentDir = path.join(root, 'LaunchAgents');
  const applicationsDir = path.join(root, 'Applications');
  const launchctlState = path.join(root, 'launchctl-state.json');
  const launchctl = await writeMockLaunchctl(path.join(root, 'mock-launchctl.js'), launchctlState);
  const telegram = await startTelegramMockServer({ updates: [] });

  await mkdir(cwd, { recursive: true });

  await runCli([
    'service', 'telegram', 'install',
    '--allow-project-cli',
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

  await writeSessionFixture(cwd, {
    session_id: 'run-supervise-slow',
    command: 'run',
    status: 'completed',
    created_at: '2026-03-12T08:20:00.000Z',
    updated_at: '2026-03-12T08:20:01.000Z',
    input: {
      prompt: 'Slow task',
      arguments: {
        profile: 'full-access'
      }
    },
    summary: {
      title: 'Mock slow task completed',
      result: 'The mock slow worker finished successfully.',
      status: 'completed',
      highlights: ['Slow mock task completed.'],
      next_steps: [],
      risks: [],
      validation: [],
      changed_files: ['src/mock-slow.js'],
      findings: []
    }
  });

  await writeSessionFixture(cwd, {
    session_id: 'cto-20260312-082000-supervise',
    command: 'cto',
    status: 'running',
    created_at: '2026-03-12T08:20:00.000Z',
    updated_at: '2026-03-12T08:20:01.000Z',
    input: {
      prompt: 'restart chain',
      arguments: {
        provider: 'telegram',
        chat_id: '1379564094'
      }
    },
    child_sessions: [
      {
        session_id: 'run-supervise-slow',
        label: 'Task slow-task · 阿岚',
        task_id: 'slow-task',
        session_contract: {
          schema: 'opencodex/session-contract/v1',
          layer: 'child',
          thread_kind: 'child_session',
          role: 'worker',
          scope: 'telegram_cto',
          supervisor_session_id: 'cto-20260312-082000-supervise'
        }
      }
    ],
    summary: {
      title: 'CTO workflow running',
      result: 'Workflow is running with 1 active task(s).',
      status: 'running',
      highlights: [],
      next_steps: []
    },
    workflow_state: {
      workflow_session_id: 'cto-20260312-082000-supervise',
      source_message_id: 911,
      source_update_id: 511,
      chat_id: '1379564094',
      sender_display: 'Li Jianqian',
      goal_text: 'restart chain',
      status: 'running',
      pending_question_zh: '',
      created_at: '2026-03-12T08:20:00.000Z',
      updated_at: '2026-03-12T08:20:01.000Z',
      task_counter: 2,
      user_messages: [
        {
          provider: 'telegram',
          update_id: 511,
          message_id: 911,
          created_at: '2026-03-12T08:20:00.000Z',
          chat_id: '1379564094',
          sender_display: 'Li Jianqian',
          text: 'restart chain'
        }
      ],
      tasks: [
        {
          id: 'slow-task',
          title: 'Slow task',
          worker_prompt: 'MOCK_WORKER slow-500',
          depends_on: [],
          status: 'running',
          session_id: 'run-supervise-slow',
          summary_status: '',
          result: '',
          next_steps: [],
          changed_files: [],
          updated_at: '2026-03-12T08:20:01.000Z'
        },
        {
          id: 'fast-task',
          title: 'Fast task',
          worker_prompt: 'MOCK_WORKER fast',
          depends_on: ['slow-task'],
          status: 'queued',
          session_id: '',
          summary_status: '',
          result: '',
          next_steps: [],
          changed_files: [],
          updated_at: '2026-03-12T08:20:01.000Z'
        }
      ]
    }
  });

  const result = await runCli([
    'service', 'telegram', 'supervise',
    '--state-dir', stateDir,
    '--json'
  ], {
    OPENCODEX_LAUNCHCTL_BIN: launchctl,
    OPENCODEX_MOCK_LAUNCHCTL_STATE: launchctlState,
    OPENCODEX_TELEGRAM_API_BASE_URL: telegram.baseUrl,
    OPENCODEX_CODEX_BIN: path.resolve('tests/fixtures/mock-codex.js')
  });

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.action, 'supervise');
  assert.equal(payload.supervised, true);
  assert.match(payload.supervisor_session_id, /^im-/);
  assert.equal(payload.latest_supervisor_session_id, payload.supervisor_session_id);
  assert.equal(payload.latest_supervisor_status, 'completed');
  assert.equal(payload.running_workflow_count, 0);
  assert.equal(payload.waiting_workflow_count, 0);
  assert.equal(payload.latest_workflow_status, 'completed');
  assert.ok(telegram.state.sentMessages.some((message) => message.reply_to_message_id === 911 && /已经处理完了。/.test(message.text)));

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
    '--allow-project-cli',
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
  assert.match(scriptSource, /Open Workspace/);
  assert.match(scriptSource, /Open Latest Workflow/);
  assert.match(scriptSource, /Edit CTO Soul/);
  assert.match(scriptSource, /Edit CTO Chat Soul/);
  assert.match(scriptSource, /Edit CTO Workflow Soul/);
  assert.match(scriptSource, /Edit Reply Agent Soul/);
  assert.match(scriptSource, /Edit Planner Agent Soul/);
  assert.match(scriptSource, /Edit Worker Agent Soul/);
  assert.match(scriptSource, /Restore Default CTO Soul/);
  assert.match(scriptSource, /workspacePath/);
  assert.match(scriptSource, /openCtoSoul_/);
  assert.match(scriptSource, /openCtoChatSoul_/);
  assert.match(scriptSource, /openCtoWorkflowSoul_/);
  assert.match(scriptSource, /openReplyAgentSoul_/);
  assert.match(scriptSource, /openPlannerAgentSoul_/);
  assert.match(scriptSource, /openWorkerAgentSoul_/);
  assert.match(scriptSource, /resetCtoSoul_/);
  assert.match(scriptSource, /ctoSoulPath/);
  assert.match(scriptSource, /ctoChatSoulPath/);
  assert.match(scriptSource, /ctoWorkflowSoulPath/);
  assert.match(scriptSource, /ctoReplyAgentSoulPath/);
  assert.match(scriptSource, /ctoPlannerAgentSoulPath/);
  assert.match(scriptSource, /ctoWorkerAgentSoulPath/);
  assert.match(scriptSource, /open " & quoted form of ctoSoulPath/);
  assert.match(scriptSource, /open " & quoted form of ctoChatSoulPath/);
  assert.match(scriptSource, /open " & quoted form of ctoWorkflowSoulPath/);
  assert.match(scriptSource, /open " & quoted form of ctoReplyAgentSoulPath/);
  assert.match(scriptSource, /open " & quoted form of ctoPlannerAgentSoulPath/);
  assert.match(scriptSource, /open " & quoted form of ctoWorkerAgentSoulPath/);
  assert.match(scriptSource, /runServiceCommand\("reset-cto-soul"\)/);
  assert.match(scriptSource, /Restore the default Codex-CLI-based CTO soul templates/);
  assert.match(scriptSource, /Send Status Reply/);
  assert.match(scriptSource, /Run Supervisor Tick/);
  assert.match(scriptSource, /Supervisor/);
  assert.match(scriptSource, /Supervisor Interval:/);
  assert.match(scriptSource, /Running Workflows:/);
  assert.match(scriptSource, /Running Tasks:/);
  assert.match(scriptSource, /Rerouted Tasks:/);
  assert.match(scriptSource, /Recent Dispatches/);
  assert.match(scriptSource, /openDispatch1_/);
  assert.match(scriptSource, /dispatch-detail --index/);
  assert.match(scriptSource, /workflow-history --state-dir/);
  assert.match(scriptSource, /workflow-detail --index/);
  assert.match(scriptSource, /task-history --state-dir/);
  assert.match(scriptSource, /Browse Workflows/);
  assert.match(scriptSource, /Browse Tasks/);
  assert.match(scriptSource, /browseWorkflowHistory_/);
  assert.match(scriptSource, /openWorkflowRecord/);
  assert.match(scriptSource, /Open Main Thread/);
  assert.match(scriptSource, /打开主聊天线程/);
  assert.match(scriptSource, /openWorkflowMainThread/);
  assert.match(scriptSource, /Settings…/);
  assert.match(scriptSource, /openSettings_/);
  assert.match(scriptSource, /statusOverviewText/);
  assert.match(scriptSource, /browseStatusSections/);
  assert.match(scriptSource, /statusSectionNames/);
  assert.match(scriptSource, /Select a status section/);
  assert.match(scriptSource, /Use Sections for more details/);
  assert.match(scriptSource, /set summaryLines to \{\}/);
  assert.doesNotMatch(scriptSource, /set lines to \{\}/);
  assert.doesNotMatch(scriptSource, /display dialog responseText buttons \{"OK"\}/);
  assert.match(scriptSource, /choose from list historyItems/);
  assert.match(scriptSource, /UI Language:/);
  assert.match(scriptSource, /Badge Mode:/);
  assert.match(scriptSource, /Refresh Interval:/);
  assert.match(scriptSource, /Supervisor Enabled:/);
  assert.match(scriptSource, /Supervisor Interval:/);
  assert.match(scriptSource, /Show Workflow IDs:/);
  assert.match(scriptSource, /Workflow History:/);
  assert.match(scriptSource, /Show Paths:/);
  assert.match(scriptSource, /localizedText/);
  assert.match(scriptSource, /runSettingCommand/);
  assert.match(scriptSource, /service telegram set-setting --key/);
  assert.match(scriptSource, /chooseSupervisorInterval/);
  assert.match(scriptSource, /chooseSupervisorEnabled/);
  assert.match(scriptSource, /supervisor_enabled/);
  assert.match(scriptSource, /supervisor_interval_seconds/);
  assert.match(scriptSource, /set actionButtons to \{/);
  assert.match(scriptSource, /browseDispatchSections/);
  assert.match(scriptSource, /browseDispatchArtifacts/);
  assert.match(scriptSource, /browseWorkflowSections/);
  assert.match(scriptSource, /browseWorkflowArtifacts/);
  assert.match(scriptSource, /dispatchSummaryText/);
  assert.match(scriptSource, /dispatchSectionNames/);
  assert.match(scriptSource, /dispatchSectionText/);
  assert.match(scriptSource, /workflowSummaryText/);
  assert.match(scriptSource, /workflowSectionNames/);
  assert.match(scriptSource, /workflowSectionText/);
  assert.match(scriptSource, /choose from list sectionNames/);
  assert.match(scriptSource, /choose from list artifactChoices/);
  assert.match(scriptSource, /Record — /);
  assert.match(scriptSource, /Events — /);
  assert.match(scriptSource, /Last Message — /);
  assert.doesNotMatch(scriptSource, /Open Message/);
  assert.match(scriptSource, /Active Main Threads:/);
  assert.match(scriptSource, /Active Child Threads:/);
  assert.match(scriptSource, /Child Sessions:/);
  assert.match(scriptSource, /localizedText\(statusText, "Threads", "线程"\)/);
  assert.match(scriptSource, /localizedText\(statusText, "main active", "主活跃"\)/);
  assert.match(scriptSource, /runningTaskCount/);
  assert.match(scriptSource, /totalChildCount/);
  assert.match(scriptSource, /service telegram send-status/);
  assert.match(scriptSource, /my runServiceCommand\("supervise"\)/);
  assert.match(scriptSource, /OC⚡/);
});

async function writeDetachedCliFixture(rootDir) {
  const packageDir = path.resolve(rootDir);
  const binDir = path.join(packageDir, 'bin');
  const cliPath = path.join(binDir, 'opencodex.js');
  await mkdir(binDir, { recursive: true });
  await writeFile(path.join(packageDir, 'package.json'), JSON.stringify({
    name: 'opencodex',
    version: '0.1.0'
  }, null, 2), 'utf8');
  await writeFile(cliPath, '#!/usr/bin/env node\nconsole.log("detached opencodex");\n', 'utf8');
  return cliPath;
}

async function writeDetachedInstallFixture(rootDir) {
  const installRoot = path.resolve(rootDir);
  const runtimeDir = path.join(installRoot, 'installs', '0.1.0-test');
  const runtimeBinDir = path.join(runtimeDir, 'bin');
  const runtimeCliPath = path.join(runtimeBinDir, 'opencodex.js');
  const currentPath = path.join(installRoot, 'current');
  const currentCliPath = path.join(currentPath, 'bin', 'opencodex.js');

  await mkdir(runtimeBinDir, { recursive: true });
  await writeFile(path.join(runtimeDir, 'package.json'), JSON.stringify({
    name: 'opencodex',
    version: '0.1.0'
  }, null, 2), 'utf8');
  await writeFile(runtimeCliPath, '#!/usr/bin/env node\nconsole.log("detached opencodex");\n', 'utf8');
  await symlink(path.relative(installRoot, runtimeDir), currentPath);

  return {
    runtimeCliPath,
    currentCliPath
  };
}

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


async function seedReroutedWorkflowFixture(cwd, stateDir) {
  const hostJobsDir = path.join(stateDir, 'host-executor', 'jobs');
  const jobPath = path.join(hostJobsDir, 'host-20260309-reroute.json');
  await mkdir(hostJobsDir, { recursive: true });

  await writeSessionFixture(cwd, {
    session_id: 'run-task-7-source',
    command: 'run',
    status: 'failed',
    updated_at: '2026-03-09T10:09:58.000Z',
    created_at: '2026-03-09T10:09:50.000Z',
    input: {
      prompt: 'Reroute docs audit',
      arguments: {
        profile: 'full-access'
      }
    },
    summary: {
      title: 'Run blocked by host sandbox',
      result: 'Requested full-access, but the effective host sandbox stayed read-only.',
      status: 'failed',
      highlights: ['Host sandbox mismatch detected.'],
      next_steps: [],
      validation: ['sandbox_detection:env'],
      changed_files: [],
      findings: []
    },
    events: [
      JSON.stringify({ type: 'turn.started', message: 'Started reroute docs audit.' }),
      JSON.stringify({ type: 'turn.completed', message: 'Run blocked by host sandbox.' })
    ],
    last_message: 'Run blocked by host sandbox.'
  });

  await writeSessionFixture(cwd, {
    session_id: 'cto-20260309-101000-rerouted',
    command: 'cto',
    status: 'running',
    updated_at: '2026-03-09T10:10:00.000Z',
    created_at: '2026-03-09T10:10:00.000Z',
    input: {
      prompt: 'Handle sandbox reroute',
      arguments: {
        provider: 'telegram'
      }
    },
    child_sessions: [
      { session_id: 'run-task-7-source' }
    ],
    summary: {
      title: 'CTO workflow running',
      result: 'Workflow is running with 0 active task(s) and 1 rerouted host-executor task(s).',
      status: 'running',
      highlights: [],
      next_steps: []
    },
    workflow_state: {
      status: 'running',
      goal_text: 'Handle sandbox reroute',
      pending_question_zh: '',
      updated_at: '2026-03-09T10:10:00.000Z',
      tasks: [
        {
          id: 'reroute-docs',
          title: 'Reroute docs audit',
          status: 'running',
          session_id: 'run-task-7-source',
          summary_status: 'rerouted',
          result: '已检测到当前 worker 所在环境的宿主沙箱更严格，任务已自动转入 host executor queue，CTO 主线程会继续跟踪并在完成后主动汇报。',
          next_steps: [],
          changed_files: [],
          reroute_job_id: 'host-20260309-reroute',
          reroute_record_path: jobPath,
          updated_at: '2026-03-09T10:10:00.000Z'
        }
      ]
    }
  });

  await writeFile(jobPath, JSON.stringify({
    job_id: 'host-20260309-reroute',
    kind: 'telegram_cto_task',
    status: 'pending',
    created_at: '2026-03-09T10:09:59.000Z',
    updated_at: '2026-03-09T10:10:00.000Z',
    cwd,
    workflow_session_id: 'cto-20260309-101000-rerouted',
    parent_session_id: 'cto-20260309-101000-rerouted',
    task_id: 'reroute-docs',
    task_title: 'Reroute docs audit',
    profile: 'full-access',
    prompt: 'MOCK_WORKER inspect-repo',
    output_path: path.join(cwd, '.opencodex', 'sessions', 'run-task-7-source', 'artifacts', 'telegram-task-reroute-docs.json'),
    source_session_id: 'run-task-7-source',
    source_summary: {
      title: 'Run blocked by host sandbox',
      result: 'Requested full-access, but the effective host sandbox stayed read-only.',
      status: 'failed',
      highlights: ['Host sandbox mismatch detected.'],
      next_steps: [],
      validation: ['sandbox_detection:env'],
      changed_files: [],
      findings: []
    },
    host_session_id: '',
    host_session_path: '',
    result_summary: null,
    error_message: '',
    attempt_count: 1,
    record_path: jobPath
  }, null, 2) + '\n', 'utf8');

  return { jobPath };
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
    },
    child_sessions: [
      { session_id: 'cto-20260309-100300-running' },
      { session_id: 'cto-20260309-100500-waiting' },
      { session_id: 'cto-20260309-095900-completed' }
    ]
  });

  await writeSessionFixture(cwd, {
    session_id: 'cto-20260309-100300-running',
    command: 'cto',
    parent_session_id: 'im-20260309-100100-listener',
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
    parent_session_id: 'im-20260309-100100-listener',
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
      title: 'CTO workflow needs follow-up',
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
    parent_session_id: 'im-20260309-100100-listener',
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
    parent_session_id: fixture.parent_session_id || undefined,
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
