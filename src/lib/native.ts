import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { MatrixClient } from 'matrix-js-sdk';
import { useEffect } from 'react';
import { isCustomSound, playNotificationSound } from '@/features/notifications/sounds';
import { unreadTotals } from '@/features/shell/room-filters';
import { t } from '@/i18n';
import { useMatrixClient } from '@/matrix/context';
import { useRooms } from '@/matrix/rooms-store';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { isMac, isTauri, isWindows } from './platform';

/**
 * Desktop integration: media protocol session, dock badge, focus tracking,
 * notifications and external links. Every export degrades gracefully in a
 * plain browser (dev).
 */

const NOTIFICATION_CLICK_WINDOW = 10_000;
const BADGE_THROTTLE = 500;

let focused = typeof document === 'undefined' ? true : document.hasFocus();
let lastNotification: { roomId: string; eventId?: string; at: number } | null = null;
let mediaSessionClient: MatrixClient | null = null;

export function isWindowFocused(): boolean {
  return isTauri ? focused : document.hasFocus();
}

function setMediaSession(client: MatrixClient) {
  const accessToken = client.getAccessToken();
  if (!accessToken) return;
  mediaSessionClient = client;
  invoke('set_media_session', { baseUrl: client.baseUrl, accessToken }).catch((err) =>
    console.warn('Nepodařilo se nastavit relaci médií', err),
  );
}

/** The desktop plugin has no click callback: focusing the app shortly after a notification counts as a click. */
function onFocusGained() {
  const n = lastNotification;
  lastNotification = null;
  if (n && Date.now() - n.at < NOTIFICATION_CLICK_WINDOW) useUi.getState().openRoom(n.roomId, { eventId: n.eventId });
}

function externalHref(target: EventTarget | null): string | null {
  const anchor = target instanceof Element ? target.closest('a[href]') : null;
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  const url = anchor.href;
  if (!/^(https?:|mailto:)/i.test(url)) return null;
  if (url.startsWith(window.location.origin + '/')) return null;
  return url;
}

function onLinkClick(e: MouseEvent) {
  // Bubble phase on purpose: components that handle a link themselves (matrix.to
  // permalinks, mentions) call preventDefault first. Rust blocks navigation as a backstop.
  if (e.defaultPrevented || (e.type === 'auxclick' && e.button !== 1)) return;
  const url = externalHref(e.target);
  if (!url) return;
  e.preventDefault();
  void openExternal(url);
}

let badgeTimer: ReturnType<typeof setTimeout> | null = null;
let lastBadge: number | undefined | null = null;
let lastTray = '';
let trayCount = 0;

function unreadCount(): number {
  const rooms = Object.values(useRooms.getState().rooms).filter((r) => !r.isBotRoom);
  return unreadTotals(rooms).highlight;
}

function scheduleBadgeUpdate() {
  if (badgeTimer) return;
  badgeTimer = setTimeout(() => {
    badgeTimer = null;
    const count = unreadCount();
    syncTray(count);
    // The dock badge is macOS/Linux only; Windows would need an overlay icon.
    if (isWindows || (count || undefined) === lastBadge) return;
    lastBadge = count || undefined;
    getCurrentWindow()
      .setBadgeCount(lastBadge)
      .catch(() => {});
  }, BADGE_THROTTLE);
}

function clearBadge() {
  if (badgeTimer) clearTimeout(badgeTimer);
  badgeTimer = null;
  lastBadge = null;
  syncTray(0);
  if (isWindows) return;
  getCurrentWindow()
    .setBadgeCount(undefined)
    .catch(() => {});
}

/** Pushes the tray icon state (on/off, labels, count) to the native side when it changed. */
function syncTray(count = trayCount) {
  trayCount = count;
  const update = {
    enabled: useSettings.getState().trayIcon,
    openLabel: t('app.trayOpen'),
    quitLabel: t('app.trayQuit'),
    tooltip: count > 0 ? t('app.trayTooltipUnread', { count }) : 'Myna',
    count,
  };
  const key = JSON.stringify(update);
  if (key === lastTray) return;
  lastTray = key;
  invoke('update_tray', { update }).catch((err) => console.warn('Tray update failed', err));
}

/** Keeps the tray icon in line with settings (on/off, menu language); call once at the app root. */
export function useTraySync(): void {
  useEffect(() => {
    if (!isTauri) return;
    syncTray();
    return useSettings.subscribe((s, prev) => {
      if (s.trayIcon !== prev.trayIcon || s.language !== prev.language) syncTray();
    });
  }, []);
}

/** Launch at login (OS login item). Desktop app only. */
export async function getAutostart(): Promise<boolean> {
  if (!isTauri) return false;
  const { isEnabled } = await import('@tauri-apps/plugin-autostart');
  return isEnabled();
}

export async function setAutostart(enabled: boolean): Promise<void> {
  const { enable, disable } = await import('@tauri-apps/plugin-autostart');
  await (enabled ? enable() : disable());
}

/** Call once inside the logged-in app shell. */
export function useNativeIntegration(): void {
  const client = useMatrixClient();

  // Media URLs render immediately, so hand over the session during render rather
  // than after the first commit (the Rust side also waits a few seconds).
  if (isTauri && mediaSessionClient !== client) setMediaSession(client);

  useEffect(() => {
    if (!isTauri) return;
    if (mediaSessionClient !== client) setMediaSession(client);
    return () => {
      mediaSessionClient = null;
      invoke('clear_media_session').catch(() => {});
    };
  }, [client]);

  useEffect(() => {
    if (!isTauri) {
      const onFocus = () => onFocusGained();
      window.addEventListener('focus', onFocus);
      return () => window.removeEventListener('focus', onFocus);
    }
    const win = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    win
      .isFocused()
      .then((value) => {
        if (!disposed) focused = value;
      })
      .catch(() => {});
    win
      .onFocusChanged(({ payload }) => {
        const gained = payload && !focused;
        focused = payload;
        if (gained) onFocusGained();
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    scheduleBadgeUpdate();
    const unsubscribe = useRooms.subscribe((s, prev) => {
      if (s.rooms !== prev.rooms) scheduleBadgeUpdate();
    });
    return () => {
      unsubscribe();
      clearBadge();
    };
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    document.addEventListener('click', onLinkClick);
    document.addEventListener('auxclick', onLinkClick);
    return () => {
      document.removeEventListener('click', onLinkClick);
      document.removeEventListener('auxclick', onLinkClick);
    };
  }, []);
}

let permission: Promise<boolean> | null = null;

/** Asks the OS (or browser) for notification permission; cached after the first answer. */
export function requestNotificationPermission(): Promise<boolean> {
  if (!permission) {
    permission = (async () => {
      if (isTauri) {
        // macOS .app: UNUserNotificationCenter (shows the system prompt). null = plugin path.
        const native = await invoke<boolean | null>('notification_permission');
        if (native !== null) return native;
        const { isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification');
        if (await isPermissionGranted()) return true;
        return (await requestPermission()) === 'granted';
      }
      if (typeof Notification === 'undefined') return false;
      if (Notification.permission === 'granted') return true;
      if (Notification.permission === 'denied') return false;
      return (await Notification.requestPermission()) === 'granted';
    })().catch(() => false);
    // A refusal may be reversed in system settings; ask again next time.
    void permission.then((granted) => {
      if (!granted) permission = null;
    });
  }
  return permission;
}

function soundName(): string {
  if (isMac) return 'NSUserNotificationDefaultSoundName';
  if (isWindows) return 'Default';
  return 'message-new-instant';
}

export async function showNotification(o: {
  title: string;
  body: string;
  roomId: string;
  /** Event to jump to when the notification is clicked. */
  eventId?: string;
  sound: boolean;
}): Promise<void> {
  if (!(await requestNotificationPermission())) return;
  // Custom sounds play in the app; the OS notification itself stays silent.
  const { soundId, soundVolume } = useSettings.getState().notifications;
  const custom = o.sound && isCustomSound(soundId);
  const systemSound = o.sound && !custom;
  if (custom) void playNotificationSound(soundId, soundVolume).catch(() => undefined);
  if (isTauri) {
    const sent = await invoke<boolean>('native_notify', {
      title: o.title,
      body: o.body,
      sound: systemSound,
      group: o.roomId,
    }).catch(() => false);
    if (!sent) {
      const { sendNotification } = await import('@tauri-apps/plugin-notification');
      sendNotification({ title: o.title, body: o.body, sound: systemSound ? soundName() : undefined });
    }
    lastNotification = isWindowFocused() ? null : { roomId: o.roomId, eventId: o.eventId, at: Date.now() };
    return;
  }
  const n = new Notification(o.title, { body: o.body, silent: !systemSound, tag: o.roomId });
  n.onclick = () => {
    window.focus();
    useUi.getState().openRoom(o.roomId, { eventId: o.eventId });
    n.close();
  };
}

export async function openExternal(url: string): Promise<void> {
  if (isTauri) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
    return;
  }
  window.open(url, '_blank', 'noopener');
}

/**
 * Opens the network's login page in a separate window and resolves with the
 * requested cookies once they all exist. `null` = the user closed the window.
 */
export async function cookieLogin(o: {
  url: string;
  userAgent?: string;
  cookies: { name: string; domain?: string }[];
  title: string;
}): Promise<Record<string, string> | null> {
  if (!isTauri) return null;
  return invoke<Record<string, string> | null>('open_cookie_login', {
    url: o.url,
    userAgent: o.userAgent ?? null,
    cookies: o.cookies,
    title: o.title,
  });
}
