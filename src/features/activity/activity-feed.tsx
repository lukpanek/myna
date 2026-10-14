import { AtSign, Check, CheckCheck, MessageSquareDot, MessageSquareText, Reply, SmilePlus, User } from 'lucide-react';
import { type MouseEvent, type ReactNode, memo, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { MxAvatar } from '@/components/mx-avatar';
import { ResizeHandle } from '@/components/resize-handle';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { memberName } from '@/features/room/timeline-utils';
import { type MessageKey, t } from '@/i18n';
import { formatDayDivider, formatFullTime, formatListTime, isSameDay } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useMatrixClient } from '@/matrix/context';
import { useRooms } from '@/matrix/rooms-store';
import { PANEL_WIDTHS, openActivityItem, useUi } from '@/store/ui';
import { type ActivityItem, type ActivityTab, markActivityRead, matchesTab, useActivity } from './activity';

const TABS: { id: ActivityTab; label: MessageKey }[] = [
  { id: 'all', label: 'activity.tabAll' },
  { id: 'dms', label: 'activity.tabDms' },
  { id: 'mentions', label: 'activity.tabMentions' },
  { id: 'threads', label: 'activity.tabThreads' },
  { id: 'reactions', label: 'activity.tabReactions' },
];

/** Left column of the activity page: newest DMs, mentions, replies, threads and reactions, grouped by day. */
export function ActivityFeed() {
  const client = useMatrixClient();
  const items = useActivity((s) => s.items);
  const tab = useUi((s) => s.activityTab);
  const setTab = useUi((s) => s.setActivityTab);
  const unreadOnly = useUi((s) => s.activityUnreadOnly);
  const toggleUnreadOnly = useUi((s) => s.toggleActivityUnreadOnly);
  const width = useUi((s) => s.activityWidth);
  const setWidth = useUi((s) => s.setActivityWidth);
  const roomId = useUi((s) => s.roomId);
  const [selected, setSelected] = useState<string | null>(null);

  const visible = useMemo(
    () => items.filter((i) => matchesTab(i, tab) && (!unreadOnly || i.unread || i.key === selected)),
    [items, tab, unreadOnly, selected],
  );
  const unreadByTab = useMemo(() => {
    const counts = new Map<ActivityTab, number>();
    for (const { id } of TABS) counts.set(id, items.filter((i) => i.unread && matchesTab(i, id)).length);
    return counts;
  }, [items]);

  const markAll = async () => {
    const results = await Promise.allSettled(
      items.filter((i) => i.unread && matchesTab(i, tab)).map((i) => markActivityRead(client, i)),
    );
    if (results.some((r) => r.status === 'rejected')) toast.error(t('activity.markFailed'));
  };

  const open = (item: ActivityItem) => {
    setSelected(item.key);
    openActivityItem(item.roomId, item.eventId, item.threadRootId);
  };

  return (
    <aside style={{ width }} className="relative flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <ResizeHandle
        edge="right"
        width={width}
        min={PANEL_WIDTHS.activity.min}
        max={PANEL_WIDTHS.activity.max}
        onResize={setWidth}
        onReset={() => setWidth(PANEL_WIDTHS.activity.default)}
        label={t('shell.resizePanel')}
      />
      <header className="flex h-14 shrink-0 items-center gap-1 pr-2 pl-4">
        <h2 className="truncate text-[15px] font-bold text-foreground">{t('activity.title')}</h2>
        <div className="ml-auto flex items-center">
          <IconButton
            label={unreadOnly ? t('activity.showAll') : t('activity.unreadOnly')}
            pressed={unreadOnly}
            onClick={toggleUnreadOnly}
          >
            <MessageSquareDot className="size-4" />
          </IconButton>
          <IconButton
            label={t('activity.markAllRead')}
            disabled={!unreadByTab.get(tab)}
            onClick={() => void markAll()}
          >
            <CheckCheck className="size-4" />
          </IconButton>
        </div>
      </header>
      <div role="tablist" className="flex shrink-0 gap-1 overflow-x-auto border-b border-sidebar-border px-3 [scrollbar-width:none]">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              'relative flex shrink-0 items-center gap-1.5 px-2 pt-1 pb-2 text-[13px] font-medium transition-colors',
              tab === id
                ? 'text-foreground after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(label)}
            {!!unreadByTab.get(id) && <span className="size-1.5 rounded-full bg-mention" />}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {visible.length === 0 ? (
          <p className="px-6 pt-16 text-center text-sm text-muted-foreground">
            {unreadOnly ? t('activity.emptyUnread') : t('activity.empty')}
          </p>
        ) : (
          <ol>
            {visible.map((item, i) => (
              <li key={item.key}>
                {(i === 0 || !isSameDay(visible[i - 1].ts, item.ts)) && (
                  <h3 className="sticky top-0 z-10 bg-sidebar px-4 pt-3 pb-1 text-[12px] font-semibold text-muted-foreground">
                    {formatDayDivider(item.ts)}
                  </h3>
                )}
                <ActivityRow item={item} selected={item.key === selected && item.roomId === roomId} onOpen={open} />
              </li>
            ))}
          </ol>
        )}
        {visible.length > 0 && <p className="px-6 pt-4 text-center text-[11px] text-muted-foreground">{t('activity.loadedOnly')}</p>}
      </div>
    </aside>
  );
}

function IconButton(props: { label: string; pressed?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('size-8', props.pressed && 'bg-sidebar-accent text-foreground')}
          aria-label={props.label}
          aria-pressed={props.pressed}
          disabled={props.disabled}
          onClick={props.onClick}
        >
          {props.children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  );
}

const KIND_ICON = {
  dm: User,
  mention: AtSign,
  reply: Reply,
  thread: MessageSquareText,
  reaction: SmilePlus,
} as const;

const ActivityRow = memo(function ActivityRow({
  item,
  selected,
  onOpen,
}: {
  item: ActivityItem;
  selected: boolean;
  onOpen: (item: ActivityItem) => void;
}) {
  const client = useMatrixClient();
  const summary = useRooms((s) => s.rooms[item.roomId]);
  const room = client.getRoom(item.roomId);
  const [sender] = item.senders;
  const name = room ? memberName(room, sender) : sender;
  const isDm = summary?.isDm ?? false;
  const avatar = room?.getMember(sender)?.getMxcAvatarUrl() ?? (isDm ? summary?.avatarMxc : undefined);
  const roomName = summary?.name ?? room?.name ?? '';
  const network = summary?.bridge ? { id: summary.bridge.networkId, avatarMxc: summary.bridge.networkAvatar } : null;
  const Icon = KIND_ICON[item.kind];

  const context =
    item.kind === 'dm'
      ? t('activity.contextDm')
      : item.threadRootId || item.kind === 'thread'
        ? isDm
          ? t('activity.contextThreadDm')
          : t('activity.contextThread', { room: roomName })
        : item.kind === 'reply'
          ? t('activity.contextReply', { room: roomName })
          : item.kind === 'mention'
            ? t('activity.contextMention', { room: roomName })
            : isDm
              ? t('activity.contextDm')
              : roomName;

  const markRead = (e: MouseEvent) => {
    e.stopPropagation();
    markActivityRead(client, item).catch(() => toast.error(t('activity.markFailed')));
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(item);
        }
      }}
      className={cn(
        'group relative flex gap-3 border-b border-sidebar-border/60 px-4 py-3 outline-none [contain-intrinsic-size:auto_96px] [content-visibility:auto]',
        selected ? 'bg-highlight' : 'hover:bg-sidebar-accent/60 focus-visible:bg-sidebar-accent/60',
      )}
    >
      <MxAvatar mxc={avatar} name={name} seed={sender} size={36} network={network} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className={cn('truncate text-[14px]', item.unread ? 'font-semibold text-foreground' : 'text-foreground/90')}>
            {name}
          </span>
          {item.senders.length > 1 && (
            <span className="shrink-0 text-[13px] text-muted-foreground">
              {t('activity.others', { count: item.senders.length - 1 })}
            </span>
          )}
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums" title={formatFullTime(item.ts)}>
            {formatListTime(item.ts)}
          </span>
          {item.unread && <span className="ml-auto size-2 shrink-0 self-center rounded-full bg-primary group-focus-within:hidden group-hover:hidden" />}
        </div>
        <p className={cn('line-clamp-2 text-[13px] leading-snug break-words', item.unread ? 'text-foreground' : 'text-foreground/80')}>
          {item.kind === 'reaction' && (
            <span className="text-muted-foreground">
              {t('activity.reacted', { emoji: item.reactions?.[0]?.key ?? '' })}{' '}
            </span>
          )}
          {item.text}
        </p>
        <p className="mt-1 flex items-center gap-1 truncate text-[12px] text-muted-foreground">
          <Icon className="size-3 shrink-0" />
          <span className="truncate">{context}</span>
        </p>
        {item.reactions && item.reactions.length > 1 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {item.reactions.slice(0, 8).map((r) => (
              <span key={r.key} className="rounded-full border px-1.5 text-[12px] leading-5 tabular-nums">
                {r.key} {r.count}
              </span>
            ))}
          </div>
        )}
      </div>
      {item.unread && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={markRead}
              aria-label={t('activity.markRead')}
              className="absolute top-2.5 right-3 hidden size-6 items-center justify-center rounded-full border bg-background text-muted-foreground group-focus-within:flex group-hover:flex hover:text-foreground"
            >
              <Check className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t('activity.markRead')}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
});
