import { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import imageCompression from 'browser-image-compression';
import { toast } from 'sonner';
import { API_BASE_URL, fetchWithTimeout } from '../lib/api-base';
import {
  readBannersCache,
  readProductsCache,
  sanitizeBannerForCatalog,
  sanitizeProductForCatalog,
  writeBannersCache,
  writeProductsCache,
} from '../lib/catalog-cache';
import { uploadProductImage } from '../lib/product-image';

async function compressImage(imageString: string): Promise<string> {
  if (!imageString || !imageString.startsWith('data:image')) {
    return imageString;
  }

  try {
    const response = await fetch(imageString);
    const blob = await response.blob();
    const file = new File([blob], 'image.jpg', { type: blob.type });
    const compressedFile = await imageCompression(file, {
      maxSizeMB: 0.35,
      maxWidthOrHeight: 1000,
      useWebWorker: true,
    });
    return await imageCompression.getDataUrlFromFile(compressedFile);
  } catch (error) {
    console.error('Error compressing image:', error);
    throw new Error('No se pudo comprimir la imagen del banner');
  }
}

export interface Review {
  id: string;
  author: string;
  rating: number;
  date: string;
  comment: string;
}

export interface ColorVariant {
  color: string;
  colorHex: string;
  stock: number;
}

export interface StorageVariant {
  storage: string;
  price: number;
  stock: number;
}

export interface Product {
  _id?: string;
  id: string;
  name: string;
  category: string;
  price: number;
  description: string;
  image: string;
  stock: number;
  isFeatured?: boolean;
  colorVariants?: ColorVariant[];
  storageVariants?: StorageVariant[];
  specifications?: {
    [key: string]: string;
  };
  reviews?: Review[];
}

export interface Banner {
  _id?: string;
  title: string;
  subtitle: string;
  description: string;
  buttonText: string;
  buttonLink: string;
  backgroundImage: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
  selectedColor?: string;
  selectedStorage?: string;
  serialNumber?: string;
  serialNumbers?: string[];
  invoiceNumber?: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  date: string;
  createdAt: string;
  items: CartItem[];
  total: number;
  status: 'pending' | 'pending_bold' | 'processing' | 'completed' | 'cancelled';
  customerInfo: {
    email?: string;
    name?: string;
    idNumber?: string;
    phone?: string;
    deliveryMethod?: 'delivery' | 'pickup';
    address?: string;
    paymentMethod?: string;
    cardType?: 'debito' | 'credito';
    paypalId?: string;
    deliveryFee?: number;
  };
  paymentMethod: string;
}

interface Notification {
  _id?: string;
  orderId: string;
  orderNumber: string;
  total: number;
  message: string;
  createdAt: string;
  read: boolean;
}

export interface TicketConfig {
  storeName: string;
  tagline: string;
  address: string;
  city: string;
  phone: string;
  nit?: string;
  website: string;
  footerMessage: string;
  warrantyMessage: string;
  schedule: string;
  exchangeRate?: number;
  showUSD?: boolean;
}

interface ProductContextType {
  products: Product[];
  addProduct: (product: Omit<Product, 'id'>) => Promise<void>;
  updateProduct: (id: string, product: Partial<Product>) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  banners: Banner[];
  addBanner: (banner: Banner) => Promise<void>;
  updateBanner: (id: string, banner: Banner) => Promise<void>;
  deleteBanner: (id: string) => Promise<void>;
  cart: CartItem[];
  addToCart: (product: Product, quantity?: number, selectedColor?: string, selectedStorage?: string) => void;
  removeFromCart: (productId: string, selectedColor?: string, selectedStorage?: string) => void;
  updateCartQuantity: (productId: string, quantity: number, selectedColor?: string, selectedStorage?: string) => void;
  clearCart: () => void;
  getCartTotal: () => number;
  orders: Order[];
  addOrder: (order: Omit<Order, 'id' | 'orderNumber' | 'date'>) => Promise<Order>;
  updateOrderStatus: (orderId: string, status: Order['status']) => Promise<void>;
  updateOrderDetails: (orderId: string, updates: { items?: CartItem[], customerInfo?: any, total?: number }) => Promise<void>;
  deleteOrder: (orderId: string) => Promise<void>;
  unreadOrdersCount: number;
  markOrdersAsRead: () => void;
  loading: boolean;
  notifications: Notification[];
  ticketConfig: TicketConfig;
  updateTicketConfig: (config: Partial<TicketConfig>) => Promise<void>;
  loadData: () => Promise<void>;
  loadAdminData: () => Promise<void>;
}

const ProductContext = createContext<ProductContextType | undefined>(undefined);

ProductContext.displayName = 'ProductContext';

function getInitialCatalog() {
  if (typeof window === 'undefined') {
    return { products: [] as Product[], banners: [] as Banner[] };
  }
  return {
    products: readProductsCache(),
    banners: readBannersCache(),
  };
}

export function ProductProvider({ children }: { children: ReactNode }) {
  const initialCatalog = getInitialCatalog();
  const [products, setProducts] = useState<Product[]>(initialCatalog.products);
  const [banners, setBanners] = useState<Banner[]>(initialCatalog.banners);
  const [orders, setOrders] = useState<Order[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(initialCatalog.products.length === 0);
  const [lastReadOrderTime, setLastReadOrderTime] = useState<number>(Date.now());
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const lastLoadTimeRef = useRef<number>(0);
  const [ticketConfig, setTicketConfig] = useState<TicketConfig>({
    storeName: 'XIAOMI STORE',
    tagline: 'Tecnología Premium',
    address: 'Cl. 31 #61-64, Los Ángeles',
    city: 'Cartagena de Indias',
    phone: '302 287 5280',
    nit: '1043345642-7',
    website: 'www.xiaomicartagena.com',
    footerMessage: '¡Gracias por tu compra!',
    warrantyMessage: 'Conserva este ticket para tu garantía',
    schedule: 'Lun - Vie: 9:00 AM - 7:00 PM | Dom: 10:30 AM - 3:00 PM',
    exchangeRate: 4200,
    showUSD: false
  });

  useEffect(() => {
    loadData();

    try {
      const savedCart = localStorage.getItem('xiaomi-cart');
      if (savedCart) {
        const parsed = JSON.parse(savedCart);
        // Soporte formato NUEVO (con productId) y formato VIEJO (con product.id)
        if (Array.isArray(parsed) && parsed.length > 0) {
          if (parsed[0].productId) {
            // Formato nuevo: reconstruir CartItem con producto mínimo (sin imagen)
            const restoredCart: CartItem[] = parsed.map((entry: any) => ({
              product: {
                id: entry.productId,
                name: entry._name || '',
                price: entry._price || 0,
                image: '',  // se actualizará cuando carguen los productos
                description: '',
                category: '',
                stock: 99,
              } as Product,
              quantity: entry.quantity,
              selectedColor: entry.selectedColor,
              selectedStorage: entry.selectedStorage,
            }));
            setCart(restoredCart);
          } else if (parsed[0].product) {
            // Formato VIEJO con imágenes base64 — limpiar y liberar espacio
            localStorage.removeItem('xiaomi-cart'); // eliminar para liberar los MBs
            const cleaned: CartItem[] = parsed.map((item: any) => ({
              ...item,
              product: { ...item.product, image: '' },
            }));
            setCart(cleaned);
          }
        }
      }
    } catch (e) {
      console.warn('Error al restaurar carrito:', e);
      localStorage.removeItem('xiaomi-cart'); // limpiar si está corrupto
    }
  }, []);

  // Guardar carrito en localStorage SIN las imágenes base64 (evita QuotaExceededError)
  useEffect(() => {
    try {
      const cartToSave = cart.map(item => ({
        productId: item.product.id,
        quantity: item.quantity,
        selectedColor: item.selectedColor,
        selectedStorage: item.selectedStorage,
        _price: item.product.price,
        _name: item.product.name,
      }));
      localStorage.setItem('xiaomi-cart', JSON.stringify(cartToSave));
    } catch (e) {
      console.warn('No se pudo guardar el carrito en localStorage:', e);
    }
  }, [cart]);

  // Cuando los productos carguen, enriquecer el carrito restaurado con imágenes reales
  useEffect(() => {
    if (products.length === 0) return;
    setCart(prev => {
      const needsEnrichment = prev.some(item => !item.product.image);
      if (!needsEnrichment) return prev;
      return prev.map(item => {
        if (item.product.image) return item;
        const fullProduct = products.find(p => p.id === item.product.id);
        if (!fullProduct) return item;
        // Usar precio de variante si aplica
        let price = fullProduct.price;
        if (item.selectedStorage && fullProduct.storageVariants) {
          const v = fullProduct.storageVariants.find(v => v.storage === item.selectedStorage);
          if (v) price = v.price;
        }
        return { ...item, product: { ...fullProduct, price } };
      });
    });
  }, [products]);

  const cachedDataRef = useRef<{products?: any[], banners?: any[]} | null>(null);

  async function fetchWithRetry(url: string, retries = 1, timeoutMs = 15000): Promise<Response> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fetchWithTimeout(url, {}, timeoutMs);
      } catch (err) {
        if (attempt === retries) throw err;
        await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
      }
    }
    throw new Error(`Failed after ${retries} retries: ${url}`);
  }

  async function loadData() {
    const now = Date.now();
    if (now - lastLoadTimeRef.current < 60_000 && products.length > 0) {
      return;
    }

    const cachedProducts = readProductsCache();
    const cachedBanners = readBannersCache();
    const hasCachedCatalog = cachedProducts.length > 0;

    if (hasCachedCatalog) {
      setProducts(cachedProducts);
      setBanners(cachedBanners);
      setLoading(false);
    } else if (products.length === 0) {
      setLoading(true);
    }

    try {
      lastLoadTimeRef.current = now;

      const [productsRes, bannersRes] = await Promise.all([
        fetchWithRetry(`${API_BASE_URL}/products`),
        fetchWithRetry(`${API_BASE_URL}/banners`),
      ]);

      if (productsRes.ok) {
        const productsData = (await productsRes.json()) as Product[];
        const sanitized = productsData.map(sanitizeProductForCatalog);
        setProducts(sanitized);
        writeProductsCache(sanitized);
        cachedDataRef.current = { ...(cachedDataRef.current || {}), products: sanitized };
      }

      if (bannersRes.ok) {
        const bannersData = (await bannersRes.json()) as Banner[];
        const sanitized = bannersData.map(sanitizeBannerForCatalog);
        setBanners(sanitized);
        writeBannersCache(sanitized);
        cachedDataRef.current = { ...(cachedDataRef.current || {}), banners: sanitized };
      }
    } catch (error) {
      console.error('Error loading data:', error);
      if (!hasCachedCatalog && products.length === 0) {
        toast.error('No se pudieron cargar los productos. Revisa tu conexión.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadAdminData() {
    try {
      const [ordersRes, notificationsRes, ticketConfigRes] = await Promise.all([
        fetchWithTimeout(`${API_BASE_URL}/orders`),
        fetchWithTimeout(`${API_BASE_URL}/notifications`),
        fetchWithTimeout(`${API_BASE_URL}/ticket-config`)
      ]);

      if (ordersRes.ok) setOrders(await ordersRes.json());
      if (notificationsRes.ok) setNotifications(await notificationsRes.json());
      if (ticketConfigRes.ok) {
        const ticketConfigData = await ticketConfigRes.json();
        if (ticketConfigData) setTicketConfig(ticketConfigData);
      }
    } catch (error) {
      console.error('Error loading admin data:', error);
    }
  }

  async function addProduct(product: Omit<Product, 'id'>) {
    try {
      const productId = Date.now().toString();
      const safeName = product.name.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').slice(0, 60) || 'producto';
      const imageUrl = await uploadProductImage(
        product.image,
        productId,
        `${safeName}.jpg`
      );

      const res = await fetchWithTimeout(`${API_BASE_URL}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...product, image: imageUrl }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || 'Error al crear producto');
      }
      const newProduct = await res.json();
      setProducts(prev => [...prev, newProduct]);
      toast.success('Producto creado correctamente');
    } catch (error) {
      console.error('Error adding product:', error);
      const message = error instanceof Error ? error.message : 'No se pudo crear el producto';
      toast.error(message);
      throw error;
    }
  }

  async function updateProduct(id: string, updates: Partial<Product>) {
    const previousProducts = products;

    try {
      const finalUpdates = { ...updates };
      if (updates.image !== undefined) {
        finalUpdates.image = await uploadProductImage(
          updates.image,
          id,
          `product-${id}.jpg`
        );
      }

      setProducts(prev =>
        prev.map(p => (p._id === id || p.id === id) ? { ...p, ...finalUpdates } : p)
      );

      const res = await fetchWithTimeout(`${API_BASE_URL}/products/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalUpdates),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || 'Error al actualizar producto');
      }

      const updated = await res.json();
      setProducts(prev =>
        prev.map(p => (p._id === id || p.id === id) ? { ...p, ...updated } : p)
      );
      toast.success('Producto actualizado correctamente');
    } catch (error) {
      console.error('Error updating product:', error);
      setProducts(previousProducts);
      const message = error instanceof Error ? error.message : 'No se pudo actualizar el producto';
      toast.error(message);
      throw error;
    }
  }

  async function deleteProduct(id: string) {
    const previousProducts = products;
    setProducts(prev => prev.filter(p => p._id !== id && p.id !== id));
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/products/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Error al eliminar producto');
      toast.success('Producto eliminado');
    } catch (error) {
      console.error('Error deleting product:', error);
      setProducts(previousProducts);
      toast.error('No se pudo eliminar el producto.');
      throw error;
    }
  }

  async function addBanner(banner: Banner) {
    try {
      const compressedBanner = {
        ...banner,
        backgroundImage: await compressImage(banner.backgroundImage)
      };
      const res = await fetch(`${API_BASE_URL}/banners`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(compressedBanner)
      });
      if (!res.ok) throw new Error('Error al crear banner');
      const newBanner = await res.json();
      setBanners(prev => [...prev, newBanner]);
      toast.success('Banner creado correctamente');
    } catch (error) {
      console.error('Error adding banner:', error);
      toast.error('No se pudo crear el banner.');
      throw error;
    }
  }

  async function updateBanner(id: string, banner: Banner) {
    const previousBanners = banners;
    try {
      const compressedBanner = {
        ...banner,
        backgroundImage: await compressImage(banner.backgroundImage)
      };
      // Actualización optimista
      setBanners(prev => prev.map(b => b._id === id ? { ...b, ...compressedBanner } : b));
      const res = await fetchWithTimeout(`${API_BASE_URL}/banners/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(compressedBanner)
      });
      if (!res.ok) throw new Error('Error al actualizar banner');
      toast.success('Banner actualizado correctamente');
    } catch (error) {
      console.error('Error updating banner:', error);
      setBanners(previousBanners);
      toast.error('No se pudo actualizar el banner. Los cambios fueron revertidos.');
      throw error;
    }
  }

  async function deleteBanner(id: string) {
    const previousBanners = banners;
    setBanners(prev => prev.filter(b => b._id !== id));
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/banners/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Error al eliminar banner');
      toast.success('Banner eliminado');
    } catch (error) {
      console.error('Error deleting banner:', error);
      setBanners(previousBanners);
      toast.error('No se pudo eliminar el banner.');
      throw error;
    }
  }

  function addToCart(product: Product, quantity: number = 1, selectedColor?: string, selectedStorage?: string) {
    setCart(prev => {
      const existingItem = prev.find(item => 
        item.product.id === product.id && 
        item.selectedColor === selectedColor &&
        item.selectedStorage === selectedStorage
      );
      
      let productPrice = product.price;
      let availableStock = product.stock;
      
      if (selectedStorage && product.storageVariants) {
        const storageVariant = product.storageVariants.find(v => v.storage === selectedStorage);
        if (storageVariant) {
          productPrice = storageVariant.price;
          availableStock = storageVariant.stock;
        }
      } else if (selectedColor && product.colorVariants) {
        const variant = product.colorVariants.find(v => v.color === selectedColor);
        availableStock = variant?.stock || product.stock;
      }
      
      const productWithPrice = { ...product, price: productPrice };
      
      // Meta Pixel Event: AddToCart
      if (typeof window !== 'undefined' && (window as any).fbq) {
        (window as any).fbq('track', 'AddToCart', {
          content_name: product.name,
          content_category: product.category,
          content_ids: [product.id],
          content_type: 'product',
          value: productPrice,
          currency: 'COP'
        });
      }

      if (existingItem) {
        const newQuantity = existingItem.quantity + quantity;
        if (newQuantity > availableStock) {
          toast.error(`Solo hay ${availableStock} unidades disponibles de ${product.name}${selectedStorage ? ` ${selectedStorage}` : ''}${selectedColor ? ` en color ${selectedColor}` : ''}`);
          return prev;
        }
        return prev.map(item =>
          item.product.id === product.id && 
          item.selectedColor === selectedColor &&
          item.selectedStorage === selectedStorage
            ? { ...item, quantity: newQuantity, product: productWithPrice }
            : item
        );
      } else {
        if (quantity > availableStock) {
          toast.error(`Solo hay ${availableStock} unidades disponibles de ${product.name}${selectedStorage ? ` ${selectedStorage}` : ''}${selectedColor ? ` en color ${selectedColor}` : ''}`);
          return prev;
        }
        return [...prev, { product: productWithPrice, quantity, selectedColor, selectedStorage }];
      }
    });
  }

  function removeFromCart(productId: string, selectedColor?: string, selectedStorage?: string) {
    setCart(prev => prev.filter(item => 
      !(item.product.id === productId && 
        item.selectedColor === selectedColor &&
        item.selectedStorage === selectedStorage)
    ));
  }

  function updateCartQuantity(productId: string, quantity: number, selectedColor?: string, selectedStorage?: string) {
    if (quantity <= 0) {
      removeFromCart(productId, selectedColor, selectedStorage);
      return;
    }
    
    setCart(prev => prev.map(item => {
      if (item.product.id === productId && 
          item.selectedColor === selectedColor &&
          item.selectedStorage === selectedStorage) {
        let availableStock = item.product.stock;
        
        if (selectedStorage && item.product.storageVariants) {
          const storageVariant = item.product.storageVariants.find(v => v.storage === selectedStorage);
          availableStock = storageVariant?.stock || 0;
        } else if (selectedColor && item.product.colorVariants) {
          const variant = item.product.colorVariants.find(v => v.color === selectedColor);
          availableStock = variant?.stock || 0;
        }
        
        if (quantity > availableStock) {
          toast.error(`Solo hay ${availableStock} unidades disponibles`);
          return item;
        }
        return { ...item, quantity };
      }
      return item;
    }));
  }

  function clearCart() {
    setCart([]);
  }

  function getCartTotal() {
    return cart.reduce((total, item) => total + (item.product.price * item.quantity), 0);
  }

  async function addOrder(orderData: Omit<Order, 'id' | 'orderNumber' | 'date'>) {
    const now = new Date().toISOString();
    const orderNumber = `XM-${Date.now().toString().slice(-8)}`;

    // Solo URLs ligeras en el pedido (sin base64); el API rellena desde el catálogo si falta
    const cleanItems = (orderData.items || []).map(item => {
      const image = sanitizeProductForCatalog(item.product).image;
      return {
        ...item,
        product: { ...item.product, image },
      };
    });

    const order = {
      ...orderData,
      items: cleanItems,
      orderNumber,
      date: now,
      createdAt: now
    };

    try {
      const res = await fetch(`${API_BASE_URL}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(order)
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Error ${res.status} al crear el pedido`);
      }

      const newOrder = await res.json();
      setOrders(prev => [newOrder, ...prev]);
      return newOrder;
    } catch (error: any) {
      console.error('[addOrder] Error:', error);
      throw error; // Re-lanzar para que CartDialog/QuickBuyDialog puedan mostrar el error
    }
  }

  async function updateOrderStatus(orderId: string, status: Order['status']) {
    try {
      await fetchWithTimeout(`${API_BASE_URL}/orders/${encodeURIComponent(orderId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      setOrders(prev =>
        prev.map(order =>
          order.id === orderId ? { ...order, status } : order
        )
      );
    } catch (error) {
      console.error('Error updating order status:', error);
    }
  }

  async function deleteOrder(orderId: string) {
    try {
      const res = await fetch(`${API_BASE_URL}/orders`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: orderId })
      });
      if (res.ok) {
        setOrders(prev => prev.filter(order => order.id !== orderId));
      } else {
        console.error('Error deleting order:', await res.json());
      }
    } catch (error) {
      console.error('Error deleting order:', error);
    }
  }

  async function updateOrderDetails(orderId: string, updates: { items?: CartItem[], customerInfo?: any, total?: number }) {
    try {
      await fetchWithTimeout(`${API_BASE_URL}/orders/${encodeURIComponent(orderId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      setOrders(prev =>
        prev.map(order =>
          order.id === orderId ? { ...order, ...updates } : order
        )
      );
    } catch (error) {
      console.error('Error updating order details:', error);
    }
  }

  const unreadOrdersCount = notifications.filter(n => !n.read).length;

  function markOrdersAsRead() {
    setLastReadOrderTime(Date.now());
    const unread = notifications.filter(n => !n.read);
    if (unread.length === 0) return;

    // Marcar en UI inmediatamente
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));

    // Persistir en BD — si alguna falla, no revertir la UI (UX mejor)
    Promise.allSettled(
      unread.map(n =>
        fetch(`${API_BASE_URL}/notifications`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: n._id })
        })
      )
    ).then(results => {
      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed > 0) {
        console.warn(`[notifications] ${failed} notificaciones no se marcaron en BD`);
      }
    });
  }

  function refreshNotifications() {
    fetch(`${API_BASE_URL}/notifications`)
      .then(res => res.json())
      .then(data => setNotifications(data));
  }

  async function updateTicketConfig(config: TicketConfig) {
    const response = await fetch(`${API_BASE_URL}/ticket-config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Error guardando');
    }
    
    const data = await response.json();
    
    const refreshRes = await fetch(`${API_BASE_URL}/ticket-config`);
    const refreshedConfig = await refreshRes.json();
    setTicketConfig(refreshedConfig);
    
    return data;
  }

  return (
    <ProductContext.Provider value={{ 
      products, 
      addProduct, 
      updateProduct, 
      deleteProduct, 
      banners, 
      addBanner,
      updateBanner,
      deleteBanner,
      cart,
      addToCart,
      removeFromCart,
      updateCartQuantity,
      clearCart,
      getCartTotal,
      orders,
      addOrder,
      updateOrderStatus,
      updateOrderDetails,
      deleteOrder,
      unreadOrdersCount,
      markOrdersAsRead,
      loading,
      notifications,
      ticketConfig,
      updateTicketConfig,
      loadData,
      loadAdminData
    }}>
      {children}
    </ProductContext.Provider>
  );
}

export function useProducts() {
  const context = useContext(ProductContext);
  if (!context) {
    throw new Error('useProducts must be used within a ProductProvider');
  }
  return context;
}
