import {
  Direction,
  type MatrixEvent,
  MatrixEventEvent,
  RelationType,
  type Room,
  RoomEvent,
  type Thread,
  ThreadEvent,
} from 'matrix-js-sdk';
import { Loader2, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Composer } from '@/features/composer/composer';
import { composerKey, useComposerStore } from '@/features/composer/composer-store';
import { t } from '@/i18n';
import { isWindowFocused } from '@/lib/native';
import { useEmitterEvent, useMatrixClient } from '@/matrix/context';
import { useRoom, useRoomSummary } from '@/matrix/hooks';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { MessageRow } from './message-row';
import { TimelineContext, type TimelineContextValue } from './timeline-context';
import { MessageContextMenu, TimelineSections } from './timeline-sections';
import { buildSections, type DaySection, mediaEvents } from './timeline-utils';

const PAGE_SIZE = 50;
const EDGE = 600;
const HIGHLIGHT_MS = 2000;

/** Slack-style thread in the right panel: root message, replies, own composer. */
export function ThreadPanel({ roomId, rootId }: { roomId: string; rootId: string }) {
  const room = useRoom(roomId);
  const summary = useRoomSummary(roomId);
  const setRightPanel = useUi((s) => s.setRightPanel);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b pr-2 pl-4">
        <div className="min-w-0">
          <h2 className="text-[15px] leading-5 font-semibold">{t('room.thread')}</h2>
          {summary && <div className="truncate text-xs leading-4 text-muted-foreground">{summary.name}</div>}
        </div>
        <Button variant="ghost" size="icon-sm" onClick={() => setRightPanel(null)} aria-label={t('room.closeThread')}>
          <X />
        </Button>
      </header>
      {room ? (
        <ThreadView key={rootId} room={room} rootId={rootId} />
      ) : (
        <p className="p-6 text-center text-[13px] text-muted-foreground">{t('room.chatUnavailable')}</p>
      )}
    </div>
  );
}

function ThreadView({ room, rootId }: { room: Room; rootId: string }) {
  const client = useMatrixClient();
  const me = client.getSafeUserId();
  const showSystem = useSettings((s) => s.showSystemEvents);
  const showReceipts = useSettings((s) => s.showReadReceipts);
  const key = composerKey(room.roomId, rootId);

  const [thread, setThread] = useState<Thread | null>(() => room.getThread(rootId) ?? null);
  const [root, setRoot] = useState<MatrixEvent | null>(
    () => room.getThread(rootId)?.rootEvent ?? room.findEventById(rootId) ?? null,
  );
  const [rootMissing, setRootMissing] = useState(false);
  const [tick, setTick] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const versions = useRef(new Map<string, number>());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paginating = useRef(false);
  const stuckRef = useRef(true);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => {
    if (flushTimer.current) return;
    flushTimer.current = setTimeout(() => {
      flushTimer.current = null;
      setTick((n) => n + 1);
    }, 32);
  }, []);

  useEffect(
    () => () => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    },
    [],
  );

  const bump = (id: string | undefined | null) => {
    if (id) versions.current.set(id, (versions.current.get(id) ?? 0) + 1);
  };
  const bumpRelated = (event: MatrixEvent) => {
    bump(event.getId());
    const rel = event.getRelation();
    if (rel?.event_id && (rel.rel_type === RelationType.Annotation || rel.rel_type === RelationType.Replace)) {
      bump(rel.event_id);
    }
  };
  const ours = (event: MatrixEvent) =>
    event.getRoomId() === room.roomId && (event.threadRootId === rootId || event.getId() === rootId);

  // The root may be older than anything loaded in the main timeline.
  useEffect(() => {
    if (root) return;
    let alive = true;
    client
      .fetchRoomEvent(room.roomId, rootId)
      .then((raw) => {
        if (alive) setRoot(client.getEventMapper()(raw));
      })
      .catch(() => alive && setRootMissing(true));
    return () => {
      alive = false;
    };
  }, [client, room.roomId, rootId, root]);

  // --- SDK subscriptions ---------------------------------------------------

  useEmitterEvent(room, ThreadEvent.New, (th: Thread) => {
    if (th.id !== rootId) return;
    setThread(th);
    if (!root && th.rootEvent) setRoot(th.rootEvent);
  });
  useEmitterEvent(thread, ThreadEvent.Update, refresh);
  useEmitterEvent(thread, ThreadEvent.NewReply, (_t: Thread, event: MatrixEvent) => {
    bumpRelated(event);
    refresh();
  });
  useEmitterEvent(thread, RoomEvent.Timeline, (event: MatrixEvent) => {
    bumpRelated(event);
    refresh();
  });
  useEmitterEvent(thread, RoomEvent.TimelineReset, refresh);

  useEmitterEvent(client, RoomEvent.LocalEchoUpdated, (event: MatrixEvent, evRoom: Room, oldEventId?: string, oldStatus?: string | null) => {
    if (evRoom?.roomId !== room.roomId) return;
    bumpRelated(event);
    bump(oldEventId);
    if (!oldStatus && event.getSender() === me && event.threadRootId === rootId) stuckRef.current = true;
    refresh();
  });
  useEmitterEvent(client, RoomEvent.Redaction, (redaction: MatrixEvent, evRoom: Room) => {
    if (evRoom?.roomId !== room.roomId) return;
    const redactedId = redaction.event.redacts ?? redaction.getContent().redacts;
    bump(redactedId);
    const target = redactedId ? (thread?.findEventById(redactedId) ?? room.findEventById(redactedId)) : undefined;
    if (target) bumpRelated(target);
    refresh();
  });
  useEmitterEvent(client, MatrixEventEvent.Decrypted, (event: MatrixEvent) => {
    if (!ours(event)) return;
    bumpRelated(event);
    refresh();
  });
  useEmitterEvent(client, MatrixEventEvent.Replaced, (event: MatrixEvent) => {
    if (!ours(event)) return;
    bump(event.getId());
    refresh();
  });
  useEmitterEvent(client, RoomEvent.Receipt, (_event: MatrixEvent, evRoom: Room) => {
    if (evRoom?.roomId === room.roomId && showReceipts) refresh();
  });

  // --- events --------------------------------------------------------------

  const events = useMemo(() => {
    const loaded = thread?.liveTimeline.getEvents() ?? [];
    const seen = new Set(loaded.map((e) => e.getId()));
    // Local echoes stay in the room's detached pending list until the server confirms them.
    const pending = room
      .getPendingEvents()
      .filter((e) => e.threadRootId === rootId && !seen.has(e.getId()));
    return pending.length ? [...loaded, ...pending] : loaded;
    // tick: the thread mutates in place, re-read it on every refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread, room, rootId, tick]);

  const sections = useMemo<DaySection[]>(
    () =>
      buildSections(events, {
        room,
        me,
        showSystem,
        showReceipts,
        versions: versions.current,
        skipId: rootId,
      }),
    [events, room, me, showSystem, showReceipts, rootId],
  );
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;

  const replyCount = thread?.length ?? 0;
  const loading = !!thread && !thread.initialEventsFetched;
  const canBack = !!thread?.liveTimeline.getPaginationToken(Direction.Backward);

  // --- read receipt for the thread -------------------------------------------

  useEffect(() => {
    if (!thread || !stuckRef.current || document.hidden || !isWindowFocused()) return;
    const last = [...events].reverse().find((e) => !e.status && e.getId() && !e.getId()!.startsWith('~'));
    if (!last || last.getSender() === me || thread.hasUserReadEvent(me, last.getId()!)) return;
    void client.sendReadReceipt(last).catch(() => undefined);
  }, [client, thread, events, me]);

  // --- scrolling -------------------------------------------------------------

  const loadOlder = useCallback(async () => {
    if (!thread || paginating.current || !thread.liveTimeline.getPaginationToken(Direction.Backward)) return;
    paginating.current = true;
    setLoadingOlder(true);
    try {
      await client.paginateEventTimeline(thread.liveTimeline, { backwards: true, limit: PAGE_SIZE });
    } catch {
      toast.error(t('room.loadOlderRepliesFailed'));
    } finally {
      paginating.current = false;
      setLoadingOlder(false);
      refresh();
    }
  }, [client, thread, refresh]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    // column-reverse: scrollTop is 0 at the bottom and negative above it.
    const fromBottom = Math.max(0, -el.scrollTop);
    stuckRef.current = fromBottom < 24;
    if (el.scrollHeight - el.clientHeight - fromBottom < EDGE) void loadOlder();
  };

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stuckRef.current && el.scrollTop !== 0) el.scrollTop = 0;
  }, [sections]);

  useEffect(() => {
    useComposerStore.getState().focus(key);
  }, [key]);

  // --- context ---------------------------------------------------------------

  const ctx = useMemo<TimelineContextValue>(
    () => ({
      room,
      threadId: rootId,
      jumpTo: (eventId) => {
        const el = scrollRef.current;
        const row = el?.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(eventId)}"]`);
        if (!row) {
          // Not part of this thread (or not loaded): let the main timeline find it.
          useUi.getState().openRoom(room.roomId, { eventId });
          return;
        }
        stuckRef.current = false;
        row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setHighlightId(eventId);
        if (highlightTimer.current) clearTimeout(highlightTimer.current);
        highlightTimer.current = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
      },
      getMediaEvents: () => {
        const media = mediaEvents(sectionsRef.current);
        const rootType = root?.getContent().msgtype;
        return root && (rootType === 'm.image' || rootType === 'm.video') ? [root, ...media] : media;
      },
    }),
    [room, rootId, root],
  );

  const findEvent = useCallback(
    (id: string) => (id === rootId ? (root ?? undefined) : events.find((e) => e.getId() === id)),
    [rootId, root, events],
  );

  return (
    <TimelineContext.Provider value={ctx}>
      <MessageContextMenu room={room} threadId={rootId} findEvent={findEvent}>
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="flex min-h-0 flex-1 flex-col-reverse overflow-x-hidden overflow-y-auto [overflow-anchor:none]"
        >
          <div className="pt-2 pb-3">
            {root ? (
              <MessageRow
                room={room}
                event={root}
                continuation={false}
                system={false}
                version={(versions.current.get(rootId) ?? 0) + tick}
                receipts=""
                highlighted={highlightId === rootId}
                hideThreadSummary
              />
            ) : (
              <div className="flex h-16 items-center justify-center text-[13px] text-muted-foreground">
                {rootMissing ? t('room.rootLoadFailed') : <Loader2 className="size-4 animate-spin" />}
              </div>
            )}

            <div className="my-2 flex items-center gap-2 px-5">
              <span className="text-xs text-muted-foreground">
                {replyCount > 0 ? t('room.replyCount', { count: replyCount }) : t('room.noReplies')}
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>

            {(loading || (canBack && loadingOlder)) && (
              <div className="flex h-10 items-center justify-center text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
              </div>
            )}
            <TimelineSections room={room} sections={sections} highlightId={highlightId} />
          </div>
        </div>
      </MessageContextMenu>
      <Composer room={room} threadId={rootId} />
    </TimelineContext.Provider>
  );
}
