import { useEffect, useSyncExternalStore } from 'react';
import { useSettings } from '@/store/settings';

const query = typeof window === 'undefined' ? null : window.matchMedia('(prefers-color-scheme: dark)');

function subscribe(cb: () => void) {
  query?.addEventListener('change', cb);
  return () => query?.removeEventListener('change', cb);
}

export function useResolvedTheme(): 'light' | 'dark' {
  const theme = useSettings((s) => s.theme);
  const systemDark = useSyncExternalStore(subscribe, () => !!query?.matches);
  if (theme === 'system') return systemDark ? 'dark' : 'light';
  return theme;
}

/** Applies theme class and font size to <html>. Mount once at the root. */
export function useApplyTheme(): void {
  const resolved = useResolvedTheme();
  const fontSize = useSettings((s) => s.fontSize);
  const interfaceScale = useSettings((s) => s.interfaceScale);
  const highContrast = useSettings((s) => s.highContrast);
  const accessibleNames = useSettings((s) => s.accessibleNames);
  const reduceMotion = useSettings((s) => s.reduceMotion);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);
  useEffect(() => {
    document.documentElement.style.setProperty('--app-font-size', `${fontSize}px`);
  }, [fontSize]);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--interface-scale', String(interfaceScale / 100));
    root.classList.toggle('high-contrast', highContrast);
    root.classList.toggle('accessible-names', accessibleNames);
    root.classList.toggle('reduce-motion', reduceMotion);
  }, [interfaceScale, highContrast, accessibleNames, reduceMotion]);
}
