import type { MatrixClient } from 'matrix-js-sdk';
import { type CryptoApi, ImportRoomKeyStage } from 'matrix-js-sdk/lib/crypto-api';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { getSecretStorageKey } from '@/matrix/secret-storage';
import { useCryptoUi } from './crypto-store';

export const VERIFY_TOAST_ID = 'verify-session';

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** True when this device is cross-signed by the account; null when crypto is unavailable. */
export async function isSessionVerified(client: MatrixClient): Promise<boolean | null> {
  const crypto = client.getCrypto();
  const deviceId = client.getDeviceId();
  if (!crypto || !deviceId) return null;
  const status = await crypto.getDeviceVerificationStatus(client.getSafeUserId(), deviceId);
  return !!status?.crossSigningVerified;
}

/** The account uses cross-signing but this session has not been verified yet. */
export async function sessionNeedsVerification(client: MatrixClient): Promise<boolean> {
  const crypto = client.getCrypto();
  if (!crypto) return false;
  if (!(await crypto.userHasCrossSigningKeys(client.getSafeUserId(), true))) return false;
  return (await isSessionVerified(client)) === false;
}

/** Starts an emoji verification with another of the user's own devices. */
export async function requestOtherDeviceVerification(client: MatrixClient): Promise<void> {
  const crypto = client.getCrypto();
  if (!crypto) {
    toast.error(t('crypto.cryptoUnavailable'));
    return;
  }
  try {
    const request = await crypto.requestOwnUserVerification();
    useCryptoUi.setState({ verification: request });
  } catch (err) {
    toast.error(t('crypto.requestFailed', { error: errorText(err) }));
  }
}

/**
 * Verifies this session with the recovery key (or passphrase): unlocks secret
 * storage, imports the cross-signing keys (which signs this device) and then
 * restores the message key backup in the background.
 * Without secret storage on the account it falls back to emoji verification.
 */
export async function verifyThisSession(client: MatrixClient): Promise<boolean> {
  const crypto = client.getCrypto();
  if (!crypto) {
    toast.error(t('crypto.cryptoUnavailable'));
    return false;
  }
  if (useCryptoUi.getState().verifying) return false;

  const keyId = await client.secretStorage.getDefaultKeyId().catch(() => null);
  const keyTuple = keyId ? await client.secretStorage.getKey(keyId).catch(() => null) : null;
  if (!keyTuple) {
    toast.info(t('crypto.noRecoveryKey'));
    await requestOtherDeviceVerification(client);
    return false;
  }

  useCryptoUi.setState({ verifying: true });
  try {
    // Goes through the registered prompt (recovery key dialog) unless the key is cached already.
    const key = await getSecretStorageKey({ keys: { [keyTuple[0]]: keyTuple[1] } });
    if (!key) return false;

    const toastId = toast.loading(t('crypto.verifyingSession'));
    try {
      await crypto.bootstrapCrossSigning({});
    } catch (err) {
      toast.error(t('crypto.sessionVerifyFailed', { error: errorText(err) }), { id: toastId });
      return false;
    }
    toast.success(t('crypto.sessionVerified'), { id: toastId });
    toast.dismiss(VERIFY_TOAST_ID);
    void restoreKeyBackup(crypto);
    return true;
  } finally {
    useCryptoUi.setState({ verifying: false });
  }
}

/** Loads the backup key from secret storage and downloads all room keys, with a progress toast. */
async function restoreKeyBackup(crypto: CryptoApi): Promise<void> {
  const info = await crypto.getKeyBackupInfo().catch(() => null);
  if (!info) return;
  const toastId = toast.loading(t('crypto.restoringKeys'));
  try {
    await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
    await crypto.checkKeyBackupAndEnable();
    const result = await crypto.restoreKeyBackup({
      progressCallback: (p) => {
        if (p.stage === ImportRoomKeyStage.LoadKeys && p.total > 0) {
          toast.loading(t('crypto.restoringKeysProgress', { done: p.successes + p.failures, total: p.total }), {
            id: toastId,
          });
        }
      },
    });
    toast.success(t('crypto.keysRestored', { imported: result.imported, total: result.total }), { id: toastId });
  } catch (err) {
    toast.error(t('crypto.keyBackupFailed', { error: errorText(err) }), { id: toastId });
  }
}
