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
  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);
  useEffect(() => {
    document.documentElement.style.setProperty('--app-font-size', `${fontSize}px`);
  }, [fontSize]);
}
