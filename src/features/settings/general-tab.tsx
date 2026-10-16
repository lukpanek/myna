import { Check, Copy, Download, Eye, EyeOff, Keyboard, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LOCALES, systemLocale, t } from '@/i18n';
import { tn } from '@/i18n/rich';
import { formatShortcut, GLOBAL_SHORTCUTS } from '@/lib/global-shortcut';
import { getAutostart, setAutostart } from '@/lib/native';
import { isMac, isTauri, modKey } from '@/lib/platform';
import { formatFullTime } from '@/lib/time';
import { checkForUpdates, installUpdate, updatesSupported, useUpdater } from '@/lib/updater';
import { useMatrixClient } from '@/matrix/context';
import { type LanguagePref, useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { errorMessage, Kbd, Row, Section, SwitchRow, TabTitle } from './settings-ui';

/** Fallback when not running inside Tauri (browser dev); keep in sync with package.json. */
const PACKAGE_VERSION = '0.1.0';

export function useAppVersion(): string {
  const [version, setVersion] = useState(PACKAGE_VERSION);
  useEffect(() => {
    if (!isTauri) return;
    import('@tauri-apps/api/app')
      .then(({ getVersion }) => getVersion())
      .then(setVersion)
      .catch(() => undefined);
  }, []);
  return version;
}

export function GeneralTab() {
  const language = useSettings((s) => s.language);
  const set = useSettings((s) => s.set);
  const setShortcutsOpen = useUi((s) => s.setShortcutsOpen);

  return (
    <>
      <TabTitle>{t('settings.tabGeneral')}</TabTitle>
      <Section title={t('settings.language')} description={t('settings.languageDescription')}>
        <Select value={language} onValueChange={(v) => set({ language: v as LanguagePref })}>
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">
              {t('settings.languageSystem', {
                language: LOCALES.find((l) => l.value === systemLocale())?.label ?? 'English',
              })}
            </SelectItem>
            {LOCALES.map((l) => (
              <SelectItem key={l.value} value={l.value}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Section>

      <SendingSection />
      {isTauri && <SystemSection />}

      <Section title={t('settings.tabShortcuts')}>
        <Row label={t('settings.shortcutsHint')}>
          <Button size="sm" variant="outline" onClick={() => setShortcutsOpen(true)}>
            <Keyboard />
            {t('settings.showShortcuts')}
            <span className="text-muted-foreground">{modKey}/</span>
          </Button>
        </Row>
      </Section>

      <AboutSection />
      <DeveloperSection />
    </>
  );
}

function SendingSection() {
  const sendWithShift = useSettings((s) => s.sendWithShift);
  const set = useSettings((s) => s.set);
  return (
    <Section title={t('settings.sending')} description={t('settings.sendingDescription')}>
      <RadioGroup
        value={sendWithShift ? 'shift' : 'enter'}
        onValueChange={(v) => set({ sendWithShift: v === 'shift' })}
        className="gap-3"
      >
        <div className="flex items-start gap-3">
          <RadioGroupItem value="enter" id="send-enter" className="mt-0.5" />
          <Label htmlFor="send-enter" className="flex-col items-start gap-0.5 font-normal">
            <span className="text-sm">{tn('settings.enterSends', { key: <Kbd>Enter</Kbd> })}</span>
            <span className="text-[13px] text-muted-foreground">
              {tn('settings.shiftEnterNewline', { keys: <ShiftEnter /> })}
            </span>
          </Label>
        </div>
        <div className="flex items-start gap-3">
          <RadioGroupItem value="shift" id="send-shift" className="mt-0.5" />
          <Label htmlFor="send-shift" className="flex-col items-start gap-0.5 font-normal">
            <span className="text-sm">{tn('settings.enterSends', { key: <ShiftEnter /> })}</span>
            <span className="text-[13px] text-muted-foreground">
              {tn('settings.enterNewline', { key: <Kbd>Enter</Kbd> })}
            </span>
          </Label>
        </div>
      </RadioGroup>
    </Section>
  );
}

function ShiftEnter() {
  return (
    <>
      <Kbd>Shift</Kbd> + <Kbd>Enter</Kbd>
    </>
  );
}

/** Desktop integration: tray icon and launch at login. */
function SystemSection() {
  const trayIcon = useSettings((s) => s.trayIcon);
  const set = useSettings((s) => s.set);
  // Launch at login lives in the OS (login item), not in our settings.
  const [autostart, setAutostartState] = useState<boolean | null>(null);

  useEffect(() => {
    getAutostart()
      .then(setAutostartState)
      .catch(() => setAutostartState(false));
  }, []);

  const toggleAutostart = (enabled: boolean) => {
    setAutostartState(enabled);
    setAutostart(enabled).catch((err) => {
      setAutostartState(!enabled);
      toast.error(t('settings.autostartFailed', { error: errorMessage(err) }));
    });
  };

  return (
    <Section title={t('settings.system')}>
      <SwitchRow
        label={t('settings.autostart')}
        description={t('settings.autostartDescription')}
        checked={autostart ?? false}
        disabled={autostart === null}
        onCheckedChange={toggleAutostart}
      />
      <SwitchRow
        label={t('settings.trayIcon')}
        description={isMac ? t('settings.trayIconDescriptionMac') : t('settings.trayIconDescription')}
        checked={trayIcon}
        onCheckedChange={(value) => set({ trayIcon: value })}
      />
      <GlobalShortcutRow />
    </Section>
  );
}

const SHORTCUT_OFF = 'off';

function GlobalShortcutRow() {
  const shortcut = useSettings((s) => s.globalShortcut);
  const set = useSettings((s) => s.set);
  return (
    <Row label={t('desktop.globalShortcut')} description={t('desktop.globalShortcutDescription')}>
      <Select
        value={shortcut ?? SHORTCUT_OFF}
        onValueChange={(v) => set({ globalShortcut: v === SHORTCUT_OFF ? null : v })}
      >
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SHORTCUT_OFF}>{t('desktop.globalShortcutOff')}</SelectItem>
          {GLOBAL_SHORTCUTS.map((s) => (
            <SelectItem key={s} value={s}>
              {formatShortcut(s)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Row>
  );
}

function AboutSection() {
  const version = useAppVersion();
  return (
    <Section title={t('settings.tabAbout')} description={t('settings.aboutDescription')}>
      <Row label={t('settings.version')}>
        <span className="font-mono text-[13px] text-muted-foreground select-text">{version}</span>
      </Row>
      {updatesSupported && <UpdateRows />}
      <Row label={t('settings.license')}>
        <span className="text-sm text-muted-foreground">AGPL-3.0</span>
      </Row>
      <p className="mt-2 text-[13px] text-muted-foreground">{t('settings.creditsText')}</p>
    </Section>
  );
}

function UpdateRows() {
  const status = useUpdater((s) => s.status);
  const autoCheck = useSettings((s) => s.autoUpdateCheck);
  const set = useSettings((s) => s.set);

  let description: string;
  switch (status.kind) {
    case 'checking':
      description = t('desktop.updateChecking');
      break;
    case 'upToDate':
      description = t('desktop.updateUpToDate', { time: formatFullTime(status.checkedAt) });
      break;
    case 'available':
      description = t('desktop.updateAvailable', { version: status.version });
      break;
    case 'downloading':
      description =
        status.progress === null
          ? t('desktop.updateDownloading')
          : t('desktop.updateDownloadingProgress', { percent: Math.round(status.progress * 100) });
      break;
    case 'ready':
      description = t('desktop.updateRestarting');
      break;
    case 'error':
      description = t('desktop.updateFailed', { error: status.message });
      break;
    default:
      description = t('desktop.updateIdle');
  }
  const busy = status.kind === 'checking' || status.kind === 'downloading' || status.kind === 'ready';

  return (
    <>
      <Row label={t('desktop.updates')} description={description}>
        {status.kind === 'available' ? (
          <Button size="sm" onClick={() => void installUpdate()}>
            <Download />
            {t('desktop.updateInstall')}
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void checkForUpdates()}>
            {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {t('desktop.updateCheck')}
          </Button>
        )}
      </Row>
      <SwitchRow
        label={t('desktop.autoUpdateCheck')}
        description={t('desktop.autoUpdateCheckDescription')}
        checked={autoCheck}
        onCheckedChange={(value) => set({ autoUpdateCheck: value })}
      />
    </>
  );
}

/** Session details like Element's Help & About → Advanced; the access token stays hidden until revealed. */
function DeveloperSection() {
  const client = useMatrixClient();
  const webInspector = useSettings((s) => s.webInspector);
  const set = useSettings((s) => s.set);
  const [revealed, setRevealed] = useState(false);
  const token = client.getAccessToken() ?? '';

  return (
    <Section title={t('settings.developer')} description={t('settings.developerDescription')}>
      <Row label={t('settings.homeserver')}>
        <CopyValue value={client.getHomeserverUrl()} />
      </Row>
      <Row label={t('settings.userId')}>
        <CopyValue value={client.getSafeUserId()} />
      </Row>
      <Row label={t('settings.deviceId')}>
        <CopyValue value={client.getDeviceId() ?? ''} />
      </Row>
      <Row label={t('settings.accessToken')} description={t('settings.accessTokenWarning')}>
        <Button size="sm" variant="outline" onClick={() => setRevealed((v) => !v)} disabled={!token}>
          {revealed ? <EyeOff /> : <Eye />}
          {revealed ? t('settings.hide') : t('settings.reveal')}
        </Button>
        <CopyButton value={token} />
      </Row>
      {revealed && (
        <code className="mt-1 block rounded-md bg-muted px-2.5 py-2 font-mono text-[12px] break-all select-text">
          {token}
        </code>
      )}
      {/* Development builds always have the inspector. */}
      {isTauri && !import.meta.env.DEV && (
        <SwitchRow
          label={t('settings.webInspector')}
          description={t('settings.webInspectorDescription')}
          checked={webInspector}
          onCheckedChange={(value) => set({ webInspector: value })}
        />
      )}
    </Section>
  );
}

function CopyValue({ value }: { value: string }) {
  return (
    <>
      <span className="max-w-72 truncate font-mono text-[13px] text-muted-foreground select-text" title={value}>
        {value}
      </span>
      <CopyButton value={value} />
    </>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label={copied ? t('settings.copied') : t('settings.copy')}
      title={t('settings.copy')}
      disabled={!value}
      onClick={() => void navigator.clipboard.writeText(value).then(() => setCopied(true))}
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  );
}
