import type { Locale } from '@/lib/i18n/localized';
import type { SourceType } from '@/modules/ai/types';

export type AiPurpose = 'assistant' | 'report_draft' | 'insight_explain';

export type AiTurn = { role: 'user' | 'assistant'; content: string };

/** A retrieved source as the model sees it: numbered, so the answer can cite `[n]`. */
export type GroundingSource = { n: number; sourceType: SourceType; title: string; content: string };

/**
 * What a prompt was built from. Live adapters rely on the prompt text (which contains all of it); the mock composes its
 * output from these structured facts, so it stays deterministic and in the right language.
 */
export type Grounding =
  | { kind: 'assistant'; question: string; sources: GroundingSource[] }
  | { kind: 'report_section'; section: 'commentary' | 'next_steps'; lines: string[] }
  | { kind: 'insight'; lines: string[] };

export type CompleteInput = {
  purpose: AiPurpose;
  locale: Locale;
  system: string;
  messages: AiTurn[];
  grounding: Grounding;
};

export type CompleteResult = {
  text: string;
  /** `refusal`: the model (and its server-side fallback) declined; `max_tokens`: cut off. */
  stop: 'end' | 'refusal' | 'max_tokens';
  model: string;
  usage: { input: number; output: number };
};

/** Text generation (ADR-073). */
export interface AiCompleter {
  key: 'anthropic' | 'mock';
  model: string;
  complete(input: CompleteInput): Promise<CompleteResult>;
}

export const EMBEDDING_DIMENSIONS = 1024;

/** Vectors for retrieval: `document` when indexing, `query` for a question (asymmetric models use both). */
export interface AiEmbedder {
  key: 'voyage' | 'mock';
  model: string;
  embed(texts: string[], kind: 'document' | 'query'): Promise<{ vectors: number[][]; tokens: number }>;
}

export type AiErrorCode = 'ai_not_configured' | 'ai_refused' | 'ai_unavailable';

/** A classified provider failure (the code is translated; the detail goes to the log). */
export class AiProviderError extends Error {
  constructor(
    readonly code: AiErrorCode,
    readonly detail = '',
  ) {
    super(`${code}${detail ? `: ${detail}` : ''}`);
  }
}
