import { useEffect } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getLocale, t } from '@/i18n';
import { getClient } from '@/matrix/client';
import { useSettings } from '@/store/settings';
import {
  describeError,
  fetchMautrixWellKnown,
  isLocalBridgeUrl,
  normalizeBridgeUrl,
  ProvisioningClient,
  userServerName,
} from './provisioning';
import type { ProvisioningCapabilities, Whoami } from './types';

export type BridgeSource = 'well-known' | 'external' | 'manual';

export interface BridgeEntry {
  url: string;
  /** Lives on another server: authenticated with OpenID instead of the access token. */
  external: boolean;
  source: BridgeSource;
  whoami?: Whoami;
  /** undefined = not loaded yet, null = bridge does not expose capabilities. */
  capabilities?: ProvisioningCapabilities | null;
  error?: string;
  loading: boolean;
  checkedAt?: number;
}

interface BridgesState {
  userId: string | null;
  bridges: Record<string, BridgeEntry>;
  discovering: boolean;
  /** Problems with well-known discovery itself (not with individual bridges). */
  discoveryErrors: string[];
  lastDiscovery: number;

  discover: (opts?: { force?: boolean }) => Promise<void>;
  refreshBridge: (url: string) => Promise<void>;
  refreshAll: () => Promise<void>;
  /** Validates a provisioning URL via whoami, then stores it in settings. */
  addManualBridge: (input: string) => Promise<BridgeEntry>;
  removeManualBridge: (url: string) => void;
}

const clients = new Map<string, ProvisioningClient>();

export function provisioningClient(entry: Pick<BridgeEntry, 'url' | 'external'>): ProvisioningClient {
  const key = `${entry.external ? 'ext' : 'int'}|${entry.url}`;
  let client = clients.get(key);
  if (!client) {
    client = new ProvisioningClient(entry.url, entry.external);
    clients.set(key, client);
  }
  return client;
}

const inFlight = new Map<string, Promise<void>>();
let discovery: Promise<void> | null = null;

/** Discovery is considered fresh for this long (the new chat dialog reuses it). */
const DISCOVERY_TTL = 5 * 60 * 1000;

export const useBridges = create<BridgesState>()(
  persist(
    (set, get) => {
      const patch = (url: string, p: Partial<BridgeEntry>) =>
        set((s) => (s.bridges[url] ? { bridges: { ...s.bridges, [url]: { ...s.bridges[url], ...p } } } : s));

      const refreshBridge = (url: string): Promise<void> => {
        const running = inFlight.get(url);
        if (running) return running;
        const entry = get().bridges[url];
        if (!entry) return Promise.resolve();
        patch(url, { loading: true });
        const client = provisioningClient(entry);
        const promise = (async () => {
          try {
            const [whoami, capabilities] = await Promise.all([
              client.whoami(),
              client.capabilities().catch(() => null),
            ]);
            patch(url, { whoami, capabilities, error: undefined, loading: false, checkedAt: Date.now() });
          } catch (err) {
            patch(url, { error: describeError(err), loading: false, checkedAt: Date.now() });
          } finally {
            inFlight.delete(url);
          }
        })();
        inFlight.set(url, promise);
        return promise;
      };

      const doDiscover = async () => {
        const client = getClient();
        if (!client) return;
        const me = client.getSafeUserId();
        if (get().userId !== me) set({ userId: me, bridges: {}, lastDiscovery: 0 });

        const found = new Map<string, { external: boolean; source: BridgeSource }>();
        const errors: string[] = [];
        let ownWellKnownOk = true;
        const add = (url: string, external: boolean, source: BridgeSource) => {
          if (!found.has(url)) found.set(url, { external, source });
        };

        const server = userServerName(me);
        try {
          const own = await fetchMautrixWellKnown(server);
          for (const url of own.bridges) add(url, false, 'well-known');
          // External bridge servers are best effort; they must never see the access token.
          const external = await Promise.allSettled(own.externalServers.map((s) => fetchMautrixWellKnown(s)));
          external.forEach((res, i) => {
            if (res.status === 'fulfilled') for (const url of res.value.bridges) add(url, true, 'external');
            else errors.push(t('bridges.errExternalServer', { server: own.externalServers[i] }));
          });
        } catch (err) {
          ownWellKnownOk = false;
          errors.push(
            err instanceof TypeError
              ? t('bridges.errWellKnownNetwork', { server })
              : describeError(err),
          );
        }
        for (const url of useSettings.getState().bridges.manualUrls) {
          const normalized = normalizeBridgeUrl(url);
          add(normalized, !isLocalBridgeUrl(normalized), 'manual');
        }

        const prev = get().bridges;
        const next: Record<string, BridgeEntry> = {};
        for (const [url, meta] of found) {
          const old = prev[url];
          next[url] = old && old.external === meta.external
            ? { ...old, source: meta.source }
            : { url, external: meta.external, source: meta.source, loading: true };
        }
        // Keep cached well-known bridges when the well-known request itself failed (offline, CORS hiccup).
        if (!ownWellKnownOk) {
          for (const [url, old] of Object.entries(prev)) {
            if (!next[url] && old.source !== 'manual') next[url] = old;
          }
        }
        set({ bridges: next, discoveryErrors: errors, lastDiscovery: Date.now() });
        await Promise.all(Object.keys(next).map(refreshBridge));
      };

      return {
        userId: null,
        bridges: {},
        discovering: false,
        discoveryErrors: [],
        lastDiscovery: 0,

        discover: (opts) => {
          const client = getClient();
          const fresh =
            !!client &&
            get().userId === client.getSafeUserId() &&
            Date.now() - get().lastDiscovery < DISCOVERY_TTL;
          if (!opts?.force && fresh) return Promise.resolve();
          discovery ??= (async () => {
            set({ discovering: true });
            try {
              await doDiscover();
            } finally {
              set({ discovering: false });
              discovery = null;
            }
          })();
          return discovery;
        },

        refreshBridge,

        refreshAll: async () => {
          await Promise.all(Object.keys(get().bridges).map(refreshBridge));
        },

        addManualBridge: async (input) => {
          const url = normalizeBridgeUrl(input);
          try {
            new URL(url);
          } catch {
            throw new Error(t('bridges.errInvalidUrl'));
          }
          const external = !isLocalBridgeUrl(url);
          const client = provisioningClient({ url, external });
          let whoami: Whoami;
          try {
            whoami = await client.whoami();
          } catch (err) {
            throw new Error(describeError(err));
          }
          if (!whoami?.network || !whoami.bridge_bot) {
            throw new Error(t('bridges.errNotMautrix'));
          }
          const capabilities = await client.capabilities().catch(() => null);
          const existing = get().bridges[url];
          const entry: BridgeEntry = {
            url,
            external,
            source: existing?.source ?? 'manual',
            whoami,
            capabilities,
            loading: false,
            checkedAt: Date.now(),
          };
          useSettings.getState().addBridgeUrl(url);
          set((s) => ({ bridges: { ...s.bridges, [url]: entry } }));
          return entry;
        },

        removeManualBridge: (url) => {
          useSettings.getState().removeBridgeUrl(url);
          set((s) => {
            const entry = s.bridges[url];
            if (!entry || entry.source !== 'manual') return s;
            const bridges = { ...s.bridges };
            delete bridges[url];
            return { bridges };
          });
        },
      };
    },
    {
      name: 'myna.bridges',
      version: 1,
      // Cache whoami so the page and the new chat dialog render instantly; states refresh on open.
      partialize: (s) => ({
        userId: s.userId,
        bridges: Object.fromEntries(
          Object.entries(s.bridges).map(([url, b]) => [url, { ...b, loading: false, error: undefined }]),
        ),
      }),
    },
  ),
);

/** Bridges sorted by network name (stable for rendering). */
export function sortBridges(bridges: Record<string, BridgeEntry>): BridgeEntry[] {
  return Object.values(bridges).sort((a, b) => {
    const an = a.whoami?.network.displayname ?? a.url;
    const bn = b.whoami?.network.displayname ?? b.url;
    return an.localeCompare(bn, getLocale()) || a.url.localeCompare(b.url);
  });
}

/** Runs discovery when mounted (cached unless `force`) and optionally polls login states. */
export function useBridgesLoader(opts: { force?: boolean; pollMs?: number } = {}) {
  const { force, pollMs } = opts;
  useEffect(() => {
    void useBridges.getState().discover({ force });
    if (!pollMs) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void useBridges.getState().refreshAll();
    }, pollMs);
    return () => clearInterval(timer);
  }, [force, pollMs]);
}
