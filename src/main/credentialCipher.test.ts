/**
 * Credential cipher contract. Uses the *With variants of the encrypt /
 * decrypt helpers so the test doesn't need a real Electron `safeStorage`
 * — we inject a fake one that mirrors the SafeStorage interface.
 */
import { describe, it, expect } from '@jest/globals';
import {
  encryptCredentialWith,
  decryptCredentialWith,
  isEncrypted,
  type SafeStorageLike,
} from './credentialCipher';

/** Reversible XOR cipher so the fake mirrors safeStorage's behavior. */
function makeFakeStorage(opts: { available?: boolean } = {}): SafeStorageLike {
  const available = opts.available ?? true;
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) =>
      Buffer.from(plain.split('').map((c) => c.charCodeAt(0) ^ 0x5a)),
    decryptString: (cipher) =>
      String.fromCharCode(...cipher.map((b) => b ^ 0x5a)),
  };
}

describe('credentialCipher', () => {
  it('encrypts plaintext into the prefixed base64 envelope', () => {
    const storage = makeFakeStorage();
    const out = encryptCredentialWith(storage, 'sk-abcdef-1234');
    expect(out.startsWith('__kshana_enc_v1__')).toBe(true);
    expect(out).not.toContain('sk-abcdef-1234'); // plaintext is gone
    expect(isEncrypted(out)).toBe(true);
  });

  it('round-trips through encrypt -> decrypt', () => {
    const storage = makeFakeStorage();
    const enc = encryptCredentialWith(storage, 'my-real-key');
    expect(decryptCredentialWith(storage, enc)).toBe('my-real-key');
  });

  it('passes empty strings through unchanged in both directions', () => {
    const storage = makeFakeStorage();
    expect(encryptCredentialWith(storage, '')).toBe('');
    expect(decryptCredentialWith(storage, '')).toBe('');
  });

  it('passes legacy plaintext through on decrypt (migration path)', () => {
    const storage = makeFakeStorage();
    // Pre-migration plaintext keys must still be readable so the user
    // doesn't lose their config across the upgrade.
    expect(decryptCredentialWith(storage, 'sk-plaintext-legacy')).toBe(
      'sk-plaintext-legacy',
    );
  });

  it('is idempotent — encrypting an already-encrypted value is a no-op', () => {
    const storage = makeFakeStorage();
    const enc = encryptCredentialWith(storage, 'sk-abc');
    expect(encryptCredentialWith(storage, enc)).toBe(enc);
  });

  it('falls back to plaintext when safeStorage is unavailable on encrypt', () => {
    const storage = makeFakeStorage({ available: false });
    expect(encryptCredentialWith(storage, 'sk-abc')).toBe('sk-abc');
  });

  it('returns empty string when safeStorage is unavailable on decrypt (fail-safe)', () => {
    const storage = makeFakeStorage({ available: false });
    // We can't decrypt an enveloped value without the keyring; treat
    // it as "not configured" rather than leaking ciphertext or crashing.
    expect(
      decryptCredentialWith(storage, '__kshana_enc_v1__YWJj'),
    ).toBe('');
  });

  it('returns empty string when ciphertext is malformed (keychain drift)', () => {
    // Real safeStorage will throw on decrypt of garbage bytes; the
    // fake's decryptString won't throw on arbitrary bytes, so simulate
    // failure with a thrower.
    const throwingStorage: SafeStorageLike = {
      isEncryptionAvailable: () => true,
      encryptString: () => Buffer.from(''),
      decryptString: () => {
        throw new Error('decrypt failed');
      },
    };
    expect(
      decryptCredentialWith(throwingStorage, '__kshana_enc_v1__bad'),
    ).toBe('');
  });

  it('isEncrypted recognizes the prefix and nothing else', () => {
    expect(isEncrypted('__kshana_enc_v1__abc')).toBe(true);
    expect(isEncrypted('sk-plaintext')).toBe(false);
    expect(isEncrypted('')).toBe(false);
    expect(isEncrypted(undefined)).toBe(false);
    expect(isEncrypted(123)).toBe(false);
  });
});
