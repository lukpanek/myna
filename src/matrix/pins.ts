import { EventType, type MatrixClient, type Room } from 'matrix-js-sdk';

export function pinnedEventIds(room: Room): string[] {
  const pinned = room.currentState.getStateEvents(EventType.RoomPinnedEvents, '')?.getContent().pinned;
  return Array.isArray(pinned) ? pinned.filter((id): id is string => typeof id === 'string') : [];
}

export function canPin(client: MatrixClient, room: Room): boolean {
  return room.currentState.maySendStateEvent(EventType.RoomPinnedEvents, client.getSafeUserId());
}

/** Pins (newest last, as other clients do) or unpins an event. */
export async function togglePin(client: MatrixClient, room: Room, eventId: string): Promise<void> {
  const current = pinnedEventIds(room);
  const pinned = current.includes(eventId) ? current.filter((id) => id !== eventId) : [...current, eventId];
  await client.sendStateEvent(room.roomId, EventType.RoomPinnedEvents, { pinned }, '');
}
