import type { Locale } from '@/lib/i18n/localized';
import type { AiFailureCode } from '@/modules/ai/errors';
import type { SourceType } from '@/modules/ai/types';

export type AiPurpose = 'assistant' | 'report_draft' | 'insight_explain';

/** A tool the model may call (assistant retrieval, ADR-090). The input schema is JSON Schema; inputs are re-validated. */
export type AiToolSpec = { name: string; description: string; inputSchema: Record<string, unknown> };
export type AiToolCall = { id: string; name: string; input: unknown };
export type AiToolResult = { toolUseId: string; content: string; isError?: boolean };

/**
 * One turn of a conversation. A tool round adds an assistant turn with `toolCalls` (and `raw`: the provider's own
 * content blocks, echoed back unchanged so thinking blocks stay valid — the loop only appends) and a user turn with
 * the `toolResults`.
 */
export type AiTurn = {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: AiToolCall[];
  toolResults?: AiToolResult[];
  raw?: unknown;
};

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
  tools?: AiToolSpec[];
  /** `none` on the loop's last round: the tools stay declared (the history has tool calls) but the model must answer. */
  toolChoice?: 'auto' | 'none';
};

export type CompleteResult = {
  text: string;
  /** `refusal`: the model (and its server-side fallback) declined; `max_tokens`: cut off; `tool_use`: wants tools run. */
  stop: 'end' | 'refusal' | 'max_tokens' | 'tool_use';
  model: string;
  usage: { input: number; output: number };
  toolCalls?: AiToolCall[];
  /** Provider content to append unchanged as the assistant turn of the next request. */
  raw?: unknown;
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

export type AiErrorCode = AiFailureCode;

/** A classified provider failure (the code is translated; the detail goes to the log). */
export class AiProviderError extends Error {
  constructor(
    readonly code: AiErrorCode,
    readonly detail = '',
  ) {
    super(`${code}${detail ? `: ${detail}` : ''}`);
  }
}
