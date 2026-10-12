import { type MatrixEvent, type Room } from 'matrix-js-sdk';
import { Loader2, Pin, PinOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { t } from '@/i18n';
import { formatListTime } from '@/lib/time';
import { useMatrixClient } from '@/matrix/context';
import { describeEvent } from '@/matrix/event-text';
import { canPin, pinnedEventIds, togglePin } from '@/matrix/pins';
import { useUi } from '@/store/ui';
import { senderName } from './timeline-utils';

/** Header button with the room's pinned messages; hidden when nothing is pinned. */
export function PinnedMessages({ room }: { room: Room }) {
  const [open, setOpen] = useState(false);
  const ids = pinnedEventIds(room);
  if (ids.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" aria-label={t('room.pinnedMessages')} className="h-7 gap-1 px-2">
              <Pin />
              <span className="text-xs tabular-nums">{ids.length}</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t('room.pinnedMessages')}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-80 p-1">
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{t('room.pinnedMessages')}</div>
        <div className="max-h-96 overflow-y-auto">
          {/* Newest pin first. */}
          {[...ids].reverse().map((id) => (
            <PinnedItem key={id} room={room} eventId={id} onJump={() => setOpen(false)} />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function usePinnedEvent(room: Room, eventId: string): MatrixEvent | null | undefined {
  const client = useMatrixClient();
  const [event, setEvent] = useState<MatrixEvent | null | undefined>(() => room.findEventById(eventId));
  useEffect(() => {
    if (event) return;
    let cancelled = false;
    client
      .fetchRoomEvent(room.roomId, eventId)
      .then(async (raw) => {
        const ev = client.getEventMapper()(raw);
        await client.decryptEventIfNeeded(ev);
        if (!cancelled) setEvent(ev);
      })
      .catch(() => !cancelled && setEvent(null));
    return () => {
      cancelled = true;
    };
  }, [client, room, eventId, event]);
  return event;
}

function PinnedItem({ room, eventId, onJump }: { room: Room; eventId: string; onJump: () => void }) {
  const client = useMatrixClient();
  const event = usePinnedEvent(room, eventId);
  const jump = () => {
    onJump();
    useUi.getState().openRoom(room.roomId, { eventId });
  };
  const unpin = () =>
    void togglePin(client, room, eventId).catch(() => toast.error(t('room.unpinFailed')));

  return (
    <div className="group flex items-start gap-1 rounded-md hover:bg-accent">
      <button type="button" onClick={jump} className="min-w-0 flex-1 px-2 py-1.5 text-left">
        {event === undefined ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : event === null ? (
          <span className="text-sm text-muted-foreground">{t('room.pinnedUnavailable')}</span>
        ) : (
          <>
            <div className="flex items-baseline gap-2 text-xs">
              <span className="truncate font-semibold">{senderName(room, event)}</span>
              <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">{formatListTime(event.getTs())}</span>
            </div>
            <div className="line-clamp-2 text-sm text-foreground/80">{describeEvent(event)}</div>
          </>
        )}
      </button>
      {canPin(client, room) && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('room.unpin')}
          title={t('room.unpin')}
          onClick={unpin}
          className="mt-1 mr-1 size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        >
          <PinOff />
        </Button>
      )}
    </div>
  );
}
