import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { PortalContainerContext } from '@/components/portal-container';
import { RoomView } from '@/features/room/room-view';
import { isTauri } from '@/lib/platform';
import { closeAllPopouts, closePopout, getActiveScope, type Popout, usePopouts } from '@/lib/popout';
import { useRoomSummary } from '@/matrix/hooks';
import { useRooms } from '@/matrix/rooms-store';
import { useUi } from '@/store/ui';
import { PopoutScopeContext } from './popout-scope';

/** Renders every open chat pop-out into its window; mount once in the app shell. */
export function PopoutHost() {
  const popouts = usePopouts((s) => s.popouts);
  useEffect(() => closeAllPopouts, []);
  useEffect(routePanelsToMain, []);
  return Object.values(popouts).map((p) => <PopoutPortal key={p.roomId} popout={p} />);
}

function PopoutPortal({ popout }: { popout: Popout }) {
  const { roomId, win, root } = popout;
  const scope = useMemo(() => ({ roomId, win }), [roomId, win]);
  return createPortal(
    <PopoutScopeContext.Provider value={scope}>
      <PortalContainerContext.Provider value={win.document.body}>
        <PopoutWindow roomId={roomId} win={win} />
      </PortalContainerContext.Provider>
    </PopoutScopeContext.Provider>,
    root,
  );
}

function PopoutWindow({ roomId, win }: { roomId: string; win: Window }) {
  const summary = useRoomSummary(roomId);
  const known = useRooms((s) => !s.ready || !!s.rooms[roomId]);

  useEffect(() => {
    if (summary?.name) win.document.title = summary.name;
  }, [summary?.name, win]);

  // Left or forgotten chat: nothing to show any more.
  useEffect(() => {
    if (!known) closePopout(roomId);
  }, [known, roomId]);

  return (
    <div className="flex h-full flex-col bg-background">
      <RoomView roomId={roomId} />
    </div>
  );
}

/**
 * Threads, profiles, details and search live in the main window's right panel.
 * Opened from a pop-out, they show there next to the same chat.
 */
function routePanelsToMain() {
  return useUi.subscribe((s, prev) => {
    if (s.rightPanel === prev.rightPanel || !s.rightPanel) return;
    const scope = getActiveScope();
    if (!scope) return;
    if (s.roomId !== scope || s.page !== 'chat') useUi.setState({ roomId: scope, page: 'chat' });
    if (!isTauri) return;
    const main = getCurrentWindow();
    void main.unminimize().then(() => main.show()).then(() => main.setFocus()).catch(() => undefined);
  });
}
