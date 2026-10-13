import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_NOTIFICATION_SOUND, type NotificationSoundId } from '@/features/notifications/sounds';
import type { Locale } from '@/i18n/define';
import type { NotifyLevel } from '@/matrix/push-rules';

export type Theme = 'system' | 'light' | 'dark';
/** UI language; `system` follows the OS preference. */
export type LanguagePref = 'system' | Locale;
export type ListDensity = 'compact' | 'comfortable';
/** Notification default for a whole network; `default` defers to account push rules. */
export type NetworkNotifyDefault = Exclude<NotifyLevel, 'all'> | 'all';

export interface NetworkNotifySettings {
  dm: NetworkNotifyDefault;
  group: NetworkNotifyDefault;
}

/** Icon override for a network; no entry = automatic (platform logo, else bridge avatar). */
export type NetworkIconChoice =
  | { kind: 'platform'; id: string }
  | { kind: 'bridge' }
  /** Uploaded image, downscaled to a small data URL. */
  | { kind: 'custom'; dataUrl: string };

export interface Settings {
  language: LanguagePref;
  theme: Theme;
  /** Room list: compact rows (Slack) or two-line rows with message preview. */
  density: ListDensity;
  /** Message and list text size in % of BASE_FONT_SIZE. */
  fontScale: number;
  interfaceScale: number;
  groupRooms: boolean;
  showRoomIcons: boolean;
  highContrast: boolean;
  accessibleNames: boolean;
  reduceMotion: boolean;
  showSystemEvents: boolean;
  showReadReceipts: boolean;
  showMediaPreviews: boolean;
  /** Cards and players (YouTube, Spotify…) under messages with links. */
  showLinkPreviews: boolean;
  /** Menu bar / tray icon with the unread count; closing the window keeps the app running. */
  trayIcon: boolean;
  /** Shift+Enter sends instead of Enter. */
  sendWithShift: boolean;
  recentEmoji: string[];
  /** Old history a bridge copies into a new chat is marked read (private receipt). */
  markBridgeHistoryRead: boolean;

  notifications: {
    enabled: boolean;
    sound: boolean;
    /** Which sound plays; custom ones are synthesized in the app, `system` = OS default. */
    soundId: NotificationSoundId;
    /** Volume of custom sounds, 0–100. */
    soundVolume: number;
    showContent: boolean;
    /** Epoch ms until which notifications are paused (Slack "Pause notifications"). */
    pausedUntil: number | null;
    networks: Record<string, NetworkNotifySettings>;
  };

  networkIcons: Record<string, NetworkIconChoice>;
  /** User's own names for networks; no entry = the name the bridge announces. */
  networkNames: Record<string, string>;

  bridges: {
    /** Provisioning API URLs added by hand, in addition to .well-known discovery. */
    manualUrls: string[];
  };
}

interface SettingsActions {
  set: (patch: Partial<Settings>) => void;
  setNotifications: (patch: Partial<Settings['notifications']>) => void;
  setNetworkNotify: (networkId: string, patch: Partial<NetworkNotifySettings>) => void;
  pushRecentEmoji: (emoji: string) => void;
  addBridgeUrl: (url: string) => void;
  removeBridgeUrl: (url: string) => void;
  setNetworkIcon: (networkId: string, choice: NetworkIconChoice | null) => void;
  setNetworkName: (networkId: string, name: string | null) => void;
}

/** Text size (px) at 100 % font scale. */
export const BASE_FONT_SIZE = 15;
export const FONT_SCALES = [85, 90, 100, 110, 125, 150, 175];

export function fontSizePx(fontScale: number): number {
  return (BASE_FONT_SIZE * fontScale) / 100;
}

/** Nearest offered scale to an old pixel size (settings version 1 stored px). */
function scaleFromPx(px: number): number {
  const wanted = (px / BASE_FONT_SIZE) * 100;
  return FONT_SCALES.reduce((best, s) => (Math.abs(s - wanted) < Math.abs(best - wanted) ? s : best), 100);
}

export const DEFAULT_RECENT_EMOJI = ['👍', '❤️', '😂', '🙏', '👀', '🎉'];

export const useSettings = create<Settings & SettingsActions>()(
  persist(
    (set) => ({
      language: 'system',
      theme: 'system',
      density: 'comfortable',
      fontScale: 100,
      interfaceScale: 100,
      groupRooms: true,
      showRoomIcons: true,
      highContrast: false,
      accessibleNames: false,
      reduceMotion: false,
      showSystemEvents: false,
      showReadReceipts: true,
      showMediaPreviews: true,
      showLinkPreviews: true,
      trayIcon: true,
      sendWithShift: false,
      recentEmoji: DEFAULT_RECENT_EMOJI,
      markBridgeHistoryRead: true,
      notifications: {
        enabled: true,
        sound: true,
        soundId: DEFAULT_NOTIFICATION_SOUND,
        soundVolume: 70,
        showContent: true,
        pausedUntil: null,
        networks: {},
      },
      networkIcons: {},
      networkNames: {},
      bridges: { manualUrls: [] },

      set: (patch) => set(patch),
      setNotifications: (patch) => set((s) => ({ notifications: { ...s.notifications, ...patch } })),
      setNetworkNotify: (networkId, patch) =>
        set((s) => {
          const prev = s.notifications.networks[networkId] ?? { dm: 'default', group: 'default' };
          return {
            notifications: {
              ...s.notifications,
              networks: { ...s.notifications.networks, [networkId]: { ...prev, ...patch } },
            },
          };
        }),
      pushRecentEmoji: (emoji) =>
        set((s) => ({ recentEmoji: [emoji, ...s.recentEmoji.filter((e) => e !== emoji)].slice(0, 24) })),
      addBridgeUrl: (url) =>
        set((s) => ({
          bridges: { manualUrls: [...new Set([...s.bridges.manualUrls, url.replace(/\/+$/, '')])] },
        })),
      removeBridgeUrl: (url) =>
        set((s) => ({ bridges: { manualUrls: s.bridges.manualUrls.filter((u) => u !== url) } })),
      setNetworkIcon: (networkId, choice) =>
        set((s) => {
          const networkIcons = { ...s.networkIcons };
          if (choice) networkIcons[networkId] = choice;
          else delete networkIcons[networkId];
          return { networkIcons };
        }),
      setNetworkName: (networkId, name) =>
        set((s) => {
          const networkNames = { ...s.networkNames };
          if (name) networkNames[networkId] = name;
          else delete networkNames[networkId];
          return { networkNames };
        }),
    }),
    {
      name: 'myna.settings',
      version: 2,
      // v2: font size in % instead of px.
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Record<string, unknown>;
        if (version < 2 && typeof state.fontSize === 'number') {
          state.fontScale = scaleFromPx(state.fontSize);
          delete state.fontSize;
        }
        return state as unknown as Settings & SettingsActions;
      },
      // Nested groups are merged so fields added later get their defaults.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Settings>;
        return { ...current, ...p, notifications: { ...current.notifications, ...p.notifications } };
      },
    },
  ),
);
