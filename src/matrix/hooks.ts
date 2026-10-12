import { ClientEvent, type Room } from 'matrix-js-sdk';
import { useState } from 'react';
import { useEmitterEvent, useMatrixClient } from './context';
import { type RoomSummary, useRooms } from './rooms-store';

/** SDK Room object; re-renders when the room first appears (e.g. right after joining). */
export function useRoom(roomId: string | null | undefined): Room | null {
  const client = useMatrixClient();
  const [, bump] = useState(0);
  useEmitterEvent(client, ClientEvent.Room, (room: Room) => {
    if (room.roomId === roomId) bump((n) => n + 1);
  });
  return roomId ? client.getRoom(roomId) : null;
}

/** Derived list data (name, avatar, network, unread, notify level) for one room. */
export function useRoomSummary(roomId: string | null | undefined): RoomSummary | undefined {
  return useRooms((s) => (roomId ? s.rooms[roomId] : undefined));
}

/** Re-renders whenever `event` fires on `emitter`. Handy for SDK model objects. */
export function useRerenderOn(emitter: unknown, ...events: string[]): void {
  const [, bump] = useState(0);
  for (const event of events) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEmitterEvent(emitter, event, () => bump((n) => n + 1));
  }
}
