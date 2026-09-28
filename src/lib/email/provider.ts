import 'server-only';

import nodemailer from 'nodemailer';
import { Resend } from 'resend';

import { env } from '@/lib/env';

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  tags?: Record<string, string>;
};

/** Provider interface (ADR-006). Swap implementations with EMAIL_PROVIDER; callers never import a vendor SDK. */
export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<{ id: string }>;
}

export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';
  readonly sent: EmailMessage[] = [];
  async send(message: EmailMessage) {
    this.sent.push(message);
    console.info(`[email:console] to=${message.to} subject="${message.subject}"`);
    return { id: `console-${this.sent.length}` };
  }
}

export class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';
  private transport = nodemailer.createTransport({
    host: env().SMTP_HOST ?? '127.0.0.1',
    port: env().SMTP_PORT ?? 54325,
    secure: false,
  });
  async send(message: EmailMessage) {
    const info = await this.transport.sendMail({
      from: env().EMAIL_FROM,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      replyTo: message.replyTo,
    });
    return { id: info.messageId };
  }
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';
  private client = new Resend(env().RESEND_API_KEY);
  async send(message: EmailMessage) {
    const { data, error } = await this.client.emails.send({
      from: env().EMAIL_FROM,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      replyTo: message.replyTo,
      tags: message.tags ? Object.entries(message.tags).map(([name, value]) => ({ name, value })) : undefined,
    });
    if (error || !data) throw new Error(`resend_failed: ${error?.message ?? 'unknown'}`);
    return { id: data.id };
  }
}

let provider: EmailProvider | undefined;

export function emailProvider(): EmailProvider {
  if (provider) return provider;
  switch (env().EMAIL_PROVIDER) {
    case 'resend':
      provider = new ResendEmailProvider();
      break;
    case 'smtp':
      provider = new SmtpEmailProvider();
      break;
    default:
      provider = new ConsoleEmailProvider();
  }
  return provider;
}
