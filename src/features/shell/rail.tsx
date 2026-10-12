import { Hash, Image, Inbox, Plug, Settings } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { MxAvatar, NetworkIcon } from '@/components/mx-avatar';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { NetworkIconDialog, type NetworkIconTarget } from '@/features/bridges/network-icon-dialog';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import { useRooms } from '@/matrix/rooms-store';
import { type View, useUi, viewKey } from '@/store/ui';
import { roomsForView, unreadTotals } from './room-filters';
import { UserMenu } from './user-menu';

export function Rail({ onLogout }: { onLogout: () => void }) {
  const { rooms, networks, spaces } = useRooms(
    useShallow((s) => ({ rooms: s.rooms, networks: s.networks, spaces: s.spaces })),
  );
  const { view, page, setView, setPage, openSettings } = useUi(
    useShallow((s) => ({
      view: s.view,
      page: s.page,
      setView: s.setView,
      setPage: s.setPage,
      openSettings: s.openSettings,
    })),
  );

  const totals = useMemo(() => {
    const map = new Map<string, ReturnType<typeof unreadTotals>>();
    const views: View[] = [
      { kind: 'all' },
      { kind: 'matrix' },
      ...networks.map((n) => ({ kind: 'network', networkId: n.id }) as View),
      ...spaces.map((s) => ({ kind: 'space', spaceId: s.roomId }) as View),
    ];
    for (const v of views) map.set(viewKey(v), unreadTotals(roomsForView(rooms, v, null)));
    return map;
  }, [rooms, networks, spaces]);

  const hasNativeRooms = useMemo(
    () => Object.values(rooms).some((r) => !r.bridge && !r.isBotRoom && r.spaceIds.length === 0),
    [rooms],
  );

  const active = page === 'chat' ? viewKey(view) : null;
  const [iconTarget, setIconTarget] = useState<NetworkIconTarget | null>(null);

  return (
    <nav className="flex w-[68px] shrink-0 flex-col items-center gap-1 bg-rail pt-2 pb-3 text-rail-foreground">
      <RailItem
        label={t('shell.allChats')}
        active={active === 'all'}
        totals={totals.get('all')}
        onClick={() => setView({ kind: 'all' })}
      >
        <Inbox className="size-5" />
      </RailItem>

      <div className="my-1 h-px w-8 bg-border" />

      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-x-hidden overflow-y-auto py-1 [scrollbar-width:none]">
        {networks.map((n) => (
          <RailItem
            key={n.id}
            label={n.name}
            active={active === `network:${n.id}`}
            totals={totals.get(`network:${n.id}`)}
            onClick={() => setView({ kind: 'network', networkId: n.id })}
            bare
            menu={
              <ContextMenuItem
                onSelect={() => setIconTarget({ networkId: n.id, name: n.name, avatarMxc: n.avatarMxc })}
              >
                <Image />
                {t('bridges.changeIcon')}
              </ContextMenuItem>
            }
          >
            <NetworkIcon networkId={n.id} avatarMxc={n.avatarMxc} name={n.name} size={40} className="rounded-xl" />
          </RailItem>
        ))}

        {hasNativeRooms && (
          <RailItem
            label="Matrix"
            active={active === 'matrix'}
            totals={totals.get('matrix')}
            onClick={() => setView({ kind: 'matrix' })}
          >
            <Hash className="size-5" />
          </RailItem>
        )}

        {spaces.length > 0 && <div className="my-1 h-px w-8 shrink-0 bg-border" />}
        {spaces.map((s) => (
          <RailItem
            key={s.roomId}
            label={s.name}
            active={active === `space:${s.roomId}`}
            totals={totals.get(`space:${s.roomId}`)}
            onClick={() => setView({ kind: 'space', spaceId: s.roomId })}
            bare
          >
            <MxAvatar mxc={s.avatarMxc} name={s.name} seed={s.roomId} size={40} shape="square" />
          </RailItem>
        ))}
      </div>

      <RailItem label={t('shell.linkedAccounts')} active={page === 'bridges'} onClick={() => setPage('bridges')}>
        <Plug className="size-5" />
      </RailItem>
      <RailItem label={t('shell.settings')} active={false} onClick={() => openSettings()}>
        <Settings className="size-5" />
      </RailItem>
      <UserMenu onLogout={onLogout} />
      <NetworkIconDialog target={iconTarget} onOpenChange={(open) => !open && setIconTarget(null)} />
    </nav>
  );
}

interface RailItemProps {
  label: string;
  active: boolean;
  onClick: () => void;
  totals?: { unread: boolean; highlight: number };
  /** Child is a full tile (image), not an icon that needs a tile background. */
  bare?: boolean;
  /** Right-click menu items. */
  menu?: ReactNode;
  children: ReactNode;
}

function RailItem({ label, active, onClick, totals, bare, menu, children }: RailItemProps) {
  const button = (
    <button
      onClick={onClick}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className="group relative flex h-11 w-full shrink-0 items-center justify-center"
    >
      {/* Slack/Discord-style indicator: dot when unread, bar when active. */}
      <span
        className={cn(
          'absolute left-0 w-1 rounded-r-full bg-foreground transition-all',
          active ? 'h-7' : totals?.unread ? 'h-2' : 'h-0',
        )}
      />
      <span
        className={cn(
          'relative flex size-10 items-center justify-center rounded-xl transition-colors',
          !bare && (active ? 'bg-background text-foreground shadow-sm' : 'group-hover:bg-background/60'),
          // Image tiles: the left bar marks the active one; the others are slightly dimmed.
          bare && 'transition-opacity',
          bare && !active && 'opacity-75 group-hover:opacity-100',
        )}
      >
        {children}
        {!!totals?.highlight && (
          <span className="absolute -right-1.5 -bottom-1 h-4 min-w-4 rounded-full bg-mention px-1 text-center text-[10px] leading-4 font-semibold text-mention-foreground tabular-nums ring-2 ring-rail">
            {totals.highlight > 99 ? '99+' : totals.highlight}
          </span>
        )}
      </span>
    </button>
  );
  const tooltip = (trigger: ReactNode) => (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
  if (!menu) return tooltip(button);
  return (
    <ContextMenu>
      {tooltip(<ContextMenuTrigger asChild>{button}</ContextMenuTrigger>)}
      <ContextMenuContent className="w-48">{menu}</ContextMenuContent>
    </ContextMenu>
  );
}
