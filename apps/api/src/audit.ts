import { getDb } from './db.js';

export type AuditLogRow = {
  id: number;
  actor: string;
  action: string;
  detail: string | null;
  ip: string | null;
  created_at: string;
};

export const AUDIT_PAGE_SIZES = [15, 30, 50, 100] as const;
export const DEFAULT_AUDIT_PAGE_SIZE = 15;
export const AUDIT_RETENTION_DAYS_OPTIONS = [7, 30, 90, 180] as const;
export const DEFAULT_AUDIT_RETENTION_DAYS = 30;

const RETENTION_SETTING_KEY = 'audit_log_retention_days';

export type AuditLogPage = {
  logs: AuditLogRow[];
  total: number;
  page: number;
  pageSize: number;
};

function isAuditPageSize(n: number): n is (typeof AUDIT_PAGE_SIZES)[number] {
  return (AUDIT_PAGE_SIZES as readonly number[]).includes(n);
}

function isRetentionDays(
  n: number,
): n is (typeof AUDIT_RETENTION_DAYS_OPTIONS)[number] {
  return (AUDIT_RETENTION_DAYS_OPTIONS as readonly number[]).includes(n);
}

export function normalizeAuditPageSize(raw: unknown): number {
  const n = Number(raw);
  return isAuditPageSize(n) ? n : DEFAULT_AUDIT_PAGE_SIZE;
}

export function normalizeAuditPage(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

export function getAuditLogRetentionDays(): number {
  const row = getDb()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(RETENTION_SETTING_KEY) as { value: string } | undefined;
  const n = Number(row?.value);
  return isRetentionDays(n) ? n : DEFAULT_AUDIT_RETENTION_DAYS;
}

export function setAuditLogRetentionDays(days: number): number {
  if (!isRetentionDays(days)) {
    throw new Error('日志保留时间仅支持 7、30、90 或 180 天');
  }
  getDb()
    .prepare(
      `INSERT INTO settings(key, value, updated_at)
       VALUES(?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    )
    .run(RETENTION_SETTING_KEY, String(days));
  return days;
}

export function logAudit(input: {
  actor: string;
  action: string;
  detail?: unknown;
  ip?: string | null;
}): void {
  const detail =
    input.detail === undefined || input.detail === null
      ? null
      : typeof input.detail === 'string'
        ? input.detail
        : JSON.stringify(input.detail);
  getDb()
    .prepare(
      `INSERT INTO audit_logs(actor, action, detail, ip)
       VALUES(?, ?, ?, ?)`,
    )
    .run(input.actor, input.action, detail, input.ip ?? null);
}

export function listAuditLogs(
  page = 1,
  pageSize = DEFAULT_AUDIT_PAGE_SIZE,
  opts?: { q?: string; action?: string },
): AuditLogPage {
  const safePage = normalizeAuditPage(page);
  const safeSize = normalizeAuditPageSize(pageSize);
  const action = (opts?.action || '').trim();
  const keyword = (opts?.q || '').trim().replace(/[%_]/g, '');
  const where: string[] = [];
  const params: unknown[] = [];
  if (action) {
    where.push('action = ?');
    params.push(action);
  }
  if (keyword) {
    const like = `%${keyword}%`;
    where.push(
      `(actor LIKE ? OR action LIKE ? OR IFNULL(detail, '') LIKE ? OR IFNULL(ip, '') LIKE ?)`,
    );
    params.push(like, like, like, like);
  }
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const db = getDb();
  const total = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM audit_logs${whereSql}`)
      .get(...params) as { n: number }
  ).n;
  const offset = (safePage - 1) * safeSize;
  const logs = db
    .prepare(
      `SELECT * FROM audit_logs${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, safeSize, offset) as AuditLogRow[];
  return { logs, total, page: safePage, pageSize: safeSize };
}

/** 删除超过保留期的操作日志，减轻 SQLite 体积。 */
export function purgeExpiredAuditLogs(
  retentionDays = getAuditLogRetentionDays(),
): number {
  const days = isRetentionDays(retentionDays)
    ? retentionDays
    : DEFAULT_AUDIT_RETENTION_DAYS;
  const result = getDb()
    .prepare(
      `DELETE FROM audit_logs
       WHERE created_at < datetime('now', ?)`,
    )
    .run(`-${days} days`);
  return result.changes;
}

let cleanerTimer: ReturnType<typeof setInterval> | null = null;

export function startAuditLogCleaner(intervalMs = 60 * 60 * 1000): void {
  if (cleanerTimer) return;
  const tick = () => {
    try {
      const removed = purgeExpiredAuditLogs();
      if (removed > 0) {
        console.info(`[audit] 已清理过期操作日志 ${removed} 条`);
      }
    } catch (err) {
      console.error('[audit] 清理过期操作日志失败', err);
    }
  };
  tick();
  cleanerTimer = setInterval(tick, intervalMs);
  cleanerTimer.unref?.();
}

export function stopAuditLogCleaner(): void {
  if (!cleanerTimer) return;
  clearInterval(cleanerTimer);
  cleanerTimer = null;
}
