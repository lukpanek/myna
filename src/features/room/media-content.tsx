import type { MatrixEvent } from 'matrix-js-sdk';
import {
  Download,
  File as FileGeneric,
  FileArchive,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  ImageIcon,
  MapPin,
  Play,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { t } from '@/i18n';
import { openExternal } from '@/lib/native';
import { formatBytes, formatDuration } from '@/lib/time';
import { cn } from '@/lib/utils';
import { type EncryptedFile, useMediaSrc, useThumbnail } from '@/matrix/media';
import { useSettings } from '@/store/settings';
import { useRoomDialogs } from './room-dialogs';
import { useTimelineContext } from './timeline-context';
import { BLURHASH_KEY, blurhashUrl, downloadMedia, mediaBox } from './media-utils';

type Content = Record<string, unknown>;

interface MediaInfo {
  w?: number;
  h?: number;
  mimetype?: string;
  size?: number;
  duration?: number;
  thumbnail_url?: string;
  thumbnail_file?: EncryptedFile;
  thumbnail_info?: { w?: number; h?: number; mimetype?: string };
  [BLURHASH_KEY]?: string;
}

function infoOf(content: Content): MediaInfo {
  return (content.info ?? {}) as MediaInfo;
}

/** Thumbnail-ish source: server thumbnail for plain media, decrypted file (or its thumbnail) for E2EE. */
function usePreviewSrc(content: Content, size: number, preferFull = false): string | undefined {
  const info = infoOf(content);
  const file = content.file as EncryptedFile | undefined;
  const url = content.url as string | undefined;
  // GIFs lose animation as thumbnails, so they load in full.
  const full = preferFull || info.mimetype === 'image/gif';
  const thumb = useThumbnail(file || full ? null : (info.thumbnail_url ?? url), size, 'scale');
  const encFile = file ? (full ? file : (info.thumbnail_file ?? file)) : undefined;
  const encMime = encFile === info.thumbnail_file ? info.thumbnail_info?.mimetype : info.mimetype;
  const fullSrc = useMediaSrc(!file && full ? url : undefined, encFile, encMime);
  return thumb ?? fullSrc;
}

function HiddenPreview({ label, onShow }: { label: string; onShow: () => void }) {
  return (
    <button
      type="button"
      onClick={onShow}
      className="flex h-10 items-center gap-2 rounded-md border bg-muted/50 px-3 text-sm text-muted-foreground hover:bg-accent"
    >
      <ImageIcon className="size-4" />
      {t('room.showHidden', { label })}
    </button>
  );
}

function MediaFrame({
  width,
  height,
  blurhash,
  loaded,
  onClick,
  children,
  className,
}: {
  width: number;
  height: number;
  blurhash?: string | null;
  loaded: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn('relative max-w-full overflow-hidden rounded-lg bg-muted', onClick && 'cursor-pointer', className)}
      style={{ width, height }}
    >
      {blurhash && !loaded && <img src={blurhash} alt="" className="absolute inset-0 size-full" aria-hidden />}
      {children}
    </div>
  );
}

export function ImageContent({ event, content }: { event: MatrixEvent; content: Content }) {
  const showPreviews = useSettings((s) => s.showMediaPreviews);
  const [revealed, setRevealed] = useState(false);
  const ctx = useTimelineContext();
  const openLightbox = useRoomDialogs((s) => s.openLightbox);
  const info = infoOf(content);
  const box = mediaBox(info.w, info.h);
  const visible = showPreviews || revealed;
  const src = usePreviewSrc(visible ? content : {}, 360);
  const [loaded, setLoaded] = useState(false);
  if (!visible) return <HiddenPreview label={t('room.photo')} onShow={() => setRevealed(true)} />;
  return (
    <MediaFrame
      width={box.width}
      height={box.height}
      blurhash={blurhashUrl(info[BLURHASH_KEY])}
      loaded={loaded}
      onClick={() => openLightbox(ctx.getMediaEvents(), event)}
    >
      {src && (
        <img
          src={src}
          alt={(content.body as string) || t('room.image')}
          draggable={false}
          onLoad={() => setLoaded(true)}
          className={cn('relative size-full object-cover transition-opacity', loaded ? 'opacity-100' : 'opacity-0')}
        />
      )}
    </MediaFrame>
  );
}

export function VideoContent({ content }: { content: Content }) {
  const showPreviews = useSettings((s) => s.showMediaPreviews);
  const [revealed, setRevealed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const info = infoOf(content);
  const box = mediaBox(info.w ?? info.thumbnail_info?.w, info.h ?? info.thumbnail_info?.h);
  const file = content.file as EncryptedFile | undefined;
  const visible = showPreviews || revealed;
  const posterThumb = useThumbnail(visible && !file ? info.thumbnail_url : null, 360, 'scale');
  const posterEnc = useMediaSrc(undefined, visible && file ? info.thumbnail_file : undefined, info.thumbnail_info?.mimetype);
  const poster = posterThumb ?? posterEnc;
  const videoSrc = useMediaSrc(playing && !file ? (content.url as string) : undefined, playing ? file : undefined, info.mimetype);

  if (!visible) return <HiddenPreview label={t('room.video')} onShow={() => setRevealed(true)} />;
  if (playing) {
    return (
      <MediaFrame width={box.width} height={box.height} loaded>
        {videoSrc ? (
          <video src={videoSrc} poster={poster} controls autoPlay className="size-full bg-black object-contain" />
        ) : (
          <div className="flex size-full items-center justify-center">
            <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
          </div>
        )}
      </MediaFrame>
    );
  }
  return (
    <MediaFrame
      width={box.width}
      height={box.height}
      blurhash={blurhashUrl(info[BLURHASH_KEY])}
      loaded={loaded}
      onClick={() => setPlaying(true)}
    >
      {poster && (
        <img
          src={poster}
          alt=""
          draggable={false}
          onLoad={() => setLoaded(true)}
          className="relative size-full object-cover"
        />
      )}
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-black/55 text-white">
          <Play className="ml-0.5 size-5 fill-current" />
        </span>
      </span>
      {info.duration ? (
        <span className="absolute right-1.5 bottom-1.5 rounded bg-black/60 px-1 text-[11px] text-white tabular-nums">
          {formatDuration(info.duration)}
        </span>
      ) : null}
    </MediaFrame>
  );
}

function fileIcon(mimetype?: string, name?: string) {
  const m = mimetype ?? '';
  if (m.startsWith('image/')) return FileImage;
  if (m.startsWith('video/')) return FileVideo;
  if (m.startsWith('audio/')) return FileAudio;
  if (/zip|rar|7z|tar|gzip|compressed/.test(m) || /\.(zip|rar|7z|tar|gz)$/i.test(name ?? '')) return FileArchive;
  if (m.startsWith('text/') || /pdf|document|msword|sheet|presentation/.test(m)) return FileText;
  return FileGeneric;
}

export function FileContent({ content }: { content: Content }) {
  const info = infoOf(content);
  const name = (content.filename as string) || (content.body as string) || t('room.file');
  const Icon = fileIcon(info.mimetype, name);
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    await downloadMedia(content);
    setBusy(false);
  };
  return (
    <div className="flex w-[320px] max-w-full items-center gap-3 rounded-lg border bg-background px-3 py-2">
      <Icon className="size-8 shrink-0 text-muted-foreground" strokeWidth={1.5} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium" title={name}>
          {name}
        </div>
        <div className="text-xs text-muted-foreground">
          {[info.size ? formatBytes(info.size) : null, info.mimetype?.split('/')[1]?.toUpperCase()]
            .filter(Boolean)
            .join(' · ') || t('room.file')}
        </div>
      </div>
      <button
        type="button"
        onClick={() => void download()}
        disabled={busy}
        title={t('room.download')}
        aria-label={t('room.download')}
        className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
      >
        <Download className="size-4" />
      </button>
    </div>
  );
}

export function StickerContent({ content }: { content: Content }) {
  const src = usePreviewSrc(content, 128);
  const info = infoOf(content);
  const box = mediaBox(info.w, info.h, 128);
  return (
    <div style={{ width: box.width, height: box.height }} className="max-w-full">
      {src && (
        <img
          src={src}
          alt={(content.body as string) || t('room.sticker')}
          title={(content.body as string) || undefined}
          draggable={false}
          className="size-full object-contain"
        />
      )}
    </div>
  );
}

export function LocationContent({ content }: { content: Content }) {
  const geo = typeof content.geo_uri === 'string' ? content.geo_uri : '';
  const match = geo.match(/^geo:(-?[\d.]+),(-?[\d.]+)/);
  const label = (content.body as string) || t('room.location');
  if (!match) return <span className="text-muted-foreground">{label}</span>;
  const [, lat, lon] = match;
  const href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        void openExternal(href);
      }}
      className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm text-primary hover:bg-accent"
    >
      <MapPin className="size-4" />
      {t('room.location')}
      <span className="text-xs text-muted-foreground tabular-nums">
        {Number(lat).toFixed(4)}, {Number(lon).toFixed(4)}
      </span>
    </a>
  );
}

interface PollAnswer {
  id?: string;
  'm.text'?: { body?: string }[];
  'org.matrix.msc1767.text'?: string;
  body?: string;
}

function extensibleText(v: PollAnswer | undefined): string {
  if (!v) return '';
  return v['m.text']?.[0]?.body ?? v['org.matrix.msc1767.text'] ?? v.body ?? '';
}

export function PollContent({ content }: { content: Content }) {
  const poll = (content['m.poll'] ?? content['org.matrix.msc3381.poll.start'] ?? {}) as {
    question?: PollAnswer;
    answers?: PollAnswer[];
  };
  const question = extensibleText(poll.question) || t('room.poll');
  const answers = Array.isArray(poll.answers) ? poll.answers : [];
  return (
    <div className="w-[320px] max-w-full rounded-lg border px-3 py-2">
      <div className="mb-1.5 text-xs font-medium text-muted-foreground">{t('room.poll')}</div>
      <div className="mb-2 font-semibold">{question}</div>
      <ul className="space-y-1">
        {answers.map((a, i) => (
          <li key={a.id ?? i} className="flex items-center gap-2 text-sm">
            <span className="size-3.5 shrink-0 rounded-full border-2 border-muted-foreground/50" />
            {extensibleText(a)}
          </li>
        ))}
      </ul>
    </div>
  );
}
