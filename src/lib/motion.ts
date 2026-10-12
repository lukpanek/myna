import { useSettings } from '@/store/settings';

/** Read at interaction time so both OS and app changes apply immediately. */
export function scrollBehavior(): ScrollBehavior {
  return useSettings.getState().reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'instant'
    : 'smooth';
}
