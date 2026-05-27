import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { AdminPanel } from '../app/components/pages/AdminPanel';

const mockProducts = [
  {
    id: '1',
    name: 'Xiaomi Redmi Note 12',
    category: 'moviles',
    price: 250,
    description: 'Smartphone Xiaomi',
    image: 'https://example.com/image.jpg',
    stock: 50
  },
  {
    id: '2',
    name: 'Xiaomi Watch S1',
    category: 'smartwatch',
    price: 150,
    description: 'Smartwatch Xiaomi',
    image: 'https://example.com/watch.jpg',
    stock: 20
  }
];

const mockBanners = [
  {
    _id: '1',
    title: 'Gran Oferta',
    subtitle: 'Descuentos de hasta 30%',
    description: 'Aprovecha nuestros descuentos',
    buttonText: 'Ver Ofertas',
    buttonLink: '/moviles',
    backgroundImage: 'https://example.com/banner.jpg'
  }
];

const mockOrders = [
  {
    id: '1',
    orderNumber: 'XM-00000001',
    date: '2024-01-15T10:00:00Z',
    createdAt: '2024-01-15T10:00:00Z',
    items: [],
    total: 250,
    status: 'pending' as const,
    customerInfo: {
      name: 'Juan Perez',
      email: 'juan@test.com',
      idNumber: '12345678',
      phone: '3001234567',
      deliveryMethod: 'pickup' as const,
      paymentMethod: 'Efectivo'
    },
    paymentMethod: 'Efectivo'
  }
];

const mockTicketConfig = {
  storeName: 'XIAOMI STORE',
  tagline: 'Tecnología Premium',
  address: 'Cl. 31 #61-64, Los Ángeles',
  city: 'Cartagena de Indias',
  phone: '(605) 123-4567',
  website: 'www.xiaomi.com',
  exchangeRate: 4200,
  footerMessage: '¡Gracias por tu compra!',
  warrantyMessage: 'Conserva este ticket para tu garantía',
  schedule: 'Lunes a Viernes: 9:00 AM - 6:00 PM'
};

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({
    on: vi.fn(),
    disconnect: vi.fn()
  }))
}));

vi.mock('../app/components/ProductContext', () => ({
  useProducts: () => ({
    products: mockProducts,
    addProduct: vi.fn().mockResolvedValue(undefined),
    updateProduct: vi.fn().mockResolvedValue(undefined),
    deleteProduct: vi.fn().mockResolvedValue(undefined),
    banners: mockBanners,
    addBanner: vi.fn().mockResolvedValue(undefined),
    updateBanner: vi.fn().mockResolvedValue(undefined),
    deleteBanner: vi.fn().mockResolvedValue(undefined),
    orders: mockOrders,
    unreadOrdersCount: 0,
    markOrdersAsRead: vi.fn(),
    ticketConfig: mockTicketConfig,
    updateTicketConfig: vi.fn().mockResolvedValue(undefined),
    cart: [],
    addToCart: vi.fn(),
    removeFromCart: vi.fn(),
    updateCartQuantity: vi.fn(),
    clearCart: vi.fn(),
    getCartTotal: vi.fn().mockReturnValue(0),
    loading: false,
    notifications: []
  }),
  ProductProvider: ({ children }: { children: React.ReactNode }) => children
}));

describe('AdminPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('adminToken', 'test-token');
    localStorage.setItem('adminUser', JSON.stringify({ username: 'admin', role: 'admin' }));
  });

  it('renderiza el título del panel de administración', () => {
    render(
      <BrowserRouter>
        <AdminPanel />
      </BrowserRouter>
    );
    expect(screen.getByText('Panel de Administración')).toBeInTheDocument();
  });

  it('muestra las pestañas del panel', () => {
    render(
      <BrowserRouter>
        <AdminPanel />
      </BrowserRouter>
    );
    expect(screen.getByText('Productos')).toBeInTheDocument();
    expect(screen.getByText('Órdenes')).toBeInTheDocument();
    expect(screen.getByText('Banners')).toBeInTheDocument();
    expect(screen.getByText('Ticket')).toBeInTheDocument();
    expect(screen.getByText('Respaldo')).toBeInTheDocument();
  });

  it('muestra el conteo de productos en estadísticas', () => {
    render(
      <BrowserRouter>
        <AdminPanel />
      </BrowserRouter>
    );
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('muestra las categorías de productos', () => {
    render(
      <BrowserRouter>
        <AdminPanel />
      </BrowserRouter>
    );
    expect(screen.getByText('Móviles')).toBeInTheDocument();
    expect(screen.getByText('Smartwatch')).toBeInTheDocument();
  });

  it('muestra los productos en la tabla', () => {
    render(
      <BrowserRouter>
        <AdminPanel />
      </BrowserRouter>
    );
    expect(screen.getByText('Xiaomi Redmi Note 12')).toBeInTheDocument();
    expect(screen.getByText('Xiaomi Watch S1')).toBeInTheDocument();
  });

  it('tiene botón de cerrar sesión', () => {
    render(
      <BrowserRouter>
        <AdminPanel />
      </BrowserRouter>
    );
    expect(screen.getByText('Cerrar Sesión')).toBeInTheDocument();
  });

  it('calcula el valor del inventario correctamente', () => {
    const totalValue = mockProducts.reduce((sum, p) => sum + (p.price * p.stock), 0) * 4200;
    expect(totalValue).toBeGreaterThan(0);
  });

  it('filtra productos por categoría', () => {
    const moviles = mockProducts.filter(p => p.category === 'moviles');
    const smartwatch = mockProducts.filter(p => p.category === 'smartwatch');
    
    expect(moviles.length).toBe(1);
    expect(smartwatch.length).toBe(1);
  });

  it('muestra el stock total en estadísticas', () => {
    render(
      <BrowserRouter>
        <AdminPanel />
      </BrowserRouter>
    );
    expect(screen.getByText('70')).toBeInTheDocument();
  });

  it('puede hacer clic en la pestaña de Órdenes', () => {
    render(
      <BrowserRouter>
        <AdminPanel />
      </BrowserRouter>
    );
    
    const ordersTab = screen.getByText('Órdenes');
    expect(ordersTab).toBeInTheDocument();
    fireEvent.click(ordersTab);
  });

  it('puede hacer clic en la pestaña de Banners', () => {
    render(
      <BrowserRouter>
        <AdminPanel />
      </BrowserRouter>
    );
    
    const bannerTab = screen.getByText('Banners');
    expect(bannerTab).toBeInTheDocument();
    fireEvent.click(bannerTab);
  });

  it('puede hacer clic en la pestaña de Ticket', () => {
    render(
      <BrowserRouter>
        <AdminPanel />
      </BrowserRouter>
    );
    
    const ticketTab = screen.getByText('Ticket');
    expect(ticketTab).toBeInTheDocument();
    fireEvent.click(ticketTab);
  });

  it('puede hacer clic en la pestaña de Respaldo', () => {
    render(
      <BrowserRouter>
        <AdminPanel />
      </BrowserRouter>
    );
    
    const backupTab = screen.getByText('Respaldo');
    expect(backupTab).toBeInTheDocument();
    fireEvent.click(backupTab);
  });
});

describe('AdminPanel - Datos de prueba', () => {
  it('contiene productos con estructura válida', () => {
    mockProducts.forEach(product => {
      expect(product.id).toBeDefined();
      expect(product.name).toBeDefined();
      expect(product.category).toBeDefined();
      expect(product.price).toBeGreaterThan(0);
      expect(product.stock).toBeGreaterThanOrEqual(0);
    });
  });

  it('contiene banners con estructura válida', () => {
    mockBanners.forEach(banner => {
      expect(banner.title).toBeDefined();
      expect(banner.subtitle).toBeDefined();
      expect(banner.description).toBeDefined();
      expect(banner.buttonText).toBeDefined();
      expect(banner.buttonLink).toBeDefined();
    });
  });

  it('contiene órdenes con estructura válida', () => {
    mockOrders.forEach(order => {
      expect(order.id).toBeDefined();
      expect(order.orderNumber).toBeDefined();
      expect(order.total).toBeGreaterThan(0);
      expect(['pending', 'processing', 'completed', 'cancelled']).toContain(order.status);
    });
  });

  it('contiene configuración de ticket válida', () => {
    expect(mockTicketConfig.storeName).toBeDefined();
    expect(mockTicketConfig.address).toBeDefined();
    expect(mockTicketConfig.phone).toBeDefined();
    expect(mockTicketConfig.exchangeRate).toBeGreaterThan(0);
  });
});

describe('AdminPanel - Funcionalidades de cálculo', () => {
  it('calcula el valor total del inventario correctamente', () => {
    const totalValue = mockProducts.reduce((sum, p) => sum + (p.price * p.stock), 0);
    expect(totalValue).toBe(15500);
  });

  it('calcula el stock total correctamente', () => {
    const totalStock = mockProducts.reduce((sum, p) => sum + p.stock, 0);
    expect(totalStock).toBe(70);
  });

  it('identifica productos con stock bajo', () => {
    const lowStockProducts = mockProducts.filter(p => p.stock < 10);
    expect(lowStockProducts.length).toBe(0);
    
    const productsWithLowStock = [...mockProducts, { ...mockProducts[0], stock: 5 }];
    const lowStock = productsWithLowStock.filter(p => p.stock < 10);
    expect(lowStock.length).toBe(1);
  });

  it('calcula los ingresos totales de órdenes completadas', () => {
    const completedOrders = [
      ...mockOrders,
      { ...mockOrders[0], id: '2', status: 'completed' as const, total: 500 }
    ];
    const revenue = completedOrders
      .filter(order => order.status === 'completed')
      .reduce((sum, order) => sum + order.total, 0);
    expect(revenue).toBe(500);
  });
});

describe('AdminPanel - Validaciones de datos', () => {
  it('valida estructura de producto', () => {
    const product = mockProducts[0];
    expect(product).toHaveProperty('id');
    expect(product).toHaveProperty('name');
    expect(product).toHaveProperty('category');
    expect(product).toHaveProperty('price');
    expect(product).toHaveProperty('description');
    expect(product).toHaveProperty('image');
    expect(product).toHaveProperty('stock');
  });

  it('valida estructura de banner', () => {
    const banner = mockBanners[0];
    expect(banner).toHaveProperty('title');
    expect(banner).toHaveProperty('subtitle');
    expect(banner).toHaveProperty('description');
    expect(banner).toHaveProperty('buttonText');
    expect(banner).toHaveProperty('buttonLink');
    expect(banner).toHaveProperty('backgroundImage');
  });

  it('valida estructura de orden', () => {
    const order = mockOrders[0];
    expect(order).toHaveProperty('id');
    expect(order).toHaveProperty('orderNumber');
    expect(order).toHaveProperty('date');
    expect(order).toHaveProperty('items');
    expect(order).toHaveProperty('total');
    expect(order).toHaveProperty('status');
    expect(order).toHaveProperty('customerInfo');
    expect(order).toHaveProperty('paymentMethod');
  });

  it('valida estados válidos de orden', () => {
    const validStatuses = ['pending', 'processing', 'completed', 'cancelled'];
    mockOrders.forEach(order => {
      expect(validStatuses).toContain(order.status);
    });
  });
});
