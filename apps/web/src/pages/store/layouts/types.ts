import type { Category, Product } from '../../../api';
import type { ThemeTokens } from '../../../themes';

export type HomeLayoutProps = {
  theme: ThemeTokens;
  products: Product[];
  categories: Category[];
  categoryId: number | 'all';
  setCategoryId: (id: number | 'all') => void;
  loading: boolean;
  featured: Product[];
  onAdd: (p: Product) => void;
};
