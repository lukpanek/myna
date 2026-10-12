import logoUrl from '@/assets/logo.svg';
import { cn } from '@/lib/utils';

/** Myna app logo (same artwork as the dock / taskbar icon). */
export function Logo({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <img
      src={logoUrl}
      alt="Myna"
      width={size}
      height={size}
      draggable={false}
      // The artwork has transparent padding around the rounded square; scale it to fill the box.
      className={cn('shrink-0 scale-[1.24] select-none', className)}
    />
  );
}
