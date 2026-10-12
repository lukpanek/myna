import { type MatrixClient, type MatrixEvent, MsgType, type Room } from 'matrix-js-sdk';
import {
  AlarmClock,
  Code,
  Copy,
  Link2,
  type LucideIcon,
  MessagesSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Reply,
  SmilePlus,
  Trash2,
} from 'lucide-react';
import { type ComponentProps, Fragment, type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { EmojiPicker } from '@/features/emoji/emoji-picker';
import { composerKey, useComposerStore } from '@/features/composer/composer-store';
import { pickReminder } from '@/features/later/reminders';
import { t } from '@/i18n';
import { useMatrixClient } from '@/matrix/context';
import { stripReplyFallback } from '@/matrix/event-text';
import { canPin, pinnedEventIds, togglePin } from '@/matrix/pins';
import { roomPermalink } from '@/matrix/room-actions';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { toggleReaction } from './reactions';
import { useRoomDialogs } from './room-dialogs';
import { isPending } from './timeline-utils';

const EDITABLE = new Set<string>([MsgType.Text, MsgType.Notice, MsgType.Emote]);

export interface MessageAction {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  destructive?: boolean;
  separatorBefore?: boolean;
}

function canReplyInThread(event: MatrixEvent, threadId?: string): boolean {
  if (threadId || event.isState() || event.isRedacted()) return false;
  // Replies inside a thread cannot start their own thread.
  return !event.threadRootId || event.isThreadRoot;
}

/** Actions for one message, shared by the hover "⋯" menu and the right-click menu. */
export function getMessageActions(client: MatrixClient, room: Room, event: MatrixEvent, threadId?: string): MessageAction[] {
  const eventId = event.getId();
  const me = client.getSafeUserId();
  const own = event.getSender() === me;
  const pending = isPending(event) || !eventId || eventId.startsWith('~');
  const redacted = event.isRedacted();
  const content = event.getContent();
  const key = composerKey(room.roomId, threadId);
  const actions: MessageAction[] = [];

  if (!pending && !redacted && !event.isState()) {
    actions.push({
      key: 'reply',
      label: t('room.reply'),
      icon: Reply,
      onSelect: () => useComposerStore.getState().setReplyTo(key, eventId!),
    });
    if (canReplyInThread(event, threadId)) {
      actions.push({
        key: 'thread',
        label: t('room.replyInThread'),
        icon: MessagesSquare,
        onSelect: () => useUi.getState().setRightPanel({ kind: 'thread', rootId: eventId! }),
      });
    }
    if (own && EDITABLE.has(content.msgtype ?? '') && !event.isDecryptionFailure()) {
      actions.push({
        key: 'edit',
        label: t('common.edit'),
        icon: Pencil,
        onSelect: () => useComposerStore.getState().startEdit(key, eventId!),
      });
    }
  }
  if (!redacted && typeof content.body === 'string' && content.body) {
    actions.push({
      key: 'copy',
      label: t('room.copyText'),
      icon: Copy,
      separatorBefore: actions.length > 0,
      onSelect: () => {
        const text = event.replyEventId ? stripReplyFallback(content.body) : content.body;
        void navigator.clipboard.writeText(text).then(() => toast.success(t('room.textCopied')));
      },
    });
  }
  if (!pending && !redacted && !event.isState()) {
    if (!threadId && canPin(client, room)) {
      const pinned = pinnedEventIds(room).includes(eventId!);
      actions.push({
        key: 'pin',
        label: pinned ? t('room.unpin') : t('room.pin'),
        icon: pinned ? PinOff : Pin,
        separatorBefore: actions.length > 0,
        onSelect: () =>
          void togglePin(client, room, eventId!).catch(() =>
            toast.error(t(pinned ? 'room.unpinFailed' : 'room.pinFailed')),
          ),
      });
    }
    actions.push({
      key: 'remind',
      label: t('later.remindLater'),
      icon: AlarmClock,
      separatorBefore: !actions.some((a) => a.key === 'pin') && actions.length > 0,
      onSelect: () => pickReminder(room.roomId, eventId!),
    });
  }
  if (!pending) {
    actions.push({
      key: 'link',
      label: t('room.copyLink'),
      icon: Link2,
      onSelect: () => {
        void navigator.clipboard.writeText(roomPermalink(room.roomId, eventId)).then(() => toast.success(t('common.linkCopied')));
      },
    });
  }
  actions.push({
    key: 'source',
    label: t('room.viewSource'),
    icon: Code,
    onSelect: () => useRoomDialogs.getState().showSource(event),
  });
  if (!pending && !redacted && (own || room.currentState.maySendRedactionForEvent(event, me))) {
    actions.push({
      key: 'delete',
      label: t('common.delete'),
      icon: Trash2,
      destructive: true,
      separatorBefore: true,
      onSelect: () => useRoomDialogs.getState().confirmRedact(event),
    });
  }
  return actions;
}

/** Renders actions with the given menu item components (dropdown or context menu). */
export function renderActions(
  actions: MessageAction[],
  Item: (p: { onSelect: () => void; variant?: 'default' | 'destructive'; children: ReactNode }) => ReactNode,
  Separator: () => ReactNode,
): ReactNode[] {
  const out: ReactNode[] = [];
  // Called as plain functions so inline renderers do not become new component types each render.
  for (const a of actions) {
    if (a.separatorBefore) out.push(<Fragment key={`sep-${a.key}`}>{Separator()}</Fragment>);
    const Icon = a.icon;
    out.push(
      <Fragment key={a.key}>
        {Item({
          onSelect: a.onSelect,
          variant: a.destructive ? 'destructive' : 'default',
          children: (
            <>
              <Icon />
              {a.label}
            </>
          ),
        })}
      </Fragment>,
    );
  }
  return out;
}

function ToolbarButton({ label, children, ...rest }: ComponentProps<'button'> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent"
          {...rest}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

interface HoverToolbarProps {
  room: Room;
  event: MatrixEvent;
  threadId?: string;
  /** Keeps the toolbar mounted while a popover or menu is open. */
  onOpenChange: (open: boolean) => void;
}

/** Slack-style toolbar in the top-right corner of a hovered message. */
export function HoverToolbar({ room, event, threadId, onOpenChange }: HoverToolbarProps) {
  const client = useMatrixClient();
  const recent = useSettings((s) => s.recentEmoji);
  const pushRecentEmoji = useSettings((s) => s.pushRecentEmoji);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const actions = getMessageActions(client, room, event, threadId);
  const canReact = !isPending(event) && !event.isRedacted() && !event.isState();
  const reply = actions.find((a) => a.key === 'reply');
  const thread = actions.find((a) => a.key === 'thread');
  const menuActions = actions.filter((a) => a.key !== 'reply' && a.key !== 'thread');

  const react = (emoji: string) => {
    pushRecentEmoji(emoji);
    void toggleReaction(client, room, event, emoji);
  };
  const setPicker = (open: boolean) => {
    setPickerOpen(open);
    onOpenChange(open || menuOpen);
  };
  const setMenu = (open: boolean) => {
    setMenuOpen(open);
    onOpenChange(open || pickerOpen);
  };

  return (
    <div
      className="absolute -top-4 right-4 z-10 flex items-center gap-px rounded-lg border bg-background p-0.5 shadow-sm"
      onClick={(e) => e.stopPropagation()}
    >
      {canReact &&
        recent.slice(0, 3).map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => react(emoji)}
            title={t('room.reactWith', { emoji })}
            className="flex size-7 items-center justify-center rounded-md text-base hover:bg-accent"
          >
            {emoji}
          </button>
        ))}
      {canReact && (
        <Popover open={pickerOpen} onOpenChange={setPicker}>
          <PopoverTrigger asChild>
            <ToolbarButton label={t('room.addReaction')}>
              <SmilePlus className="size-4" />
            </ToolbarButton>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <EmojiPicker
              onPick={(emoji) => {
                setPicker(false);
                react(emoji);
              }}
            />
          </PopoverContent>
        </Popover>
      )}
      {reply && (
        <ToolbarButton label={reply.label} onClick={reply.onSelect}>
          <Reply className="size-4" />
        </ToolbarButton>
      )}
      {thread && (
        <ToolbarButton label={thread.label} onClick={thread.onSelect}>
          <MessagesSquare className="size-4" />
        </ToolbarButton>
      )}
      <DropdownMenu open={menuOpen} onOpenChange={setMenu}>
        <DropdownMenuTrigger asChild>
          <ToolbarButton label={t('room.moreActions')}>
            <MoreHorizontal className="size-4" />
          </ToolbarButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {renderActions(
            menuActions,
            ({ onSelect, variant, children }) => (
              <DropdownMenuItem onSelect={onSelect} variant={variant}>
                {children}
              </DropdownMenuItem>
            ),
            () => <DropdownMenuSeparator />,
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
