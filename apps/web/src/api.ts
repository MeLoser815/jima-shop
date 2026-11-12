const TOKEN_KEY = 'jima_admin_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export type Product = {
  id: number;
  name: string;
  description: string;
  price: string;
  coverUrl: string;
  stock: number;
  status: string;
  categoryId?: number | null;
  sort_order?: number;
  cover_url?: string;
  created_at?: string;
  updated_at?: string;
};

export type Category = {
  id: number;
  name: string;
  slug: string;
  icon: string;
  sortOrder?: number;
  sort_order?: number;
  status?: 'on' | 'off';
};

export type AdminProduct = {
  id: number;
  name: string;
  description: string;
  price: string;
  cover_url: string;
  stock: number;
  status: 'on' | 'off';
  sort_order: number;
  category_id: number | null;
  created_at: string;
  updated_at: string;
};

export type DeliveredKey = {
  id: number;
  productId: number | null;
  productName: string;
  cardNo: string | null;
  secret: string;
  text: string;
};

export type AdminCardKey = {
  id: number;
  product_id: number;
  card_no: string | null;
  secret: string;
  status: 'unused' | 'sold' | 'disabled' | 'reserved';
  order_id: number | null;
  order_item_id: number | null;
  sold_at: string | null;
  created_at: string;
  out_trade_no: string | null;
};

export type PublicOrder = {
  outTradeNo: string;
  subject: string;
  totalAmount: string;
  status: string;
  tradeNo: string | null;
  qrCode?: string | null;
  fulfillmentStatus: string;
  paid: boolean;
  keys: DeliveredKey[];
  items: Array<{
    productName: string;
    unitPrice: string;
    quantity: number;
    coverUrl: string;
  }>;
  message?: string;
};

export type ThemePreset = {
  id: string;
  name: string;
  emoji: string;
  description: string;
};

async function request<T>(
  path: string,
  init: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (init.auth) {
    const t = getToken();
    if (t) headers.set('Authorization', `Bearer ${t}`);
  }
  const res = await fetch(path, { ...init, headers });
  const data = (await res.json().catch(() => ({}))) as T & {
    ok?: boolean;
    error?: string;
    needsSetup?: boolean;
  };
  if (!res.ok) {
    const err = new Error(
      (data as { error?: string }).error || `请求失败 (${res.status})`,
    ) as Error & { needsSetup?: boolean; status?: number };
    err.needsSetup = (data as { needsSetup?: boolean }).needsSetup;
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  bootstrap() {
    return request<{ ok: boolean; needsSetup: boolean }>(
      '/api/admin/bootstrap',
    );
  },
  setup(username: string, password: string) {
    return request<{ ok: boolean; token: string; username: string }>(
      '/api/admin/setup',
      { method: 'POST', body: JSON.stringify({ username, password }) },
    );
  },
  login(username: string, password: string) {
    return request<{ ok: boolean; token: string; username: string }>(
      '/api/admin/login',
      { method: 'POST', body: JSON.stringify({ username, password }) },
    );
  },
  me() {
    return request<{ ok: boolean; username: string }>('/api/admin/me', {
      auth: true,
    });
  },
  getAdminPath() {
    return request<{ ok: boolean; path: string; envLocked: boolean }>(
      '/api/admin/admin-path',
      { auth: true },
    );
  },
  updateAdminPath(path: string) {
    return request<{ ok: boolean; path: string; envLocked: boolean }>(
      '/api/admin/admin-path',
      { method: 'PUT', auth: true, body: JSON.stringify({ path }) },
    );
  },
  changePassword(currentPassword: string, newPassword: string) {
    return request<{ ok: boolean; needRelogin?: boolean }>('/api/admin/change-password', {
      method: 'POST',
      auth: true,
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  },
  logout() {
    return request<{ ok: boolean }>('/api/admin/logout', {
      method: 'POST',
      auth: true,
    });
  },
  listAudit(page = 1, pageSize = 15) {
    const q = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    return request<{
      ok: boolean;
      logs: Array<{
        id: number;
        actor: string;
        action: string;
        detail: string | null;
        ip: string | null;
        created_at: string;
      }>;
      total: number;
      page: number;
      pageSize: number;
      retentionDays: number;
    }>(`/api/admin/audit?${q}`, { auth: true });
  },
  updateAuditRetention(days: number) {
    return request<{ ok: boolean; retentionDays: number }>(
      '/api/admin/audit/retention',
      { method: 'PUT', body: JSON.stringify({ days }), auth: true },
    );
  },
  fulfillOrder(outTradeNo: string) {
    return request<{
      ok: boolean;
      assigned: number;
      added: number;
      fulfillmentStatus: string;
    }>(`/api/admin/orders/${encodeURIComponent(outTradeNo)}/fulfill`, {
      method: 'POST',
      auth: true,
    });
  },
  getSettings() {
    return request<{
      ok: boolean;
      configured: boolean;
      settings: {
        appId: string;
        privateKeyMasked: string;
        alipayPublicKeyMasked: string;
        gateway: string;
        storeId: string;
        sellerId: string;
        notifyUrl: string;
      };
    }>('/api/admin/settings', { auth: true });
  },
  saveSettings(body: {
    appId: string;
    privateKey: string;
    alipayPublicKey: string;
    gateway?: string;
    storeId?: string;
    sellerId?: string;
    notifyUrl?: string;
  }) {
    return request<{ ok: boolean }>('/api/admin/settings', {
      method: 'PUT',
      auth: true,
      body: JSON.stringify(body),
    });
  },
  dashboard() {
    return request<{
      ok: boolean;
      configured: boolean;
      stats: {
        productCount: number;
        onSaleCount: number;
        orderCount: number;
        paidCount: number;
        paidAmount: string;
      };
    }>('/api/admin/dashboard', { auth: true });
  },
  listOrders() {
    return request<{
      ok: boolean;
      orders: Array<{
        id: number;
        out_trade_no: string;
        total_amount: string;
        subject: string;
        status: string;
        created_at: string;
        trade_no: string | null;
        buyer_note: string | null;
        fulfillment_status?: string;
        items: Array<{
          product_name: string;
          unit_price: string;
          quantity: number;
          cover_url: string;
        }>;
        keys?: DeliveredKey[];
      }>;
    }>('/api/admin/orders', { auth: true });
  },
  listAdminProducts(status: 'all' | 'on' | 'off' = 'all') {
    return request<{ ok: boolean; products: AdminProduct[] }>(
      `/api/admin/products?status=${status}`,
      { auth: true },
    );
  },
  createProduct(body: {
    name: string;
    description?: string;
    price: string;
    coverUrl?: string;
    stock?: number;
    status?: 'on' | 'off';
    sortOrder?: number;
    categoryId?: number | null;
  }) {
    return request<{ ok: boolean; product: AdminProduct }>(
      '/api/admin/products',
      { method: 'POST', auth: true, body: JSON.stringify(body) },
    );
  },
  updateProduct(
    id: number,
    body: Partial<{
      name: string;
      description: string;
      price: string;
      coverUrl: string;
      stock: number;
      status: 'on' | 'off';
      sortOrder: number;
      categoryId: number | null;
    }>,
  ) {
    return request<{ ok: boolean; product: AdminProduct }>(
      `/api/admin/products/${id}`,
      { method: 'PUT', auth: true, body: JSON.stringify(body) },
    );
  },
  deleteProduct(id: number) {
    return request<{ ok: boolean }>(`/api/admin/products/${id}`, {
      method: 'DELETE',
      auth: true,
    });
  },
  listProductKeys(id: number, status: 'all' | 'unused' | 'sold' | 'disabled' = 'all') {
    return request<{ ok: boolean; unusedCount: number; keys: AdminCardKey[] }>(
      `/api/admin/products/${id}/keys?status=${status}`,
      { auth: true },
    );
  },
  importProductKeys(id: number, text: string) {
    return request<{
      ok: boolean;
      imported: number;
      skipped: number;
      total: number;
      unusedCount: number;
    }>(`/api/admin/products/${id}/keys/import`, {
      method: 'POST',
      auth: true,
      body: JSON.stringify({ text }),
    });
  },
  deleteProductKey(productId: number, keyId: number) {
    return request<{ ok: boolean; unusedCount: number }>(
      `/api/admin/products/${productId}/keys/${keyId}`,
      { method: 'DELETE', auth: true },
    );
  },
  listProducts(categoryId?: number) {
    const q =
      categoryId != null ? `?categoryId=${encodeURIComponent(categoryId)}` : '';
    return request<{ ok: boolean; products: Product[] }>(`/api/products${q}`);
  },
  listCategories() {
    return request<{ ok: boolean; categories: Category[] }>('/api/categories');
  },
  listAdminCategories(status: 'all' | 'on' | 'off' = 'all') {
    return request<{ ok: boolean; categories: Array<Category & { status: 'on' | 'off'; sort_order: number }> }>(
      `/api/admin/categories?status=${status}`,
      { auth: true },
    );
  },
  createCategory(body: {
    name: string;
    slug: string;
    icon?: string;
    sortOrder?: number;
    status?: 'on' | 'off';
  }) {
    return request<{ ok: boolean; category: Category }>(
      '/api/admin/categories',
      { method: 'POST', auth: true, body: JSON.stringify(body) },
    );
  },
  updateCategory(
    id: number,
    body: Partial<{
      name: string;
      slug: string;
      icon: string;
      sortOrder: number;
      status: 'on' | 'off';
    }>,
  ) {
    return request<{ ok: boolean; category: Category }>(
      `/api/admin/categories/${id}`,
      { method: 'PUT', auth: true, body: JSON.stringify(body) },
    );
  },
  deleteCategory(id: number) {
    return request<{ ok: boolean }>(`/api/admin/categories/${id}`, {
      method: 'DELETE',
      auth: true,
    });
  },
  getStoreTheme() {
    return request<{
      ok: boolean;
      themeId: string;
      theme: ThemePreset;
      presets: ThemePreset[];
    }>('/api/store/theme');
  },
  getAdminTheme() {
    return request<{
      ok: boolean;
      themeId: string;
      presets: ThemePreset[];
    }>('/api/admin/theme', { auth: true });
  },
  setAdminTheme(themeId: string) {
    return request<{ ok: boolean; themeId: string }>('/api/admin/theme', {
      method: 'PUT',
      auth: true,
      body: JSON.stringify({ themeId }),
    });
  },
  getProduct(id: number) {
    return request<{ ok: boolean; product: Product }>(`/api/products/${id}`);
  },
  checkout(body: {
    items: Array<{ productId: number; quantity: number }>;
    buyerNote?: string;
  }) {
    return request<{
      ok: boolean;
      order: {
        outTradeNo: string;
        subject: string;
        totalAmount: string;
        status: string;
        qrCode: string | null;
        items: Array<{
          productId: number;
          name: string;
          coverUrl: string;
          unitPrice: string;
          quantity: number;
        }>;
      };
    }>('/api/checkout', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  getOrder(outTradeNo: string) {
    return request<{ ok: boolean; order: PublicOrder }>(
      `/api/orders/query/${encodeURIComponent(outTradeNo)}`,
    );
  },
  queryOrder(outTradeNo: string) {
    return request<{ ok: boolean; order: PublicOrder }>(
      `/api/orders/query/${encodeURIComponent(outTradeNo)}`,
    );
  },
  queryAlipay(outTradeNo: string) {
    return request<{
      ok: boolean;
      tradeStatus?: string;
      order?: PublicOrder;
    }>('/api/payment/query', {
      method: 'POST',
      auth: true,
      body: JSON.stringify({ outTradeNo }),
    });
  },
  precreate(body: { amount: string; subject: string; body?: string }) {
    return request<{
      ok: boolean;
      order: {
        outTradeNo: string;
        subject: string;
        totalAmount: string;
        status: string;
        qrCode: string | null;
      };
    }>('/api/payment/precreate', {
      method: 'POST',
      auth: true,
      body: JSON.stringify(body),
    });
  },
  payBarCode(body: { amount: string; subject: string; authCode: string }) {
    return request<{
      ok: boolean;
      order: {
        out_trade_no: string;
        total_amount: string;
        subject: string;
        status: string;
        qr_code?: string | null;
      };
    }>('/api/payment/pay', {
      method: 'POST',
      auth: true,
      body: JSON.stringify(body),
    });
  },
};
