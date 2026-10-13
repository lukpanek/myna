import { createClient } from 'matrix-js-sdk';
import { AlertCircle, ArrowRight, Check, ChevronDown, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import { loginWithPassword, loginWithToken, resolveHomeserver } from '@/matrix/client';
import type { Session } from '@/matrix/session';

const LAST_HS_KEY = 'myna.lastHomeserver';
const SSO_HS_KEY = 'myna.ssoHomeserver';

/** Public homeservers suggested in the server combobox; any other address can be typed in. */
const PRESETS = [
  { server: 'matrix.org', description: () => t('app.presetMatrixOrg') },
  { server: 'mozilla.org', description: () => t('app.presetMozilla') },
] as const;

type Probe =
  | { state: 'idle' | 'checking' | 'error' }
  | { state: 'ok'; baseUrl: string; password: boolean; sso: boolean };

/** If the URL carries `loginToken` from an SSO redirect, exchange it for a session. */
export async function consumeSsoRedirect(): Promise<Session | null> {
  const url = new URL(window.location.href);
  const token = url.searchParams.get('loginToken');
  const baseUrl = localStorage.getItem(SSO_HS_KEY);
  if (!token || !baseUrl) return null;
  url.searchParams.delete('loginToken');
  window.history.replaceState(null, '', url.toString());
  localStorage.removeItem(SSO_HS_KEY);
  return loginWithToken(baseUrl, token);
}

/** `https://matrix.example.com/` → `matrix.example.com`, for the username suffix. */
function serverName(value: string): string {
  return value.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
}

export function LoginPage({ onLoggedIn }: { onLoggedIn: (session: Session) => void }) {
  const [server, setServer] = useState(() => localStorage.getItem(LAST_HS_KEY)?.trim() || PRESETS[0].server);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<Probe>({ state: 'idle' });

  const homeserver = server.trim();
  const isPreset = PRESETS.some((p) => p.server === homeserver);

  // Probe the server's login flows so we only offer what it supports.
  useEffect(() => {
    if (!homeserver) {
      setProbe({ state: 'idle' });
      return;
    }
    let alive = true;
    setProbe({ state: 'checking' });
    const timer = setTimeout(
      async () => {
        try {
          const baseUrl = await resolveHomeserver(homeserver);
          const res = await createClient({ baseUrl }).loginFlows();
          if (!alive) return;
          const types = res.flows.map((f) => f.type);
          setProbe({
            state: 'ok',
            baseUrl,
            password: types.includes('m.login.password'),
            sso: types.includes('m.login.sso'),
          });
        } catch {
          if (alive) setProbe({ state: 'error' });
        }
      },
      isPreset ? 0 : 500,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [homeserver, isPreset]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await loginWithPassword(homeserver, username, password);
      localStorage.setItem(LAST_HS_KEY, homeserver);
      onLoggedIn(session);
    } catch (err) {
      const e = err as { errcode?: string; message?: string };
      setError(
        e.errcode === 'M_FORBIDDEN' ? t('app.wrongCredentials') : (e.message ?? t('app.loginFailed')),
      );
    } finally {
      setBusy(false);
    }
  };

  const startSso = () => {
    if (probe.state !== 'ok') return;
    localStorage.setItem(SSO_HS_KEY, probe.baseUrl);
    localStorage.setItem(LAST_HS_KEY, homeserver);
    const redirect = `${window.location.origin}${window.location.pathname}`;
    window.location.href = createClient({ baseUrl: probe.baseUrl }).getSsoLoginUrl(redirect);
  };

  const flows = probe.state === 'ok' ? probe : null;
  const showPassword = !flows || flows.password;
  const ssoOnly = !!flows && !flows.password && flows.sso;
  const suffix = homeserver && !username.includes(':') ? `:${serverName(homeserver)}` : '';

  return (
    <div
      data-tauri-drag-region
      className="relative flex h-full items-center justify-center overflow-y-auto bg-sidebar p-6"
    >
      {/* Soft brand glow behind the card; kept faint so it reads as depth, not decoration. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(55% 45% at 50% 0%, color-mix(in oklch, var(--primary) 16%, transparent), transparent 70%),' +
            'radial-gradient(40% 35% at 85% 100%, color-mix(in oklch, var(--primary) 8%, transparent), transparent 70%)',
        }}
      />

      <div className="relative w-full max-w-[400px]">
        <div className="mb-7 flex flex-col items-center text-center">
          <Logo size={56} className="mb-5 drop-shadow-sm" />
          <h1 className="text-2xl font-semibold tracking-tight">{t('app.loginTitle')}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{t('app.loginSubtitle')}</p>
        </div>

        <form
          onSubmit={submit}
          className="space-y-5 rounded-2xl border bg-background/80 p-6 shadow-xl shadow-black/5 backdrop-blur-sm dark:shadow-black/30"
        >
          <div className="space-y-2">
            <Label htmlFor="hs">{t('app.server')}</Label>
            <ServerCombobox value={server} onChange={setServer} />
            <ServerStatus probe={probe} />
          </div>

          {showPassword && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="user">{t('app.username')}</Label>
                <div className="flex h-9 items-center rounded-md border border-input shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30">
                  {!username.startsWith('@') && (
                    <span className="pl-3 text-sm text-muted-foreground">@</span>
                  )}
                  <input
                    id="user"
                    placeholder={t('app.usernamePlaceholder')}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    autoComplete="username"
                    required
                    className={cn(
                      'h-full min-w-0 flex-1 bg-transparent pr-3 text-sm outline-none placeholder:text-muted-foreground',
                      username.startsWith('@') ? 'pl-3' : 'pl-0.5',
                    )}
                  />
                  {suffix && (
                    <span className="max-w-[45%] truncate pr-3 text-sm text-muted-foreground">{suffix}</span>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pw">{t('app.password')}</Label>
                <div className="relative">
                  <Input
                    id="pw"
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    className="pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? t('app.hidePassword') : t('app.showPassword')}
                    title={showPw ? t('app.hidePassword') : t('app.showPassword')}
                    className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground hover:text-foreground [&_svg]:size-4"
                  >
                    {showPw ? <EyeOff /> : <Eye />}
                  </button>
                </div>
              </div>
            </>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-3">
            {showPassword && (
              <Button type="submit" className="w-full" disabled={busy || probe.state === 'checking'}>
                {busy ? <Loader2 className="animate-spin" /> : null}
                {busy ? t('app.signingIn') : t('app.signIn')}
                {!busy && <ArrowRight />}
              </Button>
            )}
            {flows?.sso && showPassword && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                {t('app.or')}
                <div className="h-px flex-1 bg-border" />
              </div>
            )}
            {flows?.sso && (
              <Button
                type="button"
                variant={ssoOnly ? 'default' : 'outline'}
                className="w-full"
                onClick={startSso}
              >
                {t('app.signInSso')}
                {ssoOnly && <ArrowRight />}
              </Button>
            )}
          </div>
        </form>

        <p className="mt-5 text-center text-xs text-muted-foreground">{t('app.loginFooter')}</p>
      </div>
    </div>
  );
}

/** Editable server field with preset suggestions (WAI-ARIA combobox pattern). */
function ServerCombobox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [typed, setTyped] = useState(false);

  // Filter only while the user types; opening the list on a chosen value shows all presets.
  const query = value.trim().toLowerCase();
  const options = typed ? PRESETS.filter((p) => p.server.includes(query)) : PRESETS;
  const expanded = open && options.length > 0;

  const choose = (server: string) => {
    onChange(server);
    setTyped(false);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!expanded) {
        setOpen(true);
        setActive(0);
        return;
      }
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + options.length) % options.length);
    } else if (e.key === 'Enter' && expanded) {
      e.preventDefault();
      choose(options[Math.min(active, options.length - 1)].server);
    } else if (e.key === 'Escape' && expanded) {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <Input
        id="hs"
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={expanded ? `${listId}-${active}` : undefined}
        placeholder={t('app.serverPlaceholder')}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setTyped(true);
          setActive(0);
          setOpen(true);
        }}
        onFocus={(e) => {
          e.target.select();
          setTyped(false);
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="pr-9"
        required
      />
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        // Keep focus in the input; toggling happens without a blur.
        onMouseDown={(e) => {
          e.preventDefault();
          document.getElementById('hs')?.focus();
          setTyped(false);
          setOpen((v) => !v);
        }}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={cn('size-4 transition-transform', expanded && 'rotate-180')} />
      </button>

      {expanded && (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg animate-in fade-in-0 zoom-in-95"
        >
          {options.map((p, i) => (
            <li
              key={p.server}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={value.trim() === p.server}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(p.server);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5',
                i === active && 'bg-accent text-accent-foreground',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{p.server}</span>
                <span className="block truncate text-xs text-muted-foreground">{p.description()}</span>
              </span>
              {value.trim() === p.server && <Check className="size-4 shrink-0 text-primary" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ServerStatus({ probe }: { probe: Probe }) {
  if (probe.state === 'idle') return null;
  return (
    <p
      className={cn(
        'flex min-w-0 items-center gap-1.5 text-xs',
        probe.state === 'error' ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      {probe.state === 'checking' && <Loader2 className="size-3 shrink-0 animate-spin" />}
      {probe.state === 'ok' && <Check className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />}
      {probe.state === 'error' && <AlertCircle className="size-3 shrink-0" />}
      <span className="truncate">
        {probe.state === 'checking' && t('app.serverChecking')}
        {probe.state === 'ok' && probe.baseUrl.replace(/^https?:\/\//i, '')}
        {probe.state === 'error' && t('app.serverUnreachable')}
      </span>
    </p>
  );
}
