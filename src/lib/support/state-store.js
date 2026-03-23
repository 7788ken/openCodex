import path from 'node:path';
import { readTextIfExists, writeJson } from '../fs.js';

export async function loadSupportState(cwd, statePath) {
  const absoluteStatePath = resolveStatePath(cwd, statePath);
  const raw = await readTextIfExists(absoluteStatePath);
  if (!raw) {
    return {
      statePath: absoluteStatePath,
      state: buildEmptyState()
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid support state at ${absoluteStatePath}: ${error.message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid support state at ${absoluteStatePath}: state must be a JSON object`);
  }

  const tickets = Array.isArray(parsed.tickets) ? parsed.tickets : [];
  const events = Array.isArray(parsed.events) ? parsed.events : [];
  const nextTicketSeq = Number.isInteger(parsed.next_ticket_seq) && parsed.next_ticket_seq > 0
    ? parsed.next_ticket_seq
    : inferNextTicketSeq(tickets);

  return {
    statePath: absoluteStatePath,
    state: {
      next_ticket_seq: nextTicketSeq,
      tickets,
      events
    }
  };
}

export async function saveSupportState(statePath, state) {
  await writeJson(statePath, state);
}

export function resolveStatePath(cwd, statePath) {
  if (path.isAbsolute(statePath)) {
    return statePath;
  }
  return path.resolve(cwd, statePath);
}

function inferNextTicketSeq(tickets) {
  let maxSeq = 0;
  for (const ticket of tickets) {
    const match = String(ticket?.id || '').match(/^SUP-(\d+)$/);
    if (!match) {
      continue;
    }
    const seq = Number(match[1]);
    if (Number.isInteger(seq) && seq > maxSeq) {
      maxSeq = seq;
    }
  }
  return maxSeq + 1;
}

function buildEmptyState() {
  return {
    next_ticket_seq: 1,
    tickets: [],
    events: []
  };
}
