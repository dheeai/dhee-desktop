/**
 * Credential encryption for kshana-settings.
 *
 * `electron-store` writes settings as plaintext JSON at
 * `~/Library/Application Support/kshana/kshana-settings.json` (and the
 * Windows / Linux equivalents). Anything that lives in there — including
 * the user's paid OpenAI / Gemini / OpenRouter / ComfyUI-Cloud API keys
 * — is readable by every other process on the box. That's a security
 * regression for a desktop app that ships to non-developers.
 *
 * `electron.safeStorage` exposes an OS-keychain-backed cipher
 * (Keychain on macOS, DPAPI on Windows, libsecret on most Linux DEs).
 * We use it to encrypt credential fields before they hit the store
 * and decrypt them on read. Other fields (URLs, model names, theme
 * preferences, etc.) stay plaintext — they're not sensitive and
 * keeping them readable simplifies debugging.
 *
 * On disk, an encrypted credential looks like:
 *   "__kshana_enc_v1__<base64-ciphertext>"
 *
 * The prefix lets us cleanly detect legacy plaintext values and migrate
 * them on next save. Versioned so a future cipher swap (e.g. envelope
 * encryption with a per-machine key) can coexist with v1 readers during
 * rollout.
 *
 * Graceful degradation: if `safeStorage.isEncryptionAvailable()`
 * returns false (rare — Linux with no keyring service, headless CI),
 * we keep the value plaintext and emit a one-time warning. Better than
 * crashing the user's settings flow.
 */
import { safeStorage } from 'electron';
import log from 'electron-log';

const ENC_PREFIX = '__kshana_enc_v1__';

/**
 * Settings fields that hold credentials and must be encrypted at rest.
 * Keep in sync with `AppSettings` in shared/settingsTypes.ts.
 *
 * Top-level fields. Nested credentials (inside llmTierMedium /
 * llmTierLight) are handled by `encryptTierConfig`.
 */
export const TOP_LEVEL_CREDENTIAL_FIELDS = [
  'comfyCloudApiKey',
  'googleApiKey',
  'openaiApiKey',
  'vlmApiKey',
] as const;

/** Per-tier credentials nested inside llmTierMedium / llmTierLight. */
export const TIER_CREDENTIAL_FIELDS = ['openaiApiKey', 'googleApiKey'] as const;

export type CredentialField = (typeof TOP_LEVEL_CREDENTIAL_FIELDS)[number];

let warnedUnavailable = false;

function warnEncryptionUnavailable(): void {
  if (warnedUnavailable) return;
  warnedUnavailable = true;
  log.warn(
    '[credentialCipher] safeStorage encryption is unavailable on this platform — API keys will remain stored as plaintext. This usually means the OS keyring service is missing (common on minimal Linux installs / headless CI).',
  );
}

/** True when the value is a non-empty string encrypted with our prefix. */
export function isEncrypted(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX);
}

/**
 * Encrypt a plaintext credential. Empty strings pass through unchanged
 * (no point encrypting nothing, and downstream code uses `!key` to
 * detect missing credentials).
 *
 * If safeStorage is unavailable, returns the plaintext and logs a
 * one-time warning — graceful degradation.
 */
export function encryptCredential(plain: string): string {
  if (plain === '') return '';
  if (!safeStorage.isEncryptionAvailable()) {
    warnEncryptionUnavailable();
    return plain;
  }
  if (isEncrypted(plain)) return plain; // already encrypted, idempotent
  const encrypted = safeStorage.encryptString(plain);
  return ENC_PREFIX + encrypted.toString('base64');
}

/**
 * Decrypt a credential field for in-memory use. Plaintext / empty
 * values pass through unchanged. If decryption fails (e.g. user
 * migrated machines and the keychain entry is gone), returns '' so
 * the caller treats it as "not configured" rather than crashing on a
 * malformed string.
 */
export function decryptCredential(stored: string): string {
  if (stored === '') return '';
  if (!isEncrypted(stored)) return stored; // legacy plaintext
  if (!safeStorage.isEncryptionAvailable()) {
    warnEncryptionUnavailable();
    return '';
  }
  try {
    const ciphertext = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64');
    return safeStorage.decryptString(ciphertext);
  } catch (err) {
    log.warn(
      `[credentialCipher] Failed to decrypt credential (likely keychain-migration drift): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return '';
  }
}

/** Pure-function variant of the same helpers, parameterized for tests. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(cipher: Buffer): string;
}

export function encryptCredentialWith(
  storage: SafeStorageLike,
  plain: string,
): string {
  if (plain === '') return '';
  if (!storage.isEncryptionAvailable()) return plain;
  if (isEncrypted(plain)) return plain;
  return ENC_PREFIX + storage.encryptString(plain).toString('base64');
}

export function decryptCredentialWith(
  storage: SafeStorageLike,
  stored: string,
): string {
  if (stored === '') return '';
  if (!isEncrypted(stored)) return stored;
  if (!storage.isEncryptionAvailable()) return '';
  try {
    const ciphertext = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64');
    return storage.decryptString(ciphertext);
  } catch {
    return '';
  }
}
