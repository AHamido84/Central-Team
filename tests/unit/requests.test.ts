import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { backoffSeconds } from '@/lib/events/dispatcher';
import {
  agencyTransitions,
  canTransition,
  clientCancellable,
  formatRequestNumber,
  requestStatuses,
  slaState,
} from '@/modules/requests/constants';
import { buildAnswersSchema, normalizeFields, requestFormFieldsSchema, type RequestFormField } from '@/modules/requests/form-schema';
import { submitRequestSchema } from '@/modules/requests/schemas';

const fields: RequestFormField[] = [
  { id: 'message', type: 'long_text', label: { ar: 'الرسالة', en: 'Message' }, required: true },
  { id: 'offer', type: 'short_text', label: { ar: 'العرض', en: 'Offer' }, required: false, maxLength: 10 },
  {
    id: 'platforms',
    type: 'multi_select',
    label: { ar: 'المنصات', en: 'Platforms' },
    required: true,
    options: [
      { value: 'instagram', label: { ar: 'إنستغرام', en: 'Instagram' } },
      { value: 'tiktok', label: { ar: 'تيك توك', en: 'TikTok' } },
    ],
  },
  {
    id: 'format',
    type: 'single_select',
    label: { ar: 'الصيغة', en: 'Format' },
    required: false,
    options: [
      { value: 'story', label: { ar: 'ستوري', en: 'Story' } },
      { value: 'post', label: { ar: 'منشور', en: 'Post' } },
    ],
  },
  { id: 'budget', type: 'number', label: { ar: 'الميزانية', en: 'Budget' }, required: true, min: 1000, max: 50000 },
  { id: 'start', type: 'date', label: { ar: 'البدء', en: 'Start' }, required: false },
  { id: 'link', type: 'url', label: { ar: 'رابط', en: 'Link' }, required: false },
  { id: 'agree', type: 'checkbox', label: { ar: 'موافق', en: 'Agree' }, required: true },
];

const valid = {
  message: 'خصم 20٪',
  offer: '',
  platforms: ['instagram'],
  format: '',
  budget: '5000',
  start: '',
  link: 'example.com/page',
  agree: true,
};

describe('buildAnswersSchema (one validator for portal form and server action)', () => {
  const schema = buildAnswersSchema(fields);

  it('accepts valid answers and normalizes empties, numbers and links', () => {
    const r = schema.safeParse(valid);
    expect(r.success).toBe(true);
    expect(r.data).toEqual({
      message: 'خصم 20٪',
      offer: null,
      platforms: ['instagram'],
      format: null,
      budget: 5000,
      start: null,
      link: 'https://example.com/page',
      agree: true,
    });
  });

  it('requires required fields (text, multi-select, number, checkbox)', () => {
    const r = schema.safeParse({ ...valid, message: '  ', platforms: [], budget: '', agree: false });
    expect(r.success).toBe(false);
    const byField = Object.fromEntries(r.error!.issues.map((i) => [i.path[0], i.message]));
    expect(byField).toMatchObject({ message: 'required', platforms: 'required', budget: 'required', agree: 'required' });
  });

  it('rejects options outside the definition, out-of-range numbers and long text', () => {
    const r = schema.safeParse({ ...valid, platforms: ['myspace'], format: 'reel', budget: 10, offer: 'x'.repeat(11) });
    expect(r.success).toBe(false);
    const byField = Object.fromEntries(r.error!.issues.map((i) => [i.path[0], i.message]));
    expect(byField).toMatchObject({ platforms: 'invalid_option', format: 'invalid_option', budget: 'number_min', offer: 'too_long' });
  });

  it('rejects malformed dates and links', () => {
    const r = schema.safeParse({ ...valid, start: '31/12/2026', link: 'not a url' });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.path[0]).sort()).toEqual(['link', 'start']);
  });

  it('strips answers to questions that are not in the version', () => {
    const r = schema.safeParse({ ...valid, injected: '<script>' });
    expect(r.success && 'injected' in r.data).toBe(false);
  });
});

describe('form definitions', () => {
  it('a valid definition passes; duplicate ids and short option lists fail', () => {
    expect(requestFormFieldsSchema.safeParse(normalizeFields(fields)).success).toBe(true);
    const dup = requestFormFieldsSchema.safeParse(normalizeFields([fields[0]!, { ...fields[1]!, id: 'message' }]));
    expect(dup.success).toBe(false);
    const oneOption = requestFormFieldsSchema.safeParse(normalizeFields([{ ...fields[2]!, options: [fields[2]!.options![0]!] }]));
    expect(oneOption.error?.issues[0]?.message).toBe('options_min');
  });

  it('labels need at least one language', () => {
    const r = requestFormFieldsSchema.safeParse(normalizeFields([{ ...fields[0]!, label: {} }]));
    expect(r.error?.issues[0]?.message).toBe('required_one_language');
  });
});

describe('request lifecycle', () => {
  it('client users can only cancel, and only before work starts or while waiting on them', () => {
    for (const from of requestStatuses) {
      for (const to of requestStatuses) {
        expect(canTransition('client', from, to)).toBe(to === 'cancelled' && clientCancellable.includes(from));
      }
    }
  });

  it('agency transitions match the SQL guard (app.request_transition_allowed)', () => {
    const sql = readFileSync(path.resolve(__dirname, '../../supabase/migrations/20260928201200_requests_security.sql'), 'utf8');
    const block = sql.slice(sql.indexOf('create or replace function app.request_transition_allowed'), sql.indexOf('end;\n$$;'));
    const pairs = [...block.matchAll(/\('([a-z_]+)', '([a-z_]+)'\)/g)].map((m) => `${m[1]}>${m[2]}`).sort();
    const ts = Object.entries(agencyTransitions)
      .flatMap(([from, tos]) => tos.map((to) => `${from}>${to}`))
      .sort();
    expect(pairs).toEqual(ts);
  });

  it('closed requests can only be reopened', () => {
    expect(canTransition('agency', 'completed', 'in_progress')).toBe(true);
    expect(canTransition('agency', 'completed', 'declined')).toBe(false);
    expect(canTransition('agency', 'submitted', 'completed')).toBe(false);
  });
});

describe('SLA state', () => {
  const base = {
    status: 'submitted' as const,
    createdAt: '2026-09-27T06:00:00Z',
    responseDueAt: '2026-09-27T14:00:00Z',
    resolutionDueAt: '2026-09-29T14:00:00Z',
    firstResponseAt: null,
    resolvedAt: null,
  };

  it('tracks the first response until one happens, then resolution', () => {
    expect(slaState(base, new Date('2026-09-27T07:00:00Z'))).toMatchObject({ state: 'on_track', milestone: 'response' });
    expect(slaState(base, new Date('2026-09-27T13:30:00Z')).state).toBe('at_risk');
    expect(slaState(base, new Date('2026-09-27T15:00:00Z')).state).toBe('breached');
    const responded = { ...base, status: 'in_progress' as const, firstResponseAt: '2026-09-27T08:00:00Z' };
    expect(slaState(responded, new Date('2026-09-28T08:00:00Z'))).toMatchObject({ state: 'on_track', milestone: 'resolution' });
  });

  it('reports met or breached once the milestone is done; cancelled has none', () => {
    const done = { ...base, status: 'completed' as const, firstResponseAt: '2026-09-27T08:00:00Z', resolvedAt: '2026-09-29T10:00:00Z' };
    expect(slaState(done).state).toBe('met');
    expect(slaState({ ...done, resolvedAt: '2026-09-30T10:00:00Z' }).state).toBe('breached');
    expect(slaState({ ...base, status: 'cancelled' }).state).toBe('none');
  });
});

describe('misc', () => {
  it('formats request numbers', () => {
    expect(formatRequestNumber(7)).toBe('REQ-0007');
    expect(formatRequestNumber(12345)).toBe('REQ-12345');
  });

  it('submit schema bounds attachments and title', () => {
    const ok = { formId: crypto.randomUUID(), title: 'منشور', answers: {}, urgent: false, attachmentIds: [] };
    expect(submitRequestSchema.safeParse(ok).success).toBe(true);
    expect(submitRequestSchema.safeParse({ ...ok, title: 'x' }).success).toBe(false);
    expect(submitRequestSchema.safeParse({ ...ok, attachmentIds: Array.from({ length: 11 }, () => crypto.randomUUID()) }).success).toBe(
      false,
    );
  });

  it('dispatcher backoff grows exponentially and is capped', () => {
    expect([1, 2, 3, 4].map(backoffSeconds)).toEqual([30, 60, 120, 240]);
    expect(backoffSeconds(20)).toBe(3600);
  });
});
