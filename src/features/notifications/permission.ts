import { isTauri } from '@/lib/platform';

/**
 * Asks the OS for permission to show notifications. In the desktop app this goes
 * through the Tauri notification plugin; in a browser through the Notification API.
 * Returns false only when the user (or the OS) explicitly refused.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (isTauri) {
    try {
      const { isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification');
      if (await isPermissionGranted()) return true;
      return (await requestPermission()) === 'granted';
    } catch {
      // Plugin not available: the native layer decides when it shows the notification.
      return true;
    }
  }
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}
