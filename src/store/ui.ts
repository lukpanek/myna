import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** What the rail selected: the unified inbox, one bridged network, native Matrix rooms or a space. */
export type View =
  | { kind: 'all' }
  | { kind: 'network'; networkId: string }
  | { kind: 'matrix' }
  | { kind: 'space'; spaceId: string };

export const PANEL_WIDTHS = {
  sidebar: { default: 300, min: 220, max: 480 },
  rightPanel: { default: 360, min: 300, max: 640 },
} as const;

export type RightPanel =
  | { kind: 'details' }
  | { kind: 'thread'; rootId: string }
  /** Message search in the open chat (`room`) or across all chats (`all`). */
  | { kind: 'search'; scope: SearchScope; query?: string }
  /** `back` is the panel the profile was opened from (details or a thread). */
  | { kind: 'user'; userId: string; back?: Exclude<RightPanel, { kind: 'user' } | null> }
  | null;

export type SearchScope = 'room' | 'all';

/** Threads and profiles belong to one room; details and global search follow the user to the next room. */
function keepPanelAcrossRooms(panel: RightPanel): RightPanel {
  if (panel?.kind === 'details') return panel;
  if (panel?.kind === 'search' && panel.scope === 'all') return panel;
  if (panel?.kind === 'user' && panel.back?.kind === 'details') return panel.back;
  return null;
}

/** Full-page screens that replace the room view. */
export type Page = 'chat' | 'bridges';
export type SidebarTab = 'chats' | 'requests';

/** Opens a member's profile in the right panel; the back arrow returns to details or the thread. */
export function openUserProfile(userId: string) {
  const { rightPanel, setRightPanel } = useUi.getState();
  const back = rightPanel?.kind === 'user' ? rightPanel.back : (rightPanel ?? undefined);
  setRightPanel({ kind: 'user', userId, back });
}

/** Opens message search; the open chat by default, all chats when none is open. */
export function openSearch(scope?: SearchScope, query?: string) {
  const { roomId, page, setRightPanel, setPage } = useUi.getState();
  if (page !== 'chat') setPage('chat');
  setRightPanel({ kind: 'search', scope: scope ?? (roomId ? 'room' : 'all'), query });
}

export function viewKey(view: View): string {
  switch (view.kind) {
    case 'network':
      return `network:${view.networkId}`;
    case 'space':
      return `space:${view.spaceId}`;
    default:
      return view.kind;
  }
}

interface UiState {
  view: View;
  page: Page;
  roomId: string | null;
  /** Last open room per view, like Slack remembering the channel per workspace. */
  lastRoomByView: Record<string, string>;
  /** Account filter inside a network view (bridge login id), null = all accounts. */
  accountByNetwork: Record<string, string | null>;
  unreadOnly: boolean;
  sidebarTab: SidebarTab;
  setSidebarTab: (tab: SidebarTab) => void;
  collapsedSections: Record<string, boolean>;
  rightPanel: RightPanel;
  settingsOpen: boolean;
  settingsTab: string;
  switcherOpen: boolean;
  shortcutsOpen: boolean;
  /** Event to scroll to and highlight once the timeline renders it. */
  focusEventId: string | null;
  sidebarWidth: number;
  rightPanelWidth: number;

  setView: (view: View) => void;
  openRoom: (roomId: string, opts?: { eventId?: string; view?: View }) => void;
  setPage: (page: Page) => void;
  setAccount: (networkId: string, accountId: string | null) => void;
  toggleUnreadOnly: () => void;
  toggleSection: (key: string) => void;
  setRightPanel: (panel: RightPanel) => void;
  openSettings: (tab?: string) => void;
  closeSettings: () => void;
  setSwitcherOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  clearFocusEvent: () => void;
  setSidebarWidth: (width: number) => void;
  setRightPanelWidth: (width: number) => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      view: { kind: 'all' },
      page: 'chat',
      roomId: null,
      lastRoomByView: {},
      accountByNetwork: {},
      unreadOnly: false,
      sidebarTab: 'chats',
      setSidebarTab: (sidebarTab) => set({ sidebarTab }),
      collapsedSections: {},
      rightPanel: null,
      settingsOpen: false,
      settingsTab: 'general',
      switcherOpen: false,
      shortcutsOpen: false,
      focusEventId: null,
      sidebarWidth: PANEL_WIDTHS.sidebar.default,
      rightPanelWidth: PANEL_WIDTHS.rightPanel.default,

      setView: (view) =>
        set((s) => ({
          view,
          page: 'chat',
          roomId: s.lastRoomByView[viewKey(view)] ?? null,
          rightPanel: keepPanelAcrossRooms(s.rightPanel),
        })),
      openRoom: (roomId, opts) =>
        set((s) => {
          const view = opts?.view ?? s.view;
          return {
            view,
            page: 'chat',
            roomId,
            focusEventId: opts?.eventId ?? null,
            lastRoomByView: { ...s.lastRoomByView, [viewKey(view)]: roomId },
            rightPanel: s.roomId !== roomId ? keepPanelAcrossRooms(s.rightPanel) : s.rightPanel,
          };
        }),
      setPage: (page) => set({ page }),
      setAccount: (networkId, accountId) =>
        set((s) => ({ accountByNetwork: { ...s.accountByNetwork, [networkId]: accountId } })),
      toggleUnreadOnly: () => set((s) => ({ unreadOnly: !s.unreadOnly })),
      toggleSection: (key) =>
        set((s) => ({ collapsedSections: { ...s.collapsedSections, [key]: !s.collapsedSections[key] } })),
      setRightPanel: (rightPanel) => set({ rightPanel }),
      openSettings: (tab) => set((s) => ({ settingsOpen: true, settingsTab: tab ?? s.settingsTab })),
      closeSettings: () => set({ settingsOpen: false }),
      setSwitcherOpen: (switcherOpen) => set({ switcherOpen }),
      setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
      clearFocusEvent: () => set({ focusEventId: null }),
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
      setRightPanelWidth: (rightPanelWidth) => set({ rightPanelWidth }),
    }),
    {
      name: 'myna.ui',
      version: 1,
      partialize: (s) => ({
        view: s.view,
        roomId: s.roomId,
        lastRoomByView: s.lastRoomByView,
        accountByNetwork: s.accountByNetwork,
        unreadOnly: s.unreadOnly,
        sidebarTab: s.sidebarTab,
        collapsedSections: s.collapsedSections,
        sidebarWidth: s.sidebarWidth,
        rightPanelWidth: s.rightPanelWidth,
      }),
    },
  ),
);
