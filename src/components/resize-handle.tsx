import { type KeyboardEvent, type PointerEvent, useRef } from 'react';
import { useSettings } from '@/store/settings';
import { cn } from '@/lib/utils';

interface ResizeHandleProps {
  /** Which edge of the panel the handle sits on; dragging away from the panel makes it wider. */
  edge: 'left' | 'right';
  width: number;
  min: number;
  max: number;
  onResize: (width: number) => void;
  /** Double-click restores the default width. */
  onReset: () => void;
  label: string;
}

const KEY_STEP = 16;

/** Thin vertical drag handle on a panel edge (also keyboard-resizable with ←/→). */
export function ResizeHandle({ edge, width, min, max, onResize, onReset, label }: ResizeHandleProps) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const clamp = (w: number) => Math.round(Math.min(max, Math.max(min, w)));
  const dir = edge === 'right' ? 1 : -1;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, width };
    // Keep the resize cursor and stop text selection while the pointer is outside the handle.
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    onResize(clamp(drag.current.width + (e.clientX - drag.current.x) * dir / (useSettings.getState().interfaceScale / 100)));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const delta = (e.key === 'ArrowRight' ? KEY_STEP : -KEY_STEP) * dir;
    onResize(clamp(width + delta));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      className={cn(
        'group absolute inset-y-0 z-30 w-2 cursor-col-resize outline-none',
        edge === 'right' ? '-right-1' : '-left-1',
      )}
    >
      <div className="mx-auto h-full w-px bg-transparent transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary group-active:bg-primary" />
    </div>
  );
}
