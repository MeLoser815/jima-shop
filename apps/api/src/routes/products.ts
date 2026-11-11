import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createProduct,
  deleteProduct,
  getProductById,
  listProducts,
  ProductDeleteError,
  updateProduct,
} from '../db.js';
import { logAudit } from '../audit.js';
import {
  countUnusedKeys,
  deleteUnusedKey,
  importCardKeys,
  listProductKeys,
} from '../cardKeys.js';
import { requireAdmin } from '../middleware/auth.js';
import { CARD_IMPORT_MAX_CHARS, sanitizeCoverUrl } from '../security.js';

const priceSchema = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, '价格格式错误')
  .refine((v) => Number(v) >= 0.01, '价格至少 0.01');

const productBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional().default(''),
  price: priceSchema,
  coverUrl: z.string().max(1000).optional().default(''),
  stock: z.number().int().min(0).max(1_000_000).optional().default(0),
  status: z.enum(['on', 'off']).optional().default('on'),
  sortOrder: z.number().int().min(0).max(99999).optional().default(0),
  categoryId: z.number().int().positive().nullable().optional(),
});

export async function productRoutes(app: FastifyInstance): Promise<void> {
  /** 前台：上架商品列表 */
  app.get('/api/products', async (req) => {
    const q = req.query as { limit?: string; categoryId?: string };
    const limit = Math.min(Number(q.limit ?? 100) || 100, 200);
    const categoryId = q.categoryId ? Number(q.categoryId) : undefined;
    const products = listProducts({
      status: 'on',
      limit,
      categoryId:
        categoryId != null && Number.isFinite(categoryId)
          ? categoryId
          : undefined,
    });
    return {
      ok: true,
      products: products.map(publicProduct),
    };
  });

  /** 前台：商品详情 */
  app.get('/api/products/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isFinite(id)) {
      return reply.code(400).send({ ok: false, error: '无效商品 ID' });
    }
    const p = getProductById(id);
    if (!p || p.status !== 'on') {
      return reply.code(404).send({ ok: false, error: '商品不存在或已下架' });
    }
    return { ok: true, product: publicProduct(p) };
  });

  /** 后台：全部商品 */
  app.get(
    '/api/admin/products',
    { preHandler: requireAdmin },
    async (req) => {
      const q = req.query as { status?: string; limit?: string };
      const status =
        q.status === 'on' || q.status === 'off' || q.status === 'all'
          ? q.status
          : 'all';
      const limit = Math.min(Number(q.limit ?? 200) || 200, 500);
      return {
        ok: true,
        products: listProducts({ status, limit }),
      };
    },
  );

  app.post(
    '/api/admin/products',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const parsed = productBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          ok: false,
          error: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }
      const d = parsed.data;
      let coverUrl = d.coverUrl;
      try {
        coverUrl = sanitizeCoverUrl(d.coverUrl);
      } catch (err) {
        return reply.code(400).send({
          ok: false,
          error: err instanceof Error ? err.message : '封面图地址不合法',
        });
      }
      const product = createProduct({
        name: d.name,
        description: d.description,
        price: d.price,
        coverUrl,
        stock: d.stock,
        status: d.status,
        sortOrder: d.sortOrder,
        categoryId: d.categoryId ?? null,
      });
      return { ok: true, product };
    },
  );

  app.put(
    '/api/admin/products/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      if (!Number.isFinite(id)) {
        return reply.code(400).send({ ok: false, error: '无效商品 ID' });
      }
      if (!getProductById(id)) {
        return reply.code(404).send({ ok: false, error: '商品不存在' });
      }
      const parsed = productBodySchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          ok: false,
          error: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }
      const d = parsed.data;
      let coverUrl: string | undefined;
      if (d.coverUrl !== undefined) {
        try {
          coverUrl = sanitizeCoverUrl(d.coverUrl);
        } catch (err) {
          return reply.code(400).send({
            ok: false,
            error: err instanceof Error ? err.message : '封面图地址不合法',
          });
        }
      }
      const product = updateProduct(id, {
        name: d.name,
        description: d.description,
        price: d.price,
        cover_url: coverUrl,
        stock: d.stock,
        status: d.status,
        sort_order: d.sortOrder,
        category_id: d.categoryId,
      });
      return { ok: true, product };
    },
  );

  app.delete(
    '/api/admin/products/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      if (!Number.isFinite(id)) {
        return reply.code(400).send({ ok: false, error: '无效商品 ID' });
      }
      try {
        const ok = deleteProduct(id);
        if (!ok) {
          return reply.code(404).send({ ok: false, error: '商品不存在' });
        }
        return { ok: true };
      } catch (err) {
        if (err instanceof ProductDeleteError) {
          return reply.code(409).send({ ok: false, error: err.message });
        }
        throw err;
      }
    },
  );

  app.get(
    '/api/admin/products/:id/keys',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      if (!Number.isFinite(id) || !getProductById(id)) {
        return reply.code(404).send({ ok: false, error: '商品不存在' });
      }
      const q = req.query as { status?: string };
      const status =
        q.status === 'unused' ||
        q.status === 'sold' ||
        q.status === 'disabled' ||
        q.status === 'reserved' ||
        q.status === 'all'
          ? q.status
          : 'all';
      return {
        ok: true,
        unusedCount: countUnusedKeys(id),
        keys: listProductKeys(id, status),
      };
    },
  );

  app.post(
    '/api/admin/products/:id/keys/import',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      if (!Number.isFinite(id) || !getProductById(id)) {
        return reply.code(404).send({ ok: false, error: '商品不存在' });
      }
      const parsed = z
        .object({
          text: z
            .string()
            .min(1, '请粘贴卡密')
            .max(CARD_IMPORT_MAX_CHARS, '导入内容过大，请分批导入'),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          ok: false,
          error: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }
      const result = importCardKeys(id, parsed.data.text);
      logAudit({
        actor: req.adminUsername || 'admin',
        action: 'keys.import',
        detail: {
          productId: id,
          imported: result.imported,
          skipped: result.skipped,
        },
        ip: req.ip,
      });
      return { ok: true, ...result, unusedCount: countUnusedKeys(id) };
    },
  );

  app.delete(
    '/api/admin/products/:id/keys/:keyId',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      const keyId = Number((req.params as { keyId: string }).keyId);
      if (!Number.isFinite(id) || !Number.isFinite(keyId)) {
        return reply.code(400).send({ ok: false, error: '无效 ID' });
      }
      const ok = deleteUnusedKey(id, keyId);
      if (!ok) {
        return reply.code(400).send({
          ok: false,
          error: '无法删除：卡密不存在，或已售出卡密需保留作为发货记录',
        });
      }
      return { ok: true, unusedCount: countUnusedKeys(id) };
    },
  );
}

function publicProduct(p: {
  id: number;
  name: string;
  description: string;
  price: string;
  cover_url: string;
  stock: number;
  status: string;
  category_id?: number | null;
}) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    price: p.price,
    coverUrl: p.cover_url,
    stock: p.stock,
    status: p.status,
    categoryId: p.category_id ?? null,
  };
}
