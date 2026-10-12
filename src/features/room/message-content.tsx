import { EventType, type MatrixEvent, MsgType } from 'matrix-js-sdk';
import { Lock, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import { AUDIO_KEY, isVoiceMessage, stripReplyFallback } from '@/matrix/event-text';
import type { EncryptedFile } from '@/matrix/media';
import { AudioPlayer } from './audio-player';
import { HtmlBody, PlainBody } from './html-body';
import {
  FileContent,
  ImageContent,
  LocationContent,
  PollContent,
  StickerContent,
  VideoContent,
} from './media-content';
import { isJumboEmoji, isPollEvent } from './timeline-utils';

type Content = Record<string, unknown>;

const HTML_FORMAT = 'org.matrix.custom.html';

/** Text body (plain or formatted). `isReply` strips the legacy reply fallback from plain bodies. */
export function TextBody({
  content,
  isReply,
  className,
  suffix,
}: {
  content: Content;
  isReply: boolean;
  className?: string;
  suffix?: ReactNode;
}) {
  const raw = typeof content.body === 'string' ? content.body : '';
  const body = isReply ? stripReplyFallback(raw) : raw;
  const html = content.format === HTML_FORMAT && typeof content.formatted_body === 'string' ? content.formatted_body : null;
  if (isJumboEmoji(body) && (!html || !html.includes('<img'))) {
    return (
      <PlainBody
        text={body.trim()}
        className={cn('mx-jumbo text-[2.25em] leading-tight', className)}
        suffix={suffix && <span className="text-[15px]">{suffix}</span>}
      />
    );
  }
  if (html) return <HtmlBody html={html} className={className} suffix={suffix} />;
  return <PlainBody text={body} className={className} suffix={suffix} />;
}

/** MSC2530 captions: media with a separate filename uses `body` as the caption. */
function Caption({ content, isReply }: { content: Content; isReply: boolean }) {
  const filename = content.filename;
  const body = content.body;
  if (typeof filename !== 'string' || typeof body !== 'string' || !body || body === filename) return null;
  return <TextBody content={content} isReply={isReply} className="mt-1" />;
}

export function MessageContent({
  event,
  senderName,
  suffix,
}: {
  event: MatrixEvent;
  senderName: string;
  /** Inline marker after text bodies, e.g. "(upraveno)". */
  suffix?: ReactNode;
}) {
  if (event.isRedacted()) {
    return (
      <div className="flex items-center gap-1.5 text-muted-foreground italic">
        <Trash2 className="size-3.5" />
        {t('room.messageDeleted')}
      </div>
    );
  }
  if (event.isDecryptionFailure() || event.getType() === EventType.RoomMessageEncrypted) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="inline-flex items-center gap-1.5 text-muted-foreground">
            <Lock className="size-3.5" />
            {t('room.cannotDecrypt')}
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">
          {t('room.missingKeys')}
        </TooltipContent>
      </Tooltip>
    );
  }

  const content = event.getContent();
  const isReply = !!event.replyEventId;
  if (event.getType() === EventType.Sticker) return <StickerContent content={content} />;
  if (isPollEvent(event)) return <PollContent content={content} />;

  switch (content.msgtype) {
    case MsgType.Image:
      return (
        <>
          <ImageContent event={event} content={content} />
          <Caption content={content} isReply={isReply} />
        </>
      );
    case MsgType.Video:
      return (
        <>
          <VideoContent content={content} />
          <Caption content={content} isReply={isReply} />
        </>
      );
    case MsgType.Audio: {
      const voice = isVoiceMessage(content);
      const audio = content[AUDIO_KEY] as { duration?: number; waveform?: unknown } | undefined;
      return (
        <>
          <AudioPlayer
            url={content.url as string | undefined}
            file={content.file as EncryptedFile | undefined}
            mimetype={content.info?.mimetype}
            durationMs={content.info?.duration ?? audio?.duration}
            waveform={audio?.waveform}
            name={voice ? undefined : (content.filename as string) || (content.body as string) || t('room.audio')}
          />
          {!voice && <Caption content={content} isReply={isReply} />}
        </>
      );
    }
    case MsgType.File:
      return (
        <>
          <FileContent content={content} />
          <Caption content={content} isReply={isReply} />
        </>
      );
    case MsgType.Location:
      return <LocationContent content={content} />;
    case MsgType.Emote:
      return (
        <div className="italic">
          <span className="mr-1 font-medium not-italic text-muted-foreground">* {senderName}</span>
          <TextBody content={content} isReply={isReply} className="inline" suffix={suffix} />
        </div>
      );
    case MsgType.Notice:
      return <TextBody content={content} isReply={isReply} className="text-muted-foreground" suffix={suffix} />;
    default:
      return <TextBody content={content} isReply={isReply} suffix={suffix} />;
  }
}
