import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { normalizeAdminBasePath } from './src/adminPathNormalize';

function loadEnvFile(file: string) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// 与 API 共用 apps/api/.env（其次仓库根 .env），这样 ADMIN_BASE_PATH 只需配置一处
loadEnvFile(path.resolve(__dirname, '../api/.env'));
loadEnvFile(path.resolve(__dirname, '../../.env'));

const adminBasePath = normalizeAdminBasePath(
  process.env.ADMIN_BASE_PATH || process.env.VITE_ADMIN_BASE_PATH,
);

const apiPort = Number(process.env.PORT || 8001);

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_ADMIN_BASE_PATH': JSON.stringify(adminBasePath),
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
});
