import express from 'express';
import cors from 'cors';
import { MongoClient, ObjectId } from 'mongodb';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { Resend } from 'resend';
import dotenv from 'dotenv';
import { createHash } from 'crypto';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3001;
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

if (!ADMIN_USER || !ADMIN_PASSWORD) {
  console.warn('[server] ADMIN_USER o ADMIN_PASSWORD no configurados en .env');
}

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('[server] MONGO_URI no definido en .env');
  process.exit(1);
}

let db: any;
let dbClient: MongoClient | null = null;
let dbReconnectTimer: NodeJS.Timeout | null = null;
let dbConnecting = false;

function scheduleDbReconnect(delayMs = 15000) {
  if (dbReconnectTimer) return;
  dbReconnectTimer = setTimeout(() => {
    dbReconnectTimer = null;
    void connectDB();
  }, delayMs);
}

async function connectDB() {
  if (dbConnecting) return;
  dbConnecting = true;
  try {
    const client = new MongoClient(MONGO_URI, {
      serverSelectionTimeoutMS: 10000
    });
    await client.connect();
    dbClient = client;
    db = client.db();
    console.log('Connected to MongoDB');
    
    await setupIndexes();
    await seedData();
    console.log('[server] MongoDB ready');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    db = undefined;
    scheduleDbReconnect(15000);
  } finally {
    dbConnecting = false;
  }
}

async function setupIndexes() {
  await db.collection('products').createIndex({ id: 1 }, { unique: true });
  await db.collection('orders').createIndex({ createdAt: -1 });
}

const initialProducts = [
  {
    id: '1',
    name: 'Xiaomi 13 Pro',
    category: 'moviles',
    price: 899,
    description: 'Flagship con cámara Leica y procesador Snapdragon 8 Gen 2',
    image: 'https://images.unsplash.com/photo-1560677519-9e47f8731d07?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080',
    stock: 30,
    storageVariants: [
      { storage: '128GB', price: 799, stock: 10 },
      { storage: '256GB', price: 899, stock: 12 },
      { storage: '512GB', price: 1099, stock: 8 }
    ],
    colorVariants: [
      { color: 'Negro Cerámica', colorHex: '#1a1a1a', stock: 6 },
      { color: 'Blanco Cerámica', colorHex: '#f5f5f5', stock: 5 },
      { color: 'Verde Flora', colorHex: '#4a7c59', stock: 4 }
    ],
    specifications: {
      'Procesador': 'Snapdragon 8 Gen 2',
      'RAM': '12GB',
      'Almacenamiento': '128GB / 256GB / 512GB',
      'Pantalla': '6.73" AMOLED 120Hz',
      'Cámara': 'Triple 50MP + 50MP + 50MP Leica',
      'Batería': '4820mAh con carga rápida 120W',
      'Sistema Operativo': 'MIUI 14 basado en Android 13'
    },
    reviews: [
      { id: '1', author: 'Carlos M.', rating: 5, date: '15 Ene 2025', comment: 'Excelente teléfono' }
    ]
  },
  {
    id: '2',
    name: 'Xiaomi 12T',
    category: 'moviles',
    price: 599,
    description: '200MP de cámara y pantalla AMOLED de 120Hz',
    image: 'https://images.unsplash.com/photo-1560677519-9e47f8731d07?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080',
    stock: 35,
    storageVariants: [
      { storage: '128GB', price: 549, stock: 15 },
      { storage: '256GB', price: 599, stock: 20 }
    ],
    colorVariants: [
      { color: 'Azul', colorHex: '#1e40af', stock: 7 },
      { color: 'Plata', colorHex: '#cbd5e1', stock: 7 },
      { color: 'Negro', colorHex: '#0f172a', stock: 6 }
    ],
    specifications: {
      'Procesador': 'MediaTek Dimensity 8100',
      'RAM': '8GB',
      'Almacenamiento': '128GB / 256GB',
      'Pantalla': '6.67" AMOLED 120Hz',
      'Cámara': 'Triple 200MP + 8MP + 2MP',
      'Batería': '5000mAh con carga rápida 120W'
    },
    reviews: []
  },
  {
    id: '3',
    name: 'POCO X5 Pro',
    category: 'poco',
    price: 349,
    description: 'Potencia extrema con Snapdragon 778G',
    image: 'https://images.unsplash.com/photo-1560656793-08538906a9f8?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080',
    stock: 50,
    storageVariants: [
      { storage: '128GB', price: 299, stock: 25 },
      { storage: '256GB', price: 349, stock: 25 }
    ],
    colorVariants: [
      { color: 'Negro', colorHex: '#0f172a', stock: 17 },
      { color: 'Azul', colorHex: '#1e40af', stock: 17 },
      { color: 'Amarillo', colorHex: '#facc15', stock: 16 }
    ],
    specifications: {
      'Procesador': 'Snapdragon 778G',
      'RAM': '6GB / 8GB',
      'Pantalla': '6.67" AMOLED 120Hz',
      'Cámara': '108MP',
      'Batería': '5000mAh'
    },
    reviews: []
  },
  {
    id: '4',
    name: 'Redmi Note 12',
    category: 'moviles',
    price: 249,
    description: 'El presupuesto inteligente con AMOLED',
    image: 'https://images.unsplash.com/photo-1560677519-9e47f8731d07?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080',
    stock: 60,
    storageVariants: [
      { storage: '64GB', price: 199, stock: 20 },
      { storage: '128GB', price: 249, stock: 40 }
    ],
    colorVariants: [
      { color: 'Gris', colorHex: '#6b7280', stock: 20 },
      { color: 'Azul', colorHex: '#1e40af', stock: 20 },
      { color: 'Verde', colorHex: '#22c55e', stock: 20 }
    ],
    specifications: {
      'Procesador': 'Snapdragon 685',
      'RAM': '4GB / 6GB / 8GB',
      'Pantalla': '6.67" AMOLED 120Hz',
      'Cámara': '50MP',
      'Batería': '5000mAh'
    },
    reviews: []
  },
  {
    id: '5',
    name: 'Xiaomi Buds 4 Pro',
    category: 'audifonos',
    price: 149,
    description: 'Audio espacial y cancelación de ruido activa',
    image: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080',
    stock: 80,
    colorVariants: [
      { color: 'Negro', colorHex: '#0f172a', stock: 40 },
      { color: 'Blanco', colorHex: '#f5f5f5', stock: 40 }
    ],
    specifications: {
      'Cancelación de ruido': '48dB',
      'Batería': '38 horas con estuche',
      'Conectividad': 'Bluetooth 5.3'
    },
    reviews: []
  },
  {
    id: '6',
    name: 'Redmi Watch 4',
    category: 'smartwatch',
    price: 79,
    description: 'Pantalla AMOLED y monitoreo de salud',
    image: 'https://images.unsplash.com/photo-1579586337278-3befd40fd17a?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080',
    stock: 45,
    colorVariants: [
      { color: 'Negro', colorHex: '#0f172a', stock: 15 },
      { color: 'Plata', colorHex: '#cbd5e1', stock: 15 },
      { color: 'Dorado', colorHex: '#f59e0b', stock: 15 }
    ],
    specifications: {
      'Pantalla': '1.97" AMOLED',
      'Batería': '12 días',
      'Resistencia': '5ATM'
    },
    reviews: []
  }
];

const initialBanners = [
  {
    title: 'Innovación Sin Límites',
    subtitle: 'Nuevos Lanzamientos',
    description: 'Descubre la última tecnología Xiaomi con diseño premium y rendimiento excepcional.',
    buttonText: 'Explorar Ahora',
    buttonLink: '/moviles',
    backgroundImage: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1920'
  },
  {
    title: 'POCO Power',
    subtitle: 'Potencia Extrema',
    description: 'Experimenta un rendimiento sin límites con la línea POCO.',
    buttonText: 'Descubrir POCO',
    buttonLink: '/poco',
    backgroundImage: 'https://images.unsplash.com/photo-1560656793-08538906a9f8?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1920'
  },
  {
    title: 'Audio Premium',
    subtitle: 'Sonido Cristalino',
    description: 'Sumérgete en una experiencia de audio excepcional con nuestros audífonos.',
    buttonText: 'Ver Audio',
    buttonLink: '/audifonos',
    backgroundImage: 'https://images.unsplash.com/photo-1484704849700-f032a568e944?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1920'
  }
];

async function seedData() {
  const productsCount = await db.collection('products').countDocuments();
  if (productsCount === 0) {
    await db.collection('products').insertMany(initialProducts);
    console.log('Products seeded');
  }

  const bannersCount = await db.collection('banners').countDocuments();
  if (bannersCount === 0) {
    await db.collection('banners').insertMany(initialBanners);
    console.log('Banners seeded');
  }
}

async function sendOrderEmail(order: any) {
  if (!resend) {
    console.log('[server] RESEND_API_KEY no configurado, email omitido');
    return;
  }
  try {
    const itemsHtml = order.items.map((item: any) => {
      const imageUrl = item.product?.image || '';
      const imageHtml = imageUrl ? `<img src="${imageUrl}" alt="${item.product.name}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 4px; margin-right: 10px;" />` : '';
      return `
        <li style="display: flex; align-items: center; margin-bottom: 15px; padding: 10px; background: #f9f9f9; border-radius: 8px;">
          ${imageHtml}
          <div>
            <strong>${item.product?.name || 'Producto'}</strong><br/>
            <span style="color: #666;">Cantidad: ${item.quantity}</span><br/>
            <span style="color: #e65100; font-weight: bold;">$${((item.product?.price || 0) * item.quantity).toFixed(2)}</span>
          </div>
        </li>
      `;
    }).join('');

    const ticketHtml = `
      <div style="border: 2px solid #333; padding: 20px; max-width: 300px; font-family: monospace; font-size: 12px; background: #fff;">
        <div style="text-align: center; border-bottom: 1px dashed #333; padding-bottom: 10px; margin-bottom: 10px;">
          <h2 style="margin: 0; font-size: 18px;">XIAOMI STORE</h2>
          <p style="margin: 5px 0;">Tecnología Premium</p>
          <p style="margin: 5px 0;">Cl. 31 #61-64, Los Ángeles</p>
          <p style="margin: 5px 0;">Cartagena de Indias</p>
          <p style="margin: 5px 0;">Tel: (605) 123-4567</p>
        </div>
        
        <div style="border-bottom: 1px dashed #333; padding-bottom: 10px; margin-bottom: 10px;">
          <p style="margin: 5px 0;"><strong>Orden:</strong> ${order.orderNumber}</p>
          <p style="margin: 5px 0;"><strong>Fecha:</strong> ${new Date(order.date).toLocaleString()}</p>
        </div>
        
        <div style="border-bottom: 1px dashed #333; padding-bottom: 10px; margin-bottom: 10px;">
          ${order.items.map((item: any) => `
            <div style="margin-bottom: 8px;">
              <div>${item.product?.name || 'Producto'} x${item.quantity}</div>
              <div style="text-align: right;">$${((item.product?.price || 0) * item.quantity).toFixed(2)}</div>
            </div>
          `).join('')}
        </div>
        
        <div style="border-bottom: 1px dashed #333; padding-bottom: 10px; margin-bottom: 10px;">
          <p style="margin: 5px 0;"><strong>Cliente:</strong> ${order.customerInfo?.name || 'No especificado'}</p>
          <p style="margin: 5px 0;"><strong>Tel:</strong> ${order.customerInfo?.phone || 'No especificado'}</p>
          <p style="margin: 5px 0;"><strong>Entrega:</strong> ${order.customerInfo?.deliveryMethod === 'delivery' ? 'Domicilio' : 'Retiro en tienda'}</p>
          ${order.customerInfo?.deliveryMethod === 'delivery' ? `<p style="margin: 5px 0;"><strong>Dirección:</strong> ${order.customerInfo?.address || ''}</p>` : ''}
        </div>
        
        <div style="text-align: center;">
          <p style="margin: 5px 0;"><strong>TOTAL:</strong> $${order.total.toFixed(2)}</p>
          <p style="margin: 5px 0;"><strong>Pago:</strong> ${order.paymentMethod}</p>
        </div>
        
        <div style="border-top: 1px dashed #333; padding-top: 10px; margin-top: 10px; text-align: center;">
          <p style="margin: 5px 0;">¡Gracias por tu compra!</p>
          <p style="margin: 5px 0; font-size: 10px;">Conserva este ticket para tu garantía</p>
        </div>
      </div>
    `;

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #e65100; text-align: center;">Nuevo Pedido #${order.orderNumber}</h1>
        
        <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
          <h3 style="margin-top: 0;">Datos del Cliente</h3>
          <p><strong>Nombre:</strong> ${order.customerInfo?.name || 'No especificado'}</p>
          <p><strong>Email:</strong> ${order.customerInfo?.email || 'No especificado'}</p>
          <p><strong>Teléfono:</strong> ${order.customerInfo?.phone || 'No especificado'}</p>
          <p><strong>Dirección:</strong> ${order.customerInfo?.address || 'Retiro en tienda'}</p>
          <p><strong>Método de pago:</strong> ${order.paymentMethod}</p>
          <p><strong>Entrega:</strong> ${order.customerInfo?.deliveryMethod === 'delivery' ? 'Domicilio' : 'Retiro en tienda'}</p>
        </div>
        
        <h2 style="color: #333;">Productos</h2>
        <ul style="list-style: none; padding: 0;">${itemsHtml}</ul>
        
        <div style="background: #fff3e0; padding: 15px; border-radius: 8px; text-align: center;">
          <h2 style="margin: 0; color: #e65100;">Total: $${order.total.toFixed(2)}</h2>
        </div>
        
        <div style="margin-top: 30px; text-align: center;">
          <h3 style="color: #333;">Ticket de Compra</h3>
          ${ticketHtml}
        </div>
      </div>
    `;

    await resend.emails.send({
      from: 'Xiaomi Cartagena <onboarding@resend.dev>',
      to: ['xiaomi.cartagenaventas@gmail.com'],
      subject: `Nuevo Pedido #${order.orderNumber} - Xiaomi Cartagena`,
      html: emailHtml
    });

    console.log('Email sent successfully');
  } catch (error) {
    console.error('Error sending email:', error);
  }
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    dbReady: Boolean(db),
    uptimeSeconds: Math.round(process.uptime())
  });
});

function requireDb(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (db) return next();
  return res.status(503).json({
    error: 'Database unavailable',
    message: 'La base de datos no está disponible temporalmente. Intenta nuevamente en unos segundos.'
  });
}

function hashPassword(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}

// Login: variables de entorno (Railway) o colección users (MongoDB)
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ success: false, message: 'Usuario y contraseña requeridos' });
  }

  const user = username.trim();
  const pass = password;

  if (ADMIN_USER && ADMIN_PASSWORD) {
    if (user === ADMIN_USER.trim() && pass === ADMIN_PASSWORD.trim()) {
      return res.json({ success: true, token: 'admin-token-' + Date.now() });
    }
  }

  if (!db) {
    return res.status(401).json({ success: false, message: 'Credenciales incorrectas' });
  }

  try {
    const hashedPwd = hashPassword(pass);
    const dbUser = await db.collection('users').findOne({
      username: user,
      $or: [{ password: pass }, { password: hashedPwd }],
    });

    if (dbUser) {
      return res.json({
        success: true,
        token: 'admin-token-' + Date.now(),
        user: { username: dbUser.username, role: dbUser.role || 'admin' },
      });
    }
  } catch (error) {
    console.error('[login] Error:', error);
    return res.status(500).json({ success: false, message: 'Error del servidor' });
  }

  return res.status(401).json({ success: false, message: 'Credenciales incorrectas' });
});

// Todas las rutas /api (excepto login y health) requieren DB disponible
app.use('/api', (req, res, next) => {
  if (req.path === '/login' || req.path === '/health') return next();
  return requireDb(req, res, next);
});

// Products endpoints
app.get('/api/products', async (req, res) => {
  try {
    const products = await db.collection('products').find({}).toArray();
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching products' });
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await db.collection('products').findOne({ id: req.params.id });
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching product' });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    const { name, category, price, description, image, stock, colorVariants, storageVariants, specifications, reviews } = req.body;
    const id = Date.now().toString();
    const product = {
      id,
      name,
      category,
      price,
      description,
      image,
      stock: stock || 0,
      colorVariants: colorVariants || [],
      storageVariants: storageVariants || [],
      specifications: specifications || {},
      reviews: reviews || []
    };
    await db.collection('products').insertOne(product);
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: 'Error creating product' });
  }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    const { name, category, price, description, image, stock, colorVariants, storageVariants, specifications, reviews } = req.body;
    await db.collection('products').updateOne(
      { id: req.params.id },
      { $set: { name, category, price, description, image, stock, colorVariants, storageVariants, specifications, reviews } }
    );
    res.json({ id: req.params.id, name, category, price, description, image, stock, colorVariants, storageVariants, specifications, reviews });
  } catch (error) {
    res.status(500).json({ error: 'Error updating product' });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    await db.collection('products').deleteOne({ id: req.params.id });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting product' });
  }
});

app.get('/api/banners', async (req, res) => {
  try {
    const banners = await db.collection('banners').find({}).toArray();
    res.json(banners.map((b: any) => ({ ...b, _id: undefined })));
  } catch (error) {
    res.status(500).json({ error: 'Error fetching banners' });
  }
});

app.post('/api/banners', async (req, res) => {
  try {
    const { title, subtitle, description, buttonText, buttonLink, backgroundImage } = req.body;
    const banner = { title, subtitle, description, buttonText, buttonLink, backgroundImage };
    const result = await db.collection('banners').insertOne(banner);
    res.json({ id: result.insertedId, ...banner });
  } catch (error) {
    res.status(500).json({ error: 'Error creating banner' });
  }
});

app.put('/api/banners/:id', async (req, res) => {
  try {
    const { title, subtitle, description, buttonText, buttonLink, backgroundImage } = req.body;
    await db.collection('banners').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { title, subtitle, description, buttonText, buttonLink, backgroundImage } }
    );
    res.json({ id: req.params.id, title, subtitle, description, buttonText, buttonLink, backgroundImage });
  } catch (error) {
    res.status(500).json({ error: 'Error updating banner' });
  }
});

app.delete('/api/banners/:id', async (req, res) => {
  try {
    await db.collection('banners').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting banner' });
  }
});

app.get('/api/orders', async (req, res) => {
  try {
    const orders = await db.collection('orders').find({})
      .project({ "items.product.image": 0 })
      .sort({ createdAt: -1 }).toArray();
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching orders' });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const { orderNumber: clientOrderNumber, date, createdAt, items, total, status, customerInfo, paymentMethod } = req.body;
    const id = Date.now().toString();
    const orderNumber = clientOrderNumber || `XM-${Date.now().toString().slice(-8)}`;
    const now = new Date().toISOString();
    const order = {
      id,
      orderNumber,
      date: date || now,
      createdAt: createdAt || now,
      items,
      total,
      status: status || 'pending',
      customerInfo,
      paymentMethod
    };
    
    await db.collection('orders').insertOne(order);

    const notification = {
      orderId: id,
      orderNumber,
      total,
      message: `Nuevo pedido recibido: ${orderNumber}`,
      createdAt: new Date().toISOString(),
      read: false
    };
    await db.collection('notifications').insertOne(notification);

    io.emit('newOrder', notification);

    sendOrderEmail(order);

    res.json(order);
  } catch (error) {
    res.status(500).json({ error: 'Error creating order' });
  }
});

app.put('/api/orders/:id', async (req, res) => {
  try {
    const { status } = req.body;
    await db.collection('orders').updateOne(
      { id: req.params.id },
      { $set: { status } }
    );
    res.json({ id: req.params.id, status });
  } catch (error) {
    res.status(500).json({ error: 'Error updating order' });
  }
});

app.get('/api/notifications', async (req, res) => {
  try {
    const notifications = await db.collection('notifications').find({}).sort({ createdAt: -1 }).limit(50).toArray();
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching notifications' });
  }
});

app.put('/api/notifications/:id/read', async (req, res) => {
  try {
    await db.collection('notifications').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { read: true } }
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error marking notification as read' });
  }
});

// Ticket Configuration endpoints
const defaultTicketConfig = {
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

app.get('/api/ticket-config', async (req, res) => {
  try {
    let config = await db.collection('ticketConfig').findOne({ type: 'config' });
    if (!config) {
      await db.collection('ticketConfig').insertOne({ type: 'config', ...defaultTicketConfig });
      config = await db.collection('ticketConfig').findOne({ type: 'config' });
    }
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching ticket config' });
  }
});

app.put('/api/ticket-config', async (req, res) => {
  try {
    const config = req.body;
    await db.collection('ticketConfig').updateOne(
      { type: 'config' },
      { $set: { ...config, type: 'config' } },
      { upsert: true }
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error updating ticket config' });
  }
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

void connectDB();
