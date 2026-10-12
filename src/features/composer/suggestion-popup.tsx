import type { PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { exitSuggestion } from '@tiptap/suggestion';
import { AtSign } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MxAvatar } from '@/components/mx-avatar';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import type { EmojiItem } from '@/features/emoji/emoji-data';

export type SuggestionEntry =
  | { kind: 'member'; userId: string; name: string; avatarMxc: string | null }
  | { kind: 'room' }
  | { kind: 'emoji'; emoji: EmojiItem };

/** What the TipTap suggestion plugin hands to React: the mounted element plus items. */
export interface SuggestionView {
  el: HTMLElement;
  items: SuggestionEntry[];
  command: (entry: SuggestionEntry) => void;
  pluginKey: PluginKey;
}

export type SuggestionSink = (view: SuggestionView | null) => void;

/**
 * State for the @mention / :emoji: popup. The editor's keydown handler calls
 * `handleKey` synchronously, so the current view and selection live in refs too.
 */
export function useSuggestionPopup() {
  const [view, setViewState] = useState<SuggestionView | null>(null);
  const [active, setActiveState] = useState(0);
  const viewRef = useRef<SuggestionView | null>(null);
  const activeRef = useRef(0);

  const setActive = useCallback((i: number) => {
    activeRef.current = i;
    setActiveState(i);
  }, []);

  const setView = useCallback<SuggestionSink>(
    (v) => {
      viewRef.current = v;
      setViewState(v);
      setActive(0);
    },
    [setActive],
  );

  const isOpen = () => !!viewRef.current && viewRef.current.items.length > 0;

  const handleKey = (event: KeyboardEvent, editorView: EditorView): boolean => {
    const v = viewRef.current;
    if (!v || v.items.length === 0) return false;
    const n = v.items.length;
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
    switch (event.key) {
      case 'ArrowDown':
        setActive((activeRef.current + 1) % n);
        return true;
      case 'ArrowUp':
        setActive((activeRef.current - 1 + n) % n);
        return true;
      case 'Enter':
      case 'Tab':
        if (!plain) return false;
        v.command(v.items[Math.min(activeRef.current, n - 1)]);
        return true;
      case 'Escape':
        exitSuggestion(editorView, v.pluginKey);
        return true;
      default:
        return false;
    }
  };

  return { view, active, setActive, setView, handleKey, isOpen };
}

export function SuggestionPopup({
  view,
  active,
  onHover,
}: {
  view: SuggestionView | null;
  active: number;
  onHover: (i: number) => void;
}) {
  if (!view || view.items.length === 0) return null;
  return createPortal(
    <div
      role="listbox"
      className="w-80 overflow-hidden rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md"
    >
      {view.items.map((entry, i) => (
        <div
          key={entryKey(entry)}
          role="option"
          aria-selected={i === active}
          // mousedown would blur the editor and dismiss the suggestion before click lands.
          onMouseDown={(e) => {
            e.preventDefault();
            view.command(entry);
          }}
          onMouseMove={() => i !== active && onHover(i)}
          className={cn(
            'flex h-8 cursor-pointer items-center gap-2 rounded-md px-2',
            i === active && 'bg-accent text-accent-foreground',
          )}
        >
          <EntryRow entry={entry} />
        </div>
      ))}
    </div>,
    view.el,
  );
}

function entryKey(entry: SuggestionEntry): string {
  if (entry.kind === 'member') return entry.userId;
  if (entry.kind === 'room') return '@room';
  return entry.emoji.unicode;
}

function EntryRow({ entry }: { entry: SuggestionEntry }) {
  if (entry.kind === 'member') {
    return (
      <>
        <MxAvatar mxc={entry.avatarMxc} name={entry.name} seed={entry.userId} size={20} />
        <span className="truncate font-medium">{entry.name}</span>
        <span className="truncate text-xs text-muted-foreground">{entry.userId}</span>
      </>
    );
  }
  if (entry.kind === 'room') {
    return (
      <>
        <span className="flex size-5 shrink-0 items-center justify-center rounded bg-muted">
          <AtSign className="size-3.5" />
        </span>
        <span className="font-medium">@room</span>
        <span className="truncate text-xs text-muted-foreground">{t('composer.notifyRoom')}</span>
      </>
    );
  }
  return (
    <>
      <span className="w-5 shrink-0 text-center text-lg leading-none">{entry.emoji.unicode}</span>
      <span className="truncate font-mono text-xs">:{entry.emoji.shortcodes[0] ?? entry.emoji.label}:</span>
      <span className="truncate text-xs text-muted-foreground">{entry.emoji.label}</span>
    </>
  );
}
