import { find as findLinks } from 'linkifyjs';
import { ExternalLink, Play, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { t } from '@/i18n';
import { openExternal } from '@/lib/native';
import { useMatrixClient } from '@/matrix/context';
import { type EncryptedFile, useMediaSrc, useThumbnail } from '@/matrix/media';
import { cn } from '@/lib/utils';
import { useSettings } from '@/store/settings';
import { parseMatrixLink } from './html-body';

/**
 * Link previews under text messages. Embeddable players (YouTube, Spotify, Vimeo,
 * Apple Music) get an inline iframe; other links a card from the bridge's
 * `com.beeper.linkpreviews` or the homeserver's URL preview API.
 */

type Content = Record<string, unknown>;

const MAX_PREVIEWS = 2;
const BEEPER_KEY = 'com.beeper.linkpreviews';

interface Preview {
  url: string;
  title?: string;
  description?: string;
  siteName?: string;
  imageMxc?: string;
  imageFile?: EncryptedFile;
}

export interface Embed {
  kind: 'youtube' | 'spotify' | 'vimeo' | 'apple-music';
  src: string;
  /** Poster for click-to-play players; players without one load straight away. */
  thumbnail?: string;
  height: number;
  /** 16:9 video instead of a fixed-height player. */
  video: boolean;
}

const YOUTUBE_ID = /^[\w-]{11}$/;

/** Iframe player for a link; must stay in sync with EMBED_HOSTS in src-tauri/src/window.rs. */
export function embedFor(href: string): Embed | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  const path = url.pathname.split('/').filter(Boolean);

  if (host === 'youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com') {
    let id: string | null = null;
    if (host === 'youtu.be') id = path[0] ?? null;
    else if (path[0] === 'watch') id = url.searchParams.get('v');
    else if (path[0] === 'shorts' || path[0] === 'live' || path[0] === 'embed') id = path[1] ?? null;
    if (!id || !YOUTUBE_ID.test(id)) return null;
    const start = parseStart(url.searchParams.get('t') ?? url.searchParams.get('start'));
    const params = new URLSearchParams({ autoplay: '1', rel: '0' });
    if (start) params.set('start', String(start));
    return {
      kind: 'youtube',
      src: `https://www.youtube-nocookie.com/embed/${id}?${params}`,
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      height: 0,
      video: true,
    };
  }

  if (host === 'open.spotify.com') {
    // Localized links look like /intl-cs/track/<id>.
    const parts = path[0]?.startsWith('intl-') ? path.slice(1) : path;
    const [type, id] = parts;
    if (!id || !['track', 'album', 'playlist', 'episode', 'show', 'artist'].includes(type)) return null;
    const compact = type === 'track' || type === 'episode';
    return {
      kind: 'spotify',
      src: `https://open.spotify.com/embed/${type}/${encodeURIComponent(id)}`,
      height: compact ? 152 : 352,
      video: false,
    };
  }

  if (host === 'vimeo.com' && /^\d+$/.test(path[0] ?? '')) {
    return { kind: 'vimeo', src: `https://player.vimeo.com/video/${path[0]}?autoplay=1`, height: 0, video: true };
  }

  if (url.hostname === 'music.apple.com' && path.length >= 3) {
    const song = url.searchParams.get('i');
    const embedUrl = new URL(`https://embed.music.apple.com${url.pathname}`);
    if (song) embedUrl.searchParams.set('i', song);
    return { kind: 'apple-music', src: embedUrl.toString(), height: song ? 175 : 450, video: false };
  }

  return null;
}

/** YouTube `t=1h2m3s` / `t=90` → seconds. */
function parseStart(value: string | null): number {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const m = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/** Web links in a message, in order, without duplicates and Matrix permalinks. */
export function messageLinks(content: Content): string[] {
  const urls: string[] = [];
  const html = typeof content.formatted_body === 'string' ? content.formatted_body : '';
  for (const m of html.matchAll(/<a\s[^>]*href="([^"]+)"/gi)) urls.push(m[1].replace(/&amp;/g, '&'));
  if (typeof content.body === 'string') {
    // Skip the quoted reply fallback; its links belong to the other message.
    const body = content.body.split('\n').filter((line) => !line.startsWith('> ')).join('\n');
    for (const link of findLinks(body, 'url')) urls.push(link.href);
  }
  const seen = new Set<string>();
  return urls.filter((url) => {
    if (!/^https?:\/\//i.test(url) || parseMatrixLink(url) || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

/** Previews mautrix bridges attach to messages (fetched by the bridge, image stored in Matrix). */
function bridgePreviews(content: Content): Map<string, Preview> {
  const map = new Map<string, Preview>();
  const list = content[BEEPER_KEY];
  if (!Array.isArray(list)) return map;
  for (const raw of list as Record<string, unknown>[]) {
    const url = (raw.matched_url ?? raw['og:url']) as string | undefined;
    if (typeof url !== 'string') continue;
    map.set(url, {
      url,
      title: str(raw['og:title']),
      description: str(raw['og:description']),
      siteName: str(raw['og:site_name']),
      imageMxc: str(raw['og:image']),
      imageFile: raw['beeper:image:encryption'] as EncryptedFile | undefined,
    });
  }
  return map;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function LinkPreviews({ content, ts }: { content: Content; ts: number }) {
  const enabled = useSettings((s) => s.showLinkPreviews);
  const [dismissed, setDismissed] = useState<string[]>([]);
  if (!enabled) return null;
  const fromBridge = bridgePreviews(content);
  const links = messageLinks(content)
    .filter((url) => !dismissed.includes(url))
    .slice(0, MAX_PREVIEWS);
  if (links.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-2">
      {links.map((url) => {
        const embed = embedFor(url);
        if (embed) return <EmbedPlayer key={url} url={url} embed={embed} />;
        return (
          <PreviewCard
            key={url}
            url={url}
            ts={ts}
            known={fromBridge.get(url)}
            onDismiss={() => setDismissed((d) => [...d, url])}
          />
        );
      })}
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Server-side preview, cached per URL for the session. */
const previewCache = new Map<string, Promise<Preview | null>>();

function useServerPreview(url: string, ts: number, skip: boolean): Preview | null | undefined {
  const client = useMatrixClient();
  const [state, setState] = useState<{ url: string; preview: Preview | null } | null>(null);
  useEffect(() => {
    if (skip) return;
    let alive = true;
    let p = previewCache.get(url);
    if (!p) {
      p = client
        .getUrlPreview(url, ts)
        .then((res) => {
          const title = str(res['og:title']);
          const description = str(res['og:description']);
          const imageMxc = str(res['og:image']);
          if (!title && !description && !imageMxc) return null;
          return { url, title, description, imageMxc, siteName: str(res['og:site_name']) };
        })
        .catch(() => null);
      previewCache.set(url, p);
    }
    void p.then((preview) => alive && setState({ url, preview }));
    return () => {
      alive = false;
    };
  }, [client, url, ts, skip]);
  return state?.url === url ? state.preview : undefined;
}

function PreviewCard({
  url,
  ts,
  known,
  onDismiss,
}: {
  url: string;
  ts: number;
  known: Preview | undefined;
  onDismiss: () => void;
}) {
  const fetched = useServerPreview(url, ts, !!known);
  const preview = known ?? fetched;
  if (!preview) return null;
  const site = preview.siteName ?? hostOf(url);
  return (
    <div className="group/preview relative flex max-w-[520px] overflow-hidden rounded-lg border-l-[3px] border-l-border bg-muted/40 pr-2">
      <a
        href={url}
        title={url}
        className="flex min-w-0 flex-1 gap-3 py-2 pl-3 no-underline"
        onClick={(e) => {
          e.preventDefault();
          void openExternal(url);
        }}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[12px] text-muted-foreground">{site}</span>
          {preview.title && (
            <span className="line-clamp-2 text-[14px] leading-snug font-semibold text-primary hover:underline">
              {preview.title}
            </span>
          )}
          {preview.description && (
            <span className="line-clamp-3 text-[13px] leading-snug text-foreground/80">{preview.description}</span>
          )}
        </span>
        {preview.imageMxc && <PreviewImage mxc={preview.imageMxc} file={preview.imageFile} />}
      </a>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t('room.hidePreview')}
        title={t('room.hidePreview')}
        className="absolute top-1 right-1 hidden size-5 items-center justify-center rounded text-muted-foreground group-hover/preview:flex hover:bg-accent hover:text-foreground"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

function PreviewImage({ mxc, file }: { mxc: string; file?: EncryptedFile }) {
  const thumb = useThumbnail(file ? null : mxc, 160);
  const full = useMediaSrc(file ? mxc : undefined, file);
  const src = file ? full : thumb;
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      loading="lazy"
      onError={() => setFailed(true)}
      className="mt-1 size-20 shrink-0 rounded-md bg-muted object-cover"
    />
  );
}

const EMBED_LABEL: Record<Embed['kind'], string> = {
  youtube: 'YouTube',
  spotify: 'Spotify',
  vimeo: 'Vimeo',
  'apple-music': 'Apple Music',
};

function EmbedPlayer({ url, embed }: { url: string; embed: Embed }) {
  // Video players load only on click: an iframe per message would make the timeline heavy.
  const [active, setActive] = useState(!embed.video);
  const label = EMBED_LABEL[embed.kind];

  return (
    <div className="flex max-w-[480px] flex-col gap-1">
      <div
        // Audio players draw their own 12px card; a muted box behind it would show in the corners.
        className={cn('relative overflow-hidden', embed.video ? 'rounded-lg bg-muted' : 'rounded-[12px]')}
        style={embed.video ? { aspectRatio: '16 / 9' } : { height: embed.height }}
      >
        {active ? (
          <iframe
            src={embed.src}
            title={label}
            loading="lazy"
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            // No allow-top-navigation: the player must never navigate the app window.
            sandbox="allow-scripts allow-same-origin allow-presentation allow-forms"
            className="absolute inset-0 size-full border-0 bg-transparent"
            // Same scheme as the embedded page (none = light): with a different one, WebKit paints
            // an opaque canvas behind the player, visible as white corners in dark mode.
            style={{ colorScheme: 'normal' }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setActive(true)}
            aria-label={t('room.playEmbed', { service: label })}
            className="group/play absolute inset-0 flex items-center justify-center"
          >
            {embed.thumbnail && (
              <img src={embed.thumbnail} alt="" draggable={false} loading="lazy" className="absolute inset-0 size-full object-cover" />
            )}
            <span className="relative flex size-14 items-center justify-center rounded-full bg-black/65 text-white transition-transform group-hover/play:scale-110">
              <Play className="ml-0.5 size-6 fill-current" />
            </span>
          </button>
        )}
      </div>
      <a
        href={url}
        onClick={(e) => {
          e.preventDefault();
          void openExternal(url);
        }}
        className="inline-flex w-fit items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground hover:underline"
      >
        <ExternalLink className="size-3" />
        {t('room.openIn', { service: label })}
      </a>
    </div>
  );
}
