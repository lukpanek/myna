import { useEffect, useState } from 'react';
import { describeError, isAbortError, ProvisioningError } from '@/features/bridges/provisioning';
import type { ResolveIdentifierCapabilities, ResolvedIdentifier } from '@/features/bridges/types';
import { type BridgeEntry, provisioningClient } from '@/features/bridges/use-bridges';

export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

export type QueryKind = 'phone' | 'email' | 'username';

/** What a typed query could be resolved as on a remote network. */
export function classifyQuery(query: string): QueryKind | null {
  const q = query.trim();
  if (!q) return null;
  if (/^\+?[\d\s\-().]+$/.test(q) && q.replace(/\D/g, '').length >= 5) return 'phone';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q)) return 'email';
  if (/^@?[\w.\-]{2,}$/.test(q)) return 'username';
  return null;
}

export function normalizeIdentifier(query: string, kind: QueryKind): string {
  const q = query.trim();
  return kind === 'phone' ? q.replace(/[\s\-().]/g, '') : q;
}

/** Unknown capabilities (older bridges) → just try; the bridge answers 501/404 when it can't. */
export function canResolve(caps: ResolveIdentifierCapabilities | undefined, kind: QueryKind): boolean {
  if (!caps) return true;
  if (caps.create_dm === false) return false;
  switch (kind) {
    case 'phone':
      return !!(caps.lookup_phone || caps.any_phone);
    case 'email':
      return !!caps.lookup_email;
    case 'username':
      return !!caps.lookup_username;
  }
}

// ── Contacts (cached per bridge + login) ────────────────────────────────────

const CONTACTS_TTL = 5 * 60 * 1000;
const contactsCache = new Map<string, { at: number; promise: Promise<ResolvedIdentifier[]> }>();

function loadContacts(entry: BridgeEntry, loginId: string | undefined): Promise<ResolvedIdentifier[]> {
  const key = `${entry.url}|${loginId ?? ''}`;
  const cached = contactsCache.get(key);
  if (cached && Date.now() - cached.at < CONTACTS_TTL) return cached.promise;
  const promise = provisioningClient(entry).contacts(loginId);
  contactsCache.set(key, { at: Date.now(), promise });
  promise.catch(() => {
    if (contactsCache.get(key)?.promise === promise) contactsCache.delete(key);
  });
  return promise;
}

interface ContactsState {
  key: string;
  contacts: ResolvedIdentifier[];
  loading: boolean;
  error: string | null;
  unsupported: boolean;
}

export function useContacts(entry: BridgeEntry | undefined, loginId: string | undefined, enabled: boolean) {
  const key = entry && enabled ? `${entry.url}|${loginId ?? ''}` : '';
  const [state, setState] = useState<ContactsState>({ key: '', contacts: [], loading: false, error: null, unsupported: false });

  useEffect(() => {
    if (!entry || !key) return;
    let alive = true;
    setState({ key, contacts: [], loading: true, error: null, unsupported: false });
    loadContacts(entry, loginId).then(
      (contacts) => alive && setState({ key, contacts, loading: false, error: null, unsupported: false }),
      (err) =>
        alive &&
        setState({
          key,
          contacts: [],
          loading: false,
          error: describeError(err),
          unsupported: err instanceof ProvisioningError && err.unsupported,
        }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Disabled = the bridge declared it has no contact list.
  if (!key) return { contacts: [], loading: false, error: null, unsupported: true };
  if (state.key !== key) return { contacts: [], loading: true, error: null, unsupported: false };
  return state;
}

// ── Remote search & identifier resolution ───────────────────────────────────

export function useRemoteSearch(entry: BridgeEntry | undefined, loginId: string | undefined, query: string, enabled: boolean) {
  const key = entry && enabled && query ? `${entry.url}|${loginId ?? ''}|${query}` : '';
  const [state, setState] = useState<{ key: string; results: ResolvedIdentifier[]; loading: boolean }>({
    key: '',
    results: [],
    loading: false,
  });
  useEffect(() => {
    if (!entry || !key) return;
    const ac = new AbortController();
    setState({ key, results: [], loading: true });
    provisioningClient(entry)
      .searchUsers(query, loginId, ac.signal)
      .then(
        (results) => setState({ key, results, loading: false }),
        (err) => !isAbortError(err) && setState({ key, results: [], loading: false }),
      );
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? state : { key, results: [], loading: !!key };
}

export type ResolveState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'found'; result: ResolvedIdentifier }
  | { status: 'not-found' }
  | { status: 'error'; message: string };

export function useResolveIdentifier(
  entry: BridgeEntry | undefined,
  loginId: string | undefined,
  identifier: string,
  enabled: boolean,
): ResolveState {
  const key = entry && enabled && identifier ? `${entry.url}|${loginId ?? ''}|${identifier}` : '';
  const [state, setState] = useState<{ key: string; value: ResolveState }>({ key: '', value: { status: 'idle' } });
  useEffect(() => {
    if (!entry || !key) return;
    const ac = new AbortController();
    setState({ key, value: { status: 'loading' } });
    provisioningClient(entry)
      .resolveIdentifier(identifier, loginId, ac.signal)
      .then(
        (result) => setState({ key, value: result?.id || result?.mxid ? { status: 'found', result } : { status: 'not-found' } }),
        (err) => {
          if (isAbortError(err)) return;
          const notFound = err instanceof ProvisioningError && (err.status === 404 || err.errcode === 'M_NOT_FOUND');
          setState({ key, value: notFound ? { status: 'not-found' } : { status: 'error', message: describeError(err) } });
        },
      );
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!key) return { status: 'idle' };
  return state.key === key ? state.value : { status: 'loading' };
}

/** `tel:+420…` → `+420…`; first human-readable identifier of a contact. */
export function primaryIdentifier(contact: ResolvedIdentifier): string | undefined {
  const raw = contact.identifiers?.find(Boolean);
  if (!raw) return undefined;
  return raw.replace(/^(tel|mailto|email|username|phone):/i, '');
}
