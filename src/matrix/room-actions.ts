import { EventType, KnownMembership, MatrixError, type MatrixClient, type Room } from 'matrix-js-sdk';
import { getBridgeInfo } from './bridge';
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

function joinedChildren(client: MatrixClient, spaceId: string): string[] {
  const space = client.getRoom(spaceId);
  if (!space) return [];
  return space.currentState
    .getStateEvents(EventType.SpaceChild)
    .filter((e) => Array.isArray(e.getContent().via) && e.getStateKey())
    .map((e) => e.getStateKey()!)
    .filter((id) => {
      const membership = client.getRoom(id)?.getMyMembership();
      return membership === KnownMembership.Join || membership === KnownMembership.Invite;
    });
}

/**
 * Rooms a space removal would leave: the space, its subspaces and their rooms.
 * Rooms that also sit in an unrelated joined space stay. Children come before
 * their space, so an interrupted removal can be retried from the rail.
 */
export function spaceRemovalPlan(client: MatrixClient, spaceId: string): string[] {
  const tree = new Set<string>();
  const visit = (id: string) => {
    if (tree.has(id)) return;
    tree.add(id);
    if (client.getRoom(id)?.isSpaceRoom()) for (const child of joinedChildren(client, id)) visit(child);
  };
  visit(spaceId);

  const elsewhere = new Set<string>();
  for (const room of client.getRooms()) {
    if (tree.has(room.roomId) || !room.isSpaceRoom() || room.getMyMembership() !== KnownMembership.Join) continue;
    for (const child of joinedChildren(client, room.roomId)) elsewhere.add(child);
  }
  return [...tree].filter((id) => id === spaceId || !elsewhere.has(id)).reverse();
}

/**
 * Rooms a network removal would leave: every bridged chat of the network and
 * its personal spaces (spaces last). The bridge bot chat stays for logging in.
 */
export function networkRemovalPlan(client: MatrixClient, networkId: string): string[] {
  const rooms = client.getRooms().filter((room) => {
    const membership = room.getMyMembership();
    if (membership !== KnownMembership.Join && membership !== KnownMembership.Invite) return false;
    return getBridgeInfo(room)?.networkId === networkId;
  });
  return [...rooms.filter((r) => !r.isSpaceRoom()), ...rooms.filter((r) => r.isSpaceRoom())].map((r) => r.roomId);
}

/** Leaves and forgets the rooms in order, waiting out rate limits. */
export async function leaveRooms(
  client: MatrixClient,
  roomIds: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  for (const [i, roomId] of roomIds.entries()) {
    onProgress?.(i, roomIds.length);
    await withRateLimit(() => client.leave(roomId));
    await withRateLimit(() => client.forget(roomId)).catch(() => undefined);
  }
  onProgress?.(roomIds.length, roomIds.length);
}

async function withRateLimit<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts || !(e instanceof MatrixError) || !e.isRateLimitError()) throw e;
      await new Promise((r) => setTimeout(r, e.getRetryAfterMs() ?? 1000 * i));
    }
  }
}

/** Marks rooms read; resolves to the number that failed. */
export async function markRoomsRead(client: MatrixClient, roomIds: string[]): Promise<number> {
  const results = await Promise.allSettled(
    roomIds.map((id) => {
      const room = client.getRoom(id);
      return room ? withRateLimit(() => markRoomRead(client, room)) : Promise.resolve();
    }),
  );
  return results.filter((r) => r.status === 'rejected').length;
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

