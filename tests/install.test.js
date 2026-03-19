import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { access, lstat, mkdtemp, mkdir, readFile, realpath, symlink, utimes, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const cli = path.resolve('bin/opencodex.js');
const bootstrapScript = path.resolve('scripts/install-opencodex.sh');

test('install detached creates a versioned runtime, CLI shim, and app shell', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-install-'));
  const installRoot = path.join(root, 'OpenCodex');
  const binDir = path.join(root, 'bin');
  const applicationsDir = path.join(root, 'Applications');
  const osacompile = await writeMockOsacompile(path.join(root, 'mock-osacompile.js'));

  const result = await runCli([
    'install', 'detached',
    '--root', installRoot,
    '--bin-dir', binDir,
    '--applications-dir', applicationsDir,
    '--name', 'test-runtime',
    '--json'
  ], {
    OPENCODEX_OSACOMPILE_BIN: osacompile
  });

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.installed, true);
  assert.equal(payload.install_name, 'test-runtime');
  assert.equal(payload.source_scope, 'project_checkout');
  assert.equal(payload.launcher_scope, 'installed_cli');
  assert.match(payload.runtime_path, /installs\/test-runtime$/);
  assert.match(payload.current_cli_path, /current\/bin\/opencodex\.js$/);
  assert.match(payload.runtime_cli_path, /installs\/test-runtime\/bin\/opencodex\.js$/);
  assert.match(payload.shim_path, /bin\/opencodex$/);
  assert.equal(payload.app_installed, true);
  assert.match(payload.app_path, /Applications\/OpenCodex\.app$/);
  assert.match(payload.app_source_path, /OpenCodex\.applescript$/);
  assert.match(payload.next_steps.at(-1) || '', /service telegram relink --cli-path '.*current\/bin\/opencodex\.js'/);

  const shim = await readFile(payload.shim_path, 'utf8');
  const appScript = await readFile(payload.app_source_path, 'utf8');
  const infoPlist = await readFile(path.join(payload.app_path, 'Contents', 'Info.plist'), 'utf8');
  assert.match(shim, /exec \/usr\/bin\/env node/);
  assert.match(shim, /current\/bin\/opencodex\.js/);
  assert.match(appScript, /property cliPath : ".*current\/bin\/opencodex\.js"/);
  assert.match(appScript, /Run Task…/);
  assert.match(appScript, /Review Folder…/);
  assert.match(appScript, /Install Status/);
  assert.match(appScript, /Open Sessions/);
  assert.match(appScript, /Open Install Root/);
  assert.match(appScript, /Open Tray/);
  assert.match(appScript, /review --uncommitted/);
  assert.match(appScript, /run " & quoted form of taskText/);
  assert.match(appScript, /install status/);
  assert.match(appScript, /OpenCodex Tray\.app/);
  assert.match(infoPlist, /LSMinimumSystemVersionByArchitecture[\s\S]*<\/dict>\s*<key>CFBundleIdentifier<\/key>/);
  assert.match(infoPlist, /CFBundleIdentifier/);
  assert.match(infoPlist, /com\.opencodex\.app/);

  const copiedPackage = JSON.parse(await readFile(path.join(payload.runtime_path, 'package.json'), 'utf8'));
  assert.equal(copiedPackage.name, 'opencodex');
  await access(path.join(payload.runtime_path, 'src', 'main.js'));
});

test('install detached can link the current checkout for development', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-install-linked-'));
  const installRoot = path.join(root, 'OpenCodex');
  const binDir = path.join(root, 'bin');
  const applicationsDir = path.join(root, 'Applications');
  const osacompile = await writeMockOsacompile(path.join(root, 'mock-osacompile.js'));

  const result = await runCli([
    'install', 'detached',
    '--root', installRoot,
    '--bin-dir', binDir,
    '--applications-dir', applicationsDir,
    '--name', 'linked-runtime',
    '--link-source',
    '--json'
  ], {
    OPENCODEX_OSACOMPILE_BIN: osacompile
  });

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.install_name, 'linked-runtime');
  assert.equal(payload.install_source, 'source_link');
  assert.equal(payload.linked_source, true);
  assert.equal(payload.source_scope, 'project_checkout');
  assert.equal(payload.launcher_scope, 'project_checkout');
  assert.match(payload.runtime_path, /installs\/linked-runtime$/);
  assert.match(payload.current_cli_path, /current\/bin\/opencodex\.js$/);
  assert.ok((payload.next_steps[3] || '').includes('Source edits take effect immediately'));

  const runtimeStats = await lstat(payload.runtime_path);
  assert.equal(runtimeStats.isSymbolicLink(), true);
  assert.equal(await realpath(payload.runtime_path), path.resolve('.'));

  const status = await runCli([
    'install', 'status',
    '--root', installRoot,
    '--bin-dir', binDir,
    '--applications-dir', applicationsDir,
    '--json'
  ]);

  assert.equal(status.code, 0);
  const statusPayload = JSON.parse(status.stdout);
  assert.equal(statusPayload.install_source, 'source_link');
  assert.equal(statusPayload.linked_source, true);
  assert.equal(statusPayload.current_target_path, path.resolve('.'));
  assert.equal(statusPayload.launcher_scope, 'project_checkout');
});

test('install bundle creates a portable runtime archive with manifest metadata', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-install-bundle-'));
  const bundlePath = path.join(root, 'dist', 'opencodex-runtime.tgz');
  const extractDir = path.join(root, 'extract');

  const result = await runCli([
    'install', 'bundle',
    '--output', bundlePath,
    '--json'
  ]);

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.action, 'bundle');
  assert.equal(payload.bundle_path, bundlePath);
  assert.equal(payload.bundle_kind, 'archive');
  assert.equal(payload.source_scope, 'project_checkout');
  assert.match(payload.next_steps[0] || '', /install detached --bundle/);

  await mkdir(extractDir, { recursive: true });
  await extractTar(bundlePath, extractDir);

  const manifest = JSON.parse(await readFile(path.join(extractDir, 'opencodex-runtime-bundle.json'), 'utf8'));
  assert.equal(manifest.format, 'opencodex-runtime-bundle/v1');
  assert.equal(manifest.name, 'opencodex');
  assert.equal(manifest.version, payload.version);
  assert.equal(manifest.source_scope, 'project_checkout');
  await access(path.join(extractDir, 'bin', 'opencodex.js'));
  await access(path.join(extractDir, 'src', 'main.js'));
});

test('install detached can install from a packaged runtime bundle', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-install-from-bundle-'));
  const bundlePath = path.join(root, 'dist', 'opencodex-runtime.tgz');
  const installRoot = path.join(root, 'OpenCodex');
  const binDir = path.join(root, 'bin');
  const applicationsDir = path.join(root, 'Applications');
  const osacompile = await writeMockOsacompile(path.join(root, 'mock-osacompile.js'));

  const bundle = await runCli([
    'install', 'bundle',
    '--output', bundlePath,
    '--json'
  ]);

  assert.equal(bundle.code, 0);

  const result = await runCli([
    'install', 'detached',
    '--bundle', bundlePath,
    '--root', installRoot,
    '--bin-dir', binDir,
    '--applications-dir', applicationsDir,
    '--name', 'bundled-runtime',
    '--json'
  ], {
    OPENCODEX_OSACOMPILE_BIN: osacompile
  });

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.install_name, 'bundled-runtime');
  assert.equal(payload.install_source, 'bundle_archive');
  assert.equal(payload.source_scope, 'packaged_bundle');
  assert.equal(payload.source_root, bundlePath);
  assert.equal(payload.bundle_path, bundlePath);
  assert.equal(payload.bundle_source_scope, 'project_checkout');
  assert.match(payload.bundle_source_root, /openCodex$/);
  assert.equal(payload.launcher_scope, 'installed_cli');

  const status = await runCli([
    'install', 'status',
    '--root', installRoot,
    '--bin-dir', binDir,
    '--applications-dir', applicationsDir,
    '--json'
  ]);

  assert.equal(status.code, 0);
  const statusPayload = JSON.parse(status.stdout);
  assert.equal(statusPayload.install_source, 'bundle_archive');
  assert.equal(statusPayload.source_scope, 'packaged_bundle');
  assert.equal(statusPayload.bundle_path, bundlePath);
  assert.equal(statusPayload.bundle_source_scope, 'project_checkout');
});

test('install status reports the detached runtime and shim', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-install-status-'));
  const installRoot = path.join(root, 'OpenCodex');
  const binDir = path.join(root, 'bin');
  const applicationsDir = path.join(root, 'Applications');
  const osacompile = await writeMockOsacompile(path.join(root, 'mock-osacompile.js'));

  await runCli([
    'install', 'detached',
    '--root', installRoot,
    '--bin-dir', binDir,
    '--applications-dir', applicationsDir,
    '--name', 'status-runtime',
    '--json'
  ], {
    OPENCODEX_OSACOMPILE_BIN: osacompile
  });

  const status = await runCli([
    'install', 'status',
    '--root', installRoot,
    '--bin-dir', binDir,
    '--applications-dir', applicationsDir,
    '--json'
  ]);

  assert.equal(status.code, 0);
  const payload = JSON.parse(status.stdout);
  assert.equal(payload.installed, true);
  assert.equal(payload.shim_exists, true);
  assert.equal(payload.launcher_scope, 'installed_cli');
  assert.equal(payload.install_name, 'status-runtime');
  assert.equal(payload.app_installed, true);
  assert.equal(payload.slots_total, 1);
  assert.equal(payload.current_slot_name, 'status-runtime');
  assert.equal(payload.prune_keep_preview, 3);
  assert.equal(payload.prune_candidate_count_preview, 0);
  assert.deepEqual(payload.prune_candidates_preview, []);
  assert.equal(payload.prune_keep_default, 3);
  assert.equal(payload.prune_candidate_count_default, 0);
  assert.deepEqual(payload.prune_candidates_default, []);
  assert.equal(payload.next_steps.length, 0);
  assert.match(payload.current_target_path, /installs\/status-runtime$/);
  assert.match(payload.current_cli_path, /current\/bin\/opencodex\.js$/);
  assert.match(payload.runtime_cli_path, /status-runtime\/bin\/opencodex\.js$/);
  assert.match(payload.app_source_path, /OpenCodex\.applescript$/);
});

test('install status previews stale slot prune candidates with default keep count', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-install-status-prune-preview-'));
  const installRoot = path.join(root, 'OpenCodex');
  const installsDir = path.join(installRoot, 'installs');
  const currentPath = path.join(installRoot, 'current');

  const slotA = await createInstallSlot(installsDir, 'slot-a');
  const slotB = await createInstallSlot(installsDir, 'slot-b');
  const slotC = await createInstallSlot(installsDir, 'slot-c');
  const slotD = await createInstallSlot(installsDir, 'slot-d');

  await symlink(path.relative(installRoot, slotB), currentPath);

  await utimes(slotA, new Date('2026-03-08T00:00:01.000Z'), new Date('2026-03-08T00:00:01.000Z'));
  await utimes(slotB, new Date('2026-03-08T00:00:02.000Z'), new Date('2026-03-08T00:00:02.000Z'));
  await utimes(slotC, new Date('2026-03-08T00:00:03.000Z'), new Date('2026-03-08T00:00:03.000Z'));
  await utimes(slotD, new Date('2026-03-08T00:00:04.000Z'), new Date('2026-03-08T00:00:04.000Z'));

  const result = await runCli([
    'install', 'status',
    '--root', installRoot,
    '--json'
  ]);

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.action, 'status');
  assert.equal(payload.installed, true);
  assert.equal(payload.slots_total, 4);
  assert.equal(payload.current_slot_name, 'slot-b');
  assert.equal(payload.prune_keep_preview, 3);
  assert.equal(payload.prune_candidate_count_preview, 1);
  assert.deepEqual(payload.prune_candidates_preview.map((slot) => slot.name), ['slot-a']);
  assert.equal(payload.prune_keep_default, 3);
  assert.equal(payload.prune_candidate_count_default, 1);
  assert.deepEqual(payload.prune_candidates_default.map((slot) => slot.name), ['slot-a']);
  assert.deepEqual(payload.slots_by_recency.map((slot) => slot.name), ['slot-d', 'slot-c', 'slot-b', 'slot-a']);
  assert.ok(payload.slots_by_recency.some((slot) => slot.name === 'slot-b' && slot.current));
  assert.match(payload.next_steps[0] || '', /install prune --root '.*OpenCodex' --dry-run/);
});

test('install status supports custom prune preview keep count without deleting slots', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-install-status-prune-keep-'));
  const installRoot = path.join(root, 'OpenCodex');
  const installsDir = path.join(installRoot, 'installs');
  const currentPath = path.join(installRoot, 'current');

  const slotA = await createInstallSlot(installsDir, 'slot-a');
  const slotB = await createInstallSlot(installsDir, 'slot-b');
  const slotC = await createInstallSlot(installsDir, 'slot-c');
  const slotD = await createInstallSlot(installsDir, 'slot-d');

  await symlink(path.relative(installRoot, slotB), currentPath);

  await utimes(slotA, new Date('2026-03-08T00:00:01.000Z'), new Date('2026-03-08T00:00:01.000Z'));
  await utimes(slotB, new Date('2026-03-08T00:00:02.000Z'), new Date('2026-03-08T00:00:02.000Z'));
  await utimes(slotC, new Date('2026-03-08T00:00:03.000Z'), new Date('2026-03-08T00:00:03.000Z'));
  await utimes(slotD, new Date('2026-03-08T00:00:04.000Z'), new Date('2026-03-08T00:00:04.000Z'));

  const result = await runCli([
    'install', 'status',
    '--root', installRoot,
    '--keep', '2',
    '--json'
  ]);

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.action, 'status');
  assert.equal(payload.prune_keep_preview, 2);
  assert.equal(payload.prune_candidate_count_preview, 2);
  assert.deepEqual(payload.prune_candidates_preview.map((slot) => slot.name).sort(), ['slot-a', 'slot-c']);
  assert.equal(payload.prune_keep_default, 3);
  assert.equal(payload.prune_candidate_count_default, 1);
  assert.deepEqual(payload.prune_candidates_default.map((slot) => slot.name), ['slot-a']);
  assert.match(payload.next_steps[0] || '', /install prune --root '.*OpenCodex' --keep 2 --dry-run/);

  await access(slotA);
  await access(slotB);
  await access(slotC);
  await access(slotD);
});

test('install status text output lists preview prune candidate slot names', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-install-status-text-preview-'));
  const installRoot = path.join(root, 'OpenCodex');
  const installsDir = path.join(installRoot, 'installs');
  const currentPath = path.join(installRoot, 'current');

  const slotA = await createInstallSlot(installsDir, 'slot-a');
  const slotB = await createInstallSlot(installsDir, 'slot-b');
  const slotC = await createInstallSlot(installsDir, 'slot-c');
  const slotD = await createInstallSlot(installsDir, 'slot-d');

  await symlink(path.relative(installRoot, slotB), currentPath);

  await utimes(slotA, new Date('2026-03-08T00:00:01.000Z'), new Date('2026-03-08T00:00:01.000Z'));
  await utimes(slotB, new Date('2026-03-08T00:00:02.000Z'), new Date('2026-03-08T00:00:02.000Z'));
  await utimes(slotC, new Date('2026-03-08T00:00:03.000Z'), new Date('2026-03-08T00:00:03.000Z'));
  await utimes(slotD, new Date('2026-03-08T00:00:04.000Z'), new Date('2026-03-08T00:00:04.000Z'));

  const result = await runCli([
    'install', 'status',
    '--root', installRoot,
    '--keep', '2'
  ]);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Prune Candidates \(preview keep 2\): 2/);
  assert.match(result.stdout, /Prune Candidate Slots \(preview\):/);
  assert.match(result.stdout, /- slot-a/);
  assert.match(result.stdout, /- slot-c/);
  assert.match(result.stdout, /install prune .* --keep 2 --dry-run/);
});

test('install status rejects invalid keep values', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-install-status-invalid-keep-'));
  const installRoot = path.join(root, 'OpenCodex');

  const result = await runCli([
    'install', 'status',
    '--root', installRoot,
    '--keep', '0',
    '--json'
  ]);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /`--keep` must be a positive integer/);
});

test('install prune keeps current runtime and the newest remaining slots', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-install-prune-'));
  const installRoot = path.join(root, 'OpenCodex');
  const installsDir = path.join(installRoot, 'installs');
  const currentPath = path.join(installRoot, 'current');

  const slotA = await createInstallSlot(installsDir, 'slot-a');
  const slotB = await createInstallSlot(installsDir, 'slot-b');
  const slotC = await createInstallSlot(installsDir, 'slot-c');
  const slotD = await createInstallSlot(installsDir, 'slot-d');

  await symlink(path.relative(installRoot, slotB), currentPath);

  await utimes(slotA, new Date('2026-03-08T00:00:01.000Z'), new Date('2026-03-08T00:00:01.000Z'));
  await utimes(slotB, new Date('2026-03-08T00:00:02.000Z'), new Date('2026-03-08T00:00:02.000Z'));
  await utimes(slotC, new Date('2026-03-08T00:00:03.000Z'), new Date('2026-03-08T00:00:03.000Z'));
  await utimes(slotD, new Date('2026-03-08T00:00:04.000Z'), new Date('2026-03-08T00:00:04.000Z'));

  const result = await runCli([
    'install', 'prune',
    '--root', installRoot,
    '--keep', '2',
    '--json'
  ]);

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.action, 'prune');
  assert.equal(payload.keep, 2);
  assert.equal(payload.dry_run, false);
  assert.equal(payload.slots_total, 4);
  assert.equal(payload.kept_count, 2);
  assert.equal(payload.removed_count, 2);
  assert.deepEqual(payload.slots_kept.map((slot) => slot.name).sort(), ['slot-b', 'slot-d']);
  assert.ok(payload.slots_kept.some((slot) => slot.name === 'slot-b' && slot.current));
  assert.deepEqual(payload.slots_removed.map((slot) => slot.name).sort(), ['slot-a', 'slot-c']);

  await access(slotB);
  await access(slotD);
  await assert.rejects(access(slotA));
  await assert.rejects(access(slotC));
});

test('install prune dry-run reports candidates without deleting runtimes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-install-prune-dry-run-'));
  const installRoot = path.join(root, 'OpenCodex');
  const installsDir = path.join(installRoot, 'installs');
  const currentPath = path.join(installRoot, 'current');

  const slotA = await createInstallSlot(installsDir, 'slot-a');
  const slotB = await createInstallSlot(installsDir, 'slot-b');
  const slotC = await createInstallSlot(installsDir, 'slot-c');

  await symlink(path.relative(installRoot, slotB), currentPath);

  await utimes(slotA, new Date('2026-03-08T00:00:01.000Z'), new Date('2026-03-08T00:00:01.000Z'));
  await utimes(slotB, new Date('2026-03-08T00:00:02.000Z'), new Date('2026-03-08T00:00:02.000Z'));
  await utimes(slotC, new Date('2026-03-08T00:00:03.000Z'), new Date('2026-03-08T00:00:03.000Z'));

  const result = await runCli([
    'install', 'prune',
    '--root', installRoot,
    '--keep', '1',
    '--dry-run',
    '--json'
  ]);

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.action, 'prune');
  assert.equal(payload.dry_run, true);
  assert.equal(payload.keep, 1);
  assert.equal(payload.removed_count, 2);
  assert.deepEqual(payload.slots_kept.map((slot) => slot.name), ['slot-b']);
  assert.deepEqual(payload.slots_removed.map((slot) => slot.name).sort(), ['slot-a', 'slot-c']);

  await access(slotA);
  await access(slotB);
  await access(slotC);
});

test('bootstrap install script installs a detached runtime from an existing checkout', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-bootstrap-script-'));
  const homeDir = path.join(root, 'home');
  const doctorCwd = path.join(root, 'doctor-cwd');
  const installRoot = path.join(root, 'OpenCodex');
  const binDir = path.join(root, 'bin');
  const applicationsDir = path.join(root, 'Applications');
  const bundlePath = path.join(root, 'dist', 'opencodex-runtime-bootstrap.tgz');
  const mockBinDir = path.join(root, 'mock-bin');

  await mkdir(homeDir, { recursive: true });
  await mkdir(doctorCwd, { recursive: true });
  await mkdir(mockBinDir, { recursive: true });

  const osacompile = await writeMockOsacompile(path.join(root, 'mock-osacompile.js'));
  const mockCodex = await writeMockCodexCli(path.join(mockBinDir, 'codex'));

  const result = await runShellScript(bootstrapScript, {
    HOME: homeDir,
    PATH: `${path.dirname(mockCodex)}:${process.env.PATH}`,
    OPENCODEX_SOURCE_DIR: path.resolve('.'),
    OPENCODEX_DOCTOR_CWD: doctorCwd,
    OPENCODEX_INSTALL_ROOT: installRoot,
    OPENCODEX_BIN_DIR: binDir,
    OPENCODEX_APPLICATIONS_DIR: applicationsDir,
    OPENCODEX_BUNDLE_PATH: bundlePath,
    OPENCODEX_INSTALL_NAME: 'bootstrap-runtime',
    OPENCODEX_OSACOMPILE_BIN: osacompile
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Bootstrap install completed/);
  await access(path.join(binDir, 'opencodex'));
  await access(path.join(installRoot, 'current', 'bin', 'opencodex.js'));
  await access(path.join(applicationsDir, 'OpenCodex.app', 'Contents', 'Info.plist'));

  const installState = JSON.parse(await readFile(path.join(installRoot, 'install-state.json'), 'utf8'));
  assert.equal(installState.install_name, 'bootstrap-runtime');
  assert.equal(installState.installed, true);
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

function runShellScript(scriptPath, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [scriptPath], {
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
writeFileSync(path.join(outputPath, 'Contents', 'Info.plist'), '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>LSMinimumSystemVersionByArchitecture</key><dict><key>x86_64</key><string>10.6</string></dict></dict></plist>');
process.exit(0);
`;
  await writeFile(filePath, source, { mode: 0o755 });
  return filePath;
}

async function writeMockCodexCli(filePath) {
  const source = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('codex-cli 0.111.0');
  process.exit(0);
}
if (args[0] === 'login' && args[1] === 'status') {
  console.log('Logged in using an API key - sk-test');
  process.exit(0);
}
if (args[0] === 'mcp' && args[1] === 'list' && args[2] === '--json') {
  console.log('[]');
  process.exit(0);
}
console.error('unsupported mock codex command');
process.exit(1);
`;
  await writeFile(filePath, source, { mode: 0o755 });
  return filePath;
}

async function createInstallSlot(installsDir, name) {
  const runtimePath = path.join(installsDir, name);
  await mkdir(path.join(runtimePath, 'bin'), { recursive: true });
  await writeFile(path.join(runtimePath, 'bin', 'opencodex.js'), '#!/usr/bin/env node\n');
  return runtimePath;
}

function extractTar(archivePath, outputDir) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/tar', ['-xzf', archivePath, '-C', outputDir], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr || `tar failed with exit code ${code}`));
    });
  });
}
