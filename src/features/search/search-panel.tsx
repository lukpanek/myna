import { Loader2, Search, X } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { MxAvatar } from '@/components/mx-avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { t } from '@/i18n';
import { formatDayDivider, formatListTime, formatMessageTime } from '@/lib/time';
import { useMatrixClient } from '@/matrix/context';
import { useRooms } from '@/matrix/rooms-store';
import { memberName } from '@/features/room/timeline-utils';
import { type SearchScope, useUi } from '@/store/ui';
import {
  historyScanner,
  mergeHits,
  normalize,
  type SearchHit,
  searchLoaded,
  searchServer,
  searchTerms,
} from './search';

const DEBOUNCE_MS = 250;
const SNIPPET_CONTEXT = 60;
const MAX_HITS = 300;

function errorText(err: unknown): string {
  return err instanceof Error && err.message ? err.message : String(err);
}

interface Results {
  server: SearchHit[];
  nextBatch: string | null;
  serverError: string | null;
  /** Bumped when the history scan grows, so local results are recomputed. */
  scanVersion: number;
}

const EMPTY: Results = { server: [], nextBatch: null, serverError: null, scanVersion: 0 };

/** Right panel: search messages in the open chat or in all chats. */
export function SearchPanel({ scope, initialQuery }: { scope: SearchScope; initialQuery?: string }) {
  const client = useMatrixClient();
  const roomId = useUi((s) => s.roomId);
  const setRightPanel = useUi((s) => s.setRightPanel);
  const roomName = useRooms((s) => (roomId ? s.rooms[roomId]?.name : undefined));
  const [query, setQuery] = useState(initialQuery ?? '');
  const [debounced, setDebounced] = useState(query);
  const [results, setResults] = useState<Results>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const effectiveScope: SearchScope = roomId ? scope : 'all';
  const searchRoomId = effectiveScope === 'room' ? (roomId ?? undefined) : undefined;

  useEffect(() => {
    if (initialQuery !== undefined) setQuery(initialQuery);
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [initialQuery, scope]);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  // Server search for every new query; local sources are recomputed on render.
  useEffect(() => {
    setResults(EMPTY);
    if (!debounced) return;
    const abort = new AbortController();
    setLoading(true);
    searchServer(client, debounced, { roomId: searchRoomId, signal: abort.signal })
      .then((page) => setResults((r) => ({ ...r, server: page.hits, nextBatch: page.nextBatch })))
      .catch((err) => {
        if (!abort.signal.aborted) setResults((r) => ({ ...r, serverError: errorText(err) }));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [client, debounced, searchRoomId]);

  const scanner = searchRoomId ? historyScanner(client, searchRoomId) : null;
  const terms = useMemo(() => searchTerms(debounced), [debounced]);
  const hits = useMemo(
    () =>
      mergeHits(
        results.server,
        searchLoaded(client, terms, searchRoomId),
        scanner && terms.length ? scanner.search(terms) : [],
      ).slice(0, MAX_HITS),
    // scanVersion: the scanner is mutable; re-run when it grew.
    [client, terms, searchRoomId, results.server, results.scanVersion, scanner],
  );

  const loadMore = async () => {
    if (scanning) return;
    setScanning(true);
    try {
      const tasks: Promise<unknown>[] = [];
      if (results.nextBatch) {
        tasks.push(
          searchServer(client, debounced, { roomId: searchRoomId, nextBatch: results.nextBatch }).then((page) =>
            setResults((r) => ({ ...r, server: [...r.server, ...page.hits], nextBatch: page.nextBatch })),
          ),
        );
      }
      if (scanner && !scanner.done) tasks.push(scanner.step());
      await Promise.all(tasks);
    } catch (err) {
      setResults((r) => ({ ...r, serverError: errorText(err) }));
    } finally {
      setResults((r) => ({ ...r, scanVersion: r.scanVersion + 1 }));
      setScanning(false);
    }
  };

  const canLoadMore = !!debounced && (!!results.nextBatch || (!!scanner && !scanner.done));

  const setScope = (value: string) => {
    if (value === 'room' || value === 'all') setRightPanel({ kind: 'search', scope: value, query });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b pr-2 pl-4">
        <div className="min-w-0">
          <h2 className="text-[15px] leading-5 font-semibold">{t('search.title')}</h2>
          <div className="truncate text-xs leading-4 text-muted-foreground">
            {effectiveScope === 'room' && roomName ? roomName : t('search.allChats')}
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={() => setRightPanel(null)} aria-label={t('search.close')}>
          <X />
        </Button>
      </header>

      <div className="flex flex-col gap-2 border-b p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.stopPropagation();
                setQuery('');
              }
            }}
            placeholder={effectiveScope === 'room' ? t('search.placeholderRoom') : t('search.placeholderAll')}
            aria-label={t('search.title')}
            className="h-8 pl-8 text-[13px]"
          />
        </div>
        {roomId && (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={effectiveScope}
            onValueChange={setScope}
            className="w-full"
          >
            <ToggleGroupItem value="room" className="flex-1 text-[12px]">
              {t('search.thisChat')}
            </ToggleGroupItem>
            <ToggleGroupItem value="all" className="flex-1 text-[12px]">
              {t('search.allChats')}
            </ToggleGroupItem>
          </ToggleGroup>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!debounced ? (
          <Hint>{effectiveScope === 'room' ? t('search.hintRoom') : t('search.hintAll')}</Hint>
        ) : (
          <>
            {hits.length > 0 && (
              <ol className="py-1">
                {hits.map((hit) => (
                  <ResultRow key={hit.eventId} hit={hit} terms={terms} showRoom={effectiveScope === 'all'} />
                ))}
              </ol>
            )}
            {hits.length === 0 && !loading && !scanning && <Hint>{t('search.noResults')}</Hint>}
            {(loading || scanning) && (
              <div className="flex justify-center py-4 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
              </div>
            )}
            {results.serverError && (
              <p className="px-4 py-2 text-[12px] text-muted-foreground">
                {t('search.serverFailed', { error: results.serverError })}
              </p>
            )}
            {canLoadMore && !scanning && (
              <div className="flex flex-col items-center gap-1 px-4 py-3">
                <Button variant="outline" size="sm" onClick={() => void loadMore()}>
                  {t('search.searchMore')}
                </Button>
                {scanner?.oldestTs && (
                  <span className="text-[11px] text-muted-foreground">
                    {t('search.searchedUntil', { date: formatDayDivider(scanner.oldestTs) })}
                  </span>
                )}
              </div>
            )}
            {scanner?.done && <Hint>{t('search.wholeHistory')}</Hint>}
            {effectiveScope === 'all' && <Hint>{t('search.encryptedNote')}</Hint>}
          </>
        )}
      </div>
    </div>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="px-6 py-4 text-center text-[12px] text-muted-foreground">{children}</p>;
}

function ResultRow({ hit, terms, showRoom }: { hit: SearchHit; terms: string[]; showRoom: boolean }) {
  const client = useMatrixClient();
  const summary = useRooms((s) => s.rooms[hit.roomId]);
  const openRoom = useUi((s) => s.openRoom);
  const room = client.getRoom(hit.roomId);
  const name = room ? memberName(room, hit.sender) : hit.sender;
  const avatar = room?.getMember(hit.sender)?.getMxcAvatarUrl();

  return (
    <li>
      <button
        type="button"
        onClick={() => openRoom(hit.roomId, { eventId: hit.eventId })}
        className="flex w-full gap-2.5 px-4 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      >
        <MxAvatar mxc={avatar} name={name} seed={hit.sender} size={28} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            <span className="truncate text-[13px] font-semibold">{name}</span>
            {showRoom && summary && (
              <span className="truncate text-[12px] text-muted-foreground">· {summary.name}</span>
            )}
            <span
              className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums"
              title={`${formatDayDivider(hit.ts)} ${formatMessageTime(hit.ts)}`}
            >
              {formatListTime(hit.ts)}
            </span>
          </span>
          <span className="line-clamp-3 text-[13px] leading-snug break-words text-foreground/90">
            <Highlighted text={snippet(hit.text, terms)} terms={terms} />
          </span>
        </span>
      </button>
    </li>
  );
}

/** Cuts long messages to the part around the first match. */
function snippet(text: string, terms: string[]): string {
  const flat = text.replace(/\s+/g, ' ');
  if (flat.length <= SNIPPET_CONTEXT * 3) return flat;
  // normalize() keeps the length for Latin text (diacritics are stripped one code unit each).
  const n = normalize(flat);
  const first = Math.min(...terms.map((term) => n.indexOf(term)).filter((i) => i >= 0));
  if (!Number.isFinite(first) || first < SNIPPET_CONTEXT) return flat;
  return `…${flat.slice(first - SNIPPET_CONTEXT / 2)}`;
}

/** Marks every occurrence of the search terms, ignoring case and diacritics. */
function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  const parts = useMemo(() => {
    // Map each position of the normalized text back to the original string.
    const map: number[] = [];
    let n = '';
    for (let i = 0; i < text.length; i++) {
      const norm = normalize(text[i]);
      for (let k = 0; k < norm.length; k++) map.push(i);
      n += norm;
    }
    const marks = new Array<boolean>(text.length).fill(false);
    for (const term of terms) {
      let from = 0;
      for (let at = n.indexOf(term, from); at >= 0; at = n.indexOf(term, from)) {
        for (let k = at; k < at + term.length; k++) marks[map[k]] = true;
        from = at + term.length;
      }
    }
    const out: { text: string; mark: boolean }[] = [];
    for (let i = 0; i < text.length; i++) {
      const last = out.at(-1);
      if (last && last.mark === marks[i]) last.text += text[i];
      else out.push({ text: text[i], mark: marks[i] });
    }
    return out;
  }, [text, terms]);

  return (
    <>
      {parts.map((p, i) =>
        p.mark ? (
          <mark key={i} className="rounded-[3px] bg-yellow-200/80 px-px text-foreground dark:bg-yellow-500/35">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
