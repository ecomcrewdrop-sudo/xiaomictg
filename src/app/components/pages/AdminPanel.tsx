import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useProducts, Product, Banner, ColorVariant, StorageVariant } from '../ProductContext';
import { Plus, Pencil, Trash2, Save, X, Package, ImageIcon, Upload, Palette, HardDrive, Cpu } from 'lucide-react';
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
import { toast } from 'sonner';
import { compressImageFile, isRemoteImageUrl } from '../../lib/product-image';
const SOCKET_URL = '';

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
    schedule: 'Lunes a Viernes: 9:00 AM - 6:00 PM',
    exchangeRate: 4200,
    showUSD: false,
    nit: '1043345642-7'
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
        schedule: ticketConfig.schedule || 'Lunes a Viernes: 9:00 AM - 6:00 PM',
        exchangeRate: ticketConfig.exchangeRate ?? 4200,
        showUSD: ticketConfig.showUSD ?? false,
        nit: ticketConfig.nit || '1043345642-7'
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
    stock: ''
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
        stock: product.stock.toString()
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
        stock: ''
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
      toast.error('Por favor ingresa un precio válido');
      return;
    }
    if (!newStorage.stock || parseInt(newStorage.stock) < 0) {
      toast.error('Por favor ingresa una cantidad de stock válida');
      return;
    }
    
    setStorageVariants([...storageVariants, {
      storage: newStorage.storage.trim(),
      price: parseFloat(newStorage.price),
      stock: parseInt(newStorage.stock)
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
      stock: totalStock
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

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8 flex justify-between items-start">
          <div>
            <h1 className="text-4xl font-light text-gray-900 mb-2">Panel de Administración</h1>
            <p className="text-gray-600 font-light">Gestiona el catálogo de productos y el banner publicitario</p>
          </div>
          <button
            onClick={handleLogout}
            className="bg-red-500 text-white px-4 py-2 rounded-md hover:bg-red-600"
          >
            Cerrar Sesión
          </button>
        </div>

      <Tabs defaultValue="products" className="w-full">
      <TabsList className="grid w-full max-w-5xl grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 mb-8 h-auto gap-1">
          <TabsTrigger value="products">Productos</TabsTrigger>
          <TabsTrigger value="stats">Estadísticas</TabsTrigger>
          <TabsTrigger value="orders" className="relative">
            Órdenes
            {todayOrdersCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                {todayOrdersCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="banner">Banners</TabsTrigger>
          <TabsTrigger value="ticket">Ticket</TabsTrigger>
          <TabsTrigger value="backup">Respaldo</TabsTrigger>
          <TabsTrigger value="blocking">Bloqueo</TabsTrigger>
          <TabsTrigger value="links" className="font-bold text-orange-600 data-[state=active]:bg-orange-50 data-[state=active]:text-orange-600">Links VIP</TabsTrigger>
          <TabsTrigger value="whatsapp" className="font-bold text-green-700 data-[state=active]:bg-green-50 data-[state=active]:text-green-700 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
            WhatsApp
          </TabsTrigger>
        </TabsList>

        {/* TAB DE ÓRDENES */}
        <TabsContent value="orders">
          <OrdersManager />
        </TabsContent>

        {/* TAB DE LINKS VIP */}
        <TabsContent value="links">
          <AdminLinkGenerator />
        </TabsContent>

        {/* TAB DE ESTADÍSTICAS */}
        <TabsContent value="stats">
          <StatisticsDashboard />
        </TabsContent>

        {/* TAB WHATSAPP */}
        <TabsContent value="whatsapp">
          <WhatsAppPanel />
        </TabsContent>

        {/* TAB DE PRODUCTOS */}
        <TabsContent value="products">
          <div className="mb-6">
            <h2 className="text-2xl font-semibold text-gray-800">Gestión de Productos</h2>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="text-sm text-gray-500 mb-1">Total Productos</div>
          <div className="text-3xl font-bold text-orange-400">{products.length}</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="text-sm text-gray-500 mb-1">Valor Inventario</div>
          <div className="text-2xl font-bold text-green-500">
            ${Math.round(products.reduce((sum, p) => sum + (p.price * p.stock), 0)).toLocaleString('es-CO')} COP
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="text-sm text-gray-500 mb-1">Stock Total</div>
          <div className="text-3xl font-bold text-blue-500">
            {products.reduce((sum, p) => sum + p.stock, 0)}
          </div>
        </div>
        <div 
          onClick={() => setShowLowStockModal(true)}
          className="bg-white rounded-xl shadow-sm p-6 cursor-pointer hover:bg-red-50 hover:shadow-md transition-all duration-200 border border-transparent hover:border-red-100 group"
        >
          <div className="flex justify-between items-start">
            <div>
              <div className="text-sm text-gray-500 mb-1 group-hover:text-red-600 transition-colors">Stock Bajo</div>
              <div className="text-3xl font-bold text-red-500">
                {lowStockProducts.length}
              </div>
            </div>
            <div className="bg-red-100 p-2 rounded-lg text-red-500 group-hover:scale-110 transition-transform">
              <Package size={24} />
            </div>
          </div>
          <div className="mt-4 text-xs text-red-500/80 font-medium flex items-center gap-1">
            Ver detalles <span className="text-[10px]">▶</span>
          </div>
        </div>
          </div>

          {/* Products by Category */}
          <div className="space-y-6">
        {productsByCategory.map(category => (
          <div key={category.value} className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-orange-400 to-orange-500 text-white px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold">{category.label}</h2>
                <p className="text-orange-100 text-sm">{category.products.length} productos</p>
              </div>
              <Button
                onClick={() => handleOpenDialog(undefined, category.value)}
                className="bg-white/20 hover:bg-white/30 text-white border-2 border-white/40 flex items-center gap-2 backdrop-blur-sm"
                size="sm"
              >
                <Plus className="w-4 h-4" />
                Agregar en {category.label}
              </Button>
            </div>
            
            <div className="overflow-x-auto">
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
                              onClick={() => handleDelete(product.id)}
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
            <h2 className="text-2xl font-semibold text-gray-800 mb-6">Configurar Banners Publicitarios</h2>
            
            {/* Selector de Banner */}
            <div className="mb-6 bg-white rounded-xl shadow-sm p-4">
              <div className="flex items-center justify-between mb-3">
                <Label className="text-base font-semibold">Seleccionar Banner para Editar</Label>
                <Button
                  type="button"
                  onClick={handleAddNewBanner}
                  className="bg-green-500 hover:bg-green-600 text-white"
                  size="sm"
                >
                  <Plus className="w-4 h-4 mr-2" />
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
            <form onSubmit={handleBannerSubmit} className="bg-white rounded-xl shadow-sm p-6 space-y-6">
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
            <h2 className="text-2xl font-semibold text-gray-800 mb-6">Configuración del Ticket</h2>
            
            <div className="bg-white rounded-xl shadow-sm p-6 space-y-6">
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
                  placeholder="Lunes a Viernes: 9:00 AM - 6:00 PM"
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
            <h2 className="text-2xl font-semibold text-gray-800 mb-6">Respaldo y Restauración</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Export/Backup */}
              <div className="bg-white rounded-xl shadow-sm p-6">
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
              <div className="bg-white rounded-xl shadow-sm p-6">
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
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="text-center py-12">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">Sistema de Bloqueo MDM</h2>
              <p className="text-gray-600 mb-8">
                Gestiona el control remoto de teléfonos y tabletas, bloqueo y modo kiosk
              </p>
              <div className="flex justify-center gap-4">
                <a
                  href="/admin/blocking/devices"
                  className="bg-[#ff6700] text-white px-6 py-3 rounded-lg hover:bg-[#e65d00] flex items-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  Ver Dispositivos
                </a>
                <a
                  href="/admin/blocking/dashboard"
                  className="bg-gray-200 text-gray-800 px-6 py-3 rounded-lg hover:bg-gray-300 flex items-center gap-2"
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
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col">
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

            <div className="grid grid-cols-2 gap-4">
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

            {/* Sección de Variantes de Color */}
            <div className="border-2 border-gray-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-4">
                <Palette className="w-5 h-5 text-orange-500" />
                <Label className="text-base font-medium">Variantes de Color (Opcional)</Label>
              </div>
              
              {/* Lista de colores actuales */}
              {colorVariants.length > 0 && (
                <div className="space-y-2 mb-4">
                  {colorVariants.map((variant, index) => (
                    <div key={index} className="flex items-center gap-2 bg-gray-50 p-3 rounded-lg">
                      <div 
                        className="w-8 h-8 rounded border-2 border-gray-300" 
                        style={{ backgroundColor: variant.colorHex }}
                      />
                      <div className="flex-1">
                        <p className="font-medium text-sm">{variant.color}</p>
                        <p className="text-xs text-gray-600">{variant.colorHex}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          value={variant.stock}
                          onChange={(e) => handleUpdateColorStock(index, parseInt(e.target.value))}
                          className="w-20"
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
                <div className="grid grid-cols-[1fr,auto,auto,auto] gap-2">
                  <Input
                    placeholder="Nombre del color (ej: Negro, Azul)"
                    value={newColor.color}
                    onChange={(e) => setNewColor({ ...newColor, color: e.target.value })}
                  />
                  <div className="flex items-center gap-1">
                    <input
                      type="color"
                      value={newColor.colorHex}
                      onChange={(e) => setNewColor({ ...newColor, colorHex: e.target.value })}
                      className="w-10 h-10 rounded cursor-pointer"
                    />
                  </div>
                  <Input
                    type="number"
                    placeholder="Stock"
                    value={newColor.stock}
                    onChange={(e) => setNewColor({ ...newColor, stock: e.target.value })}
                    className="w-24"
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
              
              {/* Lista de almacenamientos actuales */}
              {storageVariants.length > 0 && (
                <div className="space-y-2 mb-4">
                  {storageVariants.map((variant, index) => (
                    <div key={index} className="flex items-center gap-2 bg-gray-50 p-3 rounded-lg">
                      <div className="flex-1">
                        <p className="font-medium text-sm">{variant.storage}</p>
                        <p className="text-xs text-gray-600">${variant.price.toLocaleString('es-CO')} COP</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              value={variant.price}
                              onChange={(e) => handleUpdateStoragePrice(index, parseFloat(e.target.value))}
                              className="w-24 h-8 text-xs"
                              min="0"
                              step="100"
                              placeholder="COP"
                            />
                            <span className="text-xs text-gray-600">COP</span>
                          </div>
                        </div>
                        <Input
                          type="number"
                          value={variant.stock}
                          onChange={(e) => handleUpdateStorageStock(index, parseInt(e.target.value))}
                          className="w-20"
                          min="0"
                        />
                        <span className="text-sm text-gray-600">uds</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveStorage(index)}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
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
                    className="bg-blue-500 hover:bg-blue-600 text-white"
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-xs text-gray-500">
                  💡 Cada variante de almacenamiento puede tener un precio diferente. El precio base se usará si no hay variantes.
                </p>
              </div>
            </div>

            <div>
              <Label htmlFor="description">Descripción</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
                required
              />
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
                      <div className="flex-1">
                        <p className="font-medium text-sm">{spec.key}</p>
                        <p className="text-xs text-gray-600">{spec.value}</p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setSpecifications(specifications.filter((_, i) => i !== index))}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Ej: Procesador, RAM, Batería"
                  value={newSpecKey}
                  onChange={(e) => setNewSpecKey(e.target.value)}
                  className="flex-1"
                />
                <span className="text-gray-400">:</span>
                <Input
                  placeholder="Ej: Snapdragon 8 Gen 2, 8GB, 5000mAh"
                  value={newSpecValue}
                  onChange={(e) => setNewSpecValue(e.target.value)}
                  className="flex-1"
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
                  className="bg-purple-500 hover:bg-purple-600 text-white"
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

                <div className="flex gap-3 pt-4 border-t flex-shrink-0">
                  <Button 
                    type="submit"
                    disabled={isSavingProduct || imageUploading}
                    className="flex-1 bg-orange-400 hover:bg-orange-500"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {isSavingProduct
                      ? 'Guardando...'
                      : editingProduct
                        ? 'Guardar Cambios'
                        : 'Agregar Producto'}
                  </Button>
                  <Button type="button" variant="outline" onClick={handleCloseDialog}>
                    <X className="w-4 h-4 mr-2" />
                    Cancelar
                  </Button>
                </div>
              </div>
              </form>
            </DialogContent>
          </Dialog>
    </div>
  );
}
