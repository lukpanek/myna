import { decryptAttachment } from 'browser-encrypt-attachment';
import { useEffect, useState } from 'react';
import { t } from '@/i18n';
import { customProtocolBase, isTauri } from '@/lib/platform';
import { getClient } from './client';

/**
 * Media loading.
 *
 * Authenticated media (MSC3916) needs an Authorization header, which `<img src>`
 * cannot send. In the desktop app a Rust protocol handler (`media://`) adds the
 * token and keeps a disk cache, so URLs are synchronous and survive restarts.
 * In a plain browser (dev) we fall back to fetch + blob URLs with an in-memory cache.
 *
 * Protocol contract (src-tauri/src/media.rs):
 *   media://localhost/thumbnail/{server}/{mediaId}?width=W&height=H&method=crop|scale
 *   media://localhost/download/{server}/{mediaId}
 */

export interface EncryptedFile {
  url: string;
  key: { k: string; alg: string; ext: boolean; kty: string; key_ops: string[] };
  iv: string;
  hashes: Record<string, string>;
  v: string;
}

function parseMxc(mxc: string | undefined | null): { server: string; mediaId: string } | null {
  if (!mxc?.startsWith('mxc://')) return null;
  const [server, mediaId] = mxc.slice(6).split('/');
  if (!server || !mediaId) return null;
  return { server, mediaId };
}

function protocolUrl(path: string, query?: Record<string, string | number>): string {
  const qs = query ? `?${new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]))}` : '';
  return `${customProtocolBase('media')}/${path}${qs}`;
}

function httpUrl(path: string, query?: Record<string, string | number>): string | null {
  const client = getClient();
  if (!client) return null;
  const qs = query ? `?${new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]))}` : '';
  return `${client.baseUrl}/_matrix/client/v1/media/${path}${qs}`;
}

/** Thumbnail URL, sized in CSS pixels (doubled for retina). */
export function thumbnailPath(mxc: string, size: number, method: 'crop' | 'scale' = 'crop') {
  const parsed = parseMxc(mxc);
  if (!parsed) return null;
  const px = Math.min(800, Math.round(size * (window.devicePixelRatio || 2)));
  return {
    path: `thumbnail/${parsed.server}/${encodeURIComponent(parsed.mediaId)}`,
    query: { width: px, height: px, method },
  };
}

export function downloadPath(mxc: string) {
  const parsed = parseMxc(mxc);
  if (!parsed) return null;
  return { path: `download/${parsed.server}/${encodeURIComponent(parsed.mediaId)}` };
}

/** Synchronous URL usable directly in `src` (desktop app only). */
export function directMediaUrl(target: { path: string; query?: Record<string, string | number> } | null) {
  if (!target || !isTauri) return null;
  return protocolUrl(target.path, target.query);
}

const blobCache = new Map<string, Promise<string>>();

async function fetchBlob(url: string): Promise<Blob> {
  const client = getClient();
  const headers: Record<string, string> = {};
  if (!isTauri && client?.getAccessToken()) headers.Authorization = `Bearer ${client.getAccessToken()}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(t('matrix.mediaLoadFailed', { status: res.status }));
  return res.blob();
}

function urlFor(target: { path: string; query?: Record<string, string | number> }): string | null {
  return isTauri ? protocolUrl(target.path, target.query) : httpUrl(target.path, target.query);
}

/** Fetches a (possibly encrypted) media file into a blob URL. Cached for the session. */
export function loadMediaBlobUrl(mxc: string, file?: EncryptedFile, mimetype?: string): Promise<string> {
  const key = file ? `enc:${file.url}` : `dl:${mxc}`;
  let promise = blobCache.get(key);
  if (!promise) {
    const target = downloadPath(file?.url ?? mxc);
    const url = target && urlFor(target);
    if (!url) return Promise.reject(new Error(t('matrix.invalidMediaUrl')));
    promise = fetchBlob(url).then(async (blob) => {
      if (!file) return URL.createObjectURL(blob);
      const plain = await decryptAttachment(await blob.arrayBuffer(), file);
      return URL.createObjectURL(new Blob([plain], { type: mimetype || 'application/octet-stream' }));
    });
    promise.catch(() => blobCache.delete(key));
    blobCache.set(key, promise);
  }
  return promise;
}

function useAsyncUrl(key: string | null, load: () => Promise<string>): string | undefined {
  const [state, setState] = useState<{ key: string | null; url?: string }>({ key: null });
  useEffect(() => {
    if (!key) return;
    let alive = true;
    load()
      .then((url) => alive && setState({ key, url }))
      .catch(() => alive && setState({ key, url: undefined }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? state.url : undefined;
}

/** Avatar / thumbnail `src` for an unencrypted mxc URI. */
export function useThumbnail(mxc: string | undefined | null, size: number, method: 'crop' | 'scale' = 'crop') {
  const target = mxc ? thumbnailPath(mxc, size, method) : null;
  const direct = directMediaUrl(target);
  const fallbackKey = !direct && target ? `${target.path}?${JSON.stringify(target.query)}` : null;
  const blobUrl = useAsyncUrl(fallbackKey, () => {
    const url = target && httpUrl(target.path, target.query);
    if (!url) return Promise.reject(new Error(t('matrix.invalidMediaUrl')));
    let p = blobCache.get(fallbackKey!);
    if (!p) {
      p = fetchBlob(url).then((b) => URL.createObjectURL(b));
      p.catch(() => blobCache.delete(fallbackKey!));
      blobCache.set(fallbackKey!, p);
    }
    return p;
  });
  return direct ?? blobUrl;
}

/**
 * Full-size media `src`. Unencrypted media in the desktop app streams straight from
 * the protocol handler (supports Range, so video seeks work); encrypted media is
 * downloaded and decrypted into a blob URL.
 */
export function useMediaSrc(mxc: string | undefined, file?: EncryptedFile, mimetype?: string) {
  const direct = !file && mxc ? directMediaUrl(downloadPath(mxc)) : null;
  const key = direct ? null : (file?.url ?? mxc ?? null);
  const blobUrl = useAsyncUrl(key, () => loadMediaBlobUrl(mxc ?? file!.url, file, mimetype));
  return direct ?? blobUrl;
}
