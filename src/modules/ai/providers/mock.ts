/**
 * The mock completer (ADR-073): composes deterministic text from the grounding facts in the request's language, with
 * `[n]` citations for assistant answers. Wording comes from `messages/<locale>/ai.json` (`mock.*`).
 */
import { createTranslator } from 'next-intl';

import type { Locale } from '@/lib/i18n/localized';
import arAi from '@messages/ar/ai.json';
import enAi from '@messages/en/ai.json';
import { planMockTools } from '@/modules/ai/assistant-tools';
import { approxTokens } from '@/modules/ai/providers/mock-embedder';
import type { AiCompleter, CompleteInput } from '@/modules/ai/providers/types';

export const MOCK_MODEL = 'mock-writer-1';

const translator = (locale: Locale) => createTranslator({ locale, messages: { ai: locale === 'ar' ? arAi : enAi }, namespace: 'ai.mock' });

/** First sentence (or the first ~180 characters) of a snippet, on one line. */
export function firstSentence(text: string, max = 180): string {
  const line = text.replace(/\s+/g, ' ').trim();
  const end = line.search(/[.!?؟。]\s/);
  const cut = end > 0 && end < max ? line.slice(0, end + 1) : line.slice(0, max);
  return cut.length < line.length && !/[.!?؟]$/.test(cut) ? `${cut}…` : cut;
}

export function composeMock(input: CompleteInput): string {
  const t = translator(input.locale);
  const g = input.grounding;
  switch (g.kind) {
    case 'assistant': {
      if (g.sources.length === 0) return t('assistantNone');
      const top = g.sources.slice(0, 3);
      // The first content line repeats the title; show the next details instead.
      const detail = (content: string) => firstSentence(content.split('\n').slice(1, 4).join(' · ') || content);
      const lines = top.map((s) => `• ${s.title}: ${detail(s.content)} [${s.n}]`);
      return [t('assistantIntro', { count: top.length }), ...lines, t('assistantOutro')].join('\n');
    }
    case 'report_section':
      return g.section === 'commentary'
        ? [t('commentaryIntro'), ...g.lines].join('\n')
        : [t('nextStepsIntro'), ...g.lines.map((l) => `- ${l}`)].join('\n');
    case 'insight':
      return [t('insightIntro'), ...g.lines].join(' ');
  }
}

export const mockCompleter: AiCompleter = {
  key: 'mock',
  model: MOCK_MODEL,
  async complete(input) {
    const prompt = input.system + input.messages.map((m) => m.content + (m.toolResults ?? []).map((r) => r.content).join('\n')).join('\n');
    const usage = (text: string) => ({ input: approxTokens(prompt), output: approxTokens(text) });
    // Tool loop (ADR-090): plan once from the question, then answer from what the tools returned.
    if (input.tools?.length && input.grounding.kind === 'assistant' && !input.messages.some((m) => m.toolResults?.length)) {
      const toolCalls = planMockTools(input.grounding.question);
      return { text: '', stop: 'tool_use', model: MOCK_MODEL, usage: usage(''), toolCalls };
    }
    const text = composeMock(input);
    return { text, stop: 'end', model: MOCK_MODEL, usage: usage(text) };
  },
};
