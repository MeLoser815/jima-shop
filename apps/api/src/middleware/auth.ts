import type { FastifyReply, FastifyRequest } from 'fastify';
import { nanoid } from 'nanoid';
import { config } from '../config.js';
import {
  createAdminSession,
  getAdminByUsername,
  getAdminSession,
} from '../db.js';
import { createAdminToken, verifyAdminToken } from '../utils/crypto.js';

declare module 'fastify' {
  interface FastifyRequest {
    adminUsername?: string;
    adminJti?: string;
  }
}

export function issueAdminAuth(
  username: string,
  passwordVersion: number,
): { token: string; jti: string } {
  const jti = nanoid(24);
  createAdminSession(jti, username, passwordVersion);
  const token = createAdminToken(
    config.sessionSecret,
    username,
    jti,
    passwordVersion,
  );
  return { token, jti };
}

export function authenticateAdminToken(
  token: string,
): { username: string; jti: string } | null {
  const verified = verifyAdminToken(token, config.sessionSecret);
  if (!verified.ok) return null;
  const session = getAdminSession(verified.jti);
  if (!session || session.revoked_at) return null;
  if (session.username.toLowerCase() !== verified.username.toLowerCase()) {
    return null;
  }
  const user = getAdminByUsername(verified.username);
  if (!user) return null;
  if (
    user.password_version !== verified.passwordVersion ||
    user.password_version !== session.password_version
  ) {
    return null;
  }
  return { username: user.username, jti: session.jti };
}

export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    reply.code(401).send({ ok: false, error: '未登录：缺少 Authorization Bearer' });
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  const authed = authenticateAdminToken(token);
  if (!authed) {
    reply.code(401).send({ ok: false, error: '登录已失效，请重新登录' });
    return;
  }
  request.adminUsername = authed.username;
  request.adminJti = authed.jti;
}
