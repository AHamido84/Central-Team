import net from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SmtpEmailProvider } from '@/lib/email/provider';
import { presetDefaults } from '@/modules/mail/constants';
import { fromMismatch, mailSettingsSchema } from '@/modules/mail/schemas';
import { classifyMailError, isTransient } from '@/modules/mail/server/errors';

/**
 * FR2.1 — the connection test against a mock SMTP server: a plain-text server that speaks just enough SMTP (EHLO,
 * AUTH PLAIN / LOGIN, MAIL / RCPT / DATA, QUIT) to accept one username / password and reject everything else.
 */
const USER = 'agency@example.com';
const PASS = 'abcd efgh ijkl mnop';
const received: string[] = [];
let server: net.Server;
let port = 0;

function smtpServer() {
  return net.createServer((socket) => {
    let state: 'cmd' | 'login-user' | 'login-pass' | 'data' = 'cmd';
    let loginUser = '';
    let data = '';
    const send = (line: string) => socket.write(`${line}\r\n`);
    const check = (u: string, p: string) =>
      send(u === USER && p === PASS ? '235 2.7.0 Accepted' : '535 5.7.8 Username and Password not accepted');
    send('220 mock.smtp ESMTP ready');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let i;
      while ((i = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (state === 'data') {
          if (line === '.') {
            received.push(data);
            data = '';
            state = 'cmd';
            send('250 2.0.0 queued as mock-1');
          } else data += `${line}\n`;
          continue;
        }
        if (state === 'login-user') {
          loginUser = Buffer.from(line, 'base64').toString();
          state = 'login-pass';
          send('334 UGFzc3dvcmQ6');
          continue;
        }
        if (state === 'login-pass') {
          state = 'cmd';
          check(loginUser, Buffer.from(line, 'base64').toString());
          continue;
        }
        const [cmd, ...rest] = line.split(' ');
        switch ((cmd ?? '').toUpperCase()) {
          case 'EHLO':
            socket.write('250-mock.smtp\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n');
            break;
          case 'AUTH':
            if (rest[0]?.toUpperCase() === 'PLAIN') {
              const [, u, p] = Buffer.from(rest[1] ?? '', 'base64')
                .toString()
                .split('\0');
              check(u ?? '', p ?? '');
            } else {
              state = 'login-user';
              send('334 VXNlcm5hbWU6');
            }
            break;
          case 'MAIL':
          case 'RCPT':
            send('250 2.1.0 OK');
            break;
          case 'DATA':
            state = 'data';
            send('354 End data with <CR><LF>.<CR><LF>');
            break;
          case 'QUIT':
            send('221 2.0.0 Bye');
            socket.end();
            break;
          default:
            send('250 OK');
        }
      }
    });
  });
}

beforeAll(async () => {
  server = smtpServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as net.AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const provider = (pass: string, p = port) =>
  new SmtpEmailProvider({ host: '127.0.0.1', port: p, security: 'none', user: USER, pass, from: USER });

describe('connection test (mock SMTP server)', () => {
  it('passes with the right app password and sends through it', async () => {
    await expect(provider(PASS).verify()).resolves.toBeUndefined();
    const { id } = await provider(PASS).send({ to: 'someone@example.com', subject: 'Hello', html: '<p>Hi</p>', text: 'Hi' });
    expect(id).toBeTruthy();
    expect(received.at(-1)).toContain('Subject: Hello');
  });

  it('a wrong app password is reported as such', async () => {
    const error = await provider('wrong-password')
      .verify()
      .catch((e: unknown) => e);
    expect(classifyMailError(error)).toBe('auth_failed');
    expect(isTransient('auth_failed')).toBe(false);
  });

  it('a closed port is reported as blocked', async () => {
    const closed = net.createServer();
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
    const free = (closed.address() as net.AddressInfo).port;
    await new Promise<void>((r) => closed.close(() => r()));
    const error = await provider(PASS, free)
      .verify()
      .catch((e: unknown) => e);
    expect(classifyMailError(error)).toBe('port_blocked');
    expect(isTransient('port_blocked')).toBe(true);
  });
});

describe('error codes', () => {
  it.each([
    [{ code: 'EAUTH', responseCode: 535, message: 'Invalid login: 535-5.7.8 Username and Password not accepted' }, 'auth_failed'],
    [{ code: 'ESOCKET', message: 'ssl3_get_record:wrong version number' }, 'tls_failed'],
    [{ code: 'EDNS', message: 'getaddrinfo ENOTFOUND smtp.gmial.com' }, 'host_not_found'],
    [{ code: 'ECONNECTION', message: 'connect ECONNREFUSED 1.2.3.4:587' }, 'port_blocked'],
    [{ code: 'EENVELOPE', command: 'MAIL FROM', message: '553 Sender address rejected: not owned by user' }, 'sender_rejected'],
    [{ responseCode: 421, message: '421 Too many messages' }, 'rate_limited'],
    [{ resendName: 'validation_error', message: 'API key is invalid' }, 'api_key_invalid'],
    [{ resendName: 'validation_error', message: 'The example.com domain is not verified' }, 'sender_rejected'],
  ])('%o → %s', (error, code) => {
    expect(classifyMailError(error)).toBe(code);
  });
});

describe('settings form', () => {
  it('Gmail-like providers warn when From differs from the signed-in account', () => {
    expect(fromMismatch({ preset: 'gmail', username: 'me@gmail.com', fromEmail: 'me@gmail.com' })).toBe(false);
    expect(fromMismatch({ preset: 'gmail', username: 'me@gmail.com', fromEmail: 'no-reply@agency.sa' })).toBe(true);
    expect(fromMismatch({ preset: 'resend', username: null, fromEmail: 'no-reply@agency.sa' })).toBe(false);
  });

  it('presets carry the provider settings; SMTP presets need a username', () => {
    expect(presetDefaults.gmail).toMatchObject({ host: 'smtp.gmail.com', port: 587, security: 'starttls' });
    const missing = mailSettingsSchema.safeParse({ preset: 'gmail', security: 'starttls', fromEmail: 'me@gmail.com' });
    expect(missing.success).toBe(false);
    const ok = mailSettingsSchema.safeParse({
      preset: 'resend',
      security: 'starttls',
      fromEmail: 'no-reply@agency.sa',
      secret: 're_123456',
    });
    expect(ok.success).toBe(true);
  });
});
