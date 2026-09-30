import { randomBytes } from 'node:crypto';

/** Codes the sandbox consent page issues: `sbx.<l|s>.<random>` — `s` = short-lived token, no refresh (to see expiry). */
export function sandboxCode(shortLived: boolean): string {
  return `sbx.${shortLived ? 's' : 'l'}.${randomBytes(12).toString('base64url')}`;
}
