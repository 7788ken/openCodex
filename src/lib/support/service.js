import { toIsoString } from '../fs.js';

const TICKET_STATES = ['open', 'processing', 'waiting_buyer', 'resolved', 'closed'];

export function createSupportService({ config, state, saveState, adapters }) {
  if (!config || typeof config !== 'object') {
    throw new Error('Support service requires config');
  }
  if (!state || typeof state !== 'object') {
    throw new Error('Support service requires state');
  }
  if (typeof saveState !== 'function') {
    throw new Error('Support service requires saveState()');
  }

  return {
    async handleInbound(event) {
      const normalized = normalizeInboundEvent(event);
      if (!normalized) {
        return { handled: false, reason: 'empty_message' };
      }

      const channelConfig = config.channels?.[normalized.channel];
      if (!channelConfig?.enabled) {
        return { handled: false, reason: 'channel_disabled' };
      }

      if (normalized.channel === 'telegram_group'
        && Array.isArray(channelConfig.chatIds)
        && channelConfig.chatIds.length > 0
        && !channelConfig.chatIds.includes(normalized.chatId)) {
        return { handled: false, reason: 'chat_not_routed' };
      }

      if (!isSupportIntent(normalized.text)) {
        return { handled: false, reason: 'not_support_intent' };
      }

      const route = resolveRoute(config, normalized);
      const parsedAction = parseSupportAction(normalized.text);

      let ticket;
      let action;
      if (parsedAction.kind === 'transition') {
        ticket = findTicketById(state, parsedAction.ticketId);
        if (!ticket) {
          return {
            handled: true,
            replyText: `没找到工单 ${parsedAction.ticketId}，请先创建或检查编号。`,
            route,
            ticket: null
          };
        }
        applyTicketTransition(ticket, parsedAction.targetState, normalized.senderId);
        action = `transition:${parsedAction.targetState}`;
      } else {
        ticket = getOpenTicketByThread(state, normalized.threadKey);
        if (!ticket) {
          ticket = createTicket(state, normalized, route);
          action = 'create';
        } else {
          action = 'append';
        }
        ticket.last_message = normalized.text;
        ticket.updated_at = toIsoString();
      }

      appendEvent(state, {
        id: `EV-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        action,
        ticket_id: ticket.id,
        channel: normalized.channel,
        chat_id: normalized.chatId,
        user_id: normalized.userId,
        sender_id: normalized.senderId,
        message: normalized.text,
        created_at: toIsoString()
      });

      await saveState(state);

      const replyText = buildReplyText(ticket, action, route);
      const adapter = adapters?.[normalized.channel];
      if (adapter?.send) {
        await adapter.send(normalized, replyText);
      }

      return {
        handled: true,
        route,
        ticket,
        action,
        replyText
      };
    },
    listTickets() {
      return [...(state.tickets || [])];
    },
    getState() {
      return state;
    }
  };
}

function normalizeInboundEvent(event) {
  if (!event || typeof event !== 'object') {
    return null;
  }
  const channel = String(event.channel || '').trim();
  const text = String(event.text || '').trim();
  if (!channel || !text) {
    return null;
  }

  const chatId = String(event.chatId || '').trim();
  const userId = String(event.userId || '').trim();
  const senderId = String(event.senderId || '').trim();
  const threadKey = event.threadKey
    ? String(event.threadKey)
    : (channel === 'telegram_group' ? `tg:${chatId}` : `xy:${userId}`);

  return {
    channel,
    text,
    chatId,
    userId,
    senderId,
    threadKey
  };
}

function resolveRoute(config, event) {
  const rules = Array.isArray(config?.routing?.rules) ? config.routing.rules : [];
  for (const rule of rules) {
    if (rule.channel !== event.channel) {
      continue;
    }
    if (rule.chatId && rule.chatId !== event.chatId) {
      continue;
    }
    if (rule.userId && rule.userId !== event.userId) {
      continue;
    }
    if (rule.orderType && detectOrderType(event.text) !== rule.orderType) {
      continue;
    }
    return {
      queue: rule.queue,
      channel: event.channel
    };
  }

  return {
    queue: config?.routing?.defaultQueue || 'after_sales',
    channel: event.channel
  };
}

function parseSupportAction(text) {
  const value = String(text || '');
  const patterns = [
    { regex: /(?:\/support|#support)\s+(?:take|接单)\s+(SUP-\d+)/i, targetState: 'processing' },
    { regex: /(?:\/support|#support)\s+(?:wait|待买家)\s+(SUP-\d+)/i, targetState: 'waiting_buyer' },
    { regex: /(?:\/support|#support)\s+(?:resolve|完成)\s+(SUP-\d+)/i, targetState: 'resolved' },
    { regex: /(?:\/support|#support)\s+(?:close|关闭)\s+(SUP-\d+)/i, targetState: 'closed' }
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern.regex);
    if (match) {
      return {
        kind: 'transition',
        targetState: pattern.targetState,
        ticketId: String(match[1] || '').toUpperCase()
      };
    }
  }

  return {
    kind: 'create_or_append'
  };
}

function createTicket(state, event, route) {
  const seq = Number.isInteger(state.next_ticket_seq) && state.next_ticket_seq > 0
    ? state.next_ticket_seq
    : 1;
  const ticketId = `SUP-${String(seq).padStart(4, '0')}`;
  state.next_ticket_seq = seq + 1;

  const orderId = extractOrderId(event.text);
  const now = toIsoString();
  const ticket = {
    id: ticketId,
    channel: event.channel,
    queue: route.queue,
    type: orderId ? 'order_after_sales' : 'ticket',
    state: 'open',
    thread_key: event.threadKey,
    order_id: orderId,
    chat_id: event.chatId,
    user_id: event.userId,
    requester_id: event.senderId,
    assignee: '',
    created_at: now,
    updated_at: now,
    last_message: event.text
  };

  state.tickets.push(ticket);
  return ticket;
}

function getOpenTicketByThread(state, threadKey) {
  return state.tickets.find((ticket) => ticket.thread_key === threadKey && !['resolved', 'closed'].includes(ticket.state)) || null;
}

function findTicketById(state, ticketId) {
  const normalizedId = String(ticketId || '').toUpperCase();
  return state.tickets.find((ticket) => String(ticket.id || '').toUpperCase() === normalizedId) || null;
}

function applyTicketTransition(ticket, targetState, operatorId) {
  if (!TICKET_STATES.includes(targetState)) {
    throw new Error(`Unsupported ticket state transition target: ${targetState}`);
  }

  ticket.state = targetState;
  ticket.updated_at = toIsoString();

  if (!ticket.assignee && operatorId && targetState === 'processing') {
    ticket.assignee = operatorId;
  }
}

function appendEvent(state, event) {
  state.events.push(event);
  if (state.events.length > 500) {
    state.events = state.events.slice(-500);
  }
}

function buildReplyText(ticket, action, route) {
  if (!ticket) {
    return '这条支持请求已接收，但当前没有可更新的工单。';
  }

  if (action.startsWith('transition:')) {
    return `工单 ${ticket.id} 已更新为 ${ticket.state}（队列 ${route.queue}）。`;
  }

  if (action === 'append') {
    return `已记录到工单 ${ticket.id}，当前状态 ${ticket.state}（队列 ${route.queue}）。`;
  }

  return `已创建工单 ${ticket.id}，类型 ${ticket.type}，队列 ${route.queue}，状态 ${ticket.state}。`;
}

function isSupportIntent(text) {
  return /(?:\/support|#support|售后|退款|退货|订单|after[-\s]?sales|order)/i.test(String(text || ''));
}

function extractOrderId(text) {
  const match = String(text || '').match(/(?:订单|order)\s*[:#]?\s*([A-Za-z0-9_-]{4,})/i);
  return match ? String(match[1]) : '';
}

function detectOrderType(text) {
  return extractOrderId(text) ? 'order_after_sales' : 'ticket';
}
