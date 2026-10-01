import 'server-only';

import { render } from '@react-email/components';
import { createTranslator } from 'next-intl';

import ActionEmail, { type ActionEmailProps } from '@emails/action-email';
import { localized, type Locale, type LocalizedText } from '@/lib/i18n/localized';
import { loadMessages } from '@/i18n/messages';
import type { EmailKind } from '@/modules/mail/constants';
import { enqueueEmail } from '@/modules/mail/server/outbox';

export type EmailBrand = { name: LocalizedText; primaryColor?: string | null };

export async function emailTranslator(locale: Locale) {
  const messages = await loadMessages(locale);
  return createTranslator({ locale, messages, namespace: 'emails' });
}

export type ActionEmailContent = Omit<ActionEmailProps, 'locale' | 'brandName' | 'brandColor' | 'footer' | 'preview'> & {
  preview?: string;
};

/** Renders the shared action email in the recipient's language (HTML + plain text). */
export async function renderActionEmail(args: { locale: Locale; brand: EmailBrand; subject: string; content: ActionEmailContent }) {
  const t = await emailTranslator(args.locale);
  const brandName = localized(args.brand.name, args.locale);
  const props: ActionEmailProps = {
    locale: args.locale,
    brandName,
    brandColor: args.brand.primaryColor ?? '#5140E0',
    footer: t('footer', { brand: brandName }),
    preview: args.content.preview ?? args.subject,
    ...args.content,
  };
  const html = await render(<ActionEmail {...props} />);
  const text = await render(<ActionEmail {...props} />, { plainText: true });
  return { html, text };
}

/**
 * Renders the shared action email and queues it for the organization's sender (FR2.1 / ADR-088): delivery, retries,
 * fallback and the log are the outbox's job, so a mail failure never breaks the caller.
 */
export async function sendActionEmail(args: {
  organizationId: string | null;
  kind: EmailKind;
  to: string;
  userId?: string | null;
  locale: Locale;
  brand: EmailBrand;
  subject: string;
  content: ActionEmailContent;
  tags?: Record<string, string>;
  sensitive?: boolean;
  createdBy?: string | null;
}) {
  const { html, text } = await renderActionEmail(args);
  const id = await enqueueEmail({
    organizationId: args.organizationId,
    kind: args.kind,
    to: args.to,
    userId: args.userId,
    locale: args.locale,
    subject: args.subject,
    html,
    text,
    tags: args.tags,
    sensitive: args.sensitive,
    createdBy: args.createdBy,
  });
  return { id };
}
