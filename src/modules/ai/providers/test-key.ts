import 'server-only';

import Anthropic from '@anthropic-ai/sdk';

import type { AiFailureCode } from '@/modules/ai/errors';
import { anthropicFailure } from '@/modules/ai/providers/anthropic';
import { AiProviderError } from '@/modules/ai/providers/types';
import { voyageEmbedder } from '@/modules/ai/providers/voyage';

/** Voyage has no public model list; these are its current multilingual embedding models (1,024 dimensions). */
export const voyageModels = ['voyage-3.5', 'voyage-3.5-lite', 'voyage-3-large', 'voyage-multilingual-2'] as const;

export type KeyTest = { ok: true; models: string[] } | { ok: false; code: AiFailureCode; detail: string };

/**
 * "Test connection" (FR1.5): one cheap, read-only call with the key. Claude: list the models the key can use (also the
 * default-model picker); Voyage: embed one word. Nothing is stored; the key is never logged.
 */
export async function testAiKey(provider: 'anthropic' | 'voyage', apiKey: string, model?: string | null): Promise<KeyTest> {
  try {
    if (provider === 'anthropic') {
      const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 20_000 });
      const models: string[] = [];
      // Auto-pagination: the account may offer more models than one page holds.
      for await (const m of client.models.list({ limit: 100 })) models.push(m.id);
      return { ok: true, models };
    }
    await voyageEmbedder({ apiKey, model: model || voyageModels[0] }).embed(['ping'], 'query');
    return { ok: true, models: [...voyageModels] };
  } catch (error) {
    const failure = error instanceof AiProviderError ? error : anthropicFailure(error);
    return { ok: false, code: failure.code, detail: failure.detail.slice(0, 300) };
  }
}
