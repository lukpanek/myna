import type { VerificationRequest } from 'matrix-js-sdk/lib/crypto-api';
import { create } from 'zustand';
import type { SecretStorageKeyRequest } from '@/matrix/secret-storage';

interface CryptoUiState {
  /** Pending SDK request for the secret storage key (recovery key / passphrase dialog). */
  keyRequest: SecretStorageKeyRequest | null;
  /** Interactive (emoji) verification shown in the verification dialog. */
  verification: VerificationRequest | null;
  /** The recovery flow for this session is running (keeps buttons from starting it twice). */
  verifying: boolean;
}

export const useCryptoUi = create<CryptoUiState>(() => ({
  keyRequest: null,
  verification: null,
  verifying: false,
}));
