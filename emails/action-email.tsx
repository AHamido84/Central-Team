import { Heading, Text } from '@react-email/components';

import { EmailButton, EmailLayout, type EmailLayoutProps } from './components/email-layout';

export type ActionEmailProps = Omit<EmailLayoutProps, 'children'> & {
  heading: string;
  paragraphs: string[];
  quote?: string;
  cta: { label: string; href: string };
  note?: string;
};

/** Generic transactional email: heading, body, optional quoted content, one call to action. */
export default function ActionEmail({ heading, paragraphs, quote, cta, note, ...layout }: ActionEmailProps) {
  const lineHeight = layout.locale === 'ar' ? 1.8 : 1.6;
  return (
    <EmailLayout {...layout}>
      <Heading as="h1" style={{ fontSize: 20, margin: '0 0 12px', lineHeight: 1.4 }}>
        {heading}
      </Heading>
      {paragraphs.map((p) => (
        <Text key={p} style={{ fontSize: 15, color: '#4D5566', lineHeight, margin: '0 0 12px' }}>
          {p}
        </Text>
      ))}
      {quote ? (
        <Text
          style={{
            fontSize: 14,
            color: '#232833',
            backgroundColor: '#F8F9FB',
            borderRadius: 8,
            padding: '12px 16px',
            lineHeight,
            margin: '4px 0 20px',
            whiteSpace: 'pre-wrap',
          }}
        >
          {quote}
        </Text>
      ) : null}
      <EmailButton href={cta.href} color={layout.brandColor}>
        {cta.label}
      </EmailButton>
      {note ? <Text style={{ fontSize: 13, color: '#6B7485', lineHeight, margin: '20px 0 0' }}>{note}</Text> : null}
    </EmailLayout>
  );
}

ActionEmail.PreviewProps = {
  locale: 'ar',
  preview: 'دعوة للانضمام إلى سنترال',
  brandName: 'وكالة أفق للتسويق',
  brandColor: '#5140E0',
  footer: 'أُرسلت هذه الرسالة من سنترال.',
  heading: 'انضم إلى فريق وكالة أفق',
  paragraphs: ['دعاك سارة القحطاني للانضمام إلى مساحة العمل.'],
  cta: { label: 'قبول الدعوة', href: 'http://localhost:3000/invite/example' },
  note: 'تنتهي صلاحية الدعوة خلال 7 أيام.',
} satisfies ActionEmailProps;
