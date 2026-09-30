import 'server-only';

import Anthropic from '@anthropic-ai/sdk';

import { voyageEmbedder } from '@/modules/ai/providers/voyage';

/** Voyage has no public model list; these are its current multilingual embedding models (1,024 dimensions). */
export const voyageModels = ['voyage-3.5', 'voyage-3.5-lite', 'voyage-3-large', 'voyage-multilingual-2'] as const;

export type KeyTest = { ok: true; models: string[] } | { ok: false; code: 'ai_key_invalid' | 'ai_unavailable'; detail: string };

/**
 * "Test connection" (FR1.5): one cheap, read-only call with the key. Claude: list the models the key can use (also the
 * default-model picker); Voyage: embed one word. Nothing is stored; the key is never logged.
 */
export async function testAiKey(provider: 'anthropic' | 'voyage', apiKey: string, model?: string | null): Promise<KeyTest> {
  try {
    if (provider === 'anthropic') {
      const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 20_000 });
      const page = await client.models.list({ limit: 50 });
      return { ok: true, models: page.data.map((m) => m.id) };
    }
    await voyageEmbedder({ apiKey, model: model || voyageModels[0] }).embed(['ping'], 'query');
    return { ok: true, models: [...voyageModels] };
  } catch (error) {
    const status = (error as { status?: number }).status;
    const message = error instanceof Error ? error.message : String(error);
    if (status === 401 || status === 403 || /401|403|invalid.*key|unauthori[sz]ed/i.test(message)) {
      return { ok: false, code: 'ai_key_invalid', detail: `${status ?? ''} ${message}`.trim().slice(0, 300) };
    }
    return { ok: false, code: 'ai_unavailable', detail: `${status ?? ''} ${message}`.trim().slice(0, 300) };
  }
}
