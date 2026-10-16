import {
  ClientEvent,
  EventStatus,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  RoomEvent,
  SyncState,
} from 'matrix-js-sdk';
import { create } from 'zustand';

/**
 * Connection health and the outbox. A message sent while the network or the
 * homeserver is down fails at once (the SDK does not retry connection errors);
 * it stays in the timeline as "waiting" and is resent when sync recovers.
 * The SDK keeps unsent events across restarts (store pending events), and
 * those are resent after the first successful sync too.
 */

/** `offline` = no network at all; `unreachable` = network up, homeserver not answering. */
export type ConnectionState = 'online' | 'offline' | 'unreachable';

interface ConnectionStore {
  state: ConnectionState;
  /** Short "back online" confirmation after a visible outage. */
  restored: boolean;
  /** Messages not on the server yet (failed or still being sent). */
  unsent: number;
}

export const useConnection = create<ConnectionStore>(() => ({ state: 'online', restored: false, unsent: 0 }));

/** A problem must last this long before the UI reports it; sync hiccups are common. */
const REPORT_DELAY = 4000;
const RESTORED_MS = 2500;
/** A send that failed while sync looked fine (a blip) is retried after this. */
const BLIP_RETRY_MS = 5000;
const MAX_BLIP_RETRIES = 3;

/** Errors worth sending again: no network, server down or busy. Restored events carry no error. */
export function isRetryable(event: MatrixEvent): boolean {
  const err = event.error as (Error & { httpStatus?: number }) | null;
  if (!err) return true;
  if (err.name === 'ConnectionError') return true;
  const status = err.httpStatus;
  return status === 429 || (status !== undefined && status >= 500);
}

/** Failed message that the outbox will send by itself once the connection is back. */
export function isQueued(event: MatrixEvent): boolean {
  return event.status === EventStatus.NOT_SENT && isRetryable(event);
}

function pendingEvents(client: MatrixClient): { room: Room; event: MatrixEvent }[] {
  return client.getRooms().flatMap((room) => room.getPendingEvents().map((event) => ({ room, event })));
}

export function attachConnection(client: MatrixClient): () => void {
  let syncProblem = false;
  let wasHealthy = true;
  let reportTimer: ReturnType<typeof setTimeout> | null = null;
  let restoredTimer: ReturnType<typeof setTimeout> | null = null;
  let blipTimer: ReturnType<typeof setTimeout> | null = null;
  const blipRetries = new WeakMap<MatrixEvent, number>();

  const healthy = () => !syncProblem && navigator.onLine;

  const countUnsent = () => {
    const unsent = pendingEvents(client).filter(({ event }) => event.status !== EventStatus.SENT).length;
    if (unsent !== useConnection.getState().unsent) useConnection.setState({ unsent });
  };

  /** Sends every queued message again, oldest first per room (the SDK queues them per room). */
  const flush = () => {
    for (const { room, event } of pendingEvents(client)) {
      if (!isQueued(event)) continue;
      void client.resendEvent(event, room).catch(() => undefined);
    }
  };

  const update = () => {
    const next: ConnectionState = !navigator.onLine ? 'offline' : syncProblem ? 'unreachable' : 'online';
    const recovered = next === 'online' && !wasHealthy;
    wasHealthy = next === 'online';
    const shown = useConnection.getState().state;
    if (next === 'online') {
      if (reportTimer) clearTimeout(reportTimer);
      reportTimer = null;
      if (shown !== 'online') {
        useConnection.setState({ state: 'online', restored: true });
        if (restoredTimer) clearTimeout(restoredTimer);
        restoredTimer = setTimeout(() => useConnection.setState({ restored: false }), RESTORED_MS);
      }
      if (recovered) flush();
      return;
    }
    if (shown !== 'online') {
      if (shown !== next) useConnection.setState({ state: next });
      return;
    }
    reportTimer ??= setTimeout(() => {
      reportTimer = null;
      const state: ConnectionState = !navigator.onLine ? 'offline' : syncProblem ? 'unreachable' : 'online';
      if (state !== 'online') useConnection.setState({ state, restored: false });
    }, REPORT_DELAY);
  };

  const onSync = (state: SyncState) => {
    if (state === SyncState.Error || state === SyncState.Reconnecting) syncProblem = true;
    else if (state === SyncState.Syncing || state === SyncState.Prepared || state === SyncState.Catchup) syncProblem = false;
    else return;
    update();
  };

  const onLocalEcho = (event: MatrixEvent) => {
    countUnsent();
    if (event.status !== EventStatus.NOT_SENT || !isRetryable(event) || !healthy()) return;
    // Sync is fine but this request failed: try a few more times before leaving it to the user.
    const tries = blipRetries.get(event) ?? 0;
    if (tries >= MAX_BLIP_RETRIES) return;
    blipRetries.set(event, tries + 1);
    if (blipTimer) return;
    blipTimer = setTimeout(() => {
      blipTimer = null;
      if (healthy()) flush();
    }, BLIP_RETRY_MS * (tries + 1));
  };

  const onNetwork = () => update();

  client.on(ClientEvent.Sync, onSync);
  client.on(RoomEvent.LocalEchoUpdated, onLocalEcho);
  window.addEventListener('online', onNetwork);
  window.addEventListener('offline', onNetwork);
  onSync(client.getSyncState() ?? SyncState.Stopped);
  // Pending events restored from the store arrive asynchronously after room creation.
  const initialCount = setTimeout(() => {
    countUnsent();
    if (healthy()) flush();
  }, 3000);

  return () => {
    client.off(ClientEvent.Sync, onSync);
    client.off(RoomEvent.LocalEchoUpdated, onLocalEcho);
    window.removeEventListener('online', onNetwork);
    window.removeEventListener('offline', onNetwork);
    for (const timer of [reportTimer, restoredTimer, blipTimer, initialCount]) if (timer) clearTimeout(timer);
    useConnection.setState({ state: 'online', restored: false, unsent: 0 });
  };
}
