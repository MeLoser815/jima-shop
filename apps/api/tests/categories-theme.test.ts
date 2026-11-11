import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const tmpDb = path.join(os.tmpdir(), `jima-cat-theme-${Date.now()}.db`);
process.env.DATABASE_PATH = tmpDb;
process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key-32bytes!!!!';
process.env.SESSION_SECRET = 'test-session-secret';

const {
  getDb,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  createProduct,
  listProducts,
  getStoreThemeId,
  setStoreThemeId,
  listThemePresets,
} = await import('../src/db.js');
const { normalizeThemeId, isValidThemeId } = await import('../src/themes.js');

describe('categories & theme', () => {
  before(() => {
    getDb();
  });

  after(() => {
    for (const p of [tmpDb, tmpDb + '-wal', tmpDb + '-shm']) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  });

  it('seeds categories and default theme', () => {
    const cats = listCategories({ status: 'on' });
    assert.ok(cats.length >= 4);
    assert.equal(getStoreThemeId(), 'strawberry');
    assert.ok(listThemePresets().length >= 4);
  });

  it('CRUD category and filter products', () => {
    const c = createCategory({
      name: '测试分类',
      slug: 'test-cat',
      icon: '🧪',
      sortOrder: 99,
    });
    assert.equal(c.slug, 'test-cat');
    const updated = updateCategory(c.id, { name: '测试分类改' });
    assert.equal(updated?.name, '测试分类改');

    const p = createProduct({
      name: '分类商品',
      price: '1.00',
      stock: 1,
      categoryId: c.id,
    });
    const filtered = listProducts({ status: 'on', categoryId: c.id });
    assert.ok(filtered.some((x) => x.id === p.id));

    assert.equal(deleteCategory(c.id), true);
    const after = listProducts({ status: 'all' }).find((x) => x.id === p.id);
    assert.equal(after?.category_id, null);
  });

  it('switches theme presets', () => {
    assert.equal(setStoreThemeId('guofeng'), 'guofeng');
    assert.equal(getStoreThemeId(), 'guofeng');
    assert.equal(setStoreThemeId('angel'), 'angel');
    assert.throws(() => setStoreThemeId('nope'));
  });

  it('aliases legacy cyber to angel', () => {
    assert.equal(normalizeThemeId('cyber'), 'angel');
    assert.equal(isValidThemeId('cyber'), true);
    assert.equal(isValidThemeId('angel'), true);
    assert.ok(listThemePresets().some((p) => p.id === 'angel'));
    assert.ok(!listThemePresets().some((p) => p.id === 'cyber'));
  });
});
