import crypto from 'node:crypto';
import { config } from '../config.js';
import { decrypt, encrypt } from './crypto.js';

export const CARD_SECRET_PREFIX = 'enc:v1:';

export function hashCardSecret(plain: string): string {
  return crypto.createHash('sha256').update(plain, 'utf8').digest('hex');
}

export function encryptCardSecret(plain: string): string {
  return CARD_SECRET_PREFIX + encrypt(plain, config.encryptionKey);
}

export function decryptCardSecret(stored: string): string {
  if (stored.startsWith(CARD_SECRET_PREFIX)) {
    return decrypt(stored.slice(CARD_SECRET_PREFIX.length), config.encryptionKey);
  }
  return stored;
}

export function isEncryptedCardSecret(stored: string): boolean {
  return stored.startsWith(CARD_SECRET_PREFIX);
}
