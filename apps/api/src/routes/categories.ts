import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createCategory,
  deleteCategory,
  getCategoryById,
  listCategories,
  updateCategory,
} from '../db.js';
import { requireAdmin } from '../middleware/auth.js';

const bodySchema = z.object({
  name: z.string().trim().min(1).max(64),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug 仅允许小写字母、数字与中划线'),
  icon: z.string().trim().max(16).optional().default('🎁'),
  sortOrder: z.number().int().min(0).max(99999).optional().default(0),
  status: z.enum(['on', 'off']).optional().default('on'),
});

export async function categoryRoutes(app: FastifyInstance): Promise<void> {
  /** 前台：启用中的分类 */
  app.get('/api/categories', async () => ({
    ok: true,
    categories: listCategories({ status: 'on' }).map(publicCategory),
  }));

  app.get(
    '/api/admin/categories',
    { preHandler: requireAdmin },
    async (req) => {
      const q = req.query as { status?: string };
      const status =
        q.status === 'on' || q.status === 'off' || q.status === 'all'
          ? q.status
          : 'all';
      return { ok: true, categories: listCategories({ status }) };
    },
  );

  app.post(
    '/api/admin/categories',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          ok: false,
          error: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }
      try {
        const d = parsed.data;
        const category = createCategory({
          name: d.name,
          slug: d.slug,
          icon: d.icon,
          sortOrder: d.sortOrder,
          status: d.status,
        });
        return { ok: true, category };
      } catch (e) {
        const msg = String((e as Error).message || e);
        if (msg.includes('UNIQUE')) {
          return reply.code(400).send({ ok: false, error: 'slug 已存在' });
        }
        throw e;
      }
    },
  );

  app.put(
    '/api/admin/categories/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      if (!Number.isFinite(id) || !getCategoryById(id)) {
        return reply.code(404).send({ ok: false, error: '分类不存在' });
      }
      const parsed = bodySchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          ok: false,
          error: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }
      const d = parsed.data;
      try {
        const category = updateCategory(id, {
          name: d.name,
          slug: d.slug?.toLowerCase(),
          icon: d.icon,
          sort_order: d.sortOrder,
          status: d.status,
        });
        return { ok: true, category };
      } catch (e) {
        const msg = String((e as Error).message || e);
        if (msg.includes('UNIQUE')) {
          return reply.code(400).send({ ok: false, error: 'slug 已存在' });
        }
        throw e;
      }
    },
  );

  app.delete(
    '/api/admin/categories/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      if (!Number.isFinite(id)) {
        return reply.code(400).send({ ok: false, error: '无效分类 ID' });
      }
      const ok = deleteCategory(id);
      if (!ok) {
        return reply.code(404).send({ ok: false, error: '分类不存在' });
      }
      return { ok: true };
    },
  );
}

function publicCategory(c: {
  id: number;
  name: string;
  slug: string;
  icon: string;
  sort_order: number;
}) {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    icon: c.icon,
    sortOrder: c.sort_order,
  };
}
