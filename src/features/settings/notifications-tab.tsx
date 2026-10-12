import { BellOff, Plus, X } from 'lucide-react';
import { ClientEvent, EventType, type MatrixEvent } from 'matrix-js-sdk';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { NetworkIcon } from '@/components/mx-avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ensureNotificationPermission } from '@/features/notifications/permission';
import {
  addKeyword,
  type DmDefault,
  getDmDefault,
  getGroupDefault,
  getKeywordRules,
  type GroupDefault,
  removeKeyword,
  setDmDefault,
  setGroupDefault,
} from '@/features/notifications/push-defaults';
import { t } from '@/i18n';
import { dayjs } from '@/lib/time';
import { useEmitterEvent, useMatrixClient } from '@/matrix/context';
import { NOTIFY_LEVELS, notifyLevelLabel } from '@/matrix/push-rules';
import { useRooms } from '@/matrix/rooms-store';
import { type NetworkNotifyDefault, useSettings } from '@/store/settings';
import { errorMessage, Row, Section, SwitchRow, TabTitle } from './settings-ui';

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

/** Re-renders when the account push rules change (they arrive via account data sync). */
function usePushRulesVersion(onChange?: () => void): void {
  const client = useMatrixClient();
  const [, bump] = useState(0);
  useEmitterEvent(client, ClientEvent.AccountData, (event: MatrixEvent) => {
    if (event.getType() !== EventType.PushRules) return;
    onChange?.();
    bump((n) => n + 1);
  });
}

export function NotificationsTab() {
  const n = useSettings((s) => s.notifications);
  const setNotifications = useSettings((s) => s.setNotifications);
  const paused = !!n.pausedUntil && n.pausedUntil > Date.now();

  const toggleEnabled = async (enabled: boolean) => {
    if (enabled && !(await ensureNotificationPermission())) {
      toast.error(t('settings.notificationsDenied'));
      return;
    }
    setNotifications({ enabled });
  };

  return (
    <>
      <TabTitle>{t('settings.tabNotifications')}</TabTitle>
      <Section title={t('settings.thisComputer')} description={t('settings.thisComputerDescription')}>
        <SwitchRow
          label={t('settings.desktopNotifications')}
          description={t('settings.desktopNotificationsDescription')}
          checked={n.enabled}
          onCheckedChange={toggleEnabled}
        />
        <SwitchRow
          label={t('settings.sound')}
          checked={n.sound}
          disabled={!n.enabled}
          onCheckedChange={(sound) => setNotifications({ sound })}
        />
        <SwitchRow
          label={t('settings.showContent')}
          description={t('settings.showContentDescription')}
          checked={n.showContent}
          disabled={!n.enabled}
          onCheckedChange={(showContent) => setNotifications({ showContent })}
        />
      </Section>

      <Section
        title={t('shell.pauseNotifications')}
        description={t('settings.pauseDescription')}
      >
        {paused ? (
          <div className="flex items-center justify-between gap-4 rounded-md border bg-muted/50 px-3 py-2.5">
            <div className="flex items-center gap-2 text-sm">
              <BellOff className="size-4 text-muted-foreground" />
              {t('shell.pausedUntil', { time: dayjs(n.pausedUntil).format(`${t('time.dateFormat')} ${t('time.timeFormat')}`) })}
            </div>
            <Button size="sm" variant="outline" onClick={() => setNotifications({ pausedUntil: null })}>
              {t('settings.resume')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {pauseOptions().map((o) => (
              <Button
                key={o.label}
                size="sm"
                variant="outline"
                onClick={() => setNotifications({ pausedUntil: o.until })}
              >
                {o.label}
              </Button>
            ))}
          </div>
        )}
      </Section>

      <AccountDefaults />
      <Keywords />
      <NetworkDefaults />
    </>
  );
}

function AccountDefaults() {
  const client = useMatrixClient();
  // Optimistic values until the updated push rules come back through sync.
  const [dmPending, setDmPending] = useState<DmDefault | null>(null);
  const [groupPending, setGroupPending] = useState<GroupDefault | null>(null);
  usePushRulesVersion(() => {
    setDmPending(null);
    setGroupPending(null);
  });
  const dm = dmPending ?? getDmDefault(client);
  const group = groupPending ?? getGroupDefault(client);

  const changeDm = (value: DmDefault) => {
    setDmPending(value);
    setDmDefault(client, value).catch((err) => {
      setDmPending(null);
      toast.error(t('settings.settingSaveFailed', { error: errorMessage(err) }));
    });
  };
  const changeGroup = (value: GroupDefault) => {
    setGroupPending(value);
    setGroupDefault(client, value).catch((err) => {
      setGroupPending(null);
      toast.error(t('settings.settingSaveFailed', { error: errorMessage(err) }));
    });
  };

  return (
    <Section
      title={t('settings.accountDefaults')}
      description={t('settings.accountDefaultsDescription')}
    >
      <Row label={t('shell.sectionDms')}>
        <Select value={dm} onValueChange={(v) => changeDm(v as DmDefault)}>
          <SelectTrigger size="sm" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('matrix.notifyAll')}</SelectItem>
            <SelectItem value="none">{t('settings.notifyNone')}</SelectItem>
          </SelectContent>
        </Select>
      </Row>
      <Row label={t('shell.sectionGroups')}>
        <Select value={group} onValueChange={(v) => changeGroup(v as GroupDefault)}>
          <SelectTrigger size="sm" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('matrix.notifyAll')}</SelectItem>
            <SelectItem value="mentions">{t('matrix.notifyMentions')}</SelectItem>
          </SelectContent>
        </Select>
      </Row>
    </Section>
  );
}

function Keywords() {
  const client = useMatrixClient();
  usePushRulesVersion();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const rules = getKeywordRules(client);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const keyword = value.trim();
    if (!keyword) return;
    if (rules.some((r) => r.pattern?.toLowerCase() === keyword.toLowerCase())) {
      setValue('');
      return;
    }
    setBusy(true);
    try {
      await addKeyword(client, keyword);
      setValue('');
    } catch (err) {
      toast.error(t('settings.keywordAddFailed', { error: errorMessage(err) }));
    } finally {
      setBusy(false);
    }
  };

  const remove = (ruleId: string) =>
    removeKeyword(client, ruleId).catch((err) =>
      toast.error(t('settings.keywordRemoveFailed', { error: errorMessage(err) })),
    );

  return (
    <Section
      title={t('settings.keywords')}
      description={t('settings.keywordsDescription')}
    >
      {rules.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {rules.map((r) => (
            <span
              key={r.rule_id}
              className="inline-flex items-center gap-1 rounded-md border bg-muted/50 py-0.5 pr-1 pl-2 text-[13px]"
            >
              {r.pattern}
              <button
                type="button"
                onClick={() => remove(r.rule_id)}
                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={t('settings.removeKeyword', { keyword: r.pattern ?? '' })}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <form onSubmit={add} className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('settings.addKeyword')}
          className="h-8 max-w-[260px]"
        />
        <Button type="submit" size="sm" variant="outline" disabled={busy || !value.trim()}>
          <Plus />
          {t('common.add')}
        </Button>
      </form>
    </Section>
  );
}

function NetworkDefaults() {
  const networks = useRooms((s) => s.networks);
  const settings = useSettings((s) => s.notifications.networks);
  const setNetworkNotify = useSettings((s) => s.setNetworkNotify);

  return (
    <Section
      title={t('settings.byNetwork')}
      description={t('settings.byNetworkDescription')}
    >
      {networks.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t('settings.noNetworks')}</p>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <div className="grid grid-cols-[1fr_150px_150px] gap-3 border-b bg-muted/50 px-3 py-1.5 text-[12px] font-medium text-muted-foreground">
            <span>{t('settings.network')}</span>
            <span>{t('shell.sectionDms')}</span>
            <span>{t('shell.sectionGroups')}</span>
          </div>
          {networks.map((network) => {
            const value = settings[network.id] ?? { dm: 'default', group: 'default' };
            return (
              <div
                key={network.id}
                className="grid grid-cols-[1fr_150px_150px] items-center gap-3 border-b px-3 py-2 last:border-b-0"
              >
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <NetworkIcon
                    networkId={network.id}
                    avatarMxc={network.avatarMxc}
                    name={network.name}
                    size={20}
                  />
                  <span className="truncate">{network.name}</span>
                </span>
                <LevelSelect
                  value={value.dm}
                  onChange={(dm) => setNetworkNotify(network.id, { dm })}
                  label={t('settings.networkDmsLabel', { network: network.name })}
                />
                <LevelSelect
                  value={value.group}
                  onChange={(group) => setNetworkNotify(network.id, { group })}
                  label={t('settings.networkGroupsLabel', { network: network.name })}
                />
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-2 text-[13px] text-muted-foreground">
        {t('settings.perChatOverride')}
      </p>
    </Section>
  );
}

function LevelSelect({
  value,
  onChange,
  label,
}: {
  value: NetworkNotifyDefault;
  onChange: (value: NetworkNotifyDefault) => void;
  label: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as NetworkNotifyDefault)}>
      <SelectTrigger size="sm" className="w-full" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {NOTIFY_LEVELS.map((level) => (
          <SelectItem key={level} value={level}>
            {notifyLevelLabel(level)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
