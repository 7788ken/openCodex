import path from 'node:path';
import { parseOptions } from '../lib/args.js';
import { createSupportRuntime } from '../lib/support/runtime.js';

const SUPPORT_STATUS_OPTION_SPEC = {
  cwd: { type: 'string' },
  json: { type: 'boolean' }
};

const SUPPORT_SIMULATE_OPTION_SPEC = {
  cwd: { type: 'string' },
  channel: { type: 'string' },
  text: { type: 'string' },
  'chat-id': { type: 'string' },
  'user-id': { type: 'string' },
  'sender-id': { type: 'string' },
  json: { type: 'boolean' }
};

export async function runSupportCommand(args) {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    process.stdout.write(
      'Usage:\n' +
      '  opencodex support status [--cwd <dir>] [--json]\n' +
      '  opencodex support simulate --channel <telegram_group|xianyu_personal> --text <text> [--chat-id <id>] [--user-id <id>] [--sender-id <id>] [--json]\n'
    );
    return;
  }

  if (subcommand === 'status') {
    await runSupportStatus(rest);
    return;
  }

  if (subcommand === 'simulate') {
    await runSupportSimulate(rest);
    return;
  }

  throw new Error(`Unknown support subcommand: ${subcommand}`);
}

async function runSupportStatus(args) {
  const { options, positionals } = parseOptions(args, SUPPORT_STATUS_OPTION_SPEC);
  if (positionals.length > 0) {
    throw new Error('`opencodex support status` does not accept positional arguments');
  }

  const cwd = path.resolve(options.cwd || process.cwd());
  const runtime = await createSupportRuntime({ cwd });

  const payload = {
    enabled: runtime.enabled,
    config_path: runtime.configPath,
    state_path: runtime.statePath,
    channels: runtime.config.channels,
    routing: runtime.config.routing,
    ticket_count: runtime.service.listTickets().length
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    `Support module: ${payload.enabled ? 'enabled' : 'disabled'}\n`
    + `State path: ${payload.state_path}\n`
    + `Tickets: ${payload.ticket_count}\n`
  );
}

async function runSupportSimulate(args) {
  const { options, positionals } = parseOptions(args, SUPPORT_SIMULATE_OPTION_SPEC);
  if (positionals.length > 0) {
    throw new Error('`opencodex support simulate` does not accept positional arguments');
  }

  const channel = String(options.channel || '').trim();
  const text = String(options.text || '').trim();
  if (!channel) {
    throw new Error('`opencodex support simulate` requires `--channel <telegram_group|xianyu_personal>`');
  }
  if (channel !== 'telegram_group' && channel !== 'xianyu_personal') {
    throw new Error('`opencodex support simulate --channel` only supports telegram_group or xianyu_personal');
  }
  if (!text) {
    throw new Error('`opencodex support simulate` requires `--text <text>`');
  }

  const cwd = path.resolve(options.cwd || process.cwd());
  const outbound = [];
  const runtime = await createSupportRuntime({
    cwd,
    onTelegramOutbound: async (context, message) => {
      outbound.push({ channel: 'telegram_group', context, message });
    },
    onXianyuOutbound: async (context, message) => {
      outbound.push({ channel: 'xianyu_personal', context, message });
    }
  });

  const result = channel === 'telegram_group'
    ? await runtime.handleTelegramInbound({
      text,
      chat_id: String(options['chat-id'] || ''),
      sender_id: String(options['sender-id'] || options['user-id'] || '')
    })
    : await runtime.handleXianyuInbound({
      text,
      user_id: String(options['user-id'] || ''),
      sender_id: String(options['sender-id'] || options['user-id'] || '')
    });

  const payload = {
    enabled: runtime.enabled,
    handled: Boolean(result?.handled),
    reason: result?.reason || '',
    reply_text: result?.replyText || '',
    ticket: result?.ticket || null,
    route: result?.route || null,
    outbound
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    `Handled: ${payload.handled ? 'yes' : 'no'}\n`
    + `${payload.reply_text ? `Reply: ${payload.reply_text}\n` : ''}`
    + `${payload.ticket ? `Ticket: ${payload.ticket.id} (${payload.ticket.state})\n` : ''}`
  );
}
