import { describe, expect, it } from 'vitest';

import { ActionFailure, toActionError } from '@/lib/actions/errors';
import { classifyUpload, slugifyFileName, storagePaths } from '@/lib/storage';
import { email, optionalPhone, phone, url } from '@/lib/validation';
import { extractMentionIds, parseBody, plainText, preview } from '@/modules/messaging/mentions';
import { hashInvitationToken, generateInvitationToken, invitationExpiry } from '@/modules/invitations/server/tokens';

const ID = '11111111-2222-4333-8444-555555555555';

describe('mentions', () => {
  const body = `Hi @[Sara Q](${ID}), please check @[نورة](${ID.replace('1', '9')}) too`;
  it('parses mention markup into segments', () => {
    const segs = parseBody(body);
    expect(segs.filter((s) => s.type === 'mention').map((s) => (s.type === 'mention' ? s.name : ''))).toEqual(['Sara Q', 'نورة']);
  });
  it('extracts unique ids', () => {
    expect(extractMentionIds(`${body} @[Sara Q](${ID})`)).toHaveLength(2);
  });
  it('renders plain text and previews', () => {
    expect(plainText(body)).toBe('Hi @Sara Q, please check @نورة too');
    expect(preview('a'.repeat(200), 10)).toHaveLength(10);
  });
});

describe('validation', () => {
  it('normalizes Saudi mobile numbers to E.164', () => {
    expect(phone.parse('0551234567')).toBe('+966551234567');
    expect(phone.parse('551234567')).toBe('+966551234567');
    expect(phone.parse('00966 55 123 4567')).toBe('+966551234567');
    expect(phone.safeParse('12').success).toBe(false);
    expect(optionalPhone.parse('')).toBeNull();
  });
  it('lower-cases emails and adds https to bare domains', () => {
    expect(email.parse('  Sara@Ofoq.TEST ')).toBe('sara@ofoq.test');
    expect(url.parse('najd.example')).toBe('https://najd.example');
    expect(url.parse('')).toBeNull();
  });
});

describe('uploads', () => {
  it('allows known types within their size limits', () => {
    expect(classifyUpload('image/png', 1024)).toEqual({ ok: true, kind: 'image' });
    expect(classifyUpload('application/pdf', 1024)).toEqual({ ok: true, kind: 'pdf' });
    expect(classifyUpload('video/mp4', 150 * 1024 * 1024)).toEqual({ ok: true, kind: 'video' });
  });
  it('rejects unknown types and oversized files', () => {
    expect(classifyUpload('application/x-msdownload', 10)).toMatchObject({ ok: false, code: 'file_type_not_allowed' });
    expect(classifyUpload('image/svg+xml', 10)).toMatchObject({ ok: false, code: 'file_type_not_allowed' });
    expect(classifyUpload('image/jpeg', 40 * 1024 * 1024)).toMatchObject({ ok: false, code: 'file_too_large' });
  });
  it('builds tenant-scoped storage paths with safe file names', () => {
    expect(slugifyFileName('Brand Guide (Final).PDF')).toBe('brand-guide-final.pdf');
    expect(slugifyFileName('شعار.png')).toBe('file.png');
    expect(storagePaths.clientFile('org', 'cli', null, 'f1', 'a b.png')).toBe('org/org/clients/cli/root/f1-a-b.png');
    expect(storagePaths.attachment('org', 'cli', 'th', 'f1', 'x.pdf')).toBe('org/org/clients/cli/threads/th/f1-x.pdf');
  });
});

describe('invitation tokens', () => {
  it('generates 32-byte URL-safe tokens and stores only a SHA-256 hash', () => {
    const { token, hash } = generateInvitationToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInvitationToken(token)).toBe(hash);
    expect(hash).not.toContain(token);
  });
  it('expires after 7 days', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    expect(invitationExpiry(from).toISOString()).toBe('2026-01-08T00:00:00.000Z');
  });
});

describe('action errors', () => {
  it('maps database errors raised by RLS and triggers to safe codes', () => {
    expect(toActionError({ code: '42501', message: 'new row violates row-level security policy' })).toEqual({ code: 'forbidden' });
    expect(toActionError({ cause: { code: '42501', message: 'last_super_admin' } })).toEqual({ code: 'last_super_admin' });
    expect(toActionError({ code: '23505', message: 'duplicate key' })).toEqual({ code: 'conflict' });
    expect(toActionError(new ActionFailure('already_member'))).toEqual({ code: 'already_member', fieldErrors: undefined });
    expect(toActionError(new Error('boom'))).toEqual({ code: 'unknown' });
  });
});
