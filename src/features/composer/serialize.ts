import type { JSONContent } from '@tiptap/react';
import type { Mark, Node as PMNode } from '@tiptap/pm/model';
import { stripReplyFallback } from '@/matrix/event-text';

/** Editor document converted to a Matrix message. */
export interface SerializedMessage {
  body: string;
  /** `null` when the message is plain text and needs no `formatted_body`. */
  html: string | null;
  userIds: string[];
  room: boolean;
}

export const ROOM_MENTION_ID = '@room';

export function userPermalink(userId: string): string {
  return `https://matrix.to/#/${userId}`;
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function openTag(mark: Mark): string {
  switch (mark.type.name) {
    case 'bold':
      return '<strong>';
    case 'italic':
      return '<em>';
    case 'strike':
      return '<del>';
    case 'code':
      return '<code>';
    case 'link':
      return `<a href="${esc(String(mark.attrs.href ?? ''))}">`;
    default:
      return '';
  }
}

function closeTag(mark: Mark): string {
  switch (mark.type.name) {
    case 'bold':
      return '</strong>';
    case 'italic':
      return '</em>';
    case 'strike':
      return '</del>';
    case 'code':
      return '</code>';
    case 'link':
      return '</a>';
    default:
      return '';
  }
}

interface Ctx {
  formatted: boolean;
  userIds: Set<string>;
  room: boolean;
}

/** Inline content with a mark stack, so adjacent text nodes share one `<strong>`/`<a>`. */
function inline(node: PMNode, ctx: Ctx): { html: string; text: string } {
  let html = '';
  let text = '';
  let open: readonly Mark[] = [];
  node.forEach((child) => {
    const marks = child.marks;
    if (marks.length) ctx.formatted = true;
    let keep = 0;
    while (keep < open.length && keep < marks.length && open[keep].eq(marks[keep])) keep++;
    for (let i = open.length - 1; i >= keep; i--) html += closeTag(open[i]);
    for (let i = keep; i < marks.length; i++) html += openTag(marks[i]);
    open = marks;

    if (child.isText) {
      const t = child.text ?? '';
      html += esc(t);
      const code = marks.some((m) => m.type.name === 'code');
      const link = marks.find((m) => m.type.name === 'link');
      let plain = code ? `\`${t}\`` : t;
      if (link && link.attrs.href && link.attrs.href !== t && `mailto:${t}` !== link.attrs.href) {
        plain = `${plain} (${link.attrs.href})`;
      }
      text += plain;
    } else if (child.type.name === 'hardBreak') {
      html += '<br>';
      text += '\n';
    } else if (child.type.name === 'mention') {
      const id = String(child.attrs.id ?? '');
      const label = String(child.attrs.label ?? id);
      if (id === ROOM_MENTION_ID) {
        ctx.room = true;
        html += '@room';
        text += '@room';
      } else {
        ctx.formatted = true;
        ctx.userIds.add(id);
        html += `<a href="${esc(userPermalink(id))}">${esc(label)}</a>`;
        text += label;
      }
    } else {
      html += esc(child.textContent);
      text += child.textContent;
    }
  });
  for (let i = open.length - 1; i >= 0; i--) html += closeTag(open[i]);
  return { html, text };
}

function isEmptyParagraph(node: PMNode): boolean {
  return node.type.name === 'paragraph' && node.childCount === 0;
}

function blocks(nodes: PMNode[], ctx: Ctx): { html: string; lines: string[] } {
  let html = '';
  const lines: string[] = [];
  let prevParagraph = false;
  for (const child of nodes) {
    const name = child.type.name;
    if (name === 'paragraph') {
      const r = inline(child, ctx);
      // Paragraphs become <br>-separated lines: renders the same in every client and bridge.
      if (prevParagraph) html += '<br>';
      html += r.html;
      lines.push(...r.text.split('\n'));
      prevParagraph = true;
      continue;
    }
    prevParagraph = false;
    ctx.formatted = true;
    if (name === 'blockquote') {
      const r = blocks(childrenOf(child), ctx);
      html += `<blockquote>${r.html}</blockquote>`;
      lines.push(...r.lines.map((l) => (l ? `> ${l}` : '>')));
    } else if (name === 'bulletList' || name === 'orderedList') {
      const ordered = name === 'orderedList';
      const start = ordered ? Number(child.attrs.start ?? 1) : 1;
      let items = '';
      let n = start;
      child.forEach((item) => {
        const r = blocks(childrenOf(item), ctx);
        items += `<li>${r.html}</li>`;
        const prefix = ordered ? `${n}. ` : '- ';
        const indent = ' '.repeat(prefix.length);
        r.lines.forEach((l, i) => lines.push(i === 0 ? prefix + l : indent + l));
        n++;
      });
      html += ordered
        ? `<ol${start !== 1 ? ` start="${start}"` : ''}>${items}</ol>`
        : `<ul>${items}</ul>`;
    } else if (name === 'codeBlock') {
      const lang = child.attrs.language ? String(child.attrs.language) : '';
      const code = child.textContent;
      html += `<pre><code${lang ? ` class="language-${esc(lang)}"` : ''}>${esc(code)}</code></pre>`;
      lines.push('```' + lang, ...code.split('\n'), '```');
    } else {
      const r = inline(child, ctx);
      html += r.html;
      lines.push(...r.text.split('\n'));
    }
  }
  return { html, lines };
}

function childrenOf(node: PMNode): PMNode[] {
  const out: PMNode[] = [];
  node.forEach((c) => out.push(c));
  return out;
}

/** Converts the editor document to `body` + (when needed) `formatted_body` and mentions. */
export function serializeDoc(doc: PMNode): SerializedMessage {
  const nodes = childrenOf(doc);
  while (nodes.length && isEmptyParagraph(nodes[0])) nodes.shift();
  while (nodes.length && isEmptyParagraph(nodes[nodes.length - 1])) nodes.pop();
  const ctx: Ctx = { formatted: false, userIds: new Set(), room: false };
  const { html, lines } = blocks(nodes, ctx);
  const body = lines.join('\n').replace(/\s+$/, '');
  return { body, html: ctx.formatted ? html : null, userIds: [...ctx.userIds], room: ctx.room };
}

/** `formatted_body` of an existing message → HTML the editor can parse (edit prefill). */
export function matrixHtmlToEditor(html: string): string {
  return html.replace(/<mx-reply>[\s\S]*?<\/mx-reply>/gi, '');
}

/** Plain text → editor JSON, one paragraph per line. */
export function plainToDoc(text: string): JSONContent {
  return {
    type: 'doc',
    content: stripReplyFallback(text)
      .split('\n')
      .map((line) => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' })),
  };
}
