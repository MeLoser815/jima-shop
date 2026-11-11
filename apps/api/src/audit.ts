import { getDb } from './db.js';

export type AuditLogRow = {
  id: number;
  actor: string;
  action: string;
  detail: string | null;
  ip: string | null;
  created_at: string;
};

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

export function listAuditLogs(limit = 100): AuditLogRow[] {
  const n = Math.min(Math.max(limit, 1), 500);
  return getDb()
    .prepare(
      `SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?`,
    )
    .all(n) as AuditLogRow[];
}
