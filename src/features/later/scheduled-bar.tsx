import type { Room } from 'matrix-js-sdk';
import { AlertCircle, Clock, Pencil, SendHorizontal, Trash2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import { useMatrixClient } from '@/matrix/context';
import { removeScheduled, type ScheduledMessage, sendScheduled, useScheduled } from './scheduled';
import { formatWhen } from './when';

interface ScheduledBarProps {
  room: Room;
  threadId?: string;
  /** Moves the message back into the composer; returns false when the composer is busy. */
  onEdit: (message: ScheduledMessage) => boolean;
}

/** "2 scheduled messages · next today 14:30" above the composer, with a list to manage them. */
export function ScheduledBar({ room, threadId, onEdit }: ScheduledBarProps) {
  const client = useMatrixClient();
  const me = client.getUserId();
  const messages = useScheduled(
    useShallow((s) =>
      s.messages.filter((m) => m.userId === me && m.roomId === room.roomId && (m.threadId ?? undefined) === threadId),
    ),
  );
  const sending = useScheduled((s) => s.sending);
  if (messages.length === 0) return null;
  const failed = messages.some((m) => m.failed);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex w-full items-center gap-1.5 border-b bg-muted/40 px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted',
            failed && 'text-destructive',
          )}
        >
          {failed ? <AlertCircle className="size-3.5" /> : <Clock className="size-3.5" />}
          {t('later.scheduledCount', { count: messages.length })}
          <span className="tabular-nums">· {t('later.nextAt', { when: formatWhen(messages[0].at) })}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-96 p-1">
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{t('later.scheduledTitle')}</div>
        <div className="max-h-80 overflow-y-auto">
          {messages.map((m) => (
            <div key={m.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50">
              <div className="min-w-0 flex-1">
                <div className={cn('text-xs tabular-nums', m.failed ? 'text-destructive' : 'text-muted-foreground')}>
                  {m.failed ? t('later.scheduledNotSent') : formatWhen(m.at)}
                </div>
                <div className="line-clamp-2 text-sm">{String(m.content.body ?? '')}</div>
              </div>
              <div className="flex shrink-0 gap-0.5">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={t('later.sendNow')}
                  aria-label={t('later.sendNow')}
                  disabled={sending.includes(m.id)}
                  onClick={() => void sendScheduled(client, m.id)}
                >
                  <SendHorizontal />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={t('common.edit')}
                  aria-label={t('common.edit')}
                  disabled={sending.includes(m.id)}
                  onClick={() => onEdit(m) && removeScheduled(m.id)}
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={t('common.delete')}
                  aria-label={t('common.delete')}
                  disabled={sending.includes(m.id)}
                  onClick={() => removeScheduled(m.id)}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
