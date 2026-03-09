import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const DEFAULT_PROFILE = 'balanced';
const CONFIG_FILE_NAME = 'opencodex.config.json';
const DEFAULT_REASONING_EFFORT = 'medium';

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

  return {
    name,
    args: ['-a', 'never', '-s', resolveSandboxMode(preset, command), '-c', `model_reasoning_effort="${DEFAULT_REASONING_EFFORT}"`]
  };
}

export function listCodexProfiles() {
  return Object.keys(PROFILE_PRESETS);
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
