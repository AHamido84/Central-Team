import 'server-only';

import { render } from '@react-email/components';
import { createTranslator } from 'next-intl';

import ActionEmail, { type ActionEmailProps } from '../../../emails/action-email';
import { emailProvider } from '@/lib/email/provider';
import { localized, type Locale, type LocalizedText } from '@/lib/i18n/localized';
import { loadMessages } from '@/i18n/messages';

export type EmailBrand = { name: LocalizedText; primaryColor?: string | null };

export async function emailTranslator(locale: Locale) {
  const messages = await loadMessages(locale);
  return createTranslator({ locale, messages, namespace: 'emails' });
}

/** Renders the shared action email in the recipient's language and sends it through the provider. */
export async function sendActionEmail(args: {
  to: string;
  locale: Locale;
  brand: EmailBrand;
  subject: string;
  content: Omit<ActionEmailProps, 'locale' | 'brandName' | 'brandColor' | 'footer' | 'preview'> & {
    preview?: string;
  };
  tags?: Record<string, string>;
}) {
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
  return emailProvider().send({ to: args.to, subject: args.subject, html, text, tags: args.tags });
}
