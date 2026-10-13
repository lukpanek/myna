import {
  Direction,
  EventType,
  Filter,
  type IEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  SearchOrderBy,
} from 'matrix-js-sdk';
import { describeEvent, isMessageEvent, stripReplyFallback } from '@/matrix/event-text';

/**
 * Message search. The homeserver only indexes unencrypted rooms, so results
 * combine three sources: server search (`/search`), events already in memory
 * (decrypted) and, inside one chat, a deeper scan of older history via `/messages`.
 */

export interface SearchHit {
  roomId: string;
  /** Event to jump to (for an edit: the original message). */
  eventId: string;
  sender: string;
  ts: number;
  text: string;
}

export interface SearchPage {
  hits: SearchHit[];
  /** Server pagination token; null = no more server results. */
  nextBatch: string | null;
}

const SCAN_PAGE = 100;
const SCAN_PAGES_PER_STEP = 5;

/** Lowercase without diacritics, so "zpráva" matches "zprava". */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

export function searchTerms(query: string): string[] {
  return normalize(query).split(/\s+/).filter(Boolean);
}

function matchesAll(text: string, terms: string[]): boolean {
  const n = normalize(text);
  return terms.every((term) => n.includes(term));
}

/** Searchable text of a message, or null when the event is not a searchable message. */
function hitOf(event: MatrixEvent, terms: string[]): SearchHit | null {
  const id = event.getId();
  const roomId = event.getRoomId();
  if (!id || !roomId || event.isDecryptionFailure()) return null;
  const content = event.getContent();
  const rel = content['m.relates_to'];
  // History scans see edits as separate events: search the new text, jump to the original.
  const edit = rel?.rel_type === 'm.replace' && !event.isRedacted() ? content['m.new_content'] : null;
  if (!edit && !isMessageEvent(event)) return null;
  const body: unknown = edit ? edit.body : content.body;
  if (typeof body !== 'string' || !body) return null;
  const text = stripReplyFallback(body);
  const filename = typeof content.filename === 'string' ? content.filename : '';
  if (!matchesAll(`${text} ${filename}`, terms)) return null;
  return {
    roomId,
    eventId: edit && typeof rel?.event_id === 'string' ? rel.event_id : id,
    sender: event.getSender() ?? '',
    ts: event.getTs(),
    text: edit || !content.msgtype || content.msgtype === 'm.text' || content.msgtype === 'm.notice' ? text : describeEvent(event),
  };
}

/** Every event of the room the client holds in memory: loaded timelines and threads. */
function loadedEvents(room: Room): MatrixEvent[] {
  const events: MatrixEvent[] = [];
  for (const timeline of room.getUnfilteredTimelineSet().getTimelines()) events.push(...timeline.getEvents());
  for (const thread of room.getThreads()) events.push(...thread.events);
  return events;
}

export function searchLoaded(client: MatrixClient, terms: string[], roomId?: string): SearchHit[] {
  if (terms.length === 0) return [];
  const rooms = roomId ? [client.getRoom(roomId)].filter((r): r is Room => !!r) : client.getRooms();
  const hits: SearchHit[] = [];
  for (const room of rooms) {
    for (const event of loadedEvents(room)) {
      const hit = hitOf(event, terms);
      if (hit) hits.push(hit);
    }
  }
  return hits;
}

export async function searchServer(
  client: MatrixClient,
  query: string,
  opts: { roomId?: string; nextBatch?: string | null; signal?: AbortSignal },
): Promise<SearchPage> {
  const res = await client.search(
    {
      body: {
        search_categories: {
          room_events: {
            search_term: query,
            order_by: SearchOrderBy.Recent,
            filter: opts.roomId ? { rooms: [opts.roomId] } : undefined,
            event_context: { before_limit: 0, after_limit: 0, include_profile: false },
          },
        },
      },
      next_batch: opts.nextBatch ?? undefined,
    },
    opts.signal,
  );
  const category = res.search_categories.room_events;
  const mapper = client.getEventMapper({ preventReEmit: true, decrypt: false });
  // The server matches whole words; filter with the local rule so both sources agree.
  const terms = searchTerms(query);
  const hits: SearchHit[] = [];
  for (const result of category.results ?? []) {
    const hit = hitOf(mapper(result.result as Partial<IEvent>), terms);
    if (hit) hits.push(hit);
  }
  return { hits, nextBatch: category.next_batch ?? null };
}

/**
 * Pages backwards through one chat's history and keeps the (decrypted) messages,
 * so encrypted chats can be searched beyond what the timeline has loaded.
 * One scanner per room, shared across searches.
 */
export class HistoryScanner {
  private events: MatrixEvent[] = [];
  private token: string | null = null;
  private running: Promise<void> | null = null;
  done = false;
  /** Timestamp of the oldest scanned event. */
  oldestTs: number | null = null;

  constructor(
    readonly client: MatrixClient,
    readonly roomId: string,
  ) {}

  get scannedCount(): number {
    return this.events.length;
  }

  search(terms: string[]): SearchHit[] {
    const hits: SearchHit[] = [];
    for (const event of this.events) {
      const hit = hitOf(event, terms);
      if (hit) hits.push(hit);
    }
    return hits;
  }

  /** Loads the next chunk of older history. */
  step(): Promise<void> {
    if (this.done) return Promise.resolve();
    this.running ??= this.load().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async load() {
    const filter = new Filter(this.client.getUserId());
    filter.setDefinition({
      room: { timeline: { types: [EventType.RoomMessage, EventType.RoomMessageEncrypted, EventType.Sticker] } },
    });
    // preventReEmit: history must not reach app-wide listeners (notifications, room list).
    const mapper = this.client.getEventMapper({ preventReEmit: true, decrypt: false });
    for (let page = 0; page < SCAN_PAGES_PER_STEP; page++) {
      const res = await this.client.createMessagesRequest(this.roomId, this.token, SCAN_PAGE, Direction.Backward, filter);
      const events = res.chunk.map(mapper);
      await Promise.all(events.map((e) => this.client.decryptEventIfNeeded(e).catch(() => undefined)));
      this.events.push(...events);
      const last = events.at(-1);
      if (last) this.oldestTs = last.getTs();
      this.token = res.end ?? null;
      if (!res.end || res.chunk.length === 0) {
        this.done = true;
        return;
      }
    }
  }
}

const scanners = new Map<string, HistoryScanner>();

export function historyScanner(client: MatrixClient, roomId: string): HistoryScanner {
  let scanner = scanners.get(roomId);
  if (!scanner || scanner.client !== client) {
    scanner = new HistoryScanner(client, roomId);
    scanners.set(roomId, scanner);
  }
  return scanner;
}

/** Merges sources: one hit per event, newest first. */
export function mergeHits(...lists: SearchHit[][]): SearchHit[] {
  const byId = new Map<string, SearchHit>();
  for (const list of lists) {
    for (const hit of list) {
      const prev = byId.get(hit.eventId);
      // Keep the newest text (an edit beats the original) but the original's timestamp.
      if (!prev) byId.set(hit.eventId, hit);
      else if (hit.ts > prev.ts) byId.set(hit.eventId, { ...hit, ts: prev.ts });
    }
  }
  return [...byId.values()].sort((a, b) => b.ts - a.ts);
}
