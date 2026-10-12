import { EventStatus, type MatrixEvent, type Room, ThreadEvent } from 'matrix-js-sdk';
import { memo, useState } from 'react';
import relativeTime from 'dayjs/plugin/relativeTime';
import { MxAvatar } from '@/components/mx-avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { t } from '@/i18n';
import { dayjs, formatFullTime, formatMessageTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useMatrixClient } from '@/matrix/context';
import { useRerenderOn } from '@/matrix/hooks';
import { openUserProfile, useUi } from '@/store/ui';
import { HoverToolbar } from './message-actions';
import { MessageContent } from './message-content';
import { Reactions } from './reactions';
import { ReplyQuote } from './reply-quote';
import { useTimelineContext } from './timeline-context';
import { describeSystemEvent, displaySender, isPending, memberName, senderName } from './timeline-utils';

dayjs.extend(relativeTime);

interface MessageRowProps {
  room: Room;
  event: MatrixEvent;
  continuation: boolean;
  system: boolean;
  /** Bumped when edits, reactions, redactions, decryption or send status change. */
  version: number;
  receipts: string;
  highlighted: boolean;
  /** The thread root inside the thread panel does not link to itself. */
  hideThreadSummary?: boolean;
}

export const MessageRow = memo(function MessageRow(props: MessageRowProps) {
  if (props.system) return <SystemRow room={props.room} event={props.event} />;
  return <ChatRow {...props} />;
});

function TimeGutter({ ts }: { ts: number }) {
  return (
    <time
      title={formatFullTime(ts)}
      className="invisible block pt-[3px] text-right text-[11px] leading-[18px] text-muted-foreground tabular-nums group-hover/row:visible"
    >
      {formatMessageTime(ts)}
    </time>
  );
}

function SystemRow({ room, event }: { room: Room; event: MatrixEvent }) {
  const text = describeSystemEvent(event, room);
  return (
    <div data-event-id={event.getId()} className="group/row cv-auto flex gap-2 px-5 py-px text-[13px] text-muted-foreground">
      <div className="w-9 shrink-0">
        <TimeGutter ts={event.getTs()} />
      </div>
      <div className="selectable min-w-0 flex-1 truncate leading-[22px]">{text}</div>
    </div>
  );
}

function ChatRow({ room, event, continuation, receipts, highlighted, hideThreadSummary }: MessageRowProps) {
  const client = useMatrixClient();
  const { threadId, jumpTo } = useTimelineContext();
  const [hovered, setHovered] = useState(false);
  const [toolbarOpen, setToolbarOpen] = useState(false);
  // A jump highlight fades out slowly; hover only briefly.
  const [slowFade, setSlowFade] = useState(false);
  if (highlighted && !slowFade) setSlowFade(true);
  const sender = displaySender(room, event.getSender());
  const name = senderName(room, event);
  const ts = event.getTs();
  const pending = isPending(event);
  const failed = event.status === EventStatus.NOT_SENT;
  const replyId = event.replyEventId;
  // In threads the SDK adds a fallback reply to the previous message; it is not a real reply.
  const isFallbackReply = !!event.getWireContent()['m.relates_to']?.is_falling_back;
  const replacing = event.replacingEvent();
  const showToolbar = (hovered || toolbarOpen) && !(pending && !failed);

  return (
    <div
      data-event-id={event.getId()}
      onMouseEnter={() => {
        setHovered(true);
        setSlowFade(false);
      }}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        'group/row relative flex gap-2 px-5 py-0.5 transition-colors',
        slowFade ? 'duration-1000' : 'duration-150',
        // content-visibility clips overflow, which would cut off the hover toolbar.
        !showToolbar && 'cv-auto',
        !continuation && 'mt-2 pt-1',
        showToolbar && 'bg-accent/60 duration-0',
        highlighted && 'mx-row-highlight duration-0',
      )}
    >
      <div className="w-9 shrink-0">
        {continuation ? (
          <TimeGutter ts={ts} />
        ) : (
          <button
            type="button"
            onClick={() => openUserProfile(sender)}
            aria-label={t('details.viewProfile')}
            className="mt-0.5 block cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MxAvatar
              mxc={
                (sender === event.getSender() ? event.sender?.getMxcAvatarUrl() : undefined) ??
                room.getMember(sender)?.getMxcAvatarUrl()
              }
              name={name}
              seed={sender}
              size={36}
            />
          </button>
        )}
      </div>
      <div className={cn('min-w-0 flex-1', receipts && 'pr-14', pending && !failed && 'opacity-60')}>
        {!continuation && (
          <div className="flex items-baseline gap-2">
            <button
              type="button"
              onClick={() => openUserProfile(sender)}
              className="mx-sender-name cursor-pointer truncate font-semibold outline-none hover:underline focus-visible:underline"
              title={event.getSender()}
            >
              {name}
            </button>
            <time title={formatFullTime(ts)} className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {formatMessageTime(ts)}
            </time>
          </div>
        )}
        {replyId && !isFallbackReply && !event.isRedacted() && (
          <ReplyQuote room={room} eventId={replyId} onJump={jumpTo} />
        )}
        <div className="selectable">
          <MessageContent
            event={event}
            senderName={name}
            suffix={
              replacing && !event.isRedacted() ? (
                <span
                  className="ml-1 text-xs text-muted-foreground select-none"
                  title={t('room.editedAt', { time: formatFullTime(replacing.getTs()) })}
                >
                  {t('room.editedMarker')}
                </span>
              ) : null
            }
          />
        </div>
        {failed && <SendFailed room={room} event={event} />}
        {!event.isRedacted() && !pending && <Reactions room={room} event={event} />}
        {!hideThreadSummary && !threadId && event.getId() && <ThreadSummary room={room} rootId={event.getId()!} />}
      </div>
      {receipts && <ReadReceipts room={room} users={receipts} me={client.getSafeUserId()} />}
      {showToolbar && <HoverToolbar room={room} event={event} threadId={threadId} onOpenChange={setToolbarOpen} />}
    </div>
  );
}

function SendFailed({ room, event }: { room: Room; event: MatrixEvent }) {
  const client = useMatrixClient();
  return (
    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-destructive">
      <span className="font-medium">{t('room.notSent')}</span>
      <span>·</span>
      <button type="button" className="hover:underline" onClick={() => void client.resendEvent(event, room).catch(() => undefined)}>
        {t('common.retry')}
      </button>
      <span>·</span>
      <button type="button" className="hover:underline" onClick={() => client.cancelPendingEvent(event)}>
        {t('room.discard')}
      </button>
    </div>
  );
}

function ThreadSummary({ room, rootId }: { room: Room; rootId: string }) {
  const thread = room.getThread(rootId);
  useRerenderOn(thread, ThreadEvent.Update, ThreadEvent.NewReply);
  if (!thread || thread.length === 0) return null;
  const last = thread.replyToEvent;
  const lastSender = last?.getSender();
  const count = thread.length;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        useUi.getState().setRightPanel({ kind: 'thread', rootId });
      }}
      className="mt-1 -ml-1 flex max-w-full items-center gap-2 rounded-md border border-transparent px-1 py-0.5 text-[13px] hover:border-border hover:bg-background"
    >
      {lastSender && (
        <MxAvatar
          mxc={room.getMember(lastSender)?.getMxcAvatarUrl()}
          name={memberName(room, lastSender)}
          seed={lastSender}
          size={20}
          shape="square"
        />
      )}
      <span className="font-semibold text-primary">
        {t('room.replyCount', { count })}
      </span>
      {last && <span className="truncate text-muted-foreground">{t('room.lastReply', { time: dayjs(last.getTs()).fromNow() })}</span>}
    </button>
  );
}

function ReadReceipts({ room, users, me }: { room: Room; users: string; me: string }) {
  const ids = users.split(',').filter((id) => id && id !== me);
  if (ids.length === 0) return null;
  const shown = ids.slice(0, 3);
  const rest = ids.length - shown.length;
  const names = ids.map((id) => memberName(room, id));
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="absolute right-4 bottom-1 flex items-center">
          <div className="flex -space-x-1">
            {shown.map((id) => (
              <MxAvatar
                key={id}
                mxc={room.getMember(id)?.getMxcAvatarUrl()}
                name={memberName(room, id)}
                seed={id}
                size={16}
                className="rounded-full ring-2 ring-background"
              />
            ))}
          </div>
          {rest > 0 && <span className="ml-1 text-[10px] text-muted-foreground tabular-nums">+{rest}</span>}
        </div>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-64">
        {t('room.readBy', {
          names:
            names.slice(0, 15).join(', ') +
            (names.length > 15 ? ` ${t('room.andMore', { count: names.length - 15 })}` : ''),
        })}
      </TooltipContent>
    </Tooltip>
  );
}
