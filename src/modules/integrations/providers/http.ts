import 'server-only';

import { ProviderError } from '@/modules/integrations/providers/types';
import type { ProviderErrorCode } from '@/modules/integrations/constants';

type Classify = (status: number, body: unknown) => ProviderErrorCode | null;

const TIMEOUT_MS = 20_000;

function defaultCode(status: number): ProviderErrorCode {
  if (status === 401) return 'auth_expired';
  if (status === 403) return 'permission_denied';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'platform_error';
  return 'platform_error';
}

/**
 * JSON over HTTPS with a timeout and error classification. `classify` lets an adapter read the platform's own error
 * body (e.g. Meta's `error.code = 190` = expired token) before the status-code fallback. Never logs tokens: callers
 * pass them in headers or bodies, and only the platform's error message ends up in `detail`.
 */
export async function requestJson<T>(url: string, init: RequestInit & { classify?: Classify } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' });
  } catch (error) {
    throw new ProviderError('network', error instanceof Error ? error.message : String(error));
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    if (res.ok) throw new ProviderError('invalid_response', text.slice(0, 200));
  }
  const classified = init.classify?.(res.status, body) ?? null;
  if (classified) throw new ProviderError(classified, platformMessage(body) ?? `HTTP ${res.status}`);
  if (!res.ok) throw new ProviderError(defaultCode(res.status), platformMessage(body) ?? `HTTP ${res.status}`);
  return body as T;
}

function platformMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const err = b.error as Record<string, unknown> | string | undefined;
  if (typeof err === 'string') return (b.error_description as string | undefined) ?? err;
  if (err && typeof err.message === 'string') return err.message.slice(0, 300);
  if (typeof b.message === 'string') return b.message.slice(0, 300);
  return null;
}

export const form = (values: Record<string, string>) => new URLSearchParams(values).toString();

/** `2026-09-30` → `2026-09-30` for platforms that want plain dates; guards the format we pass through. */
export function isoDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ProviderError('invalid_response', `bad date ${value}`);
  return value;
}

export const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
