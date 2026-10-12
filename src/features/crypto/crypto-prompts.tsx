import { CryptoEvent, type VerificationRequest, VerificationPhase } from 'matrix-js-sdk/lib/crypto-api';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { useEmitterEvent, useMatrixClient } from '@/matrix/context';
import { setSecretStorageKeyPrompt } from '@/matrix/secret-storage';
import { useCryptoUi } from './crypto-store';
import { RecoveryKeyDialog } from './recovery-key-dialog';
import { VerificationDialog } from './verification-dialog';
import { sessionNeedsVerification, VERIFY_TOAST_ID, verifyThisSession } from './verify-session';

/**
 * App-wide encryption UI: the recovery key prompt the SDK calls into, the
 * "verify this session" reminder and incoming emoji verification requests.
 * Mounted once in the shell.
 */
export function CryptoPrompts() {
  const client = useMatrixClient();

  useEffect(() => {
    setSecretStorageKeyPrompt((req) => {
      // A newer request supersedes an unanswered one; the old caller gets null.
      useCryptoUi.getState().keyRequest?.resolve(null);
      useCryptoUi.setState({ keyRequest: req });
    });
    return () => {
      setSecretStorageKeyPrompt(null);
      useCryptoUi.getState().keyRequest?.resolve(null);
      useCryptoUi.setState({ keyRequest: null, verification: null });
    };
  }, []);

  // Reminder toast while this session is unverified; re-checked whenever trust changes.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = () => {
      sessionNeedsVerification(client)
        .then((needed) => {
          if (!alive) return;
          if (!needed) {
            toast.dismiss(VERIFY_TOAST_ID);
            return;
          }
          if (useCryptoUi.getState().verifying) return;
          toast(t('crypto.verifyReminder'), {
            id: VERIFY_TOAST_ID,
            duration: Infinity,
            action: {
              label: t('crypto.verifyAction'),
              onClick: () => {
                void verifyThisSession(client).finally(() => schedule(500));
              },
            },
          });
        })
        .catch(() => undefined);
    };
    const schedule = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(check, ms);
    };
    // Give the first /keys/query a moment so the toast does not flash for verified sessions.
    schedule(2000);

    const onChange = () => schedule(300);
    client.on(CryptoEvent.KeysChanged, onChange);
    client.on(CryptoEvent.UserTrustStatusChanged, onChange);
    client.on(CryptoEvent.DevicesUpdated, onChange);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      client.off(CryptoEvent.KeysChanged, onChange);
      client.off(CryptoEvent.UserTrustStatusChanged, onChange);
      client.off(CryptoEvent.DevicesUpdated, onChange);
      toast.dismiss(VERIFY_TOAST_ID);
    };
  }, [client]);

  useEmitterEvent(client, CryptoEvent.VerificationRequestReceived, (request: VerificationRequest) => {
    const current = useCryptoUi.getState().verification;
    const busy =
      current && current.phase !== VerificationPhase.Done && current.phase !== VerificationPhase.Cancelled;
    if (busy) return;
    useCryptoUi.setState({ verification: request });
  });

  return (
    <>
      <RecoveryKeyDialog />
      <VerificationDialog />
    </>
  );
}
