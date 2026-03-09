import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const DEFAULT_PROFILE = 'balanced';
const CONFIG_FILE_NAME = 'opencodex.config.json';
const DEFAULT_REASONING_EFFORT = 'medium';
const DEFAULT_APPROVAL_MODE = 'never';
const HOST_SANDBOX_ENV_KEYS = ['OPENCODEX_HOST_SANDBOX_MODE', 'CODEX_SANDBOX_MODE', 'SANDBOX_MODE'];
const SANDBOX_ORDER = Object.freeze({
  'read-only': 0,
  'workspace-write': 1,
  'danger-full-access': 2
});

const PROFILE_PRESETS = {
  safe: {
    sandboxByCommand: {
      default: 'read-only'
    }
  },
  balanced: {
    sandboxByCommand: {
      run: 'workspace-write',
      default: 'read-only'
    }
  },
  'full-access': {
    sandboxByCommand: {
      default: 'danger-full-access'
    }
  }
};

export function resolveCodexProfile(profileName, command = 'run', cwd = process.cwd()) {
  const name = resolveProfileName(profileName, command, cwd);
  const preset = PROFILE_PRESETS[name];

  if (!preset) {
    throw new Error(`Unknown profile: ${name}`);
  }

  const sandboxMode = resolveSandboxMode(preset, command);
  return {
    name,
    approvalMode: DEFAULT_APPROVAL_MODE,
    sandboxMode,
    args: ['-a', DEFAULT_APPROVAL_MODE, '-s', sandboxMode, '-c', `model_reasoning_effort="${DEFAULT_REASONING_EFFORT}"`]
  };
}

export function listCodexProfiles() {
  return Object.keys(PROFILE_PRESETS);
}

export function detectHostSandboxMode({ env = process.env, stderr = '', stdout = '', message = '' } = {}) {
  for (const key of HOST_SANDBOX_ENV_KEYS) {
    const value = normalizeSandboxMode(env?.[key]);
    if (value) {
      return value;
    }
  }

  return detectSandboxModeInText([stderr, stdout, message].filter(Boolean).join('\n'));
}

export function isSandboxModeStricter(actualMode, requestedMode) {
  return sandboxRank(actualMode) < sandboxRank(requestedMode);
}

export function isLikelySandboxRestriction({ requestedSandboxMode, hostSandboxMode = '', stderr = '', stdout = '', message = '' } = {}) {
  const requested = normalizeSandboxMode(requestedSandboxMode);
  if (!requested) {
    return false;
  }

  const host = normalizeSandboxMode(hostSandboxMode);
  if (host && isSandboxModeStricter(host, requested)) {
    return true;
  }

  if (requested === 'read-only') {
    return false;
  }

  return /(只读沙箱|read-only sandbox|Operation not permitted|\bEPERM\b|无法写入仓库|写入仓库会被拒绝|写入被拒绝|write access denied|cannot write|宿主环境.*只读|host environment.*read-only)/i
    .test([stderr, stdout, message].filter(Boolean).join('\n'));
}
function resolveSandboxMode(preset, command) {
  if (typeof preset?.sandboxByCommand?.[command] === 'string') {
    return preset.sandboxByCommand[command];
  }

  if (typeof preset?.sandboxByCommand?.default === 'string') {
    return preset.sandboxByCommand.default;
  }

  return 'read-only';
}

function resolveProfileName(profileName, command, cwd) {
  if (profileName) {
    return profileName;
  }

  const config = loadProjectProfileConfig(cwd);
  const commandProfile = config?.commands?.[command]?.profile;
  if (typeof commandProfile === 'string' && commandProfile.trim()) {
    return commandProfile.trim();
  }

  if (typeof config?.default_profile === 'string' && config.default_profile.trim()) {
    return config.default_profile.trim();
  }

  return DEFAULT_PROFILE;
}

function loadProjectProfileConfig(cwd) {
  const configPath = findProjectConfigPath(cwd);
  if (!configPath) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('config must be a JSON object');
    }
    return parsed;
  } catch (error) {
    throw new Error(`Invalid openCodex config at ${configPath}: ${error.message}`);
  }
}

function findProjectConfigPath(cwd) {
  let currentDir = path.resolve(cwd || process.cwd());

  while (true) {
    const candidate = path.join(currentDir, CONFIG_FILE_NAME);
    if (existsSync(candidate)) {
      return candidate;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}
function detectSandboxModeInText(value) {
  const text = String(value || '');
  if (!text.trim()) {
    return '';
  }

  const patterns = [
    /\bsandbox(?:_mode)?\s*[:=]\s*(read-only|workspace-write|danger-full-access)\b/i,
    /\b(read-only|workspace-write|danger-full-access)\b[^\n]{0,80}\bsandbox\b/i,
    /\bsandbox\b[^\n]{0,80}\b(read-only|workspace-write|danger-full-access)\b/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const normalized = normalizeSandboxMode(match?.[1] || match?.[0] || '');
    if (normalized) {
      return normalized;
    }
  }

  return '';
}

function normalizeSandboxMode(value) {
  const trimmed = String(value || '').trim().toLowerCase();
  if (trimmed === 'read-only') {
    return 'read-only';
  }
  if (trimmed === 'workspace-write') {
    return 'workspace-write';
  }
  if (trimmed === 'danger-full-access') {
    return 'danger-full-access';
  }
  return '';
}

function sandboxRank(mode) {
  const normalized = normalizeSandboxMode(mode);
  return normalized ? SANDBOX_ORDER[normalized] : -1;
}
