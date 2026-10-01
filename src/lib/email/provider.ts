import 'server-only';

import nodemailer, { type Transporter } from 'nodemailer';
import { Resend } from 'resend';

import { env } from '@/lib/env';

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** `"Name" <address>`; defaults to the provider's own sender. */
  from?: string;
  replyTo?: string;
  tags?: Record<string, string>;
};

/** Provider interface (ADR-006 / ADR-088). Callers never import a vendor SDK. */
export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<{ id: string }>;
  /** Checks the connection and the credentials without sending anything. */
  verify?(): Promise<void>;
}

export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';
  readonly sent: EmailMessage[] = [];
  async send(message: EmailMessage) {
    this.sent.push(message);
    console.info(`[email:console] to=${message.to} subject="${message.subject}"`);
    return { id: `console-${this.sent.length}` };
  }
  async verify() {}
}

export type SmtpConfig = {
  host: string;
  port: number;
  security: 'starttls' | 'ssl' | 'none';
  user?: string | null;
  pass?: string | null;
  from: string;
};

export class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';
  private transport: Transporter;
  constructor(private config: SmtpConfig) {
    this.transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      // ssl = implicit TLS (465); starttls = upgrade required (587); none = plain (local catchers only).
      secure: config.security === 'ssl',
      requireTLS: config.security === 'starttls',
      ignoreTLS: config.security === 'none',
      auth: config.user ? { user: config.user, pass: config.pass ?? '' } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  async send(message: EmailMessage) {
    const info = await this.transport.sendMail({
      from: message.from ?? this.config.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      replyTo: message.replyTo,
    });
    return { id: info.messageId };
  }
  async verify() {
    await this.transport.verify();
  }
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';
  private client: Resend;
  constructor(
    apiKey: string,
    private from: string,
  ) {
    this.client = new Resend(apiKey);
  }
  async send(message: EmailMessage) {
    const { data, error } = await this.client.emails.send({
      from: message.from ?? this.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      replyTo: message.replyTo,
      tags: message.tags
        ? Object.entries(message.tags).map(([name, value]) => ({ name, value: value.replace(/[^\w-]/g, '_') }))
        : undefined,
    });
    if (error || !data) throw Object.assign(new Error(error?.message ?? 'resend_failed'), { resendName: error?.name });
    return { id: data.id };
  }
  async verify() {
    const { error } = await this.client.domains.list();
    if (error) throw Object.assign(new Error(error.message), { resendName: error.name });
  }
}

let envProvider: EmailProvider | undefined;

/**
 * The environment's provider (EMAIL_PROVIDER): Mailpit locally, the fallback sender in production when the
 * organization's configured sender fails, and the sender for organizations that haven't configured one (ADR-088).
 */
export function environmentEmailProvider(): EmailProvider {
  if (envProvider) return envProvider;
  const e = env();
  switch (e.EMAIL_PROVIDER) {
    case 'resend':
      envProvider = e.RESEND_API_KEY ? new ResendEmailProvider(e.RESEND_API_KEY, e.EMAIL_FROM) : new ConsoleEmailProvider();
      break;
    case 'smtp':
      envProvider = new SmtpEmailProvider({
        host: e.SMTP_HOST ?? '127.0.0.1',
        port: e.SMTP_PORT ?? 54325,
        security: e.SMTP_SECURITY ?? 'none',
        user: e.SMTP_USER ?? null,
        pass: e.SMTP_PASS ?? null,
        from: e.EMAIL_FROM,
      });
      break;
    default:
      envProvider = new ConsoleEmailProvider();
  }
  return envProvider;
}
