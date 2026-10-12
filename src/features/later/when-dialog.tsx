import { useState } from 'react';
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
import { dayjs } from '@/lib/time';
import { formatWhen, toLocalInput, whenPresets } from './when';

interface WhenDialogProps {
  open: boolean;
  title: string;
  description?: string;
  /** Offer only the custom date and time (the presets were shown in a menu already). */
  customOnly?: boolean;
  onPick: (at: number) => void;
  onOpenChange: (open: boolean) => void;
}

/** Picks a moment in the future: quick presets plus a custom date and time. */
export function WhenDialog({ open, title, description, customOnly, onPick, onOpenChange }: WhenDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {open && (
          <WhenForm
            title={title}
            description={description}
            customOnly={customOnly}
            onPick={(at) => {
              onPick(at);
              onOpenChange(false);
            }}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function WhenForm({
  title,
  description,
  customOnly,
  onPick,
  onCancel,
}: Omit<WhenDialogProps, 'open' | 'onOpenChange'> & { onCancel: () => void }) {
  const [presets] = useState(whenPresets);
  const [custom, setCustom] = useState(() => toLocalInput(dayjs().add(1, 'hour').startOf('hour').valueOf()));
  const customAt = dayjs(custom).valueOf();
  const customValid = !Number.isNaN(customAt) && customAt > Date.now();

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>

      {!customOnly && (
        <div className="-mx-2 flex flex-col">
          {presets.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => onPick(p.at)}
              className="flex items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              {p.label}
              <span className="text-xs text-muted-foreground tabular-nums">{formatWhen(p.at)}</span>
            </button>
          ))}
        </div>
      )}

      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (customValid) onPick(customAt);
        }}
      >
        <Label htmlFor="when-custom">{t('later.customTime')}</Label>
        <Input
          id="when-custom"
          type="datetime-local"
          value={custom}
          min={toLocalInput(Date.now())}
          onChange={(e) => setCustom(e.target.value)}
          aria-invalid={!customValid}
        />
        <DialogFooter className="mt-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={!customValid}>
            {t('later.set')}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
