import dayjs from 'dayjs';
import isToday from 'dayjs/plugin/isToday';
import isYesterday from 'dayjs/plugin/isYesterday';
import { t } from '@/i18n';

dayjs.extend(isToday);
dayjs.extend(isYesterday);

export { dayjs };

/** Room list timestamp: time today, weekday this week, date otherwise. */
export function formatListTime(ts: number): string {
  const d = dayjs(ts);
  if (d.isToday()) return d.format(t('time.timeFormat'));
  if (d.isYesterday()) return t('time.yesterdayShort');
  if (dayjs().diff(d, 'day') < 7) return d.format(t('time.weekdayFormat'));
  if (d.year() === dayjs().year()) return d.format(t('time.dateFormat'));
  return d.format(t('time.dateYearFormat'));
}

export function formatMessageTime(ts: number): string {
  return dayjs(ts).format(t('time.timeFormat'));
}

export function formatFullTime(ts: number): string {
  return dayjs(ts).format(t('time.fullFormat'));
}

/** Sticky day divider label in the timeline. */
export function formatDayDivider(ts: number): string {
  const d = dayjs(ts);
  if (d.isToday()) return t('time.today');
  if (d.isYesterday()) return t('time.yesterday');
  if (d.year() === dayjs().year()) return d.format(t('time.dayFormat'));
  return d.format(t('time.dayYearFormat'));
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function isSameDay(a: number, b: number): boolean {
  return dayjs(a).isSame(b, 'day');
}
