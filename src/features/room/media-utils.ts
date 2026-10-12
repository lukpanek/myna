import { decode } from 'blurhash';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { type EncryptedFile, loadMediaBlobUrl } from '@/matrix/media';

export const MAX_MEDIA = 360;
export const BLURHASH_KEY = 'xyz.amorgan.blurhash';

/** Display box for media, scaled from `info.w/h` so the timeline does not jump when it loads. */
export function mediaBox(w: unknown, h: unknown, max = MAX_MEDIA): { width: number; height: number } {
  const width = typeof w === 'number' && w > 0 ? w : 0;
  const height = typeof h === 'number' && h > 0 ? h : 0;
  if (!width || !height) return { width: Math.min(240, max), height: Math.min(180, max) };
  const scale = Math.min(1, max / width, max / height);
  return { width: Math.max(48, Math.round(width * scale)), height: Math.max(32, Math.round(height * scale)) };
}

const blurhashCache = new Map<string, string | null>();

/** Small data URL rendered from a blurhash, cached per hash. */
export function blurhashUrl(hash: unknown): string | null {
  if (typeof hash !== 'string' || hash.length < 6) return null;
  const cached = blurhashCache.get(hash);
  if (cached !== undefined) return cached;
  let url: string | null = null;
  try {
    const size = 32;
    const pixels = decode(hash, size, size);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const data = ctx.createImageData(size, size);
      data.data.set(pixels);
      ctx.putImageData(data, 0, 0);
      url = canvas.toDataURL();
    }
  } catch {
    url = null;
  }
  blurhashCache.set(hash, url);
  return url;
}

/** Downloads (and decrypts if needed) a media message and saves it via a temporary link. */
export async function downloadMedia(content: Record<string, unknown>): Promise<void> {
  const file = content.file as EncryptedFile | undefined;
  const url = (content.url as string | undefined) ?? file?.url;
  if (!url) return;
  const info = (content.info ?? {}) as { mimetype?: string };
  const name = (content.filename as string | undefined) || (content.body as string | undefined) || t('room.defaultFileName');
  try {
    const blobUrl = await loadMediaBlobUrl(url, file, info.mimetype);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    toast.error(t('room.downloadFailed'));
  }
}
