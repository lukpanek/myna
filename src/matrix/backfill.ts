import {
  EventType,
  type IRoomTimelineData,
  KnownMembership,
  type MatrixClient,
  type MatrixEvent,
  ReceiptType,
  type Room,
  RoomEvent,
} from 'matrix-js-sdk';
import { useSettings } from '@/store/settings';
import { getBridgeInfo } from './bridge';

/** Clock skew between the bridge, the remote network and the homeserver. */
const CREATE_MARGIN_MS = 60 * 1000;
/** Backfilled history newer than this stays unread (like the bridge's `unread_hours_threshold`). */
const KEEP_UNREAD_MS = 24 * 60 * 60 * 1000;
/** Backfill arrives as a stream of single sends; wait until it settles. */
const SETTLE_MS = 2000;

/**
 * History a bridge copied into a portal: mautrix bridges send it with the original
 * timestamps, so it predates the room itself. Live messages never do.
 */
export function isBackfill(event: MatrixEvent, room: Room): boolean {
  const createTs = room.currentState.getStateEvents(EventType.RoomCreate, '')?.getTs();
  return !!createTs && event.getTs() < createTs - CREATE_MARGIN_MS;
}

/**
 * Marks old bridge history as read with a private receipt, so a freshly bridged
 * chat does not show dozens of unread messages. The remote network never sees
 * private receipts. Returns a cleanup function.
 */
export function attachBackfillReader(client: MatrixClient): () => void {
  const latest = new Map<string, MatrixEvent>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const flush = (roomId: string) => {
    timers.delete(roomId);
    const event = latest.get(roomId);
    latest.delete(roomId);
    const room = client.getRoom(roomId);
    const eventId = event?.getId();
    if (!event || !room || !eventId) return;
    if (room.hasUserReadEvent(client.getSafeUserId(), eventId)) return;
    client.sendReadReceipt(event, ReceiptType.ReadPrivate).catch((err) =>
      console.warn('Read receipt for bridge history failed', err),
    );
  };

  const onTimeline = (
    event: MatrixEvent,
    room: Room | undefined,
    toStartOfTimeline: boolean | undefined,
    removed: boolean,
    data: IRoomTimelineData,
  ) => {
    if (!room || toStartOfTimeline || removed || !data?.liveEvent) return;
    if (!useSettings.getState().markBridgeHistoryRead) return;
    if (event.isState() || !event.getId() || event.getTs() > Date.now() - KEEP_UNREAD_MS) return;
    if (room.getMyMembership() !== KnownMembership.Join || !getBridgeInfo(room)) return;
    if (!isBackfill(event, room)) return;
    latest.set(room.roomId, event);
    clearTimeout(timers.get(room.roomId));
    timers.set(
      room.roomId,
      setTimeout(() => flush(room.roomId), SETTLE_MS),
    );
  };

  client.on(RoomEvent.Timeline, onTimeline);
  return () => {
    client.off(RoomEvent.Timeline, onTimeline);
    for (const timer of timers.values()) clearTimeout(timer);
  };
}
