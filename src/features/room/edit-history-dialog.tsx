import { Direction, EventType, type MatrixEvent, RelationType } from 'matrix-js-sdk';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { t } from '@/i18n';
import { formatFullTime } from '@/lib/time';
import { useMatrixClient } from '@/matrix/context';
import { TextBody } from './message-content';

type Content = Record<string, unknown>;

interface Version {
  id: string;
  ts: number;
  content: Content;
}

/** Edits are paged from the server; a message edited more often than this shows the newest ones. */
const MAX_PAGES = 10;

/** Every version of an edited message, newest first; the original last. */
export function EditHistoryDialog({ event, onClose }: { event: MatrixEvent | null; onClose: () => void }) {
  return (
    <Dialog open={!!event} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] grid-rows-[auto_1fr] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('room.editHistory')}</DialogTitle>
          <DialogDescription>{t('room.editHistoryDescription')}</DialogDescription>
        </DialogHeader>
        {event && <Versions key={event.getId()} event={event} />}
      </DialogContent>
    </Dialog>
  );
}

function Versions({ event }: { event: MatrixEvent }) {
  const client = useMatrixClient();
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    const roomId = event.getRoomId();
    const eventId = event.getId();
    if (!roomId || !eventId) return;
    void (async () => {
      const edits: MatrixEvent[] = [];
      let from: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await client.relations(roomId, eventId, RelationType.Replace, EventType.RoomMessage, {
          dir: Direction.Backward,
          limit: 50,
          from,
        });
        edits.push(...res.events);
        if (!res.nextBatch) break;
        from = res.nextBatch;
      }
      // Servers without the relations API (or a fresh local edit) still have the latest replacement.
      const latest = event.replacingEvent();
      if (latest && !edits.some((e) => e.getId() === latest.getId())) edits.push(latest);
      const list: Version[] = edits
        .filter((e) => !e.isRedacted() && e.getContent()['m.new_content'])
        .map((e) => ({ id: e.getId()!, ts: e.getTs(), content: e.getContent()['m.new_content'] as Content }));
      // The server pages by topological order; edits are shown by time.
      list.sort((a, b) => b.ts - a.ts);
      list.push({ id: eventId, ts: event.getTs(), content: event.getOriginalContent() });
      if (alive) setVersions(list);
    })().catch((err) => {
      console.warn('Edit history failed', err);
      if (alive) setError(true);
    });
    return () => {
      alive = false;
    };
  }, [client, event]);

  if (error) return <p className="text-sm text-destructive">{t('room.editHistoryFailed')}</p>;
  if (!versions) {
    return (
      <div className="flex justify-center py-6 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <ol className="-mx-1 min-h-0 space-y-1 overflow-auto px-1">
      {versions.map((v, i) => (
        <li key={v.id} className="rounded-md border px-3 py-2">
          <div className="mb-1 flex items-baseline gap-2 text-xs text-muted-foreground">
            <time className="tabular-nums">{formatFullTime(v.ts)}</time>
            {i === 0 && <span className="font-medium text-primary">{t('room.editHistoryCurrent')}</span>}
            {i === versions.length - 1 && <span className="font-medium">{t('room.editHistoryOriginal')}</span>}
          </div>
          <div className="selectable text-[0.95em]">
            <TextBody content={v.content} isReply={!!event.replyEventId} />
          </div>
        </li>
      ))}
    </ol>
  );
}
