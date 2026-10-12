import {
  ClientEvent,
  EventType,
  KnownMembership,
  type MatrixClient,
  Preset,
  type Room,
} from 'matrix-js-sdk';
import { useRooms } from '@/matrix/rooms-store';
import { useUi, type View } from '@/store/ui';

/** Existing DM room with `userId` that we are still in (joined preferred over invited). */
export function findDirectRoom(client: MatrixClient, userId: string): string | null {
  const direct = client.getAccountData(EventType.Direct)?.getContent<Record<string, string[]>>() ?? {};
  const candidates = Array.isArray(direct[userId]) ? [...direct[userId]] : [];
  // Rooms the summary store already recognised as DMs (e.g. invites flagged is_direct).
  for (const summary of Object.values(useRooms.getState().rooms)) {
    if (summary.dmUserId === userId && !candidates.includes(summary.roomId)) candidates.push(summary.roomId);
  }
  let invited: string | null = null;
  for (const roomId of candidates) {
    const room = client.getRoom(roomId);
    if (!room) continue;
    const membership = room.getMyMembership();
    if (membership === KnownMembership.Join) {
      // Only reuse it if the other side is still there (joined or invited).
      const other = room.getMember(userId)?.membership;
      if (other === KnownMembership.Join || other === KnownMembership.Invite) return roomId;
    } else if (membership === KnownMembership.Invite) {
      invited ??= roomId;
    }
  }
  return invited;
}

/** Creates a DM and records it in `m.direct` so every client shows it as a direct chat. */
export async function createDirectRoom(
  client: MatrixClient,
  userId: string,
  opts: { encrypted?: boolean } = {},
): Promise<string> {
  const { room_id: roomId } = await client.createRoom({
    is_direct: true,
    invite: [userId],
    preset: Preset.TrustedPrivateChat,
    initial_state: opts.encrypted
      ? [{ type: EventType.RoomEncryption, state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } }]
      : undefined,
  });
  await addToDirect(client, userId, roomId);
  return roomId;
}

async function addToDirect(client: MatrixClient, userId: string, roomId: string): Promise<void> {
  const current = client.getAccountData(EventType.Direct)?.getContent<Record<string, string[]>>() ?? {};
  const list = Array.isArray(current[userId]) ? current[userId] : [];
  if (list.includes(roomId)) return;
  try {
    await client.setAccountData(EventType.Direct, { ...current, [userId]: [...list, roomId] });
  } catch (err) {
    // The room exists either way; it just won't be flagged as a DM on other devices.
    console.warn('Failed to save m.direct', err);
  }
}

/** Resolves once the room is known to the client (sync caught up), or false after the timeout. */
export function waitForRoom(client: MatrixClient, roomId: string, timeoutMs = 10_000): Promise<boolean> {
  if (client.getRoom(roomId)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onRoom = (room: Room) => {
      if (room.roomId !== roomId) return;
      cleanup();
      resolve(true);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(!!client.getRoom(roomId));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      client.off(ClientEvent.Room, onRoom);
    };
    client.on(ClientEvent.Room, onRoom);
  });
}

/**
 * Waits for the room, accepts a pending invite (bridges without double puppeting invite us
 * to fresh portals), and opens it. Keeps the current rail view when it would show the room.
 */
export async function openRoomWhenReady(
  client: MatrixClient,
  roomId: string,
  target: { networkId?: string } = {},
): Promise<void> {
  const known = await waitForRoom(client, roomId);
  if (!known) {
    // Joining also makes the room appear when the invite got lost in sync.
    await client.joinRoom(roomId);
  } else if (client.getRoom(roomId)?.getMyMembership() === KnownMembership.Invite) {
    await client.joinRoom(roomId).catch(() => undefined);
  }
  const ui = useUi.getState();
  let view: View | undefined;
  if (target.networkId) {
    const visible =
      ui.view.kind === 'all' || (ui.view.kind === 'network' && ui.view.networkId === target.networkId);
    const networkKnown = useRooms.getState().networks.some((n) => n.id === target.networkId);
    if (!visible) view = networkKnown ? { kind: 'network', networkId: target.networkId } : { kind: 'all' };
  } else if (ui.view.kind !== 'all' && ui.view.kind !== 'matrix') {
    view = { kind: 'all' };
  }
  ui.openRoom(roomId, view ? { view } : undefined);
}

/** Opens the existing chat with a user (e.g. a bridge bot) or creates one. */
export async function openDirectChat(
  client: MatrixClient,
  userId: string,
  opts: { encrypted?: boolean } = {},
): Promise<void> {
  const existing = findDirectRoom(client, userId);
  const roomId = existing ?? (await createDirectRoom(client, userId, opts));
  await openRoomWhenReady(client, roomId);
}
