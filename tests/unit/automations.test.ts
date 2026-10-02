import { describe, expect, it } from 'vitest';

import { actionSubjects, MAX_AUTOMATION_DEPTH, triggerCatalog } from '@/modules/automations/constants';
import {
  checkWebhookUrl,
  evaluateCondition,
  evaluateConditions,
  isPrivateAddress,
  loopGuard,
  pickRoundRobin,
  renderText,
  type ContextValues,
} from '@/modules/automations/engine-core';
import { automationInputSchema } from '@/modules/automations/schemas';

const values: ContextValues = {
  'lead.source': 'lead_ad',
  'lead.city': 'riyadh',
  'lead.services': ['ads', 'social_media'],
  'lead.score': 62,
  'lead.owner_id': null,
  'lead.full_name': 'Sara Al-Otaibi',
  'request.is_extra': true,
  'event.rows': '12',
};

describe('conditions', () => {
  it('equality is case-insensitive and numeric-aware', () => {
    expect(evaluateCondition({ field: 'lead.source', op: 'eq', value: 'LEAD_AD' }, values).passed).toBe(true);
    expect(evaluateCondition({ field: 'lead.score', op: 'eq', value: '62' }, values).passed).toBe(true);
    expect(evaluateCondition({ field: 'lead.city', op: 'neq', value: 'jeddah' }, values).passed).toBe(true);
    expect(evaluateCondition({ field: 'request.is_extra', op: 'eq', value: 'true' }, values).passed).toBe(true);
  });

  it('in / not in, greater / less, contains, empty', () => {
    expect(evaluateCondition({ field: 'lead.city', op: 'in', value: ['jeddah', 'riyadh'] }, values).passed).toBe(true);
    expect(evaluateCondition({ field: 'lead.city', op: 'not_in', value: ['riyadh'] }, values).passed).toBe(false);
    expect(evaluateCondition({ field: 'lead.score', op: 'gte', value: 62 }, values).passed).toBe(true);
    expect(evaluateCondition({ field: 'lead.score', op: 'gt', value: 62 }, values).passed).toBe(false);
    expect(evaluateCondition({ field: 'event.rows', op: 'gt', value: 0 }, values).passed).toBe(true);
    expect(evaluateCondition({ field: 'lead.services', op: 'contains', value: 'ads' }, values).passed).toBe(true);
    expect(evaluateCondition({ field: 'lead.full_name', op: 'contains', value: 'otaibi' }, values).passed).toBe(true);
    expect(evaluateCondition({ field: 'lead.owner_id', op: 'empty' }, values).passed).toBe(true);
    expect(evaluateCondition({ field: 'lead.services', op: 'not_empty' }, values).passed).toBe(true);
  });

  it('missing fields fail comparisons but satisfy "empty"', () => {
    expect(evaluateCondition({ field: 'deal.value_sar', op: 'gt', value: 1 }, values).passed).toBe(false);
    expect(evaluateCondition({ field: 'deal.value_sar', op: 'eq', value: '' }, values).passed).toBe(false);
    expect(evaluateCondition({ field: 'deal.value_sar', op: 'empty' }, values).passed).toBe(true);
    expect(evaluateCondition({ field: 'lead.score', op: 'lt', value: 'abc' }, values).passed).toBe(false);
  });

  it('all / any, and no conditions always pass', () => {
    const conds = [
      { field: 'lead.city', op: 'eq' as const, value: 'riyadh' },
      { field: 'lead.score', op: 'gt' as const, value: 90 },
    ];
    expect(evaluateConditions(conds, 'all', values)).toMatchObject({ passed: false });
    expect(evaluateConditions(conds, 'any', values)).toMatchObject({ passed: true });
    expect(evaluateConditions([], 'all', values).passed).toBe(true);
    expect(evaluateConditions(conds, 'all', values).results.map((r) => r.passed)).toEqual([true, false]);
  });
});

describe('loop guard', () => {
  it('stops at the maximum depth and when a rule is already in the chain', () => {
    expect(loopGuard({ automationDepth: 0, automationChain: [] }, 'a')).toBeNull();
    expect(loopGuard({ automationDepth: MAX_AUTOMATION_DEPTH - 1, automationChain: ['b'] }, 'a')).toBeNull();
    expect(loopGuard({ automationDepth: MAX_AUTOMATION_DEPTH, automationChain: ['b', 'c', 'd'] }, 'a')).toBe('loop_depth');
    expect(loopGuard({ automationDepth: 1, automationChain: ['a'] }, 'a')).toBe('loop_self');
    // A → B → A: the second A is refused even below the depth limit.
    expect(loopGuard({ automationDepth: 2, automationChain: ['a', 'b'] }, 'a')).toBe('loop_self');
  });
});

describe('texts, round-robin, webhook URLs', () => {
  it('renders placeholders without evaluating anything', () => {
    expect(renderText('New {{lead.source}} lead: {{lead.full_name}} ({{lead.services}}) {{deal.title}}', values)).toBe(
      'New lead_ad lead: Sara Al-Otaibi (ads, social_media) ',
    );
    expect(renderText('{{constructor.name}} {{ lead.city }}', values)).toBe(' riyadh');
  });

  it('round-robin is stable per counter', () => {
    expect(pickRoundRobin(['a', 'b', 'c'], 0)).toBe('a');
    expect(pickRoundRobin(['a', 'b', 'c'], 4)).toBe('b');
    expect(pickRoundRobin([], 3)).toBeNull();
  });

  it('only public HTTPS URLs', () => {
    expect(checkWebhookUrl('https://hooks.example.com/x').ok).toBe(true);
    for (const bad of [
      'http://hooks.example.com',
      'https://user:pw@example.com',
      'https://localhost/x',
      'https://127.0.0.1/x',
      'https://10.0.0.5/x',
      'https://169.254.169.254/latest',
      'https://[::1]/x',
      'https://db.internal/x',
      'not a url',
    ])
      expect(checkWebhookUrl(bad).ok).toBe(false);
    expect(isPrivateAddress('192.168.1.1')).toBe(true);
    expect(isPrivateAddress('172.20.0.1')).toBe(true);
    expect(isPrivateAddress('100.64.0.1')).toBe(true);
    expect(isPrivateAddress('::ffff:10.1.1.1')).toBe(true);
    expect(isPrivateAddress('fd00::1')).toBe(true);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('2606:4700::1111')).toBe(false);
  });
});

describe('rule schema and catalog', () => {
  const base = {
    name: 'Rule',
    triggerType: 'lead.created',
    actions: [{ id: 'a1', type: 'notify', config: { recipients: ['owner'], title: 'Hi' } }],
  };

  it('accepts a valid rule and fills defaults', () => {
    const parsed = automationInputSchema.parse(base);
    expect(parsed).toMatchObject({ match: 'all', conditions: [], isActive: false });
    expect(parsed.actions[0]).toMatchObject({ config: { userIds: [], body: '' } });
  });

  it('rejects unknown triggers, fields, no actions, non-HTTPS webhooks and too many actions', () => {
    expect(automationInputSchema.safeParse({ ...base, triggerType: 'user.deactivated' }).success).toBe(false);
    expect(automationInputSchema.safeParse({ ...base, conditions: [{ field: 'drop table', op: 'eq', value: 1 }] }).success).toBe(false);
    expect(automationInputSchema.safeParse({ ...base, actions: [] }).success).toBe(false);
    expect(
      automationInputSchema.safeParse({ ...base, actions: [{ id: 'w', type: 'webhook', config: { url: 'http://example.com' } }] }).success,
    ).toBe(false);
    expect(
      automationInputSchema.safeParse({ ...base, actions: Array.from({ length: 11 }, (_, i) => ({ ...base.actions[0], id: `a${i}` })) })
        .success,
    ).toBe(false);
  });

  it('every trigger has fields, and every action applies to at least one trigger', () => {
    for (const t of triggerCatalog) expect(t.fields.length).toBeGreaterThan(0);
    for (const [, subjects] of Object.entries(actionSubjects))
      expect(subjects === 'any' || triggerCatalog.some((t) => (subjects as readonly string[]).includes(t.subject))).toBe(true);
  });
});
