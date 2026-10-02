import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db/client';
import { aiCredentials } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { aiMode, getCompleter, getEmbedder, type AiMode } from '@/modules/ai/providers';
import { anthropicCompleter } from '@/modules/ai/providers/anthropic';
import type { AiCompleter, AiEmbedder } from '@/modules/ai/providers/types';
import { voyageEmbedder } from '@/modules/ai/providers/voyage';

export type AiCredentialSource = { id: string; monthlyTokenLimit: number | null } | null;

export type AiClient = {
  mode: AiMode;
  completer: AiCompleter | null;
  embedder: AiEmbedder | null;
  /** Where each side comes from: an organization credential (with its monthly limit) or the environment (null). */
  sources: { anthropic: AiCredentialSource; voyage: AiCredentialSource };
  /** Stored keys that exist but could not be decrypted (shown by "Test assistant"; the client falls back meanwhile). */
  decryptFailed: ('anthropic' | 'voyage')[];
};

/** Decrypts without throwing: a Vault problem degrades to "no key" and is reported, never crashes a page (ADR-089). */
async function tryDecrypt(credentialId: string): Promise<{ key: string | null; failed: boolean }> {
  try {
    return { key: await decryptAiKey(credentialId), failed: false };
  } catch (error) {
    console.error('[ai] decrypting a provider key failed', error);
    return { key: null, failed: true };
  }
}

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; client: AiClient }>();

/** Forget an organization's cached client after its credentials change. */
export function invalidateAiClient(organizationId: string) {
  cache.delete(organizationId);
}

/**
 * Decrypts a stored key — service path (CLAUDE.md §6, ADR-085): only server code ever sees a key, to call the provider.
 * Users cannot read it (`app.ai_credential_get_key` refuses the `authenticated` role).
 */
export async function decryptAiKey(credentialId: string): Promise<string | null> {
  const [row] = await dbAdmin.execute<{ key: string | null }>(sql`select app.ai_credential_get_key(${credentialId}::uuid) as key`);
  return row?.key ?? null;
}

/**
 * The AI client for an organization (FR1.5): its active credentials from `/admin/ai` first, the environment keys
 * (`ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`) as the fallback, then the mock outside production (ADR-073). Cached for a
 * minute per organization so keys aren't decrypted on every call.
 */
export async function getAIClient(organizationId: string): Promise<AiClient> {
  const hit = cache.get(organizationId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.client;
  // Service path: reading the organization's active credentials to build its provider client.
  const rows = await dbAdmin
    .select()
    .from(aiCredentials)
    .where(and(eq(aiCredentials.organizationId, organizationId), eq(aiCredentials.isActive, true)));
  const anthropic = rows.find((r) => r.provider === 'anthropic');
  const voyage = rows.find((r) => r.provider === 'voyage');
  const e = env();

  const decryptFailed: AiClient['decryptFailed'] = [];
  let completer: AiCompleter | null = null;
  const a = anthropic ? await tryDecrypt(anthropic.id) : { key: null, failed: false };
  if (a.failed || (anthropic && !a.key)) decryptFailed.push('anthropic');
  const anthropicKey = a.key;
  if (anthropic && anthropicKey) completer = anthropicCompleter({ apiKey: anthropicKey, model: anthropic.defaultModel || e.AI_MODEL });
  else completer = getCompleter();

  let embedder: AiEmbedder | null = null;
  const v = voyage ? await tryDecrypt(voyage.id) : { key: null, failed: false };
  if (v.failed || (voyage && !v.key)) decryptFailed.push('voyage');
  const voyageKey = v.key;
  if (voyage && voyageKey) embedder = voyageEmbedder({ apiKey: voyageKey, model: voyage.defaultModel || e.AI_EMBEDDING_MODEL });
  else embedder = getEmbedder();

  // An organization key for the writer makes the organization live even when the environment has no keys.
  const mode: AiMode = completer
    ? completer.key === 'mock'
      ? 'mock'
      : 'live'
    : anthropicKey
      ? 'live'
      : aiMode() === 'mock'
        ? 'mock'
        : 'off';
  const client: AiClient = {
    mode,
    completer,
    embedder,
    sources: {
      anthropic: anthropic && anthropicKey ? { id: anthropic.id, monthlyTokenLimit: anthropic.monthlyTokenLimit } : null,
      voyage: voyage && voyageKey ? { id: voyage.id, monthlyTokenLimit: voyage.monthlyTokenLimit } : null,
    },
    decryptFailed,
  };
  cache.set(organizationId, { at: Date.now(), client });
  return client;
}
