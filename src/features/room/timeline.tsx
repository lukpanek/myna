import {
  Direction,
  type EventTimelineSet,
  type IRoomTimelineData,
  type MatrixEvent,
  MatrixEventEvent,
  NotificationCountType,
  RelationType,
  type Room,
  RoomEvent,
  type Thread,
  ThreadEvent,
  TimelineWindow,
} from 'matrix-js-sdk';
import { ArrowDown, Loader2, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { scrollBehavior } from '@/lib/motion';
import { usePopoutScope, viewOf } from '@/features/popout/popout-scope';
import { isWindowFocused } from '@/lib/native';
import { isPopoutFocused } from '@/lib/popout';
import { configureScrollbar } from '@/lib/scrollbars';
import { formatDayDivider } from '@/lib/time';
import { useEmitterEvent, useMatrixClient } from '@/matrix/context';
import { markRoomRead } from '@/matrix/room-actions';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { TimelineContext, type TimelineContextValue } from './timeline-context';
import { MessageContextMenu, TimelineSections } from './timeline-sections';
import { buildSections, type DaySection, isPending, isVisibleEvent, mediaEvents } from './timeline-utils';

const WINDOW_LIMIT = 400;
const INITIAL_SIZE = 60;
const PAGE_SIZE = 40;
/** Start loading more when this close (px) to either end. */
const EDGE = 900;
const RECEIPT_THROTTLE = 1500;
const HIGHLIGHT_MS = 2000;

interface Snapshot {
  events: MatrixEvent[];
  liveEnd: boolean;
  canBack: boolean;
}

interface Marker {
  /** Last read event; the "Nové" line goes before the next message after it. */
  afterId: string | null;
  count: number;
  /** The read position is older than the loaded window. */
  aboveWindow: boolean;
}

function newWindow(room: Room, timelineSet: EventTimelineSet) {
  return new TimelineWindow(room.client, timelineSet, { windowLimit: WINDOW_LIMIT });
}

function countVisible(events: MatrixEvent[]): number {
  let n = 0;
  for (const e of events) if (isVisibleEvent(e, false)) n++;
  return n;
}

/** Finds where the user stopped reading, captured once when the room opens. */
function computeMarker(room: Room, me: string, events: MatrixEvent[]): Marker | null {
  let count = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    const id = e.getId();
    if (!id || isPending(e) || e.isState() || !isVisibleEvent(e, false)) continue;
    if (e.getSender() === me || room.hasUserReadEvent(me, id)) {
      return count > 0 ? { afterId: id, count, aboveWindow: false } : null;
    }
    count++;
  }
  if (count === 0) return null;
  return {
    afterId: room.getEventReadUpTo(me),
    count: Math.max(count, room.getUnreadNotificationCount(NotificationCountType.Total)),
    aboveWindow: true,
  };
}

/** Binary search for the first row whose bottom edge is inside the viewport. */
function firstVisibleRow(container: HTMLElement): HTMLElement | null {
  const rows = container.querySelectorAll<HTMLElement>('[data-event-id]');
  const top = container.getBoundingClientRect().top;
  let lo = 0;
  let hi = rows.length - 1;
  let found: HTMLElement | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].getBoundingClientRect().bottom > top) {
      found = rows[mid];
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return found;
}

/** Distance from a row's top edge to the end of the timeline content; independent of scroll position. */
function distanceFromEnd(container: HTMLElement, row: HTMLElement): number {
  const content = container.firstElementChild as HTMLElement;
  return (content.getBoundingClientRect().bottom - row.getBoundingClientRect().top)
    / (useSettings.getState().interfaceScale / 100);
}

function rowById(container: HTMLElement, id: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(id)}"]`);
}

export function Timeline({ room }: { room: Room }) {
  const client = useMatrixClient();
  const popout = usePopoutScope();
  const me = client.getSafeUserId();
  const showSystem = useSettings((s) => s.showSystemEvents);
  const showReceipts = useSettings((s) => s.showReadReceipts);
  const timelineSet = room.getUnfilteredTimelineSet();

  const scrollRef = useRef<HTMLDivElement>(null);
  const twRef = useRef<TimelineWindow | null>(null);
  if (!twRef.current) {
    // Loading the live timeline resolves synchronously, so the first render already has events.
    twRef.current = newWindow(room, timelineSet);
    void twRef.current.load(undefined, INITIAL_SIZE);
  }

  const readWindow = useCallback((): Snapshot => {
    const tw = twRef.current!;
    const events = tw.getEvents();
    const liveEnd = !tw.canPaginate(Direction.Forward);
    // Local echoes live outside the timeline (detached pending ordering).
    const pending = liveEnd ? room.getPendingEvents().filter((e) => !e.threadRootId) : [];
    return {
      events: pending.length ? [...events, ...pending] : events,
      liveEnd,
      canBack: tw.canPaginate(Direction.Backward),
    };
  }, [room]);

  const [snapshot, setSnapshot] = useState(readWindow);
  const [marker] = useState(() => computeMarker(room, me, snapshot.events));
  const [markerAbove, setMarkerAbove] = useState(!!marker?.aboveWindow);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [showJump, setShowJump] = useState(false);
  const [busy, setBusy] = useState<{ back: boolean; fwd: boolean; jump: boolean }>({
    back: false,
    fwd: false,
    jump: false,
  });

  const versions = useRef(new Map<string, number>());
  const stuckRef = useRef(true);
  const liveEndRef = useRef(snapshot.liveEnd);
  liveEndRef.current = snapshot.liveEnd;
  /** Row kept in place across a re-render, as its distance from the end of the content. */
  const anchorRef = useRef<{ id: string; fromEnd: number } | null>(null);
  const scrollIdleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollTargetRef = useRef<{ id: string; highlight: boolean } | null>(null);
  const paginating = useRef({ back: false, fwd: false });
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const receiptState = useRef<{ last: number; timer: ReturnType<typeof setTimeout> | null }>({ last: 0, timer: null });
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sections = useMemo(
    () =>
      buildSections(snapshot.events, {
        room,
        me,
        showSystem,
        showReceipts,
        versions: versions.current,
        newAfterId: marker?.afterId,
      }),
    [snapshot, room, me, showSystem, showReceipts, marker],
  );
  const sectionsRef = useRef<DaySection[]>(sections);
  sectionsRef.current = sections;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  // --- state updates -------------------------------------------------------

  const captureAnchor = () => {
    const el = scrollRef.current;
    if (!el || stuckRef.current) {
      anchorRef.current = null;
      return;
    }
    const row = firstVisibleRow(el);
    // Measured against the content, not the viewport: scrolling that happens between this capture
    // and the commit (momentum scrolling) must not be undone by the correction.
    anchorRef.current = row ? { id: row.dataset.eventId!, fromEnd: distanceFromEnd(el, row) } : null;
  };

  const flush = useCallback(() => {
    if (flushTimer.current) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    captureAnchor();
    setSnapshot(readWindow());
  }, [readWindow]);

  /** Batches bursts of SDK events (sync, decryption) into one render. */
  const scheduleFlush = useCallback(() => {
    if (flushTimer.current) return;
    flushTimer.current = setTimeout(flush, 32);
  }, [flush]);

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

  useEffect(
    () => () => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
      if (receiptState.current.timer) clearTimeout(receiptState.current.timer);
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      if (scrollIdleTimer.current) clearTimeout(scrollIdleTimer.current);
    },
    [],
  );

  // --- read receipts -------------------------------------------------------

  const sendReceipt = useCallback(() => {
    const state = receiptState.current;
    if (state.timer) return;
    const run = () => {
      state.timer = null;
      const focused = popout ? isPopoutFocused(room.roomId) : !document.hidden && isWindowFocused();
      if (!stuckRef.current || !liveEndRef.current || !focused) return;
      state.last = Date.now();
      void markRoomRead(client, room).catch(() => undefined);
    };
    const wait = RECEIPT_THROTTLE - (Date.now() - state.last);
    if (wait <= 0) run();
    else state.timer = setTimeout(run, wait);
  }, [client, room, popout]);

  useEffect(() => {
    const onFocus = () => sendReceipt();
    const win = popout?.win ?? window;
    win.addEventListener('focus', onFocus);
    win.document.addEventListener('visibilitychange', onFocus);
    return () => {
      win.removeEventListener('focus', onFocus);
      win.document.removeEventListener('visibilitychange', onFocus);
    };
  }, [sendReceipt, popout]);

  // --- pagination ----------------------------------------------------------

  const paginate = useCallback(
    async (dir: Direction) => {
      const key = dir === Direction.Backward ? 'back' : 'fwd';
      const tw = twRef.current!;
      if (paginating.current[key] || !tw.canPaginate(dir)) return;
      paginating.current[key] = true;
      setBusy((b) => ({ ...b, [key]: true }));
      try {
        // Bridged rooms are full of hidden events; keep going until something visible arrives.
        const before = countVisible(tw.getEvents());
        for (let i = 0; i < 6; i++) {
          const more = await tw.paginate(dir, PAGE_SIZE);
          if (tw !== twRef.current) return;
          if (!more || countVisible(tw.getEvents()) - before >= 15) break;
        }
      } catch {
        toast.error(t(dir === Direction.Backward ? 'room.loadOlderFailed' : 'room.loadNewerFailed'));
      } finally {
        paginating.current[key] = false;
        setBusy((b) => ({ ...b, [key]: false }));
      }
      flush();
    },
    [flush],
  );

  const updateMarkerAbove = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !marker) return;
    const divider = el.querySelector('[data-new-divider]');
    const above = divider
      ? divider.getBoundingClientRect().bottom < el.getBoundingClientRect().top + 8
      : liveEndRef.current && marker.aboveWindow;
    setMarkerAbove(above);
  }, [marker]);

  const checkEdges = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // The scroller is flex-direction: column-reverse, so scrollTop is 0 at the bottom and negative above.
    const fromBottom = Math.max(0, -el.scrollTop);
    const fromTop = el.scrollHeight - el.clientHeight - fromBottom;
    stuckRef.current = fromBottom < 24 && liveEndRef.current;
    setShowJump(fromBottom > 600 || !liveEndRef.current);
    if (fromTop < EDGE) void paginate(Direction.Backward);
    if (!liveEndRef.current && fromBottom < EDGE) void paginate(Direction.Forward);
    if (stuckRef.current) sendReceipt();
    updateMarkerAbove();
  }, [paginate, sendReceipt, updateMarkerAbove]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) {
      // No hover effects while scrolling: rows sliding under a still pointer would each mount a toolbar.
      el.dataset.scrolling = '';
      if (scrollIdleTimer.current) clearTimeout(scrollIdleTimer.current);
      scrollIdleTimer.current = setTimeout(() => delete el.dataset.scrolling, 120);
    }
    checkEdges();
  };

  // --- scroll position after every render -----------------------------------

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const target = scrollTargetRef.current;
    if (target) {
      const row = rowById(el, target.id);
      if (row) {
        scrollTargetRef.current = null;
        row.scrollIntoView({ block: 'center' });
        if (target.highlight) {
          setHighlightId(target.id);
          if (highlightTimer.current) clearTimeout(highlightTimer.current);
          highlightTimer.current = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
        }
      }
    } else if (stuckRef.current) {
      // Writing scrollTop (even the same value) cancels momentum scrolling in WebKit.
      if (el.scrollTop !== 0) el.scrollTop = 0;
    } else if (anchorRef.current) {
      const row = rowById(el, anchorRef.current.id);
      // column-reverse: content added below the anchor grows its distance from the end.
      const delta = row ? distanceFromEnd(el, row) - anchorRef.current.fromEnd : 0;
      if (Math.abs(delta) >= 1) el.scrollTop -= delta;
    }
    anchorRef.current = null;
  }, [sections]);

  useEffect(() => {
    // Fill the viewport and keep receipts/banner current after content changes.
    const view = viewOf(scrollRef.current);
    const frame = view.requestAnimationFrame(checkEdges);
    return () => view.cancelAnimationFrame(frame);
  }, [sections, checkEdges]);

  // --- SDK subscriptions ---------------------------------------------------

  useEmitterEvent(
    client,
    RoomEvent.Timeline,
    (event: MatrixEvent, evRoom: Room | undefined, toStart: boolean | undefined, _removed: boolean, data: IRoomTimelineData) => {
      if (evRoom?.roomId !== room.roomId) return;
      bumpRelated(event);
      if (data.timeline.getTimelineSet() !== timelineSet) {
        // Thread reply: only the root's summary changes.
        bump(event.threadRootId);
        scheduleFlush();
        return;
      }
      const tw = twRef.current!;
      if (!toStart && data.timeline === timelineSet.getLiveTimeline()) {
        const end = tw.getTimelineIndex(Direction.Forward);
        const roomToGrow = tw.getEvents().length < WINDOW_LIMIT - 50;
        // Extending past the limit drops the oldest events, so only do it when the user follows the bottom.
        if (end?.timeline === data.timeline && (stuckRef.current || roomToGrow)) tw.extend(Direction.Forward, 100);
      }
      scheduleFlush();
    },
  );

  const reloadLive = useCallback(() => {
    const tw = newWindow(room, timelineSet);
    void tw.load(undefined, INITIAL_SIZE);
    twRef.current = tw;
    stuckRef.current = true;
    flush();
  }, [room, timelineSet, flush]);

  useEmitterEvent(client, RoomEvent.TimelineReset, (_room: Room | undefined, set: EventTimelineSet) => {
    if (set === timelineSet && liveEndRef.current) reloadLive();
  });
  useEmitterEvent(room, RoomEvent.TimelineRefresh, (_room: Room, set: EventTimelineSet) => {
    if (set === timelineSet) reloadLive();
  });

  useEmitterEvent(client, RoomEvent.Redaction, (redaction: MatrixEvent, evRoom: Room) => {
    if (evRoom?.roomId !== room.roomId) return;
    const redactedId = redaction.event.redacts ?? redaction.getContent().redacts;
    bump(redactedId);
    const target = redactedId ? room.findEventById(redactedId) : undefined;
    if (target) bumpRelated(target);
    scheduleFlush();
  });

  useEmitterEvent(
    client,
    RoomEvent.LocalEchoUpdated,
    (event: MatrixEvent, evRoom: Room, oldEventId?: string, oldStatus?: string | null) => {
      if (evRoom?.roomId !== room.roomId) return;
      bumpRelated(event);
      bump(oldEventId);
      // Sending a new message jumps to the bottom, like Slack.
      const isNewMessage =
        !oldStatus && event.getSender() === me && !event.threadRootId && isVisibleEvent(event, false);
      if (isNewMessage) {
        if (!liveEndRef.current) {
          reloadLive();
          return;
        }
        stuckRef.current = true;
      }
      scheduleFlush();
    },
  );

  useEmitterEvent(client, MatrixEventEvent.Decrypted, (event: MatrixEvent) => {
    if (event.getRoomId() !== room.roomId) return;
    bumpRelated(event);
    scheduleFlush();
  });

  useEmitterEvent(client, MatrixEventEvent.Replaced, (event: MatrixEvent) => {
    if (event.getRoomId() !== room.roomId) return;
    bump(event.getId());
    scheduleFlush();
  });

  useEmitterEvent(client, RoomEvent.Receipt, (_event: MatrixEvent, evRoom: Room) => {
    if (evRoom?.roomId === room.roomId && showReceipts) scheduleFlush();
  });

  useEmitterEvent(room, ThreadEvent.New, (thread: Thread) => {
    bump(thread.id);
    scheduleFlush();
  });

  // --- jumping -------------------------------------------------------------

  const jumpToEvent = useCallback(
    async (eventId: string, highlight = true) => {
      const el = scrollRef.current;
      if (el && rowById(el, eventId)) {
        scrollTargetRef.current = { id: eventId, highlight };
        stuckRef.current = false;
        setSnapshot((s) => ({ ...s }));
        return;
      }
      setBusy((b) => ({ ...b, jump: true }));
      try {
        const tw = newWindow(room, timelineSet);
        await tw.load(eventId, INITIAL_SIZE);
        twRef.current = tw;
        stuckRef.current = false;
        scrollTargetRef.current = { id: eventId, highlight };
        flush();
      } catch {
        // Thread replies are not part of the main timeline: open the thread instead.
        try {
          const raw = await client.fetchRoomEvent(room.roomId, eventId);
          const rel = raw.content?.['m.relates_to'];
          if (rel?.rel_type === 'm.thread' && rel.event_id) {
            useUi.getState().setRightPanel({ kind: 'thread', rootId: rel.event_id });
            return;
          }
        } catch {
          // fall through to the error toast
        }
        toast.error(t('room.messageNotFound'));
      } finally {
        setBusy((b) => ({ ...b, jump: false }));
      }
    },
    [client, room, timelineSet, flush],
  );

  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (liveEndRef.current) {
      el?.scrollTo({ top: 0, behavior: scrollBehavior() });
      return;
    }
    reloadLive();
  };

  const focusEventId = useUi((s) => s.focusEventId);
  useEffect(() => {
    if (!focusEventId) return;
    useUi.getState().clearFocusEvent();
    void jumpToEvent(focusEventId);
  }, [focusEventId, jumpToEvent]);

  const jumpToMarker = () => {
    const el = scrollRef.current;
    const divider = el?.querySelector('[data-new-divider]');
    if (divider) {
      stuckRef.current = false;
      divider.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
    } else if (marker?.afterId) {
      void jumpToEvent(marker.afterId, false);
    }
  };

  const ctx = useMemo<TimelineContextValue>(
    () => ({
      room,
      jumpTo: (id) => void jumpToEvent(id),
      getMediaEvents: () => mediaEvents(sectionsRef.current),
    }),
    [room, jumpToEvent],
  );

  // Overlay scrollbar: date of the topmost message in view beside the thumb; fixed thumb size
  // because the history length is unknown and grows with every page.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    return configureScrollbar(el, {
      fixedThumb: true,
      label: () => {
        const ts = Number(firstVisibleRow(el)?.dataset.ts);
        return ts ? formatDayDivider(ts) : null;
      },
    });
  }, []);

  const findEvent = useCallback(
    (id: string) => snapshotRef.current.events.find((e) => e.getId() === id),
    [],
  );

  const showBanner = !!marker && !bannerDismissed && markerAbove && marker.count > 0;

  return (
    <TimelineContext.Provider value={ctx}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {showBanner && (
          <div className="absolute inset-x-0 top-2 z-30 flex justify-center px-4">
            <div className="flex items-center gap-1 rounded-full border bg-background py-0.5 pr-1 pl-3 text-[13px] shadow-sm">
              <button type="button" onClick={jumpToMarker} className="font-medium text-primary hover:underline">
                {t('room.newMessagesCount', { count: marker.count })}
              </button>
              <span className="text-muted-foreground">·</span>
              <button
                type="button"
                onClick={() => setBannerDismissed(true)}
                className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {t('room.skip')}
                <X className="size-3" />
              </button>
            </div>
          </div>
        )}

        <MessageContextMenu room={room} findEvent={findEvent}>
          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="flex min-h-0 flex-1 flex-col-reverse overflow-x-hidden overflow-y-auto [overflow-anchor:none]"
          >
            <div className="pb-3">
              {snapshot.canBack ? (
                <div className="flex h-12 items-center justify-center text-muted-foreground">
                  {busy.back && <Loader2 className="size-4 animate-spin" />}
                </div>
              ) : (
                <RoomStart room={room} />
              )}
              <TimelineSections room={room} sections={sections} highlightId={highlightId} />
              {!snapshot.liveEnd && (
                <div className="flex h-12 items-center justify-center text-muted-foreground">
                  {busy.fwd && <Loader2 className="size-4 animate-spin" />}
                </div>
              )}
            </div>
          </div>
        </MessageContextMenu>

        {busy.jump && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/60">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {showJump && (
          <button
            type="button"
            onClick={jumpToLatest}
            className="absolute right-6 bottom-3 z-30 flex h-8 items-center gap-1.5 rounded-full border bg-background px-3 text-[13px] font-medium shadow-sm hover:bg-accent"
          >
            <ArrowDown className="size-3.5" />
            {t('room.jumpToLatest')}
          </button>
        )}
      </div>
    </TimelineContext.Provider>
  );
}

function RoomStart({ room }: { room: Room }) {
  return (
    <div className="px-5 pt-10 pb-4">
      <div className="text-lg font-semibold">{room.name}</div>
      <div className="text-sm text-muted-foreground">{t('room.historyStart')}</div>
    </div>
  );
}
