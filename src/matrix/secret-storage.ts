import type { SecretStorage } from 'matrix-js-sdk';

type KeyInfo = SecretStorage.SecretStorageKeyDescription;
export type SecretStorageKeyRequest = {
  keys: Record<string, KeyInfo>;
  resolve: (result: [string, Uint8Array<ArrayBuffer>] | null) => void;
};

/**
 * Bridge between the SDK's getSecretStorageKey callback and the UI.
 * The crypto UI registers a prompt; the SDK awaits whatever the user enters.
 * Keys are cached for the session so the user is asked once.
 */
const cache = new Map<string, Uint8Array<ArrayBuffer>>();
let prompt: ((req: SecretStorageKeyRequest) => void) | null = null;

export function setSecretStorageKeyPrompt(fn: typeof prompt): void {
  prompt = fn;
}

export function cacheSecretStorageKey(keyId: string, key: Uint8Array<ArrayBuffer>): void {
  cache.set(keyId, key);
}

export function clearSecretStorageKeyCache(): void {
  cache.clear();
}

export async function getSecretStorageKey({
  keys,
}: {
  keys: Record<string, KeyInfo>;
}): Promise<[string, Uint8Array<ArrayBuffer>] | null> {
  for (const keyId of Object.keys(keys)) {
    const cached = cache.get(keyId);
    if (cached) return [keyId, cached];
  }
  if (!prompt) return null;
  const result = await new Promise<[string, Uint8Array<ArrayBuffer>] | null>((resolve) =>
    prompt!({ keys, resolve }),
  );
  if (result) cache.set(result[0], result[1]);
  return result;
}
