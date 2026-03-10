import path from 'node:path';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';

export function normalizeNodeLauncherPath(nodePath) {
  return path.resolve(String(nodePath || process.execPath));
}

export function normalizeCliLauncherPath(cliPath, fallbackPath = '') {
  const candidate = typeof cliPath === 'string' && cliPath.trim()
    ? cliPath.trim()
    : (typeof fallbackPath === 'string' && fallbackPath.trim() ? fallbackPath.trim() : '');
  return path.resolve(candidate || process.argv[1] || '');
}

export function canonicalizeCliLauncherPath(cliPath, fallbackPath = '') {
  const normalizedPath = normalizeCliLauncherPath(cliPath, fallbackPath);
  try {
    return realpathSync(normalizedPath);
  } catch {
    return normalizedPath;
  }
}

export function resolveOpenCodexRoot(cliPath, fallbackPath = '') {
  let current = path.dirname(canonicalizeCliLauncherPath(cliPath, fallbackPath));
  return resolveOpenCodexRootFromDirectory(current);
}

function normalizeOpenCodexPath(targetPath, fallbackPath = '') {
  const candidate = typeof targetPath === 'string' && targetPath.trim()
    ? targetPath.trim()
    : (typeof fallbackPath === 'string' && fallbackPath.trim() ? fallbackPath.trim() : '');
  return path.resolve(candidate || process.cwd());
}

function canonicalizeOpenCodexPath(targetPath, fallbackPath = '') {
  const normalizedPath = normalizeOpenCodexPath(targetPath, fallbackPath);
  try {
    return realpathSync(normalizedPath);
  } catch {
    return normalizedPath;
  }
}

function resolveOpenCodexRootFromDirectory(startPath) {
  let current = startPath;

  while (current && current !== path.dirname(current)) {
    const packageJsonPath = path.join(current, 'package.json');
    if (existsSync(packageJsonPath)) {
      try {
        const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
        if (parsed?.name === 'opencodex') {
          return current;
        }
      } catch {
      }
    }
    current = path.dirname(current);
  }

  return '';
}

export function describeOpenCodexPath(targetPath, fallbackPath = '') {
  const normalizedPath = normalizeOpenCodexPath(targetPath, fallbackPath);
  let startPath = canonicalizeOpenCodexPath(normalizedPath, fallbackPath);
  try {
    if (statSync(startPath).isFile()) {
      startPath = path.dirname(startPath);
    }
  } catch {
    startPath = path.dirname(startPath);
  }

  const rootPath = resolveOpenCodexRootFromDirectory(startPath);
  const projectCheckout = Boolean(rootPath && existsSync(path.join(rootPath, '.git')));
  return {
    path: normalizedPath,
    rootPath,
    pathScope: projectCheckout ? 'project_checkout' : 'external_path'
  };
}

export function describeOpenCodexLauncher(cliPath, fallbackPath = '') {
  const normalizedPath = normalizeCliLauncherPath(cliPath, fallbackPath);
  const rootPath = resolveOpenCodexRoot(normalizedPath, fallbackPath);
  const projectCheckout = Boolean(rootPath && existsSync(path.join(rootPath, '.git')));

  return {
    cliPath: normalizedPath,
    rootPath,
    launcherScope: projectCheckout ? 'project_checkout' : 'installed_cli'
  };
}
