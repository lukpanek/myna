import { AlarmClock, BellOff, Star } from 'lucide-react';
import { memo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';
import { MxAvatar } from '@/components/mx-avatar';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { pickReminder, removeReminder, useReminders } from '@/features/later/reminders';
import { formatWhen } from '@/features/later/when';
import { t } from '@/i18n';
import { formatListTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useMatrixClient } from '@/matrix/context';
import { NOTIFY_LEVELS, type NotifyLevel, notifyLevelLabel, setNotifyLevel } from '@/matrix/push-rules';
import { leaveRoom, markRoomRead, markRoomUnread, roomPermalink, toggleRoomTag } from '@/matrix/room-actions';
import type { RoomSummary } from '@/matrix/rooms-store';
import { type ListDensity, useSettings } from '@/store/settings';
import { isRoomUnread } from './room-filters';

interface RoomRowProps {
  room: RoomSummary;
  selected: boolean;
  density: ListDensity;
  showNetwork: boolean;
  /** Time of the pending reminder for this chat. */
  reminderAt?: number;
  onOpen: (roomId: string) => void;
}

export const RoomRow = memo(function RoomRow({ room, selected, density, showNetwork, reminderAt, onOpen }: RoomRowProps) {
  const showRoomIcons = useSettings((s) => s.showRoomIcons);
  const unread = isRoomUnread(room);
  const muted = room.notifyLevel === 'mute';
  const badge = room.isDm ? room.unreadCount : room.highlightCount;
  const compact = density === 'compact';
  const network = showNetwork && room.bridge ? { id: room.bridge.networkId, avatarMxc: room.bridge.networkAvatar } : null;

  return (
    <RoomContextMenu room={room}>
      <button
        onClick={() => onOpen(room.roomId)}
        className={cn(
          'group flex w-full items-center gap-2.5 rounded-md px-2 text-left outline-none',
          'h-full',
          selected
            ? 'bg-sidebar-accent text-sidebar-accent-foreground [--avatar-ring:var(--sidebar-accent)]'
            : 'hover:bg-sidebar-accent/60 [--avatar-ring:var(--sidebar)] hover:[--avatar-ring:var(--sidebar-accent)]',
          muted && !selected && 'opacity-55',
        )}
      >
        {showRoomIcons && <MxAvatar
          mxc={room.avatarMxc}
          name={room.name}
          seed={room.dmUserId ?? room.roomId}
          size={compact ? 20 : 36}
          shape={room.isDm ? 'circle' : 'square'}
          network={compact ? null : network}
        />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={cn('truncate', unread && !muted ? 'font-semibold text-foreground' : 'font-normal')}>
              {room.name}
            </span>
            {room.favourite && !compact && <Star className="size-3 shrink-0 fill-current opacity-50" />}
            {muted && <BellOff className="size-3 shrink-0 opacity-60" />}
            {reminderAt !== undefined && (
              <span className="shrink-0 opacity-60" title={t('later.reminderAt', { when: formatWhen(reminderAt) })}>
                <AlarmClock className="size-3" />
              </span>
            )}
            {!compact && room.lastTs > 0 && (
              <span
                className={cn(
                  'ml-auto shrink-0 text-[11px] tabular-nums',
                  unread && !muted ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {formatListTime(room.lastTs)}
              </span>
            )}
            {compact && badge > 0 && <CountBadge count={badge} />}
          </div>
          {!compact && (
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  'truncate text-[0.867em]',
                  unread && !muted ? 'text-foreground/80' : 'text-muted-foreground',
                )}
              >
                {room.membership === 'invite'
                  ? t('shell.invite')
                  : room.preview
                    ? `${room.preview.own ? `${t('common.you')}: ` : !room.isDm ? `${room.preview.senderName}: ` : ''}${room.preview.text}`
                    : ' '}
              </span>
              {badge > 0 ? (
                <CountBadge count={badge} />
              ) : (
                unread && !muted && <span className="ml-auto size-2 shrink-0 rounded-full bg-primary" />
              )}
            </div>
          )}
        </div>
      </button>
    </RoomContextMenu>
  );
});

function CountBadge({ count }: { count: number }) {
  return (
    <span className="ml-auto min-w-[18px] shrink-0 rounded-full bg-mention px-1.5 text-center text-[11px] leading-[18px] font-semibold text-mention-foreground">
      {count > 99 ? '99+' : count}
    </span>
  );
}

function RoomContextMenu({ room, children }: { room: RoomSummary; children: React.ReactNode }) {
  const client = useMatrixClient();
  const sdkRoom = () => client.getRoom(room.roomId);
  const run = (fn: () => Promise<unknown>, error: string) => fn().catch(() => toast.error(error));

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {isRoomUnread(room) ? (
          <ContextMenuItem onSelect={() => run(() => markRoomRead(client, sdkRoom()!), t('shell.markFailed'))}>
            {t('shell.markRead')}
          </ContextMenuItem>
        ) : (
          <ContextMenuItem onSelect={() => run(() => markRoomUnread(client, sdkRoom()!), t('shell.markFailed'))}>
            {t('shell.markUnread')}
          </ContextMenuItem>
        )}
        <ContextMenuItem
          onSelect={() => run(() => toggleRoomTag(client, sdkRoom()!, 'm.favourite'), t('shell.saveFailed'))}
        >
          {room.favourite ? t('shell.removeFavourite') : t('shell.addFavourite')}
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => run(() => toggleRoomTag(client, sdkRoom()!, 'm.lowpriority'), t('shell.saveFailed'))}
        >
          {room.lowPriority ? t('shell.removeLowPriority') : t('shell.sectionLowPriority')}
        </ContextMenuItem>
        {room.membership === 'join' && <ReminderItems roomId={room.roomId} />}
        <ContextMenuSub>
          <ContextMenuSubTrigger>{t('shell.notifications')}</ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-48">
            <ContextMenuRadioGroup
              value={room.notifyLevel}
              onValueChange={(v) =>
                run(() => setNotifyLevel(client, room.roomId, v as NotifyLevel), t('shell.settingSaveFailed'))
              }
            >
              {NOTIFY_LEVELS.map((level) => (
                <ContextMenuRadioItem key={level} value={level}>
                  {notifyLevelLabel(level)}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => {
            void navigator.clipboard.writeText(roomPermalink(room.roomId));
            toast.success(t('common.linkCopied'));
          }}
        >
          {t('shell.copyLink')}
        </ContextMenuItem>
        <ContextMenuItem
          variant="destructive"
          onSelect={() => run(() => leaveRoom(client, room.roomId), t('shell.leaveFailed'))}
        >
          {room.membership === 'invite' ? t('shell.declineInvite') : t('shell.leaveChat')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Rendered only while the menu is open, so rows do not subscribe to reminders. */
function ReminderItems({ roomId }: { roomId: string }) {
  const client = useMatrixClient();
  const reminders = useReminders(useShallow((s) => s.reminders.filter((r) => r.roomId === roomId)));
  return (
    <>
      <ContextMenuItem onSelect={() => pickReminder(roomId)}>{t('later.remindLater')}</ContextMenuItem>
      {reminders.map((r) => (
        <ContextMenuItem
          key={r.id}
          onSelect={() => void removeReminder(client, r.id).catch(() => toast.error(t('later.reminderSaveFailed')))}
        >
          {t('later.cancelReminder', { when: formatWhen(r.at) })}
        </ContextMenuItem>
      ))}
    </>
  );
}
