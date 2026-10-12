import { encode as encodeBlurhash } from 'blurhash';
import { encryptAttachment } from 'browser-encrypt-attachment';
import type { MatrixClient } from 'matrix-js-sdk';
import { t } from '@/i18n';
import { formatBytes } from '@/lib/time';
import type { EncryptedFile } from '@/matrix/media';

const THUMB_MAX = 800;
const BLURHASH_KEY = 'xyz.amorgan.blurhash';

export interface UploadedMedia {
  url?: string;
  file?: EncryptedFile;
}

let uploadLimit: Promise<number | null> | null = null;

function getUploadLimit(client: MatrixClient): Promise<number | null> {
  if (!uploadLimit) {
    uploadLimit = client
      .getMediaConfig()
      .then((c) => c['m.upload.size'] ?? null)
      .catch(() => {
        uploadLimit = null;
        return null;
      });
  }
  return uploadLimit;
}

/** Uploads a blob, encrypting it first in encrypted rooms. */
export async function uploadBlob(
  client: MatrixClient,
  blob: Blob,
  opts: { name: string; mimetype: string; encrypt: boolean; onProgress?: (fraction: number) => void },
): Promise<UploadedMedia> {
  const limit = await getUploadLimit(client);
  if (limit && blob.size > limit) {
    throw new Error(t('composer.fileTooLarge', { name: opts.name, limit: formatBytes(limit) }));
  }
  const progressHandler = opts.onProgress
    ? ({ loaded, total }: { loaded: number; total: number }) => opts.onProgress!(total ? loaded / total : 0)
    : undefined;
  if (!opts.encrypt) {
    const res = await client.uploadContent(blob, { name: opts.name, type: opts.mimetype, progressHandler });
    return { url: res.content_uri };
  }
  const { data, info } = await encryptAttachment(await blob.arrayBuffer());
  const res = await client.uploadContent(new Blob([data]), {
    type: 'application/octet-stream',
    includeFilename: false,
    progressHandler,
  });
  return { file: { ...info, url: res.content_uri } };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function blurhashFrom(source: CanvasImageSource, w: number, h: number): string | undefined {
  const scale = 32 / Math.max(w, h);
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  ctx.drawImage(source, 0, 0, cw, ch);
  try {
    return encodeBlurhash(ctx.getImageData(0, 0, cw, ch).data, cw, ch, 4, 3);
  } catch {
    return undefined;
  }
}

interface Thumbnail {
  blob: Blob;
  w: number;
  h: number;
  mimetype: string;
}

async function thumbnailFrom(source: CanvasImageSource, w: number, h: number, mimetype: string) {
  const scale = Math.min(1, THUMB_MAX / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, tw, th);
  const blob = await canvasToBlob(canvas, mimetype, 0.82);
  return blob ? { blob, w: tw, h: th, mimetype: blob.type || mimetype } : null;
}

interface VisualMeta {
  w: number;
  h: number;
  blurhash?: string;
  thumb?: Thumbnail | null;
  duration?: number;
}

async function readImage(file: File): Promise<VisualMeta | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return null;
    // Small images and GIFs (which would lose animation) go without a thumbnail.
    const wantsThumb = Math.max(w, h) > THUMB_MAX && file.size > 200_000 && file.type !== 'image/gif';
    // PNG sources keep transparency; photos get JPEG.
    const thumbType = file.type === 'image/png' || file.type === 'image/webp' ? 'image/png' : 'image/jpeg';
    return {
      w,
      h,
      blurhash: blurhashFrom(img, w, h),
      thumb: wantsThumb ? await thumbnailFrom(img, w, h, thumbType) : null,
    };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function waitFor(el: HTMLMediaElement, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('timeout'));
    }, timeoutMs);
    const ok = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error('media error'));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      el.removeEventListener(event, ok);
      el.removeEventListener('error', fail);
    };
    el.addEventListener(event, ok);
    el.addEventListener('error', fail);
  });
}

async function readVideo(file: File): Promise<VisualMeta | null> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  try {
    video.src = url;
    await waitFor(video, 'loadeddata', 8000);
    const w = video.videoWidth;
    const h = video.videoHeight;
    const duration = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined;
    if (!w || !h) return { w: 0, h: 0, duration };
    // Grab a frame slightly in, the very first one is often black.
    const t = Math.min(1, (video.duration || 0) / 4);
    if (t > 0) {
      video.currentTime = t;
      await waitFor(video, 'seeked', 5000).catch(() => {});
    }
    return { w, h, duration, blurhash: blurhashFrom(video, w, h), thumb: await thumbnailFrom(video, w, h, 'image/jpeg') };
  } catch {
    return null;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function readAudioDuration(file: Blob): Promise<number | undefined> {
  const url = URL.createObjectURL(file);
  const audio = document.createElement('audio');
  audio.preload = 'metadata';
  try {
    audio.src = url;
    await waitFor(audio, 'loadedmetadata', 5000);
    return Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined;
  } catch {
    return undefined;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface Caption {
  body: string;
  html: string | null;
}

/** Uploads one file (plus thumbnail) and returns `m.room.message` content for it. */
export async function buildFileContent(
  client: MatrixClient,
  file: File,
  opts: { encrypt: boolean; caption?: Caption | null; onProgress?: (fraction: number) => void },
): Promise<Record<string, unknown>> {
  const mimetype = file.type || 'application/octet-stream';
  const info: Record<string, unknown> = { mimetype, size: file.size };
  let msgtype = 'm.file';

  let visual: VisualMeta | null = null;
  if (mimetype.startsWith('image/')) {
    visual = await readImage(file);
    if (visual) msgtype = 'm.image';
  } else if (mimetype.startsWith('video/')) {
    visual = await readVideo(file);
    msgtype = 'm.video';
  } else if (mimetype.startsWith('audio/')) {
    msgtype = 'm.audio';
    const duration = await readAudioDuration(file);
    if (duration) info.duration = duration;
  }

  if (visual) {
    if (visual.w && visual.h) {
      info.w = visual.w;
      info.h = visual.h;
    }
    if (visual.duration) info.duration = visual.duration;
    if (visual.blurhash) info[BLURHASH_KEY] = visual.blurhash;
    if (visual.thumb) {
      try {
        const up = await uploadBlob(client, visual.thumb.blob, {
          name: 'thumbnail',
          mimetype: visual.thumb.mimetype,
          encrypt: opts.encrypt,
        });
        if (up.file) info.thumbnail_file = up.file;
        else info.thumbnail_url = up.url;
        info.thumbnail_info = {
          w: visual.thumb.w,
          h: visual.thumb.h,
          mimetype: visual.thumb.mimetype,
          size: visual.thumb.blob.size,
        };
      } catch {
        // A missing thumbnail only costs bandwidth for other clients; keep sending.
      }
    }
  }

  const media = await uploadBlob(client, file, { name: file.name, mimetype, encrypt: opts.encrypt, onProgress: opts.onProgress });
  const content: Record<string, unknown> = {
    msgtype,
    body: opts.caption?.body || file.name,
    filename: file.name,
    info,
  };
  if (opts.caption?.html) {
    content.format = 'org.matrix.custom.html';
    content.formatted_body = opts.caption.html;
  }
  if (media.file) content.file = media.file;
  else content.url = media.url;
  return content;
}
