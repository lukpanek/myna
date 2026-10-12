import { Hash, LoaderCircle, MessageSquarePlus, Plug } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { MxAvatar, NetworkIcon } from '@/components/mx-avatar';
import { Button } from '@/components/ui/button';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { foldText, loginDisplayName, loginStatus } from '@/features/bridges/bridge-format';
import { openDirectChat, openRoomWhenReady } from '@/features/bridges/direct-chat';
import { describeError } from '@/features/bridges/provisioning';
import type { ResolvedIdentifier } from '@/features/bridges/types';
import { type BridgeEntry, provisioningClient, sortBridges, useBridges, useBridgesLoader } from '@/features/bridges/use-bridges';
import { getLocale, t } from '@/i18n';
import { cn } from '@/lib/utils';
import { useMatrixClient } from '@/matrix/context';
import { type NetworkSummary, useRooms } from '@/matrix/rooms-store';
import { useUi } from '@/store/ui';
import {
  canResolve,
  classifyQuery,
  normalizeIdentifier,
  primaryIdentifier,
  useContacts,
  useDebounced,
  useRemoteSearch,
  useResolveIdentifier,
} from './use-bridge-search';

const MATRIX_KEY = 'matrix';
const MAX_ROWS = 100;

/** Slack-style "Nová zpráva": pick a network (bridge or Matrix), search a person, open the DM. */
export function NewChatDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle>{t('newChat.title')}</DialogTitle>
          <DialogDescription className="sr-only">{t('newChat.description')}</DialogDescription>
        </DialogHeader>
        {open && <NewChatBody onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

/** Network id as used by the rail (`m.bridge` protocol id), so we can match the current view. */
function railNetworkId(entry: BridgeEntry, networks: NetworkSummary[]): string {
  const bot = entry.whoami?.bridge_bot;
  return networks.find((n) => bot && n.bridgeBot === bot)?.id ?? entry.whoami?.network.network_id ?? entry.url;
}

function NewChatBody({ onDone }: { onDone: () => void }) {
  useBridgesLoader();
  const bridgesMap = useBridges((s) => s.bridges);
  const networks = useRooms((s) => s.networks);
  const bridges = useMemo(
    () => sortBridges(bridgesMap).filter((b) => (b.whoami?.logins?.length ?? 0) > 0),
    [bridgesMap],
  );

  const [selected, setSelected] = useState<string | null>(null);
  const [loginChoice, setLoginChoice] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Default: the network open in the rail, else the first bridge, else Matrix.
  const defaultKey = useMemo(() => {
    const view = useUi.getState().view;
    if (view.kind === 'matrix') return MATRIX_KEY;
    if (view.kind === 'network') {
      const match = bridges.find((b) => railNetworkId(b, networks) === view.networkId);
      if (match) return match.url;
    }
    return bridges[0]?.url ?? MATRIX_KEY;
  }, [bridges, networks]);
  const activeKey = selected && (selected === MATRIX_KEY || bridges.some((b) => b.url === selected)) ? selected : defaultKey;
  const entry = bridges.find((b) => b.url === activeKey);
  const networkId = entry ? railNetworkId(entry, networks) : undefined;

  const logins = entry?.whoami?.logins ?? [];
  const loginId = useMemo(() => {
    if (!entry) return undefined;
    const chosen = loginChoice[entry.url];
    if (chosen && logins.some((l) => l.id === chosen)) return chosen;
    const railAccount = networkId ? useUi.getState().accountByNetwork[networkId] : null;
    if (railAccount && logins.some((l) => l.id === railAccount)) return railAccount;
    return (logins.find((l) => loginStatus(l.state).kind === 'connected') ?? logins[0])?.id;
  }, [entry, loginChoice, logins, networkId]);
  const login = logins.find((l) => l.id === loginId);
  const loginState = login ? loginStatus(login.state) : null;

  const pick = (key: string) => {
    setSelected(key);
    inputRef.current?.focus();
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      onDone();
    } catch (err) {
      toast.error(t('newChat.openFailed', { error: describeError(err) }));
      setBusy(false);
    }
  };

  const client = useMatrixClient();

  const startBridgeChat = (identifier: string, existingRoomId?: string) =>
    run(async () => {
      if (!entry) return;
      let roomId: string | undefined;
      if (existingRoomId && client.getRoom(existingRoomId)?.getMyMembership() === 'join') roomId = existingRoomId;
      if (!roomId) roomId = (await provisioningClient(entry).createDm(identifier, loginId)).dm_room_mxid;
      if (!roomId) throw new Error(t('newChat.noChatReturned'));
      await openRoomWhenReady(client, roomId, { networkId });
    });

  const startMatrixChat = (userId: string) =>
    run(() => openDirectChat(client, userId, { encrypted: !!client.getCrypto() }));

  const openExisting = (roomId: string) =>
    run(async () => {
      await openRoomWhenReady(client, roomId);
    });

  const placeholder = entry
    ? t('newChat.searchIn', { network: entry.whoami?.network.displayname ?? t('newChat.networkFallback') })
    : t('newChat.matrixPlaceholder');

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-1.5 px-5 pb-3" role="radiogroup" aria-label={t('newChat.network')}>
        {bridges.map((b) => {
          const n = b.whoami!.network;
          return (
            <Chip key={b.url} active={activeKey === b.url} onClick={() => pick(b.url)}>
              <NetworkIcon networkId={n.network_id} avatarMxc={n.network_icon} name={n.displayname} size={16} />
              {n.displayname}
            </Chip>
          );
        })}
        <Chip active={activeKey === MATRIX_KEY} onClick={() => pick(MATRIX_KEY)}>
          <Hash className="size-3.5" />
          Matrix
        </Chip>
      </div>

      {entry && logins.length > 1 && (
        <div className="flex items-center gap-2 px-5 pb-3 text-sm">
          <span className="text-muted-foreground">{t('newChat.fromAccount')}</span>
          <Select
            value={loginId}
            onValueChange={(id) => {
              setLoginChoice((s) => ({ ...s, [entry.url]: id }));
              inputRef.current?.focus();
            }}
          >
            <SelectTrigger size="sm" className="h-7 min-w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {logins.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {loginDisplayName(l)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {loginState && loginState.kind !== 'connected' && (
        <p className="px-5 pb-3 text-xs text-muted-foreground">
          {t('newChat.accountState', { state: loginState.label })}
        </p>
      )}

      <Command shouldFilter={false} className="rounded-none border-t">
        <CommandInput
          ref={inputRef}
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder={placeholder}
          className="h-11"
          disabled={busy}
        />
        <CommandList className="h-[340px] max-h-[340px]">
          {entry ? (
            <BridgeResults
              key={`${entry.url}|${loginId ?? ''}`}
              entry={entry}
              loginId={loginId}
              query={query}
              onPick={startBridgeChat}
            />
          ) : (
            <MatrixResults query={query} onPickUser={startMatrixChat} onPickRoom={openExisting} />
          )}
        </CommandList>
      </Command>

      {bridges.length === 0 && (
        <div className="flex items-center gap-3 border-t px-5 py-3 text-xs text-muted-foreground">
          <Plug className="size-4 shrink-0" />
          <span className="flex-1">{t('newChat.linkAccountHint')}</span>
          <Button
            variant="outline"
            size="xs"
            onClick={() => {
              onDone();
              useUi.getState().setPage('bridges');
            }}
          >
            {t('newChat.linkedAccounts')}
          </Button>
        </div>
      )}

      {busy && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-background/70 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          {t('newChat.openingChat')}
        </div>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors',
        active
          ? 'border-foreground/20 bg-accent text-accent-foreground'
          : 'border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

// ── Bridge results ──────────────────────────────────────────────────────────

function matchesContact(contact: ResolvedIdentifier, folded: string[]): boolean {
  const hay = foldText([contact.name, contact.id, ...(contact.identifiers ?? [])].filter(Boolean).join(' '));
  return folded.every((t) => hay.includes(t));
}

function BridgeResults({
  entry,
  loginId,
  query,
  onPick,
}: {
  entry: BridgeEntry;
  loginId?: string;
  query: string;
  onPick: (identifier: string, existingRoomId?: string) => void;
}) {
  const caps = entry.capabilities?.resolve_identifier;
  const contacts = useContacts(entry, loginId, caps?.contact_list !== false);
  const debounced = useDebounced(query.trim(), 400);

  const search = useRemoteSearch(entry, loginId, debounced, !!caps?.search && debounced.length >= 2);
  const kind = classifyQuery(debounced);
  const resolveEnabled = !!kind && canResolve(caps, kind);
  const identifier = kind ? normalizeIdentifier(debounced, kind) : '';
  const resolved = useResolveIdentifier(entry, loginId, identifier, resolveEnabled);
  const found = resolved.status === 'found' ? resolved.result : null;

  const filtered = useMemo(() => {
    const tokens = foldText(query.trim()).split(/\s+/).filter(Boolean);
    const list = tokens.length ? contacts.contacts.filter((c) => matchesContact(c, tokens)) : contacts.contacts;
    return [...list].sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id, getLocale())).slice(0, MAX_ROWS);
  }, [contacts.contacts, query]);

  const searchResults = useMemo(() => {
    const seen = new Set(filtered.map((c) => c.id));
    return search.results.filter((r) => !seen.has(r.id));
  }, [filtered, search.results]);

  const pickContact = (c: ResolvedIdentifier) => onPick(c.mxid || c.id, c.dm_room_mxid);
  const anyPhone = kind === 'phone' && !!caps?.any_phone;
  const network = entry.whoami?.network.displayname ?? t('newChat.networkFallback');
  const typing = query.trim() !== debounced;

  const nothing =
    !contacts.loading &&
    !search.loading &&
    !typing &&
    filtered.length === 0 &&
    searchResults.length === 0 &&
    (!resolveEnabled || resolved.status === 'not-found' || resolved.status === 'error') &&
    !anyPhone;

  return (
    <>
      {resolveEnabled && (
        <CommandGroup heading={t('newChat.writeToHeading')}>
          {found ? (
            <ContactItem
              value={`resolve:${identifier}`}
              contact={found}
              fallbackName={debounced}
              secondary={debounced}
              onSelect={() => onPick(found.mxid || identifier, found.dm_room_mxid)}
            />
          ) : resolved.status === 'loading' || typing ? (
            <CommandItem value="resolve:loading" disabled className="gap-2.5 text-muted-foreground">
              <LoaderCircle className="animate-spin" />
              {t('newChat.searchingFor', { query: debounced || query.trim() })}
            </CommandItem>
          ) : anyPhone ? (
            <CommandItem value={`resolve:${identifier}`} onSelect={() => onPick(identifier)} className="gap-2.5">
              <MessageSquarePlus />
              {t('newChat.writeTo', { target: debounced })}
            </CommandItem>
          ) : (
            <CommandItem value="resolve:none" disabled className="text-muted-foreground">
              {resolved.status === 'error'
                ? resolved.message
                : t('newChat.notFoundOn', { query: debounced, network })}
            </CommandItem>
          )}
        </CommandGroup>
      )}

      {filtered.length > 0 && (
        <CommandGroup heading={t('newChat.contacts')}>
          {filtered.map((c) => (
            <ContactItem key={c.id} value={`contact:${c.id}`} contact={c} onSelect={() => pickContact(c)} />
          ))}
        </CommandGroup>
      )}

      {(searchResults.length > 0 || search.loading) && (
        <CommandGroup heading={t('newChat.searchHeading', { network })}>
          {search.loading && searchResults.length === 0 ? (
            <CommandItem value="search:loading" disabled className="gap-2.5 text-muted-foreground">
              <LoaderCircle className="animate-spin" />
              {t('newChat.searching')}
            </CommandItem>
          ) : (
            searchResults.map((c) => (
              <ContactItem key={c.id} value={`search:${c.id}`} contact={c} onSelect={() => pickContact(c)} />
            ))
          )}
        </CommandGroup>
      )}

      {contacts.loading && filtered.length === 0 && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          {t('newChat.loadingContacts')}
        </div>
      )}

      {nothing && (
        <p className="px-6 py-8 text-center text-sm text-muted-foreground">
          {!query.trim()
            ? contacts.unsupported
              ? t('newChat.contactsUnsupported', { network })
              : contacts.error
                ? t('newChat.contactsFailed', { error: contacts.error })
                : t('newChat.noContacts')
            : t('newChat.nothingFound')}
        </p>
      )}
    </>
  );
}

function ContactItem({
  value,
  contact,
  fallbackName,
  secondary,
  onSelect,
}: {
  value: string;
  contact: ResolvedIdentifier;
  fallbackName?: string;
  secondary?: string;
  onSelect: () => void;
}) {
  const name = contact.name || fallbackName || primaryIdentifier(contact) || contact.id;
  const detail = secondary ?? primaryIdentifier(contact);
  return (
    <CommandItem value={value} onSelect={onSelect} className="gap-2.5">
      <MxAvatar mxc={contact.avatar_url} name={name} seed={contact.mxid || contact.id} size={28} />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {detail && detail !== name && <span className="shrink-0 text-xs text-muted-foreground">{detail}</span>}
    </CommandItem>
  );
}

// ── Matrix results ──────────────────────────────────────────────────────────

const MXID = /^@[^:\s]+:\S+$/;

interface DirectoryUser {
  user_id: string;
  display_name?: string;
  avatar_url?: string;
}

/** Bridge ghosts (`@whatsapp_…`) are reachable via their bridge, not as plain Matrix users. */
function useGhostFilter(): (userId: string) => boolean {
  const networks = useRooms((s) => s.networks);
  return useMemo(() => {
    const prefixes = networks
      .map((n) => n.bridgeBot)
      .filter((b): b is string => !!b)
      .map((bot) => {
        const [local, ...server] = bot.slice(1).split(':');
        return { bot, prefix: `@${local.replace(/_?bot$/, '')}_`, server: server.join(':') };
      });
    return (userId: string) =>
      prefixes.some((p) => userId === p.bot || (userId.startsWith(p.prefix) && userId.endsWith(`:${p.server}`)));
  }, [networks]);
}

function MatrixResults({
  query,
  onPickUser,
  onPickRoom,
}: {
  query: string;
  onPickUser: (userId: string) => void;
  onPickRoom: (roomId: string) => void;
}) {
  const client = useMatrixClient();
  const me = client.getSafeUserId();
  const rooms = useRooms((s) => s.rooms);
  const isGhost = useGhostFilter();
  const term = useDebounced(query.trim(), 300);
  const [results, setResults] = useState<{ term: string; users: DirectoryUser[]; loading: boolean }>({
    term: '',
    users: [],
    loading: false,
  });

  useEffect(() => {
    if (!term) return;
    let alive = true;
    setResults({ term, users: [], loading: true });
    client.searchUserDirectory({ term, limit: 20 }).then(
      (resp) => alive && setResults({ term, users: resp.results, loading: false }),
      () => alive && setResults({ term, users: [], loading: false }),
    );
    return () => {
      alive = false;
    };
  }, [client, term]);

  const recent = useMemo(
    () =>
      Object.values(rooms)
        .filter((r) => !r.bridge && r.isDm && r.dmUserId && !r.isBotRoom && r.membership === 'join')
        .sort((a, b) => b.lastTs - a.lastTs)
        .slice(0, 8),
    [rooms],
  );

  const trimmed = query.trim();
  const users = (results.term === term ? results.users : []).filter((u) => u.user_id !== me && !isGhost(u.user_id));
  const loading = !!trimmed && (trimmed !== term || results.term !== term || results.loading);
  const exact = MXID.test(trimmed) && trimmed !== me && !users.some((u) => u.user_id === trimmed);

  if (!trimmed) {
    if (recent.length === 0) {
      return (
        <p className="px-6 py-8 text-center text-sm text-muted-foreground">
          {t('newChat.matrixHint')}
        </p>
      );
    }
    return (
      <CommandGroup heading={t('newChat.recent')}>
        {recent.map((r) => (
          <CommandItem key={r.roomId} value={`recent:${r.roomId}`} onSelect={() => onPickRoom(r.roomId)} className="gap-2.5">
            <MxAvatar mxc={r.avatarMxc} name={r.name} seed={r.dmUserId} size={28} />
            <span className="min-w-0 flex-1 truncate">{r.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{r.dmUserId}</span>
          </CommandItem>
        ))}
      </CommandGroup>
    );
  }

  return (
    <>
      {exact && (
        <CommandGroup heading={t('newChat.writeToHeading')}>
          <CommandItem value={`mxid:${trimmed}`} onSelect={() => onPickUser(trimmed)} className="gap-2.5">
            <MessageSquarePlus />
            {t('newChat.writeToUser', { user: trimmed })}
          </CommandItem>
        </CommandGroup>
      )}
      {users.length > 0 && (
        <CommandGroup heading={t('newChat.users')}>
          {users.map((u) => {
            const name = u.display_name || u.user_id;
            return (
              <CommandItem key={u.user_id} value={`user:${u.user_id}`} onSelect={() => onPickUser(u.user_id)} className="gap-2.5">
                <MxAvatar mxc={u.avatar_url} name={name} seed={u.user_id} size={28} />
                <span className="min-w-0 flex-1 truncate">{name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{u.user_id}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      )}
      {loading && users.length === 0 && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          {t('newChat.searching')}
        </div>
      )}
      {!loading && !exact && users.length === 0 && (
        <p className="px-6 py-8 text-center text-sm text-muted-foreground">
          {t('newChat.noUsers')}
        </p>
      )}
    </>
  );
}
