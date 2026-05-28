import type { Banner, Product } from '../components/ProductContext';

const PRODUCTS_KEY = 'xiaomi-products';
const BANNERS_KEY = 'xiaomi-banners';

export function sanitizeProductImage(image: unknown): string {
  if (typeof image !== 'string' || !image) return '';
  if (image.startsWith('data:')) return '';
  if (image.length > 2048 && !image.startsWith('http') && !image.includes('/api/media/')) {
    return '';
  }
  if (
    image.startsWith('http://') ||
    image.startsWith('https://') ||
    image.includes('/api/media/')
  ) {
    return image;
  }
  return '';
}

export function sanitizeProductForCatalog(product: Product): Product {
  return {
    ...product,
    image: sanitizeProductImage(product.image),
  };
}

export function sanitizeBannerForCatalog(banner: Banner): Banner {
  const bg = banner.backgroundImage;
  const safeBg =
    typeof bg === 'string' && !bg.startsWith('data:') && (bg.startsWith('http') || bg.includes('/api/media/'))
      ? bg
      : '';
  return { ...banner, backgroundImage: safeBg };
}

export function readProductsCache(): Product[] {
  try {
    const raw = localStorage.getItem(PRODUCTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Product[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeProductForCatalog);
  } catch {
    localStorage.removeItem(PRODUCTS_KEY);
    return [];
  }
}

export function readBannersCache(): Banner[] {
  try {
    const raw = localStorage.getItem(BANNERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Banner[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeBannerForCatalog);
  } catch {
    localStorage.removeItem(BANNERS_KEY);
    return [];
  }
}

export function writeProductsCache(products: Product[]) {
  try {
    localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products.map(sanitizeProductForCatalog)));
  } catch (e) {
    console.warn('No se pudo cachear productos:', e);
  }
}

export function writeBannersCache(banners: Banner[]) {
  try {
    localStorage.setItem(BANNERS_KEY, JSON.stringify(banners.map(sanitizeBannerForCatalog)));
  } catch (e) {
    console.warn('No se pudo cachear banners:', e);
  }
}
