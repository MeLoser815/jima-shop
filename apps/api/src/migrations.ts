
import type Database from 'better-sqlite3';
import {
  encryptCardSecret,
  hashCardSecret,
  isEncryptedCardSecret,
} from './utils/cardSecret.js';

type Migration = {
  id: number;
  name: string;
  up: (db: Database.Database) => void;
};

function columnExists(
  db: Database.Database,
  table: string,
  column: string,
): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  return cols.some((c) => c.name === column);
}

function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  type: string,
): void {
  if (!columnExists(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'legacy_columns',
    up(db) {
      ensureColumn(db, 'orders', 'buyer_note', 'TEXT');
      ensureColumn(db, 'products', 'category_id', 'INTEGER');
      ensureColumn(db, 'orders', 'fulfillment_status', "TEXT NOT NULL DEFAULT ''");
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id)`,
      );
    },
  },
  {
    id: 2,
    name: 'card_key_reservations_and_encryption',
    up(db) {
      ensureColumn(db, 'card_keys', 'reserved_until', 'TEXT');
      ensureColumn(db, 'card_keys', 'secret_hash', 'TEXT');

      const rows = db
        .prepare('SELECT id, secret, secret_hash FROM card_keys')
        .all() as Array<{ id: number; secret: string; secret_hash: string | null }>;
      const upd = db.prepare(
        `UPDATE card_keys SET secret = ?, secret_hash = ? WHERE id = ?`,
      );
      for (const row of rows) {
        if (!isEncryptedCardSecret(row.secret)) {
          const plain = row.secret;
          upd.run(encryptCardSecret(plain), hashCardSecret(plain), row.id);
        }
      }

      db.exec(`DROP INDEX IF EXISTS idx_card_keys_unique`);
      db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_card_keys_unique_hash
         ON card_keys(product_id, IFNULL(card_no, ''), secret_hash)`,
      );
    },
  },
  {
    id: 3,
    name: 'admin_sessions_and_password_version',
    up(db) {
      ensureColumn(
        db,
        'admin_users',
        'password_version',
        'INTEGER NOT NULL DEFAULT 1',
      );
      db.exec(`
        CREATE TABLE IF NOT EXISTS admin_sessions (
          jti TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          password_version INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          revoked_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_admin_sessions_username
          ON admin_sessions(username);
      `);
    },
  },
  {
    id: 4,
    name: 'audit_log',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          actor TEXT NOT NULL,
          action TEXT NOT NULL,
          detail TEXT,
          ip TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_audit_logs_created
          ON audit_logs(created_at DESC);
      `);
    },
  },
];

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    (
      db.prepare('SELECT id FROM schema_migrations').all() as Array<{ id: number }>
    ).map((r) => r.id),
  );

  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    const tx = db.transaction(() => {
      m.up(db);
      db.prepare(
        `INSERT INTO schema_migrations(id, name) VALUES(?, ?)`,
      ).run(m.id, m.name);
    });
    tx.immediate();
  }
}
