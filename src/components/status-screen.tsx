import { Check, ChevronRight, Copy, Loader2, LogOut, RotateCw } from 'lucide-react';
import { useState } from 'react';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';

/** Startup splash: static logo with a spinner and the current step. */
export function LoadingScreen({ message }: { message: string }) {
  return (
    <div data-tauri-drag-region className="flex h-full flex-col items-center justify-center gap-5 bg-sidebar">
      <Logo size={56} />
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {message}
      </div>
    </div>
  );
}

/** Fatal startup error: friendly explanation, reload, log out, and the raw error on demand. */
export function ErrorScreen({ error, onLogout }: { error: string; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(error).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div data-tauri-drag-region className="flex h-full items-center justify-center bg-sidebar p-6">
      <div className="w-full max-w-md text-center">
        <Logo size={56} className="mx-auto" />
        <h1 className="mt-6 text-xl font-semibold tracking-tight">{t('status.errorTitle')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('status.errorDescription')}</p>

        <div className="mt-6 flex justify-center gap-2">
          <Button onClick={() => window.location.reload()}>
            <RotateCw />
            {t('status.reload')}
          </Button>
          <Button variant="outline" onClick={onLogout}>
            <LogOut />
            {t('status.logout')}
          </Button>
        </div>

        <div className="mt-6 text-left">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mx-auto flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
            {t('status.details')}
          </button>
          {open && (
            <div className="relative mt-2 rounded-lg border bg-background">
              <pre className="selectable max-h-48 overflow-auto p-3 pr-10 font-mono text-xs break-all whitespace-pre-wrap text-muted-foreground">
                {error}
              </pre>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={copy}
                aria-label={t('status.copyDetails')}
                title={t('status.copyDetails')}
                className="absolute top-1.5 right-1.5"
              >
                {copied ? <Check /> : <Copy />}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
