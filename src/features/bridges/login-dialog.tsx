import { ChevronRight, CircleAlert, CircleCheck, LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { NetworkIcon } from '@/components/mx-avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { t } from '@/i18n';
import { loginDisplayName } from './bridge-format';
import { CookiesStep, DisplayAndWaitStep, Instructions, UserInputStep } from './login-steps';
import { describeError, isAbortError, ProvisioningError } from './provisioning';
import type { LoginFlow, LoginStep, LoginStepResponse, SubmittableStepType } from './types';
import { provisioningClient, useBridges } from './use-bridges';

export interface LoginTarget {
  url: string;
  /** Existing login to re-authenticate (`?login_id=`). */
  reloginId?: string;
}

/** "Přidat účet" / "Znovu přihlásit": runs a bridgev2 login process step by step. */
export function LoginDialog({ target, onClose }: { target: LoginTarget | null; onClose: () => void }) {
  const entry = useBridges((s) => (target ? s.bridges[target.url] : undefined));
  const network = entry?.whoami?.network;
  const reloginName = useBridges((s) => {
    if (!target?.reloginId) return undefined;
    const login = s.bridges[target.url]?.whoami?.logins?.find((l) => l.id === target.reloginId);
    return login ? loginDisplayName(login) : undefined;
  });
  const name = network?.displayname ?? t('bridges.genericBridge');

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            {network && (
              <NetworkIcon networkId={network.network_id} avatarMxc={network.network_icon} name={name} size={22} />
            )}
            {target?.reloginId ? t('bridges.reloginTitle', { name }) : t('bridges.loginTitle', { name })}
          </DialogTitle>
          <DialogDescription className={reloginName ? undefined : 'sr-only'}>
            {reloginName ? t('bridges.accountName', { name: reloginName }) : t('bridges.connectAccount', { name })}
          </DialogDescription>
        </DialogHeader>
        {target && entry?.whoami && (
          <LoginFlowView key={`${target.url}|${target.reloginId ?? ''}`} target={target} networkName={name} onClose={onClose} />
        )}
        {target && !entry?.whoami && (
          <p className="text-sm text-muted-foreground">{t('bridges.bridgeNotReady')}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

type Phase =
  | { kind: 'pick' }
  | { kind: 'starting' }
  | { kind: 'step'; step: LoginStep }
  | { kind: 'done'; loginId?: string }
  | { kind: 'error'; message: string };

/** Errors after which repeating the same request is safe (txn_id makes the bridge dedupe it). */
function isRetryable(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  return err instanceof ProvisioningError && !err.errcode && [502, 503, 504].includes(err.status ?? 0);
}

function LoginFlowView({
  target,
  networkName,
  onClose,
}: {
  target: LoginTarget;
  networkName: string;
  onClose: () => void;
}) {
  const flows = useBridges((s) => s.bridges[target.url]?.whoami?.login_flows) ?? [];
  const [phase, setPhase] = useState<Phase>(() => (flows.length === 1 ? { kind: 'starting' } : { kind: 'pick' }));
  const [busy, setBusy] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const processRef = useRef<string | null>(null);
  const finishedRef = useRef(false);
  const backingRef = useRef(false);

  const client = provisioningClient(useBridges.getState().bridges[target.url]);

  // One controller per mounted flow; unmounting (dialog closed) aborts requests and cancels the process.
  useEffect(() => {
    const ac = new AbortController();
    abortRef.current = ac;
    return () => {
      ac.abort();
      const processId = processRef.current;
      if (processId && !finishedRef.current) client.cancelLogin(processId).catch(() => undefined);
      processRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleResponse = useCallback(
    (resp: LoginStepResponse) => {
      if (abortRef.current?.signal.aborted) return;
      processRef.current = resp.login_id;
      setBusy(false);
      if (resp.type === 'complete') {
        finishedRef.current = true;
        setPhase({ kind: 'done', loginId: resp.complete?.user_login_id });
        const { refreshBridge } = useBridges.getState();
        void refreshBridge(target.url);
        // Bridge state (CONNECTED) usually arrives a moment after the login completes.
        setTimeout(() => void useBridges.getState().refreshBridge(target.url), 3000);
        return;
      }
      setPhase({ kind: 'step', step: resp });
    },
    [target.url],
  );

  const handleFatal = useCallback((err: unknown) => {
    if (isAbortError(err) || abortRef.current?.signal.aborted) return;
    setBusy(false);
    // The bridge drops the process after an error; nothing left to cancel.
    finishedRef.current = true;
    setPhase({ kind: 'error', message: describeError(err) });
  }, []);

  const start = useCallback(
    (flow: LoginFlow) => {
      const signal = abortRef.current?.signal;
      // Restarting after an error: forget the old process.
      if (processRef.current && !finishedRef.current) client.cancelLogin(processRef.current).catch(() => undefined);
      processRef.current = null;
      finishedRef.current = false;
      setPhase({ kind: 'starting' });
      client.startLogin(flow.id, target.reloginId, signal).then(handleResponse, handleFatal);
    },
    [client, target.reloginId, handleResponse, handleFatal],
  );

  // Single-flow bridges skip the picker.
  useEffect(() => {
    if (flows.length === 1 && phase.kind === 'starting' && !processRef.current) start(flows[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (type: SubmittableStepType, params: Record<string, string>) => {
    if (phase.kind !== 'step' || !processRef.current) return;
    setBusy(true);
    client
      .submitStep(processRef.current, phase.step, type, params, abortRef.current?.signal)
      // bridgev2 treats every step error as fatal and drops the process; the error view offers a restart.
      .then(handleResponse, handleFatal);
  };

  const back = () => {
    if (phase.kind !== 'step' || !processRef.current) return;
    backingRef.current = true;
    setBusy(true);
    client
      .cancelStep(processRef.current, phase.step, abortRef.current?.signal)
      .then(handleResponse, handleFatal)
      .finally(() => {
        backingRef.current = false;
      });
  };

  // display_and_wait: long-poll until the bridge moves on (new QR, next step or complete).
  const waitStep = phase.kind === 'step' && phase.step.type === 'display_and_wait' ? phase.step : null;
  useEffect(() => {
    if (!waitStep) return;
    let stopped = false;
    let retries = 0;
    // Own controller so a re-run (StrictMode, new step) never leaves two polls hanging.
    const local = new AbortController();
    const parent = abortRef.current?.signal;
    const onParentAbort = () => local.abort();
    parent?.addEventListener('abort', onParentAbort);
    const poll = () => {
      const processId = processRef.current;
      if (!processId || stopped) return;
      client.submitStep(processId, waitStep, 'display_and_wait', {}, local.signal).then(
        (resp) => !stopped && handleResponse(resp),
        (err) => {
          if (stopped || isAbortError(err)) return;
          if (backingRef.current || (err instanceof ProvisioningError && err.errcode === 'FI.MAU.LOGIN_STEP_CANCELLED')) return;
          // Reverse proxies often cut long requests; the txn_id makes a retry safe.
          if (isRetryable(err) && retries < 30) {
            retries++;
            setTimeout(poll, 1500);
            return;
          }
          handleFatal(err);
        },
      );
    };
    poll();
    return () => {
      stopped = true;
      local.abort();
      parent?.removeEventListener('abort', onParentAbort);
    };
  }, [waitStep, client, handleResponse, handleFatal]);

  // Close shortly after success; the user sees the confirmation first.
  useEffect(() => {
    if (phase.kind !== 'done') return;
    const timer = setTimeout(onClose, 2500);
    return () => clearTimeout(timer);
  }, [phase.kind, onClose]);

  if (phase.kind === 'pick') {
    if (flows.length === 0) {
      return <p className="text-sm text-muted-foreground">{t('bridges.noLoginFlows')}</p>;
    }
    return (
      <div className="grid gap-2">
        <p className="text-sm text-muted-foreground">{t('bridges.pickFlow')}</p>
        <div className="-mx-2 grid">
          {flows.map((flow) => (
            <button
              key={flow.id}
              onClick={() => start(flow)}
              className="flex items-center gap-3 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{flow.name}</span>
                {flow.description && <span className="block text-xs text-muted-foreground">{flow.description}</span>}
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (phase.kind === 'starting') {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        {t('bridges.startingLogin')}
      </div>
    );
  }

  if (phase.kind === 'error') {
    return (
      <div className="grid gap-4">
        <div className="flex gap-2.5 text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p className="whitespace-pre-wrap">{phase.message}</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button onClick={() => (flows.length === 1 ? start(flows[0]) : setPhase({ kind: 'pick' }))}>{t('common.retry')}</Button>
        </div>
      </div>
    );
  }

  if (phase.kind === 'done') {
    return <DoneView url={target.url} loginId={phase.loginId} onClose={onClose} />;
  }

  const { step } = phase;
  return (
    <div className="grid gap-3">
      {step.type === 'user_input' && (
        <UserInputStep
          key={`${step.step_id}|${step.txn_id ?? ''}`}
          params={step.user_input}
          instructions={step.instructions}
          busy={busy}
          onSubmit={(values) => submit('user_input', values)}
          onBack={step.user_input.can_cancel ? back : undefined}
        />
      )}
      {step.type === 'cookies' && (
        <CookiesStep
          key={`${step.step_id}|${step.txn_id ?? ''}`}
          params={step.cookies}
          instructions={step.instructions}
          networkName={networkName}
          busy={busy}
          onSubmit={(values) => submit('cookies', values)}
        />
      )}
      {step.type === 'display_and_wait' && (
        <DisplayAndWaitStep
          params={step.display_and_wait}
          instructions={step.instructions}
          onBack={step.display_and_wait.can_cancel ? back : undefined}
        />
      )}
      {(step.type === 'webauthn' || step.type === 'client_http') && (
        <div className="grid gap-3">
          <Instructions text={step.instructions} />
          <p className="text-sm">
            {t('bridges.unsupportedStep')}
          </p>
        </div>
      )}
    </div>
  );
}

function DoneView({ url, loginId, onClose }: { url: string; loginId?: string; onClose: () => void }) {
  const name = useBridges((s) => {
    const login = s.bridges[url]?.whoami?.logins?.find((l) => l.id === loginId);
    return login ? loginDisplayName(login) : undefined;
  });
  return (
    <div className="grid justify-items-center gap-3 py-6 text-center">
      <CircleCheck className="size-10 text-emerald-500" />
      <p className="text-base font-medium">
        {name ? t('bridges.doneNamed', { name }) : t('bridges.done')}
      </p>
      <p className="text-sm text-muted-foreground">{t('bridges.chatsAppearSoon')}</p>
      <Button variant="outline" onClick={onClose} className="mt-1">
        {t('common.close')}
      </Button>
    </div>
  );
}
