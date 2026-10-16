import { Search } from 'lucide-react';
import { Logo } from '@/components/logo';
import { useEffect, useState } from 'react';
import { attachActivity } from '@/features/activity/activity';
import { ActivityFeed } from '@/features/activity/activity-feed';
import { BridgesPage } from '@/features/bridges/bridges-page';
import { CryptoPrompts } from '@/features/crypto/crypto-prompts';
import { ReminderDialog } from '@/features/later/reminder-dialog';
import { attachReminders, remindersByRoom, useReminders } from '@/features/later/reminders';
import { attachScheduledSender } from '@/features/later/scheduled';
import { NewChatDialog } from '@/features/new-chat/new-chat-dialog';
import { useDesktopNotifications } from '@/features/notifications/use-notifications';
import { PopoutHost } from '@/features/popout/popout-host';
import { RoomView } from '@/features/room/room-view';
import { SettingsDialog } from '@/features/settings/settings-dialog';
import { ShortcutsDialog } from '@/features/settings/shortcuts-dialog';
import { t } from '@/i18n';
import { useNativeIntegration } from '@/lib/native';
import { isMac, modKey } from '@/lib/platform';
import { attachBackfillReader } from '@/matrix/backfill';
import { attachConnection } from '@/matrix/connection';
import { useMatrixClient } from '@/matrix/context';
import { attachRoomsStore, useRooms } from '@/matrix/rooms-store';
import { useSettings } from '@/store/settings';
import { openSearch, useUi } from '@/store/ui';
import { ConnectionBanner } from './connection-banner';
import { QuickSwitcher } from './quick-switcher';
import { Rail } from './rail';
import { RightPanel } from './right-panel';
import { buildSections, isRoomUnread, roomsForView } from './room-filters';
import { Sidebar } from './sidebar';

export function AppShell({ onLogout }: { onLogout: () => void }) {
  const client = useMatrixClient();
  const [newChatOpen, setNewChatOpen] = useState(false);
  const page = useUi((s) => s.page);
  const roomId = useUi((s) => s.roomId);
  const setSwitcherOpen = useUi((s) => s.setSwitcherOpen);

  useEffect(() => attachRoomsStore(client), [client]);
  useEffect(() => attachBackfillReader(client), [client]);
  useEffect(() => attachReminders(client), [client]);
  useEffect(() => attachScheduledSender(client), [client]);
  useEffect(() => attachActivity(client), [client]);
  useEffect(() => attachConnection(client), [client]);
  useNativeIntegration();
  useDesktopNotifications();
  useGlobalShortcuts();

  // Drop a stale selection (left room, other account) once the list is known.
  const roomKnown = useRooms((s) => (roomId ? !!s.rooms[roomId] : true));
  const ready = useRooms((s) => s.ready);
  const showRoom = page !== 'bridges' && roomId && (roomKnown || !ready);

  return (
    <div className="flex h-full flex-col bg-rail">
      <header data-tauri-drag-region className="relative flex h-10 shrink-0 items-center justify-center bg-rail">
        <button
          onClick={() => setSwitcherOpen(true)}
          className="flex h-7 w-full max-w-[520px] items-center gap-2 rounded-md bg-background/70 px-2.5 text-[13px] text-muted-foreground ring-1 ring-border transition-colors hover:bg-background"
        >
          <Search className="size-3.5" />
          {t('shell.searchChat')}
          <kbd className="ml-auto font-sans text-[11px] opacity-70">{modKey}K</kbd>
        </button>
      </header>
      <ConnectionBanner />
      <div className="flex min-h-0 flex-1">
        <Rail onLogout={onLogout} />
        <div className="flex min-w-0 flex-1 overflow-hidden rounded-tl-lg border-t border-l bg-background">
          {page === 'bridges' ? (
            <BridgesPage />
          ) : (
            <>
              {page === 'activity' ? <ActivityFeed /> : <Sidebar onNewChat={() => setNewChatOpen(true)} />}
              <main className="flex min-w-0 flex-1 flex-col">
                {showRoom ? <RoomView key={roomId} roomId={roomId} /> : <NoRoom activity={page === 'activity'} />}
              </main>
              <RightPanel />
            </>
          )}
        </div>
      </div>

      <QuickSwitcher />
      <NewChatDialog open={newChatOpen} onOpenChange={setNewChatOpen} />
      <SettingsDialog onLogout={onLogout} />
      <ShortcutsDialog />
      <CryptoPrompts />
      <ReminderDialog />
      <PopoutHost />
    </div>
  );
}

function NoRoom({ activity }: { activity: boolean }) {
  return (
    <div
      data-tauri-drag-region
      className="flex flex-1 flex-col items-center justify-center gap-4 text-sm text-muted-foreground"
    >
      <Logo size={64} className="opacity-90" />
      {activity ? t('activity.noSelection') : t('shell.noRoomSelected', { shortcut: `${modKey}K` })}
    </div>
  );
}

/** Room ids in the order the sidebar shows them (collapsed sections excluded). */
function visibleRoomOrder(): string[] {
  const { view, accountByNetwork, unreadOnly, collapsedSections, sidebarTab, roomId } = useUi.getState();
  const accountId = view.kind === 'network' ? (accountByNetwork[view.networkId] ?? null) : null;
  const later = remindersByRoom(useReminders.getState().reminders);
  const sections = buildSections(roomsForView(useRooms.getState().rooms, view, accountId), unreadOnly, useSettings.getState().groupRooms, sidebarTab, later);
  return sections.flatMap((s) =>
    (collapsedSections[s.key] ?? s.defaultCollapsed) ? s.rooms.filter((r) => isRoomUnread(r) || r.roomId === roomId) : s.rooms,
  ).map((r) => r.roomId);
}

function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      const ui = useUi.getState();
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ui.setSwitcherOpen(!ui.switcherOpen);
      } else if (mod && e.key.toLowerCase() === 'f' && ui.page !== 'bridges') {
        // ⌘F: search the open chat, ⌘⇧F: search all chats.
        e.preventDefault();
        openSearch(e.shiftKey ? 'all' : undefined);
      } else if (mod && e.key === '/') {
        e.preventDefault();
        ui.setShortcutsOpen(!ui.shortcutsOpen);
      } else if (mod && e.key === ',') {
        e.preventDefault();
        ui.openSettings();
      } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        // ⌥↑/↓: previous/next chat. ⌥⇧↑/↓: previous/next unread chat.
        e.preventDefault();
        const rooms = useRooms.getState().rooms;
        let order = visibleRoomOrder();
        if (e.shiftKey) order = order.filter((id) => id === ui.roomId || isRoomUnread(rooms[id]));
        if (order.length === 0) return;
        const index = ui.roomId ? order.indexOf(ui.roomId) : -1;
        const next = e.key === 'ArrowDown' ? index + 1 : index - 1;
        const target = order[(next + order.length) % order.length];
        if (target) ui.openRoom(target);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
