import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useProducts, Product, Banner, ColorVariant, StorageVariant } from '../ProductContext';
import {
  Plus, Pencil, Trash2, Save, X, Package, ImageIcon, Upload, Palette, HardDrive, Cpu, MessageCircle,
  BarChart3, ShoppingBag, CreditCard, Warehouse, Link2, Receipt, DatabaseBackup, ShieldOff, Star, LogOut,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { OrdersManager } from '../OrdersManager';
import { StatisticsDashboard } from '../StatisticsDashboard';
import { AdminLinkGenerator } from './AdminLinkGenerator';
import { WhatsAppPanel } from '../WhatsAppPanel';
import { ReviewsManager } from '../ReviewsManager';
import { FinancingManager } from '../FinancingManager';
import { InventarioPanel } from '../inventario/InventarioPanel';
import { NotificationBell } from '../NotificationBell';
import { toast } from 'sonner';
import { compressImageFile, isRemoteImageUrl } from '../../lib/product-image';
import { useCredilockConectado } from '../../lib/useCredilockEstado';
const SOCKET_URL = '';

/**
 * Las 12 secciones del panel, en una tabla en vez de 12 bloques de JSX repetidos.
 *
 * El icono no es decoración: en la tira horizontal del móvil es lo que permite
 * encontrar una sección sin leer las doce etiquetas una por una. `clase` conserva
 * el color propio que ya tenían las secciones destacadas (CrediLock, Inventario,
 * Links VIP, WhatsApp y Reseñas) para no cambiar de sitio los puntos de referencia
 * del dueño.
 */
const SECCIONES_ADMIN = [
  { value: 'products',   label: 'Productos',    icon: Package },
  { value: 'stats',      label: 'Estadísticas', icon: BarChart3 },
  { value: 'orders',     label: 'Órdenes',      icon: ShoppingBag },
  { value: 'financing',  label: 'CrediLock',    icon: CreditCard,     clase: 'font-bold text-blue-700 data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700' },
  { value: 'inventario', label: 'Inventario',   icon: Warehouse,      clase: 'font-bold text-violet-700 data-[state=active]:bg-violet-50 data-[state=active]:text-violet-700' },
  { value: 'links',      label: 'Links VIP',    icon: Link2,          clase: 'font-bold text-sky-700 data-[state=active]:bg-sky-50 data-[state=active]:text-sky-700' },
  { value: 'banner',     label: 'Banners',      icon: ImageIcon },
  { value: 'ticket',     label: 'Ticket',       icon: Receipt },
  { value: 'backup',     label: 'Respaldo',     icon: DatabaseBackup },
  { value: 'blocking',   label: 'Bloqueo',      icon: ShieldOff },
  { value: 'whatsapp',   label: 'WhatsApp',     icon: MessageCircle,  clase: 'font-bold text-green-700 data-[state=active]:bg-green-50 data-[state=active]:text-green-700' },
  { value: 'reviews',    label: 'Reseñas',      icon: Star,           clase: 'font-bold text-indigo-700 data-[state=active]:bg-indigo-50 data-[state=active]:text-indigo-700' },
] as const;

export function AdminPanel() {
  const { products, addProduct, updateProduct, deleteProduct, banners, updateBanner, addBanner, deleteBanner, orders, unreadOrdersCount, ticketConfig, updateTicketConfig, loadAdminData } = useProducts();
  const navigate = useNavigate();

  useEffect(() => {
    loadAdminData();
  }, []);

  const [ticketForm, setTicketForm] = useState({
    storeName: 'XIAOMI STORE',
    tagline: 'Tecnología Premium',
    address: 'Cl. 31 #61-64, Los Ángeles',
    city: 'Cartagena de Indias',
    phone: '(605) 123-4567',
    website: 'www.xiaomi.com',
    footerMessage: '¡Gracias por tu compra!',
    warrantyMessage: 'Conserva este ticket para tu garantía',
    schedule: 'Lunes a Viernes: 9:00 AM - 7:00 PM',
    exchangeRate: 4200,
    showUSD: false,
    nit: '1043345642-7',
    addiMode: 'automatic' as 'automatic' | 'whatsapp'
  });
  
  const [isTicketSaving, setIsTicketSaving] = useState(false);
  const [showLowStockModal, setShowLowStockModal] = useState(false);

  useEffect(() => {
    if (ticketConfig && !isTicketSaving) {
      setTicketForm({
        storeName: ticketConfig.storeName || 'XIAOMI STORE',
        tagline: ticketConfig.tagline || 'Tecnología Premium',
        address: ticketConfig.address || 'Cl. 31 #61-64, Los Ángeles',
        city: ticketConfig.city || 'Cartagena de Indias',
        phone: ticketConfig.phone || '(605) 123-4567',
        website: ticketConfig.website || 'www.xiaomi.com',
        footerMessage: ticketConfig.footerMessage || '¡Gracias por tu compra!',
        warrantyMessage: ticketConfig.warrantyMessage || 'Conserva este ticket para tu garantía',
        schedule: ticketConfig.schedule || 'Lunes a Viernes: 9:00 AM - 7:00 PM',
        exchangeRate: ticketConfig.exchangeRate ?? 4200,
        showUSD: ticketConfig.showUSD ?? false,
        nit: ticketConfig.nit || '1043345642-7',
        addiMode: ticketConfig.addiMode || 'automatic'
      });
    }
  }, [ticketConfig]);

  const handleTicketConfigSave = async () => {
    setIsTicketSaving(true);
    try {
      const dataToSave = { ...ticketForm };
      await updateTicketConfig(dataToSave);
      toast.success('Configuración del ticket guardada');
      setTimeout(() => setIsTicketSaving(false), 1000);
    } catch (error) {
      console.error('Error saving ticket config:', error);
      toast.error('Error al guardar la configuración');
      setIsTicketSaving(false);
    }
  };

  const handleLogout = () => {
    toast('¿Cerrar sesión?', {
      action: {
        label: 'Sí, salir',
        onClick: () => {
          localStorage.removeItem('adminToken');
          localStorage.removeItem('adminUser');
          navigate('/login-admin');
        }
      },
      cancel: { label: 'Cancelar', onClick: () => {} },
      duration: 5000,
    });
  };
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSavingProduct, setIsSavingProduct] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    category: 'moviles',
    price: '',
    description: '',
    image: '',
    stock: '',
    isFeatured: false
  });
  const [colorVariants, setColorVariants] = useState<ColorVariant[]>([]);
  const [newColor, setNewColor] = useState({ color: '', colorHex: '#000000', stock: '' });
  const [storageVariants, setStorageVariants] = useState<StorageVariant[]>([]);
  const [newStorage, setNewStorage] = useState({ storage: '', price: '', stock: '' });
  const [specifications, setSpecifications] = useState<{ key: string; value: string }[]>([]);
  const [newSpecKey, setNewSpecKey] = useState('');
  const [newSpecValue, setNewSpecValue] = useState('');

  const [selectedBannerIndex, setSelectedBannerIndex] = useState(0);
  const defaultBanner: Banner = {
    title: '',
    subtitle: '',
    description: '',
    buttonText: '',
    buttonLink: '',
    backgroundImage: ''
  };
  const [bannerForm, setBannerForm] = useState<Banner>(defaultBanner);

  // Sincronizar el formulario del banner cuando cambian los banners
  useEffect(() => {
    if (banners.length > 0) {
      if (banners[selectedBannerIndex]) {
        setBannerForm(banners[selectedBannerIndex]);
      } else {
        setSelectedBannerIndex(0);
        setBannerForm(banners[0]);
      }
    }
  }, [banners, selectedBannerIndex]);

  // WebSocket deshabilitado — Socket.io no funciona en Vercel Serverless.
  // Las notificaciones de nuevas órdenes se actualizan con el polling normal de loadAdminData.

  const categories = [
    { value: 'moviles', label: 'Móviles' },
    { value: 'smartwatch', label: 'Smartwatch' },
    { value: 'audifonos', label: 'Audífonos' },
    { value: 'tablet', label: 'Tablets' },
    { value: 'accesorios', label: 'Estilo de Vida' },
    { value: 'scooter', label: 'Scooter' },
    { value: 'poco', label: 'POCO' }
  ];

  const handleOpenDialog = (product?: Product, defaultCategory?: string) => {
    if (product) {
      setEditingProduct(product);
      setFormData({
        name: product.name,
        category: product.category,
        price: product.price.toString(),
        description: product.description,
        image: product.image,
        stock: product.stock.toString(),
        isFeatured: product.isFeatured || false
      });
      setColorVariants(product.colorVariants || []);
      setStorageVariants(product.storageVariants || []);
      if (product.specifications) {
        const specsArray = Object.entries(product.specifications).map(([key, value]) => ({ key, value: value as string }));
        setSpecifications(specsArray);
      } else {
        setSpecifications([]);
      }
    } else {
      setEditingProduct(null);
      setFormData({
        name: '',
        category: defaultCategory || 'moviles',
        price: '',
        description: '',
        image: '',
        stock: '',
        isFeatured: false
      });
      setColorVariants([]);
      setStorageVariants([]);
      setSpecifications([]);
    }
    setNewColor({ color: '', colorHex: '#000000', stock: '' });
    setNewStorage({ storage: '', price: '', stock: '' });
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingProduct(null);
    setIsSavingProduct(false);
    setImageUploading(false);
    setFormData({
      name: '',
      category: 'moviles',
      price: '',
      description: '',
      image: '',
      stock: '',
      isFeatured: false,
    });
    setColorVariants([]);
    setStorageVariants([]);
    setSpecifications([]);
    setNewColor({ color: '', colorHex: '#000000', stock: '' });
    setNewStorage({ storage: '', price: '', stock: '' });
    if (imageFileInputRef.current) {
      imageFileInputRef.current.value = '';
    }
  };

  const handleAddColor = () => {
    if (!newColor.color.trim()) {
      toast.error('Por favor ingresa un nombre para el color');
      return;
    }
    if (!newColor.stock || parseInt(newColor.stock) < 0) {
      toast.error('Por favor ingresa una cantidad válida');
      return;
    }
    
    setColorVariants([...colorVariants, {
      color: newColor.color.trim(),
      colorHex: newColor.colorHex,
      stock: parseInt(newColor.stock)
    }]);
    setNewColor({ color: '', colorHex: '#000000', stock: '' });
  };

  const handleRemoveColor = (index: number) => {
    setColorVariants(colorVariants.filter((_, i) => i !== index));
  };

  const handleUpdateColorStock = (index: number, newStock: number) => {
    if (newStock < 0) return;
    const updated = [...colorVariants];
    updated[index] = { ...updated[index], stock: newStock };
    setColorVariants(updated);
  };

  const handleAddStorage = () => {
    if (!newStorage.storage.trim()) {
      toast.error('Por favor ingresa una capacidad de almacenamiento (ej: 128GB)');
      return;
    }
    if (!newStorage.price || parseFloat(newStorage.price) <= 0) {
      toast.error('Por favor ingresa un precio válido mayor a 0');
      return;
    }
    const stockVal = newStorage.stock ? parseInt(newStorage.stock) : 0;
    if (isNaN(stockVal) || stockVal < 0) {
      toast.error('Por favor ingresa una cantidad de stock válida (0 o más)');
      return;
    }
    
    setStorageVariants([...storageVariants, {
      storage: newStorage.storage.trim(),
      price: parseFloat(newStorage.price),
      stock: stockVal
    }]);
    setNewStorage({ storage: '', price: '', stock: '' });
  };

  const handleRemoveStorage = (index: number) => {
    setStorageVariants(storageVariants.filter((_, i) => i !== index));
  };

  const handleUpdateStorageStock = (index: number, newStock: number) => {
    if (newStock < 0) return;
    const updated = [...storageVariants];
    updated[index] = { ...updated[index], stock: newStock };
    setStorageVariants(updated);
  };

  const handleUpdateStoragePrice = (index: number, newPrice: number) => {
    if (newPrice <= 0) return;
    const updated = [...storageVariants];
    updated[index] = { ...updated[index], price: newPrice };
    setStorageVariants(updated);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Por favor selecciona un archivo de imagen válido');
      e.target.value = '';
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      toast.error('La imagen es muy grande. El tamaño máximo es 8MB');
      e.target.value = '';
      return;
    }

    setImageUploading(true);
    try {
      const compressed = await compressImageFile(file);
      setFormData(prev => ({ ...prev, image: compressed }));
      toast.success('Imagen lista. Guarda el producto para subirla al servidor.');
    } catch {
      toast.error('No se pudo procesar la imagen. Prueba con otro archivo.');
      e.target.value = '';
    } finally {
      setImageUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isSavingProduct) return;
    
    if (!formData.image) {
      toast.error('Por favor selecciona una imagen o ingresa una URL');
      return;
    }
    
    // Calcular stock total
    let totalStock = parseInt(formData.stock);
    
    // Si hay variantes de almacenamiento, usar su stock total
    if (storageVariants.length > 0) {
      totalStock = storageVariants.reduce((sum, variant) => sum + variant.stock, 0);
    } 
    // Si solo hay variantes de colores, usar su stock total
    else if (colorVariants.length > 0) {
      totalStock = colorVariants.reduce((sum, variant) => sum + variant.stock, 0);
    }
    
    const productData: any = {
      name: formData.name,
      category: formData.category,
      price: parseFloat(formData.price),
      description: formData.description,
      image: formData.image,
      stock: totalStock,
      isFeatured: formData.isFeatured
    };
    
    // Agregar variantes de colores si existen
    if (colorVariants.length > 0) {
      productData.colorVariants = colorVariants;
    }
    
    // Agregar variantes de almacenamiento si existen
    if (storageVariants.length > 0) {
      productData.storageVariants = storageVariants;
    }
    
    // Agregar especificaciones técnicas si existen
    if (specifications.length > 0) {
      const specsObj: Record<string, string> = {};
      specifications.forEach(spec => {
        specsObj[spec.key] = spec.value;
      });
      productData.specifications = specsObj;
    }

    setIsSavingProduct(true);
    try {
      if (editingProduct) {
        await updateProduct(editingProduct.id, productData);
      } else {
        await addProduct(productData);
      }
      handleCloseDialog();
    } catch {
      // El toast de error ya lo muestra addProduct/updateProduct del contexto
    } finally {
      setIsSavingProduct(false);
    }
  };

  const handleDelete = (id: string) => {
    toast('¿Eliminar este producto?', {
      action: {
        label: 'Sí, eliminar',
        onClick: () => deleteProduct(id)
      },
      cancel: { label: 'Cancelar', onClick: () => {} },
      duration: 5000,
    });
  };

  const handleBannerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (bannerForm._id) {
      updateBanner(bannerForm._id, bannerForm);
      // El toast de éxito lo muestra updateBanner del contexto
    } else {
      toast.error('El banner no tiene un ID válido');
    }
  };

  const handleSelectBanner = (index: number) => {
    setSelectedBannerIndex(index);
    setBannerForm(banners[index]);
  };

  const handleAddNewBanner = () => {
    const newBanner: Banner = {
      title: 'Nuevo Banner',
      subtitle: 'Subtítulo',
      description: 'Descripción del banner',
      buttonText: 'Ver Más',
      buttonLink: '/moviles',
      backgroundImage: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1920'
    };
    addBanner(newBanner);
    setSelectedBannerIndex(banners.length); // Seleccionar el nuevo banner
    setBannerForm(newBanner);
  };

  const handleExportBackup = () => {
    const backupData = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      products: localStorage.getItem('xiaomi-products'),
      banners: localStorage.getItem('xiaomi-banners'),
      orders: localStorage.getItem('xiaomi-orders'),
      cart: localStorage.getItem('xiaomi-cart'),
      notifications: localStorage.getItem('xiaomi-notifications'),
      lastReadOrderTime: localStorage.getItem('xiaomi-last-read-order-time')
    };

    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `xiaomi-cartagena-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Respaldo exportado exitosamente');
  };

  const handleImportBackup = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const backupData = JSON.parse(e.target?.result as string);

        if (backupData.products) localStorage.setItem('xiaomi-products', backupData.products);
        if (backupData.banners) localStorage.setItem('xiaomi-banners', backupData.banners);
        if (backupData.orders) localStorage.setItem('xiaomi-orders', backupData.orders);
        if (backupData.cart) localStorage.setItem('xiaomi-cart', backupData.cart);
        if (backupData.notifications) localStorage.setItem('xiaomi-notifications', backupData.notifications);
        if (backupData.lastReadOrderTime) localStorage.setItem('xiaomi-last-read-order-time', backupData.lastReadOrderTime);

        toast.success('Respaldo restaurado. Recargando...');
        window.location.reload();
      } catch (error) {
        toast.error('Error al importar el respaldo. Verifica que el archivo sea válido.');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const handleDeleteBanner = () => {
    if (banners.length <= 1) {
      toast.error('Debe haber al menos un banner en el carrusel');
      return;
    }
    toast(`¿Eliminar el Banner ${selectedBannerIndex + 1}?`, {
      action: {
        label: 'Sí, eliminar',
        onClick: () => {
          const bannerId = banners[selectedBannerIndex]?._id;
          if (bannerId) deleteBanner(bannerId);
          const newIndex = selectedBannerIndex > 0 ? selectedBannerIndex - 1 : 0;
          setSelectedBannerIndex(newIndex);
          if (banners[newIndex]) setBannerForm(banners[newIndex]);
        }
      },
      cancel: { label: 'Cancelar', onClick: () => {} },
      duration: 5000,
    });
  };

  // Agrupar productos por categoría
  const productsByCategory = categories.map(cat => ({
    ...cat,
    products: products.filter(p => p.category === cat.value)
  }));

  const lowStockProducts = products.filter(p => p.stock < 10);

  const todayDateStr = new Date().toLocaleDateString('es-CO', { timeZone: 'America/Bogota' });
  const todayOrdersCount = orders?.filter(o => {
    try {
      const d = o.createdAt ? new Date(o.createdAt) : new Date(o.date);
      return d.toLocaleDateString('es-CO', { timeZone: 'America/Bogota' }) === todayDateStr;
    } catch {
      return false;
    }
  }).length || 0;

  // Si el WhatsApp de cobranza está caído no sale ningún recordatorio de cuotas,
  // así que lo marcamos en la propia pestaña: es visible sin tener que entrar.
  const credilockConectado = useCredilockConectado();

  return (
    <div className="min-h-screen bg-gray-50">
      {/*
        Cabecera fija. En el móvil es una sola franja de 56px: el título largo y el
        subtítulo explicativo se ocultan porque quien entra aquí ya sabe dónde está,
        y ese espacio vale más para los datos. "Cerrar sesión" pasa a ser un icono
        con su aria-label para no robar ancho al título.
      */}
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-gray-900 sm:text-2xl sm:font-light">
              <span className="sm:hidden">Panel</span>
              <span className="hidden sm:inline">Panel de Administración</span>
            </h1>
            <p className="hidden text-sm font-light text-gray-600 sm:block">
              Gestiona el catálogo de productos y el banner publicitario
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            {/* La campana de avisos de pedido nuevo vivía en la cabecera de la
                tienda, que esta pantalla ya no monta. Sin esto el dueño se
                quedaba sin aviso de que ha entrado una orden. */}
            <NotificationBell />
            <button
              onClick={handleLogout}
              aria-label="Cerrar sesión"
              className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-red-500 px-3 text-sm font-medium text-white transition-colors hover:bg-red-600 active:bg-red-700 sm:px-4"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Cerrar Sesión</span>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-8">

      <Tabs defaultValue="products" className="w-full">
        {/*
          En el móvil esto es una tira que se desliza en horizontal, no una rejilla.
          Antes eran 12 pestañas en 3 columnas: cuatro filas de 29px de alto que se
          comían media pantalla antes de ver un solo dato, con los globos de aviso
          recortados por el borde de la celda. Ahora cada pestaña mide 44px de alto
          (el mínimo táctil de iOS y Android) y el icono permite reconocerla de un
          vistazo sin leer. A partir de lg vuelve a ser rejilla, que en escritorio
          sí cabe entera y es más cómoda.
        */}
        <div className="relative -mx-4 mb-5 sm:mx-0 sm:mb-6 lg:mb-8">
          {/* Degradado en el borde derecho: la única pista de que la tira sigue. */}
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-gray-50 to-transparent lg:hidden" />
          <TabsList className="flex h-auto w-full snap-x snap-mandatory justify-start gap-2 overflow-x-auto rounded-none bg-transparent px-4 py-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:px-0 lg:grid lg:grid-cols-6 lg:overflow-visible lg:rounded-xl lg:bg-muted lg:p-1.5 [&::-webkit-scrollbar]:hidden">
            {SECCIONES_ADMIN.map(({ value, label, icon: Icono, clase }) => (
              <TabsTrigger
                key={value}
                value={value}
                className={`relative h-11 flex-none shrink-0 snap-start gap-2 rounded-xl border border-gray-200 bg-white px-3.5 text-[13px] font-medium shadow-sm data-[state=active]:border-transparent data-[state=active]:shadow lg:h-10 lg:flex-1 lg:shrink lg:border-transparent lg:bg-transparent lg:px-2 lg:shadow-none ${clase ?? ''}`}
              >
                <Icono className="h-4 w-4 shrink-0" />
                {label}
                {value === 'orders' && todayOrdersCount > 0 && (
                  <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white">
                    {todayOrdersCount}
                  </span>
                )}
                {value === 'financing' && credilockConectado === false && (
                  <span
                    title="El WhatsApp de CrediLock está desconectado: los recordatorios de cuotas NO se están enviando."
                    className="ml-0.5 inline-flex h-5 w-5 animate-pulse items-center justify-center rounded-full bg-red-500 text-[11px] font-bold text-white"
                  >
                    !
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* TAB DE ÓRDENES */}
        <TabsContent value="orders">
          <OrdersManager />
        </TabsContent>

        {/* TAB DE FINANCIAMIENTO / CUOTAS */}
        <TabsContent value="financing">
          <FinancingManager />
        </TabsContent>

        {/* TAB DE INVENTARIO */}
        <TabsContent value="inventario">
          <InventarioPanel />
        </TabsContent>

        {/* TAB DE LINKS VIP */}
        <TabsContent value="links">
          <AdminLinkGenerator />
        </TabsContent>

        {/* TAB DE ESTADÍSTICAS */}
        <TabsContent value="stats">
          <StatisticsDashboard />
        </TabsContent>

        <TabsContent value="reviews">
          <ReviewsManager />
        </TabsContent>

        {/* TAB WHATSAPP */}
        <TabsContent value="whatsapp">
          <WhatsAppPanel />
        </TabsContent>

        {/* TAB DE PRODUCTOS */}
        <TabsContent value="products">
          <div className="mb-4 sm:mb-6">
            <h2 className="text-xl font-semibold text-gray-800 sm:text-2xl">Gestión de Productos</h2>
          </div>

          {/*
            Resumen. Antes era una columna de cuatro tarjetas con p-6: en el móvil
            eran ~500px de alto para cuatro cifras, o sea media pantalla de scroll
            antes de llegar al catálogo. En dos columnas y con el padding ajustado
            caben las cuatro de un vistazo.
          */}
          <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4 md:mb-8">
        <div className="rounded-xl bg-white p-4 shadow-sm sm:p-6">
          <div className="mb-1 text-xs text-gray-500 sm:text-sm">Total Productos</div>
          <div className="text-2xl font-bold text-orange-400 sm:text-3xl">{products.length}</div>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm sm:p-6">
          <div className="mb-1 text-xs text-gray-500 sm:text-sm">Valor Inventario</div>
          {/* "COP" va en su propia línea en el móvil: a media pantalla
              "$207.039.894 COP" seguido se salía de la tarjeta. */}
          <div className="text-lg leading-tight font-bold break-all text-green-500 sm:text-2xl sm:break-normal">
            ${Math.round(products.reduce((sum, p) => sum + (p.price * p.stock), 0)).toLocaleString('es-CO')}
            <span className="block text-xs font-semibold text-green-600/70 sm:ml-1 sm:inline">COP</span>
          </div>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm sm:p-6">
          <div className="mb-1 text-xs text-gray-500 sm:text-sm">Stock Total</div>
          <div className="text-2xl font-bold text-blue-500 sm:text-3xl">
            {products.reduce((sum, p) => sum + p.stock, 0)}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowLowStockModal(true)}
          className="group rounded-xl border border-transparent bg-white p-4 text-left shadow-sm transition-all duration-200 hover:border-red-100 hover:bg-red-50 hover:shadow-md active:bg-red-50 sm:p-6"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="mb-1 text-xs text-gray-500 transition-colors group-hover:text-red-600 sm:text-sm">Stock Bajo</div>
              <div className="text-2xl font-bold text-red-500 sm:text-3xl">
                {lowStockProducts.length}
              </div>
            </div>
            <div className="shrink-0 rounded-lg bg-red-100 p-1.5 text-red-500 transition-transform group-hover:scale-110 sm:p-2">
              <Package className="h-5 w-5 sm:h-6 sm:w-6" />
            </div>
          </div>
          <div className="mt-2 flex items-center gap-1 text-xs font-medium text-red-500/80 sm:mt-4">
            Ver detalles <span className="text-[10px]">▶</span>
          </div>
        </button>
          </div>

          {/* Products by Category */}
          <div className="space-y-6">
        {productsByCategory.map(category => (
          <div key={category.value} className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between gap-3 bg-gradient-to-r from-orange-400 to-orange-500 px-4 py-3 text-white sm:px-6 sm:py-4">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-bold sm:text-xl">{category.label}</h2>
                <p className="text-sm text-orange-100">{category.products.length} productos</p>
              </div>
              {/* En el móvil el botón se queda en el icono "+": repetir el nombre de
                  la categoría que está justo al lado se comía la mitad del ancho. */}
              <Button
                onClick={() => handleOpenDialog(undefined, category.value)}
                aria-label={`Agregar en ${category.label}`}
                className="h-11 shrink-0 gap-2 border-2 border-white/40 bg-white/20 px-3 text-white backdrop-blur-sm hover:bg-white/30 sm:px-4"
              >
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Agregar en {category.label}</span>
              </Button>
            </div>

            {/*
              MÓVIL: tarjetas. La tabla medía 962px dentro de una pantalla de 390px,
              así que el `overflow-x-auto` dejaba a la vista solo la columna del
              nombre: para editar o borrar había que arrastrar de lado hasta la
              quinta columna, en cada producto. Con tarjetas todo queda accesible sin
              desplazamiento lateral. La tabla sigue existiendo de md hacia arriba,
              donde sí cabe y es más densa de leer.
            */}
            <ul className="divide-y divide-gray-200 md:hidden">
              {category.products.length > 0 ? (
                category.products.map(product => (
                  <li key={product.id} className="flex gap-3 p-4">
                    <img
                      src={product.image}
                      alt={product.name}
                      className="h-14 w-14 shrink-0 rounded-lg object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      {/* `truncate` dejaba el nombre en una línea de 172px y se
                          comía hasta 37px: "Redmi Note 15 Pro 5G 256GB" perdía
                          justo el almacenamiento, que es lo que distingue una
                          variante de otra en el inventario. Con dos líneas
                          caben todos los nombres del catálogo. */}
                      <div className="line-clamp-2 font-medium text-gray-900">{product.name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-semibold text-orange-500">
                          ${Math.round(product.price).toLocaleString('es-CO')}
                        </span>
                        <span className="inline-flex items-center gap-1 text-sm">
                          <Package className="h-3.5 w-3.5 text-gray-400" />
                          <span className={product.stock < 10 ? 'font-semibold text-red-600' : 'text-gray-600'}>
                            {product.stock}
                          </span>
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-gray-500">{product.description}</p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label={`Editar ${product.name}`}
                        onClick={() => handleOpenDialog(product)}
                        className="h-11 w-11 text-blue-600 hover:bg-blue-50 hover:text-blue-700"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label={`Eliminar ${product.name}`}
                        onClick={() => handleDelete(product._id || product.id)}
                        className="h-11 w-11 text-red-600 hover:bg-red-50 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                ))
              ) : (
                <li className="px-6 py-10 text-center">
                  <Package className="mx-auto mb-3 h-12 w-12 text-gray-300" />
                  <p className="mb-2 text-gray-500">No hay productos en esta categoría</p>
                  <p className="text-sm text-gray-400">Usa el botón “+” de arriba para comenzar</p>
                </li>
              )}
            </ul>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Producto
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Precio
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Stock
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Descripción
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {category.products.length > 0 ? (
                    category.products.map(product => (
                      <tr key={product.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <img 
                              src={product.image} 
                              alt={product.name}
                              className="w-12 h-12 rounded-lg object-cover mr-3"
                            />
                            <div className="font-medium text-gray-900">{product.name}</div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex flex-col">
                            <div className="text-base font-semibold text-orange-400">
                              ${Math.round(product.price).toLocaleString('es-CO')} COP
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <Package className="w-4 h-4 text-gray-400" />
                            <span className={product.stock < 10 ? 'text-red-600 font-semibold' : 'text-gray-900'}>
                              {product.stock}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-gray-500 max-w-xs truncate">
                            {product.description}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleOpenDialog(product)}
                              className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDelete(product._id || product.id)}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center">
                        <Package className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                        <p className="text-gray-500 mb-2">No hay productos en esta categoría</p>
                        <p className="text-sm text-gray-400">Usa el botón "Agregar en {category.label}" para comenzar</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ))}
          </div>
        </TabsContent>

        {/* TAB DE BANNER PUBLICITARIO */}
        <TabsContent value="banner">
          <div className="max-w-6xl">
            <h2 className="mb-4 text-xl font-semibold text-gray-800 sm:mb-6 sm:text-2xl">Configurar Banners Publicitarios</h2>
            
            {/* Selector de Banner */}
            <div className="mb-6 bg-white rounded-xl shadow-sm p-4">
              {/* Apilado en el móvil: compartiendo fila con el botón, el título
                  se partía en tres líneas y la fila quedaba desequilibrada. */}
              <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <Label className="text-base font-semibold">Seleccionar Banner para Editar</Label>
                <Button
                  type="button"
                  onClick={handleAddNewBanner}
                  className="w-full shrink-0 bg-green-500 text-white hover:bg-green-600 sm:w-auto"
                  size="sm"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Agregar Nuevo Banner
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {banners.map((banner, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => handleSelectBanner(index)}
                    className={`relative rounded-lg overflow-hidden border-4 transition-all ${
                      selectedBannerIndex === index 
                        ? 'border-orange-500 shadow-lg' 
                        : 'border-gray-200 hover:border-orange-300'
                    }`}
                  >
                    <div 
                      className="h-32 flex items-center justify-center"
                      style={{
                        backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.5)), url(${banner.backgroundImage})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center'
                      }}
                    >
                      <div className="text-white text-center p-2">
                        <div className="text-xs font-semibold uppercase mb-1">Banner {index + 1}</div>
                        <div className="text-sm font-bold">{banner.title}</div>
                      </div>
                    </div>
                    {selectedBannerIndex === index && (
                      <div className="absolute top-2 right-2 bg-orange-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">
                        ✓
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Vista Previa del Banner */}
            <div className="mb-8">
              <Label className="text-lg mb-3 block">Vista Previa del Banner {selectedBannerIndex + 1}</Label>
              <div 
                className="relative rounded-2xl overflow-hidden min-h-[300px] flex items-center"
                style={{
                  backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.4), rgba(0, 0, 0, 0.4)), url(${bannerForm.backgroundImage})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center'
                }}
              >
                <div className="relative z-10 p-8 text-white">
                  <span className="text-sm font-semibold uppercase tracking-wide mb-2 block">
                    {bannerForm.subtitle}
                  </span>
                  <h1 className="text-4xl font-bold mb-3">
                    {bannerForm.title}
                  </h1>
                  <p className="text-lg text-gray-100 mb-4">
                    {bannerForm.description}
                  </p>
                  <div className="inline-flex items-center gap-2 bg-orange-400 text-white px-6 py-3 rounded-lg font-semibold">
                    {bannerForm.buttonText}
                  </div>
                </div>
              </div>
            </div>

            {/* Formulario de Edición */}
            <form onSubmit={handleBannerSubmit} className="bg-white rounded-xl shadow-sm p-4 sm:p-6 space-y-6">
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-4 flex items-center justify-between">
                <p className="text-sm text-orange-800">
                  <strong>Editando Banner {selectedBannerIndex + 1}:</strong> {bannerForm.title}
                </p>
                {banners.length > 1 && (
                  <Button
                    type="button"
                    onClick={handleDeleteBanner}
                    variant="outline"
                    size="sm"
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-300"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Eliminar Banner
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <Label htmlFor="banner-title">Título Principal</Label>
                  <Input
                    id="banner-title"
                    value={bannerForm.title}
                    onChange={(e) => setBannerForm({ ...bannerForm, title: e.target.value })}
                    required
                    placeholder="Ej: ¡Gran Oferta!"
                  />
                </div>

                <div>
                  <Label htmlFor="banner-subtitle">Subtítulo</Label>
                  <Input
                    id="banner-subtitle"
                    value={bannerForm.subtitle}
                    onChange={(e) => setBannerForm({ ...bannerForm, subtitle: e.target.value })}
                    required
                    placeholder="Ej: Descuentos de hasta 30%"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="banner-description">Descripción</Label>
                <Textarea
                  id="banner-description"
                  value={bannerForm.description}
                  onChange={(e) => setBannerForm({ ...bannerForm, description: e.target.value })}
                  rows={3}
                  required
                  placeholder="Describe la promoción o mensaje principal"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <Label htmlFor="banner-button-text">Texto del Botón</Label>
                  <Input
                    id="banner-button-text"
                    value={bannerForm.buttonText}
                    onChange={(e) => setBannerForm({ ...bannerForm, buttonText: e.target.value })}
                    required
                    placeholder="Ej: Ver Ofertas"
                  />
                </div>

                <div>
                  <Label htmlFor="banner-button-link">Enlace del Botón</Label>
                  <Select
                    value={bannerForm.buttonLink}
                    onValueChange={(value) => setBannerForm({ ...bannerForm, buttonLink: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="/">Inicio</SelectItem>
                      <SelectItem value="/moviles">Móviles</SelectItem>
                      <SelectItem value="/smartwatch">Smartwatch</SelectItem>
                      <SelectItem value="/audifonos">Audífonos</SelectItem>
                      <SelectItem value="/accesorios">Estilo de Vida</SelectItem>
                      <SelectItem value="/scooter">Scooter</SelectItem>
                      <SelectItem value="/poco">POCO</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label htmlFor="banner-bg-image">Imagen de Fondo (URL)</Label>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Input
                      id="banner-bg-image"
                      type="url"
                      value={bannerForm.backgroundImage}
                      onChange={(e) => setBannerForm({ ...bannerForm, backgroundImage: e.target.value })}
                      required
                      placeholder="https://..."
                    />
                  </div>
                  <ImageIcon className="w-10 h-10 text-gray-400" />
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  Recomendado: 1920x600px o superior
                </p>
              </div>

              <Button 
                type="submit" 
                className="w-full bg-orange-400 hover:bg-orange-500 text-white"
              >
                <Save className="w-4 h-4 mr-2" />
                Guardar Cambios del Banner
              </Button>
            </form>
          </div>
        </TabsContent>

        {/* TAB DE CONFIGURACIÓN DEL TICKET */}
        <TabsContent value="ticket">
          <div className="max-w-4xl">
            <h2 className="mb-4 text-xl font-semibold text-gray-800 sm:mb-6 sm:text-2xl">Configuración del Ticket</h2>
            
            <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <Label htmlFor="ticket-storeName">Nombre de la Tienda</Label>
                  <Input
                    id="ticket-storeName"
                    value={ticketForm.storeName}
                    onChange={(e) => setTicketForm({ ...ticketForm, storeName: e.target.value })}
                    placeholder="XIAOMI STORE"
                  />
                </div>
                <div>
                  <Label htmlFor="ticket-nit">NIT</Label>
                  <Input
                    id="ticket-nit"
                    value={ticketForm.nit || ''}
                    onChange={(e) => setTicketForm({ ...ticketForm, nit: e.target.value })}
                    placeholder="1043345642-7"
                  />
                </div>
                <div>
                  <Label htmlFor="ticket-addiMode">Modo Addi</Label>
                  <Select
                    value={ticketForm.addiMode}
                    onValueChange={(value: 'automatic' | 'whatsapp') => setTicketForm({ ...ticketForm, addiMode: value })}
                  >
                    <SelectTrigger id="ticket-addiMode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="automatic">Automático (API - Checkout)</SelectItem>
                      <SelectItem value="whatsapp">Manual (Redirigir a WhatsApp)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="ticket-tagline"> tagline</Label>
                  <Input
                    id="ticket-tagline"
                    value={ticketForm.tagline}
                    onChange={(e) => setTicketForm({ ...ticketForm, tagline: e.target.value })}
                    placeholder="Tecnología Premium"
                  />
                </div>
                <div>
                  <Label htmlFor="ticket-address">Dirección</Label>
                  <Input
                    id="ticket-address"
                    value={ticketForm.address}
                    onChange={(e) => setTicketForm({ ...ticketForm, address: e.target.value })}
                    placeholder="Cl. 31 #61-64, Los Ángeles"
                  />
                </div>
                <div>
                  <Label htmlFor="ticket-city">Ciudad</Label>
                  <Input
                    id="ticket-city"
                    value={ticketForm.city}
                    onChange={(e) => setTicketForm({ ...ticketForm, city: e.target.value })}
                    placeholder="Cartagena de Indias"
                  />
                </div>
                <div>
                  <Label htmlFor="ticket-phone">Teléfono</Label>
                  <Input
                    id="ticket-phone"
                    value={ticketForm.phone}
                    onChange={(e) => setTicketForm({ ...ticketForm, phone: e.target.value })}
                    placeholder="(605) 123-4567"
                  />
                </div>
                <div>
                  <Label htmlFor="ticket-website">Sitio Web</Label>
                  <Input
                    id="ticket-website"
                    value={ticketForm.website}
                    onChange={(e) => setTicketForm({ ...ticketForm, website: e.target.value })}
                    placeholder="www.xiaomi.com"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="ticket-footerMessage">Mensaje de Footer</Label>
                <Input
                  id="ticket-footerMessage"
                  value={ticketForm.footerMessage}
                  onChange={(e) => setTicketForm({ ...ticketForm, footerMessage: e.target.value })}
                  placeholder="¡Gracias por tu compra!"
                />
              </div>

              <div>
                <Label htmlFor="ticket-warrantyMessage">Mensaje de Garantía</Label>
                <Input
                  id="ticket-warrantyMessage"
                  value={ticketForm.warrantyMessage}
                  onChange={(e) => setTicketForm({ ...ticketForm, warrantyMessage: e.target.value })}
                  placeholder="Conserva este ticket para tu garantía"
                />
              </div>

              <div>
                <Label htmlFor="ticket-schedule">Horario de Atención</Label>
                <Input
                  id="ticket-schedule"
                  value={ticketForm.schedule}
                  onChange={(e) => setTicketForm({ ...ticketForm, schedule: e.target.value })}
                  placeholder="Lunes a Viernes: 9:00 AM - 7:00 PM"
                />
              </div>

              <Button onClick={handleTicketConfigSave} className="bg-orange-500 hover:bg-orange-600">
                <Save className="w-4 h-4 mr-2" />
                Guardar Configuración
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* TAB DE RESPALDO */}
        <TabsContent value="backup">
          <div className="max-w-4xl">
            <h2 className="mb-4 text-xl font-semibold text-gray-800 sm:mb-6 sm:text-2xl">Respaldo y Restauración</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Export/Backup */}
              <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                    <Upload className="w-6 h-6 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800">Exportar Respaldo</h3>
                    <p className="text-sm text-gray-500">Descargar todos los datos</p>
                  </div>
                </div>
                <p className="text-gray-600 text-sm mb-4">
                  Descarga un archivo JSON con todos los productos, banners, órdenes y configuraciones.
                </p>
                <Button
                  onClick={handleExportBackup}
                  className="w-full bg-blue-500 hover:bg-blue-600 text-white"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Descargar Respaldo
                </Button>
              </div>

              {/* Import/Restore */}
              <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                    <HardDrive className="w-6 h-6 text-green-600" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800">Restaurar Respaldo</h3>
                    <p className="text-sm text-gray-500">Cargar datos desde archivo</p>
                  </div>
                </div>
                <p className="text-gray-600 text-sm mb-4">
                  Restaura los datos desde un archivo de respaldo previamente exportado.
                  <span className="text-red-500 font-semibold"> ¡Cuidado! Esto sobrescribirá todos los datos actuales.</span>
                </p>
                <input
                  type="file"
                  id="backup-file"
                  accept=".json"
                  onChange={handleImportBackup}
                  className="hidden"
                />
                <label htmlFor="backup-file">
                  <Button
                    as="span"
                    className="w-full bg-green-500 hover:bg-green-600 text-white cursor-pointer"
                  >
                    <HardDrive className="w-4 h-4 mr-2" />
                    Seleccionar Archivo
                  </Button>
                </label>
              </div>
            </div>

            {/* Info Box */}
            <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-xl p-4">
              <h4 className="font-semibold text-yellow-800 mb-2">Información Importante</h4>
              <ul className="text-sm text-yellow-700 space-y-1">
                <li>• Los datos se almacenan en el navegador del cliente (localStorage)</li>
                <li>• Realiza backups periódicos para no perder datos</li>
                <li>• Si borras los datos del navegador, puedes restaurar con un backup</li>
                <li>• Comparte el archivo de backup solo con personas de confianza</li>
              </ul>
            </div>
          </div>
        </TabsContent>

        {/* TAB DE SISTEMA DE BLOQUEO */}
        <TabsContent value="blocking">
          <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6">
            <div className="py-8 text-center sm:py-12">
              <h2 className="mb-3 text-xl font-semibold text-gray-900 sm:mb-4 sm:text-2xl">Sistema de Bloqueo MDM</h2>
              <p className="mb-6 text-gray-600 sm:mb-8">
                Gestiona el control remoto de teléfonos y tabletas, bloqueo y modo kiosk
              </p>
              {/* Apilados en el móvil: los dos enlaces con su icono no caben en
                  una fila de 360px y el segundo se partía en dos líneas. */}
              <div className="flex flex-col justify-center gap-3 sm:flex-row sm:gap-4">
                <a
                  href="/admin/blocking/devices"
                  className="flex items-center justify-center gap-2 rounded-lg bg-[#ff6700] px-6 py-3 text-white hover:bg-[#e65d00]"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  Ver Dispositivos
                </a>
                <a
                  href="/admin/blocking/dashboard"
                  className="flex items-center justify-center gap-2 rounded-lg bg-gray-200 px-6 py-3 text-gray-800 hover:bg-gray-300"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                  </svg>
                  Dashboard
                </a>
              </div>
            </div>
          </div>
        </TabsContent>
        </Tabs>
      </div>

      {/* Product Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        {/* `dvh` y no `vh`: en el móvil la barra de direcciones del navegador se
            cuenta dentro de `vh`, así que con 90vh el botón de guardar quedaba
            justo por debajo del borde visible y parecía que no existía. */}
        <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-[600px]">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>
              {editingProduct ? 'Editar Producto' : 'Agregar Nuevo Producto'}
            </DialogTitle>
            <DialogDescription>
              {editingProduct 
                ? 'Modifica los detalles del producto existente' 
                : 'Completa la información para agregar un nuevo producto al catálogo'}
            </DialogDescription>
          </DialogHeader>
          
          <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto flex-1 pr-2">
            <div>
              <Label htmlFor="name">Nombre del Producto</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>

            <div>
              <Label htmlFor="category">Categoría</Label>
              <Select
                value={formData.category}
                onValueChange={(value) => setFormData({ ...formData, category: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map(cat => (
                    <SelectItem key={cat.value} value={cat.value}>
                      {cat.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Apilados en el móvil: a 180px de ancho la etiqueta de stock
                ("calculado automáticamente por colores") ocupaba cuatro líneas. */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="price">Precio (COP)</Label>
                <Input
                  id="price"
                  type="number"
                  step="100"
                  value={formData.price}
                  onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                  required
                  placeholder="Ej: 1500000"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Precio en Pesos Colombianos
                </p>
              </div>

              <div>
                <Label htmlFor="stock">
                  Stock {colorVariants.length > 0 && '(calculado automáticamente por colores)'}
                </Label>
                <Input
                  id="stock"
                  type="number"
                  value={colorVariants.length > 0 ? colorVariants.reduce((sum, v) => sum + v.stock, 0) : formData.stock}
                  onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
                  required
                  disabled={colorVariants.length > 0}
                  className={colorVariants.length > 0 ? 'bg-gray-100' : ''}
                />
                {colorVariants.length > 0 && (
                  <p className="text-xs text-gray-500 mt-1">
                    El stock total se calcula sumando las cantidades de todos los colores
                  </p>
                )}
              </div>
            </div>

            {/* La casilla mide 20px a propósito: una de 44px se vería enorme
                al lado del texto. El área táctil real es el <Label htmlFor>
                de abajo, que con `flex-1` y su descripción cubre toda la fila
                (bastante más de 44px) y alterna la casilla al tocarlo. */}
            <div className="flex items-center space-x-2 bg-orange-50 p-4 rounded-lg border border-orange-100 mb-6">
              <input
                type="checkbox"
                id="isFeatured"
                checked={formData.isFeatured}
                onChange={(e) => setFormData({ ...formData, isFeatured: e.target.checked })}
                className="w-5 h-5 shrink-0 text-orange-500 rounded border-gray-300 focus:ring-orange-500"
              />
              <Label htmlFor="isFeatured" className="text-base font-medium cursor-pointer flex-1">
                Marcar como Producto Destacado
                <p className="text-sm font-normal text-gray-500 mt-1">Este producto aparecerá en la sección principal de "Productos Destacados" en la página de inicio.</p>
              </Label>
            </div>

            {/* Sección de Variantes de Color */}
            <div className="border-2 border-gray-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-4">
                <Palette className="w-5 h-5 text-orange-500" />
                <Label className="text-base font-medium">Variantes de Color (Opcional)</Label>
              </div>
              
              {/* Lista de colores actuales.
                  Muestra + nombre + stock + borrar en una sola fila sólo caben
                  en escritorio: dentro del diálogo la fila se iba 106px por
                  fuera del borde y el grupo de stock quedaba cortado. En móvil
                  el stock baja a su propia línea. */}
              {colorVariants.length > 0 && (
                <div className="space-y-2 mb-4">
                  {colorVariants.map((variant, index) => (
                    <div key={index} className="flex flex-wrap items-center gap-2 bg-gray-50 p-3 rounded-lg sm:flex-nowrap">
                      <div
                        className="w-8 h-8 shrink-0 rounded border-2 border-gray-300"
                        style={{ backgroundColor: variant.colorHex }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm break-words">{variant.color}</p>
                        <p className="text-xs text-gray-600">{variant.colorHex}</p>
                      </div>
                      <div className="flex w-full items-center gap-2 sm:w-auto">
                        <Input
                          type="number"
                          value={variant.stock}
                          onChange={(e) => handleUpdateColorStock(index, parseInt(e.target.value))}
                          className="w-20 flex-1 sm:flex-none"
                          min="0"
                        />
                        <span className="text-sm text-gray-600">uds</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveColor(index)}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              {/* Agregar nuevo color */}
              <div className="space-y-3">
                <p className="text-sm text-gray-600">Agregar nueva variante</p>
                {/* Las cuatro columnas en una sola fila sólo caben en escritorio:
                    dentro del diálogo (319px en un móvil de 360) al campo del
                    nombre le quedaban unos 80px y el placeholder era ilegible.
                    En móvil el nombre ocupa su propia fila y debajo van color,
                    stock y el botón de añadir. */}
                <div className="grid grid-cols-[auto,1fr,auto] gap-2 sm:grid-cols-[1fr,auto,auto,auto]">
                  <Input
                    placeholder="Nombre del color (ej: Negro, Azul)"
                    value={newColor.color}
                    onChange={(e) => setNewColor({ ...newColor, color: e.target.value })}
                    className="col-span-3 sm:col-span-1"
                  />
                  <div className="flex items-center gap-1">
                    {/* El selector de color medía 40px: justo por debajo del
                        mínimo táctil. 44px en móvil, 40px de sm hacia arriba. */}
                    <input
                      type="color"
                      value={newColor.colorHex}
                      onChange={(e) => setNewColor({ ...newColor, colorHex: e.target.value })}
                      className="h-11 w-11 rounded cursor-pointer sm:w-10 sm:h-10"
                    />
                  </div>
                  <Input
                    type="number"
                    placeholder="Stock"
                    value={newColor.stock}
                    onChange={(e) => setNewColor({ ...newColor, stock: e.target.value })}
                    className="w-full sm:w-24"
                    min="0"
                  />
                  <Button
                    type="button"
                    onClick={handleAddColor}
                    size="sm"
                    className="bg-orange-500 hover:bg-orange-600 text-white"
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-xs text-gray-500">
                  Si agregas colores, el stock general se deshabilitará y se calculará automáticamente
                </p>
              </div>
            </div>

            {/* Variantes de Almacenamiento */}
            <div className="border-2 border-gray-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-4">
                <HardDrive className="w-5 h-5 text-blue-500" />
                <Label className="text-base font-medium">Variantes de Almacenamiento (Opcional)</Label>
              </div>
              
              {/* Lista de almacenamientos actuales.
                  Nombre + precio + COP + stock + uds + borrar en una sola fila
                  necesitan unos 300px: dentro del diálogo (272px útiles en un
                  móvil de 360) se salían 106px por fuera del borde. En móvil el
                  nombre se queda arriba y precio/stock/borrar bajan a su propia
                  línea repartiéndose el ancho. */}
              {storageVariants.length > 0 && (
                <div className="space-y-2 mb-4">
                  {storageVariants.map((variant, index) => (
                    <div key={index} className="flex flex-wrap items-center gap-2 bg-gray-50 p-3 rounded-lg sm:flex-nowrap">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm break-words">{variant.storage}</p>
                        <p className="text-xs text-gray-600">${variant.price.toLocaleString('es-CO')} COP</p>
                      </div>
                      <div className="flex w-full items-center gap-2 sm:w-auto">
                        <div className="flex min-w-0 flex-1 items-center gap-1 sm:flex-none">
                          <Input
                            type="number"
                            value={variant.price}
                            onChange={(e) => handleUpdateStoragePrice(index, parseFloat(e.target.value))}
                            className="w-full text-xs sm:w-24 sm:h-8"
                            min="0"
                            step="100"
                            placeholder="COP"
                          />
                          <span className="shrink-0 text-xs text-gray-600">COP</span>
                        </div>
                        <div className="flex min-w-0 flex-1 items-center gap-1 sm:flex-none">
                          <Input
                            type="number"
                            value={variant.stock}
                            onChange={(e) => handleUpdateStorageStock(index, parseInt(e.target.value))}
                            className="w-full sm:w-20"
                            min="0"
                          />
                          <span className="shrink-0 text-sm text-gray-600">uds</span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveStorage(index)}
                          className="shrink-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              {/* Agregar nuevo almacenamiento */}
              <div className="space-y-3">
                <p className="text-sm text-gray-600">Agregar nueva variante</p>
                <div className="grid grid-cols-[1fr,auto,auto,auto] gap-2">
                  <Input
                    placeholder="Capacidad (ej: 128GB, 256GB)"
                    value={newStorage.storage}
                    onChange={(e) => setNewStorage({ ...newStorage, storage: e.target.value })}
                  />
                  <Input
                    type="number"
                    placeholder="Precio COP"
                    value={newStorage.price}
                    onChange={(e) => setNewStorage({ ...newStorage, price: e.target.value })}
                    className="w-28"
                    min="0"
                    step="100"
                  />
                  <Input
                    type="number"
                    placeholder="Stock"
                    value={newStorage.stock}
                    onChange={(e) => setNewStorage({ ...newStorage, stock: e.target.value })}
                    className="w-24"
                    min="0"
                  />
                  <Button
                    type="button"
                    onClick={handleAddStorage}
                    size="sm"
                    className="bg-orange-500 hover:bg-orange-600 text-white"
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-xs text-gray-500">
                  💡 Cada variante de almacenamiento puede tener un precio diferente. El precio base se usará si no hay variantes.
                </p>
              </div>
            </div>

            {/* Especificaciones del Producto */}
            <div className="border-2 border-gray-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-4">
                <Cpu className="w-5 h-5 text-purple-500" />
                <Label className="text-base font-medium">Especificaciones Técnicas (Opcional)</Label>
              </div>
              
              {specifications.length > 0 && (
                <div className="space-y-2 mb-4">
                  {specifications.map((spec, index) => (
                    <div key={index} className="flex items-center gap-2 bg-gray-50 p-3 rounded-lg">
                      {/* `min-w-0` para que una especificación larga parta línea
                          en vez de empujar el botón de borrar fuera del borde. */}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm break-words">{spec.key}</p>
                        <p className="text-xs text-gray-600 break-words">{spec.value}</p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setSpecifications(specifications.filter((_, i) => i !== index))}
                        className="shrink-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              
              {/* Los dos campos en la misma fila dejaban unos 97px a cada uno
                  dentro del diálogo, con placeholders de 35 caracteres. En
                  móvil el nombre ocupa su línea y el valor baja junto al botón
                  de añadir; los dos puntos sólo tienen sentido en una fila. */}
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  placeholder="Ej: Procesador, RAM, Batería"
                  value={newSpecKey}
                  onChange={(e) => setNewSpecKey(e.target.value)}
                  className="w-full sm:flex-1"
                />
                <span className="hidden text-gray-400 sm:inline">:</span>
                <Input
                  placeholder="Ej: Snapdragon 8 Gen 2, 8GB, 5000mAh"
                  value={newSpecValue}
                  onChange={(e) => setNewSpecValue(e.target.value)}
                  className="min-w-0 flex-1"
                />
                <Button
                  type="button"
                  onClick={() => {
                    if (newSpecKey.trim() && newSpecValue.trim()) {
                      setSpecifications([...specifications, { key: newSpecKey.trim(), value: newSpecValue.trim() }]);
                      setNewSpecKey('');
                      setNewSpecValue('');
                    }
                  }}
                  size="sm"
                  className="shrink-0 bg-purple-500 hover:bg-purple-600 text-white"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                💡 Agrega las características técnicas del producto (procesador, RAM, cámara, etc.)
              </p>
            </div>

            <div>
              <Label>Imagen del Producto</Label>
              <div className="space-y-3">
                {/* Vista previa de la imagen */}
                {formData.image && (
                  <div className="space-y-1">
                    <div className="relative w-full h-40 rounded-lg overflow-hidden border-2 border-gray-200">
                      <img 
                        src={formData.image} 
                        alt="Vista previa" 
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          e.currentTarget.src = 'https://via.placeholder.com/400x300?text=Imagen+no+disponible';
                        }}
                      />
                    </div>
                    <p className="text-xs text-gray-500">
                      {formData.image.startsWith('data:')
                        ? 'Imagen nueva (se subirá al guardar)'
                        : isRemoteImageUrl(formData.image)
                          ? 'Imagen en servidor / URL externa'
                          : 'Vista previa'}
                    </p>
                  </div>
                )}

                {/* Opción 1: Subir archivo */}
                <div>
                  <Label htmlFor="image-upload" className="text-sm text-gray-600">
                    Opción 1: Subir imagen desde tu dispositivo
                  </Label>
                  <div className="mt-1 flex items-center gap-2">
                    <Input
                      id="image-upload"
                      ref={imageFileInputRef}
                      type="file"
                      accept="image/*"
                      disabled={imageUploading || isSavingProduct}
                      onChange={handleImageUpload}
                      className="flex-1"
                    />
                    <Upload className="w-5 h-5 text-gray-400" />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {imageUploading
                      ? 'Comprimiendo imagen...'
                      : 'Formatos: JPG, PNG, WEBP. Máximo 8MB (se comprime automáticamente)'}
                  </p>
                </div>

                {/* Opción 2: URL */}
                <div>
                  <Label htmlFor="image-url" className="text-sm text-gray-600">
                    Opción 2: URL de imagen externa
                  </Label>
                  <div className="mt-1 flex items-center gap-2">
                    <Input
                      id="image-url"
                      type="url"
                      value={formData.image.startsWith('data:') ? '' : formData.image}
                      onChange={(e) => setFormData({ ...formData, image: e.target.value })}
                      placeholder="https://ejemplo.com/imagen.jpg"
                      className="flex-1"
                    />
                    <ImageIcon className="w-5 h-5 text-gray-400" />
                  </div>
                </div>

                {!formData.image && (
                  <p className="text-xs text-red-500">
                    * Debes seleccionar una imagen o ingresar una URL
                  </p>
                )}
              </div>

                {/* Pegado al fondo del diálogo: el formulario de producto es largo
                    (colores, almacenamientos, especificaciones, imagen) y en el
                    móvil obligaba a recorrerlo entero hasta abajo cada vez solo
                    para llegar a "Guardar". */}
                <div className="sticky bottom-0 -mx-1 flex gap-3 border-t bg-white px-1 pt-4 pb-1 flex-shrink-0">
                  <Button
                    type="submit"
                    disabled={isSavingProduct || imageUploading}
                    className="flex-1 bg-orange-400 hover:bg-orange-500"
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {isSavingProduct
                      ? 'Guardando...'
                      : editingProduct
                        ? 'Guardar Cambios'
                        : 'Agregar Producto'}
                  </Button>
                  <Button type="button" variant="outline" aria-label="Cancelar" onClick={handleCloseDialog} className="min-w-11 px-3 sm:px-4">
                    <X className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Cancelar</span>
                  </Button>
                </div>
              </div>
              </form>
            </DialogContent>
          </Dialog>

      {/* Modal de Stock Bajo */}
      <Dialog open={showLowStockModal} onOpenChange={setShowLowStockModal}>
        <DialogContent className="flex max-h-[85dvh] flex-col overflow-hidden max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Package size={20} />
              Productos con Stock Bajo
            </DialogTitle>
            <DialogDescription>
              Estos productos tienen menos de 10 unidades en inventario y requieren atención.
            </DialogDescription>
          </DialogHeader>
          
          <div className="overflow-y-auto flex-1 pr-2 mt-4 space-y-3">
            {lowStockProducts.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                ¡Excelente! No hay productos con stock bajo en este momento.
              </div>
            ) : (
              lowStockProducts.map(product => (
                <div key={product.id || product.name} className="flex items-center gap-4 p-3 bg-red-50/50 rounded-lg border border-red-100">
                  <div className="w-12 h-12 rounded-md bg-white overflow-hidden flex-shrink-0 border border-gray-100">
                    {product.image ? (
                      <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gray-50 text-gray-300">
                        <ImageIcon size={16} />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-gray-900 truncate" title={product.name}>{product.name}</h4>
                    <p className="text-xs text-gray-500 capitalize">{product.category}</p>
                  </div>
                  <div className="flex flex-col items-end flex-shrink-0 pl-2 border-l border-red-200/50">
                    <span className="text-[10px] uppercase font-bold text-red-400 tracking-wider">Unidades</span>
                    <span className="text-xl font-black text-red-600 leading-none">{product.stock}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
