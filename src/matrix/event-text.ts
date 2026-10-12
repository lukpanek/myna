import { EventType, type MatrixEvent, MsgType } from 'matrix-js-sdk';
import { t } from '@/i18n';
import { formatDuration } from '@/lib/time';

export const VOICE_KEY = 'org.matrix.msc3245.voice';
export const AUDIO_KEY = 'org.matrix.msc1767.audio';
const POLL_TYPES = new Set(['m.poll.start', 'org.matrix.msc3381.poll.start']);

/** Events that count as "messages" for previews, unread state and notifications. */
export function isMessageEvent(event: MatrixEvent): boolean {
  if (event.isRedacted() || event.isState()) return false;
  const type = event.getType();
  if (type === EventType.RoomMessage) {
    // Edits replace an earlier message; they are not new messages.
    return event.getContent()['m.relates_to']?.rel_type !== 'm.replace';
  }
  return type === EventType.Sticker || type === EventType.RoomMessageEncrypted || POLL_TYPES.has(type);
}

export function isVoiceMessage(content: Record<string, unknown>): boolean {
  return content.msgtype === MsgType.Audio && VOICE_KEY in content;
}

/** Short plain-text summary of a message for the room list and notifications. */
export function describeEvent(event: MatrixEvent): string {
  const type = event.getType();
  if (event.isRedacted()) return t('matrix.messageDeleted');
  if (type === EventType.RoomMessageEncrypted || event.isDecryptionFailure()) return `🔒 ${t('matrix.encryptedMessage')}`;
  if (type === EventType.Sticker) return `${t('matrix.sticker')} ${event.getContent().body ?? ''}`.trim();
  if (POLL_TYPES.has(type)) {
    const c = event.getContent();
    const q = c['m.poll']?.question ?? c['org.matrix.msc3381.poll.start']?.question;
    const text = q?.['m.text']?.[0]?.body ?? q?.['org.matrix.msc1767.text'] ?? q?.body;
    return `📊 ${text ?? t('matrix.poll')}`;
  }

  const content = event.getContent();
  const body: string = typeof content.body === 'string' ? content.body : '';
  switch (content.msgtype) {
    case MsgType.Image:
      return `📷 ${t('matrix.photo')}`;
    case MsgType.Video:
      return `🎥 ${t('matrix.video')}`;
    case MsgType.Audio: {
      if (isVoiceMessage(content)) {
        const ms = content.info?.duration ?? content[AUDIO_KEY]?.duration;
        return ms
          ? `🎤 ${t('matrix.voiceMessage')} (${formatDuration(ms)})`
          : `🎤 ${t('matrix.voiceMessage')}`;
      }
      return `🎵 ${body || t('matrix.audio')}`;
    }
    case MsgType.File:
      return `📎 ${body || t('matrix.file')}`;
    case MsgType.Location:
      return `📍 ${t('matrix.location')}`;
    case MsgType.Emote:
      return `* ${body}`;
    default:
      return stripReplyFallback(body);
  }
}

/** Removes the `> <@user> quoted text` reply fallback that older clients prepend to `body`. */
export function stripReplyFallback(body: string): string {
  if (!body.startsWith('> ')) return body;
  const lines = body.split('\n');
  let i = 0;
  while (i < lines.length && lines[i].startsWith('> ')) i++;
  if (lines[i] === '') i++;
  return lines.slice(i).join('\n');
}
