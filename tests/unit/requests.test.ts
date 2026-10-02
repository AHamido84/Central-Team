import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { backoffSeconds } from '@/lib/events/dispatcher';
import {
  addWorkingDays,
  canTransition,
  defaultPrefix,
  inInboxView,
  reasonRequired,
  requestStatuses,
  requestTransitions,
  slaState,
  trackerIndex,
  type RequestStatus,
} from '@/modules/requests/constants';
import {
  briefFileIds,
  formSchemaSchema,
  isFieldVisible,
  normalizeFields,
  validateBrief,
  type RequestFormField,
} from '@/modules/requests/form-schema';
import { changeStatusSchema, requestDraftSchema } from '@/modules/requests/schemas';
import { clientRequestStats } from '@/modules/requests/stats';

const uuid = () => crypto.randomUUID();

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

describe('request state machine', () => {
  const allowed = (side: 'client' | 'agency') =>
    requestStatuses.flatMap((from) => requestStatuses.filter((to) => canTransition(side, from, to)).map((to) => `${from}>${to}`));

  it('client transitions: submit a draft, cancel early, resubmit after needs-info, close a delivery', () => {
    expect(allowed('client').sort()).toEqual(
      [
        'draft>submitted',
        'submitted>cancelled',
        'under_review>cancelled',
        'needs_info>under_review',
        'needs_info>cancelled',
        'delivered>closed',
      ].sort(),
    );
  });

  it('clients can never accept, reject, deliver or touch work in progress', () => {
    for (const to of ['accepted', 'rejected', 'in_progress', 'in_review', 'delivered', 'needs_info'] as RequestStatus[]) {
      for (const from of requestStatuses) expect(canTransition('client', from, to)).toBe(false);
    }
    for (const from of ['accepted', 'in_progress', 'in_review', 'delivered'] as RequestStatus[]) {
      expect(canTransition('client', from, 'cancelled')).toBe(false);
    }
  });

  it('agency follows the happy path and its off-ramps', () => {
    const path: RequestStatus[] = [
      'submitted',
      'under_review',
      'needs_info',
      'under_review',
      'accepted',
      'in_progress',
      'in_review',
      'delivered',
      'closed',
    ];
    for (let i = 1; i < path.length; i++) expect(canTransition('agency', path[i - 1]!, path[i]!), `${path[i - 1]} → ${path[i]}`).toBe(true);
    expect(canTransition('agency', 'submitted', 'rejected')).toBe(true);
    expect(canTransition('agency', 'rejected', 'under_review')).toBe(true);
    expect(canTransition('agency', 'delivered', 'in_progress')).toBe(true);
  });

  it('agency cannot skip steps, touch drafts, or revive cancelled/closed requests', () => {
    expect(canTransition('agency', 'submitted', 'delivered')).toBe(false);
    expect(canTransition('agency', 'submitted', 'in_progress')).toBe(false);
    expect(canTransition('agency', 'accepted', 'closed')).toBe(false);
    for (const to of requestStatuses) {
      expect(canTransition('agency', 'draft', to)).toBe(false);
      expect(canTransition('agency', 'cancelled', to)).toBe(false);
      expect(canTransition('agency', 'closed', to)).toBe(false);
    }
    expect(canTransition('agency', 'submitted', 'cancelled')).toBe(false);
  });

  it('matches the SQL guard (app.request_transition_allowed) exactly', () => {
    const dir = path.resolve(__dirname, '../../supabase/migrations');
    const file = readFileSync(path.join(dir, '20260928215700_requests_security.sql'), 'utf8');
    const fn = file.slice(file.indexOf('create or replace function app.request_transition_allowed'));
    const block = (from: string, to: string) => fn.slice(fn.indexOf(from), fn.indexOf(to));
    const pairs = (s: string) => [...s.matchAll(/\('([a-z_]+)', '([a-z_]+)'\)/g)].map((m) => `${m[1]}>${m[2]}`).sort();
    const ts = (side: 'client' | 'agency') =>
      Object.entries(requestTransitions[side])
        .flatMap(([from, tos]) => tos.map((to) => `${from}>${to}`))
        .sort();
    expect(pairs(block('-- client transitions', '-- agency transitions'))).toEqual(ts('client'));
    expect(pairs(block('-- agency transitions', '-- end transitions'))).toEqual(ts('agency'));
  });

  it('reject and needs-info require a reason; other changes do not', () => {
    expect(reasonRequired).toEqual(['needs_info', 'rejected']);
    const id = uuid();
    expect(changeStatusSchema.safeParse({ requestId: id, status: 'needs_info' }).success).toBe(false);
    expect(changeStatusSchema.safeParse({ requestId: id, status: 'rejected', reason: 'ok' }).success).toBe(false);
    expect(changeStatusSchema.safeParse({ requestId: id, status: 'needs_info', reason: 'Please send the logo' }).success).toBe(true);
    expect(changeStatusSchema.safeParse({ requestId: id, status: 'accepted' }).success).toBe(true);
  });

  it('tracker and inbox views place each status', () => {
    expect(trackerIndex('needs_info')).toBe(1);
    expect(trackerIndex('in_review')).toBe(3);
    expect(trackerIndex('closed')).toBe(5);
    const me = uuid();
    expect(inInboxView({ status: 'submitted', assigneeId: null }, 'new', me)).toBe(true);
    expect(inInboxView({ status: 'needs_info', assigneeId: null }, 'pending', me)).toBe(true);
    expect(inInboxView({ status: 'in_review', assigneeId: me }, 'mine', me)).toBe(true);
    expect(inInboxView({ status: 'closed', assigneeId: me }, 'mine', me)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Form schema
// ---------------------------------------------------------------------------

const L = (en: string) => ({ ar: en, en });
const fields: RequestFormField[] = [
  { id: 'platforms', type: 'platforms', label: L('Platforms'), required: true },
  {
    id: 'goal',
    type: 'single_select',
    label: L('Goal'),
    required: true,
    options: [
      { value: 'awareness', label: L('Awareness') },
      { value: 'offer', label: L('Offer') },
    ],
  },
  { id: 'offer', type: 'short_text', label: L('Offer'), required: true, showIf: { field: 'goal', equals: 'offer' } },
  { id: 'message', type: 'long_text', label: L('Message'), required: true, maxLength: 50 },
  { id: 'show_price', type: 'checkbox', label: L('Show price'), required: false },
  { id: 'price', type: 'number', label: L('Price'), required: true, min: 1, max: 1000, showIf: { field: 'show_price', equals: true } },
  { id: 'start', type: 'date', label: L('Start'), required: false },
  { id: 'size', type: 'dimensions', label: L('Size'), required: false },
  { id: 'colors', type: 'color', label: L('Colors'), required: false, maxItems: 2 },
  { id: 'links', type: 'links', label: L('Links'), required: false, maxItems: 2 },
  { id: 'photos', type: 'file', label: L('Photos'), required: false, maxItems: 2 },
  { id: 'tiktok_only', type: 'short_text', label: L('TikTok sound'), required: true, showIf: { field: 'platforms', equals: 'tiktok' } },
  { id: 'agree', type: 'checkbox', label: L('Agree'), required: true },
];
const valid = {
  platforms: ['instagram'],
  goal: 'awareness',
  offer: 'ignored when hidden',
  message: 'Hello',
  show_price: false,
  price: '',
  start: '',
  size: { ratio: '4:5' },
  colors: ['#AABBCC'],
  links: ['example.com/a'],
  photos: [uuid()],
  agree: true,
};

describe('form definitions', () => {
  it('accepts a valid definition with conditions on earlier fields', () => {
    expect(formSchemaSchema.safeParse({ fields: normalizeFields(fields) }).success).toBe(true);
  });

  it('rejects duplicate ids, short option lists and bad conditions', () => {
    const dup = formSchemaSchema.safeParse({ fields: normalizeFields([fields[3]!, { ...fields[4]!, id: 'message' }]) });
    expect(dup.error?.issues.map((i) => i.message)).toContain('field_ids_unique');
    const oneOption = formSchemaSchema.safeParse({ fields: normalizeFields([{ ...fields[1]!, options: [fields[1]!.options![0]!] }]) });
    expect(oneOption.error?.issues[0]?.message).toBe('options_min');
    // A condition on a later field, an unknown value, or a non-choice field is invalid.
    const later = formSchemaSchema.safeParse({ fields: normalizeFields([fields[2]!, fields[1]!]) });
    expect(later.error?.issues.map((i) => i.message)).toContain('invalid_condition');
    const badValue = formSchemaSchema.safeParse({
      fields: normalizeFields([fields[1]!, { ...fields[2]!, showIf: { field: 'goal', equals: 'nope' } }]),
    });
    expect(badValue.error?.issues.map((i) => i.message)).toContain('invalid_condition');
    const onText = formSchemaSchema.safeParse({
      fields: normalizeFields([fields[3]!, { ...fields[2]!, showIf: { field: 'message', equals: 'x' } }]),
    });
    expect(onText.error?.issues.map((i) => i.message)).toContain('invalid_condition');
  });

  it('labels need at least one language', () => {
    const r = formSchemaSchema.safeParse({ fields: normalizeFields([{ ...fields[3]!, label: {} }]) });
    expect(r.error?.issues[0]?.message).toBe('required_one_language');
  });
});

describe('validateBrief (one validator for the wizard and the server)', () => {
  it('normalizes a valid brief and drops hidden fields', () => {
    const r = validateBrief(fields, valid);
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({
      platforms: ['instagram'],
      goal: 'awareness',
      message: 'Hello',
      show_price: false,
      start: null,
      size: { ratio: '4:5' },
      colors: ['#aabbcc'],
      links: ['https://example.com/a'],
      agree: true,
    });
    expect('offer' in r.data).toBe(false);
    expect('price' in r.data).toBe(false);
    expect('tiktok_only' in r.data).toBe(false);
  });

  it('conditional fields become required when shown', () => {
    const r = validateBrief(fields, { ...valid, goal: 'offer', offer: '', show_price: true, price: '', platforms: ['tiktok'] });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors).toMatchObject({ offer: 'required', price: 'required', tiktok_only: 'required' });
    expect(isFieldVisible(fields[11]!, { platforms: ['instagram', 'tiktok'] })).toBe(true);
  });

  it('enforces types and limits per field', () => {
    const r = validateBrief(fields, {
      ...valid,
      platforms: ['myspace'],
      message: 'x'.repeat(51),
      show_price: true,
      price: 5000,
      start: '31/12/2026',
      size: { ratio: 'custom', width: 5, height: 100 },
      colors: ['red'],
      links: ['not a url'],
      photos: ['not-an-id'],
      agree: false,
    });
    expect(!r.ok && r.errors).toMatchObject({
      platforms: 'invalid_option',
      message: 'too_long',
      price: 'number_max',
      start: 'invalid_date',
      size: 'invalid_dimensions',
      colors: 'invalid_color',
      links: 'invalid_url',
      photos: 'invalid',
      agree: 'required',
    });
    const many = validateBrief(fields, { ...valid, colors: ['#000000', '#111111', '#222222'], photos: [uuid(), uuid(), uuid()] });
    expect(!many.ok && many.errors).toMatchObject({ colors: 'too_many', photos: 'too_many' });
  });

  it('draft mode skips "required" but still checks types; unknown keys are stripped', () => {
    const draft = validateBrief(fields, { platforms: [], message: '', agree: false, injected: '<script>' }, 'draft');
    expect(draft.ok).toBe(true);
    expect('injected' in draft.data).toBe(false);
    expect(validateBrief(fields, { colors: ['nope'] }, 'draft').ok).toBe(false);
  });

  it('collects file ids per brief field (for attachments)', () => {
    const id = uuid();
    expect(briefFileIds(fields, { photos: [id] })).toEqual([{ fieldId: 'photos', fileId: id }]);
  });

  it('draft payload bounds title, links and attachments', () => {
    const base = { typeId: uuid(), title: '', brief: {}, referenceLinks: [], priority: 'normal', attachmentIds: [] };
    expect(requestDraftSchema.safeParse(base).success).toBe(true);
    expect(requestDraftSchema.safeParse({ ...base, priority: 'urgent' }).success).toBe(false);
    expect(requestDraftSchema.safeParse({ ...base, attachmentIds: Array.from({ length: 21 }, uuid) }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SLA, numbering, dashboard
// ---------------------------------------------------------------------------

describe('SLA and dates', () => {
  it('adds working days, skipping Friday and Saturday', () => {
    expect(addWorkingDays('2026-10-01', 1)).toBe('2026-10-04'); // Thursday + 1 → Sunday
    expect(addWorkingDays('2026-10-04', 5)).toBe('2026-10-11'); // Sunday + 5 → next Sunday
  });

  it('on track → at risk → overdue against the due date; met / missed once delivered', () => {
    const base = { status: 'in_progress' as const, submittedAt: '2026-10-01T06:00:00Z', dueDate: '2026-10-08', deliveredAt: null };
    expect(slaState(base, new Date('2026-10-02T09:00:00Z'))).toBe('on_track');
    expect(slaState(base, new Date('2026-10-08T09:00:00Z'))).toBe('at_risk');
    expect(slaState(base, new Date('2026-10-09T09:00:00Z'))).toBe('overdue');
    expect(slaState({ ...base, status: 'delivered', deliveredAt: '2026-10-07T12:00:00Z' })).toBe('met');
    expect(slaState({ ...base, status: 'delivered', deliveredAt: '2026-10-10T12:00:00Z' })).toBe('missed');
    expect(slaState({ ...base, status: 'cancelled' })).toBe('none');
    expect(slaState({ ...base, dueDate: null })).toBe('none');
  });

  it('derives reference prefixes from the client slug', () => {
    expect(defaultPrefix('najd-heritage')).toBe('NAJD');
    expect(defaultPrefix('lujain-fashion')).toBe('LUJAIN');
    expect(defaultPrefix('---')).toBe('REQ');
  });

  it('dispatcher backoff grows exponentially and is capped', () => {
    expect([1, 2, 3, 4].map(backoffSeconds)).toEqual([30, 60, 120, 240]);
    expect(backoffSeconds(20)).toBe(3600);
  });
});

describe('client dashboard stats', () => {
  it('counts open, waiting, delivered this month and average turnaround', () => {
    const now = new Date('2026-09-28T12:00:00Z');
    const stats = clientRequestStats(
      [
        { status: 'submitted', submittedAt: '2026-09-27T10:00:00Z', deliveredAt: null },
        { status: 'needs_info', submittedAt: '2026-09-26T10:00:00Z', deliveredAt: null },
        { status: 'delivered', submittedAt: '2026-09-20T10:00:00Z', deliveredAt: '2026-09-22T10:00:00Z' },
        { status: 'closed', submittedAt: '2026-08-20T10:00:00Z', deliveredAt: '2026-08-24T10:00:00Z' },
        { status: 'draft', submittedAt: null, deliveredAt: null },
        { status: 'cancelled', submittedAt: '2026-09-01T10:00:00Z', deliveredAt: null },
      ],
      'Asia/Riyadh',
      now,
    );
    expect(stats).toEqual({ open: 3, waiting: 1, deliveredThisMonth: 1, avgTurnaroundDays: 3 });
  });
});
