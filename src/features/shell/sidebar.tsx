import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, ChevronDown, ChevronRight, ListFilter, SquarePen } from 'lucide-react';
import { useCallback, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { NetworkIcon } from '@/components/mx-avatar';
import { ResizeHandle } from '@/components/resize-handle';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import { type NetworkSummary, type RoomSummary, useRooms } from '@/matrix/rooms-store';
import { useSettings } from '@/store/settings';
import { PANEL_WIDTHS, type View, useUi } from '@/store/ui';
import { buildSections, isRoomUnread, roomsForView } from './room-filters';
import { RoomRow } from './room-row';

type Item =
  | { type: 'header'; key: string; title: string; collapsed: boolean; unread: number }
  | { type: 'room'; key: string; room: RoomSummary };

function viewTitle(view: View, networks: NetworkSummary[], spaceName?: string): string {
  switch (view.kind) {
    case 'all':
      return t('shell.allChats');
    case 'matrix':
      return 'Matrix';
    case 'network':
      return networks.find((n) => n.id === view.networkId)?.name ?? view.networkId;
    case 'space':
      return spaceName ?? t('shell.space');
  }
}

export function Sidebar({ onNewChat }: { onNewChat: () => void }) {
  const { rooms, networks, spaces } = useRooms(
    useShallow((s) => ({ rooms: s.rooms, networks: s.networks, spaces: s.spaces })),
  );
  const ui = useUi(
    useShallow((s) => ({
      view: s.view,
      roomId: s.roomId,
      page: s.page,
      unreadOnly: s.unreadOnly,
      collapsed: s.collapsedSections,
      accountByNetwork: s.accountByNetwork,
      openRoom: s.openRoom,
      toggleSection: s.toggleSection,
      toggleUnreadOnly: s.toggleUnreadOnly,
      setAccount: s.setAccount,
    })),
  );
  const density = useSettings((s) => s.density);
  const sidebarWidth = useUi((s) => s.sidebarWidth);
  const setSidebarWidth = useUi((s) => s.setSidebarWidth);

  const network = ui.view.kind === 'network' ? networks.find((n) => n.id === (ui.view as { networkId: string }).networkId) : undefined;
  const accountId = network ? (ui.accountByNetwork[network.id] ?? null) : null;
  const spaceName = ui.view.kind === 'space' ? spaces.find((s) => s.roomId === (ui.view as { spaceId: string }).spaceId)?.name : undefined;

  const items = useMemo<Item[]>(() => {
    const sections = buildSections(roomsForView(rooms, ui.view, accountId), ui.unreadOnly);
    const out: Item[] = [];
    for (const section of sections) {
      const stored = ui.collapsed[section.key];
      const collapsed = stored ?? !!section.defaultCollapsed;
      out.push({
        type: 'header',
        key: `h:${section.key}`,
        title: section.title,
        collapsed,
        unread: section.rooms.filter(isRoomUnread).length,
      });
      if (collapsed) {
        // Collapsed sections still show unread chats and the open one, like Slack.
        for (const room of section.rooms) {
          if (isRoomUnread(room) || room.roomId === ui.roomId) out.push({ type: 'room', key: room.roomId, room });
        }
      } else {
        for (const room of section.rooms) out.push({ type: 'room', key: room.roomId, room });
      }
    }
    return out;
  }, [rooms, ui.view, accountId, ui.unreadOnly, ui.collapsed, ui.roomId]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const rowHeight = density === 'compact' ? 32 : 54;
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (items[i].type === 'header' ? 34 : rowHeight),
    getItemKey: (i) => items[i].key,
    overscan: 12,
  });

  const open = useCallback((roomId: string) => ui.openRoom(roomId), [ui.openRoom]);
  const showNetwork = ui.view.kind !== 'network';
  const accountName = network?.accounts.find((a) => a.id === accountId)?.name;

  return (
    <aside
      style={{ width: sidebarWidth }}
      className="relative flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
    >
      <ResizeHandle
        edge="right"
        width={sidebarWidth}
        min={PANEL_WIDTHS.sidebar.min}
        max={PANEL_WIDTHS.sidebar.max}
        onResize={setSidebarWidth}
        onReset={() => setSidebarWidth(PANEL_WIDTHS.sidebar.default)}
        label={t('shell.resizePanel')}
      />
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-sidebar-border pr-2 pl-3">
        {network && network.accounts.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="-ml-1 flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-sidebar-accent">
                <NetworkIcon networkId={network.id} avatarMxc={network.avatarMxc} size={18} />
                <span className="truncate text-[15px] font-bold text-foreground">
                  {network.name}
                  {accountName && <span className="font-normal text-muted-foreground"> · {accountName}</span>}
                </span>
                <ChevronDown className="size-3.5 shrink-0 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
              <DropdownMenuItem onSelect={() => ui.setAccount(network.id, null)}>
                {t('shell.allAccounts')}
                {!accountId && <Check className="ml-auto" />}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {network.accounts.map((a) => (
                <DropdownMenuItem key={a.id} onSelect={() => ui.setAccount(network.id, a.id)}>
                  {a.name}
                  {accountId === a.id && <Check className="ml-auto" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <h2 className="truncate text-[15px] font-bold text-foreground">{viewTitle(ui.view, networks, spaceName)}</h2>
        )}
        <div className="ml-auto flex items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn('size-8', ui.unreadOnly && 'bg-sidebar-accent text-foreground')}
                onClick={ui.toggleUnreadOnly}
                aria-pressed={ui.unreadOnly}
              >
                <ListFilter className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{ui.unreadOnly ? t('shell.showAll') : t('shell.unreadOnly')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" onClick={onNewChat}>
                <SquarePen className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('shell.newMessage')}</TooltipContent>
          </Tooltip>
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {items.length === 0 ? (
          <EmptyList unreadOnly={ui.unreadOnly} />
        ) : (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((v) => {
              const item = items[v.index];
              return (
                <div
                  key={v.key}
                  className="absolute top-0 left-0 w-full"
                  style={{ transform: `translateY(${v.start}px)`, height: v.size }}
                >
                  {item.type === 'header' ? (
                    <button
                      onClick={() => ui.toggleSection(item.key.slice(2))}
                      className="flex h-full w-full items-end gap-1 px-1 pb-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground"
                    >
                      {item.collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                      {item.title}
                      {item.collapsed && item.unread > 0 && (
                        <span className="ml-auto text-[11px] font-semibold text-foreground">{item.unread}</span>
                      )}
                    </button>
                  ) : (
                    <RoomRow
                      room={item.room}
                      selected={ui.page === 'chat' && item.room.roomId === ui.roomId}
                      density={density}
                      showNetwork={showNetwork}
                      onOpen={open}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

function EmptyList({ unreadOnly }: { unreadOnly: boolean }) {
  const toggle = useUi((s) => s.toggleUnreadOnly);
  return (
    <div className="flex flex-col items-center gap-2 px-6 pt-16 text-center text-sm text-muted-foreground">
      {unreadOnly ? (
        <>
          <p>{t('shell.allRead')}</p>
          <button className="text-primary hover:underline" onClick={toggle}>
            {t('shell.showAllChats')}
          </button>
        </>
      ) : (
        <p>{t('shell.noChats')}</p>
      )}
    </div>
  );
}
