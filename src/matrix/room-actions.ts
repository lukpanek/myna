import { type MatrixClient, type Room } from 'matrix-js-sdk';
import { isMessageEvent } from './event-text';

/** Sends a read receipt for the newest event and clears a manual "unread" mark. */
export async function markRoomRead(client: MatrixClient, room: Room): Promise<void> {
  const events = room.getLiveTimeline().getEvents();
  const last = [...events].reverse().find((e) => !e.isSending() && e.getId() && !e.getId()!.startsWith('~'));
  if (room.getAccountData('m.marked_unread')?.getContent().unread) {
    await client.setRoomAccountData(room.roomId, 'm.marked_unread' as never, { unread: false } as never);
  }
  if (last && !room.hasUserReadEvent(client.getSafeUserId(), last.getId()!)) {
    await client.sendReadReceipt(last);
  }
}

export async function markRoomUnread(client: MatrixClient, room: Room): Promise<void> {
  await client.setRoomAccountData(room.roomId, 'm.marked_unread' as never, { unread: true } as never);
}

export async function toggleRoomTag(client: MatrixClient, room: Room, tag: 'm.favourite' | 'm.lowpriority') {
  if (room.tags?.[tag]) {
    await client.deleteRoomTag(room.roomId, tag);
    return;
  }
  // A room is either favourite or low priority, never both.
  const other = tag === 'm.favourite' ? 'm.lowpriority' : 'm.favourite';
  if (room.tags?.[other]) await client.deleteRoomTag(room.roomId, other);
  await client.setRoomTag(room.roomId, tag, { order: 0.5 });
}

export async function leaveRoom(client: MatrixClient, roomId: string): Promise<void> {
  await client.leave(roomId);
}

export function roomPermalink(roomId: string, eventId?: string): string {
  return `https://matrix.to/#/${encodeURIComponent(roomId)}${eventId ? `/${encodeURIComponent(eventId)}` : ''}`;
}

/** Newest message event in the live timeline (for "jump to latest" and receipts). */
export function lastMessageEvent(room: Room) {
  const events = room.getLiveTimeline().getEvents();
  for (let i = events.length - 1; i >= 0; i--) if (isMessageEvent(events[i])) return events[i];
  return undefined;
}

