import { t } from '@/i18n';
import { dayjs } from '@/lib/time';

export interface WhenPreset {
  key: string;
  label: string;
  at: number;
}

/** Quick picks for reminders and scheduled messages, relative to now. */
export function whenPresets(): WhenPreset[] {
  const now = dayjs();
  const morning = (d: dayjs.Dayjs) => d.hour(9).minute(0).second(0).millisecond(0);
  const presets: WhenPreset[] = [
    { key: '30m', label: t('later.in30Minutes'), at: now.add(30, 'minute').valueOf() },
    { key: '1h', label: t('later.in1Hour'), at: now.add(1, 'hour').valueOf() },
    { key: '3h', label: t('later.in3Hours'), at: now.add(3, 'hour').valueOf() },
  ];
  if (now.hour() < 17) {
    presets.push({ key: 'evening', label: t('later.thisEvening'), at: now.hour(19).minute(0).second(0).millisecond(0).valueOf() });
  }
  presets.push({ key: 'tomorrow', label: t('later.tomorrow'), at: morning(now.add(1, 'day')).valueOf() });
  // Next Monday; on a weekend that is the start of the coming week anyway.
  const monday = morning(now.add(((8 - now.day()) % 7) || 7, 'day'));
  presets.push({ key: 'nextWeek', label: t('later.nextWeek'), at: monday.valueOf() });
  return presets;
}

/** "dnes 14:30", "zítra 9:00", "po 9:00", "12. 3. 9:00". */
export function formatWhen(ts: number): string {
  const d = dayjs(ts);
  const time = d.format(t('time.timeFormat'));
  if (d.isToday()) return t('later.todayAt', { time });
  if (d.isSame(dayjs().add(1, 'day'), 'day')) return t('later.tomorrowAt', { time });
  if (d.diff(dayjs(), 'day') < 6) return `${d.format(t('time.weekdayFormat'))} ${time}`;
  return `${d.format(d.year() === dayjs().year() ? t('time.dateFormat') : t('time.dateYearFormat'))} ${time}`;
}

/** Value for `<input type="datetime-local">` in local time. */
export function toLocalInput(ts: number): string {
  return dayjs(ts).format('YYYY-MM-DDTHH:mm');
}
