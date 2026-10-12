import { useMemo } from 'react';
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
import { useRooms } from '@/matrix/rooms-store';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { isRoomUnread } from './room-filters';

/** ⌘K: jump to any chat across all networks. Unread chats first, then by recency. */
export function QuickSwitcher() {
  const showRoomIcons = useSettings((s) => s.showRoomIcons);
  const open = useUi((s) => s.switcherOpen);
  const setOpen = useUi((s) => s.setSwitcherOpen);
  const openRoom = useUi((s) => s.openRoom);
  const rooms = useRooms((s) => s.rooms);

  const list = useMemo(
    () =>
      Object.values(rooms)
        .filter((r) => !r.isBotRoom)
        .sort((a, b) => Number(isRoomUnread(b)) - Number(isRoomUnread(a)) || b.lastTs - a.lastTs),
    [rooms],
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title={t('shell.switcherTitle')} description={t('shell.switcherDescription')}>
      <CommandInput placeholder={t('shell.switcherPlaceholder')} />
      <CommandList className="max-h-[420px]">
        <CommandEmpty>{t('shell.nothingFound')}</CommandEmpty>
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
      </CommandList>
    </CommandDialog>
  );
}
