import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const cli = path.resolve('bin/opencodex.js');

test('support status returns default disabled config when no project config exists', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-support-default-'));
  const result = await runCli(['support', 'status', '--cwd', cwd, '--json']);
  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.enabled, false);
  assert.equal(payload.ticket_count, 0);
  assert.equal(payload.routing.defaultQueue, 'after_sales');
});

test('support simulate routes telegram after-sales ticket and persists state transitions', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-support-telegram-'));
  await writeFile(path.join(cwd, 'opencodex.config.json'), JSON.stringify({
    support: {
      enabled: true,
      channels: {
        telegram_group: {
          enabled: true,
          chat_ids: ['1001']
        },
        xianyu_personal: {
          enabled: false
        }
      },
      routing: {
        default_queue: 'after_sales',
        rules: [
          {
            channel: 'telegram_group',
            chat_id: '1001',
            queue: 'tg_group_queue'
          }
        ]
      }
    }
  }, null, 2));

  const createResult = await runCli([
    'support', 'simulate',
    '--cwd', cwd,
    '--channel', 'telegram_group',
    '--chat-id', '1001',
    '--sender-id', 'seller-a',
    '--text', '售后 订单A100 需要退款',
    '--json'
  ]);
  assert.equal(createResult.code, 0);
  const created = JSON.parse(createResult.stdout);
  assert.equal(created.handled, true);
  assert.equal(created.ticket.id, 'SUP-0001');
  assert.equal(created.ticket.type, 'order_after_sales');
  assert.equal(created.ticket.queue, 'tg_group_queue');
  assert.match(created.reply_text, /已创建工单 SUP-0001/);

  const transitionResult = await runCli([
    'support', 'simulate',
    '--cwd', cwd,
    '--channel', 'telegram_group',
    '--chat-id', '1001',
    '--sender-id', 'seller-a',
    '--text', '/support resolve SUP-0001',
    '--json'
  ]);
  assert.equal(transitionResult.code, 0);
  const transitioned = JSON.parse(transitionResult.stdout);
  assert.equal(transitioned.handled, true);
  assert.equal(transitioned.ticket.id, 'SUP-0001');
  assert.equal(transitioned.ticket.state, 'resolved');

  const statusResult = await runCli(['support', 'status', '--cwd', cwd, '--json']);
  assert.equal(statusResult.code, 0);
  const statusPayload = JSON.parse(statusResult.stdout);
  assert.equal(statusPayload.enabled, true);
  assert.equal(statusPayload.ticket_count, 1);
});

test('support simulate supports xianyu mock channel and custom routing rule', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-support-xianyu-'));
  await writeFile(path.join(cwd, 'opencodex.config.json'), JSON.stringify({
    support_module: {
      enabled: true,
      channels: {
        telegram_group: {
          enabled: false
        },
        xianyu_personal: {
          enabled: true,
          mode: 'mock'
        }
      },
      routing: {
        default_queue: 'after_sales',
        rules: [
          {
            channel: 'xianyu_personal',
            user_id: 'buyer-1',
            queue: 'xianyu_queue'
          }
        ]
      }
    }
  }, null, 2));

  const result = await runCli([
    'support', 'simulate',
    '--cwd', cwd,
    '--channel', 'xianyu_personal',
    '--user-id', 'buyer-1',
    '--sender-id', 'buyer-1',
    '--text', 'order XY99 after-sales request',
    '--json'
  ]);

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.handled, true);
  assert.equal(payload.ticket.queue, 'xianyu_queue');
  assert.equal(payload.outbound.length, 1);
  assert.equal(payload.outbound[0].channel, 'xianyu_personal');
});

test('support simulate can transition ticket through processing/waiting/closed with operator assignment', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-support-transition-'));
  await writeFile(path.join(cwd, 'opencodex.config.json'), JSON.stringify({
    support: {
      enabled: true,
      channels: {
        telegram_group: {
          enabled: true,
          chat_ids: ['2002']
        },
        xianyu_personal: {
          enabled: false
        }
      },
      routing: {
        default_queue: 'after_sales',
        rules: []
      }
    }
  }, null, 2));

  const create = await runCli([
    'support', 'simulate',
    '--cwd', cwd,
    '--channel', 'telegram_group',
    '--chat-id', '2002',
    '--sender-id', 'owner-a',
    '--text', '#support 订单 T2002 申请售后',
    '--json'
  ]);
  assert.equal(create.code, 0);
  const created = JSON.parse(create.stdout);
  assert.equal(created.ticket.id, 'SUP-0001');
  assert.equal(created.ticket.state, 'open');

  const take = await runCli([
    'support', 'simulate',
    '--cwd', cwd,
    '--channel', 'telegram_group',
    '--chat-id', '2002',
    '--sender-id', 'agent-b',
    '--text', '#support take SUP-0001',
    '--json'
  ]);
  assert.equal(take.code, 0);
  const taken = JSON.parse(take.stdout);
  assert.equal(taken.ticket.state, 'processing');
  assert.equal(taken.ticket.assignee, 'agent-b');

  const wait = await runCli([
    'support', 'simulate',
    '--cwd', cwd,
    '--channel', 'telegram_group',
    '--chat-id', '2002',
    '--sender-id', 'agent-b',
    '--text', '#support wait SUP-0001',
    '--json'
  ]);
  assert.equal(wait.code, 0);
  const waiting = JSON.parse(wait.stdout);
  assert.equal(waiting.ticket.state, 'waiting_buyer');

  const close = await runCli([
    'support', 'simulate',
    '--cwd', cwd,
    '--channel', 'telegram_group',
    '--chat-id', '2002',
    '--sender-id', 'agent-b',
    '--text', '#support close SUP-0001',
    '--json'
  ]);
  assert.equal(close.code, 0);
  const closed = JSON.parse(close.stdout);
  assert.equal(closed.ticket.state, 'closed');
});

test('support status fails fast on invalid xianyu mode in config parsing', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-support-invalid-mode-'));
  await writeFile(path.join(cwd, 'opencodex.config.json'), JSON.stringify({
    support: {
      enabled: true,
      channels: {
        xianyu_personal: {
          enabled: true,
          mode: 'live'
        }
      }
    }
  }, null, 2));

  const result = await runCli(['support', 'status', '--cwd', cwd, '--json']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /xianyu_personal\.mode only supports mock/);
});

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [cli, ...args], {
      env: process.env,
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
