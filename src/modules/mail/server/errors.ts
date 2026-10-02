import type { MailErrorCode } from '@/modules/mail/constants';

type MailFailure = { code?: string; responseCode?: number; command?: string; message?: string; resendName?: string };

/**
 * Turns a provider failure (nodemailer / Resend) into a code the UI explains: "wrong app password", "port blocked",
 * "TLS failed"… The raw message is kept separately for the log, never shown as the explanation.
 */
export function classifyMailError(error: unknown): MailErrorCode {
  const e = (error ?? {}) as MailFailure;
  const message = (e.message ?? String(error)).toLowerCase();
  const code = e.code ?? '';

  if (e.resendName) {
    if (/api_key|restricted_api_key/.test(e.resendName) || /api key/.test(message)) return 'api_key_invalid';
    if (e.resendName === 'rate_limit_exceeded' || e.resendName === 'daily_quota_exceeded') return 'rate_limited';
    if (/domain|from/.test(message)) return 'sender_rejected';
    return 'unknown';
  }
  if (
    code === 'EAUTH' ||
    e.responseCode === 535 ||
    e.responseCode === 534 ||
    /username and password not accepted|authentication/.test(message)
  )
    return 'auth_failed';
  if (code === 'EDNS' || /enotfound|getaddrinfo/.test(message)) return 'host_not_found';
  if (code === 'ETIMEDOUT' || /timeout|timed out/.test(message))
    return code === 'ETIMEDOUT' || /connection timeout/.test(message) ? 'port_blocked' : 'timeout';
  if (code === 'ECONNECTION' || /econnrefused|econnreset|ehostunreach|enetunreach/.test(message)) return 'port_blocked';
  if (code === 'ETLS' || /tls|ssl|certificate|wrong version number|starttls/.test(message)) return 'tls_failed';
  if (e.responseCode === 421 || e.responseCode === 450 || e.responseCode === 452 || /rate|too many|quota|limit exceeded/.test(message))
    return 'rate_limited';
  if (code === 'EENVELOPE' || e.command === 'MAIL FROM' || /sender|from address|not owned|send ?as/.test(message)) return 'sender_rejected';
  if (e.command === 'RCPT TO' || e.responseCode === 550 || e.responseCode === 553) return 'recipient_rejected';
  return 'unknown';
}

/** Codes worth retrying later; the others won't fix themselves. */
export function isTransient(code: MailErrorCode): boolean {
  return code === 'port_blocked' || code === 'timeout' || code === 'rate_limited' || code === 'unknown' || code === 'daily_limit';
}
