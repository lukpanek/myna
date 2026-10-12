import {
  type ShowSasCallbacks,
  type VerificationRequest,
  VerificationPhase,
  VerificationRequestEvent,
  type Verifier,
  VerifierEvent,
} from 'matrix-js-sdk/lib/crypto-api';
import { CircleCheck, CircleX, LoaderCircle, ShieldCheck } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { type MessageKey, t } from '@/i18n';
import { useMatrixClient } from '@/matrix/context';
import { useRerenderOn } from '@/matrix/hooks';
import { useCryptoUi } from './crypto-store';
import { VERIFY_TOAST_ID } from './verify-session';

const SAS_METHOD = 'm.sas.v1';

/** Localized SAS emoji name; the SDK returns the English name from the spec list. */
function emojiName(name: string): string {
  const id = name.toLowerCase().replace(/(?:^|\s+)(\w)/g, (_, c: string) => c.toUpperCase());
  const key = `crypto.sas${id}` as MessageKey;
  const label = t(key);
  return label === key ? name : label;
}

/** Emoji (SAS) verification with another device or user; driven by `useCryptoUi.verification`. */
export function VerificationDialog() {
  const request = useCryptoUi((s) => s.verification);
  return request ? <RequestDialog key={requestKey(request)} request={request} /> : null;
}

const requestKeys = new WeakMap<VerificationRequest, number>();
let nextRequestKey = 0;

/** Stable React key per request object, so a new request starts with fresh dialog state. */
function requestKey(request: VerificationRequest): number {
  let key = requestKeys.get(request);
  if (key === undefined) {
    key = ++nextRequestKey;
    requestKeys.set(request, key);
  }
  return key;
}

function close(request: VerificationRequest) {
  const { phase } = request;
  if (phase !== VerificationPhase.Done && phase !== VerificationPhase.Cancelled) {
    request.cancel().catch(() => undefined);
  }
  if (useCryptoUi.getState().verification === request) useCryptoUi.setState({ verification: null });
}

function useOtherDeviceName(request: VerificationRequest): string | null {
  const client = useMatrixClient();
  const [name, setName] = useState<string | null>(null);
  const deviceId = request.otherDeviceId;
  useEffect(() => {
    if (!request.isSelfVerification || !deviceId) return;
    let alive = true;
    client
      .getDevice(deviceId)
      .then((d) => alive && setName(d.display_name || deviceId))
      .catch(() => alive && setName(deviceId));
    return () => {
      alive = false;
    };
  }, [client, request, deviceId]);
  if (!request.isSelfVerification) return request.otherUserId;
  return name ?? deviceId ?? null;
}

function RequestDialog({ request }: { request: VerificationRequest }) {
  useRerenderOn(request, VerificationRequestEvent.Change);
  const other = useOtherDeviceName(request);
  const [sas, setSas] = useState<ShowSasCallbacks | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const started = useRef<Verifier | null>(null);
  const phase = request.phase;

  // Both sides have to call verify(); it resolves once the exchange is complete.
  const verifier = request.verifier;
  useEffect(() => {
    if (!verifier) return;
    const onSas = (callbacks: ShowSasCallbacks) => setSas(callbacks);
    verifier.on(VerifierEvent.ShowSas, onSas);
    const existing = verifier.getShowSasCallbacks();
    if (existing) setSas(existing);
    if (started.current !== verifier) {
      started.current = verifier;
      verifier.verify().catch(() => undefined);
    }
    return () => {
      verifier.off(VerifierEvent.ShowSas, onSas);
    };
  }, [verifier]);

  useEffect(() => {
    if (phase === VerificationPhase.Done && request.isSelfVerification) {
      toast.dismiss(VERIFY_TOAST_ID);
    }
  }, [phase, request]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.error(t('crypto.verificationFailed', { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(false);
    }
  };

  const who = request.isSelfVerification ? (other ?? t('crypto.otherDevice')) : other;
  let title = t('crypto.sessionVerificationTitle');
  let description = '';
  let body: ReactNode = null;
  let footer: ReactNode = null;

  if (phase === VerificationPhase.Cancelled) {
    title = t('crypto.cancelledTitle');
    description =
      request.cancellationCode === 'm.mismatched_sas'
        ? t('crypto.cancelledMismatch')
        : t('crypto.cancelledGeneric');
    body = <StateIcon icon={CircleX} className="text-destructive" />;
    footer = <Button size="sm" onClick={() => close(request)}>{t('common.close')}</Button>;
  } else if (phase === VerificationPhase.Done) {
    title = t('crypto.doneTitle');
    description = request.isSelfVerification ? t('crypto.doneSelf') : t('crypto.doneUser');
    body = <StateIcon icon={CircleCheck} className="text-primary" />;
    footer = <Button size="sm" onClick={() => close(request)}>{t('common.done')}</Button>;
  } else if (sas?.sas.emoji) {
    title = t('crypto.compareTitle');
    description = request.isSelfVerification
      ? t('crypto.compareSelf')
      : t('crypto.compareUser', { user: who ?? '' });
    body = (
      <div className="grid grid-cols-4 gap-x-2 gap-y-4 py-2 sm:grid-cols-7">
        {sas.sas.emoji.map(([emoji, name], i) => (
          <div key={i} className="flex flex-col items-center gap-1 text-center">
            <span className="text-3xl leading-none">{emoji}</span>
            <span className="text-[11px] text-muted-foreground">{emojiName(name)}</span>
          </div>
        ))}
      </div>
    );
    footer = confirmed ? (
      <WaitingLine text={t('crypto.waitingForOtherSide')} />
    ) : (
      <>
        <Button size="sm" variant="outline" onClick={() => sas.mismatch()}>
          {t('crypto.noMatch')}
        </Button>
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            run(async () => {
              setConfirmed(true);
              await sas.confirm();
            })
          }
        >
          {t('crypto.match')}
        </Button>
      </>
    );
  } else if (phase === VerificationPhase.Requested && !request.initiatedByMe) {
    title = request.isSelfVerification
      ? t('crypto.incomingSelfTitle', { device: who ?? '' })
      : t('crypto.incomingUserTitle', { user: who ?? '' });
    description = request.isSelfVerification ? t('crypto.incomingSelf') : t('crypto.incomingUser');
    body = <StateIcon icon={ShieldCheck} className="text-muted-foreground" />;
    footer = (
      <>
        <Button size="sm" variant="outline" onClick={() => close(request)}>
          {t('crypto.decline')}
        </Button>
        <Button size="sm" disabled={busy || request.accepting} onClick={() => run(() => request.accept())}>
          {t('crypto.accept')}
        </Button>
      </>
    );
  } else if (phase === VerificationPhase.Requested || phase === VerificationPhase.Unsent) {
    title = t('crypto.otherDeviceTitle');
    description = t('crypto.otherDeviceDescription');
    body = <WaitingLine text={t('crypto.waitingForDevice')} />;
    footer = (
      <Button size="sm" variant="outline" onClick={() => close(request)}>
        {t('common.cancel')}
      </Button>
    );
  } else if (phase === VerificationPhase.Ready) {
    title = t('crypto.readyTitle');
    description = request.otherPartySupportsMethod(SAS_METHOD)
      ? request.isSelfVerification
        ? t('crypto.readySelf')
        : t('crypto.readyUser')
      : t('crypto.sasUnsupported');
    body = <StateIcon icon={ShieldCheck} className="text-muted-foreground" />;
    footer = (
      <>
        <Button size="sm" variant="outline" onClick={() => close(request)}>
          {t('common.cancel')}
        </Button>
        <Button
          size="sm"
          disabled={busy || !request.otherPartySupportsMethod(SAS_METHOD)}
          onClick={() => run(() => request.startVerification(SAS_METHOD))}
        >
          {t('crypto.compareEmoji')}
        </Button>
      </>
    );
  } else {
    // Started, waiting for the SAS keys to be exchanged.
    body = <WaitingLine text={t('crypto.preparingEmoji')} />;
    footer = (
      <Button size="sm" variant="outline" onClick={() => close(request)}>
        {t('common.cancel')}
      </Button>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && close(request)}>
      <DialogContent className="sm:max-w-[480px]" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="text-base">{title}</DialogTitle>
          {description && <DialogDescription className="text-[13px]">{description}</DialogDescription>}
        </DialogHeader>
        {body}
        <DialogFooter>{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StateIcon({ icon: Icon, className }: { icon: typeof ShieldCheck; className?: string }) {
  return (
    <div className="flex justify-center py-2">
      <Icon className={`size-10 ${className ?? ''}`} strokeWidth={1.5} />
    </div>
  );
}

function WaitingLine({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-2 text-[13px] text-muted-foreground">
      <LoaderCircle className="size-4 animate-spin" />
      {text}
    </div>
  );
}
