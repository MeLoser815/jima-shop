import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';
import { runMigrations } from './migrations.js';
import { shouldSeedSampleData } from './security.js';
import { decrypt, encrypt } from './utils/crypto.js';
import {
  encryptCardSecret,
  hashCardSecret,
} from './utils/cardSecret.js';
import { yuanToFen, fenToYuan } from './money.js';
import { DEFAULT_THEME_ID, isValidThemeId, normalizeThemeId, THEME_PRESETS } from './themes.js';
import { DEFAULT_ADMIN_BASE_PATH, normalizeAdminBasePath } from './adminPath.js';

export type AlipaySettings = {
  appId: string;
  privateKey: string;
  alipayPublicKey: string;
  gateway: string;
  storeId: string;
  notifyUrl: string;
  sellerId: string;
};

export type OrderRow = {
  id: number;
  out_trade_no: string;
  trade_no: string | null;
  subject: string;
  total_amount: string;
  status: string;
  qr_code: string | null;
  buyer_logon_id: string | null;
  buyer_note: string | null;
  raw_notify: string | null;
  fulfillment_status: string;
  created_at: string;
  updated_at: string;
};

export type OrderItemRow = {
  id: number;
  order_id: number;
  product_id: number | null;
  product_name: string;
  cover_url: string;
  unit_price: string;
  quantity: number;
};

export type CategoryRow = {
  id: number;
  name: string;
  slug: string;
  icon: string;
  sort_order: number;
  status: 'on' | 'off';
  created_at: string;
  updated_at: string;
};

export type ProductRow = {
  id: number;
  name: string;
  description: string;
  price: string;
  cover_url: string;
  stock: number;
  status: 'on' | 'off';
  sort_order: number;
  category_id: number | null;
  created_at: string;
  updated_at: string;
};

export type AdminUser = {
  id: number;
  username: string;
  password_hash: string;
  password_version: number;
  created_at: string;
  updated_at: string;
};

export type AdminSession = {
  jti: string;
  username: string;
  password_version: number;
  created_at: string;
  revoked_at: string | null;
};

export class AdminSetupError extends Error {
  constructor(message = '管理员已存在，请直接登录') {
    super(message);
    this.name = 'AdminSetupError';
  }
}

export class ProductDeleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductDeleteError';
  }
}

let db: Database.Database | undefined;

export function tightenDbFilePermissions(dbPath = config.databasePath): void {
  for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      if (fs.existsSync(p)) fs.chmodSync(p, 0o600);
    } catch {
      /* ignore */
    }
  }
}

export function closeDb(): void {
  if (!db) return;
  db.close();
  db = undefined;
}

export function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
    db = new Database(config.databasePath);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
    tightenDbFilePermissions();
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        out_trade_no TEXT NOT NULL UNIQUE,
        trade_no TEXT,
        subject TEXT NOT NULL,
        total_amount TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'CREATED',
        qr_code TEXT,
        buyer_logon_id TEXT,
        buyer_note TEXT,
        raw_notify TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE TABLE IF NOT EXISTS admin_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        icon TEXT NOT NULL DEFAULT '🎁',
        sort_order INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'on',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_categories_status ON categories(status);
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        price TEXT NOT NULL,
        cover_url TEXT NOT NULL DEFAULT '',
        stock INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'on',
        sort_order INTEGER NOT NULL DEFAULT 0,
        category_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY(category_id) REFERENCES categories(id)
      );
      CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
      CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        product_id INTEGER,
        product_name TEXT NOT NULL,
        cover_url TEXT NOT NULL DEFAULT '',
        unit_price TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        FOREIGN KEY(order_id) REFERENCES orders(id)
      );
      CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
      CREATE TABLE IF NOT EXISTS card_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        card_no TEXT,
        secret TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'unused',
        order_id INTEGER,
        order_item_id INTEGER,
        sold_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY(product_id) REFERENCES products(id),
        FOREIGN KEY(order_id) REFERENCES orders(id),
        FOREIGN KEY(order_item_id) REFERENCES order_items(id)
      );
      CREATE INDEX IF NOT EXISTS idx_card_keys_product_status
        ON card_keys(product_id, status);
      CREATE INDEX IF NOT EXISTS idx_card_keys_order ON card_keys(order_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_card_keys_unique
        ON card_keys(product_id, IFNULL(card_no, ''), secret);
    `);
    runMigrations(db);
    tightenDbFilePermissions();
    if (shouldSeedSampleData()) {
      seedCategoriesIfEmpty();
      seedProductsIfEmpty();
      seedDemoCardKeysIfNeeded();
    }
    seedThemeIfEmpty();
  }
  return db;
}

const SAMPLE_CATEGORIES: Array<{
  name: string;
  slug: string;
  icon: string;
  sort_order: number;
}> = [
  { name: '居家治愈', slug: 'home', icon: '🏠', sort_order: 10 },
  { name: '数码周边', slug: 'gadget', icon: '🎧', sort_order: 20 },
  { name: '手帐文具', slug: 'stationery', icon: '✏️', sort_order: 30 },
  { name: '萌系餐具', slug: 'kitchen', icon: '☕', sort_order: 40 },
];

const SAMPLE_PRODUCTS: Array<{
  name: string;
  description: string;
  price: string;
  cover_url: string;
  stock: number;
  status: 'on' | 'off';
  sort_order: number;
  category_slug: string;
}> = [
  {
    name: '草莓奶昔抱枕',
    description:
      '软乎乎的草莓奶昔抱枕，抱着办公摸鱼都治愈～高弹棉填充，可机洗外套。',
    price: '69.90',
    cover_url:
      'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&h=600&fit=crop',
    stock: 48,
    status: 'on',
    sort_order: 10,
    category_slug: 'home',
  },
  {
    name: '星星夜灯',
    description: '温柔星光投射到天花板，睡前仪式感拉满。三档亮度，USB 充电。',
    price: '89.00',
    cover_url:
      'https://images.unsplash.com/photo-1513506003901-1e6a229e2d15?w=600&h=600&fit=crop',
    stock: 32,
    status: 'on',
    sort_order: 20,
    category_slug: 'home',
  },
  {
    name: '云朵耳机套',
    description: '棉花糖般的云朵造型耳机保护套，兼容主流半入耳/入耳耳机。',
    price: '29.90',
    cover_url:
      'https://images.unsplash.com/photo-1484704849700-f032a568e944?w=600&h=600&fit=crop',
    stock: 120,
    status: 'on',
    sort_order: 30,
    category_slug: 'gadget',
  },
  {
    name: '彩虹贴纸包',
    description: '50 张不重复可爱贴纸，手账、电脑、水杯随心贴，防水覆膜。',
    price: '15.80',
    cover_url:
      'https://images.unsplash.com/photo-1513542789411-b6a5d4f31634?w=600&h=600&fit=crop',
    stock: 200,
    status: 'on',
    sort_order: 40,
    category_slug: 'stationery',
  },
  {
    name: '猫爪马克杯',
    description: '粉嫩猫爪造型陶瓷杯，容量 350ml，附同色杯盖，萌系必备。',
    price: '49.00',
    cover_url:
      'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?w=600&h=600&fit=crop',
    stock: 66,
    status: 'on',
    sort_order: 50,
    category_slug: 'kitchen',
  },
  {
    name: '棉花糖蓝牙音箱',
    description: '圆滚滚迷你音箱，柔光氛围灯 + 清亮人声，续航约 8 小时。',
    price: '129.00',
    cover_url:
      'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?w=600&h=600&fit=crop',
    stock: 25,
    status: 'on',
    sort_order: 60,
    category_slug: 'gadget',
  },
];

function seedCategoriesIfEmpty(): void {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS c FROM categories')
    .get() as { c: number };
  if (row.c > 0) return;
  const stmt = getDb().prepare(
    `INSERT INTO categories(name, slug, icon, sort_order, status)
     VALUES(?, ?, ?, ?, 'on')`,
  );
  const tx = getDb().transaction(() => {
    for (const c of SAMPLE_CATEGORIES) {
      stmt.run(c.name, c.slug, c.icon, c.sort_order);
    }
  });
  tx();
  console.info(`[seed] 已写入 ${SAMPLE_CATEGORIES.length} 个示例分类`);
}

function seedThemeIfEmpty(): void {
  if (getSetting('store_theme')) return;
  setSetting('store_theme', 'strawberry');
}

function categoryIdBySlug(slug: string): number | null {
  const row = getDb()
    .prepare('SELECT id FROM categories WHERE slug = ?')
    .get(slug) as { id: number } | undefined;
  return row?.id ?? null;
}

function seedProductsIfEmpty(): void {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS c FROM products')
    .get() as { c: number };
  if (row.c > 0) {
    // 旧库商品可能没有分类：尽量按名称映射一次
    backfillProductCategories();
    return;
  }
  const stmt = getDb().prepare(
    `INSERT INTO products(name, description, price, cover_url, stock, status, sort_order, category_id)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = getDb().transaction(() => {
    for (const p of SAMPLE_PRODUCTS) {
      stmt.run(
        p.name,
        p.description,
        p.price,
        p.cover_url,
        p.stock,
        p.status,
        p.sort_order,
        categoryIdBySlug(p.category_slug),
      );
    }
  });
  tx();
  console.info(`[seed] 已写入 ${SAMPLE_PRODUCTS.length} 个示例商品`);
}

function backfillProductCategories(): void {
  const map: Record<string, string> = {
    草莓奶昔抱枕: 'home',
    星星夜灯: 'home',
    云朵耳机套: 'gadget',
    彩虹贴纸包: 'stationery',
    猫爪马克杯: 'kitchen',
    棉花糖蓝牙音箱: 'gadget',
  };
  const upd = getDb().prepare(
    `UPDATE products SET category_id = ?, updated_at = datetime('now')
     WHERE name = ? AND (category_id IS NULL OR category_id = 0)`,
  );
  for (const [name, slug] of Object.entries(map)) {
    const cid = categoryIdBySlug(slug);
    if (cid) upd.run(cid, name);
  }
}

/** 已有库存但无卡密的演示商品：写入明显伪造的 DEMO- 卡密，库存改为未用卡密数量。 */
function seedDemoCardKeysIfNeeded(): void {
  const d = getDb();
  const products = d
    .prepare('SELECT id, stock FROM products')
    .all() as Array<{ id: number; stock: number }>;
  const countStmt = d.prepare(
    'SELECT COUNT(*) AS c FROM card_keys WHERE product_id = ?',
  );
  const unusedStmt = d.prepare(
    `SELECT COUNT(*) AS c FROM card_keys WHERE product_id = ? AND status = 'unused'`,
  );
  const insert = d.prepare(
    `INSERT OR IGNORE INTO card_keys(product_id, card_no, secret, secret_hash, status)
     VALUES(?, NULL, ?, ?, 'unused')`,
  );
  const updStock = d.prepare(
    `UPDATE products SET stock = ?, updated_at = datetime('now') WHERE id = ?`,
  );
  let created = 0;
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const rand = (n: number) => {
    let s = '';
    for (let i = 0; i < n; i += 1) {
      s += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return s;
  };
  const tx = d.transaction(() => {
    for (const p of products) {
      const existing = (countStmt.get(p.id) as { c: number }).c;
      if (existing > 0) {
        const unused = (unusedStmt.get(p.id) as { c: number }).c;
        updStock.run(unused, p.id);
        continue;
      }
      if (p.stock <= 0) continue;
      for (let i = 1; i <= p.stock; i += 1) {
        const secret = `DEMO-${p.id}-${String(i).padStart(4, '0')}-${rand(6)}`;
        const info = insert.run(
          p.id,
          encryptCardSecret(secret),
          hashCardSecret(secret),
        );
        if (info.changes > 0) created += 1;
      }
      const unused = (unusedStmt.get(p.id) as { c: number }).c;
      updStock.run(unused, p.id);
    }
  });
  tx();
  if (created > 0) {
    console.info(`[seed] 已写入 ${created} 条演示卡密（DEMO- 前缀，仅供测试）`);
  }
}

function getSetting(key: string): string | null {
  const row = getDb()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings(key, value, updated_at)
       VALUES(?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    )
    .run(key, value);
}


export function isAdminBasePathEnvLocked(): boolean {
  return Boolean(process.env.ADMIN_BASE_PATH?.trim());
}

/** 后台前端路径：环境变量优先，否则使用后台保存的值，默认 /admin。 */
export function getAdminBasePath(): string {
  const fromEnv = process.env.ADMIN_BASE_PATH?.trim();
  if (fromEnv) {
    return normalizeAdminBasePath(fromEnv, { strict: true });
  }
  const fromDb = getSetting('admin_base_path')?.trim();
  if (fromDb) {
    return normalizeAdminBasePath(fromDb, { strict: true });
  }
  return DEFAULT_ADMIN_BASE_PATH;
}

export class AdminBasePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminBasePathError';
  }
}

export function updateAdminBasePath(raw: string): string {
  if (isAdminBasePathEnvLocked()) {
    throw new AdminBasePathError(
      '当前后台路径由环境变量 ADMIN_BASE_PATH 锁定，请修改该变量后重启服务。',
    );
  }
  const value = normalizeAdminBasePath(raw, { strict: true });
  setSetting('admin_base_path', value);
  return value;
}

export function saveAlipaySettings(input: {
  appId: string;
  privateKey: string;
  alipayPublicKey: string;
  gateway?: string;
  storeId?: string;
  notifyUrl?: string;
  sellerId?: string;
}): void {
  setSetting('app_id', input.appId.trim());
  setSetting(
    'private_key_enc',
    encrypt(input.privateKey.trim(), config.encryptionKey),
  );
  setSetting(
    'alipay_public_key_enc',
    encrypt(input.alipayPublicKey.trim(), config.encryptionKey),
  );
  if (input.gateway !== undefined) setSetting('gateway', input.gateway.trim());
  if (input.storeId !== undefined) setSetting('store_id', input.storeId.trim());
  if (input.notifyUrl !== undefined)
    setSetting('notify_url', input.notifyUrl.trim());
  if (input.sellerId !== undefined) setSetting('seller_id', input.sellerId.trim());
}

export function loadAlipaySettings(): AlipaySettings | null {
  const appId = getSetting('app_id');
  const privEnc = getSetting('private_key_enc');
  const pubEnc = getSetting('alipay_public_key_enc');
  if (!appId || !privEnc || !pubEnc) return null;
  return {
    appId,
    privateKey: decrypt(privEnc, config.encryptionKey),
    alipayPublicKey: decrypt(pubEnc, config.encryptionKey),
    gateway: getSetting('gateway') || config.gateway,
    storeId: getSetting('store_id') || '',
    notifyUrl: getSetting('notify_url') || config.notifyUrl,
    sellerId: getSetting('seller_id') || '',
  };
}

export function settingsConfigured(): boolean {
  return Boolean(getSetting('app_id') && getSetting('private_key_enc'));
}

export function createOrder(input: {
  outTradeNo: string;
  subject: string;
  totalAmount: string;
  qrCode?: string | null;
  status?: string;
  buyerNote?: string | null;
}): OrderRow {
  getDb()
    .prepare(
      `INSERT INTO orders(out_trade_no, subject, total_amount, status, qr_code, buyer_note)
       VALUES(?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.outTradeNo,
      input.subject,
      input.totalAmount,
      input.status ?? 'WAIT_BUYER_PAY',
      input.qrCode ?? null,
      input.buyerNote ?? null,
    );
  return getOrderByOutTradeNo(input.outTradeNo)!;
}

export function addOrderItems(
  orderId: number,
  items: Array<{
    productId: number | null;
    productName: string;
    coverUrl?: string;
    unitPrice: string;
    quantity: number;
  }>,
): void {
  const stmt = getDb().prepare(
    `INSERT INTO order_items(order_id, product_id, product_name, cover_url, unit_price, quantity)
     VALUES(?, ?, ?, ?, ?, ?)`,
  );
  const tx = getDb().transaction(() => {
    for (const it of items) {
      stmt.run(
        orderId,
        it.productId,
        it.productName,
        it.coverUrl ?? '',
        it.unitPrice,
        it.quantity,
      );
    }
  });
  tx();
}

export function getOrderItems(orderId: number): OrderItemRow[] {
  return getDb()
    .prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC')
    .all(orderId) as OrderItemRow[];
}

export function getOrderByOutTradeNo(outTradeNo: string): OrderRow | null {
  return (
    (getDb()
      .prepare('SELECT * FROM orders WHERE out_trade_no = ?')
      .get(outTradeNo) as OrderRow | undefined) ?? null
  );
}

export function updateOrder(
  outTradeNo: string,
  patch: Partial<{
    trade_no: string;
    status: string;
    qr_code: string;
    buyer_logon_id: string;
    raw_notify: string;
    fulfillment_status: string;
  }>,
): void {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    fields.push(`${k} = ?`);
    values.push(v);
  }
  if (!fields.length) return;
  fields.push(`updated_at = datetime('now')`);
  values.push(outTradeNo);
  getDb()
    .prepare(`UPDATE orders SET ${fields.join(', ')} WHERE out_trade_no = ?`)
    .run(...values);
}


export function listOrders(limit = 50): OrderRow[] {
  return getDb()
    .prepare('SELECT * FROM orders ORDER BY id DESC LIMIT ?')
    .all(limit) as OrderRow[];
}

export function listOrdersWithItems(limit = 50): Array<
  OrderRow & { items: OrderItemRow[] }
> {
  const orders = listOrders(limit);
  return orders.map((o) => ({ ...o, items: getOrderItems(o.id) }));
}

export function getDashboardStats(): {
  productCount: number;
  onSaleCount: number;
  orderCount: number;
  paidCount: number;
  paidAmount: string;
} {
  const d = getDb();
  const productCount = (
    d.prepare('SELECT COUNT(*) AS c FROM products').get() as { c: number }
  ).c;
  const onSaleCount = (
    d
      .prepare(`SELECT COUNT(*) AS c FROM products WHERE status = 'on'`)
      .get() as { c: number }
  ).c;
  const orderCount = (
    d.prepare('SELECT COUNT(*) AS c FROM orders').get() as { c: number }
  ).c;
  const paidRows = d
    .prepare(
      `SELECT total_amount FROM orders
       WHERE status IN ('TRADE_SUCCESS','TRADE_FINISHED','SUCCESS')`,
    )
    .all() as Array<{ total_amount: string }>;
  let paidFen = 0;
  for (const row of paidRows) {
    try {
      paidFen += yuanToFen(row.total_amount);
    } catch {
      /* skip malformed */
    }
  }
  return {
    productCount,
    onSaleCount,
    orderCount,
    paidCount: paidRows.length,
    paidAmount: fenToYuan(paidFen),
  };
}

/* ---------- products ---------- */

export function listProducts(opts?: {
  status?: 'on' | 'off' | 'all';
  categoryId?: number | null;
  limit?: number;
}): ProductRow[] {
  const status = opts?.status ?? 'all';
  const limit = opts?.limit ?? 200;
  const categoryId = opts?.categoryId;
  const where: string[] = [];
  const params: unknown[] = [];
  if (status !== 'all') {
    where.push('status = ?');
    params.push(status);
  }
  if (categoryId != null && Number.isFinite(categoryId)) {
    where.push('category_id = ?');
    params.push(categoryId);
  }
  const sql = `SELECT * FROM products${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY sort_order ASC, id DESC LIMIT ?`;
  params.push(limit);
  return getDb().prepare(sql).all(...params) as ProductRow[];
}

export function getProductById(id: number): ProductRow | null {
  return (
    (getDb()
      .prepare('SELECT * FROM products WHERE id = ?')
      .get(id) as ProductRow | undefined) ?? null
  );
}

export function createProduct(input: {
  name: string;
  description?: string;
  price: string;
  coverUrl?: string;
  stock?: number;
  status?: 'on' | 'off';
  sortOrder?: number;
  categoryId?: number | null;
}): ProductRow {
  const info = getDb()
    .prepare(
      `INSERT INTO products(name, description, price, cover_url, stock, status, sort_order, category_id)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.name.trim(),
      (input.description ?? '').trim(),
      input.price,
      (input.coverUrl ?? '').trim(),
      0, // 库存由未用卡密数量同步，不可手工设定
      input.status ?? 'on',
      input.sortOrder ?? 0,
      input.categoryId ?? null,
    );
  return getProductById(Number(info.lastInsertRowid))!;
}

export function updateProduct(
  id: number,
  patch: Partial<{
    name: string;
    description: string;
    price: string;
    cover_url: string;
    stock: number;
    status: 'on' | 'off';
    sort_order: number;
    category_id: number | null;
  }>,
): ProductRow | null {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (k === 'stock') continue; // 库存只由卡密货源同步
    fields.push(`${k} = ?`);
    values.push(v);
  }
  if (!fields.length) return getProductById(id);
  fields.push(`updated_at = datetime('now')`);
  values.push(id);
  getDb()
    .prepare(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`)
    .run(...values);
  return getProductById(id);
}

export function deleteProduct(id: number): boolean {
  const tx = getDb().transaction(() => {
    const existing = getProductById(id);
    if (!existing) return { changes: 0 };
    const blocked = getDb()
      .prepare(
        `SELECT COUNT(*) AS c FROM card_keys
         WHERE product_id = ? AND status IN ('sold', 'reserved')`,
      )
      .get(id) as { c: number };
    if (blocked.c > 0) {
      throw new ProductDeleteError(
        '该商品存在已售出或预占的卡密，无法删除。请改为下架以保留发货记录。',
      );
    }
    getDb()
      .prepare(`DELETE FROM card_keys WHERE product_id = ?`)
      .run(id);
    return getDb().prepare('DELETE FROM products WHERE id = ?').run(id);
  });
  return tx.immediate().changes > 0;
}

export function countAdmins(): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS c FROM admin_users')
    .get() as { c: number };
  return row.c;
}

export function needsAdminSetup(): boolean {
  return countAdmins() === 0;
}

export function getAdminByUsername(username: string): AdminUser | null {
  return (
    (getDb()
      .prepare('SELECT * FROM admin_users WHERE username = ? COLLATE NOCASE')
      .get(username.trim()) as AdminUser | undefined) ?? null
  );
}

export function createAdminUser(
  username: string,
  passwordHash: string,
): AdminUser {
  const name = username.trim();
  getDb()
    .prepare(
      `INSERT INTO admin_users(username, password_hash, password_version)
       VALUES(?, ?, 1)`,
    )
    .run(name, passwordHash);
  return getAdminByUsername(name)!;
}

export function createFirstAdminUser(
  username: string,
  passwordHash: string,
): AdminUser {
  const run = getDb().transaction(() => {
    if (countAdmins() > 0) {
      throw new AdminSetupError();
    }
    return createAdminUser(username, passwordHash);
  });
  return run.immediate();
}

export function updateAdminPassword(
  username: string,
  passwordHash: string,
): void {
  getDb()
    .prepare(
      `UPDATE admin_users
       SET password_hash = ?,
           password_version = password_version + 1,
           updated_at = datetime('now')
       WHERE username = ? COLLATE NOCASE`,
    )
    .run(passwordHash, username.trim());
}

export function createAdminSession(
  jti: string,
  username: string,
  passwordVersion: number,
): void {
  getDb()
    .prepare(
      `INSERT INTO admin_sessions(jti, username, password_version)
       VALUES(?, ?, ?)`,
    )
    .run(jti, username, passwordVersion);
}

export function getAdminSession(jti: string): AdminSession | null {
  return (
    (getDb()
      .prepare('SELECT * FROM admin_sessions WHERE jti = ?')
      .get(jti) as AdminSession | undefined) ?? null
  );
}

export function revokeAdminSession(jti: string): void {
  getDb()
    .prepare(
      `UPDATE admin_sessions
       SET revoked_at = datetime('now')
       WHERE jti = ? AND revoked_at IS NULL`,
    )
    .run(jti);
}

export function revokeAdminSessionsForUser(username: string): void {
  getDb()
    .prepare(
      `UPDATE admin_sessions
       SET revoked_at = datetime('now')
       WHERE username = ? COLLATE NOCASE AND revoked_at IS NULL`,
    )
    .run(username.trim());
}


/* ---------- categories ---------- */

export function listCategories(opts?: {
  status?: 'on' | 'off' | 'all';
}): CategoryRow[] {
  const status = opts?.status ?? 'all';
  if (status === 'all') {
    return getDb()
      .prepare(`SELECT * FROM categories ORDER BY sort_order ASC, id ASC`)
      .all() as CategoryRow[];
  }
  return getDb()
    .prepare(
      `SELECT * FROM categories WHERE status = ? ORDER BY sort_order ASC, id ASC`,
    )
    .all(status) as CategoryRow[];
}

export function getCategoryById(id: number): CategoryRow | null {
  return (
    (getDb()
      .prepare('SELECT * FROM categories WHERE id = ?')
      .get(id) as CategoryRow | undefined) ?? null
  );
}

export function createCategory(input: {
  name: string;
  slug: string;
  icon?: string;
  sortOrder?: number;
  status?: 'on' | 'off';
}): CategoryRow {
  const info = getDb()
    .prepare(
      `INSERT INTO categories(name, slug, icon, sort_order, status)
       VALUES(?, ?, ?, ?, ?)`,
    )
    .run(
      input.name.trim(),
      input.slug.trim().toLowerCase(),
      (input.icon ?? '🎁').trim() || '🎁',
      input.sortOrder ?? 0,
      input.status ?? 'on',
    );
  return getCategoryById(Number(info.lastInsertRowid))!;
}

export function updateCategory(
  id: number,
  patch: Partial<{
    name: string;
    slug: string;
    icon: string;
    sort_order: number;
    status: 'on' | 'off';
  }>,
): CategoryRow | null {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    fields.push(`${k} = ?`);
    values.push(v);
  }
  if (!fields.length) return getCategoryById(id);
  fields.push(`updated_at = datetime('now')`);
  values.push(id);
  getDb()
    .prepare(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`)
    .run(...values);
  return getCategoryById(id);
}

export function deleteCategory(id: number): boolean {
  // 解除商品关联再删
  const tx = getDb().transaction(() => {
    getDb()
      .prepare('UPDATE products SET category_id = NULL WHERE category_id = ?')
      .run(id);
    return getDb().prepare('DELETE FROM categories WHERE id = ?').run(id);
  });
  return tx().changes > 0;
}

/* ---------- store theme ---------- */

export function getStoreThemeId(): string {
  const raw = getSetting('store_theme') || DEFAULT_THEME_ID;
  const id = normalizeThemeId(raw);
  if (id !== raw && isValidThemeId(id)) {
    setSetting('store_theme', id);
  }
  return isValidThemeId(id) ? id : DEFAULT_THEME_ID;
}

export function setStoreThemeId(id: string): string {
  const normalized = normalizeThemeId(id);
  if (!isValidThemeId(normalized)) {
    throw new Error('无效的主题模板');
  }
  setSetting('store_theme', normalized);
  return normalized;
}

export function listThemePresets() {
  return THEME_PRESETS;
}
