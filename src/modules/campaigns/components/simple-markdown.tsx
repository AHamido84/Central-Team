import type { ReactNode } from 'react';

/**
 * The small Markdown subset report text uses — `#`/`##` headings, `-`/`*`/`1.` lists, `**bold**`, blank-line
 * paragraphs — rendered as React elements (never as HTML), so typed text can't inject markup.
 */
function inline(text: string, key: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part, i) =>
      part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <strong key={`${key}-${i}`}>{part.slice(2, -2)}</strong> : part,
    );
}

export function SimpleMarkdown({ text, className }: { text: string; className?: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push(<p key={`p${blocks.length}`}>{inline(para.join(' '), `p${blocks.length}`)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? 'ol' : 'ul';
    const k = `l${blocks.length}`;
    blocks.push(
      <Tag key={k} className={list.ordered ? 'list-decimal ps-5' : 'list-disc ps-5'}>
        {list.items.map((item, i) => (
          <li key={i}>{inline(item, `${k}-${i}`)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    const bullet = /^[-*•]\s+(.+)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.+)$/.exec(line);
    if (!line) {
      flushPara();
      flushList();
    } else if (heading) {
      flushPara();
      flushList();
      blocks.push(
        <p key={`h${blocks.length}`} className="font-semibold">
          {inline(heading[2]!, `h${blocks.length}`)}
        </p>,
      );
    } else if (bullet || numbered) {
      flushPara();
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]!);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return <div className={className ?? 'flex flex-col gap-2 text-sm leading-relaxed'}>{blocks}</div>;
}
