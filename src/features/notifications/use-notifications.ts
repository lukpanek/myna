import {
  type IRoomTimelineData,
  KnownMembership,
  type MatrixClient,
  type MatrixEvent,
  MatrixEventEvent,
  type Room,
  RoomEvent,
  SyncState,
} from 'matrix-js-sdk';
import { useEffect } from 'react';
import { t } from '@/i18n';
import { isWindowFocused, requestNotificationPermission, showNotification } from '@/lib/native';
import { isBackfill } from '@/matrix/backfill';
import { isOwnGhost } from '@/matrix/bridge';
import { useMatrixClient } from '@/matrix/context';
import { describeEvent, isMessageEvent } from '@/matrix/event-text';
import { getNotifyLevel } from '@/matrix/push-rules';
import { useRooms } from '@/matrix/rooms-store';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

/** Older events are catch-up (laptop wakes up, reconnect) and never notify on their own. */
const MAX_AGE_MS = 2 * 60 * 1000;
/** At most one notification per room in this window; later ones are merged. */
const ROOM_GAP_MS = 3000;
/** Events arriving within this window count as one sync batch. */
const BATCH_MS = 400;
/** More qualifying events than this in one batch collapse into a single summary. */
const BURST_LIMIT = 3;
const BODY_MAX = 140;

interface Candidate {
  roomId: string;
  title: string;
  body: string;
  sound: boolean;
}

export function newMessagesLabel(n: number): string {
  return t('notifications.newMessages', { count: n });
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Decides whether an event should notify and builds the notification text. */
function evaluate(client: MatrixClient, event: MatrixEvent, room: Room): Candidate | null {
  if (event.getSender() === client.getUserId()) return null;
  if (!isMessageEvent(event)) return null;
  if (event.isRelation('m.replace')) return null;
  if (event.getTs() < Date.now() - MAX_AGE_MS) return null;
  // History copied in by a bridge, even when its timestamps are recent.
  if (isBackfill(event, room)) return null;
  if (room.getMyMembership() !== KnownMembership.Join) return null;

  const settings = useSettings.getState().notifications;
  if (!settings.enabled) return null;
  if (settings.pausedUntil && settings.pausedUntil > Date.now()) return null;

  const summary = useRooms.getState().rooms[room.roomId];
  if (summary?.isBotRoom) return null;
  const isDm = summary?.isDm ?? false;

  const actions = client.getPushActionsForEvent(event);
  const highlight = !!actions?.tweaks?.highlight;
  let level = getNotifyLevel(client, room.roomId);
  if (level === 'default' && summary?.bridge) {
    level = settings.networks[summary.bridge.networkId]?.[isDm ? 'dm' : 'group'] ?? 'default';
  }
  let notify: boolean;
  switch (level) {
    case 'mute':
      notify = false;
      break;
    case 'mentions':
      notify = highlight;
      break;
    case 'all':
      notify = true;
      break;
    default:
      notify = !!actions?.notify;
  }
  if (!notify) return null;

  // The user is looking at this chat already.
  if (isWindowFocused() && useUi.getState().page === 'chat' && useUi.getState().roomId === room.roomId) {
    return null;
  }

  const senderId = event.getSender() ?? '';
  // Sent from the user's own phone through the bridge.
  if (isOwnGhost(senderId, summary?.bridge?.receiver)) return null;
  const senderName = room.getMember(senderId)?.name || event.sender?.name || senderId;
  const roomName = summary?.name ?? room.name;
  let title = isDm ? senderName : `${senderName} · ${roomName}`;
  if (summary?.bridge) title += ` (${summary.bridge.networkName})`;
  const body = settings.showContent ? truncate(describeEvent(event), BODY_MAX) || t('notifications.newMessage') : t('notifications.newMessage');

  return { roomId: room.roomId, title, body, sound: settings.sound };
}

function show(c: Candidate) {
  showNotification({ title: c.title, body: c.body, roomId: c.roomId, sound: c.sound }).catch((err) =>
    console.warn('Notifikaci se nepodařilo zobrazit', err),
  );
}

interface RoomThrottle {
  lastAt: number;
  pending: number;
  latest: Candidate | null;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Desktop notifications for new messages. Mount once inside the Matrix context. */
export function useDesktopNotifications(): void {
  const client = useMatrixClient();
  const enabled = useSettings((s) => s.notifications.enabled);

  // Ask up front so the macOS prompt doesn't wait for the first message.
  useEffect(() => {
    if (enabled) void requestNotificationPermission();
  }, [enabled]);

  useEffect(() => {
    const handled = new Set<string>();
    const awaitingDecryption = new Set<string>();
    const throttles = new Map<string, RoomThrottle>();
    let batch: Candidate[] = [];
    let batchTimer: ReturnType<typeof setTimeout> | null = null;

    const remember = (eventId: string) => {
      handled.add(eventId);
      if (handled.size > 1000) handled.delete(handled.values().next().value!);
    };

    const showThrottled = (c: Candidate) => {
      const now = Date.now();
      const th = throttles.get(c.roomId);
      if (!th || now - th.lastAt >= ROOM_GAP_MS) {
        show(c);
        throttles.set(c.roomId, { lastAt: now, pending: 0, latest: null, timer: th?.timer ?? null });
        return;
      }
      th.pending += 1;
      th.latest = c;
      th.timer ??= setTimeout(
        () => {
          th.timer = null;
          const latest = th.latest;
          const count = th.pending;
          th.pending = 0;
          th.latest = null;
          th.lastAt = Date.now();
          if (latest) show(count === 1 ? latest : { ...latest, body: newMessagesLabel(count) });
        },
        th.lastAt + ROOM_GAP_MS - now,
      );
    };

    const flushBatch = () => {
      batchTimer = null;
      const items = batch;
      batch = [];
      if (items.length <= BURST_LIMIT) {
        items.forEach(showThrottled);
        return;
      }
      // Catch-up burst: one summary instead of a wall of notifications.
      const latest = items[items.length - 1];
      const roomIds = new Set(items.map((i) => i.roomId));
      const sound = items.some((i) => i.sound);
      if (roomIds.size === 1) {
        show({ ...latest, body: newMessagesLabel(items.length), sound });
      } else {
        show({
          roomId: latest.roomId,
          title: 'Myna',
          body: t('notifications.newMessagesInChats', { messages: newMessagesLabel(items.length), count: roomIds.size }),
          sound,
        });
      }
      const now = Date.now();
      for (const roomId of roomIds) {
        const th = throttles.get(roomId);
        if (th) th.lastAt = now;
        else throttles.set(roomId, { lastAt: now, pending: 0, latest: null, timer: null });
      }
    };

    const handle = (event: MatrixEvent, room: Room) => {
      const eventId = event.getId();
      if (!eventId || handled.has(eventId)) return;
      // Encrypted: decide only once the content (and thus push rules / mentions) is known.
      if (client.getCrypto() && (event.isBeingDecrypted() || event.shouldAttemptDecryption())) {
        if (awaitingDecryption.has(eventId)) return;
        awaitingDecryption.add(eventId);
        event.once(MatrixEventEvent.Decrypted, () => {
          awaitingDecryption.delete(eventId);
          handle(event, room);
        });
        return;
      }
      remember(eventId);
      const candidate = evaluate(client, event, room);
      if (!candidate) return;
      batch.push(candidate);
      batchTimer ??= setTimeout(flushBatch, BATCH_MS);
    };

    const onTimeline = (
      event: MatrixEvent,
      room: Room | undefined,
      toStartOfTimeline: boolean | undefined,
      removed: boolean,
      data: IRoomTimelineData,
    ) => {
      if (!room || toStartOfTimeline || removed || !data?.liveEvent) return;
      const state = client.getSyncState();
      if (state !== SyncState.Syncing && state !== SyncState.Prepared) return;
      handle(event, room);
    };

    client.on(RoomEvent.Timeline, onTimeline);
    return () => {
      client.off(RoomEvent.Timeline, onTimeline);
      if (batchTimer) clearTimeout(batchTimer);
      for (const th of throttles.values()) if (th.timer) clearTimeout(th.timer);
    };
  }, [client]);
}
