import { Camera, Check, LogOut, Pencil, X } from 'lucide-react';
import { UserEvent } from 'matrix-js-sdk';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { MxAvatar } from '@/components/mx-avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { t } from '@/i18n';
import { useMatrixClient } from '@/matrix/context';
import { useRerenderOn } from '@/matrix/hooks';
import { errorMessage, Row, Section, TabTitle } from './settings-ui';

export function AccountTab({ onLogout }: { onLogout: () => void }) {
  const client = useMatrixClient();
  const userId = client.getSafeUserId();
  const me = client.getUser(userId);
  useRerenderOn(me, UserEvent.DisplayName, UserEvent.AvatarUrl);
  const name = me?.displayName || userId;
  const deviceId = client.getDeviceId();
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!deviceId) return;
    let alive = true;
    client
      .getDevice(deviceId)
      .then((d) => alive && setDeviceName(d.display_name ?? null))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [client, deviceId]);

  const changeAvatar = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error(t('settings.pickImage'));
      return;
    }
    setUploading(true);
    try {
      const { content_uri } = await client.uploadContent(file, { name: file.name, type: file.type });
      await client.setAvatarUrl(content_uri);
      toast.success(t('settings.avatarChanged'));
    } catch (err) {
      toast.error(t('settings.avatarUploadFailed', { error: errorMessage(err) }));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <>
      <TabTitle>{t('settings.tabAccount')}</TabTitle>
      <Section title={t('settings.profile')} description={t('settings.profileDescription')}>
        <div className="flex items-start gap-5">
          <div className="group relative">
            <MxAvatar mxc={me?.avatarUrl} name={name} seed={userId} size={72} shape="square" />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="absolute inset-0 flex items-center justify-center rounded-[16px] bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-100"
              aria-label={t('settings.changeAvatarLabel')}
            >
              {uploading ? <span className="text-[11px]">{t('settings.uploading')}</span> : <Camera className="size-5" />}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => changeAvatar(e.target.files?.[0])}
            />
          </div>
          <div className="min-w-0 flex-1">
            <DisplayNameEditor current={me?.displayName ?? ''} />
            <div className="mt-1 truncate text-[13px] text-muted-foreground select-text">{userId}</div>
            <Button
              variant="link"
              size="sm"
              className="mt-1 h-auto px-0 text-[13px]"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {t('settings.changeAvatar')}
            </Button>
          </div>
        </div>
      </Section>

      <Section title={t('settings.thisSession')} description={t('settings.thisSessionDescription')}>
        <Row label={t('settings.sessionName')}>
          <span className="text-sm text-muted-foreground">{deviceName ?? '—'}</span>
        </Row>
        <Row label={t('settings.sessionId')}>
          <code className="font-mono text-[13px] text-muted-foreground select-text">{deviceId ?? '—'}</code>
        </Row>
        <Row label={t('settings.homeserver')}>
          <span className="truncate text-sm text-muted-foreground select-text">{client.getHomeserverUrl()}</span>
        </Row>
      </Section>

      <Section title={t('settings.logoutTitle')} description={t('settings.logoutDescription')}>
        <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={onLogout}>
          <LogOut />
          {t('app.logout')}
        </Button>
      </Section>
    </>
  );
}

function DisplayNameEditor({ current }: { current: string }) {
  const client = useMatrixClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current);
  const [saving, setSaving] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const next = value.trim();
    if (!next || next === current) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await client.setDisplayName(next);
      setEditing(false);
      toast.success(t('settings.nameChanged'));
    } catch (err) {
      toast.error(t('settings.nameChangeFailed', { error: errorMessage(err) }));
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <span className="truncate text-base font-semibold">{current || t('settings.noName')}</span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => {
            setValue(current);
            setEditing(true);
          }}
          aria-label={t('settings.editName')}
        >
          <Pencil />
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={save} className="flex items-center gap-1.5">
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setEditing(false))}
        className="h-8 max-w-[280px]"
        maxLength={256}
        aria-label={t('settings.displayName')}
      />
      <Button type="submit" size="icon-sm" disabled={saving} aria-label={t('common.save')}>
        <Check />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" onClick={() => setEditing(false)} aria-label={t('common.cancel')}>
        <X />
      </Button>
    </form>
  );
}
