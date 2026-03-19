import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chmod, cp, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { parseOptions } from '../lib/args.js';
import { runCommandCapture } from '../lib/codex.js';
import { describeOpenCodexLauncher } from '../lib/launcher.js';
import { ensureDir, pathExists, readJson, writeJson } from '../lib/fs.js';

const SOURCE_ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const SOURCE_CLI_PATH = fileURLToPath(new URL('../../bin/opencodex.js', import.meta.url));
const INSTALL_STATE_FILE = 'install-state.json';
const DEFAULT_APP_NAME = 'OpenCodex.app';
const DEFAULT_TRAY_APP_NAME = 'OpenCodex Tray.app';
const COPY_ITEMS = ['bin', 'src', 'schemas', 'prompts', 'package.json', 'README.md'];
const BUNDLE_MANIFEST_FILE = 'opencodex-runtime-bundle.json';
const BUNDLE_FORMAT = 'opencodex-runtime-bundle/v1';

const DETACHED_INSTALL_OPTION_SPEC = {
  root: { type: 'string' },
  'bin-dir': { type: 'string' },
  'applications-dir': { type: 'string' },
  bundle: { type: 'string' },
  name: { type: 'string' },
  'link-source': { type: 'boolean' },
  force: { type: 'boolean' },
  json: { type: 'boolean' }
};

const BUNDLE_OPTION_SPEC = {
  output: { type: 'string' },
  force: { type: 'boolean' },
  json: { type: 'boolean' }
};

const STATUS_OPTION_SPEC = {
  root: { type: 'string' },
  'bin-dir': { type: 'string' },
  'applications-dir': { type: 'string' },
  keep: { type: 'string' },
  json: { type: 'boolean' }
};

const PRUNE_OPTION_SPEC = {
  root: { type: 'string' },
  keep: { type: 'string' },
  'dry-run': { type: 'boolean' },
  json: { type: 'boolean' }
};

export async function runInstallCommand(args) {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    process.stdout.write(
      'Usage:\n' +
      '  opencodex install bundle [--output <path>] [--force] [--json]\n' +
      '  opencodex install detached [--root <dir>] [--bin-dir <dir>] [--applications-dir <dir>] [--bundle <path>] [--name <id>] [--link-source] [--force] [--json]\n' +
      '  opencodex install status [--root <dir>] [--bin-dir <dir>] [--applications-dir <dir>] [--keep <n>] [--json]\n' +
      '  opencodex install prune [--root <dir>] [--keep <n>] [--dry-run] [--json]\n'
    );
    return;
  }

  if (subcommand === 'bundle') {
    await runBundleBuild(rest);
    return;
  }

  if (subcommand === 'detached') {
    await runDetachedInstall(rest);
    return;
  }

  if (subcommand === 'status') {
    await runInstallStatus(rest);
    return;
  }

  if (subcommand === 'prune') {
    await runInstallPrune(rest);
    return;
  }

  throw new Error(`Unknown install subcommand: ${subcommand}`);
}

async function runBundleBuild(args) {
  const { options, positionals } = parseOptions(args, BUNDLE_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex install bundle` does not accept positional arguments');
  }

  const sourcePackage = await readSourcePackage();
  const sourceLauncher = describeOpenCodexLauncher(SOURCE_CLI_PATH, SOURCE_CLI_PATH);
  const version = sourcePackage.version || '0.0.0';
  const outputPath = path.resolve(options.output || path.join(SOURCE_ROOT, 'dist', buildDefaultBundleName(version)));
  const bundleKind = isArchivePath(outputPath) ? 'archive' : 'directory';
  if (await pathExists(outputPath)) {
    if (!options.force) {
      throw new Error(`Bundle target already exists: ${outputPath}. Pass --force to replace it.`);
    }
    await rm(outputPath, { recursive: true, force: true });
  }

  const stagingRoot = await mkdtemp(path.join(os.tmpdir(), 'opencodex-bundle-'));
  const bundleRoot = path.join(stagingRoot, 'bundle');

  try {
    await copyRuntimeTree(SOURCE_ROOT, bundleRoot);
    await writeJson(path.join(bundleRoot, BUNDLE_MANIFEST_FILE), buildBundleManifest({
      version,
      sourceRoot: SOURCE_ROOT,
      sourceScope: sourceLauncher.launcherScope
    }));

    await ensureDir(path.dirname(outputPath));
    if (bundleKind === 'archive') {
      await createBundleArchive(bundleRoot, outputPath);
    } else {
      await cp(bundleRoot, outputPath, { recursive: true });
    }
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }

  const payload = {
    ok: true,
    action: 'bundle',
    bundle_path: outputPath,
    bundle_kind: bundleKind,
    bundle_manifest_file: BUNDLE_MANIFEST_FILE,
    version,
    source_root: SOURCE_ROOT,
    source_scope: sourceLauncher.launcherScope,
    next_steps: [
      `Use \`opencodex install detached --bundle ${shellQuote(outputPath)}\` to install from the packaged runtime instead of copying directly from the current checkout.`
    ]
  };

  renderInstallOutput(payload, options.json, 'Detached runtime bundle created');
}

async function runDetachedInstall(args) {
  const { options, positionals } = parseOptions(args, DETACHED_INSTALL_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex install detached` does not accept positional arguments');
  }

  const installSource = await resolveInstallSource(options);
  const paths = resolveInstallPaths(options);
  const installName = normalizeInstallName(options.name || buildDefaultInstallName(installSource.version));
  const runtimePath = path.join(paths.installsDir, installName);
  const runtimeCliPath = path.join(runtimePath, 'bin', 'opencodex.js');
  const currentCliPath = path.join(paths.currentPath, 'bin', 'opencodex.js');

  try {
    if (await pathExists(runtimePath)) {
      if (!options.force) {
        throw new Error(`Install target already exists: ${runtimePath}. Pass --force to replace it.`);
      }
      await rm(runtimePath, { recursive: true, force: true });
    }

    await ensureDir(paths.installsDir);
    await ensureDir(paths.binDir);
    await installSource.materialize(runtimePath);
    await validateRuntimeRoot(runtimePath);

    if (!installSource.linkedSource) {
      await chmod(runtimeCliPath, 0o755);
    }
    await rewriteCurrentPointer(paths.currentPath, runtimePath, paths.rootDir);
    await writeFile(paths.shimPath, buildCliShim(paths.currentPath), 'utf8');
    await chmod(paths.shimPath, 0o755);
    await compileDesktopApp(paths);

    const payload = {
      ok: true,
      action: 'detached',
      installed: true,
      root_dir: paths.rootDir,
      installs_dir: paths.installsDir,
      current_path: paths.currentPath,
      current_cli_path: currentCliPath,
      runtime_path: runtimePath,
      runtime_cli_path: runtimeCliPath,
      shim_path: paths.shimPath,
      app_path: paths.appPath,
      app_source_path: paths.appSourcePath,
      app_installed: await pathExists(paths.appPath),
      install_name: installName,
      version: installSource.version,
      install_source: installSource.installSource,
      linked_source: Boolean(installSource.linkedSource),
      source_root: installSource.sourceRoot,
      source_scope: installSource.sourceScope,
      bundle_path: installSource.bundlePath,
      bundle_source_root: installSource.bundleSourceRoot,
      bundle_source_scope: installSource.bundleSourceScope,
      launcher_scope: describeOpenCodexLauncher(runtimeCliPath, runtimeCliPath).launcherScope,
      next_steps: [
        `Add ${paths.binDir} to PATH if \`opencodex\` is not yet discoverable.`,
        `Use \`open ${shellQuote(paths.appPath)}\` to launch the installed app shell.`,
        `Use \`opencodex install status${paths.rootDir ? ` --root ${shellQuote(paths.rootDir)}` : ''}\` to inspect the detached runtime.`,
        installSource.linkedSource
          ? `This install links back to ${shellQuote(installSource.sourceRoot)}. Source edits take effect immediately without re-running \`opencodex install detached\`.`
          : installSource.sourceScope === 'packaged_bundle'
          ? `Keep the bundle at ${shellQuote(installSource.bundlePath)} if you want a reproducible handoff artifact for future installs.`
          : 'Prefer `opencodex install bundle` followed by `opencodex install detached --bundle <path>` when preparing a product-like install outside the current checkout.',
        `Use \`opencodex service telegram relink --cli-path ${shellQuote(currentCliPath)}\` to move an existing Telegram service onto the detached runtime.`
      ]
    };

    await writeJson(path.join(paths.rootDir, INSTALL_STATE_FILE), {
      installed_at: new Date().toISOString(),
      ...payload
    });

    renderInstallOutput(payload, options.json, 'Detached openCodex runtime installed');
  } finally {
    if (typeof installSource.cleanup === 'function') {
      await installSource.cleanup();
    }
  }
}

async function runInstallStatus(args) {
  const { options, positionals } = parseOptions(args, STATUS_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex install status` does not accept positional arguments');
  }

  const paths = resolveInstallPaths(options);
  const defaultPruneKeepCount = 3;
  const previewPruneKeepCount = parseKeepCount(options.keep || String(defaultPruneKeepCount));
  const currentCliPath = path.join(paths.currentPath, 'bin', 'opencodex.js');
  const installed = await pathExists(currentCliPath);
  const shimExists = await pathExists(paths.shimPath);
  const appInstalled = await pathExists(paths.appPath);
  const slots = await listInstallSlots(paths.installsDir);
  const statePath = path.join(paths.rootDir, INSTALL_STATE_FILE);
  const state = await loadInstallState(statePath);
  const currentTargetPath = await resolveCurrentTargetPath(paths.currentPath);
  const defaultPrunePlan = planInstallSlotPrune(slots, currentTargetPath, defaultPruneKeepCount);
  const previewPrunePlan = previewPruneKeepCount === defaultPruneKeepCount
    ? defaultPrunePlan
    : planInstallSlotPrune(slots, currentTargetPath, previewPruneKeepCount);
  const staleSlotCount = previewPrunePlan.removedSlots.length;
  const statusNextSteps = [];
  if (staleSlotCount > 0) {
    const keepFlag = previewPruneKeepCount === defaultPruneKeepCount ? '' : ` --keep ${previewPruneKeepCount}`;
    statusNextSteps.push(
      `Run \`opencodex install prune${paths.rootDir ? ` --root ${shellQuote(paths.rootDir)}` : ''}${keepFlag} --dry-run\` to preview cleanup of ${staleSlotCount} stale install slot${staleSlotCount === 1 ? '' : 's'}.`
    );
  }

  const payload = {
    ok: true,
    action: 'status',
    installed,
    root_dir: paths.rootDir,
    installs_dir: paths.installsDir,
    current_path: paths.currentPath,
    current_target_path: currentTargetPath,
    current_cli_path: installed ? currentCliPath : '',
    runtime_cli_path: installed && currentTargetPath ? path.join(currentTargetPath, 'bin', 'opencodex.js') : '',
    shim_path: paths.shimPath,
    shim_exists: shimExists,
    app_path: paths.appPath,
    app_source_path: await pathExists(paths.appSourcePath) ? paths.appSourcePath : '',
    app_installed: appInstalled,
    install_name: state?.install_name || (currentTargetPath ? path.basename(currentTargetPath) : ''),
    version: state?.version || '',
    install_source: state?.install_source || '',
    launcher_scope: installed ? describeOpenCodexLauncher(currentCliPath, currentCliPath).launcherScope : '',
    source_root: state?.source_root || '',
    source_scope: state?.source_scope || '',
    linked_source: Boolean(state?.linked_source),
    bundle_path: state?.bundle_path || '',
    bundle_source_root: state?.bundle_source_root || '',
    bundle_source_scope: state?.bundle_source_scope || '',
    slots_total: slots.length,
    current_slot_name: previewPrunePlan.currentSlot?.name || '',
    slots_by_recency: previewPrunePlan.slotsByRecency.map((slot) => ({
      name: slot.name,
      path: slot.path,
      current: Boolean(previewPrunePlan.currentSlot && slot.name === previewPrunePlan.currentSlot.name)
    })),
    prune_keep_preview: previewPruneKeepCount,
    prune_candidate_count_preview: staleSlotCount,
    prune_candidates_preview: previewPrunePlan.removedSlots.map((slot) => ({
      name: slot.name,
      path: slot.path
    })),
    prune_keep_default: defaultPruneKeepCount,
    prune_candidate_count_default: defaultPrunePlan.removedSlots.length,
    prune_candidates_default: defaultPrunePlan.removedSlots.map((slot) => ({
      name: slot.name,
      path: slot.path
    })),
    next_steps: statusNextSteps
  };

  renderInstallOutput(payload, options.json, 'Detached openCodex runtime status');
}

async function runInstallPrune(args) {
  const { options, positionals } = parseOptions(args, PRUNE_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex install prune` does not accept positional arguments');
  }

  const paths = resolveInstallPaths(options);
  const keepCount = parseKeepCount(options.keep || '3');
  const dryRun = Boolean(options['dry-run']);

  const slots = await listInstallSlots(paths.installsDir);
  const currentTargetPath = await resolveCurrentTargetPath(paths.currentPath);
  const prunePlan = planInstallSlotPrune(slots, currentTargetPath, keepCount);
  const { currentSlot, keptSlots, removedSlots } = prunePlan;

  if (!dryRun) {
    for (const slot of removedSlots) {
      await rm(slot.path, { recursive: true, force: true });
    }
  }

  const payload = {
    ok: true,
    action: 'prune',
    root_dir: paths.rootDir,
    installs_dir: paths.installsDir,
    current_target_path: currentTargetPath,
    keep: keepCount,
    dry_run: dryRun,
    slots_total: slots.length,
    kept_count: keptSlots.length,
    removed_count: removedSlots.length,
    slots_kept: keptSlots.map((slot) => ({
      name: slot.name,
      path: slot.path,
      current: Boolean(currentSlot && slot.name === currentSlot.name)
    })),
    slots_removed: removedSlots.map((slot) => ({
      name: slot.name,
      path: slot.path
    })),
    next_steps: dryRun
      ? ['Run the same command without `--dry-run` to apply this cleanup.']
      : ['Use `opencodex install status` to confirm the detached runtime pointer after cleanup.']
  };

  renderInstallPruneOutput(payload, options.json);
}

function resolveInstallPaths(options = {}) {
  const homeDir = os.homedir();
  const rootDir = path.resolve(options.root || path.join(homeDir, 'Library', 'Application Support', 'OpenCodex'));
  const binDir = path.resolve(options['bin-dir'] || path.join(homeDir, '.local', 'bin'));
  const applicationsDir = path.resolve(options['applications-dir'] || path.join(homeDir, 'Applications'));
  return {
    rootDir,
    installsDir: path.join(rootDir, 'installs'),
    currentPath: path.join(rootDir, 'current'),
    binDir,
    shimPath: path.join(binDir, 'opencodex'),
    applicationsDir,
    appPath: path.join(applicationsDir, DEFAULT_APP_NAME),
    appSourcePath: path.join(rootDir, 'OpenCodex.applescript'),
    trayAppPath: path.join(applicationsDir, DEFAULT_TRAY_APP_NAME),
    sessionsPath: path.join(homeDir, '.opencodex', 'sessions')
  };
}

async function listInstallSlots(installsDir) {
  if (!(await pathExists(installsDir))) {
    return [];
  }

  const entries = await readdir(installsDir, { withFileTypes: true });
  const slots = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue;
    }
    const slotPath = path.join(installsDir, entry.name);
    let slotStat = null;
    try {
      slotStat = await stat(slotPath);
    } catch {
      continue;
    }
    const realPath = await tryResolveRealPath(slotPath);
    slots.push({
      name: entry.name,
      path: slotPath,
      real_path: realPath || slotPath,
      mtime_ms: Number(slotStat.mtimeMs || 0)
    });
  }
  return slots;
}

async function resolveCurrentTargetPath(currentPath) {
  if (!(await pathExists(currentPath))) {
    return '';
  }
  const resolvedPath = await tryResolveRealPath(currentPath);
  return resolvedPath || '';
}

function planInstallSlotPrune(slots, currentTargetPath, keepCount) {
  const slotsByRecency = [...slots].sort((left, right) => {
    if (left.mtime_ms !== right.mtime_ms) {
      return right.mtime_ms - left.mtime_ms;
    }
    return right.name.localeCompare(left.name);
  });

  const currentSlot = slots.find((slot) => currentTargetPath && slot.real_path === currentTargetPath) || null;
  const keptSlots = [];
  if (currentSlot) {
    keptSlots.push(currentSlot);
  }

  for (const slot of slotsByRecency) {
    if (keptSlots.length >= keepCount) {
      break;
    }
    if (currentSlot && slot.name === currentSlot.name) {
      continue;
    }
    keptSlots.push(slot);
  }

  const keptNameSet = new Set(keptSlots.map((slot) => slot.name));
  const removedSlots = slotsByRecency.filter((slot) => !keptNameSet.has(slot.name));
  return { currentSlot, slotsByRecency, keptSlots, removedSlots };
}

async function tryResolveRealPath(value) {
  try {
    return await realpath(value);
  } catch {
    return '';
  }
}

function parseKeepCount(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('`--keep` must be a positive integer');
  }
  return parsed;
}

async function resolveInstallSource(options = {}) {
  const bundlePath = typeof options.bundle === 'string' && options.bundle.trim()
    ? options.bundle.trim()
    : '';
  if (bundlePath && options['link-source']) {
    throw new Error('`opencodex install detached` cannot combine `--bundle` with `--link-source`.');
  }
  if (bundlePath) {
    return resolveBundleInstallSource(bundlePath);
  }
  return resolveCheckoutInstallSource(options);
}

async function resolveCheckoutInstallSource(options = {}) {
  const sourcePackage = await readSourcePackage();
  const sourceLauncher = describeOpenCodexLauncher(SOURCE_CLI_PATH, SOURCE_CLI_PATH);
  const linkedSource = Boolean(options['link-source']);
  return {
    version: sourcePackage.version || '0.0.0',
    installSource: linkedSource ? 'source_link' : 'direct_copy',
    linkedSource,
    sourceRoot: SOURCE_ROOT,
    sourceScope: sourceLauncher.launcherScope,
    bundlePath: '',
    bundleSourceRoot: '',
    bundleSourceScope: '',
    materialize: async (runtimePath) => linkedSource
      ? linkRuntimeTree(SOURCE_ROOT, runtimePath)
      : copyRuntimeTree(SOURCE_ROOT, runtimePath),
    cleanup: async () => {}
  };
}

async function resolveBundleInstallSource(bundleValue) {
  const bundlePath = path.resolve(bundleValue);
  if (!(await pathExists(bundlePath))) {
    throw new Error(`Bundle path does not exist: ${bundlePath}`);
  }

  const bundleStats = await stat(bundlePath);
  if (bundleStats.isDirectory()) {
    return resolveBundleDirectoryInstallSource(bundlePath);
  }
  return resolveBundleArchiveInstallSource(bundlePath);
}

async function resolveBundleDirectoryInstallSource(bundlePath) {
  const manifest = await readBundleManifest(bundlePath);
  const runtimePackage = await readRuntimePackage(bundlePath);
  await validateRuntimeRoot(bundlePath);
  return {
    version: runtimePackage.version || manifest.version || '0.0.0',
    installSource: 'bundle_directory',
    sourceRoot: bundlePath,
    sourceScope: 'packaged_bundle',
    bundlePath,
    bundleSourceRoot: manifest.source_root || '',
    bundleSourceScope: manifest.source_scope || '',
    materialize: async (runtimePath) => cp(bundlePath, runtimePath, { recursive: true }),
    cleanup: async () => {}
  };
}

async function resolveBundleArchiveInstallSource(bundlePath) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'opencodex-install-bundle-'));
  const extractedRoot = path.join(tempRoot, 'bundle');
  await ensureDir(extractedRoot);
  try {
    await extractBundleArchive(bundlePath, extractedRoot);
    const manifest = await readBundleManifest(extractedRoot);
    const runtimePackage = await readRuntimePackage(extractedRoot);
    await validateRuntimeRoot(extractedRoot);
    return {
      version: runtimePackage.version || manifest.version || '0.0.0',
      installSource: 'bundle_archive',
      sourceRoot: bundlePath,
      sourceScope: 'packaged_bundle',
      bundlePath,
      bundleSourceRoot: manifest.source_root || '',
      bundleSourceScope: manifest.source_scope || '',
      materialize: async (runtimePath) => cp(extractedRoot, runtimePath, { recursive: true }),
      cleanup: async () => rm(tempRoot, { recursive: true, force: true })
    };
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

async function readSourcePackage() {
  const packagePath = path.join(SOURCE_ROOT, 'package.json');
  const text = await readFile(packagePath, 'utf8');
  return JSON.parse(text);
}

async function readRuntimePackage(rootPath) {
  const packagePath = path.join(rootPath, 'package.json');
  if (!(await pathExists(packagePath))) {
    throw new Error(`Bundle is missing package.json: ${rootPath}`);
  }
  return readJson(packagePath);
}

async function readBundleManifest(rootPath) {
  const manifestPath = path.join(rootPath, BUNDLE_MANIFEST_FILE);
  if (!(await pathExists(manifestPath))) {
    return {};
  }
  try {
    const manifest = await readJson(manifestPath);
    return manifest && typeof manifest === 'object' ? manifest : {};
  } catch {
    throw new Error(`Bundle manifest is invalid: ${manifestPath}`);
  }
}

function buildDefaultInstallName(version) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  return `${version || '0.0.0'}-${stamp}`;
}

function buildDefaultBundleName(version) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  return `opencodex-runtime-${version || '0.0.0'}-${stamp}.tgz`;
}

function normalizeInstallName(name) {
  const normalized = String(name || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
  if (!normalized) {
    throw new Error('Install name cannot be empty.');
  }
  return normalized;
}

async function rewriteCurrentPointer(currentPath, runtimePath, rootDir) {
  await rm(currentPath, { recursive: true, force: true });
  const relativeTarget = path.relative(rootDir, runtimePath);
  await symlink(relativeTarget, currentPath);
}

async function loadInstallState(statePath) {
  if (!(await pathExists(statePath))) {
    return null;
  }

  try {
    return await readJson(statePath);
  } catch {
    return null;
  }
}

function buildCliShim(currentPath) {
  return [
    '#!/bin/zsh',
    'set -euo pipefail',
    `exec /usr/bin/env node ${shellQuote(path.join(currentPath, 'bin', 'opencodex.js'))} "$@"`
  ].join('\n') + '\n';
}

async function compileDesktopApp(paths) {
  await ensureDir(paths.rootDir);
  await ensureDir(paths.applicationsDir);
  await writeFile(paths.appSourcePath, buildDesktopAppAppleScript(paths), 'utf8');
  await rm(paths.appPath, { recursive: true, force: true });

  const osacompile = resolveOsacompileBin();
  const compiled = await runCommandCapture(osacompile, ['-o', paths.appPath, paths.appSourcePath], {
    cwd: paths.rootDir
  });
  if (compiled.code !== 0) {
    throw new Error(`osacompile failed: ${pickCommandFailure(compiled)}`);
  }

  const infoPlistPath = path.join(paths.appPath, 'Contents', 'Info.plist');
  if (!(await pathExists(infoPlistPath))) {
    return;
  }

  const infoPlist = await readFile(infoPlistPath, 'utf8');
  const additions = [];
  if (!infoPlist.includes('<key>CFBundleIdentifier</key>')) {
    additions.push('  <key>CFBundleIdentifier</key>\n  <string>com.opencodex.app</string>');
  }
  if (!infoPlist.includes('<key>CFBundleDisplayName</key>')) {
    additions.push(`  <key>CFBundleDisplayName</key>\n  <string>${DEFAULT_APP_NAME.replace(/\.app$/, '')}</string>`);
  }
  if (!infoPlist.includes('<key>NSHighResolutionCapable</key>')) {
    additions.push('  <key>NSHighResolutionCapable</key>\n  <true/>');
  }
  if (!additions.length) {
    return;
  }

  const closingIndex = infoPlist.lastIndexOf('</dict>');
  if (closingIndex === -1) {
    return;
  }

  const patched = `${infoPlist.slice(0, closingIndex)}${additions.join('\n')}\n${infoPlist.slice(closingIndex)}`;
  await writeFile(infoPlistPath, patched, 'utf8');
}

function buildDesktopAppAppleScript(paths) {
  return `use AppleScript version "2.4"
use scripting additions

property cliPath : ${appleScriptString(path.join(paths.currentPath, 'bin', 'opencodex.js'))}
property installRootPath : ${appleScriptString(paths.rootDir)}
property sessionsPath : ${appleScriptString(paths.sessionsPath)}
property trayAppPath : ${appleScriptString(paths.trayAppPath)}
property defaultWorkspacePath : ${appleScriptString(os.homedir())}
property appTitle : "OpenCodex"
property shellPathPrefix : "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

on run
	my showLauncherMenu()
end run

on reopen
	my showLauncherMenu()
end reopen

on showLauncherMenu()
	set actionChoices to {"Run Task…", "Review Folder…", "Doctor", "Install Status", "Open Sessions", "Open Install Root", "Open Tray", "Quit"}
	set selection to choose from list actionChoices with title appTitle with prompt "Choose an action for the installed OpenCodex runtime." default items {"Run Task…"}
	if selection is false then return
	set actionName to item 1 of selection
	if actionName is "Run Task…" then
		my runTaskFlow()
		return
	end if
	if actionName is "Review Folder…" then
		my runReviewFlow()
		return
	end if
	if actionName is "Doctor" then
		my runCliInTerminal("doctor", defaultWorkspacePath)
		return
	end if
	if actionName is "Install Status" then
		my runCliInTerminal("install status", defaultWorkspacePath)
		return
	end if
	if actionName is "Open Sessions" then
		my openExistingPath(sessionsPath, "The local session directory does not exist yet.")
		return
	end if
	if actionName is "Open Install Root" then
		my openExistingPath(installRootPath, "The detached install root is missing.")
		return
	end if
	if actionName is "Open Tray" then
		my openExistingPath(trayAppPath, "The tray app is not installed yet.")
		return
	end if
end showLauncherMenu

on runTaskFlow()
	set workspacePath to my chooseWorkspacePath("Choose a workspace folder for this task.")
	if workspacePath is "" then return
	try
		set dialogResult to display dialog "Describe the task to run through openCodex." default answer "" with title appTitle buttons {"Cancel", "Run Task"} default button "Run Task"
	on error number -128
		return
	end try
	set taskText to text returned of dialogResult
	if taskText is "" then return
	my runCliInTerminal("run " & quoted form of taskText, workspacePath)
end runTaskFlow

on runReviewFlow()
	set workspacePath to my chooseWorkspacePath("Choose a workspace folder to review.")
	if workspacePath is "" then return
	my runCliInTerminal("review --uncommitted", workspacePath)
end runReviewFlow

on chooseWorkspacePath(promptText)
	try
		set defaultLocation to POSIX file defaultWorkspacePath
		set chosenFolder to choose folder with prompt promptText default location defaultLocation
		return POSIX path of chosenFolder
	on error number -128
		return ""
	end try
end chooseWorkspacePath

on runCliInTerminal(cliArgs, workingPath)
	set commandText to "export PATH=" & quoted form of shellPathPrefix & "; cd " & quoted form of workingPath & "; clear; /usr/bin/env node " & quoted form of cliPath & space & cliArgs
	tell application "Terminal"
		activate
		do script commandText
	end tell
end runCliInTerminal

on openExistingPath(targetPath, missingMessage)
	if my fileExistsAtPath(targetPath) then
		do shell script "open " & quoted form of targetPath
	else
		display dialog missingMessage buttons {"OK"} default button "OK" with title appTitle
	end if
end openExistingPath

on fileExistsAtPath(targetPath)
	try
		do shell script "test -e " & quoted form of targetPath
		return true
	on error
		return false
	end try
end fileExistsAtPath
`;
}

async function copyRuntimeTree(sourceRoot, targetRoot) {
  for (const entry of COPY_ITEMS) {
    const sourcePath = path.join(sourceRoot, entry);
    const targetPath = path.join(targetRoot, entry);
    if (!(await pathExists(sourcePath))) {
      continue;
    }
    await cp(sourcePath, targetPath, { recursive: true });
  }
}

async function linkRuntimeTree(sourceRoot, targetRoot) {
  await ensureDir(path.dirname(targetRoot));
  const canonicalSourceRoot = await realpath(sourceRoot);
  await symlink(canonicalSourceRoot, targetRoot);
}

function buildBundleManifest({ version, sourceRoot, sourceScope }) {
  return {
    format: BUNDLE_FORMAT,
    name: 'opencodex',
    version: version || '0.0.0',
    created_at: new Date().toISOString(),
    source_root: sourceRoot || '',
    source_scope: sourceScope || '',
    entrypoint: 'bin/opencodex.js',
    copy_items: COPY_ITEMS
  };
}

async function validateRuntimeRoot(rootPath) {
  const requiredPaths = [
    path.join(rootPath, 'bin', 'opencodex.js'),
    path.join(rootPath, 'package.json'),
    path.join(rootPath, 'src', 'main.js')
  ];
  for (const requiredPath of requiredPaths) {
    if (!(await pathExists(requiredPath))) {
      throw new Error(`Runtime is missing required file: ${requiredPath}`);
    }
  }
}

async function createBundleArchive(sourceRoot, outputPath) {
  const tar = resolveTarBin();
  const result = await runCommandCapture(tar, ['-czf', outputPath, '-C', sourceRoot, '.'], {
    cwd: sourceRoot
  });
  if (result.code !== 0) {
    throw new Error(`tar create failed: ${pickCommandFailure(result)}`);
  }
}

async function extractBundleArchive(bundlePath, outputPath) {
  const tar = resolveTarBin();
  const result = await runCommandCapture(tar, ['-xzf', bundlePath, '-C', outputPath], {
    cwd: path.dirname(bundlePath)
  });
  if (result.code !== 0) {
    throw new Error(`tar extract failed: ${pickCommandFailure(result)}`);
  }
}

function renderInstallOutput(payload, json, title) {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  const lines = [title, ''];
  lines.push(`Installed: ${payload.installed ? 'yes' : 'no'}`);
  if (payload.install_name) {
    lines.push(`Install Name: ${payload.install_name}`);
  }
  if (payload.version) {
    lines.push(`Version: ${payload.version}`);
  }
  if (payload.install_source) {
    lines.push(`Install Source: ${payload.install_source}`);
  }
  if (payload.linked_source) {
    lines.push('Linked Source: yes');
  }
  if (payload.root_dir) {
    lines.push(`Root Dir: ${payload.root_dir}`);
  }
  if (payload.bundle_kind) {
    lines.push(`Bundle Kind: ${payload.bundle_kind}`);
  }
  if (payload.current_path) {
    lines.push(`Current Path: ${payload.current_path}`);
  }
  if (payload.current_target_path) {
    lines.push(`Current Target: ${payload.current_target_path}`);
  }
  if (payload.current_slot_name) {
    lines.push(`Current Slot: ${payload.current_slot_name}`);
  }
  if (typeof payload.slots_total === 'number') {
    lines.push(`Install Slots: ${payload.slots_total}`);
  }
  if (typeof payload.prune_candidate_count_preview === 'number') {
    lines.push(`Prune Candidates (preview keep ${payload.prune_keep_preview || 3}): ${payload.prune_candidate_count_preview}`);
  }
  if (
    typeof payload.prune_candidate_count_default === 'number'
    && typeof payload.prune_keep_default === 'number'
    && typeof payload.prune_keep_preview === 'number'
    && payload.prune_keep_default !== payload.prune_keep_preview
  ) {
    lines.push(`Prune Candidates (default keep ${payload.prune_keep_default}): ${payload.prune_candidate_count_default}`);
  }
  if (Array.isArray(payload.prune_candidates_preview) && payload.prune_candidates_preview.length) {
    lines.push('Prune Candidate Slots (preview):');
    for (const slot of payload.prune_candidates_preview) {
      lines.push(`- ${slot.name}`);
    }
  }
  if (payload.runtime_path) {
    lines.push(`Runtime Path: ${payload.runtime_path}`);
  }
  if (payload.runtime_cli_path) {
    lines.push(`Runtime CLI: ${payload.runtime_cli_path}`);
  }
  if (payload.current_cli_path) {
    lines.push(`Current CLI: ${payload.current_cli_path}`);
  }
  if (payload.shim_path) {
    lines.push(`CLI Shim: ${payload.shim_path}${payload.shim_exists === false ? ' (missing)' : ''}`);
  }
  if (payload.app_path) {
    lines.push(`App Path: ${payload.app_path}${payload.app_installed ? ' (present)' : ' (not installed)'}`);
  }
  if (payload.app_source_path) {
    lines.push(`App Source: ${payload.app_source_path}`);
  }
  if (payload.source_root) {
    lines.push(`Source Root: ${payload.source_root}`);
  }
  if (payload.source_scope) {
    lines.push(`Source Scope: ${payload.source_scope}`);
  }
  if (payload.bundle_path) {
    lines.push(`Bundle Path: ${payload.bundle_path}`);
  }
  if (payload.bundle_source_root) {
    lines.push(`Bundle Source Root: ${payload.bundle_source_root}`);
  }
  if (payload.bundle_source_scope) {
    lines.push(`Bundle Source Scope: ${payload.bundle_source_scope}`);
  }
  if (payload.launcher_scope) {
    lines.push(`Launcher Scope: ${payload.launcher_scope}`);
  }
  if (Array.isArray(payload.next_steps) && payload.next_steps.length) {
    lines.push('Next Steps:');
    for (const step of payload.next_steps) {
      lines.push(`- ${step}`);
    }
  }

  process.stdout.write(lines.join('\n') + '\n');
}

function renderInstallPruneOutput(payload, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  const lines = ['Detached runtime prune', ''];
  lines.push(`Root Dir: ${payload.root_dir}`);
  lines.push(`Installs Dir: ${payload.installs_dir}`);
  lines.push(`Keep: ${payload.keep}`);
  lines.push(`Dry Run: ${payload.dry_run ? 'yes' : 'no'}`);
  lines.push(`Slots Total: ${payload.slots_total}`);
  lines.push(`Kept: ${payload.kept_count}`);
  lines.push(`Removed: ${payload.removed_count}`);
  if (payload.current_target_path) {
    lines.push(`Current Target: ${payload.current_target_path}`);
  }

  lines.push('');
  lines.push('Kept Slots:');
  for (const slot of payload.slots_kept || []) {
    lines.push(`- ${slot.name}${slot.current ? ' (current)' : ''}`);
  }

  lines.push('');
  lines.push(payload.dry_run ? 'Would Remove:' : 'Removed Slots:');
  for (const slot of payload.slots_removed || []) {
    lines.push(`- ${slot.name}`);
  }

  if (Array.isArray(payload.next_steps) && payload.next_steps.length) {
    lines.push('');
    lines.push('Next Steps:');
    for (const step of payload.next_steps) {
      lines.push(`- ${step}`);
    }
  }

  process.stdout.write(lines.join('\n') + '\n');
}

function shellQuote(value) {
  return `'${String(value || '').replace(/'/g, `'"'"'`)}'`;
}

function pickCommandFailure(result) {
  return String(result.stderr || result.stdout || 'Unknown command error').trim() || 'Unknown command error';
}

function resolveOsacompileBin() {
  return process.env.OPENCODEX_OSACOMPILE_BIN || '/usr/bin/osacompile';
}

function resolveTarBin() {
  return process.env.OPENCODEX_TAR_BIN || '/usr/bin/tar';
}

function appleScriptString(value) {
  return `"${String(value || '').replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function isArchivePath(targetPath) {
  return /\.tgz$/i.test(targetPath) || /\.tar\.gz$/i.test(targetPath);
}
