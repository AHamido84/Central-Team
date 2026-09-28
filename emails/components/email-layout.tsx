import { Body, Container, Head, Hr, Html, Preview, Section, Text } from '@react-email/components';
import type { ReactNode } from 'react';

export type EmailLayoutProps = {
  locale: 'ar' | 'en';
  preview: string;
  brandName: string;
  brandColor: string;
  footer: string;
  children: ReactNode;
};

export function EmailLayout({ locale, preview, brandName, brandColor, footer, children }: EmailLayoutProps) {
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  return (
    <Html lang={locale} dir={dir}>
      <Head />
      <Preview>{preview}</Preview>
      <Body
        style={{
          margin: 0,
          backgroundColor: '#F1F3F6',
          fontFamily: "'IBM Plex Sans Arabic', Inter, 'Segoe UI', Tahoma, Arial, sans-serif",
          color: '#161A22',
        }}
      >
        <Container
          style={{
            maxWidth: 520,
            margin: '32px auto',
            backgroundColor: '#ffffff',
            borderRadius: 12,
            border: '1px solid #E4E7EC',
            padding: 32,
            direction: dir,
            textAlign: locale === 'ar' ? 'right' : 'left',
          }}
        >
          <Text style={{ fontWeight: 700, fontSize: 18, color: brandColor, margin: '0 0 24px' }}>{brandName}</Text>
          <Section>{children}</Section>
          <Hr style={{ borderColor: '#E4E7EC', margin: '28px 0 16px' }} />
          <Text style={{ fontSize: 12, color: '#6B7485', margin: 0, lineHeight: 1.6 }}>{footer}</Text>
        </Container>
      </Body>
    </Html>
  );
}

export function EmailButton({ href, color, children }: { href: string; color: string; children: ReactNode }) {
  return (
    <a
      href={href}
      style={{
        display: 'inline-block',
        backgroundColor: color,
        color: '#ffffff',
        textDecoration: 'none',
        padding: '12px 20px',
        borderRadius: 8,
        fontWeight: 600,
        fontSize: 15,
      }}
    >
      {children}
    </a>
  );
}
