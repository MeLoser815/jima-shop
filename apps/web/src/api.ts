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
  payMethod?: string;
  usdt?: {
    address: string;
    amount: string;
    network: string;
    expireAt?: string;
    paymentUrl?: string;
    qrContent: string;
  };
};

export type ThemePreset = {
  id: string;
  name: string;
  emoji: string;
  description: string;
};

const GENERIC_HTTP_ERROR =
  /^(Internal Server Error|Bad Request|Not Found|Unauthorized|Forbidden)$/i;

export function readApiErrorMessage(data: unknown, status: number): string {
  if (data && typeof data === 'object') {
    const d = data as { error?: unknown; message?: unknown };
    const err = typeof d.error === 'string' ? d.error.trim() : '';
    const msg = typeof d.message === 'string' ? d.message.trim() : '';
    if (err && !GENERIC_HTTP_ERROR.test(err)) return err;
    if (msg && !GENERIC_HTTP_ERROR.test(msg)) return msg;
  }
  if (!status) return '网络异常，请检查网络后重试';
  return `请求失败，请稍后重试（${status}）`;
}

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
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(30000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/timeout|aborted|AbortError|TimeoutError/i.test(msg)) {
      throw new Error('请求超时，请稍后重试');
    }
    throw new Error('网络异常，请检查网络后重试');
  }
  const data = (await res.json().catch(() => ({}))) as T & {
    ok?: boolean;
    error?: string;
    needsSetup?: boolean;
  };
  if (!res.ok || data.ok === false) {
    const err = new Error(readApiErrorMessage(data, res.status)) as Error & {
      needsSetup?: boolean;
      status?: number;
    };
    err.needsSetup = data.needsSetup;
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
  listAudit(
    page = 1,
    pageSize = 15,
    opts?: { q?: string; action?: string },
  ) {
    const q = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (opts?.q) q.set('q', opts.q);
    if (opts?.action) q.set('action', opts.action);
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
  getStorePayment() {
    return request<{
      ok: boolean;
      alipayConfigured: boolean;
      epayConfigured?: boolean;
      usdtConfigured?: boolean;
      methods?: Array<{ id: string; label: string }>;
      notifyEnabled?: boolean;
      insecureHttp?: boolean;
      hint?: string;
    }>('/api/store/payment');
  },
  getSettings() {
    return request<{
      ok: boolean;
      configured: boolean;
      unreadable?: boolean;
      paymentConfigured?: boolean;
      settings: {
        appId: string;
        privateKeyMasked: string;
        alipayPublicKeyMasked: string;
        gateway: string;
        storeId: string;
        sellerId: string;
        notifyUrl: string;
      };
      epay?: {
        enabled: boolean;
        configured: boolean;
        unreadable: boolean;
        settings: {
          gateway: string;
          pid: string;
          keyMasked: string;
          channels: string[];
        };
      };
      usdt?: {
        enabled: boolean;
        configured: boolean;
        unreadable: boolean;
        settings: {
          address: string;
          rate: string;
          expireMinutes: number;
          apiKeyMasked: string;
          networks?: Array<{
            id: string;
            channel: string;
            name: string;
            displayNetwork: string;
            standard: string;
            decimals: number;
            defaultLabel: string;
            enabled: boolean;
            address: string;
            apiKeyMasked: string;
          }>;
        };
        scanStatus?: {
          ok: boolean;
          at?: string;
          error?: string;
          scanned?: number;
          applied?: number;
        } | null;
      };
      paymentMethodLabels?: Record<string, string>;
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
    paymentMethodLabels?: Record<string, string>;
  }) {
    return request<{
      ok: boolean;
      configured?: boolean;
      valid?: boolean;
      warning?: string;
    }>('/api/admin/settings', {
      method: 'PUT',
      auth: true,
      body: JSON.stringify(body),
    });
  },
  checkSettings() {
    return request<{ ok: boolean; message?: string }>(
      '/api/admin/settings/check',
      { method: 'POST', auth: true },
    );
  },
  saveEpaySettings(body: {
    enabled: boolean;
    gateway: string;
    pid: string;
    key?: string;
    channels: string[];
    paymentMethodLabels?: Record<string, string>;
  }) {
    return request<{
      ok: boolean;
      configured?: boolean;
      valid?: boolean;
      warning?: string;
    }>('/api/admin/settings/epay', {
      method: 'PUT',
      auth: true,
      body: JSON.stringify(body),
    });
  },
  checkEpaySettings() {
    return request<{ ok: boolean; message?: string }>(
      '/api/admin/settings/epay/check',
      { method: 'POST', auth: true },
    );
  },
  saveUsdtSettings(body: {
    enabled: boolean;
    address?: string;
    rate: string;
    expireMinutes: number;
    apiKey?: string;
    networks?: Array<{
      id: string;
      enabled: boolean;
      address?: string;
      apiKey?: string;
    }>;
    paymentMethodLabels?: Record<string, string>;
  }) {
    return request<{
      ok: boolean;
      configured?: boolean;
      valid?: boolean;
      warning?: string;
      message?: string;
      ready?: Array<{ id: string; displayNetwork: string }>;
      issues?: string[];
    }>('/api/admin/settings/usdt', {
      method: 'PUT',
      auth: true,
      body: JSON.stringify(body),
    });
  },
  checkUsdtSettings() {
    return request<{
      ok: boolean;
      message?: string;
      ready?: Array<{ id: string; displayNetwork: string }>;
      issues?: string[];
    }>(
      '/api/admin/settings/usdt/check',
      { method: 'POST', auth: true },
    );
  },
  dashboard() {
    return request<{
      ok: boolean;
      configured: boolean;
      alipayConfigured?: boolean;
      epayConfigured?: boolean;
      stats: {
        productCount: number;
        onSaleCount: number;
        orderCount: number;
        paidCount: number;
        paidAmount: string;
        pendingFulfillmentCount?: number;
      };
    }>('/api/admin/dashboard', { auth: true });
  },
  listOrders(opts?: {
    q?: string;
    payStatus?: 'all' | 'paid' | 'pending' | 'closed';
    fulfillment?: 'all' | 'pending_fulfillment' | 'delivered' | 'none';
    sortBy?: 'created_at' | 'total_amount' | 'status' | 'subject' | 'id';
    sortOrder?: 'asc' | 'desc';
    page?: number;
    pageSize?: number;
  }) {
    const q = new URLSearchParams();
    if (opts?.q) q.set('q', opts.q);
    if (opts?.payStatus && opts.payStatus !== 'all') q.set('payStatus', opts.payStatus);
    if (opts?.fulfillment && opts.fulfillment !== 'all') {
      q.set('fulfillment', opts.fulfillment);
    }
    if (opts?.sortBy) q.set('sortBy', opts.sortBy);
    if (opts?.sortOrder) q.set('sortOrder', opts.sortOrder);
    if (opts?.page) q.set('page', String(opts.page));
    if (opts?.pageSize) q.set('pageSize', String(opts.pageSize));
    const qs = q.toString();
    return request<{
      ok: boolean;
      total?: number;
      page?: number;
      pageSize?: number;
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
    }>(`/api/admin/orders${qs ? `?${qs}` : ''}`, { auth: true });
  },
  listAdminProducts(status: 'all' | 'on' | 'off' = 'all') {
    return request<{ ok: boolean; products: AdminProduct[] }>(
      `/api/admin/products?status=${status}&limit=500`,
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
    paymentMethod?: string;
  }) {
    return request<{
      ok: boolean;
      order: {
        outTradeNo: string;
        subject: string;
        totalAmount: string;
        status: string;
        qrCode: string | null;
        payUrl?: string;
        payScheme?: string;
        payMethod?: string;
        paymentMethod?: string;
        usdt?: {
          address: string;
          amount: string;
          network: string;
          expireAt?: string;
          paymentUrl?: string;
          qrContent: string;
        };
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
