import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createAdminToken,
  decrypt,
  encrypt,
  maskSecret,
  normalizePrivateKey,
  normalizePublicKey,
  verifyAdminToken,
} from '../src/utils/crypto.js';

describe('crypto', () => {
  it('encrypt/decrypt roundtrip', () => {
    const secret = 'test-encryption-key-32bytes!!!!';
    const plain =
      '-----BEGIN RSA PRIVATE KEY-----\nABC\n-----END RSA PRIVATE KEY-----';
    const enc = encrypt(plain, secret);
    assert.notEqual(enc, plain);
    assert.equal(decrypt(enc, secret), plain);
  });

  it('admin token create/verify', () => {
    const secret = 'session-secret';
    const token = createAdminToken(secret, 'alice', 'jti-abc', 1);
    const ok = verifyAdminToken(token, secret);
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.username, 'alice');
      assert.equal(ok.jti, 'jti-abc');
      assert.equal(ok.passwordVersion, 1);
    }
    assert.equal(verifyAdminToken(token, 'wrong').ok, false);
    assert.equal(verifyAdminToken('garbage', secret).ok, false);
  });

  it('normalize keys', () => {
    const raw = 'MIIEowIBAAKCAQEA0Z3';
    const priv = normalizePrivateKey(raw);
    assert.match(priv, /BEGIN RSA PRIVATE KEY/);
    const pub = normalizePublicKey(raw);
    assert.match(pub, /BEGIN PUBLIC KEY/);
    assert.equal(normalizePrivateKey(priv), priv);
  });

  it('maskSecret', () => {
    assert.equal(maskSecret(''), '');
    assert.equal(maskSecret('abcd'), '****');
    assert.equal(maskSecret('abcdefghijklmnop'), 'abcd****mnop');
  });
});
