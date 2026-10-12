import { type Editor, EditorContent, type EditorOptions, useEditor } from '@tiptap/react';
import type { Room } from 'matrix-js-sdk';
import { AtSign, CaseSensitive, Mic, Pencil, Plus, Reply, SendHorizontal, Smile, X } from 'lucide-react';
import { type ComponentProps, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { EmojiPicker } from '@/features/emoji/emoji-picker';
import { senderName } from '@/features/room/timeline-utils';
import { t } from '@/i18n';
import { tn } from '@/i18n/rich';
import { modKey } from '@/lib/platform';
import { cn } from '@/lib/utils';
import { useMatrixClient } from '@/matrix/context';
import { describeEvent } from '@/matrix/event-text';
import { useRoomSummary } from '@/matrix/hooks';
import { useSettings } from '@/store/settings';
import { AttachmentPreviews } from './attachment-previews';
import { composerKey, useComposerEntry, useComposerStore } from './composer-store';
import { buildExtensions } from './extensions';
import { FormatToolbar } from './format-toolbar';
import { type LinkDraft, LinkForm, applyLink, readLinkDraft } from './link-form';
import {
  addRelation,
  applyCommand,
  editContent,
  editContentFor,
  errorText,
  findEvent,
  lastEditableEvent,
  mentionsFor,
  sendContent,
  textContent,
  voiceContent,
} from './send';
import { serializeDoc } from './serialize';
import { SuggestionPopup, useSuggestionPopup } from './suggestion-popup';
import { buildFileContent } from './upload';
import { type VoiceClip, VoiceRecorder } from './voice-recorder';
import './composer.css';

const TYPING_TIMEOUT = 5000;
const TYPING_REFRESH = 3000;

/** Enter inside a list or code block continues the block instead of sending (like Slack). */
function inBlockContext(editor: Editor): boolean {
  return editor.isActive('codeBlock') || editor.isActive('bulletList') || editor.isActive('orderedList');
}

export function Composer({ room, threadId }: { room: Room; threadId?: string }) {
  const client = useMatrixClient();
  const key = composerKey(room.roomId, threadId);
  const entry = useComposerEntry(key);
  const summary = useRoomSummary(room.roomId);
  const sendWithShift = useSettings((s) => s.sendWithShift);

  const [toolbarOpen, setToolbarOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [voiceProgress, setVoiceProgress] = useState<number | null>(null);
  const [linkDraft, setLinkDraft] = useState<LinkDraft | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [empty, setEmpty] = useState(true);
  const suggestion = useSuggestionPopup();
  const fileInput = useRef<HTMLInputElement>(null);

  const editorRef = useRef<Editor | null>(null);
  const busyRef = useRef(false);
  /** Draft (HTML) put aside while an older message is being edited. */
  const draftBeforeEdit = useRef<string | null>(null);
  const typingRef = useRef({ active: false, last: 0 });
  const latestKeyDown = useRef<(event: KeyboardEvent) => boolean>(() => false);

  const roomName = summary?.name ?? room.name;
  const placeholderRef = useRef('');
  placeholderRef.current = entry.editEventId
    ? t('composer.placeholderEdit')
    : threadId
      ? t('composer.placeholderThread')
      : t('composer.placeholderRoom', { name: roomName });

  // --- typing notifications -------------------------------------------------

  const setTyping = useCallback(
    (on: boolean) => {
      const typing = typingRef.current;
      const now = Date.now();
      if (on) {
        if (typing.active && now - typing.last < TYPING_REFRESH) return;
        typing.active = true;
        typing.last = now;
        void client.sendTyping(room.roomId, true, TYPING_TIMEOUT).catch(() => undefined);
      } else if (typing.active) {
        typing.active = false;
        void client.sendTyping(room.roomId, false, 0).catch(() => undefined);
      }
    },
    [client, room.roomId],
  );

  // --- sending ----------------------------------------------------------------

  const send = async () => {
    const editor = editorRef.current;
    if (!editor || busyRef.current) return;
    const store = useComposerStore.getState();
    const { files, replyToEventId, editEventId } = store.get(key);
    const { doc, msgtype } = applyCommand(editor.state);
    const msg = serializeDoc(doc);
    const hasText = msg.body.trim().length > 0;
    if (!hasText && files.length === 0) return;

    const replyTo = replyToEventId ? findEvent(room, threadId, replyToEventId) : undefined;
    const mentions = mentionsFor(hasText ? msg : null, replyTo, client.getUserId());
    setTyping(false);

    if (editEventId) {
      const original = findEvent(room, threadId, editEventId);
      if (!original) {
        toast.error(t('composer.editTargetNotFound'));
        return;
      }
      if (!hasText) {
        toast.error(t('composer.editEmpty'));
        return;
      }
      const unchanged = msg.body === original.getContent().body && msg.html === (original.getContent().formatted_body ?? null);
      editor.commands.clearContent(true);
      store.startEdit(key, null);
      if (unchanged) return;
      try {
        // Edits never carry the thread relation, only m.replace.
        await sendContent(room, undefined, editContent(original, msg, mentions));
      } catch (err) {
        toast.error(t('composer.editSaveFailed', { error: errorText(err) }));
      }
      return;
    }

    if (files.length === 0) {
      const content = textContent(msg, msgtype);
      content['m.mentions'] = mentions;
      addRelation(content, room, threadId, replyToEventId);
      editor.commands.clearContent(true);
      if (replyToEventId) store.setReplyTo(key, null);
      // Failures show on the message itself ("Neodesláno · Zkusit znovu").
      void sendContent(room, threadId, content).catch(() => undefined);
      return;
    }

    // Attachments: one file takes the text as its caption, several get the text as a separate message.
    const encrypt = room.hasEncryptionStateEvent();
    const caption = hasText && files.length === 1 ? { body: msg.body, html: msg.html } : null;
    busyRef.current = true;
    setBusy(true);
    editor.setEditable(false);
    let reply = replyToEventId;
    let failed = false;
    try {
      if (hasText && !caption) {
        const content = textContent(msg, msgtype);
        content['m.mentions'] = mentions;
        addRelation(content, room, threadId, reply);
        reply = null;
        await sendContent(room, threadId, content);
        editor.commands.clearContent(true);
      }
      for (const f of files) {
        try {
          const content = await buildFileContent(client, f.file, {
            encrypt,
            caption,
            onProgress: (p) => setProgress((prev) => ({ ...prev, [f.id]: p })),
          });
          if (caption) content['m.mentions'] = mentions;
          addRelation(content, room, threadId, reply);
          reply = null;
          await sendContent(room, threadId, content);
          useComposerStore.getState().removeFile(key, f.id);
        } catch (err) {
          failed = true;
          toast.error(t('composer.fileSendFailed', { name: f.file.name, error: errorText(err) }));
        }
      }
      if (!failed) {
        editor.commands.clearContent(true);
        if (replyToEventId) useComposerStore.getState().setReplyTo(key, null);
      }
    } catch (err) {
      toast.error(t('composer.sendFailed', { error: errorText(err) }));
    } finally {
      busyRef.current = false;
      setBusy(false);
      setProgress({});
      editor.setEditable(true);
      editor.commands.focus('end');
    }
  };

  const sendVoice = async (clip: VoiceClip) => {
    setRecording(false);
    const { replyToEventId } = useComposerStore.getState().get(key);
    setVoiceProgress(0);
    try {
      const content = await voiceContent(room, clip, room.hasEncryptionStateEvent(), setVoiceProgress);
      addRelation(content, room, threadId, replyToEventId);
      if (replyToEventId) useComposerStore.getState().setReplyTo(key, null);
      await sendContent(room, threadId, content);
    } catch (err) {
      toast.error(t('composer.voiceSendFailed', { error: errorText(err) }));
    } finally {
      setVoiceProgress(null);
    }
  };

  const openLink = () => {
    const editor = editorRef.current;
    if (editor) setLinkDraft(readLinkDraft(editor));
  };

  // The editor is created once; its callbacks read the latest closures through this ref.
  const latest = useRef({ send, openLink, suggestion, sendWithShift });
  latest.current = { send, openLink, suggestion, sendWithShift };

  const handleKeyDown = (event: KeyboardEvent): boolean => {
    const editor = editorRef.current;
    if (!editor) return false;
    const { suggestion: sugg, sendWithShift: shiftSends } = latest.current;
    if (sugg.handleKey(event, editor.view)) return true;
    const store = useComposerStore.getState();
    const state = store.get(key);

    if (event.key === 'Enter' && !event.isComposing) {
      if (event.metaKey || event.ctrlKey) {
        void latest.current.send();
        return true;
      }
      const wantsSend = shiftSends ? event.shiftKey : !event.shiftKey;
      if (!wantsSend || (!shiftSends && inBlockContext(editor))) return false;
      void latest.current.send();
      return true;
    }
    if (event.key === 'ArrowUp' && !event.shiftKey && editor.isEmpty && !state.editEventId && state.files.length === 0) {
      const last = lastEditableEvent(room, threadId);
      const id = last?.getId();
      if (!id) return false;
      store.startEdit(key, id);
      return true;
    }
    if (event.key === 'Escape') {
      if (state.editEventId) {
        editor.commands.clearContent(true);
        store.startEdit(key, null);
        return true;
      }
      if (state.replyToEventId) {
        store.setReplyTo(key, null);
        return true;
      }
    }
    return false;
  };

  latestKeyDown.current = handleKeyDown;

  // Options must stay referentially stable, otherwise TipTap re-applies them on every render.
  const [extensions] = useState(() =>
    buildExtensions({
      room,
      placeholder: () => placeholderRef.current,
      onLink: () => latest.current.openLink(),
      sink: suggestion.setView,
    }),
  );
  const [initialContent] = useState(() => useComposerStore.getState().drafts[key] || '');
  const editorProps = useMemo<EditorOptions['editorProps']>(
    () => ({
      attributes: { 'aria-label': t('composer.message'), spellcheck: 'true' },
      handleKeyDown: (_view, event) => latestKeyDown.current(event),
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length === 0) return false;
        useComposerStore.getState().addFiles(key, files);
        return true;
      },
      handleDrop: (_view, event, _slice, moved) => {
        const files = Array.from((event as DragEvent).dataTransfer?.files ?? []);
        if (moved || files.length === 0) return false;
        event.preventDefault();
        useComposerStore.getState().addFiles(key, files);
        return true;
      },
    }),
    [key],
  );

  const editor = useEditor({
    extensions,
    content: initialContent,
    autofocus: 'end',
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps,
    onCreate: ({ editor: e }) => setEmpty(e.isEmpty),
    onUpdate: ({ editor: e }) => {
      setEmpty(e.isEmpty);
      if (!e.isEmpty && !useComposerStore.getState().get(key).editEventId) setTyping(true);
      else if (e.isEmpty) setTyping(false);
    },
  });
  editorRef.current = editor;

  // Keep the draft when switching chats; an edit in progress gives way to the draft it replaced.
  useEffect(
    () => () => {
      const e = editorRef.current;
      const draft = draftBeforeEdit.current ?? (e && !e.isEmpty ? e.getHTML() : '');
      useComposerStore.getState().setDraft(key, draft);
      setTyping(false);
    },
    [key, setTyping],
  );

  // Entering / leaving edit mode swaps the editor content.
  useEffect(() => {
    if (!editor) return;
    if (entry.editEventId) {
      const original = findEvent(room, threadId, entry.editEventId);
      if (!original) {
        useComposerStore.getState().startEdit(key, null);
        return;
      }
      if (draftBeforeEdit.current === null) draftBeforeEdit.current = editor.isEmpty ? '' : editor.getHTML();
      editor.commands.setContent(editContentFor(original), { emitUpdate: false });
      editor.commands.focus('end');
      setEmpty(editor.isEmpty);
    } else if (draftBeforeEdit.current !== null) {
      editor.commands.setContent(draftBeforeEdit.current, { emitUpdate: false });
      draftBeforeEdit.current = null;
      setEmpty(editor.isEmpty);
    }
  }, [editor, entry.editEventId, room, threadId, key]);

  useEffect(() => {
    if (entry.focusNonce && editor && !recording) editor.commands.focus('end');
  }, [editor, entry.focusNonce, recording]);

  if (!editor) return null;

  const canSend = (!empty || entry.files.length > 0) && !busy;
  const insertMention = () => {
    const before = editor.state.selection.$from.nodeBefore?.text ?? '';
    editor.chain().focus().insertContent(before && !/\s$/.test(before) ? ' @' : '@').run();
  };

  return (
    <div className={cn('shrink-0 pt-1 pb-4', threadId ? 'px-3' : 'px-5')}>
      <div
        className={cn(
          'overflow-hidden rounded-lg border bg-background transition-shadow focus-within:border-ring/60 focus-within:shadow-sm',
          entry.editEventId && 'border-amber-500/60 focus-within:border-amber-500',
        )}
      >
        {entry.editEventId ? (
          <ContextBanner
            icon={<Pencil className="size-3.5" />}
            title={t('composer.editing')}
            hint={t('composer.editHint')}
            onCancel={() => {
              editor.commands.clearContent(true);
              useComposerStore.getState().startEdit(key, null);
            }}
          />
        ) : (
          entry.replyToEventId && (
            <ReplyBanner
              room={room}
              threadId={threadId}
              eventId={entry.replyToEventId}
              onCancel={() => useComposerStore.getState().setReplyTo(key, null)}
            />
          )
        )}
        {toolbarOpen && !recording && <FormatToolbar editor={editor} onLink={openLink} />}
        <AttachmentPreviews
          files={entry.files}
          progress={progress}
          busy={busy}
          onRemove={(id) => useComposerStore.getState().removeFile(key, id)}
        />

        {recording ? (
          <VoiceRecorder onCancel={() => setRecording(false)} onSend={(clip) => void sendVoice(clip)} />
        ) : (
          <>
            <EditorContent editor={editor} className="composer-editor text-[15px]" />
            <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
              <IconButton label={t('composer.addFile')} onClick={() => fileInput.current?.click()} disabled={busy}>
                <Plus className="size-4" />
              </IconButton>
              <IconButton
                label={toolbarOpen ? t('composer.hideFormatting') : t('composer.showFormatting')}
                pressed={toolbarOpen}
                onClick={() => setToolbarOpen((v) => !v)}
              >
                <CaseSensitive className="size-4.5" />
              </IconButton>
              <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                <PopoverTrigger asChild>
                  <IconButton label={t('composer.emoji')}>
                    <Smile className="size-4" />
                  </IconButton>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" side="top" align="start">
                  <EmojiPicker
                    onPick={(emoji) => {
                      setEmojiOpen(false);
                      editor.chain().focus().insertContent(emoji).run();
                    }}
                  />
                </PopoverContent>
              </Popover>
              <IconButton label={t('composer.mention')} onClick={insertMention}>
                <AtSign className="size-4" />
              </IconButton>
              {voiceProgress !== null && (
                <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                  {t('composer.sendingVoice', { percent: Math.round(voiceProgress * 100) })}
                </span>
              )}
              <div className="ml-auto flex items-center gap-0.5">
                {empty && entry.files.length === 0 && !entry.editEventId && (
                  <IconButton
                    label={t('composer.recordVoice')}
                    onClick={() => setRecording(true)}
                    disabled={voiceProgress !== null}
                  >
                    <Mic className="size-4" />
                  </IconButton>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={entry.editEventId ? t('composer.saveEdit') : t('composer.send')}
                      disabled={!canSend}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => void send()}
                      className={cn(
                        'flex h-7 w-8 items-center justify-center rounded-md transition-colors',
                        canSend ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'text-muted-foreground/60',
                      )}
                    >
                      <SendHorizontal className="size-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {entry.editEventId ? t('composer.saveEdit') : t('composer.send')} ({sendWithShift ? 'Shift+Enter' : 'Enter'},{' '}
                    {modKey}+Enter)
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </>
        )}
      </div>

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) useComposerStore.getState().addFiles(key, files);
          e.target.value = '';
        }}
      />

      <SuggestionPopup view={suggestion.view} active={suggestion.active} onHover={suggestion.setActive} />

      <Dialog open={!!linkDraft} onOpenChange={(open) => !open && setLinkDraft(null)}>
        <DialogContent className="sm:max-w-md" onCloseAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{linkDraft?.existing ? t('composer.editLink') : t('composer.addLink')}</DialogTitle>
          </DialogHeader>
          {linkDraft && (
            <LinkForm
              draft={linkDraft}
              onSubmit={(text, url) => {
                applyLink(editor, linkDraft, text, url);
                setLinkDraft(null);
              }}
              onRemove={() => {
                applyLink(editor, linkDraft, linkDraft.text, '');
                setLinkDraft(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function IconButton({
  label,
  pressed,
  children,
  ...rest
}: ComponentProps<'button'> & { label: string; pressed?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          onMouseDown={(e) => e.preventDefault()}
          className={cn(
            'flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-accent',
            pressed && 'bg-accent text-foreground',
          )}
          {...rest}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

function ContextBanner({
  icon,
  title,
  hint,
  children,
  onCancel,
}: {
  icon: ReactNode;
  title: ReactNode;
  hint?: string;
  children?: ReactNode;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-start gap-2 border-b bg-muted/40 py-1.5 pr-1.5 pl-3 text-[13px]">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate">
          {title}
          {hint && <span className="ml-2 text-xs text-muted-foreground">{hint}</span>}
        </div>
        {children}
      </div>
      <button
        type="button"
        aria-label={t('common.cancel')}
        title={t('composer.cancelEsc')}
        onClick={onCancel}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function ReplyBanner({
  room,
  threadId,
  eventId,
  onCancel,
}: {
  room: Room;
  threadId?: string;
  eventId: string;
  onCancel: () => void;
}) {
  const event = findEvent(room, threadId, eventId);
  return (
    <ContextBanner
      icon={<Reply className="size-3.5" />}
      title={tn('composer.replyTo', {
        name: <span className="font-semibold">{event ? senderName(room, event) : t('composer.replyToMessage')}</span>,
      })}
      onCancel={onCancel}
    >
      {event && <div className="truncate text-muted-foreground">{describeEvent(event)}</div>}
    </ContextBanner>
  );
}
