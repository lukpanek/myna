import type { MatrixEvent, Room } from 'matrix-js-sdk';

/** Section of an MSC2346 `m.bridge` event (protocol / network / channel). */
interface BridgeSection {
  id?: string;
  displayname?: string;
  avatar_url?: string;
  external_url?: string;
  'fi.mau.receiver'?: string;
  'com.beeper.message_request'?: boolean;
}

interface BridgeContent {
  bridgebot?: string;
  creator?: string;
  protocol?: BridgeSection;
  network?: BridgeSection;
  channel?: BridgeSection;
  'com.beeper.room_type'?: string;
  'com.beeper.room_type.v2'?: string;
}

export interface BridgeInfo {
  /** Stable network key, e.g. `whatsapp`, `signal`, `telegram`. */
  networkId: string;
  networkName: string;
  networkAvatar?: string;
  bridgeBot?: string;
  /** Login ID of the account this portal belongs to (bridgev2 `fi.mau.receiver`). */
  receiver?: string;
  /** Sub-grouping inside a network: Discord guild, Slack workspace, Telegram folder… */
  group?: { id: string; name: string; avatar?: string };
  /** `dm`, `group_dm`, `space` or undefined for regular group chats. */
  roomType?: string;
  messageRequest: boolean;
}

const BRIDGE_TYPES = ['m.bridge', 'uk.half-shot.bridge'];

function firstBridgeEvent(room: Room): MatrixEvent | undefined {
  const state = room.currentState;
  for (const type of BRIDGE_TYPES) {
    const events = state.getStateEvents(type);
    const found = events.find((e) => {
      const c = e.getContent<BridgeContent>();
      return c.protocol?.id || c.bridgebot;
    });
    if (found) return found;
  }
  return undefined;
}

export function getBridgeInfo(room: Room): BridgeInfo | null {
  const event = firstBridgeEvent(room);
  if (!event) return null;
  const c = event.getContent<BridgeContent>();
  const networkId = (c.protocol?.id || event.getStateKey() || c.bridgebot || 'bridge').toLowerCase();
  const roomType = c['com.beeper.room_type.v2'] || c['com.beeper.room_type'] || undefined;
  return {
    networkId,
    networkName: c.protocol?.displayname || prettyNetworkName(networkId),
    networkAvatar: c.protocol?.avatar_url || undefined,
    bridgeBot: c.bridgebot,
    receiver: c.channel?.['fi.mau.receiver'] || undefined,
    group: c.network?.id
      ? { id: c.network.id, name: c.network.displayname || c.network.id, avatar: c.network.avatar_url }
      : undefined,
    roomType,
    messageRequest: !!c.channel?.['com.beeper.message_request'],
  };
}

const KNOWN_NAMES: Record<string, string> = {
  whatsapp: 'WhatsApp',
  signal: 'Signal',
  telegram: 'Telegram',
  facebook: 'Messenger',
  messenger: 'Messenger',
  instagram: 'Instagram',
  meta: 'Meta',
  discord: 'Discord',
  slack: 'Slack',
  googlechat: 'Google Chat',
  gmessages: 'Google Messages',
  imessage: 'iMessage',
  linkedin: 'LinkedIn',
  twitter: 'X',
  bluesky: 'Bluesky',
  gvoice: 'Google Voice',
};

export function prettyNetworkName(id: string): string {
  return KNOWN_NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

/** Brand-ish colors for the fallback network badge when the bridge sent no avatar. */
const NETWORK_COLORS: Record<string, string> = {
  whatsapp: '#25D366',
  signal: '#3A76F0',
  telegram: '#2AABEE',
  facebook: '#0866FF',
  messenger: '#0866FF',
  instagram: '#E1306C',
  meta: '#0866FF',
  discord: '#5865F2',
  slack: '#4A154B',
  googlechat: '#00AC47',
  gmessages: '#1A73E8',
  imessage: '#34C759',
  linkedin: '#0A66C2',
  twitter: '#000000',
  bluesky: '#1185FE',
  matrix: '#0DBD8B',
};

export function networkColor(id: string): string {
  return NETWORK_COLORS[id] ?? '#71717a';
}
