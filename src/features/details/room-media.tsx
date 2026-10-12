import { Download, FileText, Music, Play } from 'lucide-react';
import { Direction, EventType, Filter, type MatrixEvent, MsgType } from 'matrix-js-sdk';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { t } from '@/i18n';
import { dayjs, formatBytes } from '@/lib/time';
import { useMatrixClient } from '@/matrix/context';
import { isVoiceMessage } from '@/matrix/event-text';
import { type EncryptedFile, loadMediaBlobUrl, useMediaSrc, useThumbnail } from '@/matrix/media';

type Kind = 'media' | 'files';

// A type alias (not an interface) so it satisfies the SDK's indexable IContent constraint.
type MediaContent = {
  msgtype?: string;
  body?: string;
  filename?: string;
  url?: string;
  file?: EncryptedFile;
  info?: {
    mimetype?: string;
    size?: number;
    thumbnail_url?: string;
    thumbnail_file?: EncryptedFile;
    thumbnail_info?: { mimetype?: string };
  };
};

const PAGE_SIZE = 50;
/** Stop paging once a request turned up this many new items (or after MAX_PAGES requests). */
const WANTED_PER_LOAD = 15;
const MAX_PAGES = 6;

function contentOf(event: MatrixEvent): MediaContent {
  return event.getContent<MediaContent>();
}

function matches(event: MatrixEvent, kind: Kind): boolean {
  if (event.getType() !== EventType.RoomMessage || event.isRedacted()) return false;
  const c = event.getContent();
  if (c['m.relates_to']?.rel_type === 'm.replace') return false;
  if (!c.url && !c.file) return false;
  const visual = c.msgtype === MsgType.Image || c.msgtype === MsgType.Video;
  if (kind === 'media') return visual;
  return (c.msgtype === MsgType.File || c.msgtype === MsgType.Audio) && !isVoiceMessage(c);
}

/**
 * Pages backwards through the room history with /messages. Unencrypted rooms let
 * the server filter (`contains_url`); in encrypted rooms the server cannot see
 * the content, so events are decrypted and filtered here.
 */
function useRoomFiles(roomId: string, kind: Kind) {
  const client = useMatrixClient();
  const [items, setItems] = useState<MatrixEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const token = useRef<string | null>(null);
  const busy = useRef(false);
  const finished = useRef(false);
  const seen = useRef(new Set<string>());
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const loadMore = useCallback(async () => {
    if (busy.current || finished.current) return;
    busy.current = true;
    setLoading(true);
    const encrypted = !!client.getRoom(roomId)?.hasEncryptionStateEvent();
    const filter = new Filter(client.getUserId());
    filter.setDefinition({
      room: {
        timeline: encrypted
          ? { types: [EventType.RoomMessage, EventType.RoomMessageEncrypted] }
          : { types: [EventType.RoomMessage], contains_url: true },
      },
    });
    // preventReEmit: these history events must not reach app-wide listeners (notifications, room list).
    const mapper = client.getEventMapper({ preventReEmit: true, decrypt: false });
    const found: MatrixEvent[] = [];
    try {
      for (let page = 0; page < MAX_PAGES && found.length < WANTED_PER_LOAD; page++) {
        const res = await client.createMessagesRequest(roomId, token.current, PAGE_SIZE, Direction.Backward, filter);
        const events = res.chunk.map(mapper);
        if (encrypted) await Promise.all(events.map((e) => client.decryptEventIfNeeded(e).catch(() => undefined)));
        for (const e of events) {
          const id = e.getId();
          if (!id || seen.current.has(id) || !matches(e, kind)) continue;
          seen.current.add(id);
          found.push(e);
        }
        token.current = res.end ?? null;
        if (!res.end || res.chunk.length === 0) {
          finished.current = true;
          break;
        }
      }
    } catch (err) {
      finished.current = true;
      toast.error(t('details.historyLoadFailed', { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      busy.current = false;
      if (alive.current) {
        setItems((prev) => (found.length ? [...prev, ...found] : prev));
        setLoading(false);
        setDone(finished.current);
      }
    }
  }, [client, roomId, kind]);

  useEffect(() => {
    void loadMore();
  }, [loadMore]);

  return { items, loading, done, loadMore };
}

/** Invisible marker at the end of a list; loads more while it is in view. */
function LoadMoreSentinel({
  loading,
  done,
  count,
  onLoad,
}: {
  loading: boolean;
  done: boolean;
  count: number;
  onLoad: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      visible.current = entry.isIntersecting;
      if (entry.isIntersecting) onLoad();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [onLoad]);

  // After a page arrives the marker may still be visible; the observer would not fire again.
  useEffect(() => {
    if (visible.current && !loading && !done) onLoad();
  }, [count, loading, done, onLoad]);

  return <div ref={ref} className="h-px" />;
}

function senderName(event: MatrixEvent): string {
  return event.sender?.name || event.getSender() || '';
}

function fileName(c: MediaContent): string {
  return c.filename || c.body || t('details.file');
}

async function downloadFile(c: MediaContent) {
  const mxc = c.file?.url ?? c.url;
  if (!mxc) return;
  try {
    const url = await loadMediaBlobUrl(mxc, c.file, c.info?.mimetype);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName(c);
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (err) {
    toast.error(t('details.downloadFailed', { error: err instanceof Error ? err.message : String(err) }));
  }
}

export function MediaGrid({ roomId }: { roomId: string }) {
  const { items, loading, done, loadMore } = useRoomFiles(roomId, 'media');
  const [open, setOpen] = useState<MatrixEvent | null>(null);

  return (
    <div className="px-3 pb-4">
      {items.length > 0 && (
        <div className="grid grid-cols-3 gap-1">
          {items.map((e) => (
            <MediaThumb key={e.getId()} event={e} onOpen={() => setOpen(e)} />
          ))}
        </div>
      )}
      {loading && (
        <div className="mt-1 grid grid-cols-3 gap-1">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="aspect-square rounded" />
          ))}
        </div>
      )}
      {done && !loading && items.length === 0 && <Empty text={t('details.noMedia')} />}
      {!done && <LoadMoreSentinel loading={loading} done={done} count={items.length} onLoad={loadMore} />}
      {open && <MediaViewer event={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function MediaThumb({ event, onOpen }: { event: MatrixEvent; onOpen: () => void }) {
  const c = contentOf(event);
  const isVideo = c.msgtype === MsgType.Video;
  const encrypted = !!c.file;
  const plainThumb = c.info?.thumbnail_url ?? (isVideo ? undefined : c.url);
  const encThumb = c.info?.thumbnail_file ?? (isVideo ? undefined : c.file);
  const thumbSrc = useThumbnail(encrypted ? null : plainThumb, 120);
  const encSrc = useMediaSrc(
    encrypted ? encThumb?.url : undefined,
    encrypted ? encThumb : undefined,
    c.info?.thumbnail_info?.mimetype ?? c.info?.mimetype,
  );
  const src = encrypted ? encSrc : thumbSrc;

  return (
    <button
      type="button"
      onClick={onOpen}
      title={c.body}
      className="relative aspect-square overflow-hidden rounded bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {src && <img src={src} alt="" loading="lazy" draggable={false} className="size-full object-cover" />}
      {isVideo && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-7 items-center justify-center rounded-full bg-black/55 text-white">
            <Play className="size-3.5 fill-current" />
          </span>
        </span>
      )}
    </button>
  );
}

function MediaViewer({ event, onClose }: { event: MatrixEvent; onClose: () => void }) {
  const c = contentOf(event);
  const src = useMediaSrc(c.file ? undefined : c.url, c.file, c.info?.mimetype);
  const isVideo = c.msgtype === MsgType.Video;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[90vh] w-auto max-w-[min(92vw,1200px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(92vw,1200px)]"
      >
        <div className="flex min-h-[240px] min-w-[320px] items-center justify-center bg-black">
          {!src ? (
            <span className="text-[13px] text-white/60">{t('common.loading')}</span>
          ) : isVideo ? (
            <video src={src} controls autoPlay className="max-h-[calc(90vh-56px)] max-w-full" />
          ) : (
            <img src={src} alt={c.body ?? ''} className="max-h-[calc(90vh-56px)] max-w-full object-contain" />
          )}
        </div>
        <div className="flex items-center gap-3 border-t px-4 py-2.5 pr-12">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-sm font-medium">{fileName(c)}</DialogTitle>
            <div className="truncate text-[12px] text-muted-foreground">
              {senderName(event)} · {dayjs(event.getTs()).format(`${t('time.dateYearFormat')} ${t('time.timeFormat')}`)}
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => downloadFile(c)}>
            <Download />
            {t('details.download')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function FileList({ roomId }: { roomId: string }) {
  const { items, loading, done, loadMore } = useRoomFiles(roomId, 'files');

  return (
    <div className="pb-4">
      {items.map((e) => {
        const c = contentOf(e);
        const Icon = c.msgtype === MsgType.Audio ? Music : FileText;
        return (
          <button
            key={e.getId()}
            type="button"
            onClick={() => downloadFile(c)}
            className="group flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-accent/60"
            title={t('details.download')}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{fileName(c)}</span>
              <span className="block truncate text-[12px] text-muted-foreground">
                {[
                  c.info?.size ? formatBytes(c.info.size) : null,
                  senderName(e),
                  dayjs(e.getTs()).format(t('time.dateYearFormat')),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            <Download className="size-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
          </button>
        );
      })}
      {loading &&
        Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-2">
            <Skeleton className="size-9 rounded-md" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-2.5 w-1/2" />
            </div>
          </div>
        ))}
      {done && !loading && items.length === 0 && <Empty text={t('details.noFiles')} />}
      {!done && <LoadMoreSentinel loading={loading} done={done} count={items.length} onLoad={loadMore} />}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">{text}</p>;
}
