export type Locale = 'cs' | 'sk' | 'en';

/** Plural forms picked with `Intl.PluralRules` from the `count` param. Missing forms fall back to `other`. */
export interface Plural {
  one: string;
  few?: string;
  many?: string;
  other: string;
}

export type Message = string | Plural;

type Translation<C> = { [K in keyof C]: Message };

export interface Catalog<C extends Record<string, Message>> {
  cs: C;
  sk: Translation<C>;
  en: Translation<C>;
}

/**
 * One namespace of UI strings. Czech is the source of truth: Slovak and English
 * must have exactly the same keys (the compiler checks it).
 */
export function defineMessages<C extends Record<string, Message>>(m: {
  cs: C;
  sk: NoInfer<Translation<C>>;
  en: NoInfer<Translation<C>>;
}): Catalog<C> {
  return m;
}
