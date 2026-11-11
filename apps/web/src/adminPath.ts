import { normalizeAdminBasePath } from './adminPathNormalize';

export { DEFAULT_ADMIN_BASE_PATH, normalizeAdminBasePath } from './adminPathNormalize';

function readConfiguredAdminBasePath(): string | undefined {
  if (typeof window !== 'undefined' && window.__JIMA_ADMIN_BASE_PATH__) {
    return window.__JIMA_ADMIN_BASE_PATH__;
  }
  return import.meta.env.VITE_ADMIN_BASE_PATH;
}

/** 当前管理后台根路径。优先使用 API 在页面中注入的值，其次为构建/开发时的环境变量，默认 `/admin`。 */
export const ADMIN_BASE_PATH = normalizeAdminBasePath(readConfiguredAdminBasePath());

export function adminPath(subPath = ''): string {
  const leaf = subPath.replace(/^\/+/, '');
  return leaf ? `${ADMIN_BASE_PATH}/${leaf}` : ADMIN_BASE_PATH;
}

export function isAdminPath(pathname: string): boolean {
  return pathname === ADMIN_BASE_PATH || pathname.startsWith(`${ADMIN_BASE_PATH}/`);
}
