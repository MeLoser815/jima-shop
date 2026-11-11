/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ADMIN_BASE_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  /** 生产环境由 API 在托管 index.html 时注入，与 ADMIN_BASE_PATH 一致 */
  __JIMA_ADMIN_BASE_PATH__?: string;
}
