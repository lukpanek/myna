import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { isMac, isTauri } from './platform';

/** Offered system-wide shortcuts (Tauri accelerators); the first one is the default. */
export const GLOBAL_SHORTCUTS = [
  'CommandOrControl+Alt+M',
  'CommandOrControl+Shift+M',
  'Control+Alt+Space',
  'CommandOrControl+Shift+K',
] as const;

const MAC_SYMBOLS: Record<string, string> = {
  CommandOrControl: '⌘',
  Control: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Space: 'Space',
};

/** Human-readable form: `⌥⌘M` on macOS, `Ctrl+Alt+M` elsewhere. */
export function formatShortcut(accelerator: string): string {
  const parts = accelerator.split('+');
  if (isMac) {
    // macOS order: ⌃ ⌥ ⇧ ⌘, then the key.
    const order = ['Control', 'Alt', 'Shift', 'CommandOrControl'];
    const mods = order.filter((m) => parts.includes(m)).map((m) => MAC_SYMBOLS[m]);
    const key = parts.filter((p) => !order.includes(p)).join('');
    return mods.join('') + (key === 'Space' ? ' Space' : key);
  }
  return parts.map((p) => (p === 'CommandOrControl' || p === 'Control' ? 'Ctrl' : p)).join('+');
}

/** Brings Myna forward (even when hidden in the menu bar) and opens the quick switcher. */
async function summon() {
  const win = getCurrentWindow();
  await win.unminimize().catch(() => undefined);
  await win.show().catch(() => undefined);
  await win.setFocus().catch(() => undefined);
  useUi.setState({ switcherOpen: true });
}

/** Registers the system-wide shortcut from settings; call once at the app root. */
export function useGlobalShortcut(): void {
  const shortcut = useSettings((s) => s.globalShortcut);
  useEffect(() => {
    if (!isTauri || !shortcut) return;
    let disposed = false;
    let registered = false;
    void (async () => {
      const { register, unregister } = await import('@tauri-apps/plugin-global-shortcut');
      // A previous webview session (reload) may still hold it.
      await unregister(shortcut).catch(() => undefined);
      if (disposed) return;
      try {
        await register(shortcut, (event) => {
          if (event.state === 'Pressed') void summon();
        });
        registered = true;
        if (disposed) await unregister(shortcut).catch(() => undefined);
      } catch (err) {
        console.warn('Global shortcut registration failed', err);
        toast.error(t('desktop.shortcutTaken', { shortcut: formatShortcut(shortcut) }));
      }
    })();
    return () => {
      disposed = true;
      if (!registered) return;
      void import('@tauri-apps/plugin-global-shortcut').then(({ unregister }) =>
        unregister(shortcut).catch(() => undefined),
      );
    };
  }, [shortcut]);
}
