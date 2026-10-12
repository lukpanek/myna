import type { SecretStorage } from 'matrix-js-sdk';
import { decodeRecoveryKey, deriveRecoveryKeyFromPassphrase } from 'matrix-js-sdk/lib/crypto-api';
import { KeyRound } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { t } from '@/i18n';
import { useMatrixClient } from '@/matrix/context';
import type { SecretStorageKeyRequest } from '@/matrix/secret-storage';
import { useCryptoUi } from './crypto-store';
import { requestOtherDeviceVerification } from './verify-session';

/**
 * Asks for the recovery key (or the security passphrase when the key was derived
 * from one) whenever the SDK needs to unlock secret storage.
 */
export function RecoveryKeyDialog() {
  const request = useCryptoUi((s) => s.keyRequest);
  // Remount per request so the form starts empty.
  return request ? <KeyForm key={Object.keys(request.keys).join()} request={request} /> : null;
}

function finish(request: SecretStorageKeyRequest, result: [string, Uint8Array<ArrayBuffer>] | null) {
  request.resolve(result);
  if (useCryptoUi.getState().keyRequest === request) useCryptoUi.setState({ keyRequest: null });
}

function KeyForm({ request }: { request: SecretStorageKeyRequest }) {
  const client = useMatrixClient();
  const [keyId, keyInfo] = Object.entries(request.keys)[0] ?? [];
  // `passphrase` is typed as required, but keys created without a passphrase do not have it.
  const passphrase = keyInfo?.passphrase as SecretStorage.PassphraseInfo | undefined;
  const [mode, setMode] = useState<'key' | 'passphrase'>('key');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!keyId || !keyInfo || !value.trim()) return;
    setBusy(true);
    setError(null);
    try {
      let key: Uint8Array<ArrayBuffer>;
      if (mode === 'passphrase' && passphrase) {
        key = await deriveRecoveryKeyFromPassphrase(value, passphrase.salt, passphrase.iterations, passphrase.bits);
      } else {
        try {
          key = decodeRecoveryKey(value.trim().replace(/\s+/g, ' '));
        } catch {
          setError(t('crypto.invalidRecoveryKey'));
          return;
        }
      }
      if (!(await client.secretStorage.checkKey(key, keyInfo))) {
        setError(mode === 'passphrase' ? t('crypto.wrongPassphrase') : t('crypto.wrongRecoveryKey'));
        return;
      }
      finish(request, [keyId, key]);
    } catch (err) {
      setError(t('crypto.verificationFailed', { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(false);
    }
  };

  const useOtherDevice = () => {
    finish(request, null);
    void requestOtherDeviceVerification(client);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && finish(request, null)}>
      <DialogContent className="sm:max-w-[440px]">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <KeyRound className="size-4" />
              {mode === 'passphrase' ? t('crypto.enterPassphrase') : t('crypto.enterRecoveryKey')}
            </DialogTitle>
            <DialogDescription className="text-[13px]">
              {mode === 'passphrase' ? t('crypto.passphraseDescription') : t('crypto.recoveryKeyDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="recovery-input" className="text-[13px]">
              {mode === 'passphrase' ? t('crypto.passphrase') : t('crypto.recoveryKey')}
            </Label>
            <Input
              id="recovery-input"
              autoFocus
              type={mode === 'passphrase' ? 'password' : 'text'}
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              className={mode === 'key' ? 'font-mono text-[13px]' : undefined}
              aria-invalid={!!error}
            />
            {error && <p className="text-[13px] text-destructive">{error}</p>}
            {passphrase && (
              <button
                type="button"
                className="w-fit text-[13px] text-primary underline-offset-4 hover:underline"
                onClick={() => {
                  setMode(mode === 'key' ? 'passphrase' : 'key');
                  setValue('');
                  setError(null);
                }}
              >
                {mode === 'key' ? t('crypto.usePassphrase') : t('crypto.useRecoveryKey')}
              </button>
            )}
          </div>

          <DialogFooter className="items-center sm:justify-between">
            <Button type="button" variant="link" size="sm" className="px-0" onClick={useOtherDevice}>
              {t('crypto.verifyFromOtherDevice')}
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => finish(request, null)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" size="sm" disabled={busy || !value.trim()}>
                {busy ? t('crypto.verifying') : t('common.next')}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
