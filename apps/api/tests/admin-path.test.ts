import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_ADMIN_BASE_PATH,
  injectAdminBasePath,
  normalizeAdminBasePath,
} from '../src/adminPath.js';

describe('normalizeAdminBasePath', () => {
  it('defaults to /admin when empty', () => {
    assert.equal(normalizeAdminBasePath(undefined), DEFAULT_ADMIN_BASE_PATH);
    assert.equal(normalizeAdminBasePath(''), '/admin');
    assert.equal(normalizeAdminBasePath('   '), '/admin');
  });

  it('adds a leading slash and strips trailing slashes', () => {
    assert.equal(normalizeAdminBasePath('admin'), '/admin');
    assert.equal(normalizeAdminBasePath('/my-admin/'), '/my-admin');
    assert.equal(normalizeAdminBasePath('/Demo123'), '/Demo123');
  });

  it('rejects reserved or illegal paths in strict mode', () => {
    assert.throws(() => normalizeAdminBasePath('/api', { strict: true }), /保留路径/);
    assert.throws(() => normalizeAdminBasePath('/cart', { strict: true }), /保留路径/);
    assert.throws(() => normalizeAdminBasePath('/cashier', { strict: true }), /保留路径/);
    assert.throws(() => normalizeAdminBasePath('/', { strict: true }), /根路径/);
    assert.throws(
      () => normalizeAdminBasePath('/admin/extra', { strict: true }),
      /单个路径段/,
    );
    assert.throws(
      () => normalizeAdminBasePath('/admin?x=1', { strict: true }),
      /单个路径段/,
    );
  });

  it('falls back instead of throwing when not strict', () => {
    assert.equal(normalizeAdminBasePath('/api'), '/admin');
    assert.equal(normalizeAdminBasePath('/admin/extra'), '/admin');
  });
});

describe('injectAdminBasePath', () => {
  it('injects a script into <head>', () => {
    const html = '<!doctype html><html><head><title>店</title></head><body></body></html>';
    const out = injectAdminBasePath(html, '/my-admin');
    assert.match(out, /<head><script>window\.__JIMA_ADMIN_BASE_PATH__="\/my-admin";<\/script>/);
  });
});
