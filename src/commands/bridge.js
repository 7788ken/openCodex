import os from 'node:os';
import path from 'node:path';
import { parseOptions } from '../lib/args.js';
import { inspectCurrentCodexCandidate, inspectRegisteredBridge, registerCodexBridge, resolveBridgeStatePath, resolveBridgeStateRoot } from '../lib/bridge-state.js';

const STATUS_OPTION_SPEC = {
  json: { type: 'boolean' },
  cwd: { type: 'string' }
};

const REGISTER_CODEX_OPTION_SPEC = {
  json: { type: 'boolean' },
  cwd: { type: 'string' },
  path: { type: 'string' }
};

export async function runBridgeCommand(args) {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    process.stdout.write(
      'Usage:\n' +
      '  opencodex bridge status [--json] [--cwd <dir>]\n' +
      '  opencodex bridge register-codex [--path <path>] [--json] [--cwd <dir>]\n'
    );
    return;
  }

  if (subcommand === 'status') {
    await runBridgeStatus(rest);
    return;
  }

  if (subcommand === 'register-codex') {
    await runBridgeRegisterCodex(rest);
    return;
  }

  throw new Error(`Unknown bridge subcommand: ${subcommand}`);
}

async function runBridgeStatus(args) {
  const { options, positionals } = parseOptions(args, STATUS_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex bridge status` does not accept positional arguments');
  }

  const cwd = path.resolve(options.cwd || process.cwd());
  const homeDir = os.homedir();
  const bridgeRecord = await inspectRegisteredBridge({ cwd, env: process.env, homeDir });
  const detectedCodex = !bridgeRecord.exists || bridgeRecord.error || !bridgeRecord.registration?.valid
    ? await inspectCurrentCodexCandidate({ cwd, env: process.env })
    : null;
  const payload = buildBridgeStatusPayload({
    homeDir,
    bridgeRecord,
    detectedCodex
  });

  renderBridgePayload(payload, options.json);
}

async function runBridgeRegisterCodex(args) {
  const { options, positionals } = parseOptions(args, REGISTER_CODEX_OPTION_SPEC);
  if (positionals.length) {
    throw new Error('`opencodex bridge register-codex` does not accept positional arguments');
  }

  const cwd = path.resolve(options.cwd || process.cwd());
  const result = await registerCodexBridge({
    cwd,
    env: process.env,
    homeDir: os.homedir(),
    pathValue: options.path || ''
  });

  const payload = {
    ok: true,
    action: 'register-codex',
    registered: true,
    state_root: result.stateRoot,
    state_path: result.statePath,
    state_schema: result.state.schema,
    codex: {
      ...result.state.codex,
      valid: result.registration.valid,
      validation_error: result.registration.validation_error
    },
    bridge: result.state.bridge,
    next_steps: [
      'Use `opencodex bridge status` to inspect the saved launcher state.',
      'Run `opencodex doctor` to verify that the installed bridge state and the detached launcher are aligned.'
    ]
  };

  renderBridgePayload(payload, options.json);
}

function buildBridgeStatusPayload({ homeDir, bridgeRecord, detectedCodex }) {
  const basePayload = {
    ok: true,
    action: 'status',
    registered: Boolean(bridgeRecord.exists && !bridgeRecord.error && bridgeRecord.state),
    state_root: resolveBridgeStateRoot({ homeDir }),
    state_path: resolveBridgeStatePath({ homeDir }),
    state_schema: bridgeRecord.state?.schema || '',
    codex: bridgeRecord.state?.codex || null,
    bridge: bridgeRecord.state?.bridge || {
      default_surface: 'cli',
      active_session_id: '',
      active_session_updated_at: ''
    },
    codex_valid: Boolean(bridgeRecord.registration?.valid),
    validation_error: bridgeRecord.registration?.validation_error || '',
    detected_codex: detectedCodex,
    next_steps: []
  };

  if (bridgeRecord.error) {
    basePayload.validation_error = `Bridge state could not be parsed: ${bridgeRecord.error.message}`;
    basePayload.next_steps.push('Repair the bridge state with `opencodex bridge register-codex --path <real-codex-path>`.');
    return basePayload;
  }

  if (!basePayload.registered) {
    if (detectedCodex?.valid) {
      basePayload.next_steps.push(`Run \`opencodex bridge register-codex --path ${detectedCodex.resolved_path}\` to persist the current Codex launcher.`);
    } else {
      basePayload.next_steps.push('Run `opencodex bridge register-codex --path <real-codex-path>` after confirming the installed Codex CLI path.');
    }
    return basePayload;
  }

  if (!bridgeRecord.registration?.valid) {
    basePayload.next_steps.push('Repair the bridge state with `opencodex bridge register-codex --path <real-codex-path>`.');
    return basePayload;
  }

  basePayload.next_steps.push('Bridge state looks ready for the next shim-install and live-session phases.');
  return basePayload;
}

function renderBridgePayload(payload, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  const lines = [];
  lines.push(payload.action === 'register-codex' ? 'Codex bridge registered' : 'Codex bridge status');
  lines.push('');
  lines.push(`Registered: ${payload.registered ? 'yes' : 'no'}`);
  lines.push(`State Root: ${payload.state_root}`);
  lines.push(`State Path: ${payload.state_path}`);

  if (payload.codex) {
    lines.push(`Codex Path: ${payload.codex.path || '(none)'}`);
    lines.push(`Resolved Path: ${payload.codex.resolved_path || '(none)'}`);
    lines.push(`Source: ${payload.codex.source || '(none)'}`);
    lines.push(`Version: ${payload.codex.version || '(unknown)'}`);
    lines.push(`Valid: ${payload.codex_valid ? 'yes' : 'no'}`);
  }

  if (payload.detected_codex?.resolved_path) {
    lines.push(`Detected Codex: ${payload.detected_codex.resolved_path}`);
  }

  if (payload.validation_error) {
    lines.push(`Validation Error: ${payload.validation_error}`);
  }

  if (Array.isArray(payload.next_steps) && payload.next_steps.length) {
    lines.push('Next Steps:');
    for (const step of payload.next_steps) {
      lines.push(`- ${step}`);
    }
  }

  process.stdout.write(`${lines.join('\n')}\n`);
}
