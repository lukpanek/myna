import type { Update } from '@tauri-apps/plugin-updater';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { create } from 'zustand';
import { t } from '@/i18n';
import { useSettings } from '@/store/settings';
import { isTauri } from './platform';

/**
 * In-app updates from GitHub Releases (`plugins.updater` in tauri.conf.json,
 * published by src-tauri/scripts/release.sh). Checks shortly after start and
 * then every few hours; a found update is offered in a toast and in Settings → General.
 */

const FIRST_CHECK_DELAY = 15_000;
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
const TOAST_ID = 'myna-update';

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'upToDate'; checkedAt: number }
  | { kind: 'available'; version: string; notes?: string }
  | { kind: 'downloading'; version: string; progress: number | null }
  | { kind: 'ready'; version: string }
  | { kind: 'error'; message: string };

interface UpdaterState {
  status: UpdateStatus;
}

export const useUpdater = create<UpdaterState>(() => ({ status: { kind: 'idle' } }));

/** Only release builds of the desktop app update themselves. */
export const updatesSupported = isTauri && !import.meta.env.DEV;

let pending: Update | null = null;

function setStatus(status: UpdateStatus) {
  useUpdater.setState({ status });
}

function errorText(err: unknown): string {
  return err instanceof Error && err.message ? err.message : String(err);
}

/** Asks the release feed for a newer version. `silent` = no status on "up to date" or errors (background checks). */
export async function checkForUpdates({ silent = false } = {}): Promise<void> {
  if (!updatesSupported) return;
  const current = useUpdater.getState().status.kind;
  if (current === 'checking' || current === 'downloading' || current === 'ready') return;
  if (!silent) setStatus({ kind: 'checking' });
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (!update) {
      pending = null;
      if (!silent) setStatus({ kind: 'upToDate', checkedAt: Date.now() });
      return;
    }
    const known = pending?.version === update.version;
    pending = update;
    setStatus({ kind: 'available', version: update.version, notes: update.body });
    if (!known) announce(update.version);
  } catch (err) {
    console.warn('Update check failed', err);
    if (!silent) setStatus({ kind: 'error', message: errorText(err) });
  }
}

function announce(version: string) {
  toast(t('desktop.updateAvailable', { version }), {
    id: TOAST_ID,
    duration: Infinity,
    description: t('desktop.updateAvailableDescription'),
    action: { label: t('desktop.updateInstall'), onClick: () => void installUpdate() },
  });
}

/** Downloads and installs the found update, then restarts the app. */
export async function installUpdate(): Promise<void> {
  const update = pending;
  if (!update) return;
  toast.dismiss(TOAST_ID);
  let total: number | null = null;
  let received = 0;
  setStatus({ kind: 'downloading', version: update.version, progress: null });
  try {
    await update.downloadAndInstall((event) => {
      if (event.event === 'Started') total = event.data.contentLength ?? null;
      else if (event.event === 'Progress') {
        received += event.data.chunkLength;
        setStatus({ kind: 'downloading', version: update.version, progress: total ? received / total : null });
      }
    });
    setStatus({ kind: 'ready', version: update.version });
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } catch (err) {
    console.error('Update failed', err);
    setStatus({ kind: 'error', message: errorText(err) });
    toast.error(t('desktop.updateFailed', { error: errorText(err) }));
  }
}

/** Background update checks; call once at the app root. */
export function useUpdateChecks(): void {
  const enabled = useSettings((s) => s.autoUpdateCheck);
  useEffect(() => {
    if (!updatesSupported || !enabled) return;
    const first = setTimeout(() => void checkForUpdates({ silent: true }), FIRST_CHECK_DELAY);
    const interval = setInterval(() => void checkForUpdates({ silent: true }), CHECK_INTERVAL);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [enabled]);
}
