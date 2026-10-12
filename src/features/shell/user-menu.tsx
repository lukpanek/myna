import { BellOff, LogOut, UserRound } from 'lucide-react';
import { UserEvent } from 'matrix-js-sdk';
import { useState } from 'react';
import { MxAvatar } from '@/components/mx-avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { t } from '@/i18n';
import { dayjs } from '@/lib/time';
import { useEmitterEvent, useMatrixClient } from '@/matrix/context';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

function pauseOptions(): { label: string; until: number }[] {
  const now = dayjs();
  return [
    { label: t('shell.pauseMinutes', { count: 30 }), until: now.add(30, 'minute').valueOf() },
    { label: t('shell.pauseHours', { count: 1 }), until: now.add(1, 'hour').valueOf() },
    { label: t('shell.pauseHours', { count: 2 }), until: now.add(2, 'hour').valueOf() },
    { label: t('shell.pauseUntilTomorrow'), until: now.add(1, 'day').hour(8).minute(0).second(0).valueOf() },
    { label: t('shell.pauseUntilMonday'), until: now.day(8).hour(8).minute(0).second(0).valueOf() },
  ];
}

export function UserMenu({ onLogout }: { onLogout: () => void }) {
  const client = useMatrixClient();
  const me = client.getUser(client.getSafeUserId());
  const [, rerender] = useState(0);
  useEmitterEvent(me, UserEvent.DisplayName, () => rerender((n) => n + 1));
  useEmitterEvent(me, UserEvent.AvatarUrl, () => rerender((n) => n + 1));

  const pausedUntil = useSettings((s) => s.notifications.pausedUntil);
  const setNotifications = useSettings((s) => s.setNotifications);
  const openSettings = useUi((s) => s.openSettings);
  const paused = !!pausedUntil && pausedUntil > Date.now();
  const name = me?.displayName || client.getSafeUserId();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="relative mt-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <MxAvatar mxc={me?.avatarUrl} name={name} seed={client.getSafeUserId()} size={34} shape="square" />
          {paused && (
            <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-rail">
              <BellOff className="size-3" />
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="w-64">
        <DropdownMenuLabel className="flex items-center gap-2">
          <MxAvatar mxc={me?.avatarUrl} name={name} seed={client.getSafeUserId()} size={32} shape="square" />
          <div className="min-w-0">
            <div className="truncate font-semibold">{name}</div>
            <div className="truncate text-xs font-normal text-muted-foreground">{client.getSafeUserId()}</div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <BellOff />
            {paused
              ? t('shell.pausedUntil', { time: dayjs(pausedUntil).format(`${t('time.dateFormat')} ${t('time.timeFormat')}`) })
              : t('shell.pauseNotifications')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {pauseOptions().map((o) => (
              <DropdownMenuItem key={o.label} onSelect={() => setNotifications({ pausedUntil: o.until })}>
                {o.label}
              </DropdownMenuItem>
            ))}
            {paused && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setNotifications({ pausedUntil: null })}>
                  {t('shell.resumeNotifications')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onSelect={() => openSettings('account')}>
          <UserRound />
          {t('shell.profileAndAccount')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onLogout}>
          <LogOut />
          {t('app.logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
