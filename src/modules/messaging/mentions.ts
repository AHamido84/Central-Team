/**
 * Mentions are stored inline as `@[Display Name](uuid)` so the text survives renames and can be
 * rendered as chips; `mentions` column holds the ids for querying and notifications.
 */
export const MENTION_RE = /@\[([^\]\n]{1,80})\]\(([0-9a-f-]{36})\)/g;

export type BodySegment = { type: 'text'; text: string } | { type: 'mention'; name: string; userId: string };

export function parseBody(body: string): BodySegment[] {
  const segments: BodySegment[] = [];
  let last = 0;
  for (const match of body.matchAll(MENTION_RE)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ type: 'text', text: body.slice(last, index) });
    segments.push({ type: 'mention', name: match[1]!, userId: match[2]! });
    last = index + match[0].length;
  }
  if (last < body.length) segments.push({ type: 'text', text: body.slice(last) });
  return segments;
}

export function extractMentionIds(body: string): string[] {
  return [...new Set([...body.matchAll(MENTION_RE)].map((m) => m[2]!))];
}

/** Plain-text version for previews, emails and notifications. */
export function plainText(body: string): string {
  return body.replace(MENTION_RE, (_m, name: string) => `@${name}`);
}

export function preview(body: string, max = 120): string {
  const text = plainText(body).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
