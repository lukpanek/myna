/**
 * Emoji dataset (emojibase, English CLDR labels + iamcal/emojibase shortcodes),
 * loaded lazily with dynamic `import()` so it stays out of the startup bundle.
 * emojibase ships no Czech locale, so a small hand-written keyword list covers
 * the emoji people actually search for in Czech.
 */

export interface EmojiItem {
  /** Fully-qualified unicode form (what Matrix clients and bridges expect). */
  unicode: string;
  label: string;
  shortcodes: string[];
  group: number;
  order: number;
  /** Shortcodes + Czech keywords, normalized (lowercase, no diacritics). */
  primary: string[];
  /** Label words + tags, normalized. */
  secondary: string[];
  haystack: string;
}

export interface EmojiGroup {
  id: number;
  /** Message key in the `emoji` namespace; translated where it is rendered. */
  labelKey:
    | 'groupSmileys'
    | 'groupPeople'
    | 'groupAnimals'
    | 'groupFood'
    | 'groupTravel'
    | 'groupActivities'
    | 'groupObjects'
    | 'groupSymbols'
    | 'groupFlags';
}

export const EMOJI_GROUPS: EmojiGroup[] = [
  { id: 0, labelKey: 'groupSmileys' },
  { id: 1, labelKey: 'groupPeople' },
  { id: 3, labelKey: 'groupAnimals' },
  { id: 4, labelKey: 'groupFood' },
  { id: 5, labelKey: 'groupTravel' },
  { id: 6, labelKey: 'groupActivities' },
  { id: 7, labelKey: 'groupObjects' },
  { id: 8, labelKey: 'groupSymbols' },
  { id: 9, labelKey: 'groupFlags' },
];

export interface EmojiData {
  list: EmojiItem[];
  byGroup: Map<number, EmojiItem[]>;
  byShortcode: Map<string, EmojiItem>;
  byUnicode: Map<string, EmojiItem>;
}

interface RawEmoji {
  hexcode: string;
  label: string;
  unicode: string;
  group?: number;
  order?: number;
  tags?: string[];
}

type ShortcodeSet = Record<string, string | string[]>;

const CS_KEYWORDS: Record<string, string> = {
  '😀': 'úsměv smích radost šťastný',
  '😃': 'úsměv radost šťastný',
  '😄': 'úsměv smích radost',
  '😁': 'úšklebek zuby úsměv',
  '😆': 'smích chechtání',
  '😅': 'pot úleva smích nervózní',
  '🤣': 'smích válím se řehot',
  '😂': 'smích slzy brečím smíchy řehot',
  '🙂': 'úsměv pousmání',
  '🙃': 'vzhůru nohama ironie',
  '😉': 'mrk mrknutí',
  '😊': 'úsměv červenám se stydlivý',
  '😇': 'andílek svatoušek nevinný',
  '🥰': 'zamilovaný srdíčka láska',
  '😍': 'zamilovaný srdce oči láska',
  '🤩': 'hvězdy nadšení wow',
  '😘': 'pusa polibek',
  '😋': 'mňam chutné jazyk',
  '😛': 'jazyk vyplazený',
  '😜': 'jazyk mrk blázen',
  '🤪': 'blázen šílený',
  '🤔': 'přemýšlím hmm myslím',
  '🤗': 'objetí obejmout',
  '🤭': 'ups zakrývám pusu',
  '🤫': 'pst ticho',
  '😐': 'neutrální bez výrazu',
  '😑': 'bez výrazu',
  '😶': 'bez slov mlčím',
  '😏': 'úšklebek ironie',
  '🙄': 'koulím očima protočení',
  '😬': 'trapas grimasa',
  '😌': 'úleva klid',
  '😔': 'smutný zamyšlený',
  '😪': 'ospalý',
  '😴': 'spím spánek zzz',
  '😷': 'rouška nemocný',
  '🤒': 'nemocný horečka teploměr',
  '🤢': 'nevolnost zelený blee',
  '🤮': 'zvracení blee',
  '🥵': 'horko vedro',
  '🥶': 'zima mráz',
  '🤯': 'výbuch hlava šok',
  '🥳': 'oslava párty narozeniny',
  '😎': 'brýle cool pohoda',
  '🤓': 'šprt brýle',
  '😕': 'zmatený nejistý',
  '😟': 'ustaraný',
  '😮': 'překvapení údiv',
  '😯': 'překvapení',
  '😲': 'šok úžas',
  '😳': 'zčervenání trapas',
  '🥺': 'prosím psí oči',
  '😢': 'smutek slza brečím',
  '😭': 'pláč brečím smutek',
  '😱': 'hrůza strach křik',
  '😞': 'zklamaný smutný',
  '😩': 'unavený vyčerpaný',
  '😫': 'unavený',
  '🥱': 'zívání nuda',
  '😤': 'naštvaný frustrace',
  '😡': 'vztek naštvaný zlost',
  '😠': 'naštvaný zlost',
  '🤬': 'nadávky vztek',
  '😈': 'čertík ďábel',
  '💀': 'lebka smrt mrtvý',
  '💩': 'hovínko',
  '🤡': 'klaun',
  '👻': 'duch strašidlo',
  '👽': 'mimozemšťan',
  '🤖': 'robot',
  '😺': 'kočka úsměv',
  '🙈': 'opička nevidím stydím',
  '🙉': 'opička neslyším',
  '🙊': 'opička nemluvím',
  '💋': 'polibek rty',
  '💯': 'sto procent přesně',
  '💥': 'výbuch bum',
  '💤': 'spánek zzz',
  '❤️': 'srdce láska červené',
  '🧡': 'srdce oranžové',
  '💛': 'srdce žluté',
  '💚': 'srdce zelené',
  '💙': 'srdce modré',
  '💜': 'srdce fialové',
  '🖤': 'srdce černé',
  '🤍': 'srdce bílé',
  '💔': 'zlomené srdce',
  '💕': 'srdíčka láska',
  '👋': 'mávání ahoj čau',
  '👌': 'ok dobře',
  '✌️': 'vítězství mír',
  '🤞': 'držím palce',
  '🤘': 'rock metal',
  '👈': 'vlevo ukazuji',
  '👉': 'vpravo ukazuji',
  '👆': 'nahoru',
  '👇': 'dolů',
  '👍': 'palec nahoru líbí souhlas ok',
  '👎': 'palec dolů nelíbí nesouhlas',
  '✊': 'pěst',
  '👊': 'pěst úder',
  '👏': 'potlesk tleskání bravo',
  '🙌': 'hurá oslava ruce',
  '🙏': 'děkuji prosím modlitba díky',
  '💪': 'síla sval biceps',
  '🧠': 'mozek',
  '👀': 'oči koukám',
  '🤷': 'pokrčení nevím',
  '🤦': 'facepalm dlaň',
  '🐶': 'pes pejsek',
  '🐱': 'kočka kočička',
  '🐭': 'myš',
  '🐰': 'králík zajíc',
  '🦊': 'liška',
  '🐻': 'medvěd',
  '🐼': 'panda',
  '🐷': 'prase prasátko',
  '🐔': 'slepice',
  '🐦': 'pták',
  '🐴': 'kůň',
  '🦄': 'jednorožec',
  '🐝': 'včela',
  '🐍': 'had',
  '🐢': 'želva',
  '🐟': 'ryba',
  '🌹': 'růže květina',
  '🌸': 'květ sakura',
  '🌻': 'slunečnice',
  '🌲': 'strom jehličnan',
  '🍀': 'čtyřlístek štěstí',
  '☀️': 'slunce',
  '🌙': 'měsíc',
  '⭐': 'hvězda',
  '🔥': 'oheň hoří',
  '🌈': 'duha',
  '❄️': 'sníh vločka',
  '☔': 'déšť deštník',
  '🍎': 'jablko',
  '🍌': 'banán',
  '🍓': 'jahoda',
  '🍕': 'pizza',
  '🍔': 'hamburger burger',
  '🍟': 'hranolky',
  '🍰': 'dort zákusek',
  '🎂': 'dort narozeniny',
  '🍺': 'pivo',
  '🍻': 'pivo na zdraví přípitek',
  '🍷': 'víno',
  '🥂': 'přípitek šampaňské na zdraví',
  '☕': 'káva kafe',
  '🍵': 'čaj',
  '🚗': 'auto',
  '🚲': 'kolo',
  '✈️': 'letadlo',
  '🚀': 'raketa',
  '🏠': 'dům domov',
  '⚽': 'fotbal míč',
  '🏒': 'hokej',
  '🎉': 'oslava párty konfety',
  '🎊': 'oslava konfety',
  '🎁': 'dárek',
  '🎄': 'vánoce stromeček',
  '🏆': 'pohár vítěz trofej',
  '🥇': 'první zlato medaile',
  '🎵': 'hudba nota',
  '🎶': 'hudba noty',
  '📱': 'mobil telefon',
  '💻': 'počítač notebook',
  '📷': 'foťák fotka',
  '💡': 'nápad žárovka',
  '📌': 'připínáček',
  '📎': 'kancelářská sponka příloha',
  '🔒': 'zámek zamčeno',
  '🔑': 'klíč',
  '💰': 'peníze',
  '💸': 'peníze utrácení',
  '📅': 'kalendář datum',
  '⏰': 'budík čas',
  '✅': 'hotovo ok zaškrtnuto',
  '☑️': 'zaškrtnuto',
  '✔️': 'fajfka hotovo',
  '❌': 'křížek ne chyba',
  '❗': 'vykřičník pozor',
  '❓': 'otazník otázka',
  '⚠️': 'varování pozor',
  '🚫': 'zákaz',
  '➕': 'plus',
  '➖': 'mínus',
  '🆗': 'ok',
  '🇨🇿': 'česko česká republika vlajka',
  '🇸🇰': 'slovensko vlajka',
};

const SKIP_GROUPS = new Set([2]);

let cache: EmojiData | null = null;
let pending: Promise<EmojiData> | null = null;

/**
 * Emoji with Emoji_Presentation do not need VS16; emojibase adds it anyway.
 * Normalizing keeps reaction keys identical to what mautrix bridges and other clients send.
 */
export function normalizeEmoji(emoji: string): string {
  return emoji.replace(/(\p{Emoji_Presentation})️/gu, '$1');
}

export function normalizeText(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

function codes(set: ShortcodeSet, hex: string): string[] {
  const v = set[hex];
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function build(raw: RawEmoji[], iamcal: ShortcodeSet, emojibase: ShortcodeSet): EmojiData {
  const cs = new Map<string, string[]>();
  for (const [emoji, words] of Object.entries(CS_KEYWORDS)) {
    cs.set(normalizeEmoji(emoji), normalizeText(words).split(/\s+/));
  }

  const list: EmojiItem[] = [];
  for (const e of raw) {
    if (e.group === undefined || SKIP_GROUPS.has(e.group)) continue;
    const unicode = normalizeEmoji(e.unicode);
    // Slack users know iamcal shortcodes; emojibase ones add a few aliases.
    const shortcodes = [...new Set([...codes(iamcal, e.hexcode), ...codes(emojibase, e.hexcode)])];
    const primary = [...shortcodes.map(normalizeText), ...(cs.get(unicode) ?? [])];
    const secondary = [...normalizeText(e.label).split(/[\s:,]+/), ...(e.tags ?? []).map(normalizeText)].filter(
      Boolean,
    );
    list.push({
      unicode,
      label: e.label,
      shortcodes,
      group: e.group,
      order: e.order ?? 0,
      primary,
      secondary,
      haystack: [normalizeText(e.label), ...primary, ...secondary].join(' '),
    });
  }
  list.sort((a, b) => a.order - b.order);

  const byGroup = new Map<number, EmojiItem[]>();
  const byShortcode = new Map<string, EmojiItem>();
  const byUnicode = new Map<string, EmojiItem>();
  for (const item of list) {
    const group = byGroup.get(item.group);
    if (group) group.push(item);
    else byGroup.set(item.group, [item]);
    for (const code of item.shortcodes) if (!byShortcode.has(code)) byShortcode.set(code, item);
    byUnicode.set(item.unicode, item);
  }
  return { list, byGroup, byShortcode, byUnicode };
}

/** Loads (once) and returns the emoji dataset. */
export function loadEmojiData(): Promise<EmojiData> {
  if (cache) return Promise.resolve(cache);
  if (!pending) {
    pending = Promise.all([
      import('emojibase-data/en/compact.json'),
      import('emojibase-data/en/shortcodes/iamcal.json'),
      import('emojibase-data/en/shortcodes/emojibase.json'),
    ]).then(([compact, iamcal, emojibase]) => {
      cache = build(
        compact.default as unknown as RawEmoji[],
        iamcal.default as unknown as ShortcodeSet,
        emojibase.default as unknown as ShortcodeSet,
      );
      return cache;
    });
    pending.catch(() => {
      pending = null;
    });
  }
  return pending;
}

/** The dataset if it has already been loaded, without triggering a load. */
export function getEmojiData(): EmojiData | null {
  return cache;
}

/** Lower is better; `Infinity` = no match. */
function scoreToken(item: EmojiItem, token: string): number {
  let best = Infinity;
  for (const w of item.primary) {
    if (w === token) return 0;
    if (best > 1 && w.startsWith(token)) best = 1;
  }
  if (best > 2) {
    for (const w of item.secondary) {
      if (w === token) {
        best = Math.min(best, 1.5);
        break;
      }
      if (best > 2 && w.startsWith(token)) best = 2;
    }
  }
  if (best > 3 && item.haystack.includes(token)) best = 3;
  return best;
}

export function searchEmojiSync(data: EmojiData, query: string, limit: number): EmojiItem[] {
  const tokens = normalizeText(query.trim().replace(/^:|:$/g, '')).split(/[\s_]+/).filter(Boolean);
  if (tokens.length === 0) return [];
  // Underscored shortcodes ("thumbs_up") are matched as a whole first.
  const whole = normalizeText(query.trim().replace(/^:|:$/g, ''));
  const scored: { item: EmojiItem; score: number }[] = [];
  for (const item of data.list) {
    let score = 0;
    if (item.primary.includes(whole)) score = -1;
    else {
      for (const t of tokens) {
        const s = scoreToken(item, t);
        if (s === Infinity) {
          score = Infinity;
          break;
        }
        score = Math.max(score, s);
      }
    }
    if (score !== Infinity) scored.push({ item, score });
  }
  scored.sort((a, b) => a.score - b.score || a.item.order - b.item.order);
  return scored.slice(0, limit).map((s) => s.item);
}

/** Searches labels, tags, shortcodes and Czech keywords. Loads the data on first use. */
export async function searchEmoji(query: string, limit: number): Promise<EmojiItem[]> {
  const data = await loadEmojiData();
  return searchEmojiSync(data, query, limit);
}

/** Exact shortcode lookup (`thumbsup`, `+1`), only once the data is loaded. */
export function emojiByShortcode(code: string): EmojiItem | null {
  return cache?.byShortcode.get(code.toLowerCase()) ?? null;
}
