import { memo, useState } from 'react';
import { type PlatformIcon, detectPlatform, glyphColor, platformById } from '@/lib/platform-icons';
import { cn } from '@/lib/utils';
import { networkColor } from '@/matrix/bridge';
import { useThumbnail } from '@/matrix/media';
import { type NetworkIconChoice, useSettings } from '@/store/settings';

const FALLBACK_COLORS = ['#e8590c', '#2f9e44', '#1971c2', '#9c36b5', '#c2255c', '#0c8599', '#5f3dc4', '#e67700'];

function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length];
}

function initials(name: string): string {
  const clean = name.replace(/^[@#!+]/, '').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (clean[0] ?? '?').toUpperCase();
}

interface MxAvatarProps {
  mxc?: string | null;
  name: string;
  /** Seed for the fallback color; defaults to name. Pass the user/room id for stability. */
  seed?: string;
  size: number;
  /** People are round; rooms and groups use Slack-style rounded squares. */
  shape?: 'circle' | 'square';
  className?: string;
  network?: { id: string; avatarMxc?: string } | null;
}

export const MxAvatar = memo(function MxAvatar({
  mxc,
  name,
  seed,
  size,
  shape = 'circle',
  className,
  network,
}: MxAvatarProps) {
  const src = useThumbnail(mxc, size);
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = src && failed !== src;
  const radius = shape === 'circle' ? '9999px' : `${Math.max(4, Math.round(size * 0.22))}px`;

  return (
    <span className={cn('relative inline-flex shrink-0', className)} style={{ width: size, height: size }}>
      {showImage ? (
        <img
          src={src}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(src)}
          className="size-full object-cover bg-muted"
          style={{ borderRadius: radius }}
        />
      ) : (
        <span
          aria-hidden
          className="flex size-full items-center justify-center font-semibold text-white"
          style={{ borderRadius: radius, background: colorFor(seed ?? name), fontSize: Math.max(9, size * 0.4) }}
        >
          {initials(name)}
        </span>
      )}
      {network && (
        <NetworkIcon
          networkId={network.id}
          avatarMxc={network.avatarMxc}
          size={Math.max(12, Math.round(size * 0.42))}
          className="absolute -right-1 -bottom-1 ring-2 ring-[var(--avatar-ring,var(--sidebar))]"
        />
      )}
    </span>
  );
});

interface NetworkIconProps {
  networkId: string;
  avatarMxc?: string;
  size: number;
  className?: string;
  name?: string;
  /** Preview a choice instead of the saved one (icon picker). */
  choice?: NetworkIconChoice | 'auto';
}

/**
 * Network logo. Without a saved choice: the recognized platform logo, else the
 * bridge's `m.bridge` avatar, else a colored letter. Round unless `className` says otherwise.
 */
export const NetworkIcon = memo(function NetworkIcon({
  networkId,
  avatarMxc,
  size,
  className,
  name,
  choice,
}: NetworkIconProps) {
  const saved = useSettings((s) => s.networkIcons[networkId]);
  const effective = choice === 'auto' ? undefined : (choice ?? saved);
  const platform =
    effective?.kind === 'platform'
      ? platformById(effective.id)
      : effective
        ? undefined
        : detectPlatform(networkId, name);
  const wantsBridgeAvatar = !platform && effective?.kind !== 'custom';
  const src = useThumbnail(wantsBridgeAvatar ? avatarMxc : undefined, size);
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size };

  if (effective?.kind === 'custom') {
    return (
      <img
        src={effective.dataUrl}
        alt={name ?? networkId}
        draggable={false}
        className={cn('shrink-0 rounded-full bg-background object-cover', className)}
        style={box}
      />
    );
  }
  if (platform) return <PlatformTile platform={platform} size={size} className={className} title={name} />;
  if (src && !failed) {
    return (
      <img
        src={src}
        alt={name ?? networkId}
        draggable={false}
        onError={() => setFailed(true)}
        className={cn('shrink-0 rounded-full bg-background object-cover', className)}
        style={box}
      />
    );
  }
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white', className)}
      style={{ ...box, background: networkColor(networkId), fontSize: size * 0.55 }}
      title={name}
    >
      {(name ?? networkId)[0]?.toUpperCase()}
    </span>
  );
});

/** Brand-colored tile with the platform's logo in white (or dark on light brand colors). */
export function PlatformTile({
  platform,
  size,
  className,
  title,
}: {
  platform: PlatformIcon;
  size: number;
  className?: string;
  title?: string;
}) {
  const fg = glyphColor(platform.color);
  return (
    <span
      title={title ?? platform.name}
      className={cn('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full', className)}
      style={{ width: size, height: size, background: platform.color, color: fg }}
    >
      {platform.path ? (
        <svg viewBox="0 0 24 24" aria-hidden width={size * 0.58} height={size * 0.58} fill="currentColor">
          <path d={platform.path} />
        </svg>
      ) : (
        <span className="leading-none font-bold" style={{ fontSize: size * (platform.glyph!.length > 1 ? 0.42 : 0.6) }}>
          {platform.glyph}
        </span>
      )}
    </span>
  );
}
