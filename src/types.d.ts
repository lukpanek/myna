declare module 'browser-encrypt-attachment' {
  export interface EncryptInfo {
    v: string;
    key: { alg: string; key_ops: string[]; kty: string; k: string; ext: boolean };
    iv: string;
    hashes: Record<string, string>;
  }
  export function encryptAttachment(plaintext: ArrayBuffer): Promise<{ data: ArrayBuffer; info: EncryptInfo }>;
  export function decryptAttachment(ciphertext: ArrayBuffer, info: EncryptInfo): Promise<ArrayBuffer>;
}
