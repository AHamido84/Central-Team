/**
 * Deterministic embeddings for the mock provider (ADR-073): feature hashing of normalized words and word pairs into
 * 1024 dimensions, L2-normalized. Similar wording → similar vectors, so retrieval behaves sensibly in development,
 * tests and demos without a model. Pure (no server imports): the seed uses it too.
 */
import { EMBEDDING_DIMENSIONS, type AiEmbedder } from '@/modules/ai/providers/types';

export const MOCK_EMBEDDING_MODEL = 'mock-hash-1024';

/** Arabic-aware normalization: strip diacritics and tatweel, unify alef / ya / ta marbuta, drop a leading "ال". */
export function normalizeToken(raw: string): string {
  let t = raw
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
  if (t.length > 4 && t.startsWith('ال')) t = t.slice(2);
  return t;
}

/** Function words that carry no topic (after normalization). */
const STOP = new Set(
  'ما ماذا من في علي الي عن مع هذا هذه ذلك تلك التي الذي هل كم كيف اين متي او ثم قد كل بعض هو هي هم نحن انا انت لدي عند the a an of to in on for and or is are was were be what which who how when where this that these those with from by at do does did our my your their it its'.split(
    ' ',
  ),
);

export function tokenize(text: string): string[] {
  return (text.match(/[\p{L}\p{N}]+/gu) ?? []).map(normalizeToken).filter((t) => t.length >= 2 && !STOP.has(t));
}

/** FNV-1a 32-bit. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function mockEmbed(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const tokens = tokenize(text);
  const add = (feature: string, weight: number) => {
    const h = hash(feature);
    v[h % EMBEDDING_DIMENSIONS]! += (h & 0x80000000 ? -1 : 1) * weight;
  };
  tokens.forEach((t, i) => {
    add(t, 1);
    if (i > 0) add(`${tokens[i - 1]} ${t}`, 0.5);
    // Sub-word trigrams so related forms still meet (حملة / حملات, campaign / campaigns).
    for (let j = 0; j + 3 <= t.length; j++) add(`#${t.slice(j, j + 3)}`, 0.3);
  });
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  // An empty text gets a fixed unit vector (pgvector's cosine distance is undefined for zero vectors).
  if (norm === 0) {
    v[0] = 1;
    return v;
  }
  return v.map((x) => x / norm);
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot;
}

export const approxTokens = (text: string) => Math.ceil(text.length / 4);

export const mockEmbedder: AiEmbedder = {
  key: 'mock',
  model: MOCK_EMBEDDING_MODEL,
  async embed(texts) {
    return { vectors: texts.map(mockEmbed), tokens: texts.reduce((s, t) => s + approxTokens(t), 0) };
  },
};
