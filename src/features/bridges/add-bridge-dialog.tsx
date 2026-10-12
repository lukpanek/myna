import { LoaderCircle } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { t } from '@/i18n';
import { useBridges } from './use-bridges';

export function AddBridgeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = (next: boolean) => {
    if (busy) return;
    onOpenChange(next);
    if (!next) {
      setUrl('');
      setError(null);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      setError(t('bridges.enterBridgeUrl'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const entry = await useBridges.getState().addManualBridge(url);
      const name = entry.whoami?.network.displayname;
      toast.success(name ? t('bridges.bridgeAddedNamed', { name }) : t('bridges.bridgeAdded'));
      setBusy(false);
      close(false);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('bridges.addBridge')}</DialogTitle>
          <DialogDescription>
            {t('bridges.addBridgeDescription')}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="bridge-url">{t('bridges.bridgeUrl')}</Label>
            <Input
              id="bridge-url"
              autoFocus
              spellCheck={false}
              autoComplete="off"
              placeholder="https://matrix.example.com/whatsapp"
              value={url}
              aria-invalid={!!error}
              onChange={(e) => setUrl(e.target.value)}
            />
            {error ? (
              <p className="text-xs text-destructive">{error}</p>
            ) : (
              <p className="text-xs text-muted-foreground">{t('bridges.bridgeUrlHint')}</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => close(false)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <LoaderCircle className="animate-spin" />}
              {t('common.add')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
