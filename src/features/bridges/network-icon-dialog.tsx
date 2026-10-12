import { ImagePlus, Sparkles } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { toast } from 'sonner';
import { NetworkIcon, PlatformTile } from '@/components/mx-avatar';
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
import { PLATFORMS, detectPlatform } from '@/lib/platform-icons';
import { cn } from '@/lib/utils';
import { announcedNetworkName } from '@/matrix/bridge';
import { type NetworkIconChoice, useSettings } from '@/store/settings';

const CUSTOM_SIZE = 128;

export interface NetworkIconTarget {
  networkId: string;
  name: string;
  avatarMxc?: string;
}

type Selection = NetworkIconChoice | 'auto';

function sameChoice(a: Selection, b: Selection): boolean {
  if (a === 'auto' || b === 'auto') return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'platform' && b.kind === 'platform') return a.id === b.id;
  if (a.kind === 'custom' && b.kind === 'custom') return a.dataUrl === b.dataUrl;
  return true;
}

/** Loads any browser-readable image and center-crops it to a small square PNG data URL. */
async function imageToDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const side = Math.min(img.naturalWidth, img.naturalHeight) || CUSTOM_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = CUSTOM_SIZE;
    canvas.height = CUSTOM_SIZE;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      img,
      (img.naturalWidth - side) / 2,
      (img.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      CUSTOM_SIZE,
      CUSTOM_SIZE,
    );
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Edits how a bridged network looks: its name and icon (automatic, bridge avatar, a platform logo or an uploaded image). */
export function NetworkIconDialog({
  target,
  onOpenChange,
}: {
  target: NetworkIconTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {target && <IconPicker key={target.networkId} target={target} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function IconPicker({ target, onDone }: { target: NetworkIconTarget; onDone: () => void }) {
  const saved = useSettings((s) => s.networkIcons[target.networkId]);
  const setNetworkIcon = useSettings((s) => s.setNetworkIcon);
  const setNetworkName = useSettings((s) => s.setNetworkName);
  const announced = announcedNetworkName(target.networkId) ?? target.name;
  const savedName = useSettings((s) => s.networkNames[target.networkId]);
  const [name, setName] = useState(savedName ?? target.name);
  const [selection, setSelection] = useState<Selection>(saved ?? 'auto');
  const [custom, setCustom] = useState<string | null>(saved?.kind === 'custom' ? saved.dataUrl : null);
  const fileInput = useRef<HTMLInputElement>(null);
  const detected = detectPlatform(target.networkId, announced);

  const upload = async (file: File) => {
    try {
      const dataUrl = await imageToDataUrl(file);
      setCustom(dataUrl);
      setSelection({ kind: 'custom', dataUrl });
    } catch {
      toast.error(t('bridges.iconUploadFailed'));
    }
  };

  const save = () => {
    setNetworkIcon(target.networkId, selection === 'auto' ? null : selection);
    const trimmed = name.trim();
    setNetworkName(target.networkId, trimmed && trimmed !== announced ? trimmed : null);
    onDone();
  };

  const iconProps = { networkId: target.networkId, avatarMxc: target.avatarMxc, name: target.name };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('bridges.editTitle', { name: savedName ?? target.name })}</DialogTitle>
        <DialogDescription>{t('bridges.editDescription')}</DialogDescription>
      </DialogHeader>

      <div className="grid gap-2">
        <Label htmlFor="network-name">{t('bridges.nameLabel')}</Label>
        <Input
          id="network-name"
          value={name}
          placeholder={announced}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        <p className="text-xs text-muted-foreground">{t('bridges.nameHint', { name: announced })}</p>
      </div>

      <div className="flex justify-center py-2">
        <NetworkIcon {...iconProps} size={72} choice={selection} className="rounded-2xl shadow-sm" />
      </div>

      <div className="flex flex-wrap gap-2">
        <SourceOption
          label={t('bridges.iconAuto')}
          selected={selection === 'auto'}
          onSelect={() => setSelection('auto')}
          icon={
            detected ? (
              <PlatformTile platform={detected} size={20} className="rounded-md" />
            ) : (
              <Sparkles className="size-4" />
            )
          }
        />
        {target.avatarMxc && (
          <SourceOption
            label={t('bridges.iconBridge')}
            selected={selection !== 'auto' && selection.kind === 'bridge'}
            onSelect={() => setSelection({ kind: 'bridge' })}
            icon={<NetworkIcon {...iconProps} size={20} choice={{ kind: 'bridge' }} className="rounded-md" />}
          />
        )}
        {custom && (
          <SourceOption
            label={t('bridges.iconCustom')}
            selected={selection !== 'auto' && selection.kind === 'custom'}
            onSelect={() => setSelection({ kind: 'custom', dataUrl: custom })}
            icon={<img src={custom} alt="" className="size-5 rounded-md object-cover" />}
          />
        )}
      </div>

      <div>
        <div className="mb-2 text-xs font-medium text-muted-foreground">{t('bridges.iconPlatforms')}</div>
        <div className="grid grid-cols-7 gap-2">
          {PLATFORMS.map((p) => {
            const choice: NetworkIconChoice = { kind: 'platform', id: p.id };
            const selected = sameChoice(selection, choice);
            return (
              <button
                key={p.id}
                type="button"
                title={p.name}
                aria-label={p.name}
                aria-pressed={selected}
                onClick={() => setSelection(choice)}
                className={cn(
                  'flex aspect-square items-center justify-center rounded-xl outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring',
                  selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
                )}
              >
                <PlatformTile platform={p} size={40} className="rounded-xl" />
              </button>
            );
          })}
        </div>
      </div>

      <DialogFooter className="sm:justify-between">
        <Button variant="outline" onClick={() => fileInput.current?.click()}>
          <ImagePlus />
          {t('bridges.iconUpload')}
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onDone}>
            {t('common.cancel')}
          </Button>
          <Button onClick={save}>{t('common.save')}</Button>
        </div>
      </DialogFooter>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = '';
        }}
      />
    </>
  );
}

function SourceOption({
  label,
  icon,
  selected,
  onSelect,
}: {
  label: string;
  icon: ReactNode;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'flex h-9 items-center gap-2 rounded-lg border px-3 text-sm transition-colors hover:bg-accent',
        selected && 'border-primary bg-primary/5 text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
