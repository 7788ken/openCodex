import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const cli = path.resolve('bin/opencodex.js');

test('island status aggregates sessions across known workspaces and prioritizes waiting focus', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-island-status-'));
  const homeDir = path.join(root, 'home');
  const repoA = path.join(root, 'repo-a');
  const repoB = path.join(homeDir, '.opencodex', 'workspaces', 'client-b');

  await mkdir(repoA, { recursive: true });
  await mkdir(repoB, { recursive: true });

  await writeSessionFixture(repoA, {
    session_id: 'run-20260329-100000-active',
    command: 'run',
    status: 'running',
    created_at: '2026-03-29T10:00:00.000Z',
    updated_at: '2099-03-29T10:02:00.000Z',
    input: {
      prompt: 'Inspect repo A changes',
      arguments: { profile: 'full-access' }
    },
    summary: {
      title: 'Inspect repo A changes',
      result: 'Inspecting repo A.',
      status: 'running',
      highlights: [],
      next_steps: []
    }
  });

  await writeSessionFixture(repoB, {
    session_id: 'cto-20260329-100500-waiting',
    command: 'cto',
    status: 'partial',
    created_at: '2026-03-29T10:05:00.000Z',
    updated_at: '2099-03-29T10:06:00.000Z',
    input: {
      prompt: 'Decide whether to ship repo B',
      arguments: { provider: 'telegram' }
    },
    summary: {
      title: 'CTO workflow needs follow-up',
      result: 'Waiting for a shipping decision.',
      status: 'partial',
      highlights: [],
      next_steps: []
    },
    workflow_state: {
      status: 'waiting_for_user',
      goal_text: 'Decide whether to ship repo B',
      pending_question_zh: '请确认是否继续发布 repo B',
      updated_at: '2099-03-29T10:06:00.000Z',
      tasks: [
        { id: 'prep', title: 'Prepare release', status: 'completed', updated_at: '2099-03-29T10:05:20.000Z' },
        { id: 'ship', title: 'Ship release', status: 'queued', updated_at: '2099-03-29T10:06:00.000Z' }
      ]
    }
  });

  const result = await runCli([
    'island', 'status',
    '--cwd', repoA,
    '--home-dir', homeDir,
    '--json'
  ], {
    HOME: homeDir,
    OPENCODEX_WORKSPACE_REGISTRY_PATH: path.join(homeDir, '.opencodex', 'workspace-registry.json')
  });

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.state, 'attention');
  assert.equal(payload.counts.workspaces_count, 2);
  assert.equal(payload.counts.waiting_count, 1);
  assert.equal(payload.counts.running_count, 1);
  assert.equal(payload.focus.session_id, 'cto-20260329-100500-waiting');
  assert.equal(payload.focus.display_status, 'waiting');
  assert.equal(payload.focus.pending_question, '请确认是否继续发布 repo B');
  assert.equal(payload.pending_messages.length, 1);
  assert.equal(payload.pending_messages[0].session_id, 'cto-20260329-100500-waiting');
  assert.equal(payload.pending_messages[0].workspace_cwd, repoB);
  assert.match(payload.title, /Codex/);
  assert.match(payload.detail, /请确认是否继续发布 repo B/);
});

test('island install writes a native overlay app bundle and generated swift source', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-island-install-'));
  const homeDir = path.join(root, 'home');
  const applicationsDir = path.join(homeDir, 'Applications');
  const swiftc = await writeMockSwiftc(path.join(root, 'mock-swiftc.js'));

  await mkdir(applicationsDir, { recursive: true });

  const result = await runCli([
    'island', 'install',
    '--home-dir', homeDir,
    '--applications-dir', applicationsDir,
    '--json'
  ], {
    HOME: homeDir,
    OPENCODEX_SWIFTC_BIN: swiftc,
    OPENCODEX_WORKSPACE_REGISTRY_PATH: path.join(homeDir, '.opencodex', 'workspace-registry.json')
  });

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  const source = await readFile(payload.source_path, 'utf8');
  const infoPlist = await readFile(payload.info_plist_path, 'utf8');
  const binary = await readFile(payload.binary_path, 'utf8');

  assert.match(payload.app_path, /OpenCodex Island\.app$/);
  assert.match(source, /import AppKit/);
  assert.match(source, /NSWindow/);
  assert.match(source, /final class IslandPanelView: NSView/);
  assert.match(source, /struct IslandPendingMessage: Decodable/);
  assert.match(source, /pending_messages: \[IslandPendingMessage\]/);
  assert.match(source, /MessageRowView/);
  assert.match(source, /notchGap/);
  assert.match(source, /NSTextField\(labelWithString: ""\)/);
  assert.match(source, /NSStackView/);
  assert.match(source, /island", "status", "--json"/);
  assert.match(source, /NSApp\.setActivationPolicy\(\.regular\)/);
  assert.match(source, /NSApp\.setActivationPolicy\(\.accessory\)/);
  assert.match(source, /DispatchQueue\.main\.asyncAfter/);
  assert.match(source, /orderFrontRegardless/);
  assert.match(source, /styleMask: \[\.borderless\]/);
  assert.match(source, /pending_messages: \[\]/);
  assert.doesNotMatch(source, /NSApp\.activate\(ignoringOtherApps: true\)/);
  assert.match(source, /NSWindow\.Level\.floating/);
  assert.match(source, /preferredAnchorScreen/);
  assert.match(source, /hasMenuBarInset/);
  assert.match(source, /NSEvent\.mouseLocation/);
  assert.match(source, /effectiveAppearance\.bestMatch/);
  assert.match(source, /NSColor\.black/);
  assert.match(source, /NSColor\.white/);
  assert.match(infoPlist, /OpenCodex Island/);
  assert.doesNotMatch(infoPlist, /LSUIElement/);
  assert.match(binary, /mock swift binary/);
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

async function writeMockSwiftc(filePath) {
  const source = `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const outputIndex = args.indexOf('-o');
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : '';
if (!outputPath) {
  console.error('missing -o binary path');
  process.exit(1);
}
mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, '#!/bin/sh\\necho mock swift binary\\n');
process.exit(0);
`;
  await writeFile(filePath, source, { mode: 0o755 });
  return filePath;
}
