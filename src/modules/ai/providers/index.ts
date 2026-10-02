import 'server-only';

import { env } from '@/lib/env';
import { anthropicCompleter } from '@/modules/ai/providers/anthropic';
import { mockCompleter } from '@/modules/ai/providers/mock';
import { mockEmbedder } from '@/modules/ai/providers/mock-embedder';
import type { AiCompleter, AiEmbedder } from '@/modules/ai/providers/types';
import { voyageEmbedder } from '@/modules/ai/providers/voyage';

export type AiMode = 'live' | 'mock' | 'off';

/** Environment variables a live setup still needs (empty = configured). */
export function missingAiEnv(): string[] {
  const e = env();
  return [...(e.ANTHROPIC_API_KEY ? [] : ['ANTHROPIC_API_KEY']), ...(e.VOYAGE_API_KEY ? [] : ['VOYAGE_API_KEY'])];
}

/**
 * Which provider runs (ADR-073): `AI_PROVIDER=mock` → mock (allowed in production for demos); both keys → live;
 * otherwise the mock outside production and nothing in production.
 */
export function aiMode(): AiMode {
  const e = env();
  if (e.AI_PROVIDER === 'mock') return 'mock';
  if (missingAiEnv().length === 0) return 'live';
  if (e.AI_PROVIDER === 'anthropic') return 'off';
  return process.env.NODE_ENV !== 'production' ? 'mock' : 'off';
}

export function getCompleter(): AiCompleter | null {
  const mode = aiMode();
  if (mode === 'mock') return mockCompleter;
  if (mode === 'off') return null;
  const e = env();
  return anthropicCompleter({ apiKey: e.ANTHROPIC_API_KEY!, model: e.AI_MODEL });
}

export function getEmbedder(): AiEmbedder | null {
  const mode = aiMode();
  if (mode === 'mock') return mockEmbedder;
  if (mode === 'off') return null;
  const e = env();
  return voyageEmbedder({ apiKey: e.VOYAGE_API_KEY!, model: e.AI_EMBEDDING_MODEL });
}
