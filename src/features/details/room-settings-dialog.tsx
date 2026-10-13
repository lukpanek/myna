import { Camera, Loader2, Trash2, UserPlus } from 'lucide-react';
import { EventType, KnownMembership, type MatrixClient, type Room } from 'matrix-js-sdk';
import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { MxAvatar } from '@/components/mx-avatar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useDebounced } from '@/features/new-chat/use-bridge-search';
import { t } from '@/i18n';
import { useMatrixClient } from '@/matrix/context';
import type { RoomSummary } from '@/matrix/rooms-store';

const AVATAR_SIZE = 512;
const MXID = /^@[^:\s]+:\S+$/;

function errorText(err: unknown): string {
  return err instanceof Error && err.message ? err.message : String(err);
}

export interface RoomPermissions {
  name: boolean;
  topic: boolean;
  avatar: boolean;
  invite: boolean;
}

export function roomPermissions(client: MatrixClient, room: Room): RoomPermissions {
  const me = client.getSafeUserId();
  const state = room.currentState;
  return {
    name: state.maySendStateEvent(EventType.RoomName, me),
    topic: state.maySendStateEvent(EventType.RoomTopic, me),
    avatar: state.maySendStateEvent(EventType.RoomAvatar, me),
    invite: room.canInvite(me),
  };
}

/** Square JPEG/PNG at most AVATAR_SIZE px, so avatars stay small for every client. */
async function downscaleAvatar(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const size = Math.min(side, AVATAR_SIZE);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  // Center crop to a square.
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
  return blob ?? file;
}

/** Name, topic and picture of a group chat. */
export function RoomSettingsDialog({
  room,
  summary,
  open,
  onOpenChange,
}: {
  room: Room;
  summary: RoomSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const client = useMatrixClient();
  const can = roomPermissions(client, room);
  const currentName = room.currentState.getStateEvents(EventType.RoomName, '')?.getContent().name ?? '';
  const currentTopic = room.currentState.getStateEvents(EventType.RoomTopic, '')?.getContent().topic ?? '';
  const [name, setName] = useState(currentName);
  const [topic, setTopic] = useState(currentTopic);
  // undefined = unchanged, null = remove, Blob = new picture.
  const [avatar, setAvatar] = useState<Blob | null | undefined>(undefined);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(currentName);
    setTopic(currentTopic);
    setAvatar(undefined);
    // Reset only when the dialog opens; edits from other clients must not wipe the form.
  }, [open]);

  useEffect(() => {
    if (!(avatar instanceof Blob)) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(avatar);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [avatar]);

  const pickAvatar = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setAvatar(await downscaleAvatar(file));
    } catch {
      toast.error(t('details.avatarReadFailed'));
    }
  };

  const nameChanged = name.trim() !== currentName;
  const topicChanged = topic.trim() !== currentTopic.trim();
  const dirty = nameChanged || topicChanged || avatar !== undefined;
  const hasAvatar = avatar === undefined ? !!room.getMxcAvatarUrl() : avatar !== null;

  const save = async () => {
    setSaving(true);
    try {
      if (avatar !== undefined) {
        // Room avatars are public state: never encrypted, even in encrypted rooms.
        const url = avatar ? (await client.uploadContent(avatar, { type: avatar.type })).content_uri : undefined;
        await client.sendStateEvent(room.roomId, EventType.RoomAvatar, url ? { url } : {}, '');
      }
      if (nameChanged) await client.setRoomName(room.roomId, name.trim());
      if (topicChanged) await client.setRoomTopic(room.roomId, topic.trim());
      toast.success(t('details.settingsSaved'));
      onOpenChange(false);
    } catch (err) {
      toast.error(t('details.settingsSaveFailedDetail', { error: errorText(err) }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-base">{t('details.editChat')}</DialogTitle>
          {summary.bridge && (
            <DialogDescription className="text-[13px]">
              {t('details.editBridgedHint', { network: summary.bridge.networkName })}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <button
              type="button"
              disabled={!can.avatar || saving}
              onClick={() => fileRef.current?.click()}
              className="group/avatar relative shrink-0 rounded-[16px] disabled:cursor-not-allowed"
              aria-label={t('details.changePicture')}
            >
              {preview ? (
                <img src={preview} alt="" className="size-[72px] rounded-[16px] object-cover" />
              ) : (
                <MxAvatar
                  mxc={avatar === null ? undefined : summary.avatarMxc}
                  name={name || summary.name}
                  seed={room.roomId}
                  size={72}
                  shape="square"
                />
              )}
              {can.avatar && (
                <span className="absolute inset-0 flex items-center justify-center rounded-[16px] bg-black/45 text-white opacity-0 transition-opacity group-hover/avatar:opacity-100 group-focus-visible/avatar:opacity-100">
                  <Camera className="size-5" />
                </span>
              )}
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void pickAvatar(e)} />
            {can.avatar && (
              <div className="flex flex-col items-start gap-1">
                <Button size="sm" variant="outline" disabled={saving} onClick={() => fileRef.current?.click()}>
                  <Camera />
                  {t('details.changePicture')}
                </Button>
                {hasAvatar && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={saving}
                    className="text-muted-foreground"
                    onClick={() => setAvatar(null)}
                  >
                    <Trash2 />
                    {t('details.removePicture')}
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="room-name">{t('details.chatName')}</Label>
            <Input
              id="room-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!can.name || saving}
              placeholder={summary.name}
              maxLength={255}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="room-topic">{t('details.chatTopic')}</Label>
            <Textarea
              id="room-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              disabled={!can.topic || saving}
              placeholder={t('details.chatTopicPlaceholder')}
              rows={3}
              className="max-h-40 resize-y"
            />
          </div>
          {!(can.name && can.topic && can.avatar) && (
            <p className="text-[12px] text-muted-foreground">{t('details.noPermissionSome')}</p>
          )}
        </div>

        <DialogFooter>
          <Button size="sm" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" disabled={!dirty || saving} onClick={() => void save()}>
            {saving && <Loader2 className="animate-spin" />}
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface DirectoryUser {
  user_id: string;
  display_name?: string;
  avatar_url?: string;
}

/** Invite Matrix users by name (user directory) or full Matrix ID. */
export function InviteDialog({
  room,
  open,
  onOpenChange,
}: {
  room: Room;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const client = useMatrixClient();
  const [query, setQuery] = useState('');
  const term = useDebounced(query.trim(), 300);
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [invited, setInvited] = useState<string[]>([]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setUsers([]);
      setInvited([]);
    }
  }, [open]);

  useEffect(() => {
    if (!term) {
      setUsers([]);
      return;
    }
    let alive = true;
    client.searchUserDirectory({ term, limit: 10 }).then(
      (res) => alive && setUsers(res.results),
      () => alive && setUsers([]),
    );
    return () => {
      alive = false;
    };
  }, [client, term]);

  const me = client.getSafeUserId();
  const trimmed = query.trim();
  const candidates: DirectoryUser[] = [
    ...(MXID.test(trimmed) && !users.some((u) => u.user_id === trimmed) ? [{ user_id: trimmed }] : []),
    ...users,
  ].filter((u) => u.user_id !== me);

  const statusOf = (userId: string): string | null => {
    if (invited.includes(userId)) return t('details.invited');
    const membership = room.getMember(userId)?.membership;
    if (membership === KnownMembership.Join) return t('details.alreadyMember');
    if (membership === KnownMembership.Invite) return t('details.invited');
    return null;
  };

  const invite = async (userId: string) => {
    setBusy(userId);
    try {
      await client.invite(room.roomId, userId);
      setInvited((list) => [...list, userId]);
    } catch (err) {
      toast.error(t('details.inviteFailed', { error: errorText(err) }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-base">{t('details.inviteTitle', { name: room.name })}</DialogTitle>
          <DialogDescription className="text-[13px]">{t('details.inviteDescription')}</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('details.invitePlaceholder')}
        />
        <div className="-mx-2 flex max-h-72 min-h-24 flex-col overflow-y-auto">
          {candidates.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">
              {trimmed ? t('details.inviteNoUsers') : t('details.inviteHint')}
            </p>
          ) : (
            candidates.map((u) => {
              const status = statusOf(u.user_id);
              const name = u.display_name || u.user_id;
              return (
                <div key={u.user_id} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent/50">
                  <MxAvatar mxc={u.avatar_url} name={name} seed={u.user_id} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{name}</span>
                    {u.display_name && (
                      <span className="block truncate text-[12px] text-muted-foreground">{u.user_id}</span>
                    )}
                  </span>
                  {status ? (
                    <span className="shrink-0 text-[12px] text-muted-foreground">{status}</span>
                  ) : (
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void invite(u.user_id)}>
                      {busy === u.user_id ? <Loader2 className="animate-spin" /> : <UserPlus />}
                      {t('details.invite')}
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </div>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
