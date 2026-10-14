import {
  ClientEvent,
  EventType,
  KnownMembership,
  type MatrixClient,
  type MatrixEvent,
  MatrixEventEvent,
  RelationType,
  type Room,
  RoomEvent,
} from 'matrix-js-sdk';
import { create } from 'zustand';
import { displaySender } from '@/features/room/timeline-utils';
import { bridgeReceiver } from '@/matrix/bridge';
import { describeEvent, isMessageEvent } from '@/matrix/event-text';
import { useRooms } from '@/matrix/rooms-store';

/**
 * Slack-style activity feed built from the events the client has loaded:
 * DMs, mentions, replies to the user, replies in their threads and reactions to their messages.
 */
export type ActivityKind = 'dm' | 'mention' | 'reply' | 'thread' | 'reaction';
export type ActivityTab = 'all' | 'dms' | 'mentions' | 'threads' | 'reactions';

export interface ActivityItem {
  key: string;
  kind: ActivityKind;
  roomId: string;
  /** Event to jump to: the message itself, the reacted-to message or the newest thread reply. */
  eventId: string;
  /** Set when the event lives in a thread; the thread opens in the right panel. */
  threadRootId?: string;
  /** Newest event of the item; a read receipt on it marks the item read. */
  latestEventId: string;
  ts: number;
  unread: boolean;
  /** Who did it, newest first (several only for reactions). */
  senders: string[];
  text: string;
  /** Reaction keys with counts (reaction items only). */
  reactions?: { key: string; count: number }[];
}

const MAX_ITEMS = 300;
/** Newest events per timeline that are scanned; older ones only matter for reaction targets. */
const SCAN_PER_TIMELINE = 300;
const RECOMPUTE_MS = 400;

interface ActivityState {
  items: ActivityItem[];
}

export const useActivity = create<ActivityState>(() => ({ items: [] }));

export function matchesTab(item: ActivityItem, tab: ActivityTab): boolean {
  switch (tab) {
    case 'all':
      return true;
    case 'dms':
      return item.kind === 'dm';
    case 'mentions':
      return item.kind === 'mention' || item.kind === 'reply';
    case 'threads':
      return item.kind === 'thread';
    case 'reactions':
      return item.kind === 'reaction';
  }
}

/** Unread items that deserve a red badge (DMs already count in the chat list). */
export function activityBadge(items: ActivityItem[]): number {
  return items.filter((i) => i.unread && i.kind !== 'dm' && i.kind !== 'reaction').length;
}

function scanned(events: MatrixEvent[]): MatrixEvent[] {
  return events.length > SCAN_PER_TIMELINE ? events.slice(-SCAN_PER_TIMELINE) : events;
}

function collectRoom(client: MatrixClient, room: Room, isDm: boolean, out: ActivityItem[]) {
  const me = client.getSafeUserId();
  const receiver = bridgeReceiver(room);
  const isMine = (e: MatrixEvent | undefined) => !!e && displaySender(room, e.getSender(), receiver) === me;
  const isRead = (e: MatrixEvent) => {
    const id = e.getId();
    return !id || isMine(e) || room.hasUserReadEvent(me, id);
  };

  const main = scanned(room.getLiveTimeline().getEvents());
  const threads = room.getThreads();
  const all = [...main, ...threads.flatMap((th) => scanned(th.events))];

  // Mentions and replies to the user (not in DMs, where every message is for the user).
  const used = new Set<string>();
  if (!isDm) {
    for (const event of all) {
      const id = event.getId();
      if (!id || isMine(event) || !isMessageEvent(event)) continue;
      const replyTo = event.replyEventId;
      const reply = !!replyTo && isMine(room.findEventById(replyTo));
      const mention = !reply && !!client.getPushActionsForEvent(event)?.tweaks?.highlight;
      if (!reply && !mention) continue;
      used.add(id);
      const threadRootId = event.threadRootId && !event.isThreadRoot ? event.threadRootId : undefined;
      out.push({
        key: `${reply ? 'reply' : 'mention'}:${id}`,
        kind: reply ? 'reply' : 'mention',
        roomId: room.roomId,
        eventId: id,
        threadRootId,
        latestEventId: id,
        ts: event.getTs(),
        unread: !isRead(event),
        senders: [event.getSender() ?? ''],
        text: describeEvent(event),
      });
    }
  }

  // The newest incoming DM message.
  if (isDm) {
    for (let i = main.length - 1; i >= 0; i--) {
      const event = main[i];
      if (!isMessageEvent(event) || isMine(event) || !event.getId()) continue;
      out.push({
        key: `dm:${room.roomId}`,
        kind: 'dm',
        roomId: room.roomId,
        eventId: event.getId()!,
        latestEventId: event.getId()!,
        ts: event.getTs(),
        unread: !isRead(event),
        senders: [event.getSender() ?? ''],
        text: describeEvent(event),
      });
      break;
    }
  }

  // Threads the user started or replied in: the newest reply from someone else.
  for (const thread of threads) {
    const root = thread.rootEvent;
    if (!isMine(root) && !thread.events.some((e) => isMine(e))) continue;
    let latest: MatrixEvent | undefined;
    for (let i = thread.events.length - 1; i >= 0; i--) {
      const e = thread.events[i];
      if (e.getId() !== thread.id && isMessageEvent(e) && !isMine(e)) {
        latest = e;
        break;
      }
    }
    const id = latest?.getId();
    if (!latest || !id || used.has(id)) continue;
    out.push({
      key: `thread:${thread.id}`,
      kind: 'thread',
      roomId: room.roomId,
      eventId: id,
      threadRootId: thread.id,
      latestEventId: id,
      ts: latest.getTs(),
      unread: !isRead(latest),
      senders: [latest.getSender() ?? ''],
      text: describeEvent(latest),
    });
  }

  // Reactions to the user's messages, one item per message.
  const byTarget = new Map<string, MatrixEvent[]>();
  for (const event of all) {
    if (event.getType() !== EventType.Reaction || event.isRedacted() || isMine(event)) continue;
    const rel = event.getRelation();
    if (rel?.rel_type !== RelationType.Annotation || !rel.event_id || !rel.key) continue;
    const list = byTarget.get(rel.event_id) ?? [];
    list.push(event);
    byTarget.set(rel.event_id, list);
  }
  for (const [targetId, reactions] of byTarget) {
    const target = room.findEventById(targetId);
    if (!isMine(target) || target!.isRedacted()) continue;
    reactions.sort((a, b) => b.getTs() - a.getTs());
    const counts = new Map<string, number>();
    for (const r of reactions) {
      const key = r.getRelation()!.key!;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const latest = reactions[0];
    out.push({
      key: `reaction:${targetId}`,
      kind: 'reaction',
      roomId: room.roomId,
      eventId: targetId,
      threadRootId: target!.threadRootId && !target!.isThreadRoot ? target!.threadRootId : undefined,
      latestEventId: latest.getId() ?? targetId,
      ts: latest.getTs(),
      unread: !isRead(latest),
      senders: [...new Set(reactions.map((r) => r.getSender() ?? ''))],
      text: describeEvent(target!),
      reactions: [...counts].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
    });
  }
}

function compute(client: MatrixClient): ActivityItem[] {
  const summaries = useRooms.getState().rooms;
  const out: ActivityItem[] = [];
  for (const room of client.getRooms()) {
    if (room.getMyMembership() !== KnownMembership.Join || room.isSpaceRoom()) continue;
    const summary = summaries[room.roomId];
    if (summary?.isBotRoom) continue;
    collectRoom(client, room, summary?.isDm ?? false, out);
  }
  out.sort((a, b) => b.ts - a.ts);
  return out.slice(0, MAX_ITEMS);
}

/** Keeps `useActivity` in sync with the client (debounced full rescan). Returns a cleanup function. */
export function attachActivity(client: MatrixClient): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    useActivity.setState({ items: compute(client) });
  };
  const schedule = () => {
    if (timer === null) timer = setTimeout(flush, RECOMPUTE_MS);
  };

  const roomEvents = [
    RoomEvent.Timeline,
    RoomEvent.Receipt,
    RoomEvent.Redaction,
    RoomEvent.MyMembership,
    RoomEvent.LocalEchoUpdated,
  ] as const;
  for (const e of roomEvents) client.on(e, schedule);
  client.on(MatrixEventEvent.Decrypted, schedule);
  client.on(ClientEvent.DeleteRoom, schedule);
  // DM and bot-room flags come from the rooms store.
  const unsubscribeRooms = useRooms.subscribe((s, prev) => {
    if (s.rooms !== prev.rooms) schedule();
  });
  schedule();

  return () => {
    if (timer) clearTimeout(timer);
    unsubscribeRooms();
    for (const e of roomEvents) client.off(e, schedule);
    client.off(MatrixEventEvent.Decrypted, schedule);
    client.off(ClientEvent.DeleteRoom, schedule);
    useActivity.setState({ items: [] });
  };
}

/** Sends a read receipt on the item's newest event (threaded when it lives in a thread). */
export async function markActivityRead(client: MatrixClient, item: ActivityItem): Promise<void> {
  const event = client.getRoom(item.roomId)?.findEventById(item.latestEventId);
  if (event) await client.sendReadReceipt(event);
}
