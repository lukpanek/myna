import { ResizeHandle } from '@/components/resize-handle';
import { DetailsPanel } from '@/features/details/details-panel';
import { UserPanel } from '@/features/details/user-panel';
import { ThreadPanel } from '@/features/room/thread-panel';
import { t } from '@/i18n';
import { PANEL_WIDTHS, useUi } from '@/store/ui';

export function RightPanel() {
  const panel = useUi((s) => s.rightPanel);
  const roomId = useUi((s) => s.roomId);
  const width = useUi((s) => s.rightPanelWidth);
  const setWidth = useUi((s) => s.setRightPanelWidth);
  const setPanel = useUi((s) => s.setRightPanel);
  if (!panel || !roomId) return null;
  return (
    <aside style={{ width }} className="relative flex shrink-0 flex-col border-l bg-background">
      <ResizeHandle
        edge="left"
        width={width}
        min={PANEL_WIDTHS.rightPanel.min}
        max={PANEL_WIDTHS.rightPanel.max}
        onResize={setWidth}
        onReset={() => setWidth(PANEL_WIDTHS.rightPanel.default)}
        label={t('shell.resizePanel')}
      />
      {panel.kind === 'details' ? (
        <DetailsPanel roomId={roomId} />
      ) : panel.kind === 'user' ? (
        <UserPanel
          key={panel.userId}
          roomId={roomId}
          userId={panel.userId}
          onBack={panel.back ? () => setPanel(panel.back ?? null) : undefined}
        />
      ) : (
        <ThreadPanel roomId={roomId} rootId={panel.rootId} />
      )}
    </aside>
  );
}
