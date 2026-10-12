import {
  ClientEvent,
  EventType,
  KnownMembership,
  type MatrixClient,
  type MatrixEvent,
  MatrixEventEvent,
  NotificationCountType,
  type Room,
  RoomEvent,
  RoomStateEvent,
} from 'matrix-js-sdk';
import { create } from 'zustand';
import { getLocale, t } from '@/i18n';
import { useSettings } from '@/store/settings';
import { type BridgeInfo, getBridgeInfo, isOwnGhost, setNetworkAliases } from './bridge';
import { describeEvent, isMessageEvent } from './event-text';
import { getNotifyLevel, type NotifyLevel } from './push-rules';

export interface RoomPreview {
  senderName: string;
  text: string;
  own: boolean;
}

export interface RoomSummary {
  roomId: string;
  name: string;
  avatarMxc?: string;
  membership: 'join' | 'invite';
  isDm: boolean;
  dmUserId?: string;
  bridge: BridgeInfo | null;
  /** Bridge login (account) this chat belongs to, when known. */
  accountId?: string;
  /** DM with a bridge bot (management room): hidden from chat lists. */
  isBotRoom: boolean;
  lastTs: number;
  preview?: RoomPreview;
  unreadCount: number;
  highlightCount: number;
  /** Has messages the user has not read, even if push rules do not count them. */
  isUnread: boolean;
  notifyLevel: NotifyLevel;
  favourite: boolean;
  lowPriority: boolean;
  /** Real Matrix spaces (not bridge-generated) that contain this room. */
  spaceIds: string[];
}

export interface AccountSummary {
  id: string;
  name: string;
  spaceId?: string;
}

export interface NetworkSummary {
  id: string;
  name: string;
  avatarMxc?: string;
  bridgeBot?: string;
  accounts: AccountSummary[];
}

export interface SpaceSummary {
  roomId: string;
  name: string;
  avatarMxc?: string;
  childIds: string[];
}

interface RoomsState {
  ready: boolean;
  rooms: Record<string, RoomSummary>;
  networks: NetworkSummary[];
  spaces: SpaceSummary[];
}

export const useRooms = create<RoomsState>(() => ({
  ready: false,
  rooms: {},
  networks: [],
  spaces: [],
}));

/** Structural data shared by every room summary; rebuilt when spaces or bridges change. */
interface Structure {
  directByRoom: Map<string, string>;
  bridgeBots: Set<string>;
  accountByRoom: Map<string, string>;
  spacesByRoom: Map<string, string[]>;
  networks: NetworkSummary[];
  spaces: SpaceSummary[];
}

const PERSONAL_SPACE = 'personal_filtering_space';

function spaceChildren(room: Room): string[] {
  return room.currentState
    .getStateEvents(EventType.SpaceChild)
    .filter((e) => Array.isArray(e.getContent().via) && e.getStateKey())
    .map((e) => e.getStateKey()!);
}

/** "WhatsApp (+420 777 123 456)" → "+420 777 123 456" */
function accountNameFromSpace(name: string): string {
  const match = name.match(/\(([^)]+)\)\s*$/);
  return match ? match[1] : name;
}

/**
 * Picks one network key per bridge bot: the one its personal space announces
 * (the bridge's current key), else the most common one among its rooms.
 */
function networkAliases(rooms: Room[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  const fromSpace = new Map<string, string>();
  for (const room of rooms) {
    const membership = room.getMyMembership();
    if (membership !== KnownMembership.Join && membership !== KnownMembership.Invite) continue;
    const bridge = getBridgeInfo(room);
    if (!bridge?.bridgeBot) continue;
    if (room.isSpaceRoom() && bridge.roomType === PERSONAL_SPACE) fromSpace.set(bridge.bridgeBot, bridge.protocolId);
    const perBot = counts.get(bridge.bridgeBot) ?? new Map<string, number>();
    perBot.set(bridge.protocolId, (perBot.get(bridge.protocolId) ?? 0) + 1);
    counts.set(bridge.bridgeBot, perBot);
  }
  const aliases = new Map<string, string>();
  for (const [bot, perBot] of counts) {
    if (perBot.size < 2) continue;
    const top = [...perBot].sort((a, b) => b[1] - a[1])[0][0];
    aliases.set(bot, fromSpace.get(bot) ?? top);
  }
  return aliases;
}

function buildStructure(client: MatrixClient): Structure {
  const rooms = client.getRooms();
  setNetworkAliases(networkAliases(rooms));
  const directByRoom = new Map<string, string>();
  const direct = client.getAccountData(EventType.Direct)?.getContent<Record<string, string[]>>() ?? {};
  for (const [userId, roomIds] of Object.entries(direct)) {
    if (!Array.isArray(roomIds)) continue;
    for (const roomId of roomIds) directByRoom.set(roomId, userId);
  }

  const bridgeBots = new Set<string>();
  const accountByRoom = new Map<string, string>();
  const spacesByRoom = new Map<string, string[]>();
  const networkMap = new Map<string, NetworkSummary>();
  const spaces: SpaceSummary[] = [];

  for (const room of rooms) {
    const membership = room.getMyMembership();
    if (membership !== KnownMembership.Join && membership !== KnownMembership.Invite) continue;
    const bridge = getBridgeInfo(room);
    if (bridge) {
      if (bridge.bridgeBot) bridgeBots.add(bridge.bridgeBot);
      let network = networkMap.get(bridge.networkId);
      if (!network) {
        network = {
          id: bridge.networkId,
          name: bridge.networkName,
          avatarMxc: bridge.networkAvatar,
          bridgeBot: bridge.bridgeBot,
          accounts: [],
        };
        networkMap.set(bridge.networkId, network);
      }
      if (!network.avatarMxc && bridge.networkAvatar) network.avatarMxc = bridge.networkAvatar;

      if (room.isSpaceRoom() && bridge.roomType === PERSONAL_SPACE) {
        const accountId = bridge.receiver ?? room.roomId;
        network.accounts.push({ id: accountId, name: accountNameFromSpace(room.name), spaceId: room.roomId });
        for (const childId of spaceChildren(room)) accountByRoom.set(childId, accountId);
      }
      continue;
    }
    if (room.isSpaceRoom() && membership === KnownMembership.Join) {
      const childIds = spaceChildren(room);
      spaces.push({ roomId: room.roomId, name: room.name, avatarMxc: room.getMxcAvatarUrl() ?? undefined, childIds });
      for (const childId of childIds) {
        const list = spacesByRoom.get(childId) ?? [];
        list.push(room.roomId);
        spacesByRoom.set(childId, list);
      }
    }
  }

  const networks = [...networkMap.values()].sort((a, b) => a.name.localeCompare(b.name, getLocale()));
  for (const network of networks) network.accounts.sort((a, b) => a.name.localeCompare(b.name, getLocale()));
  spaces.sort((a, b) => a.name.localeCompare(b.name, getLocale()));

  return { directByRoom, bridgeBots, accountByRoom, spacesByRoom, networks, spaces };
}

function lastMessage(room: Room): MatrixEvent | undefined {
  const events = room.getLiveTimeline().getEvents();
  for (let i = events.length - 1; i >= 0; i--) {
    if (isMessageEvent(events[i])) return events[i];
  }
  return undefined;
}

function computeUnread(client: MatrixClient, room: Room, last: MatrixEvent | undefined, muted: boolean): boolean {
  if (room.getAccountData('m.marked_unread')?.getContent().unread) return true;
  if (room.getAccountData('com.famedly.marked_unread')?.getContent().unread) return true;
  if (muted || !last) return false;
  const me = client.getSafeUserId();
  if (last.getSender() === me) return false;
  const lastId = last.getId();
  return !!lastId && !room.hasUserReadEvent(me, lastId);
}

function summarize(client: MatrixClient, room: Room, s: Structure): RoomSummary | null {
  const membership = room.getMyMembership();
  if (membership !== KnownMembership.Join && membership !== KnownMembership.Invite) return null;
  if (room.isSpaceRoom()) return null;

  const me = client.getSafeUserId();
  const bridge = getBridgeInfo(room);
  let dmUserId = s.directByRoom.get(room.roomId);
  if (!dmUserId && membership === KnownMembership.Invite) {
    const inviter = room.getDMInviter();
    if (inviter && room.currentState.getStateEvents(EventType.RoomMember, me)?.getContent().is_direct) {
      dmUserId = inviter;
    }
  }
  const isDm = bridge ? bridge.roomType === 'dm' || (!!dmUserId && bridge.roomType !== 'group_dm') : !!dmUserId;
  const isBotRoom =
    !bridge &&
    ((!!dmUserId && s.bridgeBots.has(dmUserId)) ||
      (room.getJoinedMemberCount() <= 2 && room.getMembers().some((m) => s.bridgeBots.has(m.userId))));

  let avatarMxc = room.getMxcAvatarUrl() ?? undefined;
  if (!avatarMxc && isDm) avatarMxc = room.getAvatarFallbackMember()?.getMxcAvatarUrl() ?? undefined;

  const last = lastMessage(room);
  let preview: RoomPreview | undefined;
  if (last) {
    const sender = last.getSender() ?? '';
    const member = room.getMember(sender);
    preview = {
      senderName: member?.rawDisplayName || sender,
      text: describeEvent(last),
      own: sender === me || isOwnGhost(sender, bridge?.receiver),
    };
  }

  const notifyLevel = getNotifyLevel(client, room.roomId);
  const tags = room.tags ?? {};
  return {
    roomId: room.roomId,
    name: room.name || t('matrix.unnamedRoom'),
    avatarMxc,
    membership: membership === KnownMembership.Invite ? 'invite' : 'join',
    isDm,
    dmUserId,
    bridge,
    accountId: bridge?.receiver ?? s.accountByRoom.get(room.roomId),
    isBotRoom,
    lastTs: last?.getTs() ?? room.getLastActiveTimestamp() ?? 0,
    preview,
    unreadCount: room.getUnreadNotificationCount(NotificationCountType.Total),
    highlightCount: room.getUnreadNotificationCount(NotificationCountType.Highlight),
    isUnread: computeUnread(client, room, last, notifyLevel === 'mute'),
    notifyLevel,
    favourite: 'm.favourite' in tags,
    lowPriority: 'm.lowpriority' in tags,
    spaceIds: s.spacesByRoom.get(room.roomId) ?? [],
  };
}

/**
 * Keeps `useRooms` in sync with the client. Updates are batched: room-level
 * changes recompute only the touched rooms, structural changes (spaces, bridges,
 * m.direct, push rules) recompute everything. Returns a cleanup function.
 */
export function attachRoomsStore(client: MatrixClient): () => void {
  let structure = buildStructure(client);
  const dirty = new Set<string>();
  let fullRebuild = true;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    const prev = useRooms.getState().rooms;
    let rooms: Record<string, RoomSummary>;
    if (fullRebuild) {
      structure = buildStructure(client);
      rooms = {};
      for (const room of client.getRooms()) {
        const summary = summarize(client, room, structure);
        if (summary) rooms[room.roomId] = summary;
      }
    } else {
      rooms = { ...prev };
      for (const roomId of dirty) {
        const room = client.getRoom(roomId);
        const summary = room ? summarize(client, room, structure) : null;
        if (summary) rooms[roomId] = summary;
        else delete rooms[roomId];
      }
    }
    fullRebuild = false;
    dirty.clear();
    useRooms.setState({
      ready: true,
      rooms,
      networks: structure.networks,
      spaces: structure.spaces,
    });
  };

  const schedule = () => {
    if (timer === null) timer = setTimeout(flush, 60);
  };
  const markRoom = (room: Room | undefined | null) => {
    if (!room) return;
    if (room.isSpaceRoom()) fullRebuild = true;
    dirty.add(room.roomId);
    schedule();
  };
  const markAll = () => {
    fullRebuild = true;
    schedule();
  };

  const onTimeline = (_e: MatrixEvent, room: Room | undefined) => markRoom(room);
  const onRoomEvent = (_e: unknown, room: Room) => markRoom(room);
  const onRoom = (room: Room) => markRoom(room);
  const onMembership = (room: Room) => markRoom(room);
  const onState = (event: MatrixEvent) => {
    const type = event.getType();
    if (type === EventType.SpaceChild || type === 'm.bridge' || type === 'uk.half-shot.bridge') {
      markAll();
      return;
    }
    markRoom(client.getRoom(event.getRoomId()));
  };
  const onAccountData = (event: MatrixEvent) => {
    const type = event.getType();
    if (type === EventType.Direct || type === EventType.PushRules) markAll();
  };
  const onDecrypted = (event: MatrixEvent) => markRoom(client.getRoom(event.getRoomId()));
  const onSync = () => {
    if (!useRooms.getState().ready) markAll();
  };

  client.on(RoomEvent.Timeline, onTimeline);
  client.on(RoomEvent.Receipt, onRoomEvent);
  client.on(RoomEvent.Name, onRoom);
  client.on(RoomEvent.Tags, onRoomEvent);
  client.on(RoomEvent.AccountData, onRoomEvent);
  client.on(RoomEvent.MyMembership, onMembership);
  client.on(RoomEvent.Redaction, onRoomEvent);
  client.on(RoomEvent.LocalEchoUpdated, onRoomEvent);
  client.on(RoomStateEvent.Events, onState);
  client.on(ClientEvent.Room, onRoom);
  client.on(ClientEvent.DeleteRoom, markAll);
  client.on(ClientEvent.AccountData, onAccountData);
  client.on(ClientEvent.Sync, onSync);
  client.on(MatrixEventEvent.Decrypted, onDecrypted);

  // Renamed networks: every summary carries the network name.
  const unsubscribeSettings = useSettings.subscribe((state, prev) => {
    if (state.networkNames !== prev.networkNames) markAll();
  });

  schedule();

  return () => {
    if (timer) clearTimeout(timer);
    unsubscribeSettings();
    client.off(RoomEvent.Timeline, onTimeline);
    client.off(RoomEvent.Receipt, onRoomEvent);
    client.off(RoomEvent.Name, onRoom);
    client.off(RoomEvent.Tags, onRoomEvent);
    client.off(RoomEvent.AccountData, onRoomEvent);
    client.off(RoomEvent.MyMembership, onMembership);
    client.off(RoomEvent.Redaction, onRoomEvent);
    client.off(RoomEvent.LocalEchoUpdated, onRoomEvent);
    client.off(RoomStateEvent.Events, onState);
    client.off(ClientEvent.Room, onRoom);
    client.off(ClientEvent.DeleteRoom, markAll);
    client.off(ClientEvent.AccountData, onAccountData);
    client.off(ClientEvent.Sync, onSync);
    client.off(MatrixEventEvent.Decrypted, onDecrypted);
    useRooms.setState({ ready: false, rooms: {}, networks: [], spaces: [] });
  };
}
