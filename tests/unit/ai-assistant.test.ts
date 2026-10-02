/**
 * FR3.2 / FR3.3 (ADR-089/090): every provider failure maps to one specific, translated reason; saved models fall back to
 * a current one; keyword search terms survive Arabic clitics and colloquial fillers; the mock plans tools
 * deterministically and answers from what they returned.
 */
import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';

import arAi from '@messages/ar/ai.json';
import arErrors from '@messages/ar/errors.json';
import enAi from '@messages/en/ai.json';
import enErrors from '@messages/en/errors.json';
import { actionErrorCodes } from '@/lib/actions/errors';
import { normalizeArabic, planMockTools, searchTerms, toolInputs, toolNames, toolSpecs } from '@/modules/ai/assistant-tools';
import { aiFailureCodes, classifyProviderFailure, fixableInSettings, pickModel } from '@/modules/ai/errors';
import { assistantToolsPrompt, resolveCitations } from '@/modules/ai/prompts';
import { anthropicFailure } from '@/modules/ai/providers/anthropic';
import { mockCompleter } from '@/modules/ai/providers/mock';

const headers = new Headers();

describe('provider failure → reason (ADR-089)', () => {
  it.each([
    [{ status: 401, type: 'authentication_error' }, 'ai_key_invalid'],
    [{ status: 403, type: 'permission_error' }, 'ai_key_invalid'],
    [{ status: 404, type: 'not_found_error', message: 'model: claude-old' }, 'ai_model_unavailable'],
    [
      { status: 400, type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' },
      'ai_no_credit',
    ],
    [{ status: 402, type: 'billing_error' }, 'ai_no_credit'],
    [{ status: 400, message: 'model: claude-x is not supported' }, 'ai_model_unavailable'],
    [{ status: 400, message: 'messages: roles must alternate' }, 'ai_unavailable'],
    [{ status: 429, type: 'rate_limit_error' }, 'ai_rate_limited'],
    [{ status: 529, type: 'overloaded_error' }, 'ai_unavailable'],
    [{ status: 500 }, 'ai_unavailable'],
    [{ status: 504 }, 'ai_timeout'],
    [{ timeout: true, status: 401 }, 'ai_timeout'],
    [{ connection: true }, 'ai_unavailable'],
  ] as const)('%j → %s', (failure, code) => {
    expect(classifyProviderFailure(failure)).toBe(code);
  });

  it('maps the SDK error classes the live provider throws', () => {
    const body = (type: string, message: string) => ({ type: 'error', error: { type, message } });
    expect(
      anthropicFailure(new Anthropic.AuthenticationError(401, body('authentication_error', 'invalid x-api-key'), 'x', headers)).code,
    ).toBe('ai_key_invalid');
    expect(anthropicFailure(new Anthropic.NotFoundError(404, body('not_found_error', 'model: claude-1'), 'x', headers)).code).toBe(
      'ai_model_unavailable',
    );
    expect(
      anthropicFailure(new Anthropic.BadRequestError(400, body('invalid_request_error', 'Your credit balance is too low'), 'x', headers))
        .code,
    ).toBe('ai_no_credit');
    expect(anthropicFailure(new Anthropic.RateLimitError(429, body('rate_limit_error', 'slow down'), 'x', headers)).code).toBe(
      'ai_rate_limited',
    );
    expect(anthropicFailure(new Anthropic.APIConnectionTimeoutError()).code).toBe('ai_timeout');
    expect(anthropicFailure(new Anthropic.APIConnectionError({ message: 'ECONNRESET' })).code).toBe('ai_unavailable');
    expect(anthropicFailure(new Error('boom')).code).toBe('ai_unavailable');
  });

  it('every failure code is an action error with an AR/EN message and a thread reason', () => {
    for (const code of aiFailureCodes) {
      expect(actionErrorCodes).toContain(code);
      expect((arErrors as Record<string, string>)[code], code).toBeTruthy();
      expect((enErrors as Record<string, string>)[code], code).toBeTruthy();
      expect((arAi.assistant.reason as Record<string, string>)[code], code).toBeTruthy();
      expect((enAi.assistant.reason as Record<string, string>)[code], code).toBeTruthy();
    }
  });

  it('settings-fixable reasons link admins to /admin/ai; transient ones do not', () => {
    expect(fixableInSettings('ai_key_invalid')).toBe(true);
    expect(fixableInSettings('ai_model_unavailable')).toBe(true);
    expect(fixableInSettings('ai_timeout')).toBe(false);
    expect(fixableInSettings('ai_rate_limited')).toBe(false);
  });
});

describe('default model validation (FR3.6)', () => {
  const offered = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-4-5'];
  it('keeps a model the key offers', () =>
    expect(pickModel(offered, 'claude-haiku-4-5')).toEqual({ model: 'claude-haiku-4-5', replaced: false }));
  it('replaces a retired model with the preferred current one', () =>
    expect(pickModel(offered, 'claude-3-opus-20240229')).toEqual({ model: 'claude-opus-5-5', replaced: true }));
  it('falls back to the first offered model when none is preferred', () =>
    expect(pickModel(['claude-x-1'], 'old').model).toBe('claude-x-1'));
  it('changes nothing when the list is empty', () => expect(pickModel([], 'old')).toEqual({ model: 'old', replaced: false }));
});

describe('keyword search terms (ADR-090)', () => {
  it('folds Arabic spelling variants', () => {
    expect(normalizeArabic('أحمد إبراهيم آمنة مكتبة مستشفى')).toBe('احمد ابراهيم امنه مكتبه مستشفي');
  });
  it('drops colloquial fillers and strips clitics', () => {
    expect(searchTerms('عايز تقرير بطلبات العملاء المفتوحة')).toEqual(['طلب', 'عملاء', 'مفتوح']);
    expect(searchTerms('إيه المهام المتأخرة النهارده؟')).toEqual(['مهام', 'متاخر']);
    expect(searchTerms("Summarize client Najd's month")).toEqual(['najd']);
  });
});

describe('tools and the mock plan (ADR-090)', () => {
  it('every tool has a spec with a JSON schema and an input validator', () => {
    expect(toolSpecs.map((t) => t.name).sort()).toEqual([...toolNames].sort());
    for (const spec of toolSpecs) expect(spec.inputSchema.type).toBe('object');
    expect(toolInputs.list_tasks.parse({})).toMatchObject({ due: 'any', assignee: 'anyone', include_done: false, limit: 15 });
    expect(toolInputs.list_requests.safeParse({ limit: 500 }).success).toBe(false);
  });

  it.each([
    ['عايز تقرير بطلبات العملاء المفتوحة', 'list_requests', { status: 'open' }],
    ['إيه المهام المتأخرة النهارده؟', 'list_tasks', { due: 'overdue' }],
    ['Summarize client Najd’s month', 'client_overview', { client: 'Najd' }],
    ['ريم القحطاني', 'search_records', { query: 'ريم القحطاني' }],
  ] as const)('%s → %s', (question, name, input) => {
    const [first] = planMockTools(question);
    expect(first).toMatchObject({ name, input });
  });

  it('the mock calls tools first, then answers from the sources with valid citations', async () => {
    const base = assistantToolsPrompt('en', 'Which requests are open?', [], '2026-10-01');
    const first = await mockCompleter.complete(base);
    expect(first.stop).toBe('tool_use');
    expect(first.toolCalls?.[0]?.name).toBe('list_requests');
    const sources = [
      {
        n: 1,
        sourceType: 'request' as const,
        sourceId: 'r1',
        url: '/requests/r1',
        title: 'Launch post',
        content: 'Request: Launch post\nStatus: in_progress',
      },
    ];
    const second = await mockCompleter.complete({
      ...base,
      messages: [
        ...base.messages,
        { role: 'assistant', content: '', toolCalls: first.toolCalls },
        { role: 'user', content: '', toolResults: [{ toolUseId: first.toolCalls![0]!.id, content: '[1] (request) Launch post' }] },
      ],
      grounding: { kind: 'assistant', question: 'Which requests are open?', sources },
    });
    expect(second.stop).toBe('end');
    const { citations } = resolveCitations(second.text, sources);
    expect(citations.map((c) => c.sourceId)).toEqual(['r1']);
  });

  it('the tool-mode prompt declares the tools and keeps the citation rules', () => {
    const p = assistantToolsPrompt('ar', 'سؤال', [{ role: 'user', content: 'سابق' }], '2026-10-01');
    expect(p.tools?.length).toBe(toolSpecs.length);
    expect(p.system).toMatch(/Only cite numbers that appear in tool results/);
    expect(p.system).toMatch(/Modern Standard Arabic/);
    expect(p.messages.at(-1)).toEqual({ role: 'user', content: 'سؤال' });
  });
});
