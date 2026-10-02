/**
 * One taxonomy for every AI failure (FR3.2, ADR-089). Pure — shared by the providers, the runtime, the assistant thread
 * and the "Test assistant" diagnostics, and unit-tested. Every code has a translation under `errors.<code>` and, for the
 * thread, `ai.assistant.reason.<code>`.
 */
export const aiFailureCodes = [
  'ai_disabled',
  'ai_not_configured',
  'ai_key_invalid',
  'ai_model_unavailable',
  'ai_no_credit',
  'ai_rate_limited',
  'ai_budget_exceeded',
  'ai_timeout',
  'ai_refused',
  'ai_unavailable',
] as const;

export type AiFailureCode = (typeof aiFailureCodes)[number];

export const isAiFailureCode = (v: unknown): v is AiFailureCode => aiFailureCodes.includes(v as AiFailureCode);

/** Reasons an admin fixes in `/admin/ai` (the thread links there for people with `ai:manage`). */
const settingsFixable = new Set<AiFailureCode>([
  'ai_disabled',
  'ai_not_configured',
  'ai_key_invalid',
  'ai_model_unavailable',
  'ai_no_credit',
  'ai_budget_exceeded',
]);

export const fixableInSettings = (code: AiFailureCode) => settingsFixable.has(code);

/** What a failed provider call looked like, without depending on the SDK's classes (so this stays pure). */
export type ProviderFailure = {
  /** HTTP status, when the provider answered. */
  status?: number;
  /** The provider's error type (`authentication_error`, `not_found_error`, `billing_error`, …). */
  type?: string;
  message?: string;
  /** The request timed out on our side. */
  timeout?: boolean;
  /** No answer at all (DNS, TLS, connection reset, blocked egress). */
  connection?: boolean;
};

const CREDIT = /credit balance|billing|payment|insufficient (?:funds|credit)/i;
const MODEL = /^model:|\bmodel\b.*\b(?:not found|not supported|does not exist|is not available|deprecated|retired)\b/i;

/**
 * Maps a provider failure to the code shown to people. Order matters: a timeout or a missing connection says nothing
 * about the key; credit problems arrive as 400 or 402; a 404 on the Messages API means the model id (ADR-089).
 */
export function classifyProviderFailure(f: ProviderFailure): AiFailureCode {
  if (f.timeout) return 'ai_timeout';
  if (f.connection) return 'ai_unavailable';
  const message = f.message ?? '';
  if (f.status === 401 || f.status === 403 || f.type === 'authentication_error' || f.type === 'permission_error') return 'ai_key_invalid';
  if (f.status === 402 || f.type === 'billing_error' || CREDIT.test(message)) return 'ai_no_credit';
  if (f.status === 404 || f.type === 'not_found_error' || (f.status === 400 && MODEL.test(message))) return 'ai_model_unavailable';
  if (f.status === 429 || f.type === 'rate_limit_error') return 'ai_rate_limited';
  if (f.status === 408 || f.status === 504) return 'ai_timeout';
  return 'ai_unavailable';
}

/** Writer models in order of preference when a saved model id is no longer offered for the key (FR3.6). */
export const preferredAnthropicModels = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'];

/**
 * The model to keep for a credential: the wanted one when the key offers it, otherwise the first preferred model the
 * key offers (or its first model). `replaced` tells the admin we changed it.
 */
export function pickModel(available: readonly string[], wanted: string | null): { model: string | null; replaced: boolean } {
  if (available.length === 0) return { model: wanted, replaced: false };
  if (wanted && available.includes(wanted)) return { model: wanted, replaced: false };
  const next = preferredAnthropicModels.find((m) => available.includes(m)) ?? available[0]!;
  return { model: next, replaced: wanted !== null && wanted !== next };
}
