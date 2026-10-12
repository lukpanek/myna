import { EventStatus, EventType, type MatrixEvent, RelationType, type Room } from 'matrix-js-sdk';
import { t } from '@/i18n';
import { isSameDay } from '@/lib/time';

const POLL_TYPES = new Set(['m.poll.start', 'org.matrix.msc3381.poll.start']);
const SYSTEM_TYPES = new Set<string>([
  EventType.RoomMember,
  EventType.RoomName,
  EventType.RoomTopic,
  EventType.RoomAvatar,
  EventType.RoomCreate,
  EventType.RoomEncryption,
  EventType.RoomPinnedEvents,
]);
const GROUP_WINDOW_MS = 5 * 60 * 1000;

export function memberName(room: Room, userId: string | undefined): string {
  if (!userId) return '';
  return room.getMember(userId)?.name || userId;
}

export function senderName(room: Room, event: MatrixEvent): string {
  return event.sender?.name || memberName(room, event.getSender());
}

/** Stable React key: local echoes keep their txn id after the server assigns an event id. */
export function eventKey(event: MatrixEvent): string {
  return event.getTxnId() ?? event.getId() ?? '';
}

export function isPending(event: MatrixEvent): boolean {
  const status = event.status;
  return status !== null && status !== EventStatus.SENT && status !== EventStatus.CANCELLED;
}

/** Whether an event gets its own row in the timeline. */
export function isVisibleEvent(event: MatrixEvent, showSystem: boolean): boolean {
  const type = event.getType();
  if (type === EventType.Reaction || type === EventType.RoomRedaction) return false;
  // Relation info stays unencrypted, so this also hides still-encrypted reactions and edits.
  const rel = event.getWireContent()['m.relates_to']?.rel_type;
  if (rel === RelationType.Annotation || rel === RelationType.Replace) return false;
  if (event.isState()) return showSystem && SYSTEM_TYPES.has(type) && describeSystemEvent(event) !== null;
  if (type === EventType.RoomMessageEncrypted) return event.isDecryptionFailure();
  if (type === EventType.RoomMessage) return event.isRedacted() || typeof event.getContent().msgtype === 'string';
  return type === EventType.Sticker || POLL_TYPES.has(type);
}

export function isPollEvent(event: MatrixEvent): boolean {
  return POLL_TYPES.has(event.getType());
}

/** Compact one-liner for state events; null = not worth showing. */
export function describeSystemEvent(event: MatrixEvent, room?: Room): string | null {
  const type = event.getType();
  const content = event.getContent();
  const prev = event.getPrevContent();
  const sender = room ? senderName(room, event) : (event.sender?.name ?? event.getSender() ?? '');
  switch (type) {
    case EventType.RoomMember: {
      const target = content.displayname || prev.displayname || event.getStateKey() || '';
      const membership = content.membership;
      const prevMembership = prev.membership;
      const self = event.getSender() === event.getStateKey();
      if (membership === 'join' && prevMembership === 'join') {
        if (content.displayname !== prev.displayname) {
          if (!prev.displayname) return t('room.sysNameSet', { name: target });
          if (!content.displayname) return t('room.sysNameRemoved', { name: prev.displayname });
          return t('room.sysNameChanged', { old: prev.displayname, new: content.displayname });
        }
        if (content.avatar_url !== prev.avatar_url) return t('room.sysAvatarChanged', { name: target });
        return null;
      }
      if (membership === 'join') return t('room.sysJoined', { target });
      if (membership === 'invite') return t('room.sysInvited', { sender, target });
      if (membership === 'ban') return t('room.sysBanned', { sender, target });
      if (membership === 'leave') {
        if (prevMembership === 'invite') {
          return self ? t('room.sysInviteRejected', { target }) : t('room.sysInviteRevoked', { sender, target });
        }
        if (prevMembership === 'ban') return t('room.sysUnbanned', { sender, target });
        return self ? t('room.sysLeft', { target }) : t('room.sysKicked', { sender, target });
      }
      if (membership === 'knock') return t('room.sysKnocked', { target });
      return null;
    }
    case EventType.RoomName:
      return content.name
        ? t('room.sysRoomNameChanged', { sender, name: content.name })
        : t('room.sysRoomNameRemoved', { sender });
    case EventType.RoomTopic:
      return content.topic
        ? t('room.sysTopicChanged', { sender, topic: content.topic })
        : t('room.sysTopicRemoved', { sender });
    case EventType.RoomAvatar:
      return content.url ? t('room.sysRoomAvatarChanged', { sender }) : t('room.sysRoomAvatarRemoved', { sender });
    case EventType.RoomCreate:
      return t('room.sysCreated', { sender });
    case EventType.RoomEncryption:
      return t('room.sysEncryption', { sender });
    case EventType.RoomPinnedEvents:
      return t('room.sysPinned', { sender });
    default:
      return null;
  }
}

export interface EventItem {
  kind: 'event';
  key: string;
  event: MatrixEvent;
  system: boolean;
  continuation: boolean;
  version: number;
  /** Comma-joined user ids whose read receipt sits on this row. */
  receipts: string;
}

export interface NewDividerItem {
  kind: 'new';
  key: string;
}

export type TimelineItem = EventItem | NewDividerItem;

export interface DaySection {
  key: string;
  ts: number;
  items: TimelineItem[];
}

interface BuildOptions {
  room: Room;
  me: string;
  showSystem: boolean;
  showReceipts: boolean;
  versions: Map<string, number>;
  /** Insert the red "Nové" line before the first message after this event. */
  newAfterId?: string | null;
  /** Thread root shown separately in the thread panel. */
  skipId?: string;
}

/** Turns raw timeline events into day sections with grouping, read marker and receipts. */
export function buildSections(events: MatrixEvent[], opts: BuildOptions): DaySection[] {
  const { room, me, showSystem, showReceipts, versions, newAfterId, skipId } = opts;

  // Receipts: walk newest → oldest so receipts on hidden events land on the nearest older visible row.
  const receiptsByIndex = new Map<number, string[]>();
  if (showReceipts) {
    const seen = new Set<string>([me]);
    let carry: string[] = [];
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (!isPending(e)) {
        for (const userId of room.getUsersReadUpTo(e)) {
          if (seen.has(userId)) continue;
          seen.add(userId);
          carry.push(userId);
        }
      }
      if (carry.length && isVisibleEvent(e, showSystem) && e.getId() !== skipId) {
        receiptsByIndex.set(i, carry);
        carry = [];
      }
    }
  }

  const sections: DaySection[] = [];
  let section: DaySection | null = null;
  let prev: EventItem | null = null;
  let markerPassed = !newAfterId;
  let newInserted = false;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const id = event.getId();
    if (!markerPassed && id === newAfterId) {
      markerPassed = true;
      continue;
    }
    if (id === skipId || !isVisibleEvent(event, showSystem)) continue;

    const ts = event.getTs();
    if (!section || !isSameDay(section.ts, ts)) {
      section = { key: `day-${ts}-${i}`, ts, items: [] };
      sections.push(section);
      prev = null;
    }

    if (markerPassed && newAfterId && !newInserted && !event.isState() && event.getSender() !== me) {
      section.items.push({ kind: 'new', key: 'new-divider' });
      newInserted = true;
      prev = null;
    }

    const system = event.isState();
    const continuation =
      !system &&
      !!prev &&
      !prev.system &&
      prev.event.getSender() === event.getSender() &&
      ts - prev.event.getTs() < GROUP_WINDOW_MS;
    const item: EventItem = {
      kind: 'event',
      key: eventKey(event),
      event,
      system,
      continuation,
      version: (id ? versions.get(id) : undefined) ?? 0,
      receipts: receiptsByIndex.get(i)?.join(',') ?? '',
    };
    section.items.push(item);
    prev = item;
  }
  return sections;
}

/** Image and video events in render order, for lightbox navigation. */
export function mediaEvents(sections: DaySection[]): MatrixEvent[] {
  const out: MatrixEvent[] = [];
  for (const s of sections) {
    for (const item of s.items) {
      if (item.kind !== 'event' || item.event.isRedacted()) continue;
      const msgtype = item.event.getContent().msgtype;
      if (msgtype === 'm.image' || msgtype === 'm.video') out.push(item.event);
    }
  }
  return out;
}

export const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\p{Emoji_Presentation}|️|‍|\s)+$/u;

/** Short messages made only of emoji are shown larger, like Slack's jumbomoji. */
export function isJumboEmoji(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 40 || !EMOJI_ONLY.test(trimmed)) return false;
  // Digits and '#' are Emoji_Component but plain text on their own.
  if (/[0-9#*]/.test(trimmed.replace(/[0-9#*]️?⃣/gu, ''))) return false;
  const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(trimmed)].filter(
    (s) => s.segment.trim(),
  );
  return segments.length > 0 && segments.length <= 10;
}
