import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type CartItem = {
  productId: number;
  name: string;
  price: string;
  coverUrl: string;
  quantity: number;
  stock: number;
};

type CartCtx = {
  items: CartItem[];
  count: number;
  total: number;
  add: (item: Omit<CartItem, 'quantity'> & { quantity?: number }) => void;
  setQty: (productId: number, quantity: number) => void;
  remove: (productId: number) => void;
  clear: () => void;
};

const KEY = 'jima_cart_v1';
const CartContext = createContext<CartCtx | null>(null);

function load(): CartItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CartItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(() => load());

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(items));
  }, [items]);

  const add = useCallback(
    (item: Omit<CartItem, 'quantity'> & { quantity?: number }) => {
      setItems((prev) => {
        const q = item.quantity ?? 1;
        const idx = prev.findIndex((x) => x.productId === item.productId);
        if (idx >= 0) {
          const next = [...prev];
          const merged = next[idx].quantity + q;
          next[idx] = {
            ...next[idx],
            ...item,
            quantity: Math.min(merged, item.stock || 99),
          };
          return next;
        }
        return [
          ...prev,
          {
            ...item,
            quantity: Math.min(q, item.stock || 99),
          },
        ];
      });
    },
    [],
  );

  const setQty = useCallback((productId: number, quantity: number) => {
    setItems((prev) =>
      prev
        .map((x) =>
          x.productId === productId
            ? { ...x, quantity: Math.max(0, Math.min(quantity, x.stock || 99)) }
            : x,
        )
        .filter((x) => x.quantity > 0),
    );
  }, []);

  const remove = useCallback((productId: number) => {
    setItems((prev) => prev.filter((x) => x.productId !== productId));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const value = useMemo<CartCtx>(() => {
    const total = items.reduce(
      (s, it) => s + Number(it.price) * it.quantity,
      0,
    );
    const count = items.reduce((s, it) => s + it.quantity, 0);
    return { items, count, total, add, setQty, remove, clear };
  }, [items, add, setQty, remove, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartCtx {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
