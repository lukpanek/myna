import DOMPurify from 'dompurify';
import { find as findLinks } from 'linkifyjs';
import { createElement, type MouseEvent, type ReactNode, useContext, useMemo, useState } from 'react';
import { t } from '@/i18n';
import { openExternal } from '@/lib/native';
import { cn } from '@/lib/utils';
import { useMatrixClient } from '@/matrix/context';
import { useThumbnail } from '@/matrix/media';
import { useUi } from '@/store/ui';
import { TimelineContext } from './timeline-context';
import './message-body.css';

// Matrix spec allowlist (client-server API, m.room.message formatted bodies).
const ALLOWED_TAGS = [
  'font', 'del', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'p', 'a', 'ul', 'ol', 'sup', 'sub', 'li',
  'b', 'i', 'u', 'strong', 'em', 's', 'strike', 'code', 'hr', 'br', 'div', 'table', 'thead', 'tbody', 'tr',
  'th', 'td', 'caption', 'pre', 'span', 'img', 'details', 'summary',
];
const ALLOWED_ATTR = [
  'href', 'src', 'alt', 'title', 'width', 'height', 'start', 'color', 'class',
  'data-mx-spoiler', 'data-mx-color', 'data-mx-bg-color', 'data-mx-emoticon',
];
const ALLOWED_URI = /^(?:https?|ftp|mailto|magnet|mxc|matrix):/i;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const VOID_TAGS = new Set(['br', 'hr']);
const NO_LINKIFY = new Set(['a', 'code', 'pre']);

type MatrixLink = { kind: 'user'; id: string } | { kind: 'room'; id: string; eventId?: string };

/** Parses matrix.to links and `matrix:` URIs into user / room (+event) references. */
export function parseMatrixLink(href: string): MatrixLink | null {
  let parts: string[] | null = null;
  const to = href.match(/^https?:\/\/matrix\.to\/#\/([^?]+)/i);
  if (to) {
    parts = to[1].split('/').filter(Boolean).map(safeDecode);
  } else {
    const uri = href.match(/^matrix:([^?#]+)/i);
    if (uri) {
      const seg = uri[1].split('/').map(safeDecode);
      const sigil: Record<string, string> = { u: '@', r: '#', roomid: '!' };
      if (sigil[seg[0]] && seg[1]) {
        parts = [sigil[seg[0]] + seg[1]];
        if (seg[2] === 'e' && seg[3]) parts.push(`$${seg[3]}`);
      }
    }
  }
  if (!parts?.length) return null;
  const [id, eventId] = parts;
  if (id.startsWith('@')) return { kind: 'user', id };
  if (id.startsWith('!') || id.startsWith('#')) return { kind: 'room', id, eventId: eventId?.startsWith('$') ? eventId : undefined };
  return null;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function openLink(e: MouseEvent, href: string) {
  e.preventDefault();
  e.stopPropagation();
  void openExternal(href);
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} onClick={(e) => openLink(e, href)} className="text-primary hover:underline" title={href}>
      {children}
    </a>
  );
}

function MentionPill({ userId, fallback }: { userId: string; fallback?: string }) {
  const client = useMatrixClient();
  const ctx = useContext(TimelineContext);
  const isMe = userId === client.getUserId();
  const name = ctx?.room.getMember(userId)?.name || client.getUser(userId)?.displayName || fallback || userId;
  return (
    <span
      title={userId}
      className={cn(
        'rounded px-0.5 font-medium',
        isMe ? 'bg-mention text-mention-foreground' : 'bg-primary/10 text-primary',
      )}
    >
      @{name.replace(/^@/, '')}
    </span>
  );
}

function RoomLink({ link, href, children }: { link: Extract<MatrixLink, { kind: 'room' }>; href: string; children: ReactNode }) {
  const client = useMatrixClient();
  const onClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const room = link.id.startsWith('!')
      ? client.getRoom(link.id)
      : client.getRooms().find((r) => r.getCanonicalAlias() === link.id || r.getAltAliases().includes(link.id));
    if (room && room.getMyMembership() === 'join') useUi.getState().openRoom(room.roomId, { eventId: link.eventId });
    else void openExternal(href);
  };
  return (
    <a href={href} onClick={onClick} className="rounded bg-primary/10 px-0.5 font-medium text-primary hover:underline">
      {children}
    </a>
  );
}

function Link({ href, children }: { href: string; children: ReactNode }) {
  const link = parseMatrixLink(href);
  if (link?.kind === 'user') return <MentionPill userId={link.id} fallback={textOf(children)} />;
  if (link?.kind === 'room') return <RoomLink link={link} href={href}>{children}</RoomLink>;
  return <ExternalLink href={href}>{children}</ExternalLink>;
}

function textOf(children: ReactNode): string | undefined {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.filter((c) => typeof c === 'string').join('') || undefined;
  return undefined;
}

/** Plain text with URLs turned into links and matrix.to user links into mention pills. */
export function Linkified({ text }: { text: string }): ReactNode {
  const links = useMemo(() => findLinks(text).filter((l) => l.isLink), [text]);
  if (!links.length) return text;
  const out: ReactNode[] = [];
  let pos = 0;
  links.forEach((l, i) => {
    if (l.start > pos) out.push(text.slice(pos, l.start));
    out.push(
      <Link key={i} href={l.href}>
        {l.value}
      </Link>,
    );
    pos = l.end;
  });
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}

function Spoiler({ reason, children }: { reason?: string; children: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      className="mx-spoiler"
      data-revealed={revealed || undefined}
      title={revealed ? undefined : reason ? t('room.spoiler', { reason }) : t('room.spoilerReveal')}
      onClick={(e) => {
        if (revealed) return;
        e.stopPropagation();
        setRevealed(true);
      }}
    >
      {children}
    </span>
  );
}

function InlineImage({ mxc, alt, title, width, height, emoticon }: {
  mxc: string;
  alt?: string;
  title?: string;
  width?: number;
  height?: number;
  emoticon: boolean;
}) {
  const size = emoticon ? 32 : Math.min(360, Math.max(width ?? 0, height ?? 0) || 240);
  const src = useThumbnail(mxc, size, 'scale');
  if (emoticon) {
    return src ? <img src={src} alt={alt} title={title ?? alt} className="mx-emoticon" /> : <span>{alt}</span>;
  }
  const style = {
    width: width ? Math.min(width, 360) : undefined,
    maxHeight: 360,
  };
  return src ? (
    <img src={src} alt={alt} title={title} style={style} className="inline-block max-w-full rounded" />
  ) : (
    <span className="text-muted-foreground">{alt ?? t('room.image')}</span>
  );
}

function numAttr(el: Element, name: string): number | undefined {
  const n = Number(el.getAttribute(name));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function colorStyle(el: Element): { color?: string; backgroundColor?: string } | undefined {
  const color = el.getAttribute('data-mx-color') ?? el.getAttribute('color');
  const bg = el.getAttribute('data-mx-bg-color');
  const style: { color?: string; backgroundColor?: string } = {};
  if (color && HEX_COLOR.test(color)) style.color = color;
  if (bg && HEX_COLOR.test(bg)) style.backgroundColor = bg;
  return style.color || style.backgroundColor ? style : undefined;
}

function convertChildren(node: Node, linkify: boolean): ReactNode[] {
  return Array.from(node.childNodes).map((child, i) => convert(child, i, linkify));
}

/**
 * Builds React elements from the sanitized DOM. Only known tags and attributes are
 * copied, so this is a second allowlist on top of DOMPurify.
 */
function convert(node: Node, key: number, linkify: boolean): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    return linkify ? <Linkified key={key} text={text} /> : text;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (!ALLOWED_TAGS.includes(tag)) return convertChildren(el, linkify);
  if (VOID_TAGS.has(tag)) return createElement(tag, { key });
  const childLinkify = linkify && !NO_LINKIFY.has(tag);
  const children = () => convertChildren(el, childLinkify);

  switch (tag) {
    case 'a': {
      const href = el.getAttribute('href');
      if (!href || !ALLOWED_URI.test(href)) return <span key={key}>{children()}</span>;
      return (
        <Link key={key} href={href}>
          {children()}
        </Link>
      );
    }
    case 'img': {
      const src = el.getAttribute('src');
      if (!src?.startsWith('mxc://')) return null;
      return (
        <InlineImage
          key={key}
          mxc={src}
          alt={el.getAttribute('alt') ?? undefined}
          title={el.getAttribute('title') ?? undefined}
          width={numAttr(el, 'width')}
          height={numAttr(el, 'height')}
          emoticon={el.hasAttribute('data-mx-emoticon')}
        />
      );
    }
    case 'span': {
      if (el.hasAttribute('data-mx-spoiler')) {
        return (
          <Spoiler key={key} reason={el.getAttribute('data-mx-spoiler') || undefined}>
            {children()}
          </Spoiler>
        );
      }
      return (
        <span key={key} style={colorStyle(el)}>
          {children()}
        </span>
      );
    }
    case 'font':
      return (
        <span key={key} style={colorStyle(el)}>
          {children()}
        </span>
      );
    case 'strike':
      return <s key={key}>{children()}</s>;
    case 'code': {
      const cls = el.getAttribute('class');
      return (
        <code key={key} className={cls && /^language-[\w-]+$/.test(cls) ? cls : undefined}>
          {children()}
        </code>
      );
    }
    case 'ol': {
      const start = Number(el.getAttribute('start'));
      return (
        <ol key={key} start={Number.isInteger(start) ? start : undefined}>
          {children()}
        </ol>
      );
    }
    default:
      return createElement(tag, { key }, children());
  }
}

function sanitize(html: string): DocumentFragment {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: ALLOWED_URI,
    // Reply fallbacks duplicate the quoted message; the reply header shows it instead.
    ADD_FORBID_CONTENTS: ['mx-reply'],
    RETURN_DOM_FRAGMENT: true,
  });
}

/** Sanitized `org.matrix.custom.html` body. */
export function HtmlBody({ html, className, suffix }: { html: string; className?: string; suffix?: ReactNode }) {
  const nodes = useMemo(() => convertChildren(sanitize(html), true), [html]);
  return (
    <div className={cn('mx-body', className)}>
      {nodes}
      {suffix}
    </div>
  );
}

/** Plain `body`: newlines preserved, links detected. */
export function PlainBody({ text, className, suffix }: { text: string; className?: string; suffix?: ReactNode }) {
  return (
    <div className={cn('mx-body whitespace-pre-wrap', className)}>
      <Linkified text={text} />
      {suffix}
    </div>
  );
}
