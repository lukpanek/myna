import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { type MouseEvent, type ReactNode, useState } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { t } from '@/i18n';
import { formatDayDivider } from '@/lib/time';
import { useMatrixClient } from '@/matrix/context';
import { getMessageActions, renderActions } from './message-actions';
import { MessageRow } from './message-row';
import type { DaySection } from './timeline-utils';

export function NewDivider() {
  return (
    <div data-new-divider className="my-1 flex items-center gap-2 px-5" aria-label={t('room.newMessages')}>
      <div className="h-px flex-1 bg-unread" />
      <span className="text-[11px] font-semibold text-unread">{t('room.newDivider')}</span>
    </div>
  );
}

export function TimelineSections({
  room,
  sections,
  highlightId,
}: {
  room: Room;
  sections: DaySection[];
  highlightId: string | null;
}) {
  return sections.map((section) => (
    <section key={section.key} className="relative">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-4 border-t" />
      {/* Only the label sticks, the line stays in place – like Slack. */}
      <div className="pointer-events-none sticky top-0 z-20 flex h-8 items-center justify-center">
        <span className="rounded-full border bg-background px-3 py-0.5 text-xs font-medium first-letter:uppercase">
          {formatDayDivider(section.ts)}
        </span>
      </div>
      {section.items.map((item) =>
        item.kind === 'new' ? (
          <NewDivider key={item.key} />
        ) : (
          <MessageRow
            key={item.key}
            room={room}
            event={item.event}
            continuation={item.continuation}
            system={item.system}
            version={item.version}
            receipts={item.receipts}
            highlighted={highlightId !== null && highlightId === item.event.getId()}
          />
        ),
      )}
    </section>
  ));
}

/**
 * One context menu for a whole list of messages: the right-clicked row is found
 * from the DOM, so hundreds of rows do not each mount their own menu.
 */
export function MessageContextMenu({
  room,
  threadId,
  findEvent,
  children,
}: {
  room: Room;
  threadId?: string;
  findEvent: (eventId: string) => MatrixEvent | undefined;
  children: ReactNode;
}) {
  const client = useMatrixClient();
  const [event, setEvent] = useState<MatrixEvent | null>(null);

  const onContextMenu = (e: MouseEvent) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-event-id]');
    const id = row?.dataset.eventId;
    const found = id ? findEvent(id) : undefined;
    // Areas outside message rows get no menu at all (preventDefault also stops Radix from opening).
    if (!found || found.isState()) {
      e.preventDefault();
      return;
    }
    setEvent(found);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild onContextMenu={onContextMenu}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        {event &&
          renderActions(
            getMessageActions(client, room, event, threadId),
            ({ onSelect, variant, children: label }) => (
              <ContextMenuItem onSelect={onSelect} variant={variant}>
                {label}
              </ContextMenuItem>
            ),
            () => <ContextMenuSeparator />,
          )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
