import {
  Clock,
  FaceSlightlySmiling,
  Flag,
  Hand,
  Lamp,
  PawPrint,
  Pizza,
  Plane,
  Search,
  Shapes,
  Volleyball,
  type LucideIcon,
} from 'lucide-react';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { viewOf } from '@/features/popout/popout-scope';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import { useSettings } from '@/store/settings';
import {
  EMOJI_GROUPS,
  type EmojiData,
  type EmojiItem,
  loadEmojiData,
  getEmojiData,
  normalizeEmoji,
  searchEmojiSync,
} from './emoji-data';

const COLS = 10;
const RECENT_KEY = -1;
const RESULTS_KEY = -2;

const GROUP_ICONS: Record<number, LucideIcon> = {
  [RECENT_KEY]: Clock,
  0: FaceSlightlySmiling,
  1: Hand,
  3: PawPrint,
  4: Pizza,
  5: Plane,
  6: Volleyball,
  7: Lamp,
  8: Shapes,
  9: Flag,
};

interface Section {
  key: number;
  label: string;
  items: EmojiItem[];
}

function recentItem(data: EmojiData | null, emoji: string): EmojiItem {
  const unicode = normalizeEmoji(emoji);
  return (
    data?.byUnicode.get(unicode) ?? {
      unicode,
      label: '',
      shortcodes: [],
      group: -1,
      order: 0,
      primary: [],
      secondary: [],
      haystack: '',
    }
  );
}

/** Slack-like emoji panel: search, category tabs, recent emoji, keyboard navigation. */
export function EmojiPicker({ onPick, className }: { onPick: (emoji: string) => void; className?: string }) {
  const recent = useSettings((s) => s.recentEmoji);
  const pushRecentEmoji = useSettings((s) => s.pushRecentEmoji);
  const [data, setData] = useState<EmojiData | null>(getEmojiData);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [hovered, setHovered] = useState<EmojiItem | null>(null);
  const [visibleSection, setVisibleSection] = useState(RECENT_KEY);
  const scrollRef = useRef<HTMLDivElement>(null);
  const navigatedRef = useRef(false);

  useEffect(() => {
    if (data) return;
    let alive = true;
    loadEmojiData()
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [data]);

  const sections = useMemo<Section[]>(() => {
    if (query.trim()) {
      return data ? [{ key: RESULTS_KEY, label: t('emoji.results'), items: searchEmojiSync(data, query, 200) }] : [];
    }
    const out: Section[] = [{ key: RECENT_KEY, label: t('emoji.recent'), items: recent.map((e) => recentItem(data, e)) }];
    if (data) {
      for (const g of EMOJI_GROUPS) out.push({ key: g.id, label: t(`emoji.${g.labelKey}`), items: data.byGroup.get(g.id) ?? [] });
    }
    return out;
  }, [data, query, recent]);

  // Flat index space for keyboard navigation, laid out in rows per section.
  const { flat, rows, rowOf, offsets } = useMemo(() => {
    const flat: EmojiItem[] = [];
    const rows: { start: number; end: number }[] = [];
    const rowOf: number[] = [];
    const offsets: number[] = [];
    for (const s of sections) {
      offsets.push(flat.length);
      for (let i = 0; i < s.items.length; i += COLS) {
        const start = flat.length + i;
        const end = flat.length + Math.min(i + COLS, s.items.length);
        for (let j = start; j < end; j++) rowOf[j] = rows.length;
        rows.push({ start, end });
      }
      flat.push(...s.items);
    }
    return { flat, rows, rowOf, offsets };
  }, [sections]);

  useEffect(() => {
    navigatedRef.current = false;
    setActive(query.trim() ? 0 : -1);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [query]);

  useEffect(() => {
    if (active < 0) return;
    scrollRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (item: EmojiItem) => {
    pushRecentEmoji(item.unicode);
    onPick(item.unicode);
  };

  const move = (delta: 'left' | 'right' | 'up' | 'down') => {
    if (flat.length === 0) return;
    navigatedRef.current = true;
    setActive((cur) => {
      if (cur < 0) return 0;
      if (delta === 'left') return Math.max(0, cur - 1);
      if (delta === 'right') return Math.min(flat.length - 1, cur + 1);
      const row = rowOf[cur];
      const col = cur - rows[row].start;
      const target = rows[row + (delta === 'down' ? 1 : -1)];
      if (!target) return cur;
      return Math.min(target.start + col, target.end - 1);
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const horizontal = navigatedRef.current || !query;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move('down');
        break;
      case 'ArrowUp':
        e.preventDefault();
        move('up');
        break;
      case 'ArrowLeft':
        if (!horizontal || active < 0) return;
        e.preventDefault();
        move('left');
        break;
      case 'ArrowRight':
        if (!horizontal) return;
        e.preventDefault();
        move('right');
        break;
      case 'Enter': {
        const item = flat[active];
        if (!item) return;
        e.preventDefault();
        pick(item);
        break;
      }
    }
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || query) return;
    let current = sections[0]?.key ?? RECENT_KEY;
    for (const header of el.querySelectorAll<HTMLElement>('[data-section]')) {
      if (header.offsetTop <= el.scrollTop + 8) current = Number(header.dataset.section);
    }
    setVisibleSection(current);
  };

  const jumpTo = (key: number) => {
    setQuery('');
    viewOf(scrollRef.current).requestAnimationFrame(() => {
      const el = scrollRef.current;
      const header = el?.querySelector<HTMLElement>(`[data-section="${key}"]`);
      if (el && header) el.scrollTo({ top: header.offsetTop });
      setVisibleSection(key);
    });
  };

  const footer = hovered ?? flat[active] ?? null;

  return (
    <div className={cn('flex h-[400px] w-[340px] flex-col text-sm', className)}>
      <div className="p-2 pb-1">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('emoji.search')}
            className="h-8 w-full rounded-md border border-input bg-background pr-2 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          />
        </div>
      </div>

      <div className="flex items-center gap-0.5 border-b px-2 pb-1">
        {[RECENT_KEY, ...EMOJI_GROUPS.map((g) => g.id)].map((key) => {
          const Icon = GROUP_ICONS[key];
          const group = EMOJI_GROUPS.find((g) => g.id === key);
          const label = group ? t(`emoji.${group.labelKey}`) : t('emoji.recent');
          const selected = !query && visibleSection === key;
          return (
            <button
              key={key}
              type="button"
              title={label}
              aria-label={label}
              disabled={key !== RECENT_KEY && !data}
              onClick={() => jumpTo(key)}
              className={cn(
                'flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40',
                selected && 'bg-accent text-foreground',
              )}
            >
              <Icon className="size-4" />
            </button>
          );
        })}
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        onMouseLeave={() => setHovered(null)}
        className="relative min-h-0 flex-1 overflow-y-auto px-1.5 pb-2"
      >
        {sections.map((section, si) => (
          <div
            key={section.key}
            data-section={section.key}
            style={
              section.key >= 0
                ? { contentVisibility: 'auto', containIntrinsicSize: `auto ${Math.ceil(section.items.length / COLS) * 32 + 28}px` }
                : undefined
            }
          >
            <div className="sticky top-0 z-10 bg-popover px-1 pt-2 pb-1 text-xs font-medium text-muted-foreground"
            >
              {section.label}
            </div>
            {section.items.length === 0 ? (
              <div className="px-1 py-6 text-center text-muted-foreground">
                {section.key === RESULTS_KEY ? t('emoji.noResults') : ''}
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(10,2rem)]">
                {section.items.map((item, i) => {
                  const idx = offsets[si] + i;
                  return (
                    <button
                      key={`${item.unicode}-${i}`}
                      type="button"
                      data-idx={idx}
                      tabIndex={-1}
                      aria-label={item.label || item.unicode}
                      onMouseEnter={() => setHovered(item)}
                      onClick={() => pick(item)}
                      className={cn(
                        'flex size-8 items-center justify-center rounded-md text-[22px] leading-none hover:bg-accent',
                        idx === active && 'bg-accent ring-1 ring-ring/40',
                      )}
                    >
                      {item.unicode}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
        {!data && !query && (
          <div className="py-6 text-center text-muted-foreground">
            {failed ? t('emoji.loadFailed') : t('emoji.loading')}
          </div>
        )}
      </div>

      <div className="flex h-11 shrink-0 items-center gap-2 border-t px-3">
        {footer ? (
          <>
            <span className="text-2xl leading-none">{footer.unicode}</span>
            <div className="min-w-0">
              <div className="truncate text-xs font-medium">{footer.label || footer.unicode}</div>
              {footer.shortcodes[0] && (
                <div className="truncate font-mono text-[11px] text-muted-foreground">:{footer.shortcodes[0]}:</div>
              )}
            </div>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">{t('emoji.pickPrompt')}</span>
        )}
      </div>
    </div>
  );
}
