import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { createContext, useContext } from 'react';
import { t } from '@/i18n';

export interface TimelineContextValue {
  room: Room;
  /** Set inside the thread panel: replies and edits go to this thread's composer. */
  threadId?: string;
  /** Scrolls to (or loads) an event and highlights it. */
  jumpTo: (eventId: string) => void;
  /** Images and videos currently loaded, for lightbox navigation. */
  getMediaEvents: () => MatrixEvent[];
}

export const TimelineContext = createContext<TimelineContextValue | null>(null);

export function useTimelineContext(): TimelineContextValue {
  const ctx = useContext(TimelineContext);
  if (!ctx) throw new Error(t('room.missingTimelineContext'));
  return ctx;
}
