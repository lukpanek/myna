import { ClientEvent, type MatrixClient, SyncState } from 'matrix-js-sdk';
import { useEffect, useState } from 'react';
import { ErrorScreen, LoadingScreen } from '@/components/status-screen';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { LoginPage, consumeSsoRedirect } from '@/features/auth/login-page';
import { AppShell } from '@/features/shell/app-shell';
import { type MessageKey, t, useLocale } from '@/i18n';
import { useTraySync, useWebInspectorSync } from '@/lib/native';
import { useApplyTheme } from '@/lib/theme';
import { logout, startClient } from '@/matrix/client';
import { MatrixProvider } from '@/matrix/context';
import { loadSession, type Session } from '@/matrix/session';

type Phase =
  | { kind: 'login' }
  | { kind: 'starting'; message: MessageKey }
  | { kind: 'ready'; client: MatrixClient }
  | { kind: 'error'; message: string };

export function App() {
  useApplyTheme();
  useTraySync();
  useWebInspectorSync();
  // Switching language remounts the UI below (state lives in stores), so every t() call re-runs.
  const locale = useLocale();
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [phase, setPhase] = useState<Phase>(() =>
    session ? { kind: 'starting', message: 'app.connecting' } : { kind: 'login' },
  );

  // Returning from an SSO redirect: finish the login before anything else.
  useEffect(() => {
    consumeSsoRedirect()
      .then((s) => s && setSession(s))
      .catch((err) => setPhase({ kind: 'error', message: String(err?.message ?? err) }));
  }, []);

  useEffect(() => {
    if (!session) {
      setPhase({ kind: 'login' });
      return;
    }
    let alive = true;
    setPhase({ kind: 'starting', message: 'app.connecting' });
    startClient(session)
      .then((client) => {
        if (!alive) return;
        const done = () => alive && setPhase({ kind: 'ready', client });
        const state = client.getSyncState();
        if (state === SyncState.Prepared || state === SyncState.Syncing) {
          done();
          return;
        }
        setPhase({ kind: 'starting', message: 'app.loadingChats' });
        const onSync = (s: SyncState) => {
          if (s === SyncState.Prepared || s === SyncState.Syncing) {
            client.off(ClientEvent.Sync, onSync);
            done();
          } else if (s === SyncState.Error && !alive) {
            client.off(ClientEvent.Sync, onSync);
          }
        };
        client.on(ClientEvent.Sync, onSync);
      })
      .catch((err) => {
        if (alive) setPhase({ kind: 'error', message: String(err?.message ?? err) });
      });
    return () => {
      alive = false;
    };
  }, [session]);

  const handleLogout = async () => {
    await logout();
    setSession(null);
  };

  return (
    <TooltipProvider delayDuration={400}>
      {phase.kind === 'login' && <LoginPage key={locale} onLoggedIn={setSession} />}
      {phase.kind === 'starting' && <LoadingScreen message={t(phase.message)} />}
      {phase.kind === 'error' && <ErrorScreen error={phase.message} onLogout={handleLogout} />}
      {phase.kind === 'ready' && (
        <MatrixProvider value={phase.client}>
          <AppShell key={locale} onLogout={handleLogout} />
        </MatrixProvider>
      )}
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
