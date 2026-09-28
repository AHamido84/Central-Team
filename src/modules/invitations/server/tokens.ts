import { createHash, randomBytes } from 'node:crypto';

export const INVITATION_TTL_DAYS = 7;

/** 32 random bytes, URL-safe. Only the SHA-256 hash is stored (CLAUDE.md §8.7). */
export function generateInvitationToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashInvitationToken(token) };
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function invitationExpiry(from = new Date()): Date {
  return new Date(from.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
}
