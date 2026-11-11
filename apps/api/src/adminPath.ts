/** 开源默认后台路径。可用环境变量 ADMIN_BASE_PATH 覆盖（例如本地开发继续用自定义路径）。 */
export const DEFAULT_ADMIN_BASE_PATH = '/admin';

const RESERVED_SEGMENTS = new Set([
  'api',
  'p',
  'cart',
  'pay',
  'order',
  'query',
  'cashier',
  'assets',
  'health',
]);

/**
 * 规范化管理后台的前端路径：单个以 / 开头的路径段，例如 `/admin` 或 `/my-admin`。
 * 不允许与前台路由或 /api 冲突。
 */
export function normalizeAdminBasePath(
  raw: string | undefined,
  options: { strict?: boolean } = {},
): string {
  const fallback = DEFAULT_ADMIN_BASE_PATH;
  let value = (raw ?? '').trim();
  if (!value) return fallback;
  if (!value.startsWith('/')) value = `/${value}`;
  value = value.replace(/\/+$/, '');
  if (!value || value === '/') {
    if (options.strict) {
      throw new Error('ADMIN_BASE_PATH 不能是空路径或根路径 /');
    }
    return fallback;
  }
  if (!/^\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) {
    if (options.strict) {
      throw new Error(
        'ADMIN_BASE_PATH 必须是单个路径段，例如 /admin 或 /my-admin，仅允许字母、数字、下划线和连字符。',
      );
    }
    return fallback;
  }
  const segment = value.slice(1).toLowerCase();
  if (RESERVED_SEGMENTS.has(segment)) {
    if (options.strict) {
      throw new Error(`ADMIN_BASE_PATH 不能使用保留路径 ${value}`);
    }
    return fallback;
  }
  return value;
}

/** 在生产环境托管的 index.html 中注入后台路径，便于不重新构建即可更换路径。 */
export function injectAdminBasePath(html: string, adminBasePath: string): string {
  const path = normalizeAdminBasePath(adminBasePath, { strict: true });
  const snippet = `<script>window.__JIMA_ADMIN_BASE_PATH__=${JSON.stringify(path)};</script>`;
  const head = html.indexOf('<head>');
  if (head !== -1) {
    const insertAt = head + '<head>'.length;
    return html.slice(0, insertAt) + snippet + html.slice(insertAt);
  }
  return snippet + html;
}
