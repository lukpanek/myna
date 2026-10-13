import { type ReactNode, useId } from 'react';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

/** A titled block inside a settings tab. */
export function Section({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('border-b py-5 first:pt-0 last:border-b-0', className)}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Label + description on the left, a control on the right. */
export function Row({
  label,
  description,
  children,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-6 py-2', className)}>
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {description && <div className="text-[13px] text-muted-foreground">{description}</div>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

export function SwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const descriptionId = useId();
  return (
    <label className={cn('flex cursor-pointer items-center justify-between gap-6 py-2', disabled && 'opacity-60')}>
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {description && <div id={descriptionId} className="text-[13px] text-muted-foreground">{description}</div>}
      </div>
      <Switch aria-label={label} aria-describedby={description ? descriptionId : undefined} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </label>
  );
}

export function TabTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-5 text-lg font-semibold">{children}</h2>;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border bg-muted px-1.5 font-sans text-[11px] font-medium text-foreground/80">
      {children}
    </kbd>
  );
}
