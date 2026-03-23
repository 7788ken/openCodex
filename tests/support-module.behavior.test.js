import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';

import { loadSupportConfig } from '../src/lib/support/config.js';
import { createSupportService } from '../src/lib/support/service.js';

function buildEmptyState() {
  return {
    next_ticket_seq: 1,
    tickets: [],
    events: []
  };
}

test('loadSupportConfig reads support_module alias from parent directory and keeps defaults', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencodex-support-config-parent-'));
  const nested = path.join(root, 'a', 'b');
  await mkdir(nested, { recursive: true });

  const configPath = path.join(root, 'opencodex.config.json');
  await writeFile(configPath, JSON.stringify({
    support_module: {
      enabled: true,
      channels: {
        telegram_group: {
          chat_ids: ['1001']
        }
      }
    }
  }, null, 2));

  const loaded = loadSupportConfig(nested);
  assert.equal(loaded.configPath, configPath);
  assert.equal(loaded.config.enabled, true);
  assert.deepEqual(loaded.config.channels.telegram_group.chatIds, ['1001']);
  assert.equal(loaded.config.channels.telegram_group.enabled, true);
  assert.equal(loaded.config.channels.xianyu_personal.enabled, false);
  assert.equal(loaded.config.routing.defaultQueue, 'after_sales');
});

test('loadSupportConfig fails fast when routing.rules is not an array', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'opencodex-support-config-invalid-routing-'));
  await writeFile(path.join(cwd, 'opencodex.config.json'), JSON.stringify({
    support: {
      enabled: true,
      routing: {
        rules: {
          channel: 'telegram_group',
          queue: 'invalid'
        }
      }
    }
  }, null, 2));

  assert.throws(
    () => loadSupportConfig(cwd),
    /routing\.rules must be an array/
  );
});

test('service routes by channel/order type, dispatches only handled messages, and respects Telegram chat whitelist', async () => {
  const outbound = [];
  let saveCount = 0;

  const service = createSupportService({
    config: {
      enabled: true,
      channels: {
        telegram_group: {
          enabled: true,
          chatIds: ['1001']
        },
        xianyu_personal: {
          enabled: true,
          mode: 'mock'
        }
      },
      routing: {
        defaultQueue: 'after_sales',
        rules: [
          {
            channel: 'telegram_group',
            chatId: '1001',
            orderType: 'order_after_sales',
            queue: 'tg-priority'
          },
          {
            channel: 'xianyu_personal',
            userId: 'buyer-1',
            queue: 'xy-priority'
          }
        ]
      }
    },
    state: buildEmptyState(),
    saveState: async () => {
      saveCount += 1;
    },
    adapters: {
      telegram_group: {
        async send(context, message) {
          outbound.push({ channel: 'telegram_group', context, message });
        }
      },
      xianyu_personal: {
        async send(context, message) {
          outbound.push({ channel: 'xianyu_personal', context, message });
        }
      }
    }
  });

  const tgHandled = await service.handleInbound({
    channel: 'telegram_group',
    chatId: '1001',
    senderId: 'seller-a',
    userId: 'seller-a',
    threadKey: 'tg:1001',
    text: '#support 订单 ORDER1001 申请退款'
  });
  assert.equal(tgHandled.handled, true);
  assert.equal(tgHandled.route.queue, 'tg-priority');
  assert.equal(tgHandled.ticket.channel, 'telegram_group');
  assert.equal(outbound.length, 1);
  assert.equal(outbound[0].channel, 'telegram_group');
  assert.equal(saveCount, 1);

  const tgIgnored = await service.handleInbound({
    channel: 'telegram_group',
    chatId: '1001',
    senderId: 'seller-a',
    userId: 'seller-a',
    threadKey: 'tg:1001',
    text: 'just chatting without support intent'
  });
  assert.equal(tgIgnored.handled, false);
  assert.equal(tgIgnored.reason, 'not_support_intent');
  assert.equal(outbound.length, 1);
  assert.equal(saveCount, 1);

  const tgNotRouted = await service.handleInbound({
    channel: 'telegram_group',
    chatId: '2002',
    senderId: 'seller-b',
    userId: 'seller-b',
    threadKey: 'tg:2002',
    text: '#support 订单 ORDER2002 退款'
  });
  assert.equal(tgNotRouted.handled, false);
  assert.equal(tgNotRouted.reason, 'chat_not_routed');
  assert.equal(outbound.length, 1);
  assert.equal(saveCount, 1);

  const xyHandled = await service.handleInbound({
    channel: 'xianyu_personal',
    userId: 'buyer-1',
    senderId: 'buyer-1',
    threadKey: 'xy:buyer-1',
    text: 'order XY900 after-sales request'
  });
  assert.equal(xyHandled.handled, true);
  assert.equal(xyHandled.route.queue, 'xy-priority');
  assert.equal(xyHandled.ticket.channel, 'xianyu_personal');
  assert.equal(outbound.length, 2);
  assert.equal(outbound[1].channel, 'xianyu_personal');
  assert.equal(saveCount, 2);
});

test('service applies ticket transitions and returns readable reply for unknown ticket transition', async () => {
  let saveCount = 0;

  const state = buildEmptyState();
  const service = createSupportService({
    config: {
      enabled: true,
      channels: {
        telegram_group: {
          enabled: true,
          chatIds: ['1001']
        },
        xianyu_personal: {
          enabled: false,
          mode: 'mock'
        }
      },
      routing: {
        defaultQueue: 'after_sales',
        rules: []
      }
    },
    state,
    saveState: async () => {
      saveCount += 1;
    },
    adapters: {
      telegram_group: { async send() {} },
      xianyu_personal: { async send() {} }
    }
  });

  const created = await service.handleInbound({
    channel: 'telegram_group',
    chatId: '1001',
    senderId: 'owner-a',
    userId: 'owner-a',
    threadKey: 'tg:1001',
    text: '#support 订单 O100 售后'
  });
  assert.equal(created.ticket.id, 'SUP-0001');
  assert.equal(created.ticket.state, 'open');

  const take = await service.handleInbound({
    channel: 'telegram_group',
    chatId: '1001',
    senderId: 'agent-b',
    userId: 'agent-b',
    threadKey: 'tg:1001',
    text: '/support take SUP-0001'
  });
  assert.equal(take.ticket.state, 'processing');
  assert.equal(take.ticket.assignee, 'agent-b');

  const wait = await service.handleInbound({
    channel: 'telegram_group',
    chatId: '1001',
    senderId: 'agent-b',
    userId: 'agent-b',
    threadKey: 'tg:1001',
    text: '/support wait SUP-0001'
  });
  assert.equal(wait.ticket.state, 'waiting_buyer');

  const resolve = await service.handleInbound({
    channel: 'telegram_group',
    chatId: '1001',
    senderId: 'agent-b',
    userId: 'agent-b',
    threadKey: 'tg:1001',
    text: '/support resolve SUP-0001'
  });
  assert.equal(resolve.ticket.state, 'resolved');

  const close = await service.handleInbound({
    channel: 'telegram_group',
    chatId: '1001',
    senderId: 'agent-b',
    userId: 'agent-b',
    threadKey: 'tg:1001',
    text: '/support close SUP-0001'
  });
  assert.equal(close.ticket.state, 'closed');
  assert.equal(saveCount, 5);

  const notFound = await service.handleInbound({
    channel: 'telegram_group',
    chatId: '1001',
    senderId: 'agent-b',
    userId: 'agent-b',
    threadKey: 'tg:1001',
    text: '/support close SUP-9999'
  });

  assert.equal(notFound.handled, true);
  assert.equal(notFound.ticket, null);
  assert.match(notFound.replyText, /没找到工单 SUP-9999/);
  assert.equal(saveCount, 5);
});
