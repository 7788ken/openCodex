# Support Domain Contract (Dual Channel)

## Goal

Define a minimal, implementation-ready contract for one independent support module that serves:

- Telegram group support (`tg_group`)
- Xianyu personal support (`xianyu_personal`)

The module must stay configurable and reversible.
It should avoid fallback-heavy behavior and expose explicit failures when a channel is disabled or misconfigured.

## Design Constraints

- One ticket belongs to exactly one channel.
- No implicit cross-channel fallback.
- Routing and SLA are fully config-driven.
- Permission checks happen before assignment and state transitions.
- Adapters only normalize/send messages; business policy stays in the domain layer.

## Domain Model

### Core Types

```ts
export type SupportChannel = 'tg_group' | 'xianyu_personal';

export type TicketState =
  | 'new'
  | 'triaged'
  | 'assigned'
  | 'waiting_customer'
  | 'waiting_internal'
  | 'after_sales'
  | 'resolved'
  | 'closed'
  | 'cancelled';

export type AfterSalesState =
  | 'none'
  | 'requested'
  | 'evidence_required'
  | 'evidence_received'
  | 'solution_proposed'
  | 'solution_accepted'
  | 'fulfillment_in_progress'
  | 'fulfilled'
  | 'rejected';
```

### Entities

```ts
export interface SupportTicket {
  ticket_id: string;
  channel: SupportChannel;
  state: TicketState;
  after_sales_state: AfterSalesState;
  subject: string;
  customer_id: string;
  order_id?: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  tags: string[];
  assigned_agent_id?: string;
  created_at: string;
  updated_at: string;
  first_response_due_at: string;
  resolve_due_at: string;
}

export interface TicketMessage {
  message_id: string;
  ticket_id: string;
  channel: SupportChannel;
  direction: 'inbound' | 'outbound' | 'internal_note';
  sender_id: string;
  body: string;
  created_at: string;
}

export interface TicketEvent {
  event_id: string;
  ticket_id: string;
  type:
    | 'ticket_created'
    | 'ticket_triaged'
    | 'ticket_assigned'
    | 'ticket_state_changed'
    | 'after_sales_state_changed'
    | 'sla_breached'
    | 'ticket_escalated'
    | 'ticket_closed';
  actor_id: string;
  payload: Record<string, unknown>;
  created_at: string;
}
```

## Ticket Lifecycle Contract

### State Transition Rules

- `new -> triaged`: ticket passes basic validation and channel policy check.
- `triaged -> assigned`: assignment rule returns exactly one agent.
- `assigned -> waiting_customer`: support asks customer for required information.
- `assigned -> waiting_internal`: support requests internal action (for example logistics check).
- `assigned -> after_sales`: after-sales flow starts.
- `waiting_customer -> assigned`: customer reply received and validated.
- `waiting_internal -> assigned`: internal dependency completed.
- `after_sales -> resolved`: after-sales case reaches `fulfilled` or approved resolution.
- `resolved -> closed`: close policy timeout reached or explicit close action.
- `* -> cancelled`: only by allowed role with cancellation reason.

### Non-Bypass Rules

- `new` cannot jump directly to `assigned` without `triaged`.
- `after_sales` cannot transition to `closed` directly; it must become `resolved` first.
- `closed` and `cancelled` are terminal states.

## Assignment Rules

Assignment runs once at `triaged -> assigned`, and can be re-run only by explicit reassignment action.

1. Filter agents by:
- channel permission
- shift availability
- required skills from routing rule tags
2. Sort by:
- least active assigned tickets
- oldest last-assigned timestamp
3. Pick top 1 agent.
4. If no eligible agent exists:
- set state to `waiting_internal`
- create `ticket_escalated` event with reason `no_eligible_agent`

## After-Sales Workflow

After-sales is a strict sub-state machine under ticket state `after_sales`.

- `requested -> evidence_required`: more proof is needed.
- `requested -> solution_proposed`: evidence already sufficient.
- `evidence_required -> evidence_received`: customer uploaded required evidence.
- `evidence_received -> solution_proposed`: internal review completed.
- `solution_proposed -> solution_accepted`: customer accepts remedy.
- `solution_proposed -> rejected`: customer rejects remedy.
- `solution_accepted -> fulfillment_in_progress`: execution started.
- `fulfillment_in_progress -> fulfilled`: remedy completed.
- `fulfilled -> none`: ticket can move to `resolved`.

Allowed remedies are config-driven (`refund`, `replacement`, `repair`, `coupon`, `manual`).

## Permission Boundaries

### Roles

- `owner`: can change config, force close/cancel, override assignment.
- `manager`: can reassign, escalate, approve after-sales remedies.
- `agent`: can reply, add internal notes, move within allowed operational states.
- `bot`: can ingest/send channel messages only; cannot change business state directly.

### Hard Boundaries

- Only `owner`/`manager` can trigger escalation level changes.
- Only `manager`/`owner` can move `after_sales_state` to `solution_proposed` and beyond.
- Adapter/bot actions must pass through domain commands; no direct DB state writes.

## Channel Adapter Interface

```ts
export interface ChannelAdapter {
  channel: SupportChannel;
  validateConfig(config: ChannelRuntimeConfig): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  normalizeInbound(event: unknown): InboundSupportMessage | null;
  sendOutbound(message: OutboundSupportMessage): Promise<SendResult>;
}

export interface InboundSupportMessage {
  external_message_id: string;
  channel: SupportChannel;
  customer_id: string;
  customer_display: string;
  text: string;
  attachments: Array<{ type: string; url: string }>;
  occurred_at: string;
  raw_event: unknown;
}

export interface OutboundSupportMessage {
  ticket_id: string;
  channel: SupportChannel;
  target_customer_id: string;
  text: string;
  template_id?: string;
}
```

Adapter failures should be surfaced as explicit errors with retry metadata, not hidden by fallback routing.

## Strict Config Schema

JSON Schema (draft 2020-12):

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://opencodex.dev/schemas/support-domain-config.schema.json",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "version",
    "features",
    "channels",
    "routing",
    "sla",
    "escalation",
    "templates"
  ],
  "properties": {
    "version": { "type": "string", "pattern": "^v[0-9]+$" },
    "features": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "support_domain_enabled",
        "after_sales_enabled",
        "auto_assignment_enabled"
      ],
      "properties": {
        "support_domain_enabled": { "type": "boolean" },
        "after_sales_enabled": { "type": "boolean" },
        "auto_assignment_enabled": { "type": "boolean" }
      }
    },
    "channels": {
      "type": "object",
      "additionalProperties": false,
      "required": ["tg_group", "xianyu_personal"],
      "properties": {
        "tg_group": { "$ref": "#/$defs/channelConfig" },
        "xianyu_personal": { "$ref": "#/$defs/channelConfig" }
      }
    },
    "routing": {
      "type": "object",
      "additionalProperties": false,
      "required": ["rules"],
      "properties": {
        "rules": {
          "type": "array",
          "minItems": 1,
          "items": { "$ref": "#/$defs/routingRule" }
        }
      }
    },
    "sla": {
      "type": "object",
      "additionalProperties": false,
      "required": ["by_priority"],
      "properties": {
        "by_priority": {
          "type": "object",
          "additionalProperties": false,
          "required": ["low", "normal", "high", "urgent"],
          "properties": {
            "low": { "$ref": "#/$defs/slaTarget" },
            "normal": { "$ref": "#/$defs/slaTarget" },
            "high": { "$ref": "#/$defs/slaTarget" },
            "urgent": { "$ref": "#/$defs/slaTarget" }
          }
        }
      }
    },
    "escalation": {
      "type": "object",
      "additionalProperties": false,
      "required": ["levels"],
      "properties": {
        "levels": {
          "type": "array",
          "minItems": 1,
          "items": { "$ref": "#/$defs/escalationLevel" }
        }
      }
    },
    "templates": {
      "type": "object",
      "additionalProperties": false,
      "required": ["first_response", "after_sales_request", "closure"],
      "properties": {
        "first_response": { "type": "string", "minLength": 1 },
        "after_sales_request": { "type": "string", "minLength": 1 },
        "closure": { "type": "string", "minLength": 1 }
      }
    }
  },
  "$defs": {
    "channelConfig": {
      "type": "object",
      "additionalProperties": false,
      "required": ["enabled", "adapter", "allow_after_sales"],
      "properties": {
        "enabled": { "type": "boolean" },
        "adapter": { "type": "string", "minLength": 1 },
        "allow_after_sales": { "type": "boolean" }
      }
    },
    "routingRule": {
      "type": "object",
      "additionalProperties": false,
      "required": ["id", "channel", "when_tags_any", "assign_team"],
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "channel": { "enum": ["tg_group", "xianyu_personal"] },
        "when_tags_any": {
          "type": "array",
          "items": { "type": "string", "minLength": 1 }
        },
        "assign_team": { "type": "string", "minLength": 1 }
      }
    },
    "slaTarget": {
      "type": "object",
      "additionalProperties": false,
      "required": ["first_response_minutes", "resolve_minutes"],
      "properties": {
        "first_response_minutes": { "type": "integer", "minimum": 1 },
        "resolve_minutes": { "type": "integer", "minimum": 1 }
      }
    },
    "escalationLevel": {
      "type": "object",
      "additionalProperties": false,
      "required": ["level", "trigger", "notify_role"],
      "properties": {
        "level": { "type": "integer", "minimum": 1 },
        "trigger": {
          "type": "string",
          "enum": [
            "first_response_sla_breach",
            "resolve_sla_breach",
            "manual_request"
          ]
        },
        "notify_role": { "enum": ["manager", "owner"] }
      }
    }
  }
}
```

## Sample Config

```yaml
version: v1
features:
  support_domain_enabled: true
  after_sales_enabled: true
  auto_assignment_enabled: true

channels:
  tg_group:
    enabled: true
    adapter: telegram-group-adapter
    allow_after_sales: true
  xianyu_personal:
    enabled: true
    adapter: xianyu-personal-adapter
    allow_after_sales: true

routing:
  rules:
    - id: tg-default
      channel: tg_group
      when_tags_any: [general, after_sales]
      assign_team: tg_support_team
    - id: xianyu-order
      channel: xianyu_personal
      when_tags_any: [order, refund, return]
      assign_team: xianyu_support_team

sla:
  by_priority:
    low:
      first_response_minutes: 60
      resolve_minutes: 1440
    normal:
      first_response_minutes: 30
      resolve_minutes: 720
    high:
      first_response_minutes: 15
      resolve_minutes: 240
    urgent:
      first_response_minutes: 5
      resolve_minutes: 60

escalation:
  levels:
    - level: 1
      trigger: first_response_sla_breach
      notify_role: manager
    - level: 2
      trigger: resolve_sla_breach
      notify_role: owner

templates:
  first_response: "Hi {customer_name}, we received your request. Ticket: {ticket_id}."
  after_sales_request: "Please provide order proof and issue photos for after-sales handling."
  closure: "Your issue is resolved. Reply within 24h if you need more help."
```

## Minimal Rollout Plan

1. Add config loader + schema validation.
2. Add domain command handlers for ticket transitions and after-sales transitions.
3. Implement Telegram and Xianyu adapters behind the same interface.
4. Add focused tests:
- state transition guard tests
- assignment rule tests
- config schema validation tests
- adapter contract tests
