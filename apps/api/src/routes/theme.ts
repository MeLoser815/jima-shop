import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  getStoreThemeId,
  listThemePresets,
  setStoreThemeId,
} from '../db.js';
import { requireAdmin } from '../middleware/auth.js';

export async function themeRoutes(app: FastifyInstance): Promise<void> {
  /** 前台公开：当前主题 + 可选模板列表 */
  app.get('/api/store/theme', async () => {
    const themeId = getStoreThemeId();
    const presets = listThemePresets();
    return {
      ok: true,
      themeId,
      theme: presets.find((p) => p.id === themeId) ?? presets[0],
      presets,
    };
  });

  app.get(
    '/api/admin/theme',
    { preHandler: requireAdmin },
    async () => {
      const themeId = getStoreThemeId();
      return {
        ok: true,
        themeId,
        presets: listThemePresets(),
      };
    },
  );

  app.put(
    '/api/admin/theme',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const parsed = z
        .object({ themeId: z.string().min(1) })
        .safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ ok: false, error: '参数错误' });
      }
      try {
        const themeId = setStoreThemeId(parsed.data.themeId);
        return { ok: true, themeId };
      } catch (e) {
        return reply
          .code(400)
          .send({ ok: false, error: (e as Error).message });
      }
    },
  );
}
