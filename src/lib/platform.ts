import { isTauri as tauriCheck } from '@tauri-apps/api/core';

export const isTauri = tauriCheck();

const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
export const isMac = /Mac OS X|Macintosh/.test(ua);
export const isWindows = /Windows/.test(ua);

/** Display label for the primary modifier: ⌘ on macOS, Ctrl elsewhere. */
export const modKey = isMac ? '⌘' : 'Ctrl';

/** Tauri custom protocols are `scheme://localhost` on macOS/Linux and `http://scheme.localhost` on Windows. */
export function customProtocolBase(scheme: string): string {
  return isWindows ? `http://${scheme}.localhost` : `${scheme}://localhost`;
}
