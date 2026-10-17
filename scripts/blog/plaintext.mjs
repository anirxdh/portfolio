// Markdown to plain, LLM-friendly text for llms-full.txt. Headings, paragraphs, lists, tables and
// quotes survive as light Markdown; code blocks and raw HTML are dropped, and a diagram image becomes
// one "Diagram: <caption>" line. Links keep their target, made absolute by `link(href)`, which can
// also return null to keep only the link text (for example a link to an unpublished article).

import { marked } from 'marked';

const decode = (s) =>
  String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

export function markdownToText(md, { link = (href) => href } = {}) {
  const inline = (tokens = []) =>
    tokens
      .map((t) => {
        switch (t.type) {
          case 'link': {
            const text = inline(t.tokens);
            const href = link(t.href);
            if (!href) return text;
            return text === href || text === t.href ? href : `[${text}](${href})`;
          }
          case 'image':
            return t.text ? `(Image: ${t.text})` : '';
          case 'codespan':
            return `\`${decode(t.text)}\``;
          case 'br':
            return '\n';
          case 'html':
            return '';
          default:
            return t.tokens ? inline(t.tokens) : decode(t.text ?? '');
        }
      })
      .join('');

  const block = (t) => {
    switch (t.type) {
      case 'heading':
        return `${'#'.repeat(t.depth)} ${inline(t.tokens)}`;
      case 'paragraph': {
        const images = (t.tokens || []).filter((x) => x.type === 'image');
        const onlyImages = images.length && t.tokens.every((x) => x.type === 'image' || (x.type === 'text' && !x.text.trim()));
        if (onlyImages) return images.map((x) => (x.text ? `Diagram: ${decode(x.text)}` : '')).filter(Boolean).join('\n');
        return inline(t.tokens);
      }
      case 'text':
        return t.tokens ? inline(t.tokens) : decode(t.text);
      case 'list':
        return t.items
          .map((item, i) => {
            const bullet = t.ordered ? `${(Number(t.start) || 1) + i}. ` : '- ';
            const body = blocks(item.tokens).replace(/\n/g, '\n  ');
            return `${bullet}${body}`;
          })
          .join('\n');
      case 'table': {
        const row = (cells) => `| ${cells.map((c) => inline(c.tokens).replace(/\|/g, '\\|')).join(' | ')} |`;
        return [row(t.header), `|${t.header.map(() => '---').join('|')}|`, ...t.rows.map(row)].join('\n');
      }
      case 'blockquote':
        return blocks(t.tokens)
          .split('\n')
          .map((l) => `> ${l}`)
          .join('\n');
      default:
        // code, html, hr, space, def: nothing an LLM needs from the prose.
        return '';
    }
  };

  const blocks = (tokens = []) => tokens.map(block).filter((s) => s && s.trim()).join('\n\n');

  return blocks(marked.lexer(String(md ?? '')))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// One line of inline Markdown (a resume bullet) as plain text with absolute links.
export const inlineToText = (md, opts) => markdownToText(md, opts).replace(/\s*\n\s*/g, ' ');
