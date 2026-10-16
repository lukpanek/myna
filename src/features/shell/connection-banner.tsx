import { CheckCircle2, CloudOff, WifiOff } from 'lucide-react';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import { useConnection } from '@/matrix/connection';
import { useMatrixClient } from '@/matrix/context';

/** Strip under the top bar while the network or the homeserver is down; briefly confirms recovery. */
export function ConnectionBanner() {
  const client = useMatrixClient();
  const state = useConnection((s) => s.state);
  const restored = useConnection((s) => s.restored);
  const unsent = useConnection((s) => s.unsent);

  if (state === 'online' && !restored) return null;

  if (state === 'online') {
    return (
      <div role="status" className={cn(BAR, 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400')}>
        <CheckCircle2 className="size-3.5 shrink-0" />
        <span>{t('desktop.connectionRestored')}</span>
      </div>
    );
  }

  const host = new URL(client.getHomeserverUrl()).host;
  const Icon = state === 'offline' ? WifiOff : CloudOff;
  return (
    <div role="status" className={cn(BAR, 'bg-amber-500/15 text-amber-800 dark:text-amber-300')}>
      <Icon className="size-3.5 shrink-0" />
      <span className="font-medium">
        {state === 'offline' ? t('desktop.offline') : t('desktop.serverUnreachable', { host })}
      </span>
      <span className="truncate opacity-80">
        {unsent > 0 ? t('desktop.unsentWaiting', { count: unsent }) : t('desktop.reconnecting')}
      </span>
      {state === 'unreachable' && (
        <button
          type="button"
          onClick={() => client.retryImmediately()}
          className="ml-1 shrink-0 font-medium underline-offset-2 hover:underline"
        >
          {t('desktop.retryNow')}
        </button>
      )}
    </div>
  );
}

const BAR = 'flex h-7 shrink-0 items-center justify-center gap-2 px-4 text-[12.5px]';
