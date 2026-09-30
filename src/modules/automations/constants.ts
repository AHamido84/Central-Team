import type { DomainEventType } from '@/lib/events/registry';

/** Loop protection (ADR-071): an event caused by this many automation actions in a row triggers nothing more. */
export const MAX_AUTOMATION_DEPTH = 3;
/** A rule that fires more often than this per hour is paused for the rest of the hour (runs are skipped). */
export const MAX_RUNS_PER_HOUR = 100;

export const conditionOps = ['eq', 'neq', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'contains', 'empty', 'not_empty'] as const;
export type ConditionOp = (typeof conditionOps)[number];

/** Operators that take no value. */
export const valuelessOps: readonly ConditionOp[] = ['empty', 'not_empty'];

export type FieldType = 'text' | 'number' | 'enum' | 'boolean' | 'list' | 'user' | 'client';

/** Operators offered per field type in the builder (the evaluator accepts any, typed loosely). */
export const opsByType: Record<FieldType, readonly ConditionOp[]> = {
  text: ['eq', 'neq', 'contains', 'empty', 'not_empty'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  enum: ['eq', 'neq', 'in', 'not_in'],
  boolean: ['eq'],
  list: ['contains', 'empty', 'not_empty'],
  user: ['eq', 'neq', 'empty', 'not_empty'],
  client: ['eq', 'neq', 'in', 'not_in'],
};

export type TriggerField = {
  key: string;
  type: FieldType;
  /** Enum values (translated in the builder under `automations.values.<key>`). */
  options?: readonly string[];
};

/** Which record an event is about; decides the available actions (assign, change status, WhatsApp). */
export type Subject = 'lead' | 'deal' | 'request' | 'task' | 'campaign' | 'deliverable' | 'connection';

const leadFields: TriggerField[] = [
  {
    key: 'lead.source',
    type: 'enum',
    options: ['website_form', 'whatsapp', 'instagram', 'referral', 'event', 'lead_ad', 'manual', 'other'],
  },
  {
    key: 'lead.city',
    type: 'enum',
    options: ['riyadh', 'jeddah', 'dammam', 'khobar', 'makkah', 'madinah', 'abha', 'taif', 'tabuk', 'qassim', 'other'],
  },
  { key: 'lead.services', type: 'list' },
  { key: 'lead.budget_range', type: 'enum', options: ['under_5k', '5k_15k', '15k_50k', '50k_plus', 'unknown'] },
  { key: 'lead.score', type: 'number' },
  { key: 'lead.status', type: 'enum', options: ['new', 'contacted', 'qualified', 'unqualified', 'converted'] },
  { key: 'lead.owner_id', type: 'user' },
  { key: 'lead.source_detail', type: 'text' },
];
const dealFields: TriggerField[] = [
  { key: 'deal.status', type: 'enum', options: ['open', 'won', 'lost'] },
  { key: 'deal.value_sar', type: 'number' },
  { key: 'deal.probability', type: 'number' },
  { key: 'deal.owner_id', type: 'user' },
  { key: 'deal.stage', type: 'text' },
];
const requestFields: TriggerField[] = [
  { key: 'request.client_id', type: 'client' },
  { key: 'request.priority', type: 'enum', options: ['low', 'normal', 'high', 'urgent'] },
  {
    key: 'request.status',
    type: 'enum',
    options: [
      'submitted',
      'under_review',
      'needs_info',
      'accepted',
      'in_progress',
      'in_review',
      'delivered',
      'closed',
      'rejected',
      'cancelled',
    ],
  },
  { key: 'request.is_extra', type: 'boolean' },
  { key: 'request.assignee_id', type: 'user' },
];
const taskFields: TriggerField[] = [
  { key: 'task.client_id', type: 'client' },
  { key: 'task.priority', type: 'enum', options: ['low', 'normal', 'high', 'urgent'] },
  { key: 'task.status_category', type: 'enum', options: ['todo', 'active', 'review', 'changes', 'done', 'blocked'] },
];
const campaignFields: TriggerField[] = [
  { key: 'campaign.client_id', type: 'client' },
  { key: 'campaign.status', type: 'enum', options: ['draft', 'planned', 'active', 'paused', 'completed', 'archived'] },
  { key: 'campaign.health', type: 'enum', options: ['on_track', 'at_risk', 'off_track', 'no_data'] },
  { key: 'campaign.owner_id', type: 'user' },
];

export type TriggerDefinition = { type: DomainEventType; subject: Subject; fields: TriggerField[] };

/**
 * The domain events a rule can start from (ADR-070), with the fields its conditions may test. Keys are
 * `<subject>.<column>` read from the record (re-loaded when the rule runs) or `event.<payload key>`.
 */
export const triggerCatalog = [
  {
    type: 'lead.created',
    subject: 'lead',
    fields: [...leadFields, { key: 'event.via', type: 'enum', options: ['manual', 'import', 'form', 'webhook', 'lead_ad'] }],
  },
  { type: 'lead.assigned', subject: 'lead', fields: leadFields },
  { type: 'deal.stage_changed', subject: 'deal', fields: dealFields },
  { type: 'deal.won', subject: 'deal', fields: dealFields },
  {
    type: 'deal.lost',
    subject: 'deal',
    fields: [
      ...dealFields,
      { key: 'event.reason', type: 'enum', options: ['price', 'timing', 'competitor', 'no_response', 'not_fit', 'other'] },
    ],
  },
  { type: 'request.submitted', subject: 'request', fields: requestFields },
  {
    type: 'request.status_changed',
    subject: 'request',
    fields: [
      ...requestFields,
      { key: 'event.from', type: 'enum', options: requestFields[2]!.options },
      { key: 'event.to', type: 'enum', options: requestFields[2]!.options },
    ],
  },
  { type: 'task.status_changed', subject: 'task', fields: taskFields },
  { type: 'task.overdue', subject: 'task', fields: taskFields },
  {
    type: 'deliverable.decided',
    subject: 'deliverable',
    fields: [
      { key: 'deliverable.client_id', type: 'client' },
      { key: 'event.stage', type: 'enum', options: ['internal', 'client'] },
      { key: 'event.decision', type: 'enum', options: ['approved', 'changes_requested'] },
    ],
  },
  {
    type: 'campaign.health_changed',
    subject: 'campaign',
    fields: [...campaignFields, { key: 'event.to', type: 'enum', options: ['on_track', 'at_risk', 'off_track', 'no_data'] }],
  },
  {
    type: 'sla.breached',
    subject: 'request',
    fields: [...requestFields, { key: 'event.kind', type: 'enum', options: ['response', 'resolution'] }],
  },
  { type: 'metrics.synced', subject: 'campaign', fields: [...campaignFields, { key: 'event.rows', type: 'number' }] },
  {
    type: 'integration.connection_expired',
    subject: 'connection',
    fields: [{ key: 'connection.provider', type: 'enum', options: ['meta', 'whatsapp', 'tiktok', 'snapchat', 'google'] }],
  },
] as const satisfies readonly TriggerDefinition[];

export type TriggerType = (typeof triggerCatalog)[number]['type'];
export const triggerTypes = triggerCatalog.map((t) => t.type) as unknown as readonly [TriggerType, ...TriggerType[]];

export function triggerDefinition(type: string): TriggerDefinition | undefined {
  return (triggerCatalog as readonly TriggerDefinition[]).find((t) => t.type === type);
}

export const actionTypes = ['notify', 'assign', 'create_task', 'change_status', 'send_whatsapp', 'webhook'] as const;
export type ActionType = (typeof actionTypes)[number];

/** Subjects each action can work on (the builder hides the rest; the engine re-checks). */
export const actionSubjects: Record<ActionType, readonly Subject[] | 'any'> = {
  notify: 'any',
  assign: ['lead', 'deal', 'request'],
  create_task: ['request', 'task', 'campaign', 'deliverable'],
  change_status: ['lead', 'request', 'task'],
  send_whatsapp: ['lead', 'deal'],
  webhook: 'any',
};

export const notifyRecipients = ['owner', 'account_manager', 'users'] as const;
export type NotifyRecipient = (typeof notifyRecipients)[number];

/** Statuses an automation may set, per subject (request moves still pass the lifecycle trigger). */
export const settableStatuses = {
  lead: ['contacted', 'qualified', 'unqualified'],
  request: ['under_review', 'accepted', 'in_progress'],
  task: ['todo', 'active', 'review', 'done', 'blocked'],
} as const;
