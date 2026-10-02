import 'server-only';

import { classifyProviderFailure } from '@/modules/ai/errors';
import { AiProviderError, EMBEDDING_DIMENSIONS, type AiEmbedder } from '@/modules/ai/providers/types';

const ENDPOINT = 'https://api.voyageai.com/v1/embeddings';
const BATCH = 64;

type VoyageResponse = { data: { embedding: number[]; index: number }[]; usage?: { total_tokens?: number } };

/**
 * Voyage AI embeddings (Anthropic has no embedding endpoint — ADR-073). `voyage-3.5` is multilingual (Arabic included)
 * and returns 1024 dimensions, matching `ai_chunks.embedding`.
 */
export function voyageEmbedder(config: { apiKey: string; model: string }): AiEmbedder {
  return {
    key: 'voyage',
    model: config.model,
    async embed(texts, kind) {
      const vectors: number[][] = [];
      let tokens = 0;
      for (let i = 0; i < texts.length; i += BATCH) {
        const batch = texts.slice(i, i + BATCH);
        let res: Response;
        try {
          res = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
            body: JSON.stringify({ input: batch, model: config.model, input_type: kind, output_dimension: EMBEDDING_DIMENSIONS }),
            signal: AbortSignal.timeout(30_000),
          });
        } catch (error) {
          const timeout = error instanceof Error && error.name === 'TimeoutError';
          throw new AiProviderError(timeout ? 'ai_timeout' : 'ai_unavailable', error instanceof Error ? error.message : String(error));
        }
        if (!res.ok) throw new AiProviderError(classifyProviderFailure({ status: res.status }), `voyage ${res.status}`);
        const body = (await res.json()) as VoyageResponse;
        const ordered = [...body.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
        if (ordered.length !== batch.length || ordered.some((v) => v.length !== EMBEDDING_DIMENSIONS)) {
          throw new AiProviderError('ai_unavailable', 'voyage returned unexpected embeddings');
        }
        vectors.push(...ordered);
        tokens += body.usage?.total_tokens ?? 0;
      }
      return { vectors, tokens };
    },
  };
}
