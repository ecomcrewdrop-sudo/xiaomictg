import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { MongoClient, ObjectId } from 'mongodb';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { Resend } from 'resend';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import dns from 'dns';

// Resolver a IPv4 primero para evitar errores "ENETUNREACH" con SMTP/Gmail
dns.setDefaultResultOrder('ipv4first');
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
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_PASS
  },
  tls: {
    rejectUnauthorized: false
  },
  // Forzar IPv4 (Railway no soporta IPv6 para SMTP)
  family: 4,
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 20000
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

// ── Helper: calcular fecha esperada de pago según método ──
function calcFechaEsperada(cuenta: string): string | null {
  const now = new Date();
  if (cuenta === 'datafono') {
    // Cae al siguiente día hábil (si es viernes→lunes, sábado→lunes, domingo→lunes)
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    return d.toISOString();
  }
  if (cuenta === 'addi') {
    // Addi demora 7 días
    const d = new Date(now);
    d.setDate(d.getDate() + 7);
    return d.toISOString();
  }
  return null; // efectivo y banco son inmediatos
}

// ── Helper: crear movimientos de caja automáticamente desde una venta ──
// metodoPago puede ser:
//   "efectivo"                       → un solo movimiento (inmediato)
//   "datafono"                       → pendiente, cae al otro día hábil
//   "addi"                           → pendiente, cae en 7 días
//   "efectivo:300000+banco:200000"   → split payment
/** Helper to convert a product name into an accent-insensitive and singular/plural optional regex pattern. */
function makeMatchFriendlyPattern(str: string): string {
  let pattern = str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  // Reemplazar vocales para insensibilidad a acentos
  pattern = pattern
    .replace(/[aá]/gi, '[aá]')
    .replace(/[eé]/gi, '[eé]')
    .replace(/[ií]/gi, '[ií]')
    .replace(/[oó]/gi, '[oó]')
    .replace(/[uúü]/gi, '[uúü]');

  // Manejo de singular/plural para palabras de longitud razonable (ej. > 3 letras)
  if (str.length > 3) {
    if (str.toLowerCase().endsWith('s')) {
      // Remover la última 's' y hacerla opcional
      pattern = pattern.slice(0, -1) + '(s)?';
    } else {
      // Hacer que pueda tener una 's' opcional al final
      pattern = pattern + '(s)?';
    }
  }
  return pattern;
}

async function crearMovimientosCajaDesdeVenta(
  metodoPago: string,
  montoTotal: number,
  concepto: string,
) {
  if (!db) return;
  const entries: { cuenta: string; monto: number }[] = [];

  if (metodoPago.includes(':') && metodoPago.includes('+')) {
    // Split payment format: "efectivo:300000+banco:200000"
    for (const part of metodoPago.split('+')) {
      const [cuenta, val] = part.split(':');
      if (cuenta && val) entries.push({ cuenta: cuenta.trim(), monto: Number(val) });
    }
  } else {
    // Simple: toda la venta a una sola cuenta
    entries.push({ cuenta: metodoPago || 'efectivo', monto: montoTotal });
  }

  for (const e of entries) {
    if (e.monto <= 0) continue;
    // Verificar que la cuenta exista
    const cuentaDoc = await db.collection('caja_cuentas').findOne({ id: e.cuenta });
    if (!cuentaDoc) continue;

    const fechaEsperada = calcFechaEsperada(e.cuenta);
    const isPendiente = !!fechaEsperada; // datáfono y addi son pendientes

    await db.collection('caja_movimientos').insertOne({
      id: crypto.randomUUID(),
      tipo: 'ingreso',
      cuenta: e.cuenta,
      monto: e.monto,
      concepto,
      pendiente: isPendiente,
      fechaEsperada,
      createdAt: new Date().toISOString(),
    });
  }
}
let dbReconnectTimer: NodeJS.Timeout | null = null;
let dbConnecting = false;

function scheduleDbReconnect(delayMs = 15000) {
  if (dbReconnectTimer) return;
  dbReconnectTimer = setTimeout(() => {
    dbReconnectTimer = null;
    void connectDB();
  }, delayMs);
}

// --- Reparar cuotas corruptas al iniciar (cuotas que no respetan cuotasPrevias) ---
async function fixCorruptedCuotas() {
  try {
    const records = await db.collection('financing').find({}).toArray();
    let fixCount = 0;

    for (const r of records) {
      const previas = r.cuotasPrevias || 0;
      const expectedCount = r.numeroCuotas - previas;
      const expectedFirstNum = previas + 1;
      const actualCount = (r.cuotas || []).length;
      const actualFirstNum = r.cuotas?.[0]?.number ?? 0;

      if (actualCount !== expectedCount || actualFirstNum !== expectedFirstNum) {
        const oldCuotas = r.cuotas || [];

        // Guardar pagos por posición relativa (1ra cuota del sistema, 2da, etc.)
        const paidByPosition: Record<number, string> = {};
        oldCuotas.forEach((c: any, idx: number) => {
          if (c.status === 'paid') {
            paidByPosition[idx] = c.paidDate || new Date().toISOString();
          }
        });

        // Generar cuotas correctas con cuotasPrevias
        const newCuotas = generateInstallments(r.fechaInicio, r.numeroCuotas, previas);

        // Transferir pagos por posición
        for (const [posStr, paidDate] of Object.entries(paidByPosition)) {
          const pos = Number(posStr);
          if (pos < newCuotas.length) {
            newCuotas[pos].status = 'paid';
            newCuotas[pos].paidDate = paidDate;
          }
        }

        await db.collection('financing').updateOne({ id: r.id }, { $set: { cuotas: newCuotas } });
        const paidCount = newCuotas.filter((c: any) => c.status === 'paid').length;
        console.log(`[fix-cuotas] ${r.nombre}: ${actualCount} → ${newCuotas.length} cuotas (#${expectedFirstNum}-${r.numeroCuotas}), ${paidCount} paid preserved`);
        fixCount++;
      }
    }

    if (fixCount > 0) console.log(`[fix-cuotas] Repaired ${fixCount} records`);
    else console.log('[fix-cuotas] All records OK');

    // Fix 2: asegurar que cuotas pendientes empiecen desde fechaInicio + cuotas pagadas con fecha correcta
    let dateFixes = 0;
    for (const r of records) {
      const cuotas = r.cuotas || [];
      let changed = false;

      // Corregir cuotas pagadas con fecha futura
      for (const c of cuotas) {
        if (c.status === 'paid' && c.paidDate) {
          const dueDay = new Date(c.dueDate).toISOString().slice(0, 10);
          const paidDay = new Date(c.paidDate).toISOString().slice(0, 10);
          if (dueDay > paidDay) {
            c.dueDate = c.paidDate;
            changed = true;
          }
        }
      }

      // Verificar que pendientes empiecen desde fechaInicio
      if (r.fechaInicio) {
        const pendientes = cuotas.filter((c: any) => c.status !== 'paid');
        if (pendientes.length > 0) {
          const expectedFirst = new Date(r.fechaInicio).toISOString().slice(0, 10);
          const actualFirst = new Date(pendientes[0].dueDate).toISOString().slice(0, 10);
          if (actualFirst !== expectedFirst) {
            const start = new Date(r.fechaInicio);
            pendientes.forEach((c: any, i: number) => {
              const d = new Date(start);
              d.setUTCDate(d.getUTCDate() + i * 15);
              c.dueDate = d.toISOString();
            });
            console.log(`[fix-cuotas] ${r.nombre}: pending cuotas realigned ${actualFirst} → ${expectedFirst}`);
            changed = true;
          }
        }
      }

      if (changed) {
        await db.collection('financing').updateOne({ id: r.id }, { $set: { cuotas } });
        dateFixes++;
      }
    }
    if (dateFixes > 0) console.log(`[fix-cuotas] Fixed ${dateFixes} records`);
  } catch (err) {
    console.error('[fix-cuotas] Error:', err);
  }
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
    await fixCorruptedCuotas();
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

  async sendMessage(phone: string, text: string, imageUrl?: string): Promise<boolean> {
    if (!this.sock || this.status !== 'connected') return false;
    try {
      const jid = this._formatPhone(phone);
      if (imageUrl) {
        await this.sock.sendMessage(jid, {
          image: { url: imageUrl },
          caption: text
        });
      } else {
        await this.sock.sendMessage(jid, { text });
      }
      console.log('[WA] Mensaje enviado a', phone, imageUrl ? 'con imagen' : '');
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

const DEFAULT_IN_STORE_CUSTOMER_TEMPLATE =
`🎉 *¡Gracias por tu compra!* — Xiaomi Cartagena

Hola *{{nombre}}*, gracias por visitarnos en nuestra tienda física. 🧡

🛍️ *Tu compra:*
• {{producto}}

💰 *Total:* ${{total}} COP
💳 *Método de pago:* {{metodoPago}}
📄 *Facturado a:* {{cedula}}

🎁 *Billetera de Puntos VIP:*
• Acumulaste: +{{puntosGanados}} puntos ($` + '{{puntosGanados}}' + ` COP)
• Saldo actual disponible: {{puntosBalance}} puntos ($` + '{{puntosBalance}}' + ` COP)
(¡Úsalos como dinero real en tu próxima compra!) 🧡

Agréganos a tus contactos para que estés al tanto de todas nuestras promociones y ofertas exclusivas. 📲

_Xiaomi Cartagena — Cl. 31 #61-64, Los Ángeles_`;

const DEFAULT_OWNER_TEMPLATE = `Hola {{nombre}},

Hemos recibido tu orden *{{ordenNumero}}*.
Aquí tienes el resumen:

*🛍️ PRODUCTOS:*
{{productos}}

*📍 DATOS DE ENVÍO:*
*Nombre:* {{nombre}}
*Cédula:* {{cedula}}
*Teléfono:* {{telefono}}
{{linea_direccion}}
*🚚 Entrega:* {{metodoEntrega}}
*💳 Pago:* {{metodoPago}}

💰 *TOTAL A PAGAR: $\{{total}} COP* 💰

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
  const addiSurcharge = isAddi ? Math.round((order.total || 0) * 0.20) : 0;
  const isCard = (order.paymentMethod || '').toLowerCase().includes('tarjeta') || (order.paymentMethod || '').toLowerCase().includes('bold');
  const cardFee = isCard ? Math.round((order.total || 0) * 0.05) : 0;
  const grandTotal = (order.total || 0) + cardFee + addiSurcharge + deliveryFee;

  let extrasStr = '';
  if (deliveryFee > 0) extrasStr += `\n  • Domicilio — $${deliveryFee.toLocaleString('es-CO')} COP`;
  if (cardFee > 0) extrasStr += `\n  • Recargo Tarjeta (5%) — $${cardFee.toLocaleString('es-CO')} COP`;

  const productsList = items
    .map((item: any) => {
      const baseTotal = (item.product?.price || 0) * (item.quantity || 1);
      const itemAddi = isAddi ? Math.round(baseTotal * 0.20) : 0;
      const priceLabel = isAddi ? 'Financiado por Addi' : 'Precio';
      return `• ${item.product?.name || 'Producto'} x${item.quantity || 1}\n  ${priceLabel}: $${(baseTotal + itemAddi).toLocaleString('es-CO')} COP`;
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

async function scheduleRetiroEnTiendaWhatsApp(order: any) {
  const phone = order.customerInfo?.phone ? String(order.customerInfo.phone).trim() : '';
  if (!phone) return;

  try {
    const name = order.customerInfo?.name || 'Cliente';
    const msg = `🎉 *¡Gracias por tu compra!* — Xiaomi Cartagena

Hola *${name}*, gracias por comprar en Xiaomi Cartagena. 🧡

Agréganos a tus contactos para que estés al tanto de todas nuestras promociones y ofertas exclusivas. 📲

_Xiaomi Cartagena — Cl. 31 #61-64, Los Ángeles_`;

    // Programar para dentro de 10 minutos
    const sendAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await db.collection('scheduled_notifications').insertOne({
      id: crypto.randomUUID(),
      phone,
      message: msg,
      sendAt,
      status: 'pending',
      createdAt: new Date().toISOString()
    });

    console.log(`[Scheduled-WA] Retiro en tienda programado para ${phone} a las ${sendAt}`);
  } catch (error) {
    console.error('[Scheduled-WA] Error al programar retiro en tienda WhatsApp:', error);
  }
}

async function sendWhatsAppNotifications(order: any) {
  if (whatsappService.getStatus() !== 'connected') {
    console.log('[WA] Notificaciones omitidas — no conectado');
    return;
  }
  
  if (order.customerInfo?.deliveryMethod !== 'delivery') {
    console.log('[WA] Notificaciones omitidas para envío inmediato — pedido es para retiro en tienda. Programando agradecimiento 10m...');
    await scheduleRetiroEnTiendaWhatsApp(order).catch(e => console.error(e));
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

async function scheduleInStoreWhatsApp(venta: any, pointsEarned: number = 0, newPointsBalance: number = 0) {
  const phone = venta.telefono ? String(venta.telefono).trim() : '';
  if (!phone) return;

  try {
    const config = await db.collection('ticketConfig').findOne({ type: 'config' }) || {};
    const template = config.whatsappInStoreTemplate || DEFAULT_IN_STORE_CUSTOMER_TEMPLATE;

    const imeiStr = venta.imei ? `(IMEI: ${venta.imei})` : '';
    const giftStr = venta.obsequioNombre ? `\n• Obsequio: ${venta.obsequioNombre}` : '';

    const vars: Record<string, string> = {
      '{{nombre}}': venta.cliente || 'Cliente',
      '{{producto}}': `${venta.producto} ${imeiStr}${giftStr}`,
      '{{total}}': venta.precioVenta.toLocaleString('es-CO'),
      '{{metodoPago}}': String(venta.metodoPago).toUpperCase(),
      '{{cedula}}': venta.cedula || 'Consumidor Final',
      '{{puntosGanados}}': pointsEarned.toLocaleString('es-CO'),
      '{{puntosBalance}}': newPointsBalance.toLocaleString('es-CO'),
    };

    let msg = template;
    for (const [key, val] of Object.entries(vars)) {
      msg = msg.split(key).join(val);
    }

    // Programar para dentro de 10 minutos (10 * 60 * 1000 ms)
    const sendAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    
    await db.collection('scheduled_notifications').insertOne({
      id: crypto.randomUUID(),
      phone,
      message: msg,
      sendAt,
      status: 'pending',
      createdAt: new Date().toISOString()
    });

    console.log(`[Scheduled-WA] Mensaje programado para ${phone} a las ${sendAt}`);
  } catch (error) {
    console.error('[Scheduled-WA] Error al programar mensaje de tienda física:', error);
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
    const isAddi = (order.paymentMethod || '').toLowerCase().includes('addi');
    const cardFee = isCard ? Math.round(order.total * 0.05) : 0;
    // Para Addi: el recargo del 20% se integra en los precios (no se muestra como línea aparte)
    const addiMultiplier = isAddi ? 1.20 : 1;
    const adjustedSubtotal = isAddi ? Math.round(order.total * addiMultiplier) : order.total;
    const grandTotal = adjustedSubtotal + cardFee + deliveryFee;

    const itemsHtml = order.items.map((item: any) => {
      const imageUrl = item.product?.image || '';
      const imageHtml = imageUrl ? `<img src="${imageUrl}" alt="${item.product.name}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 4px; margin-right: 10px;" />` : '';
      const basePrice = (item.product?.price || 0) * (item.quantity || 1);
      const displayPrice = isAddi ? Math.round(basePrice * addiMultiplier) : basePrice;
      return `
        <li style="display: flex; align-items: center; margin-bottom: 15px; padding: 10px; background: #f9f9f9; border-radius: 8px;">
          ${imageHtml}
          <div>
            <strong>${item.product?.name || 'Producto'}</strong><br/>
            <span style="color: #666;">Cantidad: ${item.quantity}</span><br/>
            <span style="color: #e65100; font-weight: bold;">$${displayPrice.toLocaleString('es-CO')} COP</span>
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
              <p style="margin: 5px 0; font-size: 14px; color: #666;">Subtotal: $${adjustedSubtotal.toLocaleString('es-CO')} COP</p>
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
    const isAddi = (order.paymentMethod || '').toLowerCase().includes('addi');
    const cardFee = isCard ? Math.round(order.total * 0.05) : 0;
    // Para Addi: el recargo del 20% se integra en los precios (no se muestra como línea aparte)
    const addiMultiplier = isAddi ? 1.20 : 1;
    const adjustedSubtotal = isAddi ? Math.round(order.total * addiMultiplier) : order.total;
    const grandTotal = adjustedSubtotal + cardFee + deliveryFee;
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
          ${order.items.map((item: any) => {
            const unitPrice = isAddi ? Math.round((item.product?.price || 0) * addiMultiplier) : (item.product?.price || 0);
            const lineTotal = unitPrice * (item.quantity || 1);
            return `
            <div style="margin-bottom: 10px; font-size: 11px;">
              <div style="font-weight: bold; text-transform: uppercase;">${item.product?.name || 'Producto'}</div>
              <div style="font-size: 10px; margin-bottom: 4px;">
                ${item.selectedStorage ? `[${item.selectedStorage}]` : ''} 
                ${item.selectedColor ? `- Color: ${item.selectedColor}` : ''}
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span>${item.quantity} x $${unitPrice.toLocaleString('es-CO')}</span>
                <strong>$${lineTotal.toLocaleString('es-CO')}</strong>
              </div>
              ${item.serialNumber ? `<div style="font-size: 10px; margin-top: 4px;">SN: ${item.serialNumber}</div>` : ''}
              ${item.invoiceNumber ? `<div style="font-size: 10px; margin-top: 2px;">Factura: ${item.invoiceNumber}</div>` : ''}
            </div>
          `}).join('')}
        </div>
        
        <div style="border-top: 1px dashed #000; margin: 10px 0;"></div>

        <div style="font-size: 11px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span>Subtotal:</span>
            <span>$${adjustedSubtotal.toLocaleString('es-CO')}</span>
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
app.use(express.json({
  limit: '50mb',
  verify: (req: any, _res, buf) => {
    req.rawBody = buf;
  }
}));
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

  // Detectar si el stock cambia de 0 a > 0 para enviar alertas
  const oldProduct = await db.collection('products').findOne(productQuery(id));
  const oldStock = oldProduct ? Number(oldProduct.stock || 0) : 0;
  const newStock = body.stock !== undefined ? Number(body.stock) : oldStock;

  const result = await db.collection('products').updateOne(productQuery(id), { $set });
  if (result.matchedCount === 0) {
    return res.status(404).json({ error: 'Producto no encontrado' });
  }

  const updated = await db.collection('products').findOne(productQuery(id));

  // Si el stock pasó de 0 a > 0, notificar a los interesados por WhatsApp
  if (oldStock <= 0 && newStock > 0 && updated) {
    notifyStockAlerts(String(updated.id || updated._id), updated.name).catch(err =>
      console.error('[stock-alerts] Error notificando:', err)
    );
  }

  return res.json(updated);
}

/** Envía WhatsApp a todas las personas que pidieron ser notificadas de un producto */
async function notifyStockAlerts(productId: string, productName: string) {
  if (!db || whatsappService.getStatus() !== 'connected') return;

  const alerts = await db.collection('stock_alerts').find({
    productId,
    notified: false,
  }).toArray();

  if (alerts.length === 0) return;
  console.log(`[stock-alerts] Notificando a ${alerts.length} personas sobre ${productName}`);

  for (const alert of alerts) {
    const msg = `🔔 *¡Ya está disponible!*\n\nHola, el producto *${productName}* que te interesaba ya tiene unidades disponibles en nuestra tienda.\n\n🛒 Visita nuestra tienda para comprarlo antes de que se agote.\n\n🌐 xiaomicartagena.com\n📞 302 287 5280\n\n_Xiaomi Cartagena — Cl. 31 #61-64, Los Ángeles_`;

    const success = await whatsappService.sendMessage(alert.phone, msg);
    if (success) {
      await db.collection('stock_alerts').updateOne(
        { _id: alert._id },
        { $set: { notified: true, notifiedAt: new Date().toISOString() } }
      );
    }

    // Delay entre mensajes para no ser bloqueado
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
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

// ====================================================================
// STOCK ALERTS — "Notificarme cuando haya stock"
// ====================================================================

app.post('/api/stock-alerts', async (req, res) => {
  try {
    const { productId, productName, phone } = req.body;
    if (!productId || !phone) {
      return res.status(400).json({ error: 'productId y phone son requeridos' });
    }

    // Evitar duplicados (mismo teléfono + mismo producto)
    const existing = await db.collection('stock_alerts').findOne({ productId, phone, notified: false });
    if (existing) {
      return res.json({ success: true, message: 'Ya estás registrado para este producto' });
    }

    await db.collection('stock_alerts').insertOne({
      productId: String(productId),
      productName: String(productName || ''),
      phone: String(phone).trim(),
      notified: false,
      createdAt: new Date().toISOString(),
    });

    res.json({ success: true, message: 'Te notificaremos por WhatsApp cuando haya stock' });
  } catch (error) {
    console.error('[stock-alerts] Error:', error);
    res.status(500).json({ error: 'Error al registrar alerta' });
  }
});

app.get('/api/stock-alerts/:productId/count', async (req, res) => {
  try {
    const count = await db.collection('stock_alerts').countDocuments({
      productId: req.params.productId,
      notified: false,
    });
    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: 'Error' });
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

        // Marcar ventas asociadas como recibidas y registrar en caja
        const ventasOrden = await db.collection('daily_sales').find({ orderId: order.id }).toArray();
        for (const v of ventasOrden) {
          if (v.estadoPago !== 'recibido') {
            await db.collection('daily_sales').updateOne({ id: v.id }, { $set: { estadoPago: 'recibido' } });
            await crearMovimientosCajaDesdeVenta(
              v.metodoPago || 'efectivo',
              v.precioVenta,
              `Venta Addi: ${v.producto} — ${v.cliente}`,
            );
          }
        }

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

// ====================================================================
// ██████  BOLD — Pasarela de pago con tarjeta  ██████
// ====================================================================
app.get('/api/bold-checkout', async (req, res) => {
  const BOLD_API_KEY = process.env.BOLD_API_KEY;
  const BOLD_SECRET_KEY = process.env.BOLD_SECRET_KEY;

  if (!BOLD_API_KEY || !BOLD_SECRET_KEY) {
    return res.status(500).send('<h1>Error de configuración: claves de pago no disponibles</h1>');
  }

  const { orderId, amount, currency = 'COP', redirectionUrl, description } = req.query as Record<string, string>;
  if (!orderId || !amount) {
    return res.status(400).send('<h1>Parámetros faltantes</h1>');
  }

  const amountInt = Math.round(Number(amount));

  // Compute BOLD integrity hash
  const integrityMsg = `${orderId}${amountInt}${currency}${BOLD_SECRET_KEY}`;
  const integrity = createHash('sha256').update(integrityMsg).digest('hex');

  const safeRedirect = redirectionUrl || `${req.protocol}://${req.get('host')}/?bold_status=success`;
  const desc = description || `Pedido Xiaomi Cartagena ${orderId}`;

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Pago seguro — Xiaomi Cartagena</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{min-height:100vh;background:#0f0f0f;display:flex;align-items:center;justify-content:center;
         font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#fff}
    .wrap{text-align:center;padding:2rem;max-width:420px;width:100%}
    .brand{font-size:1.3rem;font-weight:800;letter-spacing:-.04em;color:#ff6900;margin-bottom:2rem}
    .brand span{color:#fff}
    .title{font-size:1.3rem;font-weight:600;margin-bottom:.4rem}
    .sub{font-size:.9rem;color:rgba(255,255,255,.6);margin-bottom:2rem}
    .info{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);
          border-radius:12px;padding:1.5rem;margin-bottom:2rem}
    .info .label{font-size:.75rem;color:rgba(255,255,255,.5);text-transform:uppercase;
                  letter-spacing:.08em;margin-bottom:.5rem}
    .info .val{font-size:1.6rem;font-weight:700;color:#ff6900}
    .info .oid{font-size:.85rem;color:rgba(255,255,255,.4);margin-top:.5rem}
    #bold-btn-wrap{margin-top:1rem;display:flex;justify-content:center;min-height:50px}
    .back{display:inline-block;margin-top:2rem;padding:.6rem 1.2rem;background:transparent;
          border:1px solid rgba(255,255,255,.15);border-radius:8px;color:rgba(255,255,255,.6);
          text-decoration:none;font-size:.85rem;cursor:pointer;transition:all .2s}
    .back:hover{border-color:rgba(255,255,255,.4);color:#fff}
    .secure{margin-top:2rem;font-size:.75rem;color:rgba(255,255,255,.3);letter-spacing:.04em}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="brand">XIAOMI <span>Cartagena</span></div>
    <p class="title">Resumen de tu pedido</p>
    <p class="sub">Haz clic en el bot&oacute;n de abajo para pagar de forma segura</p>
    <div class="info">
      <div class="label">Total a pagar</div>
      <div class="val">$${amountInt.toLocaleString('es-CO')} COP</div>
      <div class="oid">Pedido ${orderId}</div>
    </div>
    <div id="bold-btn-wrap">
      <script
        src="https://checkout.bold.co/library/boldPaymentButton.js"
        data-bold-button="dark-L"
        data-order-id="${orderId}"
        data-amount="${amountInt}"
        data-currency="${currency}"
        data-api-key="${BOLD_API_KEY}"
        data-integrity-signature="${integrity}"
        data-redirection-url="${safeRedirect}"
        data-description="${desc}"
      ></script>
    </div>
    <a href="/" class="back">&larr; Volver a la tienda</a>
    <p class="secure">&#128274; Pago procesado por BOLD — 100% seguro</p>
  </div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(html);
});

/** Helper to transition a pending order to paid/processing/completed, and trigger notifications/accounting. */
async function transitionOrderAndNotify(order: any, newStatus: string, metodoPago: string) {
  if (!db) return;

  console.log(`[transition-order] Iniciando transición de orden ${order.orderNumber} (${order.status} -> ${newStatus})`);

  // 1. Actualizar el estado del pedido en la base de datos
  await db.collection('orders').updateOne(
    { id: order.id },
    { $set: { status: newStatus } }
  );
  console.log(`[transition-order] Estado de orden ${order.orderNumber} actualizado a ${newStatus}`);

  // 2. Marcar ventas asociadas en daily_sales como recibidas y registrar movimientos de caja
  const ventasOrden = await db.collection('daily_sales').find({ orderId: order.id }).toArray();
  for (const v of ventasOrden) {
    if (v.estadoPago !== 'recibido') {
      await db.collection('daily_sales').updateOne({ id: v.id }, { $set: { estadoPago: 'recibido' } });
      await crearMovimientosCajaDesdeVenta(
        v.metodoPago || metodoPago || 'efectivo',
        v.precioVenta,
        `Venta ${metodoPago}: ${v.producto} — ${v.cliente}`,
      );
      console.log(`[transition-order] Venta diaria ${v.id} marcada como recibida y registrada en caja.`);
    }
  }

  // 3. Notificar por WhatsApp y Correo
  try {
    const [hydratedOrder] = await hydrateOrdersWithProductImages([{ ...order, status: newStatus } as OrderDoc]);
    sendOrderEmail(hydratedOrder).catch(err => console.error('[transition-order] Error enviando correo:', err));
    sendWhatsAppNotifications(hydratedOrder).catch(err => console.error('[transition-order] [WA] Error notificaciones:', err));
  } catch (error) {
    console.error('[transition-order] Error al hidratar/notificar pedido:', error);
  }

  // 4. Emitir eventos socket para actualizar en tiempo real el panel admin
  io.emit('orderUpdated', { id: order.id, status: newStatus });
}

// Webhook para recibir notificaciones de Bold
app.post('/api/bold/webhook', async (req, res) => {
  try {
    const payload = req.body;
    console.log('[bold-webhook] Payload recibido:', JSON.stringify(payload));

    // Aceptar la recepción de inmediato como exige Bold
    res.status(200).send('OK');

    const signature = req.headers['x-bold-signature'];
    const secret = process.env.BOLD_SECRET_KEY;

    // Validación de firma HMAC si está configurada y se recibe
    if (signature && secret && req.rawBody) {
      const computedSignature = createHmac('sha256', secret)
        .update(req.rawBody)
        .digest('hex');
      
      let isSignatureValid = false;
      try {
        const bufferSignature = Buffer.from(signature as string, 'utf8');
        const bufferComputed = Buffer.from(computedSignature, 'utf8');
        if (bufferSignature.length === bufferComputed.length) {
          isSignatureValid = timingSafeEqual(bufferSignature, bufferComputed);
        }
      } catch (err) {
        console.error('[bold-webhook] Error verificando firma:', err);
      }

      if (!isSignatureValid) {
        console.error(`[bold-webhook] Firma de seguridad inválida. Recibida: ${signature}, Calculada: ${computedSignature}`);
        // No procesamos la orden si la firma es inválida
        return;
      }
      console.log('[bold-webhook] Firma de seguridad validada con éxito.');
    }

    const { type, data } = payload;
    if (type !== 'SALE_APPROVED') {
      console.log(`[bold-webhook] Tipo de evento no manejado o no es SALE_APPROVED: ${type}`);
      
      // Si la venta es rechazada, podemos actualizar a cancelada para informar al admin
      if (type === 'SALE_REJECTED') {
        const orderNumber = data?.metadata?.reference || data?.reference || payload.subject;
        if (orderNumber) {
          const order = await db.collection('orders').findOne({ orderNumber });
          if (order && order.status === 'pending_bold') {
            await db.collection('orders').updateOne({ orderNumber }, { $set: { status: 'cancelled' } });
            io.emit('orderUpdated', { id: order.id, status: 'cancelled' });
            console.log(`[bold-webhook] Orden ${orderNumber} marcada como cancelada por pago rechazado.`);
          }
        }
      }
      return;
    }

    // Extraer order number de forma robusta
    const orderNumber = 
      data?.metadata?.reference ||
      data?.reference ||
      payload.subject ||
      payload.reference ||
      payload.orderId ||
      payload.order_id;

    if (!orderNumber) {
      console.error('[bold-webhook] No se encontró ninguna referencia de pedido en el payload.');
      return;
    }

    console.log(`[bold-webhook] Procesando pago aprobado para orden: ${orderNumber}`);

    const order = await db.collection('orders').findOne({ orderNumber });
    if (!order) {
      console.error(`[bold-webhook] Pedido no encontrado en base de datos: ${orderNumber}`);
      return;
    }

    // Solo procesar si el estado es pendiente de pago Bold
    if (order.status === 'pending_bold') {
      await transitionOrderAndNotify(order, 'paid', 'BOLD (Tarjeta)');
      
      // Emitir notificación visual extra al dashboard
      io.emit('newOrder', {
        orderId: order.id,
        orderNumber: order.orderNumber,
        total: order.total,
        message: `Pago en línea Bold Aprobado: ${order.orderNumber}`,
        createdAt: new Date().toISOString(),
        read: false
      });
    } else {
      console.log(`[bold-webhook] El pedido ${orderNumber} ya se encuentra en estado: ${order.status}`);
    }
  } catch (error) {
    console.error('[bold-webhook] Error crítico procesando webhook:', error);
  }
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

    // Descontar stock del catálogo de productos
    for (const item of items) {
      const productId = item.product?.id || item.productId;
      const qty = Number(item.quantity || 1);
      if (!productId) continue;

      // Decrementar stock general
      await db.collection('products').updateOne(
        { id: productId, stock: { $gte: qty } },
        { $inc: { stock: -qty } }
      );

      // Decrementar stock de variante de almacenamiento si aplica
      if (item.selectedStorage) {
        await db.collection('products').updateOne(
          { id: productId, 'storageVariants.storage': item.selectedStorage },
          { $inc: { 'storageVariants.$.stock': -qty } }
        );
      }

      // Decrementar stock de variante de color si aplica
      if (item.selectedColor) {
        await db.collection('products').updateOne(
          { id: productId, 'colorVariants.color': item.selectedColor },
          { $inc: { 'colorVariants.$.stock': -qty } }
        );
      }
    }

    // Auto-agregar cada item a ventas del día con matching inteligente de inventario
    const hoy = new Date().toISOString().slice(0, 10);
    for (const item of items) {
      // El cart envía { product: { name, price, ... }, quantity, selectedStorage }
      console.log('[auto-venta] item keys:', Object.keys(item), 'product keys:', item.product ? Object.keys(item.product) : 'NO PRODUCT', 'name:', item.product?.name || item.name || 'NONE');
      const precioVenta = Number(item.product?.price || item.price || item.total || 0);
      const storage = item.selectedStorage ? ` ${item.selectedStorage}` : '';
      const nombreProducto = (item.product?.name || item.name || item.productName || 'Producto') + storage;
      const qty = Number(item.quantity || 1);

      // Buscar item disponible en inventario que coincida con el producto
      // Primero por productoId (match exacto), luego por nombre
      const productId = item.product?.id || item.productId;
      const stopWords = ['reloj', 'celular', 'telefono', 'tablet', 'obsequio', 'regalo', 'play', 'con', 'pro', 'plus', 'max'];
      let invItem = productId ? await db.collection('inventory').findOne({
        estado: 'disponible',
        cantidad: { $gte: 1 },
        productoId: productId,
      }) : null;
      if (!invItem) {
        const escapedName = nombreProducto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        invItem = await db.collection('inventory').findOne({
          estado: 'disponible',
          cantidad: { $gte: 1 },
          producto: { $regex: escapedName, $options: 'i' },
        });
      }
      if (!invItem) {
        // Match por palabras clave significativas (>2 chars, no stop words)
        const keywords = nombreProducto.split(/[\s+()]/g)
          .filter((w: string) => w.length > 2 && !stopWords.includes(w.toLowerCase()))
          .map((w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        if (keywords.length > 0) {
          // Intentar con todas las keywords primero
          let regexPattern = keywords.map((w: string) => `(?=.*${w})`).join('');
          invItem = await db.collection('inventory').findOne({
            estado: 'disponible',
            cantidad: { $gte: 1 },
            producto: { $regex: regexPattern, $options: 'i' },
          });
          // Si no, intentar con las 2-3 keywords más importantes (marca + modelo)
          if (!invItem && keywords.length > 2) {
            const coreKeys = keywords.slice(0, 3);
            regexPattern = coreKeys.map((w: string) => `(?=.*${w})`).join('');
            invItem = await db.collection('inventory').findOne({
              estado: 'disponible',
              cantidad: { $gte: 1 },
              producto: { $regex: regexPattern, $options: 'i' },
            });
          }
        }
      }

      const venta_auto: Record<string, unknown> = {
        id: crypto.randomUUID(),
        fecha: hoy,
        orderId: id,
        inventarioId: invItem?.id || null,
        cliente: customerInfo?.name || 'Cliente web',
        producto: nombreProducto,
        imei: invItem?.imei || '',
        esPropio: invItem ? Boolean(invItem.esPropio) : true,
        proveedor: invItem?.proveedor || '',
        precioCompra: invItem?.precioCompra || 0,
        precioVenta: precioVenta * qty,
        ganancia: (precioVenta - (invItem?.precioCompra || 0)) * qty,
        metodoPago: paymentMethod || 'efectivo',
        estadoPago: status === 'paid' ? 'recibido' : 'pendiente',
        fechaEsperada: null,
        notas: invItem ? `Auto - Orden ${orderNumber} (inv: ${invItem.producto})` : `Auto - Orden ${orderNumber}`,
        creadoPor: 'web',
        createdAt: new Date().toISOString(),
      };
      await db.collection('daily_sales').insertOne(venta_auto);

      // Auto-registrar en caja si el pago ya fue recibido
      if (venta_auto.estadoPago === 'recibido') {
        await crearMovimientosCajaDesdeVenta(
          venta_auto.metodoPago as string,
          precioVenta * qty,
          `Venta web: ${nombreProducto} — ${customerInfo?.name || 'Cliente web'}`,
        );
      }

       // Descontar cantidad del inventario
      if (invItem) {
        const newCantidad = (invItem.cantidad || 1) - qty;
        if (newCantidad <= 0) {
          await db.collection('inventory').updateOne(
            { id: invItem.id },
            { $set: { cantidad: 0, estado: 'vendido', ventaId: venta_auto.id, updatedAt: new Date().toISOString() } }
          );
        } else {
          await db.collection('inventory').updateOne(
            { id: invItem.id },
            { $set: { cantidad: newCantidad, updatedAt: new Date().toISOString() } }
          );
        }
      }

      // Autodetectar y descontar obsequio para órdenes web si aplica
      if (nombreProducto.includes('+')) {
        const partes = nombreProducto.split('+');
        if (partes.length > 1) {
          let parteObsequio = partes[1].split('-')[0];
          parteObsequio = parteObsequio.replace(/\((?:regalo|obsequio)\)/gi, '');
          parteObsequio = parteObsequio.trim();

          if (parteObsequio && parteObsequio.toLowerCase() !== 'obsequio') {
            const escapedGift = makeMatchFriendlyPattern(parteObsequio);
            let giftItem = await db.collection('inventory').findOne({
              estado: 'disponible',
              cantidad: { $gte: 1 },
              producto: { $regex: escapedGift, $options: 'i' },
            });

            if (!giftItem) {
              const giftKw = parteObsequio.split(/[\s+(),\-]+/g)
                .filter((w: string) => w.length > 2)
                .map((w: string) => makeMatchFriendlyPattern(w));
              if (giftKw.length > 0) {
                const giftRegex = giftKw.map((w: string) => `(?=.*${w})`).join('');
                giftItem = await db.collection('inventory').findOne({
                  estado: 'disponible',
                  cantidad: { $gte: 1 },
                  producto: { $regex: giftRegex, $options: 'i' },
                });
              }
            }

            if (giftItem) {
              const newQty = (giftItem.cantidad || 1) - qty;
              if (newQty <= 0) {
                await db.collection('inventory').updateOne(
                  { id: giftItem.id },
                  { $set: { cantidad: 0, estado: 'vendido', ventaId: venta_auto.id, updatedAt: new Date().toISOString() } }
                );
              } else {
                await db.collection('inventory').updateOne(
                  { id: giftItem.id },
                  { $set: { cantidad: newQty, updatedAt: new Date().toISOString() } }
                );
              }
              // También actualizar la venta_auto grabada para reflejar el obsequio descontado
              await db.collection('daily_sales').updateOne(
                { id: venta_auto.id },
                {
                  $set: {
                    obsequioNombre: giftItem.producto,
                    obsequioCosto: Number(giftItem.precioCompra || 0),
                    obsequioInventarioId: giftItem.id
                  }
                }
              );
              console.log(`[auto-venta-obsequio] Descontado obsequio "${giftItem.producto}" para orden web ${orderNumber} (quedan ${newQty})`);
            }
          }
        }
      }
    }

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

    const orderId = req.params.id;
    const oldOrder = await db.collection('orders').findOne({ id: orderId });

    if (oldOrder && status && oldOrder.status !== status) {
      const isTransitioningFromPending = oldOrder.status?.startsWith('pending_');
      const isNewStatusActive = status === 'paid' || status === 'processing' || status === 'completed';
      
      if (isTransitioningFromPending && isNewStatusActive) {
        const metodoPago = oldOrder.paymentMethod || oldOrder.customerInfo?.paymentMethod || 'tarjeta';
        await transitionOrderAndNotify(oldOrder, status, metodoPago);
        
        const { status: _st, ...restUpdates } = $set;
        if (Object.keys(restUpdates).length > 0) {
          await db.collection('orders').updateOne({ id: orderId }, { $set: restUpdates });
        }
        
        return res.json({ id: orderId, ...$set });
      }
    }

    await db.collection('orders').updateOne({ id: orderId }, { $set });
    res.json({ id: orderId, ...$set });
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

    const orderId = String(id);
    const oldOrder = await db.collection('orders').findOne({ id: orderId });

    if (oldOrder && updates.status && oldOrder.status !== updates.status) {
      const isTransitioningFromPending = oldOrder.status?.startsWith('pending_');
      const isNewStatusActive = updates.status === 'paid' || updates.status === 'processing' || updates.status === 'completed';
      
      if (isTransitioningFromPending && isNewStatusActive) {
        const metodoPago = oldOrder.paymentMethod || oldOrder.customerInfo?.paymentMethod || 'tarjeta';
        await transitionOrderAndNotify(oldOrder, updates.status, metodoPago);
        
        const { status: _st, ...restUpdates } = $set;
        if (Object.keys(restUpdates).length > 0) {
          await db.collection('orders').updateOne({ id: orderId }, { $set: restUpdates });
        }
        
        return res.json({ id: orderId, ...$set });
      }
    }

    await db.collection('orders').updateOne({ id: orderId }, { $set });
    res.json({ id: orderId, ...$set });
  } catch (error) {
    res.status(500).json({ error: 'Error updating order' });
  }
});

app.delete('/api/orders', async (req, res) => {
  try {
    const id = req.body?.id;
    if (!id) return res.status(400).json({ error: 'id requerido' });

    // Restaurar stock antes de eliminar
    const order = await db.collection('orders').findOne({ id: String(id) });
    if (order?.items && Array.isArray(order.items)) {
      for (const item of order.items) {
        const productId = item.product?.id || item.productId;
        const qty = Number(item.quantity || 1);
        if (!productId) continue;
        await db.collection('products').updateOne({ id: productId }, { $inc: { stock: qty } });
        if (item.selectedStorage) {
          await db.collection('products').updateOne(
            { id: productId, 'storageVariants.storage': item.selectedStorage },
            { $inc: { 'storageVariants.$.stock': qty } }
          );
        }
        if (item.selectedColor) {
          await db.collection('products').updateOne(
            { id: productId, 'colorVariants.color': item.selectedColor },
            { $inc: { 'colorVariants.$.stock': qty } }
          );
        }
      }
    }

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
      inStoreTemplate: config.whatsappInStoreTemplate || DEFAULT_IN_STORE_CUSTOMER_TEMPLATE,
      ownerPhone: config.ownerWhatsAppPhone || '',
    });
  } catch (err) {
    console.error('[WA] Error al obtener plantillas:', err);
    res.status(500).json({ error: 'Error al obtener configuración de WhatsApp' });
  }
});

app.put('/api/whatsapp/templates', async (req, res) => {
  try {
    const { customerTemplate, ownerTemplate, inStoreTemplate, ownerPhone } = req.body;
    const $set: Record<string, any> = {};
    if (customerTemplate !== undefined) $set.whatsappCustomerTemplate = customerTemplate;
    if (ownerTemplate !== undefined) $set.whatsappOwnerTemplate = ownerTemplate;
    if (inStoreTemplate !== undefined) $set.whatsappInStoreTemplate = inStoreTemplate;
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

// --- WHATSAPP CAMPAIGNS API ---

app.get('/api/whatsapp/customers', async (_req, res) => {
  try {
    const customersMap = new Map<string, {
      name: string;
      phone: string;
      email: string;
      cedula: string;
      lastPurchaseDate: string;
      lastPurchaseProduct: string;
      purchaseCount: number;
    }>();

    // 1. Obtener clientes de ventas físicas (POS)
    const ventas = await db.collection('daily_sales').find().toArray();
    for (const v of ventas) {
      const phone = String(v.telefono || '').replace(/[\s\-\+\(\)\.]/g, '').trim();
      if (!phone || phone.length < 7) continue;

      const existing = customersMap.get(phone);
      if (!existing || new Date(v.fecha) > new Date(existing.lastPurchaseDate)) {
        customersMap.set(phone, {
          name: v.cliente || 'Cliente POS',
          phone,
          email: v.email || (existing?.email || ''),
          cedula: v.cedula || (existing?.cedula || ''),
          lastPurchaseDate: v.fecha || '',
          lastPurchaseProduct: v.producto || '',
          purchaseCount: (existing?.purchaseCount || 0) + 1
        });
      } else {
        existing.purchaseCount += 1;
      }
    }

    // 2. Obtener clientes de pedidos web (orders)
    const orders = await db.collection('orders').find().toArray();
    for (const o of orders) {
      const customerInfo = o.customerInfo || {};
      const phone = String(customerInfo.phone || '').replace(/[\s\-\+\(\)\.]/g, '').trim();
      if (!phone || phone.length < 7) continue;

      const purchaseDate = o.date || o.createdAt || '';
      const dateStr = purchaseDate.slice(0, 10);
      
      const itemsList = (o.items || []).map((item: any) => item.product?.name || 'Producto').join(', ');

      const existing = customersMap.get(phone);
      if (!existing || new Date(dateStr) > new Date(existing.lastPurchaseDate)) {
        customersMap.set(phone, {
          name: customerInfo.name || 'Cliente Web',
          phone,
          email: customerInfo.email || (existing?.email || ''),
          cedula: customerInfo.idNumber || (existing?.cedula || ''),
          lastPurchaseDate: dateStr,
          lastPurchaseProduct: itemsList || '',
          purchaseCount: (existing?.purchaseCount || 0) + 1
        });
      } else {
        existing.purchaseCount += 1;
      }
    }

    // Convertir mapa a array y ordenar por fecha de última compra (de más reciente a más antigua)
    const customersList = Array.from(customersMap.values()).sort((a, b) => {
      return new Date(b.lastPurchaseDate).getTime() - new Date(a.lastPurchaseDate).getTime();
    });

    res.json(customersList);
  } catch (err) {
    console.error('[WA] Error al obtener listado de clientes:', err);
    res.status(500).json({ error: 'Error al obtener clientes' });
  }
});

// --- LOYALTY POINTS API ---

app.get('/api/loyalty/points/:phone', async (req, res) => {
  try {
    const phone = String(req.params.phone).replace(/[\s\-\+\(\)\.]/g, '').trim();
    if (!phone) return res.status(400).json({ error: 'Teléfono inválido' });

    const clientDoc = await db.collection('loyalty_points').findOne({ phone });
    res.json({
      phone,
      name: clientDoc?.name || '',
      cedula: clientDoc?.cedula || '',
      points: clientDoc?.points || 0,
    });
  } catch (err) {
    console.error('[loyalty] Error al obtener puntos:', err);
    res.status(500).json({ error: 'Error al obtener puntos de fidelidad' });
  }
});

app.get('/api/whatsapp/campaigns', async (_req, res) => {
  try {
    const list = await db.collection('campaigns').find().sort({ createdAt: -1 }).toArray();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener campañas' });
  }
});

app.post('/api/whatsapp/campaigns', async (req, res) => {
  try {
    const { name, message, imageUrl, scheduledAt, delaySeconds, recipients } = req.body;
    if (!name || !message || !recipients || !Array.isArray(recipients)) {
      return res.status(400).json({ error: 'Campos requeridos faltantes' });
    }

    const campaignId = crypto.randomUUID();
    const now = new Date().toISOString();

    const formattedRecipients = recipients.map((r: any) => ({
      name: r.name || 'Cliente',
      phone: String(r.phone).trim(),
      status: 'pending',
      processedAt: null,
    }));

    const campaign = {
      id: campaignId,
      name,
      message,
      imageUrl: imageUrl || '',
      status: scheduledAt ? 'scheduled' : 'active',
      scheduledAt: scheduledAt || null,
      delaySeconds: Number(delaySeconds || 10),
      recipients: formattedRecipients,
      totalRecipients: formattedRecipients.length,
      sentCount: 0,
      failedCount: 0,
      createdAt: now,
    };

    await db.collection('campaigns').insertOne(campaign);
    res.status(201).json(campaign);
  } catch (err) {
    console.error('[Campaign-WA] Error al crear campaña:', err);
    res.status(500).json({ error: 'Error al crear campaña' });
  }
});

app.post('/api/whatsapp/campaigns/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'paused', 'cancelled', 'processing'].includes(status)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }
    
    const result = await db.collection('campaigns').updateOne(
      { id: req.params.id },
      { $set: { status, updatedAt: new Date().toISOString() } }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Campaña no encontrada' });
    }

    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ error: 'Error al cambiar estado' });
  }
});

app.delete('/api/whatsapp/campaigns/:id', async (req, res) => {
  try {
    await db.collection('campaigns').deleteOne({ id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar campaña' });
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

// ====================================================================
// FINANCING MODULE — Cuotas quincenales con recordatorios WhatsApp
// ====================================================================

interface FinancingInstallment {
  number: number;
  dueDate: string; // ISO
  paidDate?: string; // ISO — cuando se marcó como pagada
  status: 'pending' | 'paid' | 'overdue';
}

interface FinancingRecord {
  id: string;
  nombre: string;
  cedula: string;
  telefono: string;
  imei: string;
  producto: string;
  costoTotal: number;
  costoEquipo: number; // Costo real del teléfono (lo que se le paga a Xiaomi)
  cuotaInicial: number;
  numeroCuotas: number;
  valorCuota: number;
  fechaInicio: string; // ISO — fecha del primer pago
  horaBloqueo: string; // HH:mm — hora en que se bloquea si no paga
  cuotasPrevias: number; // Cuotas ya pagadas ANTES de registrar en el sistema
  cuotas: FinancingInstallment[];
  status: 'active' | 'completed' | 'defaulted';
  createdAt: string;
  lastReminderSent?: string; // ISO — para evitar enviar doble
}

/** Genera las cuotas quincenales a partir de una fecha de inicio */
function generateInstallments(startDate: string, count: number, cuotasPagadas = 0): FinancingInstallment[] {
  const installments: FinancingInstallment[] = [];
  const start = new Date(startDate);

  // Solo generar las cuotas RESTANTES (las ya pagadas no se muestran)
  // La fecha ingresada = próximo pago, todas van hacia adelante
  const remaining = count - cuotasPagadas;

  for (let i = 0; i < remaining; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i * 15); // Cada 15 días
    installments.push({
      number: cuotasPagadas + i + 1, // Numerar desde la cuota que sigue
      dueDate: d.toISOString(),
      status: 'pending',
    });
  }
  return installments;
}

/** Actualiza estados overdue en cuotas vencidas no pagadas.
 *  Solo marca overdue si ya pasó la horaBloqueo en hora Colombia (UTC-5). */
function refreshOverdueStatus(cuotas: FinancingInstallment[], horaBloqueo = '08:00'): FinancingInstallment[] {
  // Hora actual en Colombia
  const nowCO = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
  const todayStr = nowCO.toISOString().slice(0, 10);
  const [bH, bM] = horaBloqueo.split(':').map(Number);

  return cuotas.map(c => {
    if (c.status !== 'pending') return c;
    const dueDateStr = c.dueDate.slice(0, 10); // yyyy-mm-dd

    if (dueDateStr < todayStr) {
      // Día ya pasó → overdue
      return { ...c, status: 'overdue' as const };
    }
    if (dueDateStr === todayStr) {
      // Mismo día → solo overdue si ya pasó la hora de bloqueo
      if (nowCO.getHours() > bH || (nowCO.getHours() === bH && nowCO.getMinutes() >= bM)) {
        return { ...c, status: 'overdue' as const };
      }
    }
    return c;
  });
}

// --- CRUD Financiamientos ---

app.get('/api/financing', async (_req, res) => {
  try {
    const records = await db.collection('financing').find({}).sort({ createdAt: -1 }).toArray();
    // Actualizar overdue on-read (con hora de bloqueo de cada cliente)
    const updated = records.map((r: any) => ({
      ...r,
      cuotas: refreshOverdueStatus(r.cuotas || [], r.horaBloqueo || '08:00'),
    }));
    res.json(updated);
  } catch (error) {
    console.error('[financing] Error listing:', error);
    res.status(500).json({ error: 'Error al obtener financiamientos' });
  }
});

app.post('/api/financing', async (req, res) => {
  try {
    const { nombre, cedula, telefono, imei, producto, costoEquipo, costoTotal: rawCostoTotal, cuotaInicial, numeroCuotas, valorCuota: rawValorCuota, fechaInicio, horaBloqueo, cuotasPagadas } = req.body;

    if (!nombre || !cedula || !telefono || !imei || !numeroCuotas || !fechaInicio) {
      return res.status(400).json({ error: 'Todos los campos obligatorios son requeridos' });
    }

    // Modo inverso: el dueño pone valor de cuota y # cuotas → sistema calcula total
    const valorCuota = Number(rawValorCuota || 0);
    const numCuotas = Number(numeroCuotas);
    const inicial = Number(cuotaInicial || 0);
    const costoTotal = rawCostoTotal ? Number(rawCostoTotal) : (valorCuota * numCuotas) + inicial;

    // Generar cuotas — fechaInicio = fecha del PRÓXIMO pago
    // Si hay cuotas ya pagadas, generateInstallments retrocede las fechas automáticamente
    const numPagadas = Math.min(Number(cuotasPagadas || 0), numCuotas);
    const cuotas = generateInstallments(fechaInicio, numCuotas, numPagadas);

    const id = Date.now().toString();
    const record: FinancingRecord = {
      id,
      nombre: String(nombre).trim(),
      cedula: String(cedula).trim(),
      telefono: String(telefono).trim(),
      imei: String(imei).trim(),
      producto: String(producto || '').trim(),
      costoTotal: Number(costoTotal),
      costoEquipo: Number(costoEquipo || 0),
      cuotaInicial: Number(cuotaInicial || 0),
      numeroCuotas: numCuotas,
      valorCuota,
      fechaInicio,
      horaBloqueo: String(horaBloqueo || '08:00'),
      cuotasPrevias: numPagadas,
      cuotas,
      status: numPagadas >= numCuotas ? 'completed' : 'active',
      createdAt: new Date().toISOString(),
    };

    await db.collection('financing').insertOne(record);

    // Si existe deuda manual de Xiaomi, incrementar con el costo del equipo
    if (Number(costoEquipo) > 0) {
      const debtDoc = await db.collection('settings').findOne({ key: 'xiaomi_debt' });
      if (debtDoc?.deudaReal !== null && debtDoc?.deudaReal !== undefined) {
        await db.collection('settings').updateOne(
          { key: 'xiaomi_debt' },
          { $inc: { deudaReal: Number(costoEquipo) }, $set: { updatedAt: new Date().toISOString() } }
        );
      }
    }

    res.json(record);
  } catch (error) {
    console.error('[financing] Error creating:', error);
    res.status(500).json({ error: 'Error al crear financiamiento' });
  }
});

app.put('/api/financing/:id', async (req, res) => {
  try {
    const { nombre, cedula, telefono, imei, producto, costoEquipo, valorCuota, cuotaInicial, numeroCuotas, fechaInicio, horaBloqueo } = req.body;
    const $set: Record<string, unknown> = {};
    if (nombre !== undefined) $set.nombre = String(nombre).trim();
    if (cedula !== undefined) $set.cedula = String(cedula).trim();
    if (telefono !== undefined) $set.telefono = String(telefono).trim();
    if (imei !== undefined) $set.imei = String(imei).trim();
    if (producto !== undefined) $set.producto = String(producto).trim();
    if (costoEquipo !== undefined) $set.costoEquipo = Number(costoEquipo);
    if (horaBloqueo !== undefined) $set.horaBloqueo = String(horaBloqueo);

    const existing = await db.collection('financing').findOne({ id: req.params.id });
    if (!existing) return res.status(404).json({ error: 'No encontrado' });

    const newValorCuota = Number(valorCuota ?? existing.valorCuota);
    const newInicial = Number(cuotaInicial ?? existing.cuotaInicial);
    const newNumCuotas = Number(numeroCuotas ?? existing.numeroCuotas);
    const newFechaInicio = fechaInicio ?? existing.fechaInicio;
    const newCostoTotal = (newValorCuota * newNumCuotas) + newInicial;

    // Siempre actualizar estos valores
    $set.valorCuota = newValorCuota;
    $set.cuotaInicial = newInicial;
    $set.numeroCuotas = newNumCuotas;
    $set.costoTotal = newCostoTotal;
    $set.fechaInicio = newFechaInicio;

    // Comparar fechas normalizadas para evitar falsos positivos por formato
    const normDate = (d: string) => new Date(d).toISOString().slice(0, 10);
    const cuotasChanged = newNumCuotas !== existing.numeroCuotas;
    const fechaChanged = normDate(newFechaInicio) !== normDate(existing.fechaInicio);

    if (cuotasChanged || fechaChanged) {
      const previas = existing.cuotasPrevias || 0;
      const oldCuotas: FinancingInstallment[] = existing.cuotas || [];

      // Separar cuotas pagadas (intocables) de pendientes (se regeneran)
      const paidCuotas = oldCuotas.filter(c => c.status === 'paid');
      const unpaidCount = newNumCuotas - previas - paidCuotas.length;

      if (unpaidCount > 0) {
        // Generar solo las cuotas pendientes desde la nueva fecha
        const nextNumber = paidCuotas.length > 0
          ? paidCuotas[paidCuotas.length - 1].number + 1
          : previas + 1;

        const unpaidCuotas: FinancingInstallment[] = [];
        const start = new Date(newFechaInicio);
        for (let i = 0; i < unpaidCount; i++) {
          const d = new Date(start);
          d.setUTCDate(d.getUTCDate() + i * 15);
          unpaidCuotas.push({
            number: nextNumber + i,
            dueDate: d.toISOString(),
            status: 'pending',
          });
        }

        // Cuotas pagadas intactas + nuevas pendientes desde fechaInicio
        $set.cuotas = [...paidCuotas, ...unpaidCuotas];
      } else {
        // Todas pagadas o menos cuotas que pagadas
        $set.cuotas = paidCuotas.slice(0, newNumCuotas - previas);
      }

      const finalCuotas = $set.cuotas as FinancingInstallment[];
      console.log(`[financing] Updated cuotas for ${existing.nombre}: ${paidCuotas.length} paid kept, ${finalCuotas.length - paidCuotas.length} unpaid regenerated from ${normDate(newFechaInicio)}`);
    }

    if (Object.keys($set).length === 0) {
      return res.status(400).json({ error: 'Sin campos para actualizar' });
    }

    await db.collection('financing').updateOne({ id: req.params.id }, { $set });
    const updated = await db.collection('financing').findOne({ id: req.params.id });
    res.json(updated);
  } catch (error) {
    console.error('[financing] Error updating:', error);
    res.status(500).json({ error: 'Error al actualizar financiamiento' });
  }
});

// --- Reparar cuotas corruptas (cuotas que no respetan cuotasPrevias) ---
app.post('/api/financing/fix-cuotas', async (_req, res) => {
  try {
    const records = await db.collection('financing').find({}).toArray();
    const fixes: string[] = [];

    for (const r of records) {
      const previas = r.cuotasPrevias || 0;
      const expectedCount = r.numeroCuotas - previas;
      const expectedFirstNum = previas + 1;
      const actualCount = (r.cuotas || []).length;
      const actualFirstNum = r.cuotas?.[0]?.number ?? 0;

      if (actualCount !== expectedCount || actualFirstNum !== expectedFirstNum) {
        // Guardar qué cuotas estaban pagadas (por posición relativa: 1ra cuota del sistema, 2da, etc.)
        const oldCuotas: FinancingInstallment[] = r.cuotas || [];
        const oldPaidPositions = new Set<number>();
        const oldPaidDates: Record<number, string> = {};
        oldCuotas.forEach((c: FinancingInstallment, idx: number) => {
          if (c.status === 'paid') {
            oldPaidPositions.add(idx);
            oldPaidDates[idx] = c.paidDate || new Date().toISOString();
          }
        });

        // Generar cuotas correctas
        const newCuotas = generateInstallments(r.fechaInicio, r.numeroCuotas, previas);

        // Transferir pagos: por posición (1ra cuota pagada → 1ra nueva cuota pagada)
        oldPaidPositions.forEach(pos => {
          if (pos < newCuotas.length) {
            newCuotas[pos].status = 'paid';
            newCuotas[pos].paidDate = oldPaidDates[pos];
          }
        });

        await db.collection('financing').updateOne({ id: r.id }, { $set: { cuotas: newCuotas } });
        const paidCount = newCuotas.filter((c: FinancingInstallment) => c.status === 'paid').length;
        fixes.push(`${r.nombre}: ${actualCount} → ${newCuotas.length} cuotas (nums ${expectedFirstNum}-${r.numeroCuotas}), ${paidCount} paid preserved`);
      }
    }

    res.json({ fixed: fixes.length, details: fixes });
  } catch (error) {
    console.error('[financing] Error fixing cuotas:', error);
    res.status(500).json({ error: 'Error al reparar cuotas' });
  }
});

app.delete('/api/financing/:id', async (req, res) => {
  try {
    const result = await db.collection('financing').deleteOne({ id: req.params.id });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ success: true });
  } catch (error) {
    console.error('[financing] Error deleting:', error);
    res.status(500).json({ error: 'Error al eliminar financiamiento' });
  }
});

// --- Marcar cuota como pagada (con fecha de próximo pago opcional) ---
app.post('/api/financing/:id/pay/:cuotaNumber', async (req, res) => {
  try {
    const record = await db.collection('financing').findOne({ id: req.params.id });
    if (!record) return res.status(404).json({ error: 'Financiamiento no encontrado' });

    const cuotaNum = Number(req.params.cuotaNumber);
    const cuotas: FinancingInstallment[] = record.cuotas || [];
    const idx = cuotas.findIndex(c => c.number === cuotaNum);
    if (idx === -1) return res.status(404).json({ error: 'Cuota no encontrada' });

    // Marcar como pagada
    cuotas[idx].status = 'paid';
    cuotas[idx].paidDate = new Date().toISOString();

    // Si envían nextDate, reprogramar SOLO las cuotas pendientes desde esa fecha
    const { nextDate } = req.body || {};
    if (nextDate) {
      const pendingCuotas = cuotas.filter(c => c.status !== 'paid');
      if (pendingCuotas.length > 0) {
        const start = new Date(nextDate);
        pendingCuotas.forEach((c, i) => {
          const d = new Date(start);
          d.setUTCDate(d.getUTCDate() + i * 15);
          c.dueDate = d.toISOString();
        });
      }
      // Actualizar fechaInicio del registro también
      const $setExtra: Record<string, unknown> = { fechaInicio: new Date(nextDate).toISOString() };
      await db.collection('financing').updateOne({ id: req.params.id }, { $set: $setExtra });
    }

    // Verificar si todas las cuotas están pagadas
    const allPaid = cuotas.every(c => c.status === 'paid');
    const $set: Record<string, unknown> = { cuotas };
    if (allPaid) $set.status = 'completed';

    await db.collection('financing').updateOne({ id: req.params.id }, { $set });

    const updated = await db.collection('financing').findOne({ id: req.params.id });
    res.json(updated);
  } catch (error) {
    console.error('[financing] Error paying:', error);
    res.status(500).json({ error: 'Error al registrar pago' });
  }
});

// --- Desmarcar cuota (volver a pendiente) ---
app.post('/api/financing/:id/unpay/:cuotaNumber', async (req, res) => {
  try {
    const record = await db.collection('financing').findOne({ id: req.params.id });
    if (!record) return res.status(404).json({ error: 'Financiamiento no encontrado' });

    const cuotaNum = Number(req.params.cuotaNumber);
    const cuotas: FinancingInstallment[] = record.cuotas || [];
    const idx = cuotas.findIndex(c => c.number === cuotaNum);
    if (idx === -1) return res.status(404).json({ error: 'Cuota no encontrada' });

    cuotas[idx].status = 'pending';
    cuotas[idx].paidDate = undefined;

    await db.collection('financing').updateOne(
      { id: req.params.id },
      { $set: { cuotas, status: 'active' } }
    );

    const updated = await db.collection('financing').findOne({ id: req.params.id });
    res.json(updated);
  } catch (error) {
    console.error('[financing] Error unpaying:', error);
    res.status(500).json({ error: 'Error al desmarcar pago' });
  }
});

// --- Enviar recordatorio WhatsApp manual ---
app.post('/api/financing/:id/remind', async (req, res) => {
  try {
    const record = await db.collection('financing').findOne({ id: req.params.id });
    if (!record) return res.status(404).json({ error: 'No encontrado' });

    if (whatsappService.getStatus() !== 'connected') {
      return res.status(400).json({ error: 'WhatsApp no está conectado' });
    }

    // Encontrar próxima cuota pendiente
    const cuotas: FinancingInstallment[] = refreshOverdueStatus(record.cuotas || [], record.horaBloqueo || '08:00');
    const nextPending = cuotas.find(c => c.status === 'pending' || c.status === 'overdue');

    if (!nextPending) {
      return res.status(400).json({ error: 'No hay cuotas pendientes' });
    }

    const dueDate = new Date(nextPending.dueDate);
    const fechaStr = dueDate.toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Bogota' });
    const isOverdue = nextPending.status === 'overdue';

    const valorStr = record.valorCuota.toLocaleString('es-CO');
    const previas = record.cuotasPrevias || 0;
    const paidCountStr = previas + cuotas.filter((c: FinancingInstallment) => c.status === 'paid').length;
    const hora = record.horaBloqueo || '08:00';

    const msg = isOverdue
      ? `🔒 *CREDILOCK — Pago Vencido*\n\nHola *${record.nombre}*, tu cuota #${nextPending.number} de *$${valorStr} COP* venció el *${fechaStr}*.\n\n⚠️ *Tu equipo será bloqueado a las ${hora} si no realizas el pago.*\n\nEvita el bloqueo realizando tu pago lo antes posible.\n\n📱 IMEI: ${record.imei}\nCuotas pagadas: ${paidCountStr}/${record.numeroCuotas}\n📞 Contacto: 302 287 5280\n\n_CREDILOCK — Sistema de financiamiento_`
      : `📅 *CREDILOCK — Recordatorio de Pago*\n\nHola *${record.nombre}*, te recordamos que tu cuota #${nextPending.number} de *$${valorStr} COP* vence el *${fechaStr}*.\n\n⏰ *Si no se realiza el pago, el equipo será bloqueado a las ${hora}.*\n\nCuotas pagadas: ${paidCountStr}/${record.numeroCuotas}\n\n📱 IMEI: ${record.imei}\n📞 Contacto: 302 287 5280\n\n_CREDILOCK — Sistema de financiamiento_`;

    const success = await whatsappService.sendMessage(record.telefono, msg);
    if (success) {
      const colombia = getColombiaDate();
      await db.collection('financing').updateOne(
        { id: req.params.id },
        { $set: { lastReminderSent: colombia.dateStr } }
      );
    }

    res.json({ success, message: success ? 'Recordatorio enviado' : 'No se pudo enviar' });
  } catch (error) {
    console.error('[financing] Error sending reminder:', error);
    res.status(500).json({ error: 'Error al enviar recordatorio' });
  }
});

// --- Cron de recordatorios automáticos (se ejecuta cada hora) ---
let financingReminderInterval: NodeJS.Timeout | null = null;

// Obtener fecha y hora actual en Colombia (UTC-5)
function getColombiaDate(): { dateStr: string; hour: number } {
  const now = new Date();
  const colombiaStr = now.toLocaleString('en-CA', { timeZone: 'America/Bogota', hour12: false });
  // en-CA format: "2026-07-04, 12:30:00" or "2026-07-04 12:30:00"
  const dateStr = colombiaStr.slice(0, 10);
  const timePart = colombiaStr.split(/[, ]+/).pop() || '00:00:00';
  const hour = parseInt(timePart.split(':')[0], 10);
  return { dateStr, hour };
}

async function checkFinancingReminders() {
  if (!db || whatsappService.getStatus() !== 'connected') return;

  // Solo enviar recordatorios entre 11:30 AM y 12:30 PM Colombia (ventana del mediodía)
  const colombia = getColombiaDate();
  if (colombia.hour < 11 || colombia.hour > 13) return;

  try {
    const records = await db.collection('financing').find({ status: 'active' }).toArray();
    const todayStr = colombia.dateStr;

    for (const record of records) {
      const cuotas: FinancingInstallment[] = record.cuotas || [];
      const nextPending = cuotas.find((c: FinancingInstallment) => c.status === 'pending' || c.status === 'overdue');
      if (!nextPending) continue;

      const dueDate = new Date(nextPending.dueDate);
      const dueDateStr = dueDate.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

      // Calcular día anterior
      const dayBefore = new Date(dueDate);
      dayBefore.setDate(dayBefore.getDate() - 1);
      const dayBeforeStr = dayBefore.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

      // Solo enviar si hoy es el día antes o el día del pago
      const shouldRemind = todayStr === dayBeforeStr || todayStr === dueDateStr;
      if (!shouldRemind) continue;

      // Evitar enviar dos veces el mismo día
      const lastSent = record.lastReminderSent ? record.lastReminderSent.slice(0, 10) : '';
      if (lastSent === todayStr) continue;

      const fechaStr = dueDate.toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Bogota' });
      const isToday = todayStr === dueDateStr;
      const hora = record.horaBloqueo || '08:00';
      const previas = record.cuotasPrevias || 0;
      const paidCount = previas + cuotas.filter((c: FinancingInstallment) => c.status === 'paid').length;
      const valorStr = record.valorCuota.toLocaleString('es-CO');

      const msg = isToday
        ? `🔒 *CREDILOCK — ¡Hoy vence tu cuota!*\n\nHola *${record.nombre}*, hoy vence tu cuota #${nextPending.number} de *$${valorStr} COP*.\n\n⚠️ *Si no pagas antes de las ${hora}, tu equipo será bloqueado.*\n\nCuotas pagadas: ${paidCount}/${record.numeroCuotas}\n\n📱 IMEI: ${record.imei}\n📞 Contacto: 302 287 5280\n\n_CREDILOCK — Sistema de financiamiento_`
        : `🔔 *CREDILOCK — Recordatorio de Pago*\n\nHola *${record.nombre}*, mañana *${fechaStr}* vence tu cuota #${nextPending.number} de *$${valorStr} COP*.\n\n⏰ *Si no se realiza el pago, el equipo será bloqueado a las ${hora}.*\n\nCuotas pagadas: ${paidCount}/${record.numeroCuotas}\n\n📱 IMEI: ${record.imei}\n📞 Contacto: 302 287 5280\n\n_CREDILOCK — Sistema de financiamiento_`;

      const success = await whatsappService.sendMessage(record.telefono, msg);
      if (success) {
        await db.collection('financing').updateOne(
          { id: record.id },
          { $set: { lastReminderSent: todayStr } }
        );
        console.log(`[financing] Recordatorio enviado a ${record.nombre} (${record.telefono})`);
      }

      // Delay entre mensajes para no ser bloqueado
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  } catch (err) {
    console.error('[financing] Error en cron de recordatorios:', err);
  }
}

let scheduledNotificationsInterval: NodeJS.Timeout | null = null;

async function checkScheduledNotifications() {
  try {
    const now = new Date().toISOString();
    const pending = await db.collection('scheduled_notifications')
      .find({ status: 'pending', sendAt: { $lte: now } })
      .toArray();

    if (pending.length === 0) return;

    console.log(`[Scheduled-WA] Procesando ${pending.length} mensajes de WhatsApp programados...`);

    for (const notif of pending) {
      try {
        if (whatsappService.getStatus() === 'connected') {
          const success = await whatsappService.sendMessage(notif.phone, notif.message);
          if (success) {
            await db.collection('scheduled_notifications').updateOne(
              { _id: notif._id },
              { $set: { status: 'sent', sentAt: new Date().toISOString() } }
            );
            console.log(`[Scheduled-WA] Mensaje enviado a ${notif.phone}`);
          } else {
            console.warn(`[Scheduled-WA] Falló el envío del mensaje a ${notif.phone}`);
            await db.collection('scheduled_notifications').updateOne(
              { _id: notif._id },
              { $set: { status: 'failed', lastError: 'Envío fallido (retorno false)', updatedAt: new Date().toISOString() } }
            );
          }
        } else {
          console.log(`[Scheduled-WA] WhatsApp no conectado. Reintento en el próximo ciclo.`);
        }
      } catch (err) {
        console.error(`[Scheduled-WA] Error al enviar a ${notif.phone}:`, err);
        await db.collection('scheduled_notifications').updateOne(
          { _id: notif._id },
          { $set: { status: 'failed', lastError: String(err), updatedAt: new Date().toISOString() } }
        );
      }
      // Pequeño delay de cortesía
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  } catch (error) {
    console.error('[Scheduled-WA] Error en cron de mensajes programados:', error);
  }
}

// Iniciar cron cada hora
financingReminderInterval = setInterval(checkFinancingReminders, 60 * 60 * 1000);
// Primera verificación 30s después de arrancar
setTimeout(checkFinancingReminders, 30000);

// Iniciar cron de mensajes programados (cada 1 minuto)
scheduledNotificationsInterval = setInterval(checkScheduledNotifications, 60 * 1000);
// Primera verificación 15s después de arrancar
setTimeout(checkScheduledNotifications, 15000);

let campaignInterval: NodeJS.Timeout | null = null;
let activeCampaignProcessing = false;

async function processCampaignSends() {
  if (activeCampaignProcessing) return;
  activeCampaignProcessing = true;

  try {
    const now = new Date().toISOString();
    let campaign = await db.collection('campaigns').findOne({
      status: { $in: ['processing', 'active'] }
    });

    if (!campaign) {
      // Buscar campañas programadas que ya deben iniciar
      const scheduled = await db.collection('campaigns').findOne({
        status: 'scheduled',
        scheduledAt: { $lte: now }
      });
      if (scheduled) {
        campaign = scheduled;
        await db.collection('campaigns').updateOne(
          { _id: campaign._id },
          { $set: { status: 'processing', startedAt: now } }
        );
        campaign.status = 'processing';
      }
    }

    if (!campaign) {
      activeCampaignProcessing = false;
      return;
    }

    // Si la campaña está en 'active' (iniciando por primera vez), pasarla a 'processing'
    if (campaign.status === 'active') {
      await db.collection('campaigns').updateOne(
        { _id: campaign._id },
        { $set: { status: 'processing', startedAt: now } }
      );
      campaign.status = 'processing';
    }

    // Encontrar el primer destinatario pendiente
    const recipientIndex = (campaign.recipients || []).findIndex((r: any) => r.status === 'pending');

    if (recipientIndex === -1) {
      // Finalizada!
      await db.collection('campaigns').updateOne(
        { _id: campaign._id },
        { $set: { status: 'sent', finishedAt: new Date().toISOString() } }
      );
      console.log(`[Campaign-WA] Campaña "${campaign.name}" finalizada.`);
      activeCampaignProcessing = false;
      return;
    }

    const recipient = campaign.recipients[recipientIndex];
    const delay = Number(campaign.delaySeconds || 10) * 1000;

    if (whatsappService.getStatus() !== 'connected') {
      console.log('[Campaign-WA] WhatsApp no conectado. Reintento en el próximo ciclo.');
      activeCampaignProcessing = false;
      return;
    }

    console.log(`[Campaign-WA] Enviando a ${recipient.name} (${recipient.phone}) para campaña "${campaign.name}"`);

    let msg = campaign.message || '';
    msg = msg.split('{{nombre}}').join(recipient.name || 'Cliente');

    const success = await whatsappService.sendMessage(recipient.phone, msg, campaign.imageUrl);

    const updateQuery: Record<string, any> = {};
    updateQuery[`recipients.${recipientIndex}.status`] = success ? 'sent' : 'failed';
    updateQuery[`recipients.${recipientIndex}.processedAt`] = new Date().toISOString();
    if (!success) {
      updateQuery[`recipients.${recipientIndex}.error`] = 'Envío fallido o WhatsApp desconectado';
    }

    const incQuery: Record<string, number> = {};
    if (success) {
      incQuery.sentCount = 1;
    } else {
      incQuery.failedCount = 1;
    }

    await db.collection('campaigns').updateOne(
      { _id: campaign._id },
      { 
        $set: updateQuery,
        $inc: incQuery
      }
    );

    setTimeout(() => {
      activeCampaignProcessing = false;
    }, delay);

  } catch (error) {
    console.error('[Campaign-WA] Error en procesador de campañas:', error);
    activeCampaignProcessing = false;
  }
}

// Iniciar cron de campañas (cada 5 segundos para revisar la cola)
campaignInterval = setInterval(processCampaignSends, 5000);
setTimeout(processCampaignSends, 20000);

// ====================================================================
// 💳  PAGOS A XIAOMI
// ====================================================================

app.get('/api/xiaomi-payments', async (_req, res) => {
  try {
    const payments = await db.collection('xiaomi_payments').find().sort({ date: -1 }).toArray();
    res.json(payments);
  } catch (error) {
    console.error('[xiaomi-payments] Error loading:', error);
    res.status(500).json({ error: 'Error al cargar pagos' });
  }
});

app.post('/api/xiaomi-payments', async (req, res) => {
  try {
    const { amount, note } = req.body;
    if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'Monto inválido' });

    const payment = {
      id: crypto.randomUUID(),
      amount: Number(amount),
      note: note || '',
      date: new Date().toISOString(),
    };

    await db.collection('xiaomi_payments').insertOne(payment);

    // Si existe deuda manual, decrementar
    const debtDoc = await db.collection('settings').findOne({ key: 'xiaomi_debt' });
    if (debtDoc?.deudaReal !== null && debtDoc?.deudaReal !== undefined) {
      const newDebt = Math.max(0, debtDoc.deudaReal - Number(amount));
      await db.collection('settings').updateOne(
        { key: 'xiaomi_debt' },
        { $set: { deudaReal: newDebt, updatedAt: new Date().toISOString() } }
      );
    }

    res.status(201).json(payment);
  } catch (error) {
    console.error('[xiaomi-payments] Error creating:', error);
    res.status(500).json({ error: 'Error al registrar pago' });
  }
});

app.delete('/api/xiaomi-payments/:id', async (req, res) => {
  try {
    // Encontrar el pago antes de eliminarlo para restaurar deuda
    const payment = await db.collection('xiaomi_payments').findOne({ id: req.params.id });
    const result = await db.collection('xiaomi_payments').deleteOne({ id: req.params.id });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'No encontrado' });

    // Restaurar deuda manual si existe
    if (payment) {
      const debtDoc = await db.collection('settings').findOne({ key: 'xiaomi_debt' });
      if (debtDoc?.deudaReal !== null && debtDoc?.deudaReal !== undefined) {
        await db.collection('settings').updateOne(
          { key: 'xiaomi_debt' },
          { $inc: { deudaReal: payment.amount }, $set: { updatedAt: new Date().toISOString() } }
        );
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[xiaomi-payments] Error deleting:', error);
    res.status(500).json({ error: 'Error al eliminar pago' });
  }
});

// --- Deuda Xiaomi: ajuste manual ---
// Permite al dueño fijar la deuda real. A partir de ahí el sistema
// la incrementa con cada nuevo CrediLock y la decrementa con pagos.

app.get('/api/xiaomi-debt', async (_req, res) => {
  try {
    const doc = await db.collection('settings').findOne({ key: 'xiaomi_debt' });
    res.json({ deudaReal: doc?.deudaReal ?? null, updatedAt: doc?.updatedAt ?? null });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener deuda' });
  }
});

app.post('/api/xiaomi-debt', async (req, res) => {
  try {
    const { deudaReal } = req.body;
    if (deudaReal === undefined || deudaReal === null) {
      return res.status(400).json({ error: 'Monto requerido' });
    }
    await db.collection('settings').updateOne(
      { key: 'xiaomi_debt' },
      { $set: { key: 'xiaomi_debt', deudaReal: Number(deudaReal), updatedAt: new Date().toISOString() } },
      { upsert: true }
    );
    res.json({ success: true, deudaReal: Number(deudaReal) });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar deuda' });
  }
});

// ====================================================================
// 📦  SISTEMA DE INVENTARIO, FACTURACIÓN Y CAJA
// ====================================================================

// --- Métodos de pago (config) ---

app.get('/api/inventario/metodos-pago', async (_req, res) => {
  try {
    const methods = await db.collection('payment_methods').find().sort({ orden: 1 }).toArray();
    if (methods.length === 0) {
      // Seed defaults
      const defaults = [
        { id: crypto.randomUUID(), nombre: 'Efectivo', clave: 'efectivo', diasPendiente: 0, activo: true, orden: 1 },
        { id: crypto.randomUUID(), nombre: 'Transferencia', clave: 'transferencia', diasPendiente: 0, activo: true, orden: 2 },
        { id: crypto.randomUUID(), nombre: 'Datáfono BOD', clave: 'datafonoBOD', diasPendiente: 1, activo: true, orden: 3 },
        { id: crypto.randomUUID(), nombre: 'ADDI', clave: 'addi', diasPendiente: 5, activo: true, orden: 4 },
      ];
      await db.collection('payment_methods').insertMany(defaults);
      return res.json(defaults);
    }
    res.json(methods);
  } catch (error) {
    console.error('[inventario] Error metodos-pago:', error);
    res.status(500).json({ error: 'Error al cargar métodos de pago' });
  }
});

app.post('/api/inventario/metodos-pago', async (req, res) => {
  try {
    const { nombre, diasPendiente } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const clave = nombre.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');
    const count = await db.collection('payment_methods').countDocuments();
    const method = {
      id: crypto.randomUUID(),
      nombre,
      clave,
      diasPendiente: Number(diasPendiente || 0),
      activo: true,
      orden: count + 1,
    };
    await db.collection('payment_methods').insertOne(method);
    res.status(201).json(method);
  } catch (error) {
    console.error('[inventario] Error creating metodo:', error);
    res.status(500).json({ error: 'Error al crear método de pago' });
  }
});

app.delete('/api/inventario/metodos-pago/:id', async (req, res) => {
  try {
    await db.collection('payment_methods').deleteOne({ id: req.params.id });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar' });
  }
});

// --- Inventario físico (items) ---

app.get('/api/inventario/items', async (req, res) => {
  try {
    const filter: Record<string, unknown> = {};
    if (req.query.estado) filter.estado = req.query.estado;
    if (req.query.proveedor) filter.proveedor = req.query.proveedor;
    const items = await db.collection('inventory').find(filter).sort({ fechaIngreso: -1 }).toArray();
    res.json(items);
  } catch (error) {
    console.error('[inventario] Error listing items:', error);
    res.status(500).json({ error: 'Error al cargar inventario' });
  }
});

app.post('/api/inventario/items', async (req, res) => {
  try {
    const { producto, productoId, imei, categoria, cantidad, precioCompra, precioVenta, proveedor, esPropio, notas } = req.body;
    if (!producto) return res.status(400).json({ error: 'Producto requerido' });

    // Check duplicate IMEI
    if (imei) {
      const existing = await db.collection('inventory').findOne({ imei, estado: { $ne: 'vendido' } });
      if (existing) return res.status(400).json({ error: `IMEI ${imei} ya existe en inventario` });
    }

    const item = {
      id: crypto.randomUUID(),
      producto,
      productoId: productoId || null,
      imei: imei || '',
      categoria: categoria || 'general',
      cantidad: Number(cantidad || 1),
      precioCompra: Number(precioCompra || 0),
      precioVenta: Number(precioVenta || 0),
      proveedor: esPropio ? 'Propio' : (proveedor || ''),
      esPropio: Boolean(esPropio),
      estado: 'disponible',
      notas: notas || '',
      fechaIngreso: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await db.collection('inventory').insertOne(item);
    res.status(201).json(item);
  } catch (error) {
    console.error('[inventario] Error creating item:', error);
    res.status(500).json({ error: 'Error al agregar item' });
  }
});

app.put('/api/inventario/items/:id', async (req, res) => {
  try {
    const { producto, productoId, imei, categoria, cantidad, precioCompra, precioVenta, proveedor, esPropio, estado, notas } = req.body;
    const $set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (producto !== undefined) $set.producto = producto;
    if (productoId !== undefined) $set.productoId = productoId;
    if (imei !== undefined) $set.imei = imei;
    if (categoria !== undefined) $set.categoria = categoria;
    if (cantidad !== undefined) $set.cantidad = Number(cantidad);
    if (precioCompra !== undefined) $set.precioCompra = Number(precioCompra);
    if (precioVenta !== undefined) $set.precioVenta = Number(precioVenta);
    if (proveedor !== undefined) $set.proveedor = proveedor;
    if (esPropio !== undefined) $set.esPropio = Boolean(esPropio);
    if (estado !== undefined) $set.estado = estado;
    if (notas !== undefined) $set.notas = notas;

    await db.collection('inventory').updateOne({ id: req.params.id }, { $set });
    const updated = await db.collection('inventory').findOne({ id: req.params.id });
    res.json(updated);
  } catch (error) {
    console.error('[inventario] Error updating item:', error);
    res.status(500).json({ error: 'Error al actualizar' });
  }
});

app.delete('/api/inventario/items/:id', async (req, res) => {
  try {
    await db.collection('inventory').deleteOne({ id: req.params.id });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar' });
  }
});

// --- Ventas del día (daily sales / facturación) ---

app.get('/api/inventario/ventas', async (req, res) => {
  try {
    const filter: Record<string, unknown> = {};
    if (req.query.fecha) filter.fecha = req.query.fecha;
    const ventas = await db.collection('daily_sales').find(filter).sort({ createdAt: -1 }).toArray();
    res.json(ventas);
  } catch (error) {
    console.error('[inventario] Error listing ventas:', error);
    res.status(500).json({ error: 'Error al cargar ventas' });
  }
});

app.post('/api/inventario/ventas', async (req, res) => {
  try {
    const { cliente, producto, imei, esPropio, proveedor, precioCompra, precioVenta, metodoPago, estadoPago, fechaEsperada, notas, orderId, inventarioId, obsequioNombre, obsequioCosto, telefono, cedula, obsequioInventarioId } = req.body;
    if (!cliente || !producto || !precioVenta) return res.status(400).json({ error: 'Faltan campos requeridos' });

    // Autodetectar obsequio si no se envió de forma explícita pero el producto lo sugiere en su nombre
    let finalObsequioNombre = obsequioNombre || '';
    let finalObsequioInventarioId = obsequioInventarioId || '';
    let finalCostoObsequio = Number(obsequioCosto || 0);

    if (!finalObsequioNombre && producto.includes('+')) {
      const partes = producto.split('+');
      if (partes.length > 1) {
        let parteObsequio = partes[1].split('-')[0]; // Quitar variantes que van después del guión si existen
        parteObsequio = parteObsequio.replace(/\((?:regalo|obsequio)\)/gi, '');
        parteObsequio = parteObsequio.trim();

        if (parteObsequio && parteObsequio.toLowerCase() !== 'obsequio') {
          // Intentar pre-buscar en el inventario para obtener ID y costo real
          const escapedGift = makeMatchFriendlyPattern(parteObsequio);
          let preGiftItem = await db.collection('inventory').findOne({
            estado: 'disponible',
            cantidad: { $gte: 1 },
            producto: { $regex: escapedGift, $options: 'i' },
          });

          if (!preGiftItem) {
            const giftKw = parteObsequio.split(/[\s+(),\-]+/g)
              .filter((w: string) => w.length > 2)
              .map((w: string) => makeMatchFriendlyPattern(w));
            if (giftKw.length > 0) {
              const giftRegex = giftKw.map((w: string) => `(?=.*${w})`).join('');
              preGiftItem = await db.collection('inventory').findOne({
                estado: 'disponible',
                cantidad: { $gte: 1 },
                producto: { $regex: giftRegex, $options: 'i' },
              });
            }
          }

          if (preGiftItem) {
            finalObsequioNombre = preGiftItem.producto;
            finalObsequioInventarioId = preGiftItem.id;
            finalCostoObsequio = Number(preGiftItem.precioCompra || 0);
            console.log(`[autodetect-obsequio] Auto-vinculado obsequio "${finalObsequioNombre}" (ID: ${finalObsequioInventarioId}, Costo: ${finalCostoObsequio})`);
          } else {
            finalObsequioNombre = parteObsequio;
          }
        }
      }
    }

    const compra = Number(precioCompra || 0) + finalCostoObsequio;
    const venta = Number(precioVenta);
    const hoy = new Date().toISOString().slice(0, 10);

    // Calculate expected date for pending payments
    let expectedDate = fechaEsperada;
    if (!expectedDate && estadoPago === 'pendiente') {
      const methods = await db.collection('payment_methods').find().toArray();
      const method = methods.find((m: any) => m.clave === metodoPago);
      if (method && method.diasPendiente > 0) {
        const d = new Date();
        d.setDate(d.getDate() + method.diasPendiente);
        // Skip weekends for business days
        while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
        expectedDate = d.toISOString();
      }
    }

    const tipo = req.body.tipo || 'venta';

    const puntosRedimidosNum = Number(req.body.puntosRedimidos || 0);
    const netPaid = Math.max(0, venta - puntosRedimidosNum);

    // Determinar tasa de acumulación: 1% para celulares (tienen IMEI), 5% para accesorios
    const tieneImei = !!(imei && String(imei).trim());
    const tasaCashback = tieneImei ? 0.01 : 0.05;
    const pointsEarned = Math.round(netPaid * tasaCashback);

    const venta_record: Record<string, unknown> = {
      id: crypto.randomUUID(),
      fecha: hoy,
      orderId: orderId || null,
      inventarioId: inventarioId || null,
      tipo,
      cliente,
      producto,
      imei: imei || '',
      esPropio: Boolean(esPropio),
      proveedor: esPropio ? '' : (proveedor || ''),
      precioCompra: compra,
      precioVenta: venta,
      ganancia: venta - compra,
      metodoPago: metodoPago || 'efectivo',
      estadoPago: estadoPago || 'recibido',
      fechaEsperada: expectedDate || null,
      notas: notas || '',
      creadoPor: orderId ? 'web' : 'manual',
      createdAt: new Date().toISOString(),
      telefono: telefono || '',
      cedula: cedula || '',
      puntosRedimidos: puntosRedimidosNum,
      puntosGanados: pointsEarned,
    };

    // Guardar info del obsequio si aplica
    if (finalObsequioNombre) {
      venta_record.obsequioNombre = finalObsequioNombre;
      venta_record.obsequioCosto = finalCostoObsequio;
      venta_record.obsequioInventarioId = finalObsequioInventarioId || '';
    }

    let newPointsBalance = 0;
    if (telefono) {
      const cleanPhone = String(telefono).replace(/[\s\-\+\(\)\.]/g, '').trim();
      if (cleanPhone && cleanPhone.length >= 7) {
        const clientDoc = await db.collection('loyalty_points').findOne({ phone: cleanPhone });
        const currentPoints = clientDoc?.points || 0;
        newPointsBalance = Math.max(0, currentPoints - puntosRedimidosNum + pointsEarned);

        await db.collection('loyalty_points').updateOne(
          { phone: cleanPhone },
          {
            $set: {
              name: cliente,
              cedula: cedula || '',
              points: newPointsBalance,
              updatedAt: new Date().toISOString()
            }
          },
          { upsert: true }
        );
        console.log(`[loyalty] Cliente ${cliente} (${cleanPhone}) puntos actualizados. Balance final: ${newPointsBalance}`);
      }
    }

    await db.collection('daily_sales').insertOne(venta_record);

    // Programar mensaje de agradecimiento de WhatsApp si es venta física (manual) y tiene teléfono
    if (!orderId && telefono) {
      await scheduleInStoreWhatsApp(venta_record, pointsEarned, newPointsBalance);
    }

    // Descontar obsequio del inventario si existe
    if (finalObsequioNombre) {
      let giftItem = null;
      if (finalObsequioInventarioId) {
        giftItem = await db.collection('inventory').findOne({
          id: finalObsequioInventarioId,
          estado: 'disponible',
          cantidad: { $gte: 1 },
        });
        if (!giftItem) {
          console.warn(`[obsequio] Item con id ${finalObsequioInventarioId} no encontrado o no disponible, intentando búsqueda por nombre`);
        }
      }

      if (!giftItem) {
        const escapedGift = makeMatchFriendlyPattern(finalObsequioNombre);
        giftItem = await db.collection('inventory').findOne({
          estado: 'disponible',
          cantidad: { $gte: 1 },
          producto: { $regex: escapedGift, $options: 'i' },
        });
        if (!giftItem) {
          const giftKw = finalObsequioNombre.split(/[\s+(),\-]+/g)
            .filter((w: string) => w.length > 2)
            .map((w: string) => makeMatchFriendlyPattern(w));
          if (giftKw.length > 0) {
            const giftRegex = giftKw.map((w: string) => `(?=.*${w})`).join('');
            giftItem = await db.collection('inventory').findOne({
              estado: 'disponible',
              cantidad: { $gte: 1 },
              producto: { $regex: giftRegex, $options: 'i' },
            });
          }
        }
      }

      if (giftItem) {
        const newQty = (giftItem.cantidad || 1) - 1;
        if (newQty <= 0) {
          await db.collection('inventory').updateOne({ id: giftItem.id }, { $set: { cantidad: 0, estado: 'vendido', ventaId: venta_record.id, updatedAt: new Date().toISOString() } });
        } else {
          await db.collection('inventory').updateOne({ id: giftItem.id }, { $set: { cantidad: newQty, updatedAt: new Date().toISOString() } });
        }
        console.log(`[obsequio] Descontado "${giftItem.producto}" del inventario (quedan ${newQty})`);
      } else {
        console.warn(`[obsequio] ⚠️ No se encontró "${finalObsequioNombre}" en inventario para descontar (id: ${finalObsequioInventarioId || 'sin-id'})`);
      }
    }

    // Solo descontar del inventario si es producto PROPIO
    if (Boolean(esPropio) && tipo !== 'servicio') {
      if (inventarioId) {
        // Link directo a un item de inventario
        const invItem = await db.collection('inventory').findOne({ id: inventarioId });
        if (invItem) {
          const newCant = (invItem.cantidad || 1) - 1;
          if (newCant <= 0) {
            await db.collection('inventory').updateOne({ id: inventarioId }, { $set: { cantidad: 0, estado: 'vendido', ventaId: venta_record.id, updatedAt: new Date().toISOString() } });
          } else {
            await db.collection('inventory').updateOne({ id: inventarioId }, { $set: { cantidad: newCant, updatedAt: new Date().toISOString() } });
          }
        }
      } else {
        // Buscar match automático por nombre de producto
        // Primero intentar por IMEI si fue proporcionado
        let invItem: any = null;
        if (imei && String(imei).trim()) {
          invItem = await db.collection('inventory').findOne({
            estado: 'disponible',
            cantidad: { $gte: 1 },
            imei: String(imei).trim(),
          });
        }

        if (!invItem) {
          // Separar storage keywords (128GB, 256GB, etc.) de las demás
          const storageRegex = /\b\d+\s?(?:gb|tb)\b/i;
          const stopWords2 = ['reloj', 'celular', 'telefono', 'tablet', 'obsequio', 'regalo', 'play', 'con'];
          
          const escapedName = makeMatchFriendlyPattern(producto);
          invItem = await db.collection('inventory').findOne({
            estado: 'disponible',
            cantidad: { $gte: 1 },
            producto: { $regex: escapedName, $options: 'i' },
          });
          
          if (!invItem) {
            const allWords = producto.split(/[\s+(),\-]+/g).filter((w: string) => w.length > 0);
            const storageWords = allWords.filter((w: string) => storageRegex.test(w));
            const normalWords = allWords
              .filter((w: string) => !storageRegex.test(w))
              .filter((w: string) => w.length > 2 && !stopWords2.includes(w.toLowerCase()))
              .map((w: string) => makeMatchFriendlyPattern(w));
            const storagePatterns = storageWords.map((w: string) => makeMatchFriendlyPattern(w));
            
            // Los keywords de storage SIEMPRE deben estar en el regex
            const buildRegex = (words: string[]) => [...words, ...storagePatterns].map((w: string) => `(?=.*${w})`).join('');
            
            if (normalWords.length > 0 || storagePatterns.length > 0) {
              let regexPattern = buildRegex(normalWords);
              invItem = await db.collection('inventory').findOne({
                estado: 'disponible',
                cantidad: { $gte: 1 },
                producto: { $regex: regexPattern, $options: 'i' },
              });
              // Fallback: usar solo las primeras 3 palabras normales + storage
              if (!invItem && normalWords.length > 2) {
                const coreKeys = normalWords.slice(0, 3);
                regexPattern = buildRegex(coreKeys);
                invItem = await db.collection('inventory').findOne({
                  estado: 'disponible',
                  cantidad: { $gte: 1 },
                  producto: { $regex: regexPattern, $options: 'i' },
                });
              }
            }
          }
        }
        if (invItem) {
          const newCant = (invItem.cantidad || 1) - 1;
          const ventaUpdate: Record<string, unknown> = { inventarioId: invItem.id };
          // Auto-llenar precioCompra desde inventario si no se envió (compra base = compra sin obsequio)
          const compraBase = Number(precioCompra || 0);
          if (compraBase === 0 && invItem.precioCompra > 0) {
            ventaUpdate.precioCompra = invItem.precioCompra + costoObsequio;
            ventaUpdate.ganancia = venta - (invItem.precioCompra + costoObsequio);
          }
          if (!imei && invItem.imei) ventaUpdate.imei = invItem.imei;
          if (Object.keys(ventaUpdate).length > 0) {
            await db.collection('daily_sales').updateOne({ id: venta_record.id }, { $set: ventaUpdate });
          }
          if (newCant <= 0) {
            await db.collection('inventory').updateOne({ id: invItem.id }, { $set: { cantidad: 0, estado: 'vendido', ventaId: venta_record.id, updatedAt: new Date().toISOString() } });
          } else {
            await db.collection('inventory').updateOne({ id: invItem.id }, { $set: { cantidad: newCant, updatedAt: new Date().toISOString() } });
          }
        }
      }
    }

    // ── Auto-registrar en caja si el pago ya fue recibido ──
    if (venta_record.estadoPago === 'recibido') {
      await crearMovimientosCajaDesdeVenta(
        venta_record.metodoPago,
        venta,
        `Venta: ${producto} — ${cliente}`,
      );
    }

    res.status(201).json(venta_record);
  } catch (error) {
    console.error('[inventario] Error creating venta:', error);
    res.status(500).json({ error: 'Error al registrar venta' });
  }
});

app.put('/api/inventario/ventas/:id', async (req, res) => {
  try {
    const $set: Record<string, unknown> = {};
    const allowed = ['cliente', 'producto', 'imei', 'esPropio', 'proveedor', 'precioCompra', 'precioVenta', 'metodoPago', 'estadoPago', 'fechaEsperada', 'notas', 'tipo'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) $set[key] = req.body[key];
    }
    if ($set.precioCompra !== undefined || $set.precioVenta !== undefined) {
      const current = await db.collection('daily_sales').findOne({ id: req.params.id });
      const pc = Number($set.precioCompra ?? current?.precioCompra ?? 0);
      const pv = Number($set.precioVenta ?? current?.precioVenta ?? 0);
      $set.ganancia = pv - pc;
    }
    await db.collection('daily_sales').updateOne({ id: req.params.id }, { $set });
    const updated = await db.collection('daily_sales').findOne({ id: req.params.id });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar venta' });
  }
});

app.delete('/api/inventario/ventas/:id', async (req, res) => {
  try {
    const venta = await db.collection('daily_sales').findOne({ id: req.params.id });
    if (venta?.inventarioId) {
      await db.collection('inventory').updateOne(
        { id: venta.inventarioId },
        { $set: { estado: 'disponible', ventaId: null, updatedAt: new Date().toISOString() } }
      );
    }
    await db.collection('daily_sales').deleteOne({ id: req.params.id });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar venta' });
  }
});

// --- Resumen del día ---

app.get('/api/inventario/resumen-dia', async (req, res) => {
  try {
    const fecha = (req.query.fecha as string) || new Date().toISOString().slice(0, 10);
    const ventas = await db.collection('daily_sales').find({ fecha }).toArray();
    const gastos = await db.collection('petty_cash').find({ fecha }).toArray();
    const methods = await db.collection('payment_methods').find({ activo: true }).sort({ orden: 1 }).toArray();

    const totalVentas = ventas.reduce((s: number, v: any) => s + v.precioVenta, 0);
    const totalGanancia = ventas.reduce((s: number, v: any) => s + v.ganancia, 0);
    const totalGastos = gastos.reduce((s: number, g: any) => s + g.monto, 0);

    // Per-method breakdown
    const porMetodo: Record<string, { total: number; pendiente: number; recibido: number }> = {};
    for (const m of methods) {
      porMetodo[m.clave] = { total: 0, pendiente: 0, recibido: 0 };
    }
    for (const v of ventas) {
      const key = v.metodoPago || 'efectivo';
      if (!porMetodo[key]) porMetodo[key] = { total: 0, pendiente: 0, recibido: 0 };
      porMetodo[key].total += v.precioVenta;
      if (v.estadoPago === 'pendiente') porMetodo[key].pendiente += v.precioVenta;
      else porMetodo[key].recibido += v.precioVenta;
    }

    // Supplier debts from today (subtracting gift/obsequio cost from purchase price)
    const deudasHoy: Record<string, number> = {};
    for (const v of ventas) {
      if (!v.esPropio && v.proveedor) {
        const costoRealProveedor = v.precioCompra - (v.obsequioCosto || 0);
        deudasHoy[v.proveedor] = (deudasHoy[v.proveedor] || 0) + costoRealProveedor;
      }
    }

    const efectivoRecibido = porMetodo['efectivo']?.recibido || 0;
    const cajaDisponible = efectivoRecibido - totalGastos;

    res.json({
      fecha,
      totalVentas,
      totalGanancia,
      totalGastos,
      cajaDisponible,
      cantidadVentas: ventas.length,
      porMetodo,
      deudasHoy,
    });
  } catch (error) {
    console.error('[inventario] Error resumen:', error);
    res.status(500).json({ error: 'Error al generar resumen' });
  }
});

// --- Resumen del mes (ganancias, ventas, caja) ---

app.get('/api/inventario/resumen-mes', async (req, res) => {
  try {
    const mesParam = req.query.mes as string; // formato YYYY-MM
    const now = new Date();
    const mes = mesParam || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Calcular el mes anterior para comparativas
    const [yr, mn] = mes.split('-').map(Number);
    const prevDate = new Date(yr, mn - 2, 1);
    const prevMes = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

    // 1. Obtener todas las ventas del mes seleccionado
    const ventas = await db.collection('daily_sales').find({
      fecha: { $regex: `^${mes}` },
    }).toArray();

    const totalVentas = ventas.reduce((s: number, v: any) => s + (v.precioVenta || 0), 0);
    const totalGanancia = ventas.reduce((s: number, v: any) => s + (v.ganancia || 0), 0);
    const cantidadVentas = ventas.length;

    // 2. Obtener ventas del mes anterior para comparativa
    const prevVentas = await db.collection('daily_sales').find({
      fecha: { $regex: `^${prevMes}` },
    }).toArray();

    const prevTotalVentas = prevVentas.reduce((s: number, v: any) => s + (v.precioVenta || 0), 0);
    const prevTotalGanancia = prevVentas.reduce((s: number, v: any) => s + (v.ganancia || 0), 0);
    const prevCantidadVentas = prevVentas.length;

    // Calcular porcentajes de cambio (crecimiento)
    const pctVentas = prevTotalVentas > 0 ? Math.round(((totalVentas - prevTotalVentas) / prevTotalVentas) * 100) : 0;
    const pctGanancia = prevTotalGanancia > 0 ? Math.round(((totalGanancia - prevTotalGanancia) / prevTotalGanancia) * 100) : 0;
    const pctCantidad = prevCantidadVentas > 0 ? Math.round(((cantidadVentas - prevCantidadVentas) / prevCantidadVentas) * 100) : 0;

    // 3. Desglose por método de pago (Mes actual)
    const porMetodo: Record<string, number> = {};
    for (const v of ventas) {
      const met = (v.metodoPago || 'efectivo');
      if (met.includes('+')) {
        const partes = met.split('+');
        for (const p of partes) {
          const [cuenta, monto] = p.split(':');
          porMetodo[cuenta] = (porMetodo[cuenta] || 0) + Number(monto || 0);
        }
      } else {
        porMetodo[met] = (porMetodo[met] || 0) + (v.precioVenta || 0);
      }
    }

    // 4. Gastos del mes actual
    const gastos = await db.collection('petty_cash').find({
      fecha: { $regex: `^${mes}` },
    }).toArray();
    const totalGastos = gastos.reduce((s: number, g: any) => s + (g.monto || 0), 0);

    // Gastos del mes anterior
    const prevGastos = await db.collection('petty_cash').find({
      fecha: { $regex: `^${prevMes}` },
    }).toArray();
    const prevTotalGastos = prevGastos.reduce((s: number, g: any) => s + (g.monto || 0), 0);
    const pctGastos = prevTotalGastos > 0 ? Math.round(((totalGastos - prevTotalGastos) / prevTotalGastos) * 100) : 0;

    // 5. Margen de ganancia bruto
    const margenUtilidad = totalVentas > 0 ? Math.round((totalGanancia / totalVentas) * 100) : 0;

    // 6. Desglose por Categoría: Celulares vs Accesorios
    let ventasCelulares = 0, gananciaCelulares = 0, cantCelulares = 0;
    let ventasAccesorios = 0, gananciaAccesorios = 0, cantAccesorios = 0;

    for (const v of ventas) {
      const tieneImei = !!(v.imei && String(v.imei).trim());
      if (tieneImei) {
        ventasCelulares += (v.precioVenta || 0);
        gananciaCelulares += (v.ganancia || 0);
        cantCelulares++;
      } else {
        ventasAccesorios += (v.precioVenta || 0);
        gananciaAccesorios += (v.ganancia || 0);
        cantAccesorios++;
      }
    }

    // 7. Deudas y cuentas por cobrar
    // Deudas a proveedores (activo global)
    const allNonPropioVentas = await db.collection('daily_sales').find({ esPropio: false, proveedor: { $ne: '' } }).toArray();
    let totalDeudasProveedores = 0;
    for (const v of allNonPropioVentas) {
      if (v.proveedor) {
        totalDeudasProveedores += ((v.precioCompra || 0) - (v.obsequioCosto || 0));
      }
    }

    // Cuentas por cobrar CrediLock (cuotas no pagadas de planes activos)
    const activeFinancing = await db.collection('financing').find({ status: 'active' }).toArray();
    let totalCrediLockPendiente = 0;
    for (const f of activeFinancing) {
      const unpaid = (f.cuotas || []).filter((c: any) => !c.pagada);
      totalCrediLockPendiente += unpaid.reduce((sum: number, c: any) => sum + (c.valor || 0), 0);
    }

    // Cuentas por cobrar manuales (ventas con estadoPago: 'pendiente')
    const pendingSales = await db.collection('daily_sales').find({ estadoPago: 'pendiente' }).toArray();
    const totalVentasPendientes = pendingSales.reduce((s: number, v: any) => s + (v.precioVenta || 0), 0);

    // 8. Insights y recomendaciones inteligentes
    const insights: string[] = [];
    if (totalVentas > 0) {
      // Método de pago más popular
      let maxMetodo = '';
      let maxMonto = 0;
      for (const [m, val] of Object.entries(porMetodo)) {
        if (val > maxMonto) {
          maxMonto = val;
          maxMetodo = m;
        }
      }
      if (maxMetodo) {
        const pct = Math.round((maxMonto / totalVentas) * 100);
        insights.push(`El método de pago más utilizado este mes fue **${maxMetodo.toUpperCase()}** con un **${pct}%** de participación ($${maxMonto.toLocaleString('es-CO')} COP).`);
      }

      // Comparativa con el mes anterior
      if (pctVentas > 0) {
        insights.push(`Las ventas crecieron un **${pctVentas}%** respecto al mes anterior. ¡Excelente ritmo de ventas! 📈`);
      } else if (pctVentas < 0) {
        insights.push(`Las ventas disminuyeron un **${Math.abs(pctVentas)}%** respecto a ${prevMes}. Se recomienda revisar promociones o lanzar una campaña de fidelización. ⚠️`);
      }

      // Rentabilidad por categoría
      if (gananciaAccesorios > 0 && totalGanancia > 0) {
        const pctAcc = Math.round((gananciaAccesorios / totalGanancia) * 100);
        const margenAcc = ventasAccesorios > 0 ? Math.round((gananciaAccesorios / ventasAccesorios) * 100) : 0;
        insights.push(`Los accesorios aportaron el **${pctAcc}%** de la ganancia total del mes con un margen bruto de **${margenAcc}%**. ¡Sigue impulsándolos! 🛍️`);
      }

      // Alerta de deudas
      if (totalDeudasProveedores > totalVentas) {
        insights.push(`Alerta: Tu saldo a deber a proveedores ($${totalDeudasProveedores.toLocaleString('es-CO')} COP) supera las ventas de este mes. Controla el flujo de caja.`);
      }

      if (totalCrediLockPendiente > 0) {
        insights.push(`Tienes **$${totalCrediLockPendiente.toLocaleString('es-CO')} COP** pendientes de cobro en cuotas de CrediLock activas. Revisa los recordatorios automáticos.`);
      }
    } else {
      insights.push('Sin ventas registradas todavía este mes para generar insights.');
    }

    res.json({
      mes,
      prevMes,
      totalVentas,
      prevTotalVentas,
      pctVentas,
      totalGanancia,
      prevTotalGanancia,
      pctGanancia,
      totalGastos,
      prevTotalGastos,
      pctGastos,
      gananciaReal: totalGanancia - totalGastos,
      prevGananciaReal: prevTotalGanancia - prevTotalGastos,
      cantidadVentas,
      prevCantidadVentas,
      pctCantidad,
      porMetodo,
      margenUtilidad,
      desgloseCategorias: {
        celulares: { ventas: ventasCelulares, ganancia: gananciaCelulares, cantidad: cantCelulares },
        accesorios: { ventas: ventasAccesorios, ganancia: gananciaAccesorios, cantidad: cantAccesorios },
      },
      deudasSaldos: {
        proveedores: totalDeudasProveedores,
        credilock: totalCrediLockPendiente,
        ventasPendientes: totalVentasPendientes,
      },
      insights,
    });
  } catch (error) {
    console.error('[inventario] Error resumen mes:', error);
    res.status(500).json({ error: 'Error al generar resumen del mes' });
  }
});

// --- Proveedores CRUD ---

app.get('/api/inventario/proveedores', async (_req, res) => {
  try {
    const proveedores = await db.collection('suppliers').find().sort({ nombre: 1 }).toArray();
    res.json(proveedores);
  } catch (error) {
    res.status(500).json({ error: 'Error al cargar proveedores' });
  }
});

app.post('/api/inventario/proveedores', async (req, res) => {
  try {
    const { nombre, telefono, notas } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es requerido' });

    const existing = await db.collection('suppliers').findOne({ nombre: { $regex: new RegExp(`^${nombre.trim()}$`, 'i') } });
    if (existing) return res.status(409).json({ error: 'Ya existe un proveedor con ese nombre' });

    const proveedor = {
      id: crypto.randomUUID(),
      nombre: nombre.trim(),
      telefono: telefono || '',
      notas: notas || '',
      createdAt: new Date().toISOString(),
    };
    await db.collection('suppliers').insertOne(proveedor);
    res.status(201).json(proveedor);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear proveedor' });
  }
});

app.put('/api/inventario/proveedores/:id', async (req, res) => {
  try {
    const { nombre, telefono, notas } = req.body;
    const $set: Record<string, unknown> = {};
    if (nombre !== undefined) $set.nombre = nombre.trim();
    if (telefono !== undefined) $set.telefono = telefono;
    if (notas !== undefined) $set.notas = notas;
    $set.updatedAt = new Date().toISOString();

    await db.collection('suppliers').updateOne({ id: req.params.id }, { $set });
    const updated = await db.collection('suppliers').findOne({ id: req.params.id });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar proveedor' });
  }
});

app.delete('/api/inventario/proveedores/:id', async (req, res) => {
  try {
    await db.collection('suppliers').deleteOne({ id: req.params.id });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar proveedor' });
  }
});

// --- Deudas a proveedores (global) ---

app.get('/api/inventario/deudas-proveedores', async (_req, res) => {
  try {
    const ventas = await db.collection('daily_sales').find({ esPropio: false, proveedor: { $ne: '' } }).toArray();
    const deudas: Record<string, { total: number; ventas: number }> = {};
    for (const v of ventas as any[]) {
      if (!v.proveedor) continue;
      if (!deudas[v.proveedor]) deudas[v.proveedor] = { total: 0, ventas: 0 };
      const costoRealProveedor = v.precioCompra - (v.obsequioCosto || 0);
      deudas[v.proveedor].total += costoRealProveedor;
      deudas[v.proveedor].ventas += 1;
    }
    res.json(deudas);
  } catch (error) {
    res.status(500).json({ error: 'Error al cargar deudas' });
  }
});

// --- Dinero pendiente (en el aire) ---

app.get('/api/inventario/dinero-pendiente', async (_req, res) => {
  try {
    const ventas = await db.collection('daily_sales').find({ estadoPago: 'pendiente' }).sort({ fechaEsperada: 1 }).toArray();
    const porMetodo: Record<string, { total: number; items: any[] }> = {};
    for (const v of ventas as any[]) {
      const key = v.metodoPago;
      if (!porMetodo[key]) porMetodo[key] = { total: 0, items: [] };
      porMetodo[key].total += v.precioVenta;
      porMetodo[key].items.push({ id: v.id, cliente: v.cliente, monto: v.precioVenta, fecha: v.fecha, fechaEsperada: v.fechaEsperada });
    }
    res.json(porMetodo);
  } catch (error) {
    res.status(500).json({ error: 'Error al cargar dinero pendiente' });
  }
});

// Marcar dinero pendiente como recibido → auto-registrar en caja
app.post('/api/inventario/ventas/:id/recibido', async (req, res) => {
  try {
    const sale = await db.collection('daily_sales').findOne({ id: req.params.id });
    if (!sale) return res.status(404).json({ error: 'Venta no encontrada' });

    await db.collection('daily_sales').updateOne(
      { id: req.params.id },
      { $set: { estadoPago: 'recibido' } }
    );

    // Auto-registrar en caja al recibir el pago
    await crearMovimientosCajaDesdeVenta(
      sale.metodoPago || 'efectivo',
      sale.precioVenta,
      `Venta: ${sale.producto} — ${sale.cliente}`,
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error al marcar como recibido' });
  }
});

// --- Caja menor (petty cash / gastos rápidos) ---

app.get('/api/inventario/caja-menor', async (req, res) => {
  try {
    const filter: Record<string, unknown> = {};
    if (req.query.fecha) filter.fecha = req.query.fecha;
    const gastos = await db.collection('petty_cash').find(filter).sort({ createdAt: -1 }).toArray();
    res.json(gastos);
  } catch (error) {
    res.status(500).json({ error: 'Error al cargar gastos' });
  }
});

app.post('/api/inventario/caja-menor', async (req, res) => {
  try {
    const { monto, concepto, tipo } = req.body;
    if (!monto || !concepto) return res.status(400).json({ error: 'Monto y concepto requeridos' });

    const gasto = {
      id: crypto.randomUUID(),
      fecha: new Date().toISOString().slice(0, 10),
      monto: Number(monto),
      concepto,
      tipo: tipo || 'gasto',
      createdAt: new Date().toISOString(),
    };
    await db.collection('petty_cash').insertOne(gasto);
    res.status(201).json(gasto);
  } catch (error) {
    res.status(500).json({ error: 'Error al registrar gasto' });
  }
});

app.delete('/api/inventario/caja-menor/:id', async (req, res) => {
  try {
    await db.collection('petty_cash').deleteOne({ id: req.params.id });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar gasto' });
  }
});

// ====================================================================
// ██████  CAJA — Registro de efectivo y banco  ██████
// ====================================================================

// --- Cuentas CRUD ---
app.get('/api/caja/cuentas', async (_req, res) => {
  try {
    let cuentas = await db.collection('caja_cuentas').find({}).sort({ orden: 1 }).toArray();
    // Seed default accounts if missing
    const DEFAULTS = [
      { id: 'efectivo', nombre: 'Efectivo', color: 'green', orden: 0 },
      { id: 'banco', nombre: 'Banco', color: 'blue', orden: 1 },
      { id: 'datafono', nombre: 'Datáfono', color: 'orange', orden: 2 },
      { id: 'addi', nombre: 'Addi', color: 'purple', orden: 3 },
    ];
    for (const def of DEFAULTS) {
      if (!cuentas.find((c: any) => c.id === def.id)) {
        await db.collection('caja_cuentas').insertOne(def);
      }
    }
    if (cuentas.length < DEFAULTS.length) {
      cuentas = await db.collection('caja_cuentas').find({}).sort({ orden: 1 }).toArray();
    }
    res.json(cuentas);
  } catch (error) {
    console.error('[caja] Error cuentas:', error);
    res.status(500).json({ error: 'Error al obtener cuentas' });
  }
});

app.post('/api/caja/cuentas', async (req, res) => {
  try {
    const { nombre, color } = req.body;
    if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
    const id = nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_');
    const count = await db.collection('caja_cuentas').countDocuments();
    const doc = { id, nombre, color: color || 'purple', orden: count };
    await db.collection('caja_cuentas').insertOne(doc);
    res.status(201).json(doc);
  } catch (error) {
    console.error('[caja] Error crear cuenta:', error);
    res.status(500).json({ error: 'Error al crear cuenta' });
  }
});

app.delete('/api/caja/cuentas/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const protectedAccounts = ['efectivo', 'banco', 'datafono', 'addi'];
    if (protectedAccounts.includes(id)) {
      return res.status(400).json({ error: 'No se puede eliminar cuenta por defecto' });
    }
    await db.collection('caja_cuentas').deleteOne({ id });
    // Also delete movements for this account
    await db.collection('caja_movimientos').deleteMany({ cuenta: id });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar cuenta' });
  }
});

// GET saldos actuales — dynamic per account
app.get('/api/caja/saldos', async (_req, res) => {
  try {
    const cuentas = await db.collection('caja_cuentas').find({}).toArray();
    const movs = await db.collection('caja_movimientos').find({}).toArray();
    const saldos: Record<string, number> = {};
    for (const c of cuentas) saldos[c.id] = 0;
    for (const m of movs) {
      if (!(m.cuenta in saldos)) saldos[m.cuenta] = 0;
      saldos[m.cuenta] += m.tipo === 'egreso' ? -m.monto : m.monto;
    }
    res.json(saldos);
  } catch (error) {
    console.error('[caja] Error saldos:', error);
    res.status(500).json({ error: 'Error al obtener saldos' });
  }
});

// GET movimientos (optional ?cuenta=efectivo|banco, ?limit=50)
app.get('/api/caja/movimientos', async (req, res) => {
  try {
    const filter: any = {};
    if (req.query.cuenta) filter.cuenta = req.query.cuenta;
    const limit = parseInt(req.query.limit as string) || 50;
    const movs = await db.collection('caja_movimientos')
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
    res.json(movs);
  } catch (error) {
    console.error('[caja] Error movimientos:', error);
    res.status(500).json({ error: 'Error al obtener movimientos' });
  }
});

// POST nuevo movimiento
app.post('/api/caja/movimiento', async (req, res) => {
  try {
    const { tipo, cuenta, monto, concepto } = req.body;
    if (!tipo || !cuenta || !monto) {
      return res.status(400).json({ error: 'tipo, cuenta y monto requeridos' });
    }
    const doc = {
      id: crypto.randomUUID(),
      tipo,       // 'ingreso' | 'egreso' | 'ajuste'
      cuenta,     // 'efectivo' | 'banco'
      monto: Number(monto),
      concepto: concepto || '',
      createdAt: new Date().toISOString(),
    };
    await db.collection('caja_movimientos').insertOne(doc);
    res.status(201).json(doc);
  } catch (error) {
    console.error('[caja] Error crear movimiento:', error);
    res.status(500).json({ error: 'Error al crear movimiento' });
  }
});

// POST ajustar saldo — calcula la diferencia y crea un movimiento de ajuste
app.post('/api/caja/ajuste', async (req, res) => {
  try {
    const { cuenta, nuevoSaldo } = req.body;
    if (!cuenta || nuevoSaldo == null) {
      return res.status(400).json({ error: 'cuenta y nuevoSaldo requeridos' });
    }
    // Calculate current balance
    const movs = await db.collection('caja_movimientos').find({ cuenta }).toArray();
    let current = 0;
    for (const m of movs) {
      current += m.tipo === 'egreso' ? -m.monto : m.monto;
    }
    const diff = Number(nuevoSaldo) - current;
    if (diff === 0) return res.json({ message: 'Saldo ya es correcto', saldo: current });

    const doc = {
      id: crypto.randomUUID(),
      tipo: 'ajuste',
      cuenta,
      monto: Math.abs(diff),
      concepto: diff > 0
        ? `Ajuste: se agregaron $${Math.abs(diff).toLocaleString('es-CO')}`
        : `Ajuste: se restaron $${Math.abs(diff).toLocaleString('es-CO')}`,
      createdAt: new Date().toISOString(),
    };
    // If diff is negative, we need an 'egreso' type adjustment
    if (diff < 0) doc.tipo = 'egreso';
    // If diff is positive, tipo stays as 'ajuste' (which adds)

    await db.collection('caja_movimientos').insertOne(doc);
    res.status(201).json({ ...doc, nuevoSaldo: Number(nuevoSaldo) });
  } catch (error) {
    console.error('[caja] Error ajuste:', error);
    res.status(500).json({ error: 'Error al ajustar saldo' });
  }
});

// DELETE movimiento
app.delete('/api/caja/movimiento/:id', async (req, res) => {
  try {
    await db.collection('caja_movimientos').deleteOne({ id: req.params.id });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar movimiento' });
  }
});

// ====================================================================

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
