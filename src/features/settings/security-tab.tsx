import { Check, KeyRound, Laptop, LogOut, Pencil, ShieldAlert, ShieldCheck, Smartphone, X } from 'lucide-react';
import { type IMyDevice, MatrixError } from 'matrix-js-sdk';
import { CryptoEvent } from 'matrix-js-sdk/lib/crypto-api';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
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
import { useCryptoUi } from '@/features/crypto/crypto-store';
import { requestOtherDeviceVerification, verifyThisSession } from '@/features/crypto/verify-session';
import { t } from '@/i18n';
import { dayjs } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useEmitterEvent, useMatrixClient } from '@/matrix/context';
import { errorMessage, Row, Section, TabTitle } from './settings-ui';

interface CryptoStatus {
  available: boolean;
  verified: boolean;
  crossSigningReady: boolean;
  backupVersion: string | null;
  backupExists: boolean;
}

function useCryptoStatus() {
  const client = useMatrixClient();
  const [status, setStatus] = useState<CryptoStatus | null>(null);

  const refresh = useCallback(async () => {
    const crypto = client.getCrypto();
    const deviceId = client.getDeviceId();
    if (!crypto || !deviceId) {
      setStatus({ available: false, verified: false, crossSigningReady: false, backupVersion: null, backupExists: false });
      return;
    }
    try {
      const [device, ready, version, info] = await Promise.all([
        crypto.getDeviceVerificationStatus(client.getSafeUserId(), deviceId),
        crypto.isCrossSigningReady(),
        crypto.getActiveSessionBackupVersion(),
        crypto.getKeyBackupInfo().catch(() => null),
      ]);
      setStatus({
        available: true,
        verified: !!device?.crossSigningVerified,
        crossSigningReady: ready,
        backupVersion: version,
        backupExists: !!info,
      });
    } catch {
      // Keep the last known status; the next crypto event retries.
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEmitterEvent(client, CryptoEvent.KeysChanged, () => void refresh());
  useEmitterEvent(client, CryptoEvent.UserTrustStatusChanged, () => void refresh());
  useEmitterEvent(client, CryptoEvent.KeyBackupStatus, () => void refresh());
  useEmitterEvent(client, CryptoEvent.DevicesUpdated, () => void refresh());

  return { status, refresh };
}

export function SecurityTab() {
  const client = useMatrixClient();
  const { status, refresh } = useCryptoStatus();
  const verifying = useCryptoUi((s) => s.verifying);
  const [checkingBackup, setCheckingBackup] = useState(false);

  const checkBackup = async () => {
    const crypto = client.getCrypto();
    if (!crypto) return;
    setCheckingBackup(true);
    try {
      const result = await crypto.checkKeyBackupAndEnable();
      if (!result) toast.info(t('settings.backupNone'));
      else if (!result.trustInfo.trusted) toast.info(t('settings.backupUntrusted'));
      else toast.success(t('settings.backupEnabled'));
      await refresh();
    } catch (err) {
      toast.error(t('settings.backupCheckFailed', { error: errorMessage(err) }));
    } finally {
      setCheckingBackup(false);
    }
  };

  return (
    <>
      <TabTitle>{t('settings.tabSecurity')}</TabTitle>
      <Section
        title={t('settings.encryptionStatus')}
        description={t('settings.encryptionStatusDescription')}
      >
        {!status ? (
          <p className="text-[13px] text-muted-foreground">{t('common.loading')}</p>
        ) : !status.available ? (
          <p className="text-[13px] text-muted-foreground">
            {t('settings.cryptoUnavailable')}
          </p>
        ) : (
          <>
            <StatusRow ok={status.verified} label={t('settings.sessionVerified')} />
            <StatusRow ok={status.crossSigningReady} label={t('settings.crossSigningReady')} />
            <Row label={<StatusLabel ok={!!status.backupVersion} label={t('settings.keyBackup')} />}>
              <span className="text-[13px] text-muted-foreground">
                {status.backupVersion
                  ? t('settings.backupOn', { version: status.backupVersion })
                  : status.backupExists
                    ? t('settings.backupInactive')
                    : t('settings.backupNotSet')}
              </span>
              <Button size="xs" variant="outline" onClick={checkBackup} disabled={checkingBackup}>
                {t('settings.check')}
              </Button>
            </Row>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void verifyThisSession(client).then(refresh)} disabled={verifying}>
                <KeyRound />
                {t('settings.verifyWithRecoveryKey')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void requestOtherDeviceVerification(client)}>
                {t('settings.verifyFromOtherDevice')}
              </Button>
            </div>
          </>
        )}
      </Section>
      <Sessions />
    </>
  );
}

function StatusLabel({ ok, label }: { ok: boolean; label: string }) {
  const Icon = ok ? ShieldCheck : ShieldAlert;
  return (
    <span className="flex items-center gap-2">
      <Icon className={cn('size-4', ok ? 'text-primary' : 'text-amber-500')} />
      {label}
    </span>
  );
}

function StatusRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Row label={<StatusLabel ok={ok} label={label} />}>
      <span className={cn('text-[13px]', ok ? 'text-muted-foreground' : 'font-medium text-foreground')}>
        {ok ? t('settings.yes') : t('settings.no')}
      </span>
    </Row>
  );
}

type PasswordPrompt = { device: IMyDevice; session?: string; error?: string };

function Sessions() {
  const client = useMatrixClient();
  const currentId = client.getDeviceId();
  const [devices, setDevices] = useState<IMyDevice[] | null>(null);
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const [confirming, setConfirming] = useState<IMyDevice | null>(null);
  const [password, setPassword] = useState<PasswordPrompt | null>(null);

  const load = useCallback(async () => {
    try {
      const { devices: list } = await client.getDevices();
      list.sort((a, b) =>
        a.device_id === currentId ? -1 : b.device_id === currentId ? 1 : (b.last_seen_ts ?? 0) - (a.last_seen_ts ?? 0),
      );
      setDevices(list);
      const crypto = client.getCrypto();
      if (!crypto) return;
      const me = client.getSafeUserId();
      const entries = await Promise.all(
        list.map(async (d) => {
          const s = await crypto.getDeviceVerificationStatus(me, d.device_id).catch(() => null);
          return [d.device_id, !!s?.crossSigningVerified] as const;
        }),
      );
      setVerified(Object.fromEntries(entries));
    } catch (err) {
      toast.error(t('settings.sessionsLoadFailed', { error: errorMessage(err) }));
    }
  }, [client, currentId]);

  useEffect(() => {
    void load();
  }, [load]);
  useEmitterEvent(client, CryptoEvent.DevicesUpdated, () => void load());

  /** Deletes a device; User-Interactive Auth with a password is handled via the password dialog. */
  const signOut = async (device: IMyDevice, auth?: { password: string; session?: string }) => {
    try {
      await client.deleteDevice(
        device.device_id,
        auth
          ? {
              type: 'm.login.password',
              identifier: { type: 'm.id.user', user: client.getSafeUserId() },
              password: auth.password,
              session: auth.session,
            }
          : undefined,
      );
      setPassword(null);
      toast.success(t('settings.sessionSignedOut'));
      void load();
    } catch (err) {
      const data = err instanceof MatrixError ? (err.data as { flows?: { stages: string[] }[]; session?: string }) : null;
      if (err instanceof MatrixError && err.httpStatus === 401 && data?.flows) {
        const passwordFlow = data.flows.some((f) => f.stages.length === 1 && f.stages[0] === 'm.login.password');
        if (!passwordFlow) {
          setPassword(null);
          toast.error(t('settings.unsupportedAuth'));
          return;
        }
        setPassword({
          device,
          session: data.session,
          error: auth ? t('settings.wrongPassword') : undefined,
        });
        return;
      }
      if (err instanceof MatrixError && err.errcode === 'M_FORBIDDEN' && auth) {
        setPassword({ device, session: auth.session, error: t('settings.wrongPassword') });
        return;
      }
      setPassword(null);
      toast.error(t('settings.sessionSignOutFailed', { error: errorMessage(err) }));
    }
  };

  return (
    <Section title={t('settings.sessions')} description={t('settings.sessionsDescription')}>
      {!devices ? (
        <p className="text-[13px] text-muted-foreground">{t('common.loading')}</p>
      ) : (
        <div className="divide-y rounded-md border">
          {devices.map((d) => (
            <SessionRow
              key={d.device_id}
              device={d}
              current={d.device_id === currentId}
              verified={verified[d.device_id]}
              onRenamed={load}
              onSignOut={() => setConfirming(d)}
            />
          ))}
        </div>
      )}

      <Dialog open={!!confirming} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-base">{t('settings.signOutSessionConfirm')}</DialogTitle>
            <DialogDescription className="text-[13px]">
              {t('settings.signOutSessionDescription', { session: confirming?.display_name || confirming?.device_id || '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setConfirming(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                const device = confirming;
                setConfirming(null);
                if (device) void signOut(device);
              }}
            >
              {t('settings.signOut')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {password && (
        <PasswordDialog
          prompt={password}
          onCancel={() => setPassword(null)}
          onSubmit={(value) => signOut(password.device, { password: value, session: password.session })}
        />
      )}
    </Section>
  );
}

function SessionRow({
  device,
  current,
  verified,
  onRenamed,
  onSignOut,
}: {
  device: IMyDevice;
  current: boolean;
  verified: boolean | undefined;
  onRenamed: () => void;
  onSignOut: () => void;
}) {
  const client = useMatrixClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(device.display_name ?? '');
  const [saving, setSaving] = useState(false);
  const label = device.display_name || device.device_id;
  const mobile = /android|ios|iphone|ipad|mobile/i.test(label);
  const Icon = mobile ? Smartphone : Laptop;

  const rename = async (e: FormEvent) => {
    e.preventDefault();
    const next = name.trim();
    if (!next || next === device.display_name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await client.setDeviceDetails(device.device_id, { display_name: next });
      setEditing(false);
      onRenamed();
    } catch (err) {
      toast.error(t('settings.sessionRenameFailed', { error: errorMessage(err) }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <Icon className="size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        {editing ? (
          <form onSubmit={rename} className="flex items-center gap-1.5">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-7 max-w-[260px] text-sm"
              aria-label={t('settings.sessionName')}
            />
            <Button type="submit" size="icon-xs" disabled={saving} aria-label={t('common.save')}>
              <Check />
            </Button>
            <Button type="button" size="icon-xs" variant="ghost" onClick={() => setEditing(false)} aria-label={t('common.cancel')}>
              <X />
            </Button>
          </form>
        ) : (
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{label}</span>
            {current && (
              <span className="shrink-0 rounded bg-primary/10 px-1.5 text-[11px] font-medium text-primary">
                {t('settings.thisSession')}
              </span>
            )}
            {verified === false && (
              <span className="shrink-0 rounded bg-amber-500/10 px-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                {t('settings.unverified')}
              </span>
            )}
          </div>
        )}
        <div className="truncate text-[12px] text-muted-foreground">
          <span className="font-mono">{device.device_id}</span>
          {device.last_seen_ts && !current && <> · {t('settings.lastSeen', { time: dayjs(device.last_seen_ts).format(`${t('time.dateYearFormat')} ${t('time.timeFormat')}`) })}</>}
          {device.last_seen_ip && <> · {device.last_seen_ip}</>}
        </div>
      </div>
      {!editing && (
        <div className="flex shrink-0 gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => {
              setName(device.display_name ?? '');
              setEditing(true);
            }}
            aria-label={t('settings.rename')}
          >
            <Pencil className="size-3.5" />
          </Button>
          {!current && (
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={onSignOut}
              aria-label={t('settings.signOutSession')}
            >
              <LogOut className="size-3.5" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function PasswordDialog({
  prompt,
  onCancel,
  onSubmit,
}: {
  prompt: PasswordPrompt;
  onCancel: () => void;
  onSubmit: (password: string) => Promise<void>;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!value) return;
    setBusy(true);
    await onSubmit(value);
    setBusy(false);
    setValue('');
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-[400px]">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle className="text-base">{t('settings.confirmWithPassword')}</DialogTitle>
            <DialogDescription className="text-[13px]">
              {t('settings.confirmWithPasswordDescription', { session: prompt.device.display_name || prompt.device.device_id })}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Input
              autoFocus
              type="password"
              autoComplete="current-password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-invalid={!!prompt.error}
              aria-label={t('app.password')}
            />
            {prompt.error && <p className="text-[13px] text-destructive">{prompt.error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" size="sm" variant="outline" onClick={onCancel}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" size="sm" variant="destructive" disabled={busy || !value}>
              {t('settings.signOut')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
