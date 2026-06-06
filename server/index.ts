import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { MongoClient, ObjectId } from 'mongodb';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { Resend } from 'resend';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { createHash } from 'crypto';
// WhatsApp (Baileys + QR)
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  initAuthCreds,
  BufferJSON,
  proto,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';

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

// Configuración de Nodemailer (Recomendado para GMAIL)
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_PASS;

const mailTransporter = GMAIL_USER && GMAIL_PASS ? nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_PASS
  }
}) : null;

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
    // Inicializar WhatsApp con sesión persistente en MongoDB
    whatsappService.init(db, io).catch(err => console.error('[WA] Error en init:', err));
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

// ====================================================================
// WHATSAPP SERVICE — Sesión en MongoDB + QR via Socket.io
// ====================================================================

/** Auth state de Baileys guardado en MongoDB (sin archivos en disco) */
async function useMongoAuthState(dbRef: any, logger: any) {
  const col = dbRef.collection('whatsappAuth');

  const write = async (data: any, id: string) => {
    const value = JSON.stringify(data, BufferJSON.replacer);
    await col.replaceOne({ _id: id as any }, { _id: id as any, value }, { upsert: true });
  };

  const read = async (id: string): Promise<any> => {
    try {
      const doc = await col.findOne({ _id: id as any });
      return doc?.value ? JSON.parse(doc.value, BufferJSON.reviver) : null;
    } catch {
      return null;
    }
  };

  const remove = async (id: string) => { await col.deleteOne({ _id: id as any }); };

  const creds = (await read('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: makeCacheableSignalKeyStore(
        {
          get: async (type: any, ids: string[]) => {
            const result: Record<string, any> = {};
            await Promise.all(
              ids.map(async (id) => {
                let val = await read(`${type}-${id}`);
                if (type === 'app-state-sync-key' && val) {
                  val = proto.Message.AppStateSyncKeyData.fromObject(val);
                }
                result[id] = val;
              })
            );
            return result;
          },
          set: async (data: any) => {
            const tasks: Promise<void>[] = [];
            for (const cat in data) {
              for (const id in data[cat]) {
                const val = data[cat][id];
                tasks.push(val != null ? write(val, `${cat}-${id}`) : remove(`${cat}-${id}`));
              }
            }
            await Promise.all(tasks);
          },
        },
        logger
      ),
    },
    saveCreds: () => write(creds, 'creds'),
  };
}

type WAStatus = 'disconnected' | 'loading' | 'qr_ready' | 'connected';

class WhatsAppService {
  private sock: ReturnType<typeof makeWASocket> | null = null;
  private status: WAStatus = 'disconnected';
  private qrDataUrl: string | null = null;
  private ioRef: Server | null = null;
  private dbRef: any = null;
  private reconnecting = false;

  getStatus(): WAStatus { return this.status; }
  getQRDataUrl(): string | null { return this.qrDataUrl; }

  async init(dbInstance: any, ioInstance: Server) {
    this.dbRef = dbInstance;
    this.ioRef = ioInstance;
    if (this.reconnecting) return;
    await this._connect();
  }

  private async _connect() {
    try {
      this.status = 'loading';
      this.ioRef?.emit('whatsapp-status', { status: 'loading' });
      
      // 1. Desconectar y limpiar cualquier socket anterior para evitar colisiones en Railway
      if (this.sock) {
        try {
          this.sock.ev.removeAllListeners();
          if (this.sock.ws) this.sock.ws.close();
          this.sock = null;
        } catch {}
      }

      const silentLogger = {
        level: 'silent', trace: () => {}, debug: () => {},
        info: () => {}, warn: () => {}, error: () => {},
        fatal: () => {}, child: () => silentLogger,
      } as any;

      const { state, saveCreds } = await useMongoAuthState(this.dbRef, silentLogger);

      // Baileys puede ser un modulo CommonJS tradicional o ESM
      // Omitimos la propiedad version para que use por defecto la version interna mas actualizada y compatible de la libreria
      const makeSocket = (makeWASocket as any).default || makeWASocket;
      this.sock = makeSocket({
        auth: { creds: state.creds, keys: state.keys },
        logger: silentLogger,
        printQRInTerminal: false,
        browser: ['Xiaomi Cartagena', 'Chrome', '126.0'],
        connectTimeoutMs: 30000,
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (qr) {
          try {
            const dataUrl = await QRCode.toDataURL(qr, { margin: 2, width: 280 });
            this.qrDataUrl = dataUrl;
            this.status = 'qr_ready';
            this.ioRef?.emit('whatsapp-qr', { qr: dataUrl });
            console.log('[WA] QR generado y emitido');
          } catch (e) {
            console.error('[WA] Error generando QR:', e);
          }
        }

        if (connection === 'open') {
          this.status = 'connected';
          this.qrDataUrl = null;
          this.reconnecting = false;
          this.ioRef?.emit('whatsapp-status', { status: 'connected' });
          console.log('[WA] ✅ Conectado exitosamente');
        }

        if (connection === 'close') {
          const code = (lastDisconnect?.error as any)?.output?.statusCode;
          const isLogout = code === DisconnectReason.loggedOut;
          this.status = 'disconnected';
          this.qrDataUrl = null;
          this.ioRef?.emit('whatsapp-status', { status: 'disconnected' });
          console.log('[WA] Conexión cerrada — código:', code, '| logout:', isLogout);
          
          if (isLogout) {
            console.log('[WA] 🧹 Sesión caducada o inválida. Limpiando credenciales en base de datos...');
            try {
              if (this.dbRef) await this.dbRef.collection('whatsappAuth').deleteMany({});
            } catch (err) {
              console.error('[WA] Error limpiando credenciales:', err);
            }
          } else {
            this.reconnecting = true;
            setTimeout(() => { this.reconnecting = false; this._connect(); }, 8000);
          }
        }
      });
    } catch (err) {
      console.error('[WA] Error fatal al inicializar Baileys:', err);
      // Blindaje supremo: si las credenciales en MongoDB estan corruptas o son incompatibles,
      // limpiamos la coleccion whatsappAuth para forzar una sesion limpia en el siguiente reintento.
      try {
        if (this.dbRef) {
          await this.dbRef.collection('whatsappAuth').deleteMany({});
          console.log('[WA] 🧹 Colección whatsappAuth limpiada automáticamente por credenciales corruptas.');
        }
      } catch (cleanErr) {
        console.error('[WA] Error al limpiar colección tras fallo:', cleanErr);
      }
      this.status = 'disconnected';
    }
  }

  async sendMessage(phone: string, text: string): Promise<boolean> {
    if (!this.sock || this.status !== 'connected') return false;
    try {
      const jid = this._formatPhone(phone);
      await this.sock.sendMessage(jid, { text });
      console.log('[WA] Mensaje enviado a', phone);
      return true;
    } catch (err) {
      console.error('[WA] Error al enviar mensaje:', err);
      return false;
    }
  }

  _formatPhone(phone: string): string {
    let clean = String(phone).replace(/[\s\-\+\(\)\.]/g, '');
    if (clean.startsWith('0')) clean = clean.slice(1);
    if (clean.length === 10 && !clean.startsWith('57')) clean = '57' + clean;
    if (clean.length === 12 && clean.startsWith('57')) { /* ok */ }
    return clean + '@s.whatsapp.net';
  }

  async disconnect() {
    try {
      if (this.sock) {
        this.sock.ev.removeAllListeners();
        await this.sock.logout().catch(() => {});
        this.sock = null;
      }
      if (this.dbRef) {
        await this.dbRef.collection('whatsappAuth').deleteMany({});
      }
    } catch (e) {
      console.error('[WA] Error al desconectar:', e);
    }
    this.status = 'disconnected';
    this.qrDataUrl = null;
    this.reconnecting = false;
    this.ioRef?.emit('whatsapp-status', { status: 'disconnected' });
  }
}

const whatsappService = new WhatsAppService();

// ---- Plantillas por defecto ----
const DEFAULT_CUSTOMER_TEMPLATE =
`🎉 *¡Pedido Confirmado!* — Xiaomi Cartagena

Hola *{{nombre}}*, gracias por tu compra. 🧡

🔖 *Orden:* #{{ordenNumero}}

🛍️ *Tus productos:*
{{productos}}

💰 *Total:* $\{{total}} COP
💳 *Pago:* {{metodoPago}}
🚚 *Entrega:* {{metodoEntrega}}
{{linea_direccion}}
⏱️ En breve nuestro equipo se contactará contigo.
¿Tienes dudas? Responde este mensaje 👋

_Xiaomi Cartagena — Cl. 31 #61-64, Los Ángeles_`;

const DEFAULT_OWNER_TEMPLATE =
`🔔 *NUEVA VENTA* 🎯 — Xiaomi Cartagena

👤 *Cliente:* {{nombre}}
📞 *Cel:* {{telefono}}
📧 *Email:* {{email}}
🪪 *Cédula:* {{cedula}}

🔖 *Orden:* #{{ordenNumero}}

🛍️ *Productos:*
{{productos}}

💰 *Total:* $\{{total}} COP
💳 *Pago:* {{metodoPago}}
🚚 *Entrega:* {{metodoEntrega}}
{{linea_direccion}}
📅 {{fecha}}

_Xiaomi Cartagena_`;

function processWhatsAppTemplate(template: string, order: any): string {
  const items: any[] = order.items || [];
  const isDelivery = order.customerInfo?.deliveryMethod === 'delivery';
  const deliveryLabel = isDelivery ? 'Domicilio 🛵' : 'Retiro en tienda 🏪';
  const addressLine = isDelivery && order.customerInfo?.address
    ? `📍 *Dirección:* ${order.customerInfo.address}\n`
    : '';

  const deliveryFee = order.customerInfo?.deliveryFee || 0;
  const isAddi = (order.paymentMethod || '').toLowerCase().includes('addi');
  const addiSurcharge = isAddi ? Math.round((order.total || 0) * 0.25) : 0;
  const isCard = (order.paymentMethod || '').toLowerCase().includes('tarjeta') || (order.paymentMethod || '').toLowerCase().includes('bold');
  const cardFee = isCard ? Math.round((order.total || 0) * 0.05) : 0;
  const grandTotal = (order.total || 0) + cardFee + addiSurcharge + deliveryFee;

  let extrasStr = '';
  if (deliveryFee > 0) extrasStr += `\n  • Domicilio — $${deliveryFee.toLocaleString('es-CO')} COP`;
  if (cardFee > 0) extrasStr += `\n  • Recargo Tarjeta (5%) — $${cardFee.toLocaleString('es-CO')} COP`;

  const productsList = items
    .map((item: any) => {
      const baseTotal = (item.product?.price || 0) * (item.quantity || 1);
      const itemAddi = isAddi ? Math.round(baseTotal * 0.25) : 0;
      return `  • ${item.product?.name || 'Producto'} x${item.quantity || 1} — $${(baseTotal + itemAddi).toLocaleString('es-CO')} COP`;
    })
    .join('\n') + extrasStr;

  const vars: Record<string, string> = {
    '{{nombre}}': order.customerInfo?.name || 'Cliente',
    '{{ordenNumero}}': order.orderNumber || '',
    '{{productos}}': productsList,
    '{{total}}': grandTotal.toLocaleString('es-CO'),
    '{{metodoPago}}': order.paymentMethod || order.customerInfo?.paymentMethod || '',
    '{{metodoEntrega}}': deliveryLabel,
    '{{linea_direccion}}': addressLine,
    '{{telefono}}': order.customerInfo?.phone || '',
    '{{email}}': order.customerInfo?.email || '',
    '{{cedula}}': order.customerInfo?.idNumber || '',
    '{{fecha}}': new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'full', timeStyle: 'short' }),
  };

  let result = template;
  for (const [key, val] of Object.entries(vars)) {
    result = result.split(key).join(val);
  }
  return result;
}

async function sendWhatsAppNotifications(order: any) {
  if (whatsappService.getStatus() !== 'connected') {
    console.log('[WA] Notificaciones omitidas — no conectado');
    return;
  }
  
  if (order.customerInfo?.deliveryMethod !== 'delivery') {
    console.log('[WA] Notificaciones omitidas — pedido es para retiro en tienda');
    return;
  }

  try {
    const config = await db.collection('ticketConfig').findOne({ type: 'config' }) || {};
    const ownerPhone: string = config.ownerWhatsAppPhone || '';
    const customerTemplate: string = config.whatsappCustomerTemplate || DEFAULT_CUSTOMER_TEMPLATE;
    const ownerTemplate: string = config.whatsappOwnerTemplate || DEFAULT_OWNER_TEMPLATE;

    const customerPhone: string = order.customerInfo?.phone || '';

    if (customerPhone) {
      const msg = processWhatsAppTemplate(customerTemplate, order);
      console.log(`[WA] Intentando enviar al cliente: ${customerPhone}`);
      const success = await Promise.race([
        whatsappService.sendMessage(customerPhone, msg),
        new Promise(resolve => setTimeout(() => {
          console.error('[WA] Timeout al enviar mensaje al cliente');
          resolve(false);
        }, 10000))
      ]);
      console.log(`[WA] Resultado envío cliente: ${success}`);
      // Pequeño delay para evitar bloqueo por spam (error 401)
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    if (ownerPhone) {
      const msg = processWhatsAppTemplate(ownerTemplate, order);
      console.log(`[WA] Intentando enviar al administrador: ${ownerPhone}`);
      const success = await Promise.race([
        whatsappService.sendMessage(ownerPhone, msg),
        new Promise(resolve => setTimeout(() => {
          console.error('[WA] Timeout al enviar mensaje al admin');
          resolve(false);
        }, 10000))
      ]);
      console.log(`[WA] Resultado envío admin: ${success}`);
    }
  } catch (err) {
    console.error('[WA] Error al enviar notificaciones:', err);
  }
}

async function sendOrderEmail(order: any) {
  if (!resend && !mailTransporter) {
    console.log('[server] Ni RESEND_API_KEY ni GMAIL_USER/PASS configurados, email omitido');
    return;
  }
  try {
    const ticketConfig = await db.collection('ticketConfig').findOne({ type: 'config' });
    const config = ticketConfig || {
      storeName: 'XIAOMI STORE',
      tagline: 'Tecnología Premium',
      address: 'Cl. 31 #61-64, Los Ángeles',
      city: 'Cartagena de Indias',
      phone: '(605) 123-4567',
      website: 'www.xiaomi.com',
      footerMessage: '¡Gracias por tu compra!',
      warrantyMessage: 'Conserva este ticket para tu garantía',
      schedule: 'Lun - Vie: 9:00 AM - 7:00 PM | Dom: 10:30 AM - 3:00 PM'
    };

    const deliveryFee = order.customerInfo?.deliveryFee || 0;
    const isCard = (order.paymentMethod || '').toLowerCase().includes('tarjeta') || (order.paymentMethod || '').toLowerCase().includes('bold');
    const cardFee = isCard ? Math.round(order.total * 0.05) : 0;
    const grandTotal = order.total + cardFee + deliveryFee;

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

    const emailHtml = `
      <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
        <div style="background-color: #ff6900; padding: 30px 20px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 28px; letter-spacing: -0.5px;">¡Tu pedido ha sido confirmado! 🎉</h1>
          <p style="color: #fff3e0; margin: 10px 0 0 0; font-size: 16px;">Gracias por elegir Xiaomi Cartagena</p>
        </div>
        
        <div style="padding: 30px;">
          <p style="font-size: 16px; color: #333; line-height: 1.5; margin-top: 0;">Hola <strong>${order.customerInfo?.name || 'Cliente'}</strong>,</p>
          <p style="font-size: 16px; color: #555; line-height: 1.5;">Hemos recibido tu orden <strong>#${order.orderNumber}</strong> y estamos preparándola con mucho cuidado.</p>
          
          <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #ff6900;">
            <h3 style="margin-top: 0; color: #333; font-size: 16px; text-transform: uppercase; letter-spacing: 0.5px;">Resumen de tu Orden</h3>
            <ul style="list-style: none; padding: 0; margin: 0;">${itemsHtml}</ul>
            
            <div style="margin-top: 20px; padding-top: 15px; border-top: 1px dashed #ccc; text-align: right;">
              <p style="margin: 5px 0; font-size: 14px; color: #666;">Subtotal: $${order.total.toLocaleString('es-CO')} COP</p>
              ${deliveryFee > 0 ? `<p style="margin: 5px 0; font-size: 14px; color: #666;">Envío: $${deliveryFee.toLocaleString('es-CO')} COP</p>` : ''}
              ${cardFee > 0 ? `<p style="margin: 5px 0; font-size: 14px; color: #666;">Recargo Tarjeta (5%): $${cardFee.toLocaleString('es-CO')} COP</p>` : ''}
              <h2 style="margin: 10px 0 0 0; color: #ff6900; font-size: 22px;">Total: $${grandTotal.toLocaleString('es-CO')} COP</h2>
            </div>
          </div>
          
          <div style="margin-top: 25px;">
            <h4 style="color: #333; margin-bottom: 10px; font-size: 15px;">Detalles de Entrega</h4>
            <p style="margin: 5px 0; color: #555; font-size: 14px;"><strong>Método:</strong> ${order.customerInfo?.deliveryMethod === 'delivery' ? 'Domicilio' : 'Retiro en tienda'}</p>
            ${order.customerInfo?.deliveryMethod === 'delivery' ? `<p style="margin: 5px 0; color: #555; font-size: 14px;"><strong>Dirección:</strong> ${order.customerInfo?.address || ''}</p>` : ''}
            <p style="margin: 5px 0; color: #555; font-size: 14px;"><strong>Pago:</strong> ${order.paymentMethod}</p>
          </div>
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; text-align: center;">
            <p style="color: #888; font-size: 13px; margin: 0;">¿Tienes alguna pregunta? Contáctanos a nuestro WhatsApp: ${config.phone}</p>
          </div>
        </div>
      </div>
    `;

    const customerEmail = order.customerInfo?.email;
    const adminEmail = 'xiaomi.cartagenaventas@gmail.com';

    if (mailTransporter) {
      await mailTransporter.sendMail({
        from: `"Xiaomi Cartagena" <${GMAIL_USER}>`,
        to: customerEmail,
        subject: `Confirmación de Pedido ${order.orderNumber} - Xiaomi Cartagena`,
        html: emailHtml
      });
      console.log(`[server] Email enviado a ${customerEmail} vía Nodemailer`);
    } else if (resend) {
      const { data, error } = await resend.emails.send({
        from: 'Xiaomi Cartagena <ventas@xiaomicartagena.com>',
        to: [customerEmail],
        reply_to: adminEmail,
        subject: `Confirmación de Pedido #${order.orderNumber} - Xiaomi Cartagena`,
        html: emailHtml
      });
      
      if (error) {
        console.error('[server] Error de Resend al enviar a cliente:', error);
      } else {
        console.log(`[server] Email enviado a ${customerEmail} vía Resend`);
      }
    }

    // Admin copy
    if (mailTransporter) {
        await mailTransporter.sendMail({
          from: `"Xiaomi Cartagena" <${GMAIL_USER}>`,
          to: adminEmail,
          subject: `NUEVA VENTA: Pedido #${order.orderNumber} - Xiaomi Cartagena`,
          html: emailHtml
        });
    } else if (resend) {
        const { error } = await resend.emails.send({
            from: 'Xiaomi Cartagena <ventas@xiaomicartagena.com>',
            to: [adminEmail],
            subject: `NUEVA VENTA: Pedido #${order.orderNumber} - Xiaomi Cartagena`,
            html: emailHtml
        });
        if (error) console.error('[server] Error de Resend al enviar copia admin:', error);
    }

  } catch (error) {
    console.error('[server] Error sending email:', error);
  }
}

async function sendInvoiceEmail(order: any) {
  if (!resend && !mailTransporter) {
    console.log('[server] Ni RESEND_API_KEY ni GMAIL_USER/PASS configurados, email omitido');
    return;
  }
  
  try {
    const ticketConfig = await db.collection('ticketConfig').findOne({ type: 'config' });
    const config = ticketConfig || {
      storeName: 'XIAOMI STORE',
      tagline: 'Tecnología Premium',
      address: 'Cl. 31 #61-64, Los Ángeles',
      city: 'Cartagena de Indias',
      phone: '302 287 5280',
      nit: '1043345642-7',
      website: 'www.xiaomicartagena.com',
      footerMessage: '¡Gracias por tu compra!',
      warrantyMessage: 'Conserva este ticket para tu garantía',
      schedule: 'Lun - Vie: 9:00 AM - 7:00 PM | Dom: 10:30 AM - 3:00 PM'
    };

    const deliveryFee = order.customerInfo?.deliveryFee || 0;
    const isCard = (order.paymentMethod || '').toLowerCase().includes('tarjeta') || (order.paymentMethod || '').toLowerCase().includes('bold');
    const cardFee = isCard ? Math.round(order.total * 0.05) : 0;
    const grandTotal = order.total + cardFee + deliveryFee;
    const nitValue = config.nit || '1043345642-7';

    const ticketHtml = `
      <div style="border: 2px solid #333; padding: 20px; max-width: 320px; font-family: 'Courier New', Courier, monospace; font-size: 12px; background: #fff; margin: 0 auto; color: #000;">
        <div style="text-align: center; border-bottom: 2px dashed #000; padding-bottom: 12px; margin-bottom: 16px;">
          <h2 style="margin: 0 0 4px 0; font-size: 22px; text-transform: uppercase;">${config.storeName}</h2>
          <p style="margin: 0 0 6px 0; font-size: 11px;">${config.tagline}</p>
          <p style="margin: 0 0 4px 0; font-weight: bold; font-size: 12px;">NIT: ${nitValue}</p>
          <p style="margin: 8px 0 0 0; font-size: 10px;">${config.address}</p>
          <p style="margin: 0; font-size: 10px;">${config.city}</p>
          <p style="margin: 4px 0 0 0; font-size: 10px; font-weight: bold;">Tel: ${config.phone}</p>
          <p style="margin: 4px 0 0 0; font-size: 10px;">${config.website}</p>
        </div>
        
        <div style="margin-bottom: 12px; font-size: 11px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <strong>ORDEN:</strong> <span style="font-weight: bold;">#${order.orderNumber}</span>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
            <strong>FECHA:</strong> <span>${new Date(order.date).toLocaleDateString('es-CO')}</span>
          </div>
        </div>
        
        <div style="border-top: 1px dashed #000; margin: 10px 0;"></div>
        
        <div style="margin-bottom: 12px; font-size: 11px;">
          <div style="margin-bottom: 4px; font-weight: bold;">CLIENTE</div>
          <div>Nombre: <span style="text-transform: uppercase;">${order.customerInfo?.name || 'N/A'}</span></div>
          <div>Cédula/NIT: ${order.customerInfo?.idNumber || 'N/A'}</div>
          <div>Tel: ${order.customerInfo?.phone || 'N/A'}</div>
        </div>

        <div style="border-top: 1px dashed #000; margin: 10px 0;"></div>
        
        <div style="margin-bottom: 12px; font-size: 11px;">
          <div style="margin-bottom: 4px; font-weight: bold;">ENTREGA</div>
          <div style="text-transform: uppercase;">${order.customerInfo?.deliveryMethod === 'delivery' ? 'Envío a domicilio' : 'Retiro en tienda'}</div>
          ${order.customerInfo?.deliveryMethod === 'delivery' ? `<div style="margin-top: 2px;">Dir: ${order.customerInfo?.address || ''}</div>` : ''}
        </div>

        <div style="border-top: 2px solid #000; margin: 10px 0;"></div>
        
        <div style="margin-bottom: 12px;">
          <div style="font-size: 12px; font-weight: bold; margin-bottom: 8px;">PRODUCTOS</div>
          ${order.items.map((item: any) => `
            <div style="margin-bottom: 10px; font-size: 11px;">
              <div style="font-weight: bold; text-transform: uppercase;">${item.product?.name || 'Producto'}</div>
              <div style="font-size: 10px; margin-bottom: 4px;">
                ${item.selectedStorage ? `[${item.selectedStorage}]` : ''} 
                ${item.selectedColor ? `- Color: ${item.selectedColor}` : ''}
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span>${item.quantity} x $${(item.product?.price || 0).toLocaleString('es-CO')}</span>
                <strong>$${((item.product?.price || 0) * item.quantity).toLocaleString('es-CO')}</strong>
              </div>
              ${item.serialNumber ? `<div style="font-size: 10px; margin-top: 4px;">SN: ${item.serialNumber}</div>` : ''}
              ${item.invoiceNumber ? `<div style="font-size: 10px; margin-top: 2px;">Factura: ${item.invoiceNumber}</div>` : ''}
            </div>
          `).join('')}
        </div>
        
        <div style="border-top: 1px dashed #000; margin: 10px 0;"></div>

        <div style="font-size: 11px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span>Subtotal:</span>
            <span>$${order.total.toLocaleString('es-CO')}</span>
          </div>
          ${deliveryFee > 0 ? `
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span>Domicilio:</span>
            <span>$${deliveryFee.toLocaleString('es-CO')}</span>
          </div>` : ''}
          ${cardFee > 0 ? `
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span>Recargo Tarjeta (5%):</span>
            <span>$${cardFee.toLocaleString('es-CO')}</span>
          </div>` : ''}
          
          <div style="border-top: 2px solid #000; margin: 10px 0;"></div>
          
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 16px; font-weight: bold;">
            <span>TOTAL:</span>
            <span>$${grandTotal.toLocaleString('es-CO')} COP</span>
          </div>
        </div>

        <div style="margin-bottom: 16px; font-size: 11px; border-top: 1px dashed #000; padding-top: 10px;">
          <div style="display: flex; justify-content: space-between;">
            <strong>MÉTODO DE PAGO:</strong>
            <span style="text-transform: uppercase;">${order.paymentMethod}</span>
          </div>
        </div>
        
        <div style="border-top: 2px dashed #000; margin: 16px 0;"></div>
        
        <div style="text-align: center; font-size: 10px; margin-top: 16px;">
          <div style="margin-bottom: 12px; font-weight: bold; font-size: 14px; text-transform: uppercase;">${config.footerMessage}</div>
          <div style="margin-top: 12px; line-height: 1.5; text-align: justify;">${config.warrantyMessage}</div>
          <div style="margin-top: 12px;">
            <div style="font-weight: bold; margin-bottom: 2px;">Horario de atención:</div>
            <div>${config.schedule}</div>
          </div>
        </div>
      </div>
    `;

    const emailHtml = `
      <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #333; margin-bottom: 10px;">Tu Factura Oficial</h1>
          <p style="color: #666; font-size: 16px;">Hola <strong>${order.customerInfo?.name}</strong>, adjuntamos tu ticket de compra detallado de la orden #${order.orderNumber}.</p>
        </div>
        
        <div style="background-color: #f9f9f9; padding: 30px; border-radius: 12px;">
          ${ticketHtml}
        </div>
        
        <div style="text-align: center; margin-top: 30px;">
          <p style="color: #888; font-size: 13px;">Si tienes alguna duda con tu factura, contáctanos a nuestro WhatsApp: ${config.phone}</p>
        </div>
      </div>
    `;

    if (mailTransporter) {
      await mailTransporter.sendMail({
        from: `"Xiaomi Cartagena" <${GMAIL_USER}>`,
        to: order.customerInfo.email,
        subject: `Factura Digital - Pedido ${order.orderNumber}`,
        html: emailHtml
      });
      console.log(`[server] Factura enviada a ${order.customerInfo.email} vía Nodemailer`);
      return;
    }

    if (resend) {
      const { error } = await resend.emails.send({
        from: 'Xiaomi Cartagena <ventas@xiaomicartagena.com>',
        to: order.customerInfo.email,
        subject: `Factura Oficial - Orden #${order.orderNumber} - Xiaomi Cartagena`,
        html: emailHtml
      });
      if (error) {
        console.error('[server] Error de Resend en factura:', error);
      } else {
        console.log('[server] Invoice email sent successfully');
      }
    }
  } catch (error) {
    console.error('[server] Error sending invoice email:', error);
  }
}

app.use(cors());
app.use(compression());
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

const MAX_STORED_IMAGE_BYTES = 700 * 1024;
const SAFE_UPLOAD_FOLDERS = new Set(['productos', 'banners', 'general']);

function parseBase64Image(image: string): { mime: string; buffer: Buffer } | null {
  const match = image.match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
  const raw = match ? match[2] : image.replace(/^data:image\/\w+;base64,/, '');
  const mime = match?.[1] || 'image/jpeg';
  try {
    const buffer = Buffer.from(raw, 'base64');
    if (!buffer.length) return null;
    return { mime, buffer };
  } catch {
    return null;
  }
}

function productQuery(id: string) {
  const filters: Record<string, unknown>[] = [{ id }];
  if (/^[a-f\d]{24}$/i.test(id)) {
    try {
      filters.push({ _id: new ObjectId(id) });
    } catch {
      /* ignore invalid ObjectId */
    }
  }
  return { $or: filters };
}

function rejectInlineBase64Image(image: unknown): string | null {
  if (typeof image !== 'string' || !image.startsWith('data:image')) return null;
  return 'La imagen debe subirse antes de guardar. Usa "Subir imagen" o una URL externa.';
}

function sanitizeImageUrl(image: unknown): string {
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

function sanitizeProductForCatalog(doc: Record<string, unknown>) {
  const { _id, ...rest } = doc;
  const id =
    (typeof rest.id === 'string' && rest.id) ||
    (typeof _id === 'object' && _id && 'toString' in (_id as object)
      ? String(_id)
      : typeof _id === 'string'
        ? _id
        : '');

  return {
    ...rest,
    id,
    image: sanitizeImageUrl(rest.image),
  };
}

function sanitizeBannerForCatalog(doc: Record<string, unknown>) {
  const { _id, ...rest } = doc;
  return {
    ...rest,
    backgroundImage: sanitizeImageUrl(rest.backgroundImage),
    _id: _id ? String(_id) : undefined,
  };
}

type OrderItemDoc = {
  product?: { id?: string; image?: string; [key: string]: unknown };
  [key: string]: unknown;
};

type OrderDoc = {
  items?: OrderItemDoc[];
  [key: string]: unknown;
};

/** Rellena URLs de imagen desde el catálogo (sin enviar base64 guardado en pedidos antiguos). */
async function hydrateOrdersWithProductImages(orders: OrderDoc[]): Promise<OrderDoc[]> {
  const productIds = new Set<string>();
  for (const order of orders) {
    for (const item of order.items || []) {
      const pid = item.product?.id;
      if (typeof pid === 'string' && pid) productIds.add(pid);
    }
  }

  const imageById = new Map<string, string>();
  if (productIds.size > 0) {
    const products = await db
      .collection('products')
      .find({ id: { $in: [...productIds] } })
      .project({ id: 1, image: 1 })
      .toArray();
    for (const p of products) {
      const id = typeof p.id === 'string' ? p.id : '';
      if (id) imageById.set(id, sanitizeImageUrl(p.image));
    }
  }

  return orders.map((order) => ({
    ...order,
    items: (order.items || []).map((item) => {
      const product = item.product || {};
      const stored = sanitizeImageUrl(product.image);
      const fromCatalog =
        typeof product.id === 'string' ? imageById.get(product.id) || '' : '';
      return {
        ...item,
        product: { ...product, image: stored || fromCatalog },
      };
    }),
  }));
}

async function tryVercelBlobUpload(buffer: Buffer, path: string): Promise<string | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  try {
    const { put } = await import('@vercel/blob');
    const blob = await put(path, buffer, { access: 'public', token });
    return blob.url;
  } catch (error) {
    console.warn('[upload] Vercel Blob no disponible, usando Mongo media:', error);
    return null;
  }
}

function buildPublicUrl(req: express.Request, mediaId: string) {
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  const host = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  return `${proto}://${host}/api/media/${mediaId}`;
}

app.post('/api/upload', async (req, res) => {
  try {
    const { image, filename, productId, folder = 'productos' } = req.body || {};
    if (!image || typeof image !== 'string') {
      return res.status(400).json({ error: 'image es requerida' });
    }

    const parsed = parseBase64Image(image);
    if (!parsed) {
      return res.status(400).json({ error: 'Imagen inválida' });
    }
    if (parsed.buffer.length > 4 * 1024 * 1024) {
      return res.status(413).json({ error: 'Imagen muy grande (máximo 4MB antes de comprimir)' });
    }

    const ext = (String(filename || 'image.jpg').split('.').pop() || 'jpg').toLowerCase();
    const safeFolder = SAFE_UPLOAD_FOLDERS.has(folder) ? folder : 'productos';
    const blobPath = `${safeFolder}/${productId || 'item'}-${Date.now()}.${ext}`;

    const blobUrl = await tryVercelBlobUpload(parsed.buffer, blobPath);
    if (blobUrl) {
      return res.json({ url: blobUrl, success: true });
    }

    if (parsed.buffer.length > MAX_STORED_IMAGE_BYTES) {
      return res.status(413).json({
        error: `Imagen muy pesada (${Math.round(parsed.buffer.length / 1024)}KB). Comprime más o usa una URL externa.`,
      });
    }

    const mediaId = `${productId || 'img'}-${Date.now()}`;
    await db.collection('media').insertOne({
      mediaId,
      mime: parsed.mime,
      data: parsed.buffer,
      folder: safeFolder,
      createdAt: new Date().toISOString(),
    });

    return res.json({
      url: buildPublicUrl(req, mediaId),
      success: true,
      mediaId,
    });
  } catch (error) {
    console.error('[upload]', error);
    return res.status(500).json({ error: 'Error al subir imagen' });
  }
});

app.get('/api/media/:mediaId', async (req, res) => {
  try {
    const doc = await db.collection('media').findOne({ mediaId: req.params.mediaId });
    if (!doc) return res.status(404).end();

    res.setHeader('Content-Type', doc.mime || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    if (Buffer.isBuffer(doc.data)) {
      return res.send(doc.data);
    }
    if (doc.data?.buffer) {
      return res.send(Buffer.from(doc.data.buffer));
    }
    return res.send(Buffer.from(doc.data));
  } catch (error) {
    console.error('[media]', error);
    return res.status(500).end();
  }
});

// Products endpoints
app.get('/api/products', async (req, res) => {
  try {
    const products = await db
      .collection('products')
      .find({})
      .project({ image: 1, id: 1, name: 1, category: 1, price: 1, description: 1, stock: 1, colorVariants: 1, storageVariants: 1, specifications: 1, reviews: 1, isFeatured: 1 })
      .toArray();

    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json(products.map((p: Record<string, unknown>) => sanitizeProductForCatalog(p)));
  } catch (error) {
    res.status(500).json({ error: 'Error fetching products' });
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await db.collection('products').findOne(productQuery(req.params.id));
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(sanitizeProductForCatalog(product as Record<string, unknown>));
  } catch (error) {
    res.status(500).json({ error: 'Error fetching product' });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    const { name, category, price, description, image, stock, colorVariants, storageVariants, specifications, reviews, isFeatured } = req.body;
    const inlineImageError = rejectInlineBase64Image(image);
    if (inlineImageError) {
      return res.status(400).json({ error: inlineImageError });
    }

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
      reviews: reviews || [],
      isFeatured: !!isFeatured
    };
    await db.collection('products').insertOne(product);
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: 'Error creating product' });
  }
});

const PRODUCT_UPDATE_FIELDS = [
  'name', 'category', 'price', 'description', 'image', 'stock',
  'colorVariants', 'storageVariants', 'specifications', 'reviews', 'isFeatured'
] as const;

async function updateProductRecord(id: string, body: Record<string, unknown>, res: express.Response) {
  const inlineImageError = rejectInlineBase64Image(body.image);
  if (inlineImageError) {
    return res.status(400).json({ error: inlineImageError });
  }

  const $set: Record<string, unknown> = {};
  for (const key of PRODUCT_UPDATE_FIELDS) {
    if (body[key] !== undefined) $set[key] = body[key];
  }
  if (Object.keys($set).length === 0) {
    return res.status(400).json({ error: 'No hay campos para actualizar' });
  }

  const result = await db.collection('products').updateOne(productQuery(id), { $set });
  if (result.matchedCount === 0) {
    return res.status(404).json({ error: 'Producto no encontrado' });
  }

  const updated = await db.collection('products').findOne(productQuery(id));
  return res.json(updated);
}

app.put('/api/products/:id', async (req, res) => {
  try {
    await updateProductRecord(req.params.id, req.body, res);
  } catch (error) {
    res.status(500).json({ error: 'Error updating product' });
  }
});

app.put('/api/products', async (req, res) => {
  try {
    const id = req.body?.id;
    if (!id) return res.status(400).json({ error: 'id requerido' });
    const { id: _removed, ...rest } = req.body;
    await updateProductRecord(String(id), rest, res);
  } catch (error) {
    res.status(500).json({ error: 'Error updating product' });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    const result = await db.collection('products').deleteOne(productQuery(req.params.id));
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting product' });
  }
});

app.delete('/api/products', async (req, res) => {
  try {
    const id = req.body?.id;
    if (!id) return res.status(400).json({ error: 'id requerido' });
    const result = await db.collection('products').deleteOne(productQuery(String(id)));
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting product' });
  }
});

app.get('/api/banners', async (req, res) => {
  try {
    const banners = await db.collection('banners').find({}).toArray();
    res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=600');
    res.json(banners.map((b: Record<string, unknown>) => sanitizeBannerForCatalog(b)));
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
      .project({ 'items.product.image': 0 })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(await hydrateOrdersWithProductImages(orders as OrderDoc[]));
  } catch (error) {
    res.status(500).json({ error: 'Error fetching orders' });
  }
});

app.post('/api/addi/create-transaction', async (req, res) => {
  try {
    const { orderId, totalAmount, items, client, shippingAddress } = req.body;
    
    // 1. Obtener Token de Addi
    const tokenRes = await fetch('https://auth.addi.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: 'upT8WKxtMzHHtFI9SrWThPjjghzHkATy',
        client_secret: '1YB3cFJDfFyeEAxhKBGjPfvLeto1NIKygCPlKmDGCG1YD4eQG0rkLrH_DMFep_MP',
        grant_type: 'client_credentials',
        audience: 'https://api.addi.com'
      })
    });
    
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error('Addi Token Error:', tokenData);
      return res.status(500).json({ error: 'Error de autenticación con Addi' });
    }

    // 2. Crear Transacción en Addi
    const transactionRes = await fetch('https://api.addi.com/v1/online-applications', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json'
      },
      redirect: 'manual', // Importante para capturar el header Location
      body: JSON.stringify({
        orderId,
        totalAmount: Number(totalAmount),
        shippingAmount: 0,
        currency: "COP",
        items,
        client,
        shippingAddress: shippingAddress || {
          lineOne: client.address.lineOne,
          city: client.address.city,
          country: "CO"
        },
        allyUrlRedirection: {
          logoUrl: "https://xiaomicartagena.com/favicon.ico",
          callbackUrl: "https://xiaomictg-production.up.railway.app/api/addi/callback",
          redirectionUrl: "https://xiaomicartagena.com/?addi_success=true"
        }
      })
    });

    if (transactionRes.status === 301 || transactionRes.status === 302) {
      const addiUrl = transactionRes.headers.get('location');
      return res.json({ success: true, redirectUrl: addiUrl });
    } else {
      const errorText = await transactionRes.text();
      console.error('Addi Transaction Error:', transactionRes.status, errorText);
      return res.status(500).json({ error: 'Error al crear la transacción en Addi' });
    }

  } catch (error) {
    console.error('Addi API Error:', error);
    res.status(500).json({ error: 'Error interno conectando con Addi' });
  }
});

// Webhook / Callback de Addi cuando la transacción es aprobada o rechazada
app.post('/api/addi/callback', async (req, res) => {
  try {
    const addiPayload = req.body;
    console.log('Addi Callback Payload:', JSON.stringify(addiPayload));

    // El payload de Addi generalmente trae el status y el orderId
    const { orderId, status } = addiPayload;
    
    if (orderId && status === 'APPROVED') {
      const order = await db.collection('orders').findOne({ orderNumber: orderId });
      
      if (order && order.status === 'pending_addi') {
        // Actualizamos a pagado
        await db.collection('orders').updateOne(
          { orderNumber: orderId },
          { $set: { status: 'paid' } }
        );

        // Notificamos por WhatsApp y Correo ahora sí!
        const [hydratedOrder] = await hydrateOrdersWithProductImages([{ ...order, status: 'paid' } as OrderDoc]);
        sendOrderEmail(hydratedOrder).catch(err => console.error('Error sending email:', err));
        sendWhatsAppNotifications(hydratedOrder).catch(err => console.error('[WA] Error notificaciones:', err));
        
        io.emit('orderUpdated', { id: order.id, status: 'paid' });
      }
    }
    
    // Addi exige un 200 OK
    res.status(200).send('OK');
  } catch (error) {
    console.error('Addi Callback Error:', error);
    res.status(500).send('Error');
  }
});

// En caso de que Addi redirija al cliente por GET al callback
app.get('/api/addi/callback', async (req, res) => {
  // Redirigimos al inicio con un mensaje de éxito
  res.redirect('/?addi_success=true');
});


app.post('/api/orders', async (req, res) => {
  try {
    const { action, order: invoiceOrder } = req.body;
    
    if (action === 'send-invoice') {
      if (!invoiceOrder || !invoiceOrder.customerInfo?.email) {
        return res.status(400).json({ error: 'Orden inválida o falta email del cliente' });
      }
      await sendInvoiceEmail(invoiceOrder);
      return res.json({ success: true });
    }

    const { orderNumber: clientOrderNumber, date, createdAt, items, total, status, customerInfo, paymentMethod } = req.body;
    
    // Validación básica de la orden
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'La orden debe tener al menos un producto' });
    }
    if (total === undefined || total === null || isNaN(Number(total)) || Number(total) < 0) {
      return res.status(400).json({ error: 'Total inválido' });
    }

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

    const [hydratedOrder] = await hydrateOrdersWithProductImages([order as OrderDoc]);
    
    // Solo enviamos notificaciones de confirmación de pedido
    // si NO es un pago pendiente en pasarela externa (Addi, Bold).
    // Para Addi/Bold, las enviaremos cuando el estado pase a 'paid' o 'approved'.
    if (!status.startsWith('pending_')) {
      sendOrderEmail(hydratedOrder).catch(err => console.error('Error sending email:', err));
      sendWhatsAppNotifications(hydratedOrder).catch(err => console.error('[WA] Error notificaciones:', err));
    }

    res.json(hydratedOrder);
  } catch (error) {
    res.status(500).json({ error: 'Error creating order' });
  }
});

app.put('/api/orders/:id', async (req, res) => {
  try {
    const { status, items, customerInfo, total } = req.body;
    const $set: Record<string, unknown> = {};
    if (status !== undefined) $set.status = status;
    if (items !== undefined) $set.items = items;
    if (customerInfo !== undefined) $set.customerInfo = customerInfo;
    if (total !== undefined) $set.total = total;

    if (Object.keys($set).length === 0) {
      return res.status(400).json({ error: 'No hay campos para actualizar' });
    }

    await db.collection('orders').updateOne({ id: req.params.id }, { $set });
    res.json({ id: req.params.id, ...$set });
  } catch (error) {
    res.status(500).json({ error: 'Error updating order' });
  }
});

app.put('/api/orders', async (req, res) => {
  try {
    const id = req.body?.id;
    if (!id) return res.status(400).json({ error: 'id requerido' });
    const { id: _removed, ...updates } = req.body;
    const $set: Record<string, unknown> = {};
    if (updates.status !== undefined) $set.status = updates.status;
    if (updates.items !== undefined) $set.items = updates.items;
    if (updates.customerInfo !== undefined) $set.customerInfo = updates.customerInfo;
    if (updates.total !== undefined) $set.total = updates.total;

    if (Object.keys($set).length === 0) {
      return res.status(400).json({ error: 'No hay campos para actualizar' });
    }

    await db.collection('orders').updateOne({ id: String(id) }, { $set });
    res.json({ id: String(id), ...$set });
  } catch (error) {
    res.status(500).json({ error: 'Error updating order' });
  }
});

app.delete('/api/orders', async (req, res) => {
  try {
    const id = req.body?.id;
    if (!id) return res.status(400).json({ error: 'id requerido' });
    const result = await db.collection('orders').deleteOne({ id: String(id) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json({ message: 'Order deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting order' });
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

// ====================================================================
// WHATSAPP ENDPOINTS
// ====================================================================

app.get('/api/whatsapp/status', (_req, res) => {
  const status = whatsappService.getStatus();
  const result: Record<string, any> = { status };
  if (status === 'qr_ready') result.qr = whatsappService.getQRDataUrl();
  res.json(result);
});

app.post('/api/whatsapp/connect', async (_req, res) => {
  if (!db) return res.status(503).json({ error: 'Base de datos no disponible' });
  try {
    await whatsappService.init(db, io);
    // Devolver el estado actual; si hay QR disponible, incluirlo
    const status = whatsappService.getStatus();
    const result: Record<string, any> = { success: true, status };
    if (status === 'qr_ready') result.qr = whatsappService.getQRDataUrl();
    res.json(result);
  } catch (err) {
    console.error('[WA] Error al conectar:', err);
    res.status(500).json({ error: 'Error al inicializar WhatsApp' });
  }
});

app.post('/api/whatsapp/disconnect', async (_req, res) => {
  try {
    await whatsappService.disconnect();
    res.json({ success: true });
  } catch (err) {
    console.error('[WA] Error al desconectar:', err);
    res.status(500).json({ error: 'Error al desconectar WhatsApp' });
  }
});

app.get('/api/whatsapp/templates', async (_req, res) => {
  try {
    const config = await db.collection('ticketConfig').findOne({ type: 'config' }) || {};
    res.json({
      customerTemplate: config.whatsappCustomerTemplate || DEFAULT_CUSTOMER_TEMPLATE,
      ownerTemplate: config.whatsappOwnerTemplate || DEFAULT_OWNER_TEMPLATE,
      ownerPhone: config.ownerWhatsAppPhone || '',
    });
  } catch (err) {
    console.error('[WA] Error al obtener plantillas:', err);
    res.status(500).json({ error: 'Error al obtener configuración de WhatsApp' });
  }
});

app.put('/api/whatsapp/templates', async (req, res) => {
  try {
    const { customerTemplate, ownerTemplate, ownerPhone } = req.body;
    const $set: Record<string, any> = {};
    if (customerTemplate !== undefined) $set.whatsappCustomerTemplate = customerTemplate;
    if (ownerTemplate !== undefined) $set.whatsappOwnerTemplate = ownerTemplate;
    if (ownerPhone !== undefined) $set.ownerWhatsAppPhone = String(ownerPhone).trim();
    if (Object.keys($set).length === 0) return res.status(400).json({ error: 'Sin campos para actualizar' });
    await db.collection('ticketConfig').updateOne(
      { type: 'config' },
      { $set },
      { upsert: true }
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[WA] Error al guardar plantillas:', err);
    res.status(500).json({ error: 'Error al guardar configuración de WhatsApp' });
  }
});

// --- REVIEWS API ---

app.get('/api/products/:id/reviews', async (req, res) => {
  try {
    const reviews = await db.collection('reviews')
      .find({ productId: req.params.id, status: 'approved' })
      .sort({ date: -1 })
      .toArray();
    res.json(reviews);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching reviews' });
  }
});

app.post('/api/products/:id/reviews', async (req, res) => {
  try {
    const { author, rating, comment } = req.body;
    const review = {
      productId: req.params.id,
      author,
      rating: Number(rating),
      comment,
      status: 'pending',
      verifiedPurchase: false,
      date: new Date().toISOString(),
    };
    await db.collection('reviews').insertOne(review);
    res.json({ success: true, review });
  } catch (error) {
    res.status(500).json({ error: 'Error submitting review' });
  }
});

app.get('/api/admin/reviews', async (req, res) => {
  try {
    const reviews = await db.collection('reviews').find({}).sort({ date: -1 }).toArray();
    res.json(reviews);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching reviews' });
  }
});

app.patch('/api/admin/reviews/:id', async (req, res) => {
  try {
    const { status, verifiedPurchase } = req.body;
    const $set: any = {};
    if (status !== undefined) $set.status = status;
    if (verifiedPurchase !== undefined) $set.verifiedPurchase = verifiedPurchase;
    
    await db.collection('reviews').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set }
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error updating review' });
  }
});

app.post('/api/admin/reviews', async (req, res) => {
  try {
    const { productId, author, rating, comment, date, verifiedPurchase } = req.body;
    const review = {
      productId,
      author,
      rating: Number(rating),
      comment,
      status: 'approved',
      verifiedPurchase: Boolean(verifiedPurchase),
      date: date || new Date().toISOString(),
    };
    await db.collection('reviews').insertOne(review);
    res.json({ success: true, review });
  } catch (error) {
    res.status(500).json({ error: 'Error creating manual review' });
  }
});

app.delete('/api/admin/reviews/:id', async (req, res) => {
  try {
    await db.collection('reviews').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting review' });
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
