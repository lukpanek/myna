import { LoaderCircle, Pause, Play, SendHorizontal, Square, Trash } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import { formatDuration } from '@/lib/time';
import { cn } from '@/lib/utils';

const MAX_MS = 15 * 60 * 1000;
const SAMPLE_MS = 100;
const LIVE_BARS = 48;
const MIME_CANDIDATES = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4'];

export interface VoiceClip {
  blob: Blob;
  mimetype: string;
  extension: string;
  durationMs: number;
  /** MSC1767 waveform: integers 0–1024, at most 100 points. */
  waveform: number[];
}

function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
}

function extensionFor(mime: string): string {
  if (mime.startsWith('audio/ogg')) return 'ogg';
  if (mime.startsWith('audio/webm')) return 'webm';
  if (mime.startsWith('audio/mp4') || mime.startsWith('audio/aac')) return 'm4a';
  return 'audio';
}

function finalizeWaveform(samples: number[]): number[] {
  if (samples.length === 0) return [];
  const target = Math.min(100, samples.length);
  const step = samples.length / target;
  const points: number[] = [];
  for (let i = 0; i < target; i++) {
    const slice = samples.slice(Math.floor(i * step), Math.max(Math.floor((i + 1) * step), Math.floor(i * step) + 1));
    points.push(slice.reduce((a, b) => a + b, 0) / slice.length);
  }
  // Normalize to the loudest point so quiet recordings still show a readable shape.
  const max = Math.max(...points, 1e-4);
  return points.map((v) => Math.round(Math.min(1, v / max) * 1024));
}

/** Visual level for a raw RMS value; sqrt lifts quiet speech into view. */
function level(rms: number): number {
  return Math.min(1, Math.sqrt(rms) * 1.8);
}

type Phase = 'starting' | 'recording' | 'stopping' | 'preview';

/**
 * Recording UI that replaces the editor row. Starts recording on mount.
 * Stop → preview playback; Send works from both recording and preview.
 */
export function VoiceRecorder({
  onCancel,
  onSend,
}: {
  onCancel: () => void;
  onSend: (clip: VoiceClip) => void;
}) {
  const [phase, setPhase] = useState<Phase>('starting');
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [clip, setClip] = useState<VoiceClip | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playPos, setPlayPos] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const samplesRef = useRef<number[]>([]);
  const startRef = useRef(0);
  const tickRef = useRef<number | null>(null);
  const stopPromiseRef = useRef<Promise<VoiceClip | null> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  const releaseInputs = () => {
    if (tickRef.current !== null) window.clearInterval(tickRef.current);
    tickRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
  };

  const stop = (): Promise<VoiceClip | null> => {
    if (stopPromiseRef.current) return stopPromiseRef.current;
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return Promise.resolve(clip);
    setPhase('stopping');
    const durationMs = Math.min(MAX_MS, Math.round(performance.now() - startRef.current));
    stopPromiseRef.current = new Promise<VoiceClip | null>((resolve) => {
      recorder.onstop = () => {
        releaseInputs();
        const mimetype = (recorder.mimeType || chunksRef.current[0]?.type || 'audio/webm').split(';')[0].trim();
        const blob = new Blob(chunksRef.current, { type: mimetype });
        const result: VoiceClip = {
          blob,
          mimetype,
          extension: extensionFor(mimetype),
          durationMs,
          waveform: finalizeWaveform(samplesRef.current),
        };
        setClip(result);
        setPreviewUrl(URL.createObjectURL(blob));
        setPhase('preview');
        resolve(result);
      };
      recorder.stop();
    });
    return stopPromiseRef.current;
  };
  const stopRef = useRef(stop);
  stopRef.current = stop;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        toast.error(t('composer.recordingUnsupported'));
        onCancelRef.current();
        return;
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        const name = err instanceof DOMException ? err.name : '';
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          toast.error(t('composer.micDenied'), {
            description: t('composer.micDeniedHint'),
          });
        } else if (name === 'NotFoundError') {
          toast.error(t('composer.micNotFound'));
        } else {
          toast.error(t('composer.micFailed'));
        }
        onCancelRef.current();
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;

      const mime = pickMime();
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      } catch {
        releaseInputs();
        toast.error(t('composer.recordingUnsupported'));
        onCancelRef.current();
        return;
      }
      recorderRef.current = recorder;
      chunksRef.current = [];
      samplesRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);

      recorder.start(1000);
      startRef.current = performance.now();
      setPhase('recording');

      tickRef.current = window.setInterval(() => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        samplesRef.current.push(rms);
        setLevels((prev) => [...prev.slice(-(LIVE_BARS - 1)), level(rms)]);
        const ms = performance.now() - startRef.current;
        setElapsed(ms);
        if (ms >= MAX_MS) {
          toast(t('composer.voiceMaxLength'));
          void stopRef.current();
        }
      }, SAMPLE_MS);
    })();

    return () => {
      cancelled = true;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = null;
        recorder.stop();
      }
      releaseInputs();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const send = async () => {
    const result = phase === 'preview' ? clip : await stop();
    audioRef.current?.pause();
    if (result && result.blob.size > 0) onSend(result);
    else onCancel();
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  };

  const duration = clip?.durationMs ?? elapsed;
  const previewBars = clip ? clip.waveform.map((v) => Math.max(0.08, v / 1024)) : [];
  const playedFraction = clip && clip.durationMs ? Math.min(1, (playPos * 1000) / clip.durationMs) : 0;

  return (
    <div className="flex h-12 items-center gap-3 px-3">
      {phase === 'preview' ? (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="size-8 rounded-full"
          onClick={togglePlay}
          aria-label={playing ? t('room.pause') : t('room.play')}
        >
          {playing ? <Pause /> : <Play />}
        </Button>
      ) : (
        <span className="relative flex size-3 shrink-0" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-60" />
          <span className="relative inline-flex size-3 rounded-full bg-red-500" />
        </span>
      )}

      <span className="w-12 shrink-0 font-mono text-sm tabular-nums text-muted-foreground">
        {formatDuration(phase === 'preview' && playing ? playPos * 1000 : duration)}
      </span>

      <div className="flex h-8 min-w-0 flex-1 items-center gap-[2px] overflow-hidden" aria-hidden>
        {(phase === 'preview' ? previewBars : levels).map((v, i, arr) => (
          <span
            key={i}
            className={cn(
              'w-[3px] shrink-0 rounded-full',
              phase === 'preview' && i / arr.length < playedFraction ? 'bg-primary' : 'bg-muted-foreground/60',
            )}
            style={{ height: `${Math.max(8, v * 100)}%` }}
          />
        ))}
      </div>

      {(phase === 'recording' || phase === 'starting') && (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={() => void stop()}
          disabled={phase !== 'recording'}
          aria-label={t('composer.stopAndListen')}
          title={t('composer.stopAndListen')}
        >
          <Square className="fill-current" />
        </Button>
      )}
      <Button type="button" size="sm" variant="ghost" onClick={onCancel} className="text-muted-foreground">
        <Trash />
        {t('common.cancel')}
      </Button>
      <Button type="button" size="sm" onClick={() => void send()} disabled={phase === 'starting' || phase === 'stopping'}>
        {phase === 'stopping' ? <LoaderCircle className="animate-spin" /> : <SendHorizontal />}
        {t('composer.send')}
      </Button>

      {previewUrl && (
        <audio
          ref={audioRef}
          src={previewUrl}
          preload="auto"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setPlayPos(0);
          }}
          onTimeUpdate={(e) => setPlayPos(e.currentTarget.currentTime)}
          className="hidden"
        />
      )}
    </div>
  );
}
