import dayjs from 'dayjs';
import 'dayjs/locale/cs';
import 'dayjs/locale/sk';
import { type LanguagePref, useSettings } from '@/store/settings';
import type { Locale, Message } from './define';
import activity from './messages/activity';
import app from './messages/app';
import bridges from './messages/bridges';
import common from './messages/common';
import composer from './messages/composer';
import crypto from './messages/crypto';
import desktop from './messages/desktop';
import details from './messages/details';
import emoji from './messages/emoji';
import later from './messages/later';
import matrix from './messages/matrix';
import newChat from './messages/newChat';
import notifications from './messages/notifications';
import room from './messages/room';
import search from './messages/search';
import settings from './messages/settings';
import shell from './messages/shell';
import status from './messages/status';
import time from './messages/time';

export type { Locale } from './define';

const catalogs = {
  common,
  time,
  app,
  status,
  shell,
  settings,
  notifications,
  matrix,
  room,
  search,
  composer,
  emoji,
  crypto,
  details,
  desktop,
  bridges,
  newChat,
  later,
  activity,
};

type Catalogs = typeof catalogs;

/** `namespace.key`, checked against the Czech catalog. */
export type MessageKey = {
  [N in keyof Catalogs]: `${N & string}.${keyof Catalogs[N]['cs'] & string}`;
}[keyof Catalogs];

export type Params = Record<string, string | number>;

export const LOCALES: { value: Locale; label: string }[] = [
  { value: 'cs', label: 'Čeština' },
  { value: 'sk', label: 'Slovenčina' },
  { value: 'en', label: 'English' },
];

/** First supported language from the OS preferences; English otherwise. */
export function systemLocale(): Locale {
  const langs = typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]);
  for (const lang of langs) {
    const base = lang.toLowerCase().split('-')[0];
    if (base === 'cs' || base === 'sk' || base === 'en') return base;
  }
  return 'en';
}

export function resolveLocale(pref: LanguagePref): Locale {
  return pref === 'system' ? systemLocale() : pref;
}

let current: Locale = 'cs';
let pluralRules = new Intl.PluralRules('cs');

function apply(locale: Locale) {
  current = locale;
  pluralRules = new Intl.PluralRules(locale);
  dayjs.locale(locale);
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}

apply(resolveLocale(useSettings.getState().language));
// Registered before any component subscribes, so `t()` already uses the new language when React re-renders.
useSettings.subscribe((s) => {
  const locale = resolveLocale(s.language);
  if (locale !== current) apply(locale);
});

export function getLocale(): Locale {
  return current;
}

/** Current language; components that call it re-render when the language changes. */
export function useLocale(): Locale {
  return useSettings((s) => resolveLocale(s.language));
}

function lookup(key: string): Message | undefined {
  const dot = key.indexOf('.');
  const catalog = catalogs[key.slice(0, dot) as keyof Catalogs] as
    | Record<Locale, Record<string, Message>>
    | undefined;
  const name = key.slice(dot + 1);
  return catalog?.[current]?.[name] ?? catalog?.cs[name];
}

/** Picks the plural form and returns the raw template (with `{param}` placeholders). */
export function template(key: MessageKey, count?: number): string {
  const msg = lookup(key);
  if (msg === undefined) return key;
  if (typeof msg === 'string') return msg;
  const form = pluralRules.select(count ?? 0) as keyof typeof msg;
  return msg[form] ?? msg.other;
}

/**
 * Translated string. `{name}` placeholders are replaced from `params`;
 * plural messages choose their form from `params.count`.
 */
export function t(key: MessageKey, params?: Params): string {
  const count = typeof params?.count === 'number' ? params.count : undefined;
  const str = template(key, count);
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}
