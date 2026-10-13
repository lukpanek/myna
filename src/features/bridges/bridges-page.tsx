import {
  ChevronRight,
  CircleAlert,
  Ellipsis,
  LoaderCircle,
  LogOut,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash,
} from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { MxAvatar, NetworkIcon } from '@/components/mx-avatar';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { t } from '@/i18n';
import { tn } from '@/i18n/rich';
import { cn } from '@/lib/utils';
import { useMatrixClient } from '@/matrix/context';
import { type NetworkSummary, useRooms } from '@/matrix/rooms-store';
import { useUi } from '@/store/ui';
import { AddBridgeDialog } from './add-bridge-dialog';
import { type LoginStatusKind, loginDisplayName, loginSecondary, loginStatus } from './bridge-format';
import { openDirectChat } from './direct-chat';
import { LoginDialog, type LoginTarget } from './login-dialog';
import { NetworkIconDialog, type NetworkIconTarget } from './network-icon-dialog';
import { describeError, userServerName } from './provisioning';
import type { WhoamiLogin } from './types';
import { type BridgeEntry, provisioningClient, sortBridges, useBridges, useBridgesLoader } from './use-bridges';

/** "Propojené účty": Beeper-style account manager for mautrix bridgev2 bridges. */
export function BridgesPage() {
  useBridgesLoader({ force: true, pollMs: 30_000 });
  const bridgesMap = useBridges((s) => s.bridges);
  const discovering = useBridges((s) => s.discovering);
  const discoveryErrors = useBridges((s) => s.discoveryErrors);
  const networks = useRooms((s) => s.networks);

  const [addOpen, setAddOpen] = useState(false);
  const [loginTarget, setLoginTarget] = useState<LoginTarget | null>(null);
  const [logoutTarget, setLogoutTarget] = useState<{ entry: BridgeEntry; login: WhoamiLogin } | null>(null);

  const bridges = useMemo(() => sortBridges(bridgesMap), [bridgesMap]);
  const unmanaged = useMemo(() => {
    const bots = new Set(bridges.map((b) => b.whoami?.bridge_bot).filter(Boolean));
    return networks.filter((n) => n.bridgeBot && !bots.has(n.bridgeBot));
  }, [bridges, networks]);

  const initialLoading = discovering && bridges.length === 0;

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-8 pt-10 pb-16">
        <header className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight">{t('bridges.pageTitle')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('bridges.pageSubtitle')}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void useBridges.getState().discover({ force: true })}
              disabled={discovering}
            >
              <RefreshCw className={cn(discovering && 'animate-spin')} />
              {t('bridges.refresh')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
              <Plus />
              {t('bridges.addBridge')}
            </Button>
          </div>
        </header>

        {discoveryErrors.length > 0 && (
          <div className="mt-6 grid gap-1">
            {discoveryErrors.map((e) => (
              <p key={e} className="flex gap-2 text-xs text-muted-foreground">
                <CircleAlert className="mt-px size-3.5 shrink-0" />
                {e}
              </p>
            ))}
          </div>
        )}

        <div className="mt-8 grid gap-6">
          {initialLoading && <SectionSkeleton />}
          {bridges.map((entry) => (
            <BridgeSection
              key={entry.url}
              entry={entry}
              onLogin={setLoginTarget}
              onLogout={(login) => setLogoutTarget({ entry, login })}
            />
          ))}
          {!initialLoading && bridges.length === 0 && unmanaged.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t('bridges.noBridges')}
            </p>
          )}
          {unmanaged.length > 0 && <OtherBridges networks={unmanaged} />}
          <SetupHelp />
        </div>
      </div>

      <AddBridgeDialog open={addOpen} onOpenChange={setAddOpen} />
      <LoginDialog target={loginTarget} onClose={() => setLoginTarget(null)} />
      <LogoutDialog target={logoutTarget} onClose={() => setLogoutTarget(null)} />
    </div>
  );
}

// ── Bridge section ──────────────────────────────────────────────────────────

function BridgeSection({
  entry,
  onLogin,
  onLogout,
}: {
  entry: BridgeEntry;
  onLogin: (target: LoginTarget) => void;
  onLogout: (login: WhoamiLogin) => void;
}) {
  const client = useMatrixClient();
  const { whoami } = entry;
  const logins = whoami?.logins ?? [];
  const [openingBot, setOpeningBot] = useState(false);
  const [iconTarget, setIconTarget] = useState<NetworkIconTarget | null>(null);

  const openBotChat = async () => {
    if (!whoami) return;
    setOpeningBot(true);
    try {
      const managementRoom = whoami.management_room ? client.getRoom(whoami.management_room) : null;
      if (managementRoom?.getMyMembership() === 'join') useUi.getState().openRoom(managementRoom.roomId);
      else await openDirectChat(client, whoami.bridge_bot);
    } catch (err) {
      toast.error(t('bridges.openBotChatFailed', { error: describeError(err) }));
    } finally {
      setOpeningBot(false);
    }
  };

  if (!whoami) {
    return (
      <Block>
        <BlockHeader>
          <span className="size-7 shrink-0 rounded-full bg-muted" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-semibold">{hostLabel(entry.url)}</h2>
            <p className="truncate text-xs text-muted-foreground">{entry.url}</p>
          </div>
          {entry.source === 'manual' && (
            <Button variant="ghost" size="sm" onClick={() => useBridges.getState().removeManualBridge(entry.url)}>
              <Trash />
              {t('common.remove')}
            </Button>
          )}
          <Button variant="outline" size="sm" disabled={entry.loading} onClick={() => void useBridges.getState().refreshBridge(entry.url)}>
            <RefreshCw className={cn(entry.loading && 'animate-spin')} />
            {t('common.retry')}
          </Button>
        </BlockHeader>
        <BlockBody>
          {entry.loading ? (
            <LoginRowSkeleton />
          ) : (
            <p className="flex gap-2 px-4 py-4 text-sm text-muted-foreground">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
              {entry.error ?? t('bridges.bridgeNoResponse')}
            </p>
          )}
        </BlockBody>
      </Block>
    );
  }

  const network = whoami.network;
  return (
    <Block>
      <BlockHeader>
        <NetworkIcon
          networkId={network.network_id.toLowerCase()}
          avatarMxc={network.network_icon}
          name={network.displayname}
          size={28}
        />
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 truncate text-[15px] font-semibold">
            {network.displayname}
            {entry.loading && <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />}
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            {whoami.bridge_bot}
            {entry.external && ` · ${t('bridges.otherServer')}`}
          </p>
        </div>
        {logins.length > 0 && (
          <Button size="sm" onClick={() => onLogin({ url: entry.url })}>
            <Plus />
            {t('bridges.addAccount')}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t('bridges.moreActions')}>
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void openBotChat()} disabled={openingBot}>
              <MessageSquare />
              {t('bridges.botChat')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                setIconTarget({
                  networkId: network.network_id.toLowerCase(),
                  name: network.displayname,
                  avatarMxc: network.network_icon,
                })
              }
            >
              <Pencil />
              {t('bridges.editNetwork')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void useBridges.getState().refreshBridge(entry.url)}>
              <RefreshCw />
              {t('bridges.refreshState')}
            </DropdownMenuItem>
            {entry.source === 'manual' && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => useBridges.getState().removeManualBridge(entry.url)}>
                  <Trash />
                  {t('bridges.removeFromMyna')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <NetworkIconDialog target={iconTarget} onOpenChange={(open) => !open && setIconTarget(null)} />
      </BlockHeader>

      <BlockBody>
        {entry.error && (
          <p className="flex gap-2 border-b px-4 py-2.5 text-xs text-muted-foreground">
            <CircleAlert className="mt-px size-3.5 shrink-0 text-destructive" />
            {t('bridges.refreshFailed', { error: entry.error })}
          </p>
        )}

        {logins.length === 0 ? (
          <div className="flex items-center justify-between gap-4 px-4 py-4">
            <p className="text-sm text-muted-foreground">{t('bridges.noAccounts')}</p>
            <Button onClick={() => onLogin({ url: entry.url })}>{t('bridges.signIn')}</Button>
          </div>
        ) : (
          <ul className="divide-y">
            {logins.map((login) => (
              <li key={login.id}>
                <LoginRow
                  login={login}
                  onRelogin={() => onLogin({ url: entry.url, reloginId: login.id })}
                  onLogout={() => onLogout(login)}
                />
              </li>
            ))}
          </ul>
        )}
      </BlockBody>
    </Block>
  );
}

function LoginRow({
  login,
  onRelogin,
  onLogout,
}: {
  login: WhoamiLogin;
  onRelogin: () => void;
  onLogout: () => void;
}) {
  const name = loginDisplayName(login);
  const secondary = loginSecondary(login);
  const status = loginStatus(login.state);
  const showDetail = status.detail && status.kind !== 'connected';

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <MxAvatar mxc={login.profile?.avatar} name={name} seed={login.id} size={36} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{name}</div>
        {secondary && <div className="truncate text-xs text-muted-foreground">{secondary}</div>}
        {showDetail && (
          <div className={cn('mt-0.5 text-xs', status.kind === 'connecting' ? 'text-muted-foreground' : 'text-destructive')}>
            {status.detail}
          </div>
        )}
      </div>
      <StatusPill kind={status.kind} label={status.label} />
      {status.kind === 'relogin' && (
        <Button size="sm" variant="outline" onClick={onRelogin}>
          {t('bridges.relogin')}
        </Button>
      )}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t('bridges.accountActions')}>
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onRelogin}>
            <RotateCcw />
            {t('bridges.relogin')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onLogout}>
            <LogOut />
            {t('bridges.logout')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

const DOT: Record<LoginStatusKind, string> = {
  connected: 'bg-emerald-500',
  connecting: 'bg-amber-500',
  relogin: 'bg-red-500',
  error: 'bg-red-500',
  disconnected: 'bg-muted-foreground/50',
};

function StatusPill({ kind, label }: { kind: LoginStatusKind; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs',
        kind === 'relogin' || kind === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground',
      )}
    >
      <span className={cn('size-1.5 rounded-full', DOT[kind])} />
      {label}
    </span>
  );
}

// ── Logout ──────────────────────────────────────────────────────────────────

function LogoutDialog({
  target,
  onClose,
}: {
  target: { entry: BridgeEntry; login: WhoamiLogin } | null;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const name = target ? loginDisplayName(target.login) : '';
  const network = target?.entry.whoami?.network.displayname ?? t('bridges.genericBridge');

  const confirm = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await provisioningClient(target.entry).logout(target.login.id);
      toast.success(t('bridges.loggedOut', { name }));
      onClose();
      setTimeout(() => void useBridges.getState().refreshBridge(target.entry.url), 500);
    } catch (err) {
      toast.error(t('bridges.logoutFailed', { error: describeError(err) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('bridges.logoutTitle', { name })}</DialogTitle>
          <DialogDescription>{t('bridges.logoutDescription', { network })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={busy}>
            {busy && <LoaderCircle className="animate-spin" />}
            {t('bridges.logout')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Bridges without provisioning ────────────────────────────────────────────

function OtherBridges({ networks }: { networks: NetworkSummary[] }) {
  const client = useMatrixClient();
  const [opening, setOpening] = useState<string | null>(null);

  const open = async (bot: string) => {
    setOpening(bot);
    try {
      await openDirectChat(client, bot);
    } catch (err) {
      toast.error(t('bridges.openBotChatFailed', { error: describeError(err) }));
    } finally {
      setOpening(null);
    }
  };

  return (
    <Block>
      <BlockHeader>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold">{t('bridges.otherBridges')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('bridges.otherBridgesDescription')}</p>
        </div>
      </BlockHeader>
      <BlockBody>
        <ul className="divide-y">
          {networks.map((n) => (
            <li key={n.id}>
              <div className="flex items-center gap-3 px-4 py-3">
                <NetworkIcon networkId={n.id} avatarMxc={n.avatarMxc} name={n.name} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{n.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{n.bridgeBot}</div>
                </div>
                <Button variant="outline" size="sm" disabled={opening === n.bridgeBot} onClick={() => void open(n.bridgeBot!)}>
                  {opening === n.bridgeBot ? <LoaderCircle className="animate-spin" /> : <MessageSquare />}
                  {t('bridges.manageViaBot')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </BlockBody>
    </Block>
  );
}

function SetupHelp() {
  const client = useMatrixClient();
  const server = userServerName(client.getSafeUserId());
  const example = JSON.stringify(
    { 'fi.mau.bridges': [`https://${server}/whatsapp`, `https://${server}/signal`] },
    null,
    2,
  );
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90" />
        {t('bridges.setupTitle')}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="mt-3 grid list-decimal gap-3 pl-9 text-sm text-muted-foreground">
          <li>
            {tn('bridges.setupStep1', {
              allowAuth: <Code>provisioning.allow_matrix_auth: true</Code>,
              sharedSecret: <Code>provisioning.shared_secret</Code>,
            })}
          </li>
          <li>
            {tn('bridges.setupStep2', {
              publicUrl: <Code>https://{server}/whatsapp</Code>,
              localUrl: <Code>http://localhost:29318</Code>,
              path: <Code>/_matrix/provision</Code>,
            })}
          </li>
          <li>
            {tn('bridges.setupStep3', {
              wellKnownUrl: <Code>https://{server}/.well-known/matrix/mautrix</Code>,
              header: <Code>Access-Control-Allow-Origin: *</Code>,
            })}
            <pre className="mt-2 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs text-foreground">{example}</pre>
          </li>
          <li>{t('bridges.setupStep4')}</li>
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">{children}</code>;
}

// ── Block layout ────────────────────────────────────────────────────────────

/** Rounded outer frame on a darker surface; the body is a nested rounded panel on top. */
function Block({ children }: { children: ReactNode }) {
  return <section className="rounded-xl border bg-muted/60 dark:bg-black/20">{children}</section>;
}

function BlockHeader({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-3 px-4 py-3">{children}</div>;
}

function BlockBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('-mx-px -mb-px rounded-xl border bg-card', className)}>{children}</div>;
}

// ── Skeletons & helpers ─────────────────────────────────────────────────────

function SectionSkeleton() {
  return (
    <Block>
      <BlockHeader>
        <Skeleton className="size-7 rounded-full" />
        <div className="grid flex-1 gap-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-48" />
        </div>
      </BlockHeader>
      <BlockBody className="divide-y">
        <LoginRowSkeleton />
        <LoginRowSkeleton />
      </BlockBody>
    </Block>
  );
}

function LoginRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Skeleton className="size-9 rounded-full" />
      <div className="grid flex-1 gap-1.5">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-3 w-28" />
      </div>
      <Skeleton className="h-5 w-20 rounded-full" />
    </div>
  );
}

function hostLabel(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return url;
  }
}
