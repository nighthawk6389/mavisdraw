import { describe, it, expect, beforeAll } from 'vitest';
import { encrypt, decrypt, generateEncryptionKey } from '../utils/encryption.js';

describe('encryption', () => {
  beforeAll(() => {
    // Set a test encryption key (32 bytes = 64 hex chars)
    process.env.GITHUB_TOKEN_ENCRYPTION_KEY = generateEncryptionKey();
  });

  it('encrypts and decrypts a string round-trip', () => {
    const plaintext = 'gho_abc123def456';
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted).toContain(':');

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertext for same input (random IV)', () => {
    const plaintext = 'test-token-12345';
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a).not.toBe(b);

    expect(decrypt(a)).toBe(plaintext);
    expect(decrypt(b)).toBe(plaintext);
  });

  it('throws on invalid encrypted format', () => {
    expect(() => decrypt('not-valid')).toThrow('Invalid encrypted value format');
  });

  it('throws on tampered ciphertext', () => {
    const encrypted = encrypt('secret');
    const parts = encrypted.split(':');
    // Tamper with the ciphertext
    parts[2] = '00' + parts[2].slice(2);
    expect(() => decrypt(parts.join(':'))).toThrow();
  });

  it('generates a 64-char hex key', () => {
    const key = generateEncryptionKey();
    expect(key).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(key)).toBe(true);
  });
});
