import { EventType, type MatrixEvent, MsgType, type Room } from 'matrix-js-sdk';
import type { RoomMessageEventContent } from 'matrix-js-sdk/lib/@types/events';
import type { JSONContent } from '@tiptap/react';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import { t } from '@/i18n';
import { matrixHtmlToEditor, plainToDoc, type SerializedMessage } from './serialize';
import type { VoiceClip } from './voice-recorder';
import { uploadBlob } from './upload';

const TEXT_TYPES = new Set<string>([MsgType.Text, MsgType.Emote, MsgType.Notice]);
const SHRUG = '¯\\_(ツ)_/¯';

export type Content = Record<string, unknown>;

export function findEvent(room: Room, threadId: string | undefined, eventId: string): MatrixEvent | undefined {
  return (
    room.findEventById(eventId) ??
    (threadId ? room.getThread(threadId)?.findEventById(eventId) : undefined) ??
    undefined
  );
}

/** Your last sent text message in this timeline (main or thread), for ↑ to edit. */
export function lastEditableEvent(room: Room, threadId: string | undefined): MatrixEvent | null {
  const me = room.client.getUserId();
  const events = threadId
    ? (room.getThread(threadId)?.liveTimeline.getEvents() ?? [])
    : room.getLiveTimeline().getEvents();
  for (let i = events.length - 1, seen = 0; i >= 0 && seen < 100; i--, seen++) {
    const ev = events[i];
    if (ev.getSender() !== me || ev.getType() !== EventType.RoomMessage) continue;
    if (ev.isRedacted() || ev.status || ev.isRelation('m.replace')) continue;
    if (!threadId && ev.threadRootId && !ev.isThreadRoot) continue;
    if (TEXT_TYPES.has(ev.getContent().msgtype ?? '')) return ev;
  }
  return null;
}

/** Editor content for editing an existing message. */
export function editContentFor(event: MatrixEvent): string | JSONContent {
  const content = event.getContent();
  if (content.format === 'org.matrix.custom.html' && typeof content.formatted_body === 'string') {
    return matrixHtmlToEditor(content.formatted_body);
  }
  const body = typeof content.body === 'string' ? content.body : '';
  // Media without a caption has the file name as body; there is nothing to edit.
  if (!TEXT_TYPES.has(content.msgtype ?? '') && (!content.filename || content.filename === body)) return '';
  return plainToDoc(body);
}

/** Applies `/me` and `/shrug` to the document (without touching the editor). */
export function applyCommand(state: EditorState): { doc: PMNode; msgtype: string } {
  const first = state.doc.firstChild;
  const text = first?.type.name === 'paragraph' && first.firstChild?.isText ? (first.firstChild.text ?? '') : '';
  if (/^\/me(\s|$)/.test(text)) {
    const len = text.match(/^\/me\s?/)![0].length;
    return { doc: state.tr.delete(1, 1 + len).doc, msgtype: MsgType.Emote };
  }
  if (/^\/shrug(\s|$)/.test(text)) {
    const tr = state.tr.delete(1, 1 + '/shrug'.length).insertText(SHRUG, 1);
    return { doc: tr.doc, msgtype: MsgType.Text };
  }
  return { doc: state.doc, msgtype: MsgType.Text };
}

export function mentionsFor(msg: SerializedMessage | null, replyTo: MatrixEvent | undefined, me: string | null) {
  const userIds = new Set(msg?.userIds ?? []);
  const replySender = replyTo?.getSender();
  if (replySender && replySender !== me) userIds.add(replySender);
  const mentions: { user_ids?: string[]; room?: boolean } = {};
  if (userIds.size) mentions.user_ids = [...userIds];
  if (msg?.room) mentions.room = true;
  return mentions;
}

export function textContent(msg: SerializedMessage, msgtype: string): Content {
  const content: Content = { msgtype, body: msg.body };
  if (msg.html !== null) {
    content.format = 'org.matrix.custom.html';
    content.formatted_body = msg.html;
  }
  return content;
}

/** Adds reply / thread relations. In threads, a non-reply still points at the latest thread event. */
export function addRelation(content: Content, room: Room, threadId: string | undefined, replyTo: string | null) {
  if (threadId) {
    const thread = room.getThread(threadId);
    const latest =
      thread?.lastReply((ev) => ev.isRelation('m.thread') && !ev.status)?.getId() ?? threadId;
    content['m.relates_to'] = {
      rel_type: 'm.thread',
      event_id: threadId,
      is_falling_back: !replyTo,
      'm.in_reply_to': { event_id: replyTo ?? latest },
    };
  } else if (replyTo) {
    content['m.relates_to'] = { 'm.in_reply_to': { event_id: replyTo } };
  }
}

export function editContent(original: MatrixEvent, msg: SerializedMessage, mentions: Content): Content {
  const orig = original.getContent();
  const base: Content = TEXT_TYPES.has(orig.msgtype ?? '')
    ? { msgtype: orig.msgtype }
    : Object.fromEntries(
        ['msgtype', 'url', 'file', 'info', 'filename', 'org.matrix.msc1767.audio', 'org.matrix.msc3245.voice']
          .filter((k) => k in orig)
          .map((k) => [k, orig[k]]),
      );
  const newContent: Content = { ...base, ...textContent(msg, String(base.msgtype ?? MsgType.Text)), 'm.mentions': mentions };
  // Only newly mentioned users get pinged again by an edit.
  const before = new Set<string>(orig['m.mentions']?.user_ids ?? []);
  const fresh = ((mentions.user_ids as string[] | undefined) ?? []).filter((u) => !before.has(u));
  const outer: Content = {
    ...newContent,
    body: `* ${msg.body}`,
    'm.mentions': fresh.length ? { user_ids: fresh } : {},
    'm.new_content': newContent,
    'm.relates_to': { rel_type: 'm.replace', event_id: original.getId() },
  };
  if (msg.html !== null) outer.formatted_body = `* ${msg.html}`;
  return outer;
}

export async function voiceContent(
  room: Room,
  clip: VoiceClip,
  encrypt: boolean,
  onProgress: (f: number) => void,
): Promise<Content> {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const filename = `${t('composer.voiceFileName')}-${stamp}.${clip.extension}`;
  const media = await uploadBlob(room.client, clip.blob, {
    name: filename,
    mimetype: clip.mimetype,
    encrypt,
    onProgress,
  });
  const content: Content = {
    msgtype: MsgType.Audio,
    body: t('composer.voiceBody'),
    filename,
    info: { mimetype: clip.mimetype, size: clip.blob.size, duration: clip.durationMs },
    'org.matrix.msc1767.audio': { duration: clip.durationMs, waveform: clip.waveform },
    'org.matrix.msc3245.voice': {},
  };
  if (media.file) content.file = media.file;
  else content.url = media.url;
  return content;
}

export function sendContent(room: Room, threadId: string | undefined, content: Content) {
  return room.client.sendMessage(room.roomId, threadId ?? null, content as unknown as RoomMessageEventContent);
}

export function errorText(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return t('common.unknownError');
}
