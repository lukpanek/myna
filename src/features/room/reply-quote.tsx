import { type MatrixClient, MatrixEvent, type Room } from 'matrix-js-sdk';
import { useEffect, useState } from 'react';
import { MxAvatar } from '@/components/mx-avatar';
import { t } from '@/i18n';
import { useMatrixClient } from '@/matrix/context';
import { describeEvent } from '@/matrix/event-text';
import { memberName } from './timeline-utils';

const fetched = new Map<string, Promise<MatrixEvent>>();

/** Loads an event that is not in any local timeline (cached per session). */
function fetchEvent(client: MatrixClient, roomId: string, eventId: string): Promise<MatrixEvent> {
  const key = `${roomId}|${eventId}`;
  let promise = fetched.get(key);
  if (!promise) {
    promise = client.fetchRoomEvent(roomId, eventId).then(async (raw) => {
      const event = new MatrixEvent(raw);
      if (event.isEncrypted()) await client.decryptEventIfNeeded(event);
      return event;
    });
    promise.catch(() => fetched.delete(key));
    fetched.set(key, promise);
  }
  return promise;
}

export function ReplyQuote({ room, eventId, onJump }: { room: Room; eventId: string; onJump: (eventId: string) => void }) {
  const client = useMatrixClient();
  const local = room.findEventById(eventId);
  const [remote, setRemote] = useState<MatrixEvent | null | undefined>(undefined);

  useEffect(() => {
    if (local) return;
    let alive = true;
    fetchEvent(client, room.roomId, eventId)
      .then((e) => alive && setRemote(e))
      .catch(() => alive && setRemote(null));
    return () => {
      alive = false;
    };
  }, [client, room, eventId, local]);

  const target = local ?? remote;
  const sender = target?.getSender();
  const name = target ? (target.sender?.name ?? memberName(room, sender)) : '';
  const text = target === null ? t('room.originalUnavailable') : target ? describeEvent(target) : t('common.loading');

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onJump(eventId);
      }}
      className="mb-0.5 flex max-w-full items-center gap-1.5 border-l-2 border-muted-foreground/30 pl-2 text-left text-[13px] text-muted-foreground hover:border-primary hover:text-foreground"
    >
      {target && sender && (
        <MxAvatar
          mxc={room.getMember(sender)?.getMxcAvatarUrl()}
          name={name}
          seed={sender}
          size={16}
        />
      )}
      {target && <span className="shrink-0 font-semibold text-foreground/80">{name}</span>}
      <span className="truncate">{text}</span>
    </button>
  );
}
