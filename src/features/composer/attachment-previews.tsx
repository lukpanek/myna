import { FileText, Film, Music, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { t } from '@/i18n';
import { formatBytes } from '@/lib/time';
import type { PendingFile } from './composer-store';

function useObjectUrl(file: File, enabled: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file, enabled]);
  return url;
}

function ProgressBar({ value }: { value: number | undefined }) {
  if (value === undefined) return null;
  return (
    <div className="absolute inset-x-1.5 bottom-1.5 h-1 overflow-hidden rounded-full bg-background/70">
      <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

function RemoveButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  if (disabled) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t('composer.removeAttachment')}
      title={t('common.remove')}
      className="absolute -top-1.5 -right-1.5 hidden size-5 items-center justify-center rounded-full border bg-background text-foreground shadow-sm group-hover:flex hover:bg-accent"
    >
      <X className="size-3" />
    </button>
  );
}

function Preview({
  item,
  progress,
  busy,
  onRemove,
}: {
  item: PendingFile;
  progress: number | undefined;
  busy: boolean;
  onRemove: () => void;
}) {
  const { file } = item;
  const isImage = file.type.startsWith('image/');
  const url = useObjectUrl(file, isImage);

  if (isImage) {
    return (
      <div className="group relative size-16 shrink-0" title={file.name}>
        {url ? (
          <img src={url} alt={file.name} draggable={false} className="size-full rounded-md border object-cover" />
        ) : (
          <div className="size-full rounded-md border bg-muted" />
        )}
        <ProgressBar value={progress} />
        <RemoveButton onClick={onRemove} disabled={busy} />
      </div>
    );
  }

  const Icon = file.type.startsWith('video/') ? Film : file.type.startsWith('audio/') ? Music : FileText;
  return (
    <div className="group relative flex h-16 w-56 shrink-0 items-center gap-2.5 rounded-md border bg-background px-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{file.name}</div>
        <div className="text-xs text-muted-foreground">
          {progress !== undefined ? `${Math.round(progress * 100)} % · ` : ''}
          {formatBytes(file.size)}
        </div>
      </div>
      <ProgressBar value={progress} />
      <RemoveButton onClick={onRemove} disabled={busy} />
    </div>
  );
}

export function AttachmentPreviews({
  files,
  progress,
  busy,
  onRemove,
}: {
  files: PendingFile[];
  progress: Record<string, number>;
  busy: boolean;
  onRemove: (id: string) => void;
}) {
  if (files.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 px-3 pt-3">
      {files.map((f) => (
        <Preview key={f.id} item={f} progress={progress[f.id]} busy={busy} onRemove={() => onRemove(f.id)} />
      ))}
    </div>
  );
}
