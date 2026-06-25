/**
 * Shared markdown rendering helper.
 *
 * Used by:
 *   - components/markdown/MarkdownViewer.tsx (read-only)
 *   - components/markdown/MarkdownEditor.tsx (live preview pane)
 *   - components/ideation/PRDViewer.tsx (legacy)
 *   - components/architecture/ADRViewer.tsx (legacy)
 *
 * No external dependency — react-markdown is intentionally NOT in package.json
 * (per project convention). This keeps the bundle small and avoids the
 * complexity of sanitizing user-supplied HTML in a Tauri-style app.
 *
 * Supported block syntax:
 *   # / ## / ### / ####     headings
 *   ```lang                 fenced code block (preserved verbatim, no hljs)
 *   - / *                   unordered list items
 *   1. / 2.                 ordered list items
 *   >                       blockquote
 *   ---                     horizontal rule
 *   blank line              paragraph break
 *
 * Supported inline syntax:
 *   `code`                  inline code
 *   **bold**                bold
 *   *italic*                italic
 *   [text](url)             link (rendered with target=_blank rel=noopener)
 */

import * as React from 'react';

const INLINE_CODE = /`([^`]+)`/;
const INLINE_BOLD = /\*\*([^*]+)\*\*/;
const INLINE_ITALIC = /\*([^*]+)\*/;
const INLINE_LINK = /\[([^\]]+)\]\(([^)]+)\)/;

function renderInline(text: string): React.ReactNode {
  // Walk left-to-right applying the first matching inline rule each step.
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;
  while (remaining.length > 0) {
    const candidates = [
      { re: INLINE_CODE, render: (m: RegExpExecArray) => m[1] },
      { re: INLINE_BOLD, render: (m: RegExpExecArray) => m[1] },
      { re: INLINE_ITALIC, render: (m: RegExpExecArray) => m[1] },
      {
        re: INLINE_LINK,
        render: (m: RegExpExecArray) => ({ text: m[1], href: m[2] }),
      },
    ].map((c) => ({ ...c, match: c.re.exec(remaining) }));

    const earliest = candidates
      .filter((c) => c.match)
      .sort((a, b) => (a.match!.index ?? 0) - (b.match!.index ?? 0))[0];

    if (!earliest) {
      parts.push(remaining);
      break;
    }
    const idx = earliest.match!.index;
    if (idx > 0) parts.push(remaining.slice(0, idx));
    const captured = earliest.render(earliest.match!);
    if (
      typeof captured === 'object' &&
      captured !== null &&
      'href' in captured
    ) {
      parts.push(
        <a
          key={key++}
          href={(captured as { href: string }).href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline-offset-4 hover:underline"
        >
          {(captured as { text: string }).text}
        </a>,
      );
    } else {
      // For code/bold/italic we wrap with semantic tags.
      if (earliest.re === INLINE_CODE) {
        parts.push(
          <code
            key={key++}
            className="rounded bg-muted px-1 py-0.5 font-mono text-xs"
          >
            {captured as string}
          </code>,
        );
      } else if (earliest.re === INLINE_BOLD) {
        parts.push(
          <strong key={key++} className="font-semibold">
            {captured as string}
          </strong>,
        );
      } else if (earliest.re === INLINE_ITALIC) {
        parts.push(
          <em key={key++} className="italic">
            {captured as string}
          </em>,
        );
      } else {
        parts.push(captured as React.ReactNode);
      }
    }
    remaining = remaining.slice(idx + earliest.match![0].length);
  }
  return parts;
}

export function renderMarkdown(md: string): React.ReactNode {
  const lines = md.split(/\r?\n/);
  const nodes: React.ReactNode[] = [];
  let key = 0;

  let inCode = false;
  let codeBuf: string[] = [];
  let codeLang = '';

  let listBuf: { type: 'ul' | 'ol'; items: string[] } | null = null;

  const flushList = () => {
    if (!listBuf) return;
    const Tag = listBuf.type;
    nodes.push(
      <Tag
        key={`list-${key++}`}
        className={
          Tag === 'ul'
            ? 'ml-5 list-disc text-sm'
            : 'ml-5 list-decimal text-sm'
        }
      >
        {listBuf.items.map((it, i) => (
          <li key={i}>{renderInline(it)}</li>
        ))}
      </Tag>,
    );
    listBuf = null;
  };

  for (const raw of lines) {
    const line = raw;

    if (line.startsWith('```')) {
      flushList();
      if (inCode) {
        nodes.push(
          <pre
            key={`code-${key++}`}
            className="overflow-x-auto rounded-md border border-border bg-muted p-3 text-xs"
          >
            <code data-lang={codeLang}>{codeBuf.join('\n')}</code>
          </pre>,
        );
        codeBuf = [];
        codeLang = '';
        inCode = false;
      } else {
        inCode = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }

    const ulMatch = line.match(/^[-*]\s+(.+)$/);
    const olMatch = line.match(/^\d+\.\s+(.+)$/);
    if (ulMatch || olMatch) {
      const type = ulMatch ? 'ul' : 'ol';
      const text = (ulMatch ?? olMatch)![1];
      if (listBuf && listBuf.type === type) {
        listBuf.items.push(text);
      } else {
        flushList();
        listBuf = { type, items: [text] };
      }
      continue;
    } else {
      flushList();
    }

    if (line.startsWith('#### ')) {
      nodes.push(
        <h4
          key={key++}
          className="mt-2 text-sm font-semibold text-foreground"
        >
          {line.slice(5)}
        </h4>,
      );
    } else if (line.startsWith('### ')) {
      nodes.push(
        <h3
          key={key++}
          className="mt-3 text-sm font-semibold text-foreground"
        >
          {line.slice(4)}
        </h3>,
      );
    } else if (line.startsWith('## ')) {
      nodes.push(
        <h2
          key={key++}
          className="mt-4 text-base font-semibold text-foreground"
        >
          {line.slice(3)}
        </h2>,
      );
    } else if (line.startsWith('# ')) {
      nodes.push(
        <h1
          key={key++}
          className="mt-2 text-xl font-semibold leading-tight text-foreground"
        >
          {line.slice(2)}
        </h1>,
      );
    } else if (line.startsWith('> ')) {
      nodes.push(
        <blockquote
          key={key++}
          className="border-l-2 border-border pl-3 text-sm italic text-muted-foreground"
        >
          {renderInline(line.slice(2))}
        </blockquote>,
      );
    } else if (line.trim() === '---') {
      nodes.push(<hr key={key++} className="my-3 border-border" />);
    } else if (line.trim() === '') {
      nodes.push(<div key={key++} className="h-2" aria-hidden="true" />);
    } else {
      nodes.push(
        <p key={key++} className="text-sm text-foreground">
          {renderInline(line)}
        </p>,
      );
    }
  }
  flushList();

  return nodes;
}
