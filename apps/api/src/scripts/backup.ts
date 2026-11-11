import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { getDb, tightenDbFilePermissions } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function defaultDest(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.resolve(__dirname, '../../../../data/backups');
  fs.mkdirSync(dir, { recursive: true });
  fs.chmodSync(dir, 0o700);
  return path.join(dir, `jima-${stamp}.db`);
}

function assertSafePath(dest: string): string {
  const resolved = path.resolve(dest);
  if (resolved === path.resolve(config.databasePath)) {
    throw new Error('不能把备份写到正在使用的数据库文件上');
  }
  return resolved;
}

async function main() {
  const dest = assertSafePath(process.argv[2] || defaultDest());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const db = getDb();
  // better-sqlite3 的 backup API：一致性快照，不要用运行中的 cp
  await db.backup(dest);
  tightenDbFilePermissions(dest);
  try {
    fs.chmodSync(dest, 0o600);
  } catch {
    /* ignore */
  }
  console.info(`备份已写入 ${dest}`);
  console.info(
    '注意：备份包含支付宝密钥密文、管理员哈希与卡密，请妥善保管（建议文件权限 0600）。',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
