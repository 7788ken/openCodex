import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const CONFIG_FILE_NAME = 'opencodex.config.json';

export function loadSupportConfig(cwd = process.cwd()) {
  const configPath = findProjectConfigPath(cwd);
  if (!configPath) {
    return { configPath: '', config: buildDefaultSupportConfig() };
  }

  const raw = parseConfigFile(configPath);
  const section = raw.support || raw.support_module || null;
  const config = normalizeSupportConfig(section, configPath);
  return { configPath, config };
}

function parseConfigFile(configPath) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid openCodex config at ${configPath}: ${error.message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid openCodex config at ${configPath}: config must be a JSON object`);
  }

  return parsed;
}

function normalizeSupportConfig(input, configPath) {
  if (!input) {
    return buildDefaultSupportConfig();
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`Invalid support config at ${configPath}: support must be a JSON object`);
  }

  const enabled = input.enabled === true;
  const statePath = typeof input.state_path === 'string' && input.state_path.trim()
    ? input.state_path.trim()
    : '.opencodex/support/state.json';

  const tg = input.channels?.telegram_group || {};
  const xy = input.channels?.xianyu_personal || {};

  const routingRules = normalizeRoutingRules(input.routing?.rules || [], configPath);
  const defaultQueue = normalizeQueueName(input.routing?.default_queue || 'after_sales', 'default_queue', configPath);

  return {
    enabled,
    statePath,
    channels: {
      telegram_group: {
        enabled: tg.enabled !== false,
        chatIds: normalizeStringArray(tg.chat_ids),
        defaultAssignee: normalizeOptionalString(tg.default_assignee)
      },
      xianyu_personal: {
        enabled: xy.enabled === true,
        mode: normalizeXianyuMode(xy.mode, configPath),
        defaultAssignee: normalizeOptionalString(xy.default_assignee)
      }
    },
    routing: {
      defaultQueue,
      rules: routingRules
    }
  };
}

function normalizeRoutingRules(rules, configPath) {
  if (!Array.isArray(rules)) {
    throw new Error(`Invalid support config at ${configPath}: routing.rules must be an array`);
  }

  return rules.map((rule, index) => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new Error(`Invalid support config at ${configPath}: routing.rules[${index}] must be an object`);
    }

    const channel = normalizeChannelName(rule.channel, `routing.rules[${index}].channel`, configPath);
    const queue = normalizeQueueName(rule.queue || 'after_sales', `routing.rules[${index}].queue`, configPath);

    return {
      channel,
      queue,
      chatId: normalizeOptionalString(rule.chat_id),
      userId: normalizeOptionalString(rule.user_id),
      orderType: normalizeOptionalString(rule.order_type)
    };
  });
}

function normalizeChannelName(value, fieldName, configPath) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(`Invalid support config at ${configPath}: ${fieldName} is required`);
  }
  if (normalized !== 'telegram_group' && normalized !== 'xianyu_personal') {
    throw new Error(`Invalid support config at ${configPath}: ${fieldName} must be telegram_group or xianyu_personal`);
  }
  return normalized;
}

function normalizeXianyuMode(value, configPath) {
  const mode = normalizeOptionalString(value) || 'mock';
  if (mode !== 'mock') {
    throw new Error(`Invalid support config at ${configPath}: xianyu_personal.mode only supports mock in current slice`);
  }
  return mode;
}

function normalizeQueueName(value, fieldName, configPath) {
  const queue = String(value || '').trim();
  if (!queue) {
    throw new Error(`Invalid support config at ${configPath}: ${fieldName} is required`);
  }
  return queue;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function normalizeOptionalString(value) {
  const normalized = String(value || '').trim();
  return normalized || '';
}

function findProjectConfigPath(cwd) {
  let current = path.resolve(cwd || process.cwd());
  while (true) {
    const candidate = path.join(current, CONFIG_FILE_NAME);
    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return '';
    }
    current = parent;
  }
}

function buildDefaultSupportConfig() {
  return {
    enabled: false,
    statePath: '.opencodex/support/state.json',
    channels: {
      telegram_group: {
        enabled: true,
        chatIds: [],
        defaultAssignee: ''
      },
      xianyu_personal: {
        enabled: false,
        mode: 'mock',
        defaultAssignee: ''
      }
    },
    routing: {
      defaultQueue: 'after_sales',
      rules: []
    }
  };
}
