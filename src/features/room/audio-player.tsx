import { Loader2, Pause, Play } from 'lucide-react';
import { type PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { getLocale, t } from '@/i18n';
import { formatDuration } from '@/lib/time';
import { cn } from '@/lib/utils';
import { type EncryptedFile, useMediaSrc } from '@/matrix/media';

const BAR_COUNT = 40;
const SPEEDS = [1, 1.5, 2];

// Only one audio element plays at a time across the whole app.
let activeAudio: HTMLAudioElement | null = null;

function claimPlayback(audio: HTMLAudioElement) {
  if (activeAudio && activeAudio !== audio) activeAudio.pause();
  activeAudio = audio;
}

/** Downsamples an MSC1767 waveform (0–1024 values) to a fixed number of bars in 0..1. */
function toBars(waveform: unknown): number[] {
  const values = Array.isArray(waveform) ? waveform.filter((v): v is number => typeof v === 'number') : [];
  if (values.length === 0) return Array.from({ length: BAR_COUNT }, () => 0.3);
  const bars: number[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    const start = Math.floor((i * values.length) / BAR_COUNT);
    const end = Math.max(start + 1, Math.floor(((i + 1) * values.length) / BAR_COUNT));
    let sum = 0;
    for (let j = start; j < end && j < values.length; j++) sum += values[j];
    bars.push(sum / (end - start));
  }
  const max = Math.max(...bars, 1);
  return bars.map((v) => Math.max(0.08, v / max));
}

interface AudioPlayerProps {
  url?: string;
  file?: EncryptedFile;
  mimetype?: string;
  /** Duration in ms from the event, used before the media loads. */
  durationMs?: number;
  waveform?: unknown;
  /** Shown above the waveform for regular audio files. */
  name?: string;
}

export function AudioPlayer({ url, file, mimetype, durationMs, waveform, name }: AudioPlayerProps) {
  // Media is only fetched once the user presses play.
  const [activated, setActivated] = useState(false);
  const src = useMediaSrc(activated && !file ? url : undefined, activated ? file : undefined, mimetype);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(durationMs ? durationMs / 1000 : 0);
  const [speed, setSpeed] = useState(1);
  const pendingSeek = useRef<number | null>(null);
  const wantPlay = useRef(false);
  const bars = useMemo(() => toBars(waveform), [waveform]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !src || !wantPlay.current) return;
    wantPlay.current = false;
    void audio.play().catch(() => setPlaying(false));
  }, [src]);

  // Smooth progress while playing; timeupdate alone is too coarse for the waveform.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const audio = audioRef.current;
      if (audio) setCurrent(audio.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  useEffect(
    () => () => {
      if (activeAudio === audioRef.current) activeAudio = null;
    },
    [],
  );

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!src) {
      wantPlay.current = true;
      setActivated(true);
      return;
    }
    if (audio.paused) void audio.play().catch(() => setPlaying(false));
    else audio.pause();
  };

  const seekTo = (fraction: number) => {
    const total = duration || audioRef.current?.duration || 0;
    const time = Math.max(0, Math.min(1, fraction)) * total;
    setCurrent(time);
    const audio = audioRef.current;
    if (audio && src && Number.isFinite(audio.duration)) audio.currentTime = time;
    else pendingSeek.current = time;
  };

  const onPointer = (e: PointerEvent<HTMLDivElement>) => {
    if (e.type === 'pointermove' && !(e.buttons & 1)) return;
    if (e.type === 'pointerdown') e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    seekTo((e.clientX - rect.left) / rect.width);
  };

  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const progress = duration > 0 ? current / duration : 0;
  const loading = activated && !src;

  return (
    <div className="flex w-[320px] max-w-full items-center gap-2.5 rounded-lg border bg-background px-2.5 py-2">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={(e) => {
          claimPlayback(e.currentTarget);
          e.currentTarget.playbackRate = speed;
          setPlaying(true);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
          if (pendingSeek.current !== null) {
            e.currentTarget.currentTime = pendingSeek.current;
            pendingSeek.current = null;
          }
        }}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? t('room.pause') : t('room.play')}
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : playing ? (
          <Pause className="size-4 fill-current" />
        ) : (
          <Play className="ml-0.5 size-4 fill-current" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        {name && <div className="mb-0.5 truncate text-[13px] font-medium">{name}</div>}
        <div
          role="slider"
          aria-label={t('room.seek')}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(current)}
          tabIndex={0}
          className="flex h-7 cursor-pointer touch-none items-center gap-[2px]"
          onPointerDown={onPointer}
          onPointerMove={onPointer}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') seekTo(progress + 0.05);
            else if (e.key === 'ArrowLeft') seekTo(progress - 0.05);
          }}
        >
          {bars.map((h, i) => (
            <span
              key={i}
              className={cn(
                'flex-1 rounded-full',
                (i + 0.5) / bars.length <= progress ? 'bg-primary' : 'bg-muted-foreground/35',
              )}
              style={{ height: `${Math.round(h * 100)}%` }}
            />
          ))}
        </div>
      </div>
      <span className="w-[72px] shrink-0 text-right text-xs text-muted-foreground tabular-nums">
        {formatDuration(current * 1000)} / {formatDuration(duration * 1000)}
      </span>
      <button
        type="button"
        onClick={cycleSpeed}
        title={t('room.playbackSpeed')}
        className="h-6 w-9 shrink-0 rounded-md bg-muted text-xs font-semibold tabular-nums hover:bg-accent"
      >
        {speed.toLocaleString(getLocale())}×
      </button>
    </div>
  );
}
