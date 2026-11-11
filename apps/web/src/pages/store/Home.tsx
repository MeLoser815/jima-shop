import { useEffect, useMemo, useState } from 'react';
import { App } from 'antd';
import { api, type Category, type Product } from '../../api';
import { useCart } from '../../cart';
import { useStoreTheme } from '../../ThemeProvider';
import {
  AngelHome,
  AnimeHome,
  PalaceHome,
  StrawberryHome,
} from './layouts';

export default function StoreHome() {
  const { message } = App.useApp();
  const cart = useCart();
  const { theme } = useStoreTheme();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<number | 'all'>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listCategories()
      .then((r) => setCategories(r.categories))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setLoading(true);
    api
      .listProducts(categoryId === 'all' ? undefined : categoryId)
      .then((r) => setProducts(r.products))
      .catch((e) => message.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [categoryId, message]);

  const featured = useMemo(
    () => products.filter((p) => p.stock > 0).slice(0, 3),
    [products],
  );

  const onAdd = (p: Product) => {
    cart.add({
      productId: p.id,
      name: p.name,
      price: p.price,
      coverUrl: p.coverUrl,
      stock: p.stock,
    });
    message.success(
      theme.id === 'guofeng'
        ? '已纳宝入匣'
        : theme.id === 'angel'
          ? '已沐光加入'
          : theme.id === 'anime'
            ? '加购成功! ★'
            : '已加入购物车 ♡',
    );
  };

  const props = {
    theme,
    products,
    categories,
    categoryId,
    setCategoryId,
    loading,
    featured,
    onAdd,
  };

  if (theme.id === 'guofeng') return <PalaceHome {...props} />;
  if (theme.id === 'angel') return <AngelHome {...props} />;
  if (theme.id === 'anime') return <AnimeHome {...props} />;
  return <StrawberryHome {...props} />;
}
