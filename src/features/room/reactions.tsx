import {
  EventType,
  type MatrixClient,
  type MatrixEvent,
  RelationType,
  RelationsEvent,
  type Room,
} from 'matrix-js-sdk';
import { SmilePlus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { EmojiPicker } from '@/features/emoji/emoji-picker';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import { useMatrixClient } from '@/matrix/context';
import { useRerenderOn } from '@/matrix/hooks';
import { useThumbnail } from '@/matrix/media';
import { useSettings } from '@/store/settings';
import { memberName } from './timeline-utils';

function reactionRelations(room: Room, eventId: string) {
  return room.relations.getChildEventsForEvent(eventId, RelationType.Annotation, EventType.Reaction);
}

function ownReaction(client: MatrixClient, room: Room, eventId: string, key: string): MatrixEvent | undefined {
  const mine = reactionRelations(room, eventId)?.getAnnotationsBySender()?.[client.getSafeUserId()];
  if (!mine) return undefined;
  for (const e of mine) {
    if (!e.isRedacted() && e.getRelation()?.key === key) return e;
  }
  return undefined;
}

/** Adds the reaction, or removes it when the user already reacted with the same key. */
export async function toggleReaction(client: MatrixClient, room: Room, event: MatrixEvent, key: string) {
  const eventId = event.getId();
  if (!eventId) return;
  const existing = ownReaction(client, room, eventId, key);
  try {
    if (existing) {
      if (existing.isSending()) client.cancelPendingEvent(existing);
      else await client.redactEvent(room.roomId, existing.getId()!);
    } else {
      await client.sendEvent(room.roomId, EventType.Reaction, {
        'm.relates_to': { rel_type: RelationType.Annotation, event_id: eventId, key },
      });
    }
  } catch {
    toast.error(t('room.reactionFailed'));
  }
}

function ReactionKey({ reactionKey }: { reactionKey: string }) {
  const isMxc = reactionKey.startsWith('mxc://');
  const src = useThumbnail(isMxc ? reactionKey : null, 20);
  if (isMxc) return src ? <img src={src} alt="" className="size-4 object-contain" /> : <span>?</span>;
  return <span className="text-[15px] leading-none">{reactionKey}</span>;
}

export function Reactions({ room, event }: { room: Room; event: MatrixEvent }) {
  const client = useMatrixClient();
  const pushRecentEmoji = useSettings((s) => s.pushRecentEmoji);
  const [pickerOpen, setPickerOpen] = useState(false);
  const eventId = event.getId() ?? '';
  const relations = reactionRelations(room, eventId);
  useRerenderOn(relations, RelationsEvent.Add, RelationsEvent.Remove, RelationsEvent.Redaction);

  const me = client.getSafeUserId();
  const groups = (relations?.getSortedAnnotationsByKey() ?? [])
    .map(([key, set]) => [key, [...set].filter((e) => !e.isRedacted())] as const)
    .filter(([, events]) => events.length > 0);
  if (groups.length === 0) return null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {groups.map(([key, events]) => {
        const mine = events.some((e) => e.getSender() === me);
        const names = events.map((e) => (e.getSender() === me ? t('common.you') : memberName(room, e.getSender())));
        const shown = names.slice(0, 12).join(', ') + (names.length > 12 ? ` ${t('room.andMore', { count: names.length - 12 })}` : '');
        return (
          <Tooltip key={key}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => void toggleReaction(client, room, event, key)}
                className={cn(
                  'flex h-6 items-center gap-1 rounded-full border px-2 text-xs tabular-nums transition-colors',
                  mine
                    ? 'border-primary bg-primary/10 text-primary hover:bg-primary/15'
                    : 'border-transparent bg-muted hover:border-border hover:bg-accent',
                )}
              >
                <ReactionKey reactionKey={key} />
                <span className="font-medium">{events.length}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              {shown} {key.startsWith('mxc://') ? '' : key}
            </TooltipContent>
          </Tooltip>
        );
      })}
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            title={t('room.addReaction')}
            aria-label={t('room.addReaction')}
            className="flex h-6 items-center rounded-full border border-transparent bg-muted px-2 text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground"
          >
            <SmilePlus className="size-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <EmojiPicker
            onPick={(emoji) => {
              setPickerOpen(false);
              pushRecentEmoji(emoji);
              void toggleReaction(client, room, event, emoji);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
