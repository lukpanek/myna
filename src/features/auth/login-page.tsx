import { createClient } from 'matrix-js-sdk';
import { useEffect, useState } from 'react';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { t } from '@/i18n';
import { loginWithPassword, loginWithToken, resolveHomeserver } from '@/matrix/client';
import type { Session } from '@/matrix/session';

const LAST_HS_KEY = 'myna.lastHomeserver';
const SSO_HS_KEY = 'myna.ssoHomeserver';

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

export function LoginPage({ onLoggedIn }: { onLoggedIn: (session: Session) => void }) {
  const [homeserver, setHomeserver] = useState(() => localStorage.getItem(LAST_HS_KEY) ?? '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flows, setFlows] = useState<{ baseUrl: string; password: boolean; sso: boolean } | null>(null);

  // Probe the server's login flows so we only offer what it supports.
  useEffect(() => {
    const value = homeserver.trim();
    if (!value) {
      setFlows(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const baseUrl = await resolveHomeserver(value);
        const res = await createClient({ baseUrl }).loginFlows();
        if (!alive) return;
        const types = res.flows.map((f) => f.type);
        setFlows({ baseUrl, password: types.includes('m.login.password'), sso: types.includes('m.login.sso') });
      } catch {
        if (alive) setFlows(null);
      }
    }, 500);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [homeserver]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await loginWithPassword(homeserver, username, password);
      localStorage.setItem(LAST_HS_KEY, homeserver.trim());
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
    if (!flows) return;
    localStorage.setItem(SSO_HS_KEY, flows.baseUrl);
    localStorage.setItem(LAST_HS_KEY, homeserver.trim());
    const redirect = `${window.location.origin}${window.location.pathname}`;
    window.location.href = createClient({ baseUrl: flows.baseUrl }).getSsoLoginUrl(redirect);
  };

  const showPassword = !flows || flows.password;

  return (
    <div data-tauri-drag-region className="flex h-full items-center justify-center bg-sidebar p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <Logo size={48} className="mb-5" />
          <h1 className="text-2xl font-semibold tracking-tight">{t('app.loginTitle')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('app.loginSubtitle')}</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="hs">{t('app.server')}</Label>
            <Input
              id="hs"
              placeholder="matrix.example.com"
              value={homeserver}
              onChange={(e) => setHomeserver(e.target.value)}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              required
            />
          </div>
          {showPassword && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="user">{t('app.username')}</Label>
                <Input
                  id="user"
                  placeholder={t('app.usernamePlaceholder')}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="username"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pw">{t('app.password')}</Label>
                <Input
                  id="pw"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
            </>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {showPassword && (
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? t('app.signingIn') : t('app.signIn')}
            </Button>
          )}
          {flows?.sso && (
            <Button type="button" variant="outline" className="w-full" onClick={startSso}>
              {t('app.signInSso')}
            </Button>
          )}
        </form>
      </div>
    </div>
  );
}
