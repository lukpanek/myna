import {
  Bell,
  BellOff,
  Copy,
  ExternalLink,
  Lock,
  LockOpen,
  LogOut,
  Mail,
  MailOpen,
  Pencil,
  Star,
  UserPlus,
  X,
} from 'lucide-react';
import { RoomStateEvent } from 'matrix-js-sdk';
import { type ComponentProps, type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { MxAvatar, NetworkIcon } from '@/components/mx-avatar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { t } from '@/i18n';
import { openExternal } from '@/lib/native';
import { cn } from '@/lib/utils';
import { useMatrixClient } from '@/matrix/context';
import { useRerenderOn, useRoom, useRoomSummary } from '@/matrix/hooks';
import { type NotifyLevel, notifyLevelLabel, setNotifyLevel } from '@/matrix/push-rules';
import { leaveRoom, markRoomRead, markRoomUnread, toggleRoomTag } from '@/matrix/room-actions';
import { useRooms } from '@/matrix/rooms-store';
import { useUi } from '@/store/ui';
import { MembersList } from './members-list';
import { InviteDialog, RoomSettingsDialog, roomPermissions } from './room-settings-dialog';
import { FileList, MediaGrid } from './room-media';

const NOTIFY_LEVELS: NotifyLevel[] = ['default', 'all', 'mentions', 'mute'];

/** `external_url` of the portal, straight from the raw `m.bridge` state (not part of BridgeInfo). */
function bridgeExternalUrl(room: ReturnType<typeof useRoom>): string | undefined {
  if (!room) return undefined;
  for (const type of ['m.bridge', 'uk.half-shot.bridge']) {
    for (const event of room.currentState.getStateEvents(type)) {
      const c = event.getContent();
      const url = c.channel?.external_url ?? c.network?.external_url;
      if (typeof url === 'string' && /^https?:\/\//i.test(url)) return url;
    }
  }
  return undefined;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Slack-style "channel details" for the open chat. */
export function DetailsPanel({ roomId }: { roomId: string }) {
  const client = useMatrixClient();
  const room = useRoom(roomId);
  const summary = useRoomSummary(roomId);
  const networks = useRooms((s) => s.networks);
  const setRightPanel = useUi((s) => s.setRightPanel);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [tab, setTab] = useState('members');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  useRerenderOn(room?.currentState, RoomStateEvent.Update);

  const header = (
    <header className="flex h-14 shrink-0 items-center justify-between border-b pr-2 pl-4">
      <h2 className="text-[15px] font-semibold">{t('details.title')}</h2>
      <Button variant="ghost" size="icon-sm" onClick={() => setRightPanel(null)} aria-label={t('details.closeDetails')}>
        <X />
      </Button>
    </header>
  );

  if (!room || !summary) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {header}
        <p className="p-6 text-center text-[13px] text-muted-foreground">{t('details.chatUnavailable')}</p>
      </div>
    );
  }

  const bridge = summary.bridge;
  const network = bridge ? networks.find((n) => n.id === bridge.networkId) : undefined;
  const account =
    summary.accountId && network ? network.accounts.find((a) => a.id === summary.accountId) : undefined;
  const topic: string | undefined = room.currentState.getStateEvents('m.room.topic', '')?.getContent().topic;
  const externalUrl = bridge ? bridgeExternalUrl(room) : undefined;
  const encrypted = room.hasEncryptionStateEvent();
  const memberCount = room.getJoinedMemberCount();

  const run = (fn: () => Promise<unknown>, error: string) =>
    fn().catch((err) => toast.error(`${error} ${errorText(err)}`));

  const leave = async () => {
    setConfirmLeave(false);
    try {
      await leaveRoom(client, roomId);
      setRightPanel(null);
      toast.success(t('details.leftChat', { name: summary.name }));
    } catch (err) {
      toast.error(t('details.leaveFailed', { error: errorText(err) }));
    }
  };

  const copyRoomId = () => {
    navigator.clipboard
      .writeText(roomId)
      .then(() => toast.success(t('details.roomIdCopied')))
      .catch(() => toast.error(t('common.copyFailed')));
  };

  const muted = summary.notifyLevel === 'mute';
  const can = roomPermissions(client, room);
  // DM names and pictures come from the other person, not from room state.
  const canEdit = !summary.isDm && (can.name || can.topic || can.avatar);
  // Bridged portals mirror the remote group; inviting Matrix users there makes no sense.
  const canInvite = !summary.isDm && !bridge && can.invite;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <div ref={setScrollEl} className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col items-center px-5 pt-6 pb-4 text-center">
          <MxAvatar
            mxc={summary.avatarMxc}
            name={summary.name}
            seed={summary.dmUserId ?? roomId}
            size={72}
            shape={summary.isDm ? 'circle' : 'square'}
          />
          <h3 className="mt-3 max-w-full text-lg leading-tight font-semibold break-words">{summary.name}</h3>
          {bridge && (
            <span className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[12px] text-muted-foreground">
              <NetworkIcon networkId={bridge.networkId} avatarMxc={bridge.networkAvatar} name={bridge.networkName} size={14} />
              <span className="truncate">
                {bridge.networkName}
                {account && ` · ${account.name}`}
              </span>
            </span>
          )}
          {topic && (
            <p className="mt-2 line-clamp-5 text-[13px] whitespace-pre-wrap text-muted-foreground select-text">{topic}</p>
          )}
          {(canEdit || canInvite) && (
            <div className="mt-3 flex gap-2">
              {canEdit && (
                <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                  <Pencil />
                  {t('details.edit')}
                </Button>
              )}
              {canInvite && (
                <Button size="sm" variant="outline" onClick={() => setInviteOpen(true)}>
                  <UserPlus />
                  {t('details.invitePeople')}
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-4 gap-2 px-4 pb-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <ActionButton icon={muted ? BellOff : Bell} label={t('details.notifications')} active={summary.notifyLevel !== 'default'} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              <DropdownMenuLabel className="text-[12px] font-normal text-muted-foreground">
                {t('details.notificationsForChat')}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={summary.notifyLevel}
                onValueChange={(v) =>
                  run(() => setNotifyLevel(client, roomId, v as NotifyLevel), t('details.settingsSaveFailed'))
                }
              >
                {NOTIFY_LEVELS.map((level) => (
                  <DropdownMenuRadioItem key={level} value={level}>
                    {notifyLevelLabel(level)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <ActionButton
            icon={Star}
            label={t('details.favourite')}
            active={summary.favourite}
            iconClassName={summary.favourite ? 'fill-current' : undefined}
            onClick={() => run(() => toggleRoomTag(client, room, 'm.favourite'), t('details.saveFailed'))}
          />
          {summary.isUnread ? (
            <ActionButton
              icon={MailOpen}
              label={t('details.markRead')}
              onClick={() => run(() => markRoomRead(client, room), t('details.markFailed'))}
            />
          ) : (
            <ActionButton
              icon={Mail}
              label={t('details.markUnread')}
              onClick={() => run(() => markRoomUnread(client, room), t('details.markFailed'))}
            />
          )}
          <ActionButton icon={LogOut} label={t('details.leave')} destructive onClick={() => setConfirmLeave(true)} />
        </div>

        <section className="border-t px-4 py-3">
          <h4 className="mb-1 text-sm font-semibold">{t('details.about')}</h4>
          {bridge ? (
            <>
              <InfoRow label={t('details.network')}>
                <span className="inline-flex items-center gap-1.5">
                  <NetworkIcon networkId={bridge.networkId} avatarMxc={bridge.networkAvatar} name={bridge.networkName} size={14} />
                  {bridge.networkName}
                  {bridge.group && <span className="text-muted-foreground">· {bridge.group.name}</span>}
                </span>
              </InfoRow>
              {account && <InfoRow label={t('details.account')}>{account.name}</InfoRow>}
              {bridge.bridgeBot && (
                <InfoRow label={t('details.bridgeBot')}>
                  <span className="font-mono text-[12px]">{bridge.bridgeBot}</span>
                </InfoRow>
              )}
            </>
          ) : (
            <InfoRow label={t('details.network')}>Matrix</InfoRow>
          )}
          {!summary.isDm && <InfoRow label={t('details.members')}>{memberCount}</InfoRow>}
          <InfoRow label={t('details.encryption')}>
            <span className="inline-flex items-center gap-1.5">
              {encrypted ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5 text-muted-foreground" />}
              {encrypted
                ? t('details.encryptionOn')
                : bridge
                  ? t('details.encryptionOffBridge')
                  : t('details.encryptionOff')}
            </span>
          </InfoRow>
          <InfoRow label={t('details.roomId')}>
            <button
              type="button"
              onClick={copyRoomId}
              className="inline-flex max-w-full items-center gap-1.5 text-left hover:text-foreground"
              title={t('common.copy')}
            >
              <span className="truncate font-mono text-[12px]">{roomId}</span>
              <Copy className="size-3 shrink-0 text-muted-foreground" />
            </button>
          </InfoRow>
          {externalUrl && bridge && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2 w-full"
              onClick={() => openExternal(externalUrl).catch(() => toast.error(t('details.openLinkFailed')))}
            >
              <ExternalLink />
              {t('details.openIn', { network: bridge.networkName })}
            </Button>
          )}
        </section>

        <Tabs value={tab} onValueChange={setTab} className="gap-0 border-t">
          <TabsList
            variant="line"
            className="sticky top-0 z-10 h-10 w-full justify-start gap-3 rounded-none border-b bg-background px-4"
          >
            <TabsTrigger value="members" className="flex-none px-0 text-[13px]">
              {t('details.members')}
            </TabsTrigger>
            <TabsTrigger value="media" className="flex-none px-0 text-[13px]">
              {t('details.media')}
            </TabsTrigger>
            <TabsTrigger value="files" className="flex-none px-0 text-[13px]">
              {t('details.files')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="members">
            <MembersList room={room} bridgeBot={bridge?.bridgeBot} scrollEl={scrollEl} />
          </TabsContent>
          <TabsContent value="media" className="pt-3">
            <MediaGrid roomId={roomId} />
          </TabsContent>
          <TabsContent value="files" className="pt-1">
            <FileList roomId={roomId} />
          </TabsContent>
        </Tabs>
      </div>

      {canEdit && <RoomSettingsDialog room={room} summary={summary} open={editOpen} onOpenChange={setEditOpen} />}
      {canInvite && <InviteDialog room={room} open={inviteOpen} onOpenChange={setInviteOpen} />}

      <Dialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-base">{t('details.leaveTitle', { name: summary.name })}</DialogTitle>
            <DialogDescription className="text-[13px]">
              {bridge
                ? t('details.leaveBridged', { network: bridge.networkName })
                : t('details.leaveMatrix')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setConfirmLeave(false)}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" variant="destructive" onClick={leave}>
              {t('details.leave')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 py-1 text-[13px]">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 break-words">{children}</span>
    </div>
  );
}

type ActionButtonProps = {
  icon: typeof Bell;
  label: string;
  active?: boolean;
  destructive?: boolean;
  iconClassName?: string;
} & ComponentProps<'button'>;

/** Small outline tile with icon over label; forwards props so it works as a Radix trigger. */
export function ActionButton({ icon: Icon, label, active, destructive, iconClassName, className, ...props }: ActionButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        'flex h-14 flex-col items-center justify-center gap-1 rounded-md border bg-background text-[11px] font-medium shadow-xs outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
        active && 'text-primary',
        destructive && 'text-destructive hover:text-destructive',
        className,
      )}
      {...props}
    >
      <Icon className={cn('size-4', iconClassName)} />
      {label}
    </button>
  );
}
