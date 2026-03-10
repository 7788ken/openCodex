import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { access, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const cli = path.resolve('bin/opencodex.js');

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
  assert.match(payload.current_target_path, /installs\/status-runtime$/);
  assert.match(payload.current_cli_path, /current\/bin\/opencodex\.js$/);
  assert.match(payload.runtime_cli_path, /status-runtime\/bin\/opencodex\.js$/);
  assert.match(payload.app_source_path, /OpenCodex\.applescript$/);
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
