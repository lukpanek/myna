import {
  AutoDiscovery,
  createClient,
  IndexedDBStore,
  type MatrixClient,
  PendingEventOrdering,
} from 'matrix-js-sdk';
import { isMac } from '@/lib/platform';
import { clearSecretStorageKeyCache, getSecretStorageKey } from './secret-storage';
import { clearSession, saveSession, type Session } from './session';

const SYNC_DB = 'myna-sync';
const CRYPTO_PREFIX = 'myna-crypto';

let current: MatrixClient | null = null;

export function getClient(): MatrixClient | null {
  return current;
}

/** Accepts `example.org`, `@me:example.org` or a full URL and returns the homeserver base URL. */
export async function resolveHomeserver(input: string): Promise<string> {
  const value = input.trim();
  if (/^https?:\/\//i.test(value)) return value.replace(/\/+$/, '');
  const serverName = value.includes(':') && value.startsWith('@') ? value.split(':').slice(1).join(':') : value;
  const config = await AutoDiscovery.findClientConfig(serverName);
  const hs = config['m.homeserver'];
  if (hs?.base_url && hs.state === AutoDiscovery.SUCCESS) return hs.base_url.replace(/\/+$/, '');
  // No .well-known: assume the server name is the homeserver host.
  return `https://${serverName}`;
}

export function deviceDisplayName(): string {
  return `Myna (${isMac ? 'macOS' : 'desktop'})`;
}

export async function loginWithPassword(
  homeserver: string,
  username: string,
  password: string,
): Promise<Session> {
  const baseUrl = await resolveHomeserver(homeserver || username);
  const temp = createClient({ baseUrl });
  const user = username.trim();
  const res = await temp.loginRequest({
    type: 'm.login.password',
    identifier: { type: 'm.id.user', user },
    password,
    initial_device_display_name: deviceDisplayName(),
  });
  const session: Session = {
    baseUrl: res.well_known?.['m.homeserver']?.base_url?.replace(/\/+$/, '') ?? baseUrl,
    userId: res.user_id,
    deviceId: res.device_id,
    accessToken: res.access_token,
  };
  saveSession(session);
  return session;
}

/** Completes an SSO login after the homeserver redirected back with `loginToken`. */
export async function loginWithToken(baseUrl: string, token: string): Promise<Session> {
  const temp = createClient({ baseUrl });
  const res = await temp.loginRequest({
    type: 'm.login.token',
    token,
    initial_device_display_name: deviceDisplayName(),
  });
  const session: Session = {
    baseUrl,
    userId: res.user_id,
    deviceId: res.device_id,
    accessToken: res.access_token,
  };
  saveSession(session);
  return session;
}

let starting: Promise<MatrixClient> | null = null;

/** Starts (or returns the already starting) client. Safe to call twice, e.g. under StrictMode. */
export function startClient(session: Session): Promise<MatrixClient> {
  if (current) return Promise.resolve(current);
  starting ??= doStart(session).finally(() => {
    starting = null;
  });
  return starting;
}

async function doStart(session: Session): Promise<MatrixClient> {
  const store = new IndexedDBStore({
    indexedDB: window.indexedDB,
    localStorage: window.localStorage,
    dbName: SYNC_DB,
  });
  const options = {
    baseUrl: session.baseUrl,
    accessToken: session.accessToken,
    userId: session.userId,
    deviceId: session.deviceId,
    timelineSupport: true,
    useAuthorizationHeader: true,
    cryptoCallbacks: { getSecretStorageKey },
  };

  // The SDK requires the store to be attached to a client before `startup()`.
  let client = createClient({ ...options, store });
  try {
    await store.startup();
  } catch (err) {
    // Broken or blocked IndexedDB: run with the in-memory store (full sync on every start).
    console.error('IndexedDB store failed to start', err);
    client = createClient(options);
  }

  try {
    await client.initRustCrypto({ cryptoDatabasePrefix: CRYPTO_PREFIX });
  } catch (err) {
    // The app stays usable for unencrypted (most bridged) rooms if crypto fails to start.
    console.error('Šifrování se nepodařilo spustit', err);
  }

  await client.startClient({
    lazyLoadMembers: true,
    initialSyncLimit: 20,
    threadSupport: true,
    pendingEventOrdering: PendingEventOrdering.Detached,
  });

  current = client;
  addEventListener('online', retrySync);
  addEventListener('focus', retrySync);
  document.addEventListener('visibilitychange', retrySync);
  return client;
}

/**
 * After sleep or a network change the SDK waits out its backoff before the next
 * sync; returning to the window or regaining the network retries immediately.
 */
function retrySync(): void {
  current?.retryImmediately();
}

function removeRetryListeners(): void {
  removeEventListener('online', retrySync);
  removeEventListener('focus', retrySync);
  document.removeEventListener('visibilitychange', retrySync);
}

export async function stopClient(): Promise<void> {
  if (!current) return;
  removeRetryListeners();
  current.stopClient();
  current = null;
}

/** Logs out on the server and wipes every local store for this account. */
export async function logout(): Promise<void> {
  const client = current;
  try {
    await client?.logout(true);
  } catch {
    // Token may already be invalid; local cleanup still has to happen.
  }
  removeRetryListeners();
  client?.stopClient();
  await client?.clearStores().catch(() => undefined);
  current = null;
  clearSecretStorageKeyCache();
  clearSession();
}
