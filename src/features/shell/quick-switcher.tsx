import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { MxAvatar } from '@/components/mx-avatar';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { t } from '@/i18n';
import { modKey } from '@/lib/platform';
import { useRooms } from '@/matrix/rooms-store';
import { useSettings } from '@/store/settings';
import { openSearch, useUi } from '@/store/ui';
import { isRoomUnread } from './room-filters';

/** ⌘K: jump to any chat across all networks. Unread chats first, then by recency. */
export function QuickSwitcher() {
  const showRoomIcons = useSettings((s) => s.showRoomIcons);
  const open = useUi((s) => s.switcherOpen);
  const setOpen = useUi((s) => s.setSwitcherOpen);
  const openRoom = useUi((s) => s.openRoom);
  const rooms = useRooms((s) => s.rooms);
  const [query, setQuery] = useState('');

  const list = useMemo(
    () =>
      Object.values(rooms)
        .filter((r) => !r.isBotRoom)
        .sort((a, b) => Number(isRoomUnread(b)) - Number(isRoomUnread(a)) || b.lastTs - a.lastTs),
    [rooms],
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) setQuery('');
      }} 
      title={t('shell.switcherTitle')}
      description={t('shell.switcherDescription')}
    >
      <CommandInput placeholder={t('shell.switcherPlaceholder')} value={query} onValueChange={setQuery} />
      <CommandList className="max-h-[420px]">
        {!query.trim() && <CommandEmpty>{t('shell.nothingFound')}</CommandEmpty>}
        <CommandGroup>
          {list.slice(0, 400).map((r) => (
            <CommandItem
              key={r.roomId}
              value={`${r.name} ${r.bridge?.networkName ?? ''} ${r.roomId}`}
              onSelect={() => {
                setOpen(false);
                openRoom(r.roomId);
              }}
              className="gap-2.5"
            >
              {showRoomIcons && <MxAvatar
                mxc={r.avatarMxc}
                name={r.name}
                seed={r.dmUserId ?? r.roomId}
                size={24}
                shape={r.isDm ? 'circle' : 'square'}
                network={r.bridge ? { id: r.bridge.networkId, avatarMxc: r.bridge.networkAvatar } : null}
                className="[--avatar-ring:var(--popover)]"
              />}
              <span className={isRoomUnread(r) ? 'font-semibold' : undefined}>{r.name}</span>
              {r.bridge && <span className="ml-auto text-xs text-muted-foreground">{r.bridge.networkName}</span>}
            </CommandItem>
          ))}
        </CommandGroup>
        {query.trim() && (
          <CommandGroup forceMount>
            <CommandItem
              forceMount
              value={`__search__ ${query}`}
              onSelect={() => {
                setOpen(false);
                setQuery('');
                openSearch('all', query.trim());
              }}
              className="gap-2.5"
            >
              <Search className="size-4 text-muted-foreground" />
              <span className="truncate">{t('shell.searchMessagesFor', { query: query.trim() })}</span>
              <kbd className="ml-auto font-sans text-[11px] text-muted-foreground">{modKey}⇧F</kbd>
            </CommandItem>
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
