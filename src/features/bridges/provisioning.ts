import { type MessageKey, t } from '@/i18n';
import { getClient } from '@/matrix/client';
import type {
  LoginFlow,
  LoginStep,
  LoginStepResponse,
  MautrixWellKnown,
  ProvisioningCapabilities,
  ResolvedIdentifier,
  SubmittableStepType,
  Whoami,
} from './types';

/**
 * Client for the mautrix bridgev2 provisioning API (ported from mautrix-manager).
 *
 * Auth: bridges on the user's own server get the Matrix access token
 * (`provisioning.allow_matrix_auth`), bridges anywhere else get a short-lived
 * OpenID token (`openid:<token>`) so the real access token never leaves the homeserver.
 */

export class ProvisioningError extends Error {
  readonly errcode?: string;
  readonly status?: number;
  /** Raw `error` text from the bridge (English). */
  readonly bridgeMessage?: string;

  constructor(message: string, opts: { errcode?: string; status?: number; bridgeMessage?: string } = {}) {
    super(message);
    this.name = 'ProvisioningError';
    this.errcode = opts.errcode;
    this.status = opts.status;
    this.bridgeMessage = opts.bridgeMessage;
  }

  /** Endpoint missing on this bridge version or not implemented by the connector. */
  get unsupported(): boolean {
    return this.errcode === 'M_UNRECOGNIZED' || this.status === 404 || this.status === 501;
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

const KNOWN_ERRORS: Record<string, MessageKey> = {
  M_UNKNOWN_TOKEN: 'bridges.errUnknownToken',
  M_MISSING_TOKEN: 'bridges.errMissingToken',
  'FI.MAU.BRIDGE.TOO_MANY_LOGINS': 'bridges.errTooManyLogins',
  'FI.MAU.BRIDGE.LOGIN_TIMED_OUT': 'bridges.errLoginTimedOut',
  'FI.MAU.BRIDGE.LOGIN_CANCELLED': 'bridges.errLoginCancelled',
  'FI.MAU.BRIDGE.LOGIN_ALREADY_FINISHED': 'bridges.errLoginAlreadyFinished',
  'FI.MAU.NOT_LOGGED_IN': 'bridges.errNotLoggedIn',
};

/** Translated, user-facing description of any error thrown by the provisioning client. */
export function describeError(err: unknown): string {
  if (err instanceof ProvisioningError) {
    if (err.errcode && KNOWN_ERRORS[err.errcode]) return t(KNOWN_ERRORS[err.errcode]);
    if (err.errcode === 'M_FORBIDDEN' && err.bridgeMessage === 'Provisioning API is disabled') {
      return t('bridges.errProvisioningDisabled');
    }
    return err.message;
  }
  if (err instanceof TypeError) {
    // fetch() rejects with TypeError for DNS/TLS/CORS failures; the browser hides which one.
    return t('bridges.errUnreachable');
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

// ── Auth ────────────────────────────────────────────────────────────────────

let openIdCache: { userId: string; promise: Promise<{ token: string; expiresAt: number }> } | null = null;

async function openIdBearer(forceNew = false): Promise<string> {
  const client = getClient();
  if (!client) throw new ProvisioningError(t('bridges.errClientNotConnected'));
  const userId = client.getSafeUserId();
  if (forceNew || !openIdCache || openIdCache.userId !== userId) {
    const promise = client.getOpenIdToken().then((resp) => ({
      token: `openid:${resp.access_token}`,
      // Renew a bit before the server-side expiry.
      expiresAt: Date.now() + resp.expires_in * 1000 * 0.9,
    }));
    openIdCache = { userId, promise };
    promise.catch(() => {
      if (openIdCache?.promise === promise) openIdCache = null;
    });
  }
  const cached = await openIdCache.promise;
  if (cached.expiresAt < Date.now()) return openIdBearer(true);
  return cached.token;
}

// ── URLs ────────────────────────────────────────────────────────────────────

/** Accepts `bridge.example.org/whatsapp`, full URLs or URLs ending in `/_matrix/provision…`. */
export function normalizeBridgeUrl(input: string): string {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  url = url.replace(/\/+$/, '');
  url = url.replace(/\/_matrix\/provision(\/v\d+)?(\/.*)?$/, '');
  return url.replace(/\/+$/, '');
}

export function userServerName(userId: string): string {
  return userId.split(':').slice(1).join(':');
}

/**
 * Whether a manually added bridge lives on the user's own server, so it may receive the
 * real access token. Anything we cannot prove is local gets OpenID auth.
 */
export function isLocalBridgeUrl(url: string): boolean {
  const client = getClient();
  if (!client) return false;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  const serverHost = userServerName(client.getSafeUserId()).replace(/:\d+$/, '').toLowerCase();
  let homeserverHost = '';
  try {
    homeserverHost = new URL(client.baseUrl).hostname.toLowerCase();
  } catch {
    // ignore
  }
  return host === serverHost || host.endsWith(`.${serverHost}`) || (!!homeserverHost && host === homeserverHost);
}

// ── Client ──────────────────────────────────────────────────────────────────

interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | undefined>;
  signal?: AbortSignal;
}

export class ProvisioningClient {
  constructor(
    readonly url: string,
    readonly external: boolean,
  ) {}

  private async bearer(forceNew = false): Promise<string> {
    if (this.external) return openIdBearer(forceNew);
    const token = getClient()?.getAccessToken();
    if (!token) throw new ProvisioningError(t('bridges.errClientNotConnected'));
    return token;
  }

  async request<T>(method: 'GET' | 'POST', path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
    const client = getClient();
    if (!client) throw new ProvisioningError(t('bridges.errClientNotConnected'));
    const target = new URL(`${this.url}/_matrix/provision${path}`);
    target.searchParams.set('user_id', client.getSafeUserId());
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value) target.searchParams.set(key, value);
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${await this.bearer(retried)}` };
    let body: string | undefined;
    if (method === 'POST') {
      body = JSON.stringify(opts.body ?? {});
      headers['Content-Type'] = 'application/json';
    }
    const resp = await fetch(target, { method, headers, body, signal: opts.signal });
    let data: unknown = null;
    const text = await resp.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    const err = data && typeof data === 'object' ? (data as { errcode?: string; error?: string }) : null;
    if (err?.errcode || !resp.ok) {
      // A cached OpenID token may have been revoked or expired early; renew once.
      if (this.external && !retried && err?.errcode === 'M_UNKNOWN_TOKEN') {
        return this.request<T>(method, path, opts, true);
      }
      const bridgeMessage = err?.error;
      throw new ProvisioningError(
        bridgeMessage
          ? t('bridges.errBridgeSaid', { message: bridgeMessage })
          : t('bridges.errHttp', { status: resp.status }),
        { errcode: err?.errcode, status: resp.status, bridgeMessage },
      );
    }
    if (data === null && text) throw new ProvisioningError(t('bridges.errInvalidResponse'));
    return data as T;
  }

  whoami(signal?: AbortSignal): Promise<Whoami> {
    return this.request('GET', '/v3/whoami', { signal });
  }

  /** Capabilities endpoint is newer than whoami; null when the bridge does not have it. */
  async capabilities(signal?: AbortSignal): Promise<ProvisioningCapabilities | null> {
    try {
      return await this.request<ProvisioningCapabilities>('GET', '/v3/capabilities', { signal });
    } catch (err) {
      if (err instanceof ProvisioningError && err.unsupported) return null;
      throw err;
    }
  }

  async loginFlows(): Promise<LoginFlow[]> {
    const resp = await this.request<{ flows: LoginFlow[] }>('GET', '/v3/login/flows');
    return resp.flows ?? [];
  }

  /** `reloginId` re-authenticates an existing login instead of adding a new one. */
  startLogin(flowId: string, reloginId?: string, signal?: AbortSignal): Promise<LoginStepResponse> {
    return this.request('POST', `/v3/login/start/${encodeURIComponent(flowId)}`, {
      query: { login_id: reloginId },
      signal,
    });
  }

  submitStep(
    processId: string,
    step: LoginStep,
    type: SubmittableStepType,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<LoginStepResponse> {
    return this.request(
      'POST',
      `/v3/login/step/${encodeURIComponent(processId)}/${encodeURIComponent(step.step_id)}/${type}`,
      { body: params, query: { txn_id: step.txn_id }, signal },
    );
  }

  /** "Back" from a step that has `can_cancel`. */
  cancelStep(processId: string, step: LoginStep, signal?: AbortSignal): Promise<LoginStepResponse> {
    return this.request(
      'POST',
      `/v3/login/step/${encodeURIComponent(processId)}/${encodeURIComponent(step.step_id)}/cancel`,
      { query: { txn_id: step.txn_id }, signal },
    );
  }

  cancelLogin(processId: string): Promise<unknown> {
    return this.request('POST', `/v3/login/cancel/${encodeURIComponent(processId)}`);
  }

  logout(loginId: string): Promise<unknown> {
    return this.request('POST', `/v3/logout/${encodeURIComponent(loginId)}`);
  }

  async contacts(loginId?: string, signal?: AbortSignal): Promise<ResolvedIdentifier[]> {
    const resp = await this.request<{ contacts?: ResolvedIdentifier[] | null }>('GET', '/v3/contacts', {
      query: { login_id: loginId },
      signal,
    });
    return (resp.contacts ?? []).filter(Boolean);
  }

  async searchUsers(query: string, loginId?: string, signal?: AbortSignal): Promise<ResolvedIdentifier[]> {
    const resp = await this.request<{ results?: ResolvedIdentifier[] | null }>('POST', '/v3/search_users', {
      body: { query },
      query: { login_id: loginId },
      signal,
    });
    return (resp.results ?? []).filter(Boolean);
  }

  resolveIdentifier(identifier: string, loginId?: string, signal?: AbortSignal): Promise<ResolvedIdentifier> {
    return this.request('GET', `/v3/resolve_identifier/${encodeURIComponent(identifier)}`, {
      query: { login_id: loginId },
      signal,
    });
  }

  /** Accepts a phone number/username or a ghost MXID (`@whatsapp_…:server`). */
  createDm(identifier: string, loginId?: string): Promise<ResolvedIdentifier> {
    return this.request('POST', `/v3/create_dm/${encodeURIComponent(identifier)}`, {
      query: { login_id: loginId },
    });
  }
}

// ── Discovery ───────────────────────────────────────────────────────────────

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];
}

/** `https://<server>/.well-known/matrix/mautrix` → bridge URLs and external bridge servers. */
export async function fetchMautrixWellKnown(
  server: string,
  signal?: AbortSignal,
): Promise<{ bridges: string[]; externalServers: string[] }> {
  const resp = await fetch(`https://${server}/.well-known/matrix/mautrix`, { signal });
  if (resp.status === 404) return { bridges: [], externalServers: [] };
  if (!resp.ok) throw new Error(t('bridges.errWellKnownHttp', { server, status: resp.status }));
  const data = (await resp.json()) as MautrixWellKnown;
  return {
    bridges: stringList(data?.['fi.mau.bridges']).map(normalizeBridgeUrl),
    externalServers: stringList(data?.['fi.mau.external_bridge_servers']),
  };
}
