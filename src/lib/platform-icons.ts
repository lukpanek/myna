import {
  siBluesky,
  siDiscord,
  siFacebook,
  siGooglechat,
  siGooglemessages,
  siImessage,
  siInstagram,
  siKakaotalk,
  siLine,
  siMatrix,
  siSignal,
  siTelegram,
  siThreads,
  siViber,
  siWechat,
  siWhatsapp,
  siX,
  type SimpleIcon,
} from 'simple-icons';

/** Built-in platform logo for network icons. `path` is a 24×24 SVG path; `glyph` is text for brands without one. */
export interface PlatformIcon {
  id: string;
  name: string;
  color: string;
  path?: string;
  glyph?: string;
}

function fromSimple(id: string, icon: SimpleIcon, name = icon.title): PlatformIcon {
  return { id, name, color: `#${icon.hex}`, path: icon.path };
}

// Classic Messenger bubble (oval with a bottom-left tail, bolt cut out), closer to the
// familiar logo than the simple-icons outline.
const MESSENGER_PATH =
  'M4.47 19.53A12 10.98 0 1 1 8.78 21.56L4.47 23.76ZM4 14.5 9.96 11.52 12.78 14.5 19.36 7.84 13.25 10.82 10.43 7.84Z';

// Slack and LinkedIn are not in simple-icons (trademark policy), so they get a glyph tile.
export const PLATFORMS: PlatformIcon[] = [
  fromSimple('whatsapp', siWhatsapp),
  fromSimple('signal', siSignal),
  fromSimple('telegram', siTelegram),
  { id: 'messenger', name: 'Messenger', color: '#0084FF', path: MESSENGER_PATH },
  fromSimple('facebook', siFacebook),
  fromSimple('instagram', siInstagram),
  fromSimple('discord', siDiscord),
  { id: 'slack', name: 'Slack', color: '#4A154B', glyph: '#' },
  fromSimple('googlechat', siGooglechat, 'Google Chat'),
  fromSimple('gmessages', siGooglemessages, 'Google Messages'),
  fromSimple('imessage', siImessage),
  { id: 'linkedin', name: 'LinkedIn', color: '#0A66C2', glyph: 'in' },
  fromSimple('twitter', siX, 'X'),
  fromSimple('bluesky', siBluesky),
  fromSimple('threads', siThreads),
  fromSimple('line', siLine, 'LINE'),
  fromSimple('kakaotalk', siKakaotalk, 'KakaoTalk'),
  fromSimple('wechat', siWechat, 'WeChat'),
  fromSimple('viber', siViber),
  fromSimple('matrix', siMatrix, 'Matrix'),
];

const BY_ID = new Map(PLATFORMS.map((p) => [p.id, p]));

/** Other ids and words bridges use for the same platform. */
const ALIASES: Record<string, string> = {
  meta: 'messenger',
  fb: 'messenger',
  x: 'twitter',
  googlemessages: 'gmessages',
  gmsg: 'gmessages',
  gchat: 'googlechat',
  kakao: 'kakaotalk',
  bsky: 'bluesky',
};

export function platformById(id: string): PlatformIcon | undefined {
  return BY_ID.get(id);
}

/** Recognizes the platform from the bridge's network id (e.g. `whatsapp`, `mautrix-signal`) or display name. */
export function detectPlatform(networkId: string, name?: string): PlatformIcon | undefined {
  const id = networkId.toLowerCase();
  const exact = BY_ID.get(ALIASES[id] ?? id);
  if (exact) return exact;
  const haystack = `${id} ${name ?? ''}`.toLowerCase().replace(/[\s_.-]+/g, ' ');
  const words = haystack.split(' ');
  for (const word of words) {
    const hit = BY_ID.get(ALIASES[word] ?? word);
    if (hit) return hit;
  }
  const compact = haystack.replace(/ /g, '');
  // Longest ids first so "googlechat" wins over "chat"-like partial matches.
  for (const p of [...PLATFORMS].sort((a, b) => b.id.length - a.id.length)) {
    if (compact.includes(p.id)) return p;
  }
  return undefined;
}

/** Dark glyph on light brand colors (KakaoTalk yellow), white otherwise. */
export function glyphColor(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.7 ? '#191919' : '#ffffff';
}
