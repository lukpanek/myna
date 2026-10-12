import { EventStatus, type MatrixEvent } from 'matrix-js-sdk';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { type ComponentProps, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { create } from 'zustand';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { t } from '@/i18n';
import { isMac, isTauri } from '@/lib/platform';
import { cn } from '@/lib/utils';
import { useMatrixClient } from '@/matrix/context';
import { type EncryptedFile, useMediaSrc } from '@/matrix/media';
import { downloadMedia } from './media-utils';

interface DialogsState {
  sourceEvent: MatrixEvent | null;
  redactEvent: MatrixEvent | null;
  lightbox: { items: MatrixEvent[]; index: number } | null;
  showSource: (event: MatrixEvent | null) => void;
  confirmRedact: (event: MatrixEvent | null) => void;
  openLightbox: (items: MatrixEvent[], event: MatrixEvent) => void;
  closeLightbox: () => void;
  stepLightbox: (delta: number) => void;
}

/** Room-level dialogs opened from message rows (main timeline and thread panel share them). */
export const useRoomDialogs = create<DialogsState>((set) => ({
  sourceEvent: null,
  redactEvent: null,
  lightbox: null,
  showSource: (sourceEvent) => set({ sourceEvent }),
  confirmRedact: (redactEvent) => set({ redactEvent }),
  openLightbox: (items, event) => {
    const index = items.indexOf(event);
    set({ lightbox: index >= 0 ? { items, index } : { items: [event], index: 0 } });
  },
  closeLightbox: () => set({ lightbox: null }),
  stepLightbox: (delta) =>
    set((s) => {
      if (!s.lightbox) return s;
      const index = s.lightbox.index + delta;
      if (index < 0 || index >= s.lightbox.items.length) return s;
      return { lightbox: { ...s.lightbox, index } };
    }),
}));

export function RoomDialogs() {
  return (
    <>
      <SourceDialog />
      <RedactDialog />
      <Lightbox />
    </>
  );
}

function SourceDialog() {
  const event = useRoomDialogs((s) => s.sourceEvent);
  const close = useRoomDialogs((s) => s.showSource);
  const json = event ? JSON.stringify(event.event, null, 2) : '';
  const clear = event?.isEncrypted() ? JSON.stringify(event.getClearContent(), null, 2) : null;
  return (
    <Dialog open={!!event} onOpenChange={(open) => !open && close(null)}>
      <DialogContent className="max-h-[85vh] grid-rows-[auto_1fr] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('room.messageSource')}</DialogTitle>
          <DialogDescription className="font-mono text-xs break-all">{event?.getId()}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-3 overflow-auto">
          <pre className="selectable rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-all">
            {json}
          </pre>
          {clear && (
            <>
              <div className="text-xs font-medium text-muted-foreground">{t('room.decryptedContent')}</div>
              <pre className="selectable rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-all">
                {clear}
              </pre>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RedactDialog() {
  const client = useMatrixClient();
  const event = useRoomDialogs((s) => s.redactEvent);
  const close = useRoomDialogs((s) => s.confirmRedact);
  const [busy, setBusy] = useState(false);

  const redact = async () => {
    if (!event) return;
    const roomId = event.getRoomId();
    const eventId = event.getId();
    if (!roomId || !eventId) return;
    setBusy(true);
    try {
      if (event.status === EventStatus.NOT_SENT || event.isSending()) client.cancelPendingEvent(event);
      else await client.redactEvent(roomId, eventId);
      close(null);
    } catch {
      toast.error(t('room.deleteFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!event} onOpenChange={(open) => !open && close(null)}>
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('room.deleteTitle')}</DialogTitle>
          <DialogDescription>{t('room.deleteDescription')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(null)}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void redact()}>
            {t('common.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Lightbox() {
  const lightbox = useRoomDialogs((s) => s.lightbox);
  const close = useRoomDialogs((s) => s.closeLightbox);
  const step = useRoomDialogs((s) => s.stepLightbox);
  const event = lightbox ? lightbox.items[lightbox.index] : null;
  const hasPrev = !!lightbox && lightbox.index > 0;
  const hasNext = !!lightbox && lightbox.index < lightbox.items.length - 1;

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox, step]);

  return (
    <DialogPrimitive.Root open={!!event} onOpenChange={(open) => !open && close()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/90 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex flex-col text-white outline-none"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          {event && (
            <>
              <div
                data-tauri-drag-region
                // On macOS the window's traffic lights overlay the top-left corner.
                className={cn('flex h-12 shrink-0 items-center gap-2 px-4', isTauri && isMac && 'pl-20')}
              >
                <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-sm font-medium">
                  {mediaName(event)}
                </DialogPrimitive.Title>
                <LightboxButton label={t('room.download')} onClick={() => void downloadMedia(event.getContent())}>
                  <Download className="size-5" />
                </LightboxButton>
                <DialogPrimitive.Close asChild>
                  <LightboxButton label={t('common.close')}>
                    <X className="size-5" />
                  </LightboxButton>
                </DialogPrimitive.Close>
              </div>
              <div
                className="relative flex min-h-0 flex-1 items-center justify-center px-16 pb-8"
                onClick={(e) => {
                  if (e.target === e.currentTarget) close();
                }}
              >
                <LightboxMedia key={event.getId()} event={event} />
                {hasPrev && (
                  <LightboxButton label={t('room.previous')} className="absolute left-3" onClick={() => step(-1)}>
                    <ChevronLeft className="size-7" />
                  </LightboxButton>
                )}
                {hasNext && (
                  <LightboxButton label={t('room.next')} className="absolute right-3" onClick={() => step(1)}>
                    <ChevronRight className="size-7" />
                  </LightboxButton>
                )}
              </div>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function mediaName(event: MatrixEvent): string {
  const c = event.getContent();
  return (c.filename as string | undefined) || (c.body as string | undefined) || t('room.media');
}

function LightboxButton({
  label,
  className,
  children,
  ...props
}: ComponentProps<'button'> & { label: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={`flex size-10 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white ${className ?? ''}`}
      {...props}
    >
      {children}
    </button>
  );
}

function LightboxMedia({ event }: { event: MatrixEvent }) {
  const content = event.getContent();
  const file = content.file as EncryptedFile | undefined;
  const mimetype = content.info?.mimetype as string | undefined;
  const src = useMediaSrc(file ? undefined : (content.url as string | undefined), file, mimetype);
  if (!src) return <div className="size-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />;
  if (content.msgtype === 'm.video') {
    return <video src={src} controls autoPlay className="max-h-full max-w-full rounded-md" />;
  }
  return <img src={src} alt={mediaName(event)} className="max-h-full max-w-full rounded-md object-contain" />;
}
