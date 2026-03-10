import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const fixture = path.resolve('tests/fixtures/mock-codex.js');
const cli = path.resolve('bin/opencodex.js');

test('doctor emits structured json with passing core checks', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-doctor-'));
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'opencodex-doctor-home-clean-'));
  const result = await runCli(['doctor', '--json', '--cwd', cwd], {
    OPENCODEX_CODEX_BIN: fixture,
    HOME: homeDir
  });

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.summary.status, 'partial');
  assert.ok(payload.checks.some((check) => check.name === 'codex_cli' && check.status === 'pass'));
  assert.ok(payload.checks.some((check) => check.name === 'codex_login' && check.status === 'pass'));
  assert.ok(payload.checks.some((check) => check.name === 'opencodex_launcher' && check.status === 'warn'));
  assert.ok(payload.checks.some((check) => check.name === 'telegram_service_launcher' && check.status === 'pass'));
  assert.ok(payload.checks.some((check) => check.name === 'telegram_service_workspace' && check.status === 'pass'));
});

test('doctor warns when the installed Telegram service is still bound to a source checkout', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-doctor-service-'));
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'opencodex-doctor-home-'));
  const serviceDir = path.join(homeDir, '.opencodex', 'service', 'telegram');
  await mkdir(serviceDir, { recursive: true });
  await writeFile(path.join(serviceDir, 'service.json'), JSON.stringify({
    cli_path: cli,
    node_path: process.execPath,
    cwd
  }, null, 2), 'utf8');

  const result = await runCli(['doctor', '--json', '--cwd', cwd], {
    OPENCODEX_CODEX_BIN: fixture,
    HOME: homeDir
  });

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  const serviceCheck = payload.checks.find((check) => check.name === 'telegram_service_launcher');
  const workspaceCheck = payload.checks.find((check) => check.name === 'telegram_service_workspace');
  assert.equal(serviceCheck?.status, 'warn');
  assert.equal(workspaceCheck?.status, 'pass');
  assert.match(serviceCheck?.details || '', /bound to a source checkout/);
  assert.match(workspaceCheck?.details || '', /service workspace/);
  assert.ok(payload.summary.next_steps.some((step) => step.includes('Reinstall or relink the Telegram service')));
});

test('doctor warns when the installed Telegram service workspace still points at the development checkout', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-doctor-workspace-'));
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'opencodex-doctor-home-workspace-'));
  const serviceDir = path.join(homeDir, '.opencodex', 'service', 'telegram');
  await mkdir(serviceDir, { recursive: true });
  await writeFile(path.join(serviceDir, 'service.json'), JSON.stringify({
    cli_path: path.join(homeDir, 'Library', 'Application Support', 'OpenCodex', 'current', 'bin', 'opencodex.js'),
    node_path: process.execPath,
    cwd: path.resolve('.')
  }, null, 2), 'utf8');

  const result = await runCli(['doctor', '--json', '--cwd', cwd], {
    OPENCODEX_CODEX_BIN: fixture,
    HOME: homeDir
  });

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  const workspaceCheck = payload.checks.find((check) => check.name === 'telegram_service_workspace');
  assert.equal(workspaceCheck?.status, 'warn');
  assert.match(workspaceCheck?.details || '', /development checkout/);
  assert.ok(payload.summary.next_steps.some((step) => step.includes('set-workspace')));
});

test('doctor recommends the installed CLI or app when a detached install already exists', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-doctor-installed-'));
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'opencodex-doctor-home-installed-'));
  const installRoot = path.join(homeDir, 'Library', 'Application Support', 'OpenCodex');
  const currentCliPath = path.join(installRoot, 'current', 'bin', 'opencodex.js');
  const shimPath = path.join(homeDir, '.local', 'bin', 'opencodex');
  const appInfoPlist = path.join(homeDir, 'Applications', 'OpenCodex.app', 'Contents', 'Info.plist');

  await mkdir(path.dirname(currentCliPath), { recursive: true });
  await mkdir(path.dirname(shimPath), { recursive: true });
  await mkdir(path.dirname(appInfoPlist), { recursive: true });
  await writeFile(currentCliPath, '#!/usr/bin/env node\n', 'utf8');
  await writeFile(shimPath, '#!/bin/zsh\n', 'utf8');
  await writeFile(appInfoPlist, '<plist version="1.0"><dict></dict></plist>', 'utf8');

  const result = await runCli(['doctor', '--json', '--cwd', cwd], {
    OPENCODEX_CODEX_BIN: fixture,
    HOME: homeDir
  });

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  const launcherStep = payload.summary.next_steps.find((step) => step.includes('detached openCodex launcher'));
  assert.match(launcherStep || '', /Applications\/OpenCodex\.app/);
  assert.match(launcherStep || '', /\.local\/bin\/opencodex/);
  assert.doesNotMatch(launcherStep || '', /install detached/);
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
