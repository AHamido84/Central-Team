import { MAX_AUTOMATION_DEPTH, valuelessOps } from '@/modules/automations/constants';
import type { AutomationCondition, ConditionResult } from '@/modules/automations/types';

/** Flat context a rule sees: `lead.source`, `deal.value_sar`, `event.to`, … (values re-read when the rule runs). */
export type ContextValues = Record<string, string | number | boolean | string[] | null>;

const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

function asNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function same(actual: unknown, expected: unknown): boolean {
  if (typeof actual === 'boolean' || typeof expected === 'boolean') return String(actual) === String(expected);
  const a = asNumber(actual);
  const b = asNumber(expected);
  if (a !== null && b !== null) return a === b;
  return String(actual ?? '').toLowerCase() === String(expected ?? '').toLowerCase();
}

/** One condition against the context. Missing fields are `null` (so `empty` holds and comparisons fail). */
export function evaluateCondition(c: AutomationCondition, values: ContextValues): ConditionResult {
  const actual = values[c.field] ?? null;
  const expected = valuelessOps.includes(c.op) ? null : (c.value ?? null);
  const list = Array.isArray(expected) ? expected : expected === null ? [] : [String(expected)];
  let passed: boolean;
  switch (c.op) {
    case 'eq':
      passed = !isEmpty(actual) && same(actual, expected);
      break;
    case 'neq':
      passed = !same(actual, expected);
      break;
    case 'in':
      passed = !isEmpty(actual) && list.some((v) => same(actual, v));
      break;
    case 'not_in':
      passed = !list.some((v) => same(actual, v));
      break;
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const a = asNumber(actual);
      const b = asNumber(expected);
      passed = a !== null && b !== null && (c.op === 'gt' ? a > b : c.op === 'gte' ? a >= b : c.op === 'lt' ? a < b : a <= b);
      break;
    }
    case 'contains':
      passed = Array.isArray(actual)
        ? list.some((v) => actual.some((x) => same(x, v)))
        : typeof actual === 'string' && list.some((v) => actual.toLowerCase().includes(v.toLowerCase()));
      break;
    case 'empty':
      passed = isEmpty(actual);
      break;
    case 'not_empty':
      passed = !isEmpty(actual);
      break;
  }
  return { field: c.field, op: c.op, expected, actual, passed };
}

/** `all` (every condition) or `any` (at least one); no conditions = always. */
export function evaluateConditions(
  conditions: readonly AutomationCondition[],
  match: 'all' | 'any',
  values: ContextValues,
): { passed: boolean; results: ConditionResult[] } {
  const results = conditions.map((c) => evaluateCondition(c, values));
  if (!results.length) return { passed: true, results };
  return { passed: match === 'all' ? results.every((r) => r.passed) : results.some((r) => r.passed), results };
}

/** `{{lead.full_name}}` → the context value (lists joined, missing → empty). Plain text only — nothing is evaluated. */
export function renderText(template: string, values: ContextValues): string {
  return template.replace(/\{\{\s*([a-z_]+\.[a-z_]+)\s*\}\}/g, (_m, key: string) => {
    const v = values[key];
    if (v === null || v === undefined) return '';
    return Array.isArray(v) ? v.join(', ') : String(v);
  });
}

/**
 * Loop protection (ADR-071): an event produced by automation actions `MAX_AUTOMATION_DEPTH` times in a row triggers
 * nothing, and a rule never runs on an event its own actions (directly or down the chain) produced.
 */
export function loopGuard(
  event: { automationDepth: number; automationChain: readonly string[] },
  automationId: string,
): 'loop_depth' | 'loop_self' | null {
  if (event.automationChain.includes(automationId)) return 'loop_self';
  if (event.automationDepth >= MAX_AUTOMATION_DEPTH) return 'loop_depth';
  return null;
}

/** Round-robin pick for "assign": stable per run count so a retry picks the same person. */
export function pickRoundRobin<T>(list: readonly T[], counter: number): T | null {
  if (!list.length) return null;
  return list[((counter % list.length) + list.length) % list.length] ?? null;
}

/** True for addresses an outbound webhook must never reach (loopback, private, link-local, CGNAT, metadata). */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) {
    const [a, b] = v4.split('.').map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  return (
    v6 === '::' ||
    v6 === '::1' ||
    v6.startsWith('fc') ||
    v6.startsWith('fd') ||
    v6.startsWith('fe8') ||
    v6.startsWith('fe9') ||
    v6.startsWith('fea') ||
    v6.startsWith('feb')
  );
}

/** Static URL checks before DNS: HTTPS, no credentials, no raw private IPs, no internal-looking hosts. */
export function checkWebhookUrl(raw: string): { ok: true; url: URL } | { ok: false } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false };
  }
  if (url.protocol !== 'https:' || url.username || url.password) return { ok: false };
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return { ok: false };
  if ((/^[\d.]+$/.test(host) || host.includes(':')) && isPrivateAddress(host)) return { ok: false };
  return { ok: true, url };
}
