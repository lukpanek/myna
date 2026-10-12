import { ArrowLeft, Copy, MessageSquare, X } from 'lucide-react';
import { KnownMembership, type MatrixClient, RoomStateEvent } from 'matrix-js-sdk';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { MxAvatar, NetworkIcon } from '@/components/mx-avatar';
import { Button } from '@/components/ui/button';
import { findDirectRoom, openDirectChat, openRoomWhenReady } from '@/features/bridges/direct-chat';
import { t } from '@/i18n';
import { isOwnGhost } from '@/matrix/bridge';
import { useMatrixClient } from '@/matrix/context';
import { useRerenderOn, useRoom, useRoomSummary } from '@/matrix/hooks';
import { useRooms } from '@/matrix/rooms-store';
import { useUi } from '@/store/ui';
import { ActionButton, InfoRow } from './details-panel';
import { roleLabel } from './members-list';

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Bridged DM portal where the ghost `userId` is joined (bridges don't always fill `m.direct`). */
function findBridgedDm(client: MatrixClient, userId: string): string | null {
  for (const summary of Object.values(useRooms.getState().rooms)) {
    if (!summary.isDm || !summary.bridge || summary.isBotRoom) continue;
    if (client.getRoom(summary.roomId)?.getMember(userId)?.membership === KnownMembership.Join) return summary.roomId;
  }
  return null;
}

/** Profile of a room member, opened from their avatar or name in the timeline or the member list. */
export function UserPanel({
  roomId,
  userId,
  onBack,
}: {
  roomId: string;
  userId: string;
  onBack?: () => void;
}) {
  const client = useMatrixClient();
  const room = useRoom(roomId);
  const summary = useRoomSummary(roomId);
  const setRightPanel = useUi((s) => s.setRightPanel);
  const [profile, setProfile] = useState<{ name?: string; avatarMxc?: string } | null>(null);
  const [opening, setOpening] = useState(false);
  useRerenderOn(room?.currentState, RoomStateEvent.Members);

  const member = room?.getMember(userId) ?? null;

  // Not (or no longer) a member we know: fall back to the global profile.
  useEffect(() => {
    setProfile(null);
    if (member) return;
    let alive = true;
    client
      .getProfileInfo(userId)
      .then((p) => alive && setProfile({ name: p.displayname, avatarMxc: p.avatar_url }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [client, userId, member]);

  const me = client.getSafeUserId();
  const isMe = userId === me;
  const bridge = summary?.bridge;
  // The user's own remote account; bridges often leave it as "Unknown user".
  const ownGhost = isOwnGhost(userId, bridge?.receiver);
  const name = ownGhost
    ? room?.getMember(me)?.rawDisplayName || client.getUser(me)?.displayName || me
    : (isMe ? member?.rawDisplayName : member?.name) || profile?.name || userId;
  const avatarMxc = member?.getMxcAvatarUrl() ?? profile?.avatarMxc;
  const isBridgeBot = !!bridge?.bridgeBot && bridge.bridgeBot === userId;
  // In a portal everyone but us is a ghost of the remote network.
  const remote = bridge && !isMe && !isBridgeBot ? bridge : null;
  const role = member ? (roleLabel(member, bridge?.bridgeBot) ?? t('details.roleMember')) : null;
  const left = !!member && member.membership !== KnownMembership.Join && member.membership !== KnownMembership.Invite;

  const dmRoomId = isMe ? null : (findDirectRoom(client, userId) ?? (remote ? findBridgedDm(client, userId) : null));
  // Starting a fresh DM with a ghost is up to the bridge; only offer existing portals there.
  const canMessage = !isMe && !ownGhost && dmRoomId !== roomId && (!!dmRoomId || !remote);

  const sendMessage = async () => {
    setOpening(true);
    try {
      if (dmRoomId) await openRoomWhenReady(client, dmRoomId, { networkId: remote?.networkId });
      else await openDirectChat(client, userId, { encrypted: true });
    } catch (err) {
      toast.error(t('details.openChatFailed', { error: errorText(err) }));
    } finally {
      setOpening(false);
    }
  };

  const copyId = () => {
    navigator.clipboard
      .writeText(userId)
      .then(() => toast.success(t('details.userIdCopied')))
      .catch(() => toast.error(t('common.copyFailed')));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-1 border-b pr-2 pl-4">
        {onBack && (
          <Button variant="ghost" size="icon-sm" className="-ml-2" onClick={onBack} aria-label={t('details.back')}>
            <ArrowLeft />
          </Button>
        )}
        <h2 className="flex-1 text-[15px] font-semibold">{t('details.profileTitle')}</h2>
        <Button variant="ghost" size="icon-sm" onClick={() => setRightPanel(null)} aria-label={t('details.closeProfile')}>
          <X />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col items-center px-5 pt-6 pb-4 text-center">
          <MxAvatar mxc={avatarMxc} name={name} seed={userId} size={96} />
          <h3 className="mt-3 max-w-full text-lg leading-tight font-semibold break-words select-text">
            {name}
            {(isMe || ownGhost) && <span className="ml-1.5 font-normal text-muted-foreground">({t('details.you')})</span>}
          </h3>
          {remote ? (
            <span className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[12px] text-muted-foreground">
              <NetworkIcon networkId={remote.networkId} avatarMxc={remote.networkAvatar} name={remote.networkName} size={14} />
              <span className="truncate">{remote.networkName}</span>
            </span>
          ) : (
            <span className="mt-1 max-w-full truncate font-mono text-[12px] text-muted-foreground select-text">{userId}</span>
          )}
          {left && <span className="mt-2 text-[12px] text-muted-foreground">{t('details.notInChat')}</span>}
        </div>

        <div className="grid grid-cols-4 gap-2 px-4 pb-4">
          {canMessage && (
            <ActionButton icon={MessageSquare} label={t('details.sendMessage')} disabled={opening} onClick={sendMessage} />
          )}
          <ActionButton icon={Copy} label={t('details.copyId')} onClick={copyId} />
        </div>

        <section className="border-t px-4 py-3">
          {role && <InfoRow label={t('details.role')}>{role}</InfoRow>}
          {remote && (
            <InfoRow label={t('details.network')}>
              <span className="inline-flex items-center gap-1.5">
                <NetworkIcon networkId={remote.networkId} avatarMxc={remote.networkAvatar} name={remote.networkName} size={14} />
                {remote.networkName}
              </span>
            </InfoRow>
          )}
          <InfoRow label={t('details.userId')}>
            <button
              type="button"
              onClick={copyId}
              className="inline-flex max-w-full items-center gap-1.5 text-left hover:text-foreground"
              title={t('common.copy')}
            >
              <span className="truncate font-mono text-[12px]">{userId}</span>
              <Copy className="size-3 shrink-0 text-muted-foreground" />
            </button>
          </InfoRow>
        </section>
      </div>
    </div>
  );
}
