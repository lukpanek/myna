import { KnownMembership, type MatrixEvent, type Room, type RoomMember, RoomEvent, RoomMemberEvent, RoomStateEvent } from 'matrix-js-sdk';
import { Bell, BellOff, BellRing, Info, Loader2, Upload } from 'lucide-react';
import { type DragEvent, useState } from 'react';
import { toast } from 'sonner';
import { MxAvatar } from '@/components/mx-avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Composer } from '@/features/composer/composer';
import { composerKey, useComposerStore } from '@/features/composer/composer-store';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import { useEmitterEvent, useMatrixClient } from '@/matrix/context';
import { useRerenderOn, useRoom, useRoomSummary } from '@/matrix/hooks';
import { NOTIFY_LEVELS, type NotifyLevel, notifyLevelLabel, setNotifyLevel } from '@/matrix/push-rules';
import { leaveRoom } from '@/matrix/room-actions';
import type { RoomSummary } from '@/matrix/rooms-store';
import { useRooms } from '@/matrix/rooms-store';
import { useUi } from '@/store/ui';
import { PinnedMessages } from './pinned-messages';
import { RoomDialogs } from './room-dialogs';
import { Timeline } from './timeline';
import { memberName } from './timeline-utils';

function errorText(err: unknown): string {
  return err instanceof Error && err.message ? err.message : String(err);
}

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes('Files');
}

export function RoomView({ roomId }: { roomId: string }) {
  const room = useRoom(roomId);
  const summary = useRoomSummary(roomId);
  useRerenderOn(room, RoomEvent.MyMembership);

  if (!room) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (room.getMyMembership() === KnownMembership.Invite) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <RoomHeader room={room} summary={summary} />
        <InvitePrompt room={room} summary={summary} />
      </div>
    );
  }

  return <JoinedRoom room={room} summary={summary} />;
}

function JoinedRoom({ room, summary }: { room: Room; summary: RoomSummary | undefined }) {
  const [dragging, setDragging] = useState(false);
  useRerenderOn(room.currentState, RoomStateEvent.Update);
  const canSend = room.maySendMessage();

  const onDragOver = (e: DragEvent) => {
    if (!canSend || !hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dragging) setDragging(true);
  };
  const onDragLeave = (e: DragEvent) => {
    // Only when the pointer leaves the whole view, not when it crosses child elements.
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
  };
  const onDrop = (e: DragEvent) => {
    setDragging(false);
    if (!canSend || !hasFiles(e)) return;
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length) useComposerStore.getState().addFiles(composerKey(room.roomId), files);
  };

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <RoomHeader room={room} summary={summary} />
      <Timeline room={room} />
      <TypingLine room={room} />
      {canSend ? (
        <Composer room={room} />
      ) : (
        <div className="mx-5 mb-4 rounded-lg border bg-muted/40 px-4 py-3 text-center text-[13px] text-muted-foreground">
          {t('room.noSendPermission')}
        </div>
      )}
      <RoomDialogs />

      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-40 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary bg-background/85 text-primary">
          <Upload className="size-7" />
          <span className="text-sm font-medium">{t('room.dropFiles', { name: summary?.name ?? room.name })}</span>
        </div>
      )}
    </div>
  );
}

const NOTIFY_ICONS: Record<NotifyLevel, typeof Bell> = {
  default: Bell,
  all: BellRing,
  mentions: Bell,
  mute: BellOff,
};

function RoomHeader({ room, summary }: { room: Room; summary: RoomSummary | undefined }) {
  const client = useMatrixClient();
  const networks = useRooms((s) => s.networks);
  const rightPanel = useUi((s) => s.rightPanel);
  const setRightPanel = useUi((s) => s.setRightPanel);
  useRerenderOn(room, RoomEvent.Name);

  const name = summary?.name ?? room.name;
  const bridge = summary?.bridge ?? null;
  const network = bridge ? networks.find((n) => n.id === bridge.networkId) : undefined;
  const account =
    network && network.accounts.length > 1 && summary?.accountId
      ? network.accounts.find((a) => a.id === summary.accountId)
      : undefined;
  const topic: string | undefined = room.currentState.getStateEvents('m.room.topic', '')?.getContent().topic;
  const memberCount = room.getJoinedMemberCount();
  const level = summary?.notifyLevel ?? 'default';
  const NotifyIcon = NOTIFY_ICONS[level];
  const detailsOpen = rightPanel?.kind === 'details';

  const subtitle = [
    bridge ? (account ? `${bridge.networkName} · ${account.name}` : bridge.networkName) : null,
    !summary?.isDm && memberCount > 0 ? t('room.memberCount', { count: memberCount }) : null,
    topic?.split('\n')[0] || null,
  ].filter(Boolean);

  const changeLevel = (value: string) => {
    setNotifyLevel(client, room.roomId, value as NotifyLevel).catch((err) =>
      toast.error(t('room.notifySaveFailed', { error: errorText(err) })),
    );
  };

  return (
    <header
      data-tauri-drag-region
      className="flex h-14 shrink-0 items-center gap-3 border-b px-5 [--avatar-ring:var(--background)]"
    >
      <MxAvatar
        mxc={summary?.avatarMxc ?? room.getMxcAvatarUrl()}
        name={name}
        seed={summary?.dmUserId ?? room.roomId}
        size={32}
        shape={summary?.isDm ? 'circle' : 'square'}
        network={bridge ? { id: bridge.networkId, avatarMxc: bridge.networkAvatar } : null}
      />
      <button
        type="button"
        onClick={() => setRightPanel(detailsOpen ? null : { kind: 'details' })}
        className="flex min-w-0 flex-col items-start text-left"
      >
        <span className="max-w-full truncate text-[15px] leading-5 font-semibold hover:underline">{name}</span>
        {subtitle.length > 0 && (
          <span className="max-w-full truncate text-xs leading-4 text-muted-foreground">{subtitle.join(' · ')}</span>
        )}
      </button>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <PinnedMessages room={room} />
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('room.notifications')}
                  className={cn(level === 'mute' && 'text-muted-foreground')}
                >
                  <NotifyIcon />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{t('room.notificationsTooltip', { level: notifyLevelLabel(level) })}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>{t('room.notificationsForChat')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={level} onValueChange={changeLevel}>
              {NOTIFY_LEVELS.map((l) => (
                <DropdownMenuRadioItem key={l} value={l}>
                  {notifyLevelLabel(l)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('room.details')}
              aria-pressed={detailsOpen}
              className={cn(detailsOpen && 'bg-accent')}
              onClick={() => setRightPanel(detailsOpen ? null : { kind: 'details' })}
            >
              <Info />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('room.details')}</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}

function InvitePrompt({ room, summary }: { room: Room; summary: RoomSummary | undefined }) {
  const client = useMatrixClient();
  const [busy, setBusy] = useState<'join' | 'decline' | null>(null);
  const me = client.getSafeUserId();
  const inviter = room.getMember(me)?.events.member?.getSender();
  const name = summary?.name ?? room.name;

  const join = async () => {
    setBusy('join');
    try {
      await client.joinRoom(room.roomId);
    } catch (err) {
      toast.error(t('room.acceptInviteFailed', { error: errorText(err) }));
    } finally {
      setBusy(null);
    }
  };
  const decline = async () => {
    setBusy('decline');
    try {
      await leaveRoom(client, room.roomId);
    } catch (err) {
      toast.error(t('room.declineInviteFailed', { error: errorText(err) }));
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <MxAvatar
        mxc={summary?.avatarMxc ?? room.getMxcAvatarUrl()}
        name={name}
        seed={summary?.dmUserId ?? room.roomId}
        size={64}
        shape={summary?.isDm ? 'circle' : 'square'}
      />
      <div>
        <div className="text-lg font-semibold">{name}</div>
        <div className="text-sm text-muted-foreground">
          {inviter && inviter !== me ? t('room.invitedBy', { name: memberName(room, inviter) }) : t('room.invited')}
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => void decline()} disabled={busy !== null}>
          {busy === 'decline' && <Loader2 className="animate-spin" />}
          {t('room.declineInvite')}
        </Button>
        <Button onClick={() => void join()} disabled={busy !== null}>
          {busy === 'join' && <Loader2 className="animate-spin" />}
          {t('room.acceptInvite')}
        </Button>
      </div>
    </div>
  );
}

function typingText(room: Room, members: RoomMember[]): string {
  const names = members.map((m) => m.name || memberName(room, m.userId));
  if (names.length === 1) return t('room.typingOne', { name: names[0] });
  if (names.length === 2) return t('room.typingTwo', { a: names[0], b: names[1] });
  if (names.length === 3) return t('room.typingThree', { a: names[0], b: names[1], c: names[2] });
  return t('room.typingMany', { count: names.length });
}

/** "X píše…" line between the timeline and the composer; keeps its height so nothing jumps. */
export function TypingLine({ room }: { room: Room }) {
  const client = useMatrixClient();
  const me = client.getSafeUserId();
  const [, bump] = useState(0);
  useEmitterEvent(client, RoomMemberEvent.Typing, (_event: MatrixEvent, member: RoomMember) => {
    if (member.roomId === room.roomId) bump((n) => n + 1);
  });
  const typing = room.getJoinedMembers().filter((m) => m.typing && m.userId !== me);
  return (
    <div className="h-5 shrink-0 truncate px-5 text-xs leading-5 text-muted-foreground" aria-live="polite">
      {typing.length > 0 && (
        <>
          <span className="mr-1.5 inline-flex gap-0.5 align-middle">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="size-1 animate-bounce rounded-full bg-muted-foreground"
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))}
          </span>
          {typingText(room, typing)}
        </>
      )}
    </div>
  );
}
