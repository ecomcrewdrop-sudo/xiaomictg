import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { MongoClient, ObjectId } from 'mongodb';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { Resend } from 'resend';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { createHash, createHmac, timingSafeEqual, randomBytes, scryptSync } from 'crypto';
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
// CrediLock: bloqueo remoto de equipos financiados. Vive en su propio módulo
// porque este archivo ya pasa de 5.600 líneas.
import { registrarBloqueo, alRegistrarPago, alOtorgarProrroga, alAnularProrroga, type DepsBloqueo } from './blocking';
import {
  fechaLarga,
  fechaLimite,
  prorrogaVigente,
  tieneProrroga,
  validarProrroga,
  type Prorroga,
} from './prorroga';
// Portal del cliente y pago en línea de cuotas. Mismo motivo que arriba para que
// viva aparte: son ~1.000 líneas entre lógica, página y rutas.
import {
  asegurarSecretoPortal,
  cerrarSolicitudAlConceder,
  confirmarPagoDeCuotas,
  rechazarPagoDeCuotas,
  registrarPortal,
  type DepsPortal,
} from './portal-rutas';
import { esReferenciaDeCuota, linkPortal } from './portal';
import { type ConfigBold, crearLinkDePago } from './bold-link';
import { type DepsConciliador, conciliarPagos } from './conciliador';
import { diasQueFaltan, tipoDeAviso } from './recordatorios';
import { asegurarCodigoCorto, asegurarIndiceCodigo } from './codigo-corto';

dotenv.config();

// Dominios autorizados a llamar a la API desde un navegador. Antes era '*',
// lo que permitía que cualquier web montara un panel falso contra este
// backend o leyera las respuestas con la sesión del administrador.
// ORIGENES_EXTRA (en Railway, separados por comas) sirve para dar de alta un
// dominio nuevo sin tener que recompilar.
const ORIGENES_PERMITIDOS = new Set([
  'https://xiaomicartagena.com',
  'https://www.xiaomicartagena.com',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  ...(process.env.ORIGENES_EXTRA || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean),
]);

/**
 * Dirección pública de ESTE backend. Es la base de los links que se le mandan al
 * cliente (el portal, la vuelta de la pasarela), así que tiene que ser una URL
 * absoluta y correcta incluso cuando no hay una petición de la que deducirla:
 * el cron de recordatorios arma links sin que nadie haya entrado a nada.
 *
 * `RAILWAY_PUBLIC_DOMAIN` lo pone Railway solo, así que en producción esto
 * acierta sin configurar nada. En local sale `http://localhost:PORT`, que es lo
 * correcto para probar. `PUBLIC_BASE_URL` manda sobre todo lo demás para el día
 * que el backend viva detrás de un dominio propio.
 */
const BASE_PUBLICA: string = (() => {
  const explicita = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (explicita) return explicita;
  const railway = (process.env.RAILWAY_PUBLIC_DOMAIN || '').trim();
  if (railway) return `https://${railway}`;
  return `http://localhost:${process.env.PORT || 3001}`;
})();

/**
 * Dominio que se IMPRIME en la pantalla de un equipo bloqueado, sin esquema.
 *
 * Es otra variable y no `BASE_PUBLICA` porque sirve a un propósito distinto:
 * esto no se toca con el dedo, se lee de una pantalla y se teclea en otro
 * aparato. `xiaomicartagena.com/p/K7M2QX` son 28 caracteres;
 * `xiaomictg-backend-production-66f6.up.railway.app/p/K7M2QX` son 57 y encima
 * tiene un `-66f6` que nadie va a copiar bien. Sin esquema por lo mismo:
 * `https://` son ocho caracteres más que el navegador pone solo.
 *
 * El valor por defecto es el dominio del backend —feo, pero que FUNCIONA—. El
 * bonito exige que `xiaomicartagena.com/p/*` llegue hasta aquí, y hoy lo atiende
 * el Apache de cPanel, que devuelve el index.html del SPA. El `.htaccess` de
 * `public/` ya trae la regla; en cuanto esté subido, se pone
 * `PORTAL_DOMINIO_CORTO=xiaomicartagena.com` y el mensaje de bloqueo se acorta.
 *
 * Antes que al revés: un dominio bonito que no resuelve deja al cliente mirando
 * la tienda en vez de su cuenta, y sin nadie a quien reclamarlo salvo el
 * teléfono que el mismo mensaje le da.
 */
const PORTAL_DOMINIO_CORTO: string = (() => {
  const explicito = (process.env.PORTAL_DOMINIO_CORTO || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  return explicito || BASE_PUBLICA.replace(/^https?:\/\//i, '');
})();

/**
 * Secreto con el que se firman los links del portal del cliente.
 *
 * Vive aquí arriba y no junto a las rutas porque lo usan tres sitios muy
 * separados: las rutas del portal, el cron de recordatorios y el endpoint que
 * le da el link al panel. Lo llena `asegurarSecretoPortal` al conectar a Mongo
 * (ver `connectDB`), así que antes de eso está vacío: `tokenPortal` devuelve
 * `null` con secreto vacío y los mensajes salen sin link en lugar de salir con
 * un link roto.
 */
let secretoPortal = '';

// Sin cabecera Origin (curl, el webhook de Bold, monitores) no hay nada que
// restringir: CORS sólo protege a los navegadores. Se deja pasar para no
// romper las integraciones servidor a servidor.
function esOrigenPermitido(origin?: string): boolean {
  if (!origin) return true;
  return ORIGENES_PERMITIDOS.has(origin);
}

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: (origin, cb) => cb(null, esOrigenPermitido(origin || undefined)),
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

    // El secreto del portal se resuelve ANTES de anunciar que la base está
    // lista, porque el cron de recordatorios y el panel ya pueden pedir links
    // en cuanto haya `db`. Si fallara, se registra y se sigue: el portal queda
    // inaccesible, pero la tienda entera no se cae por eso.
    try {
      secretoPortal = await asegurarSecretoPortal(db);
    } catch (err) {
      console.error('[portal] No se pudo resolver el secreto del portal:', err);
    }

    console.log('[server] MongoDB ready');
    // Inicializar WhatsApp con sesión persistente en MongoDB
    whatsappService.init(db, io).catch(err => console.error('[WA] Error en init:', err));

    // CREDILOCK va por un número aparte. Solo la levantamos sola si YA está
    // emparejada; si no, Baileys se pondría a pedir QR en bucle contra el servidor
    // de WhatsApp sin que nadie lo escanee. Queda esperando a que el admin pulse
    // Conectar en el panel de financiamiento.
    credilockService.tieneCredenciales(db)
      .then(emparejada => {
        if (emparejada) {
          return credilockService.init(db, io);
        }
        console.warn('[CREDILOCK-WA] ⚠️ Sin sesión emparejada. Los recordatorios de cuotas NO se enviarán ' +
          'hasta que se escanee el QR en Admin → Financiamiento.');
      })
      .catch(err => console.error('[CREDILOCK-WA] Error en init:', err));
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
  // El único sitio donde se decide que dos clientes no comparten código corto.
  // Se crea aquí y no al asignar el primero porque un índice único creado a
  // mitad de la carrera que pretende arbitrar no arbitra nada.
  await asegurarIndiceCodigo(db);
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

/**
 * Auth state de Baileys guardado en MongoDB (sin archivos en disco).
 *
 * `coleccion` es un parámetro porque ahora hay DOS sesiones de WhatsApp en
 * paralelo: la de la tienda ('whatsappAuth') y la de CREDILOCK ('credilockAuth').
 * Cada una tiene su propio número emparejado, así que sus credenciales NO pueden
 * compartir colección: se sobrescribirían entre ellas y ninguna quedaría estable.
 */
async function useMongoAuthState(dbRef: any, logger: any, coleccion: string) {
  const col = dbRef.collection(coleccion);

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

/**
 * ¿Estas credenciales corresponden a un teléfono ya emparejado?
 *
 * CUIDADO CON `creds.registered`: parece el campo obvio, pero en Baileys solo lo
 * pone a true el flujo de emparejamiento por CÓDIGO (registerPhoneNumber). Si
 * emparejas escaneando el QR —que es lo que hacemos— `registered` se queda en
 * FALSE para siempre y en cambio se rellenan `me` y `account`. Verificado contra
 * producción: la sesión de la tienda lleva meses funcionando con
 * me.id = '573022875280:24@s.whatsapp.net' y registered = false.
 *
 * Esto no es un detalle menor: mirar `registered` hacía que al morir la sesión
 * (401) el código creyera que las credenciales ya estaban limpias, NO las borrara,
 * y tras 5 intentos se rindiera con 'blocked_401' sin volver a emitir un QR nunca
 * más. Es la causa más probable de que los recordatorios estuvieran dos meses
 * caídos sin que nadie lo notara.
 */
function credencialesEmparejadas(creds: any): boolean {
  return Boolean(creds?.me?.id || creds?.account);
}

/**
 * Normaliza un teléfono colombiano a '57XXXXXXXXXX'. Devuelve null si no hay
 * ningún número utilizable en el campo.
 *
 * POR QUÉ EXISTE: en la colección 'financing' hay campos con DOS números metidos
 * en el mismo string ('3233993505/ 3053652200', '3011091384 / 3244415347') y alguno
 * de 11 dígitos ('30168337929'). Antes se limpiaban solo los espacios y guiones, así
 * que los dos números quedaban PEGADOS en un JID basura; el envío no fallaba rápido,
 * se quedaba colgado hasta el timeout y frenaba la cola entera. Eso es parte de lo
 * que retrasó los avisos el 2026-09-30.
 *
 * Nos quedamos con el primer número que sí sirve. Si ninguno sirve devolvemos null
 * para que quien llame decida saltarse ese registro en vez de colgar la cola.
 */
function normalizarTelefonoCo(phone: unknown): string | null {
  const sinAdornos = String(phone ?? '').replace(/[\s\-\+\(\)\.]/g, '');
  // Partimos por cualquier cosa que no sea dígito: así '3233993505/3053652200'
  // se convierte en dos candidatos en vez de un número de 20 cifras.
  for (let trozo of sinAdornos.split(/\D+/).filter(Boolean)) {
    if (trozo.startsWith('0')) trozo = trozo.slice(1);
    if (trozo.length === 12 && trozo.startsWith('57')) return trozo;
    // Los móviles colombianos son 10 dígitos y empiezan por 3.
    if (trozo.length === 10 && trozo.startsWith('3')) return '57' + trozo;
  }
  return null;
}

/**
 * Identidad de una sesión de WhatsApp. Antes todo esto estaba hardcodeado dentro
 * de la clase; ahora es configuración porque corren DOS sesiones a la vez y cada
 * una necesita su propia colección de credenciales y sus propios eventos de
 * Socket.io (si compartieran eventos, el QR de CREDILOCK aparecería en el panel
 * de la tienda y viceversa).
 */
interface WASessionConfig {
  /** Identificador corto, va en la respuesta de /api/health. */
  id: string;
  /** Nombre legible para los mensajes de error del panel. */
  etiqueta: string;
  /** Colección de MongoDB donde viven las credenciales de ESTA sesión. */
  coleccionAuth: string;
  /** Prefijo de los console.log, para poder distinguirlas en los logs de Railway. */
  tagLog: string;
  /** Evento de Socket.io con el QR nuevo. */
  eventoQR: string;
  /** Evento de Socket.io con los cambios de estado. */
  eventoEstado: string;
}

class WhatsAppService {
  private sock: ReturnType<typeof makeWASocket> | null = null;
  private status: WAStatus = 'disconnected';
  private qrDataUrl: string | null = null;
  private ioRef: Server | null = null;
  private dbRef: any = null;
  private reconnecting = false;
  private fatalRetries = 0;
  /** Número emparejado, en formato '57XXXXXXXXXX'. Null mientras no haya sesión. */
  private numero: string | null = null;
  private readonly cfg: WASessionConfig;
  /**
   * Temporizador de reconexión pendiente.
   *
   * Lo guardamos para poder CANCELARLO en disconnect(). Antes no se guardaba, así
   * que al desconectar quedaba un setTimeout en vuelo que volvía a llamar a
   * _connect() unos segundos después: la sesión «desconectada» revivía sola y
   * seguía pidiendo QR. disconnect() no era realmente definitivo.
   */
  private reconnectTimer: NodeJS.Timeout | null = null;
  /**
   * QRs emitidos desde el último emparejamiento correcto.
   *
   * Sirve para cortar el bucle de QR sin escanear: Baileys regenera un QR cada
   * ~20 s indefinidamente, así que si alguien pulsa Conectar y se marcha, el
   * servidor se queda pidiendo QR a WhatsApp para siempre desde una IP de centro
   * de datos. Eso es justo lo que acaba en un rechazo por IP (el estado
   * 'blocked_' que ya contempla este código). Tras MAX_QR_SIN_ESCANEAR paramos y
   * dejamos que el admin pulse Conectar otra vez.
   */
  private qrEmitidos = 0;
  private static readonly MAX_QR_SIN_ESCANEAR = 10;

  constructor(cfg: WASessionConfig) {
    this.cfg = cfg;
  }

  getStatus(): WAStatus { return this.status; }
  getQRDataUrl(): string | null { return this.qrDataUrl; }
  getNumero(): string | null { return this.numero; }
  getConfig(): WASessionConfig { return this.cfg; }

  /**
   * Resumen para /api/health, que NO lleva autenticación.
   *
   * A propósito sin el número completo: el de cobranza es un número interno y no
   * hay por qué publicarlo en un endpoint que cualquiera puede consultar. Para
   * monitorizar basta con saber si está vivo; los 4 últimos dígitos permiten
   * confirmar cuál es sin exponerlo entero.
   */
  getInfoSalud() {
    return {
      id: this.cfg.id,
      status: this.status,
      conectado: this.status === 'connected',
      numeroParcial: this.numero ? `***${this.numero.slice(-4)}` : null,
    };
  }

  /**
   * ¿Existen credenciales guardadas para esta sesión?
   *
   * Hace falta para el arranque de CREDILOCK: si la sesión nunca se ha emparejado
   * no queremos levantarla sola, porque Baileys se pondría a regenerar QR cada pocos
   * segundos contra el servidor de WhatsApp sin que nadie lo vaya a escanear. Mejor
   * quedarse quieto hasta que el admin pulse Conectar en el panel.
   */
  async tieneCredenciales(dbInstance: any): Promise<boolean> {
    try {
      const doc = await dbInstance.collection(this.cfg.coleccionAuth).findOne({ _id: 'creds' as any });
      if (!doc?.value) return false;
      // Un doc de 'creds' puede existir sin que el teléfono se haya emparejado nunca,
      // porque Baileys guarda sus claves antes del escaneo. Lo que confirma el
      // emparejamiento es `me`/`account`, NO `registered` (ver credencialesEmparejadas).
      return credencialesEmparejadas(JSON.parse(doc.value, BufferJSON.reviver));
    } catch {
      return false;
    }
  }

  async init(dbInstance: any, ioInstance: Server) {
    this.dbRef = dbInstance;
    this.ioRef = ioInstance;
    if (this.reconnecting) return;
    this.fatalRetries = 0; // reintento manual: permitimos de nuevo los 5 intentos
    this.qrEmitidos = 0;   // y la tanda de QR empieza de cero
    await this._connect();
  }

  /** Programa un reintento, guardando el temporizador para poder cancelarlo. */
  private _reintentarEn(ms: number) {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnecting = true;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnecting = false;
      this._connect();
    }, ms);
  }

  private async _connect() {
    try {
      this.status = 'loading';
      this.ioRef?.emit(this.cfg.eventoEstado, { status: 'loading' });

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

      const { state, saveCreds } = await useMongoAuthState(this.dbRef, silentLogger, this.cfg.coleccionAuth);

      // Versión de protocolo de WhatsApp Web. Si la omitimos, Baileys usa la que trae
      // hardcodeada y WhatsApp rechaza la conexión con código 405 cuando queda vieja.
      let waVersion: [number, number, number] | undefined;
      try {
        const fetchVersion = (fetchLatestBaileysVersion as any).default || fetchLatestBaileysVersion;
        const { version, isLatest } = await fetchVersion();
        waVersion = version;
        console.log(this.cfg.tagLog, 'Versión de protocolo WA:', version.join('.'), '| última:', isLatest);
      } catch (e) {
        console.warn(this.cfg.tagLog, 'No se pudo obtener la versión más reciente, se usa la interna de Baileys:', (e as any)?.message);
      }

      // Baileys puede ser un modulo CommonJS tradicional o ESM
      const makeSocket = (makeWASocket as any).default || makeWASocket;
      this.sock = makeSocket({
        ...(waVersion ? { version: waVersion } : {}),
        auth: { creds: state.creds, keys: state.keys },
        logger: silentLogger,
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Chrome', '120.0.0.0'],
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        generateHighQualityLinkPreview: false,
        markOnlineOnConnect: false,
        syncFullHistory: false,
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (qr) {
          this.qrEmitidos++;
          if (this.qrEmitidos > WhatsAppService.MAX_QR_SIN_ESCANEAR) {
            // Nadie está escaneando. Cortamos en seco para no seguir martilleando
            // a WhatsApp desde la IP de Railway.
            console.warn(this.cfg.tagLog, `⏹️ ${this.qrEmitidos - 1} QR emitidos sin que nadie los escanee. ` +
              'Se detiene el bucle; hay que pulsar Conectar de nuevo.');
            this.status = 'disconnected';
            this.qrDataUrl = null;
            this.ioRef?.emit(this.cfg.eventoEstado, { status: 'disconnected', error: 'qr_sin_escanear' });
            if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
            this.reconnecting = false;
            try {
              this.sock?.ev.removeAllListeners();
              if (this.sock?.ws) this.sock.ws.close();
            } catch {}
            this.sock = null;
            return;
          }
          try {
            const dataUrl = await QRCode.toDataURL(qr, { margin: 2, width: 280 });
            this.qrDataUrl = dataUrl;
            this.status = 'qr_ready';
            this.ioRef?.emit(this.cfg.eventoQR, { qr: dataUrl });
            console.log(this.cfg.tagLog, `QR generado y emitido (${this.qrEmitidos}/${WhatsAppService.MAX_QR_SIN_ESCANEAR})`);
          } catch (e) {
            console.error(this.cfg.tagLog, 'Error generando QR:', e);
          }
        }

        if (connection === 'open') {
          this.status = 'connected';
          this.qrDataUrl = null;
          this.reconnecting = false;
          this.fatalRetries = 0;
          this.qrEmitidos = 0; // emparejado: la cuenta de QR vuelve a cero
          // sock.user.id llega como '573001234567:12@s.whatsapp.net'. Nos quedamos
          // solo con el número para poder mostrarlo en el panel y que el admin
          // confirme de un vistazo que emparejó el teléfono correcto.
          this.numero = String(this.sock?.user?.id || '').split(':')[0].split('@')[0] || null;
          this.ioRef?.emit(this.cfg.eventoEstado, { status: 'connected', numero: this.numero });
          console.log(this.cfg.tagLog, '✅ Conectado exitosamente', this.numero ? `como ${this.numero}` : '');
        }

        if (connection === 'close') {
          const code = (lastDisconnect?.error as any)?.output?.statusCode;
          // Códigos que significan "esta sesión ya no sirve, hay que emparejar de nuevo".
          // 401 loggedOut · 403 forbidden · 405 (versión/registro rechazado) · 411 multideviceMismatch · 500 badSession
          const DEAD_SESSION_CODES = [401, 403, 405, 411, 500];
          const isDeadSession = DEAD_SESSION_CODES.includes(code);
          const hadCreds = credencialesEmparejadas(state?.creds);
          this.status = 'disconnected';
          this.qrDataUrl = null;
          this.numero = null;
          this.ioRef?.emit(this.cfg.eventoEstado, { status: 'disconnected' });
          console.log(this.cfg.tagLog, 'Conexión cerrada — código:', code, '| sesión muerta:', isDeadSession, '| registrada:', hadCreds);

          if (isDeadSession && hadCreds) {
            // Solo limpiamos si REALMENTE había una sesión emparejada. Si no la había,
            // borrar de nuevo no aporta nada y provocaría un bucle infinito de limpieza.
            console.log(this.cfg.tagLog, '🧹 Sesión caducada o inválida. Limpiando credenciales en base de datos...');
            try {
              if (this.dbRef) await this.dbRef.collection(this.cfg.coleccionAuth).deleteMany({});
            } catch (err) {
              console.error(this.cfg.tagLog, 'Error limpiando credenciales:', err);
            }
            // Reconectamos para que Baileys emita un QR nuevo sin intervención manual.
            this._reintentarEn(5000);
            return;
          }

          if (isDeadSession && !hadCreds) {
            // Credenciales limpias y aun así nos rechazan: no es la sesión, es el servidor/IP/versión.
            this.fatalRetries++;
            if (this.fatalRetries >= 5) {
              console.error(this.cfg.tagLog + ' ⛔ WhatsApp rechaza la conexión (código ' + code + ') con credenciales limpias tras ' +
                this.fatalRetries + ' intentos. Se detiene el bucle. Causa probable: versión de protocolo o IP bloqueada.');
              this.ioRef?.emit(this.cfg.eventoEstado, { status: 'disconnected', error: 'blocked_' + code });
              return;
            }
          }

          this._reintentarEn(8000);
        }
      });
    } catch (err) {
      console.error(this.cfg.tagLog, 'Error fatal al inicializar Baileys:', err);
      // Blindaje supremo: si las credenciales en MongoDB estan corruptas o son incompatibles,
      // limpiamos la coleccion de auth para forzar una sesion limpia en el siguiente reintento.
      try {
        if (this.dbRef) {
          await this.dbRef.collection(this.cfg.coleccionAuth).deleteMany({});
          console.log(this.cfg.tagLog, `🧹 Colección ${this.cfg.coleccionAuth} limpiada automáticamente por credenciales corruptas.`);
        }
      } catch (cleanErr) {
        console.error(this.cfg.tagLog, 'Error al limpiar colección tras fallo:', cleanErr);
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
      console.log(this.cfg.tagLog, 'Mensaje enviado a', phone, imageUrl ? 'con imagen' : '');
      return true;
    } catch (err) {
      console.error(this.cfg.tagLog, 'Error al enviar mensaje:', err);
      return false;
    }
  }

  _formatPhone(phone: string): string {
    // Ruta buena: un móvil colombiano reconocible (ver normalizarTelefonoCo).
    const normalizado = normalizarTelefonoCo(phone);
    if (normalizado) return normalizado + '@s.whatsapp.net';

    // Si no lo reconocemos NO lo descartamos aquí: por este método también pasan
    // fijos y números de fuera, y romperlos sería peor. Se mantiene el
    // comportamiento de siempre y que decida WhatsApp.
    let clean = String(phone).replace(/[\s\-\+\(\)\.]/g, '');
    if (clean.startsWith('0')) clean = clean.slice(1);
    if (clean.length === 10 && !clean.startsWith('57')) clean = '57' + clean;
    return clean + '@s.whatsapp.net';
  }

  async disconnect() {
    // Lo PRIMERO es matar el reintento pendiente. Si no, el setTimeout en vuelo
    // resucita la sesión unos segundos después de haberla desconectado.
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      if (this.sock) {
        this.sock.ev.removeAllListeners();
        await this.sock.logout().catch(() => {});
        this.sock = null;
      }
      if (this.dbRef) {
        await this.dbRef.collection(this.cfg.coleccionAuth).deleteMany({});
      }
    } catch (e) {
      console.error(this.cfg.tagLog, 'Error al desconectar:', e);
    }
    this.status = 'disconnected';
    this.qrDataUrl = null;
    this.numero = null;
    this.reconnecting = false;
    this.fatalRetries = 0;
    this.qrEmitidos = 0;
    this.ioRef?.emit(this.cfg.eventoEstado, { status: 'disconnected' });
  }
}

/** Sesión de la TIENDA: confirmaciones de pedido, alertas de stock, campañas. */
const whatsappService = new WhatsAppService({
  id: 'tienda',
  etiqueta: 'WhatsApp de la tienda',
  coleccionAuth: 'whatsappAuth',
  tagLog: '[WA]',
  eventoQR: 'whatsapp-qr',
  eventoEstado: 'whatsapp-status',
});

/**
 * Sesión de CREDILOCK: recordatorios de cuotas y avisos de mora.
 *
 * Va por un número aparte porque lo pidió el dueño: los avisos de cobro son
 * conversaciones delicadas y de mucho volumen (109 financiaciones activas), así
 * que conviene aislarlas del número comercial. Si WhatsApp llegara a restringir
 * el número de cobranza, la tienda sigue vendiendo con normalidad.
 */
const credilockService = new WhatsAppService({
  id: 'credilock',
  etiqueta: 'WhatsApp de CREDILOCK',
  coleccionAuth: 'credilockAuth',
  tagLog: '[CREDILOCK-WA]',
  eventoQR: 'credilock-qr',
  eventoEstado: 'credilock-status',
});

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

💰 *Total:* \${{total}} COP
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

    // El timeout es solo para no dejar colgada esta función: cuando salta, Baileys
    // sigue entregando el mensaje por su cuenta. Por eso el log dice "sin confirmar"
    // y no "fallido" — antes decía false y despistaba, porque el mensaje SÍ llegaba.
    // Aquí no se reintenta nada a propósito: un reintento duplicaría el aviso.
    const TIMEOUT_AVISO_MS = 30000;

    // PRIMERO EL DUEÑO. Antes iba primero el cliente, y como entre los dos envíos hay
    // 3 s de cortesía (más lo que tardara el del cliente, hasta el timeout), el aviso
    // de venta nueva siempre salía el último. Si el número del cliente es inválido o
    // no tiene WhatsApp, el envío se queda colgado y el dueño se comía toda la espera.
    // El aviso al dueño es el crítico para el negocio, así que va primero.
    if (ownerPhone) {
      const msg = processWhatsAppTemplate(ownerTemplate, order);
      console.log(`[WA] Enviando al administrador: ${ownerPhone}`);
      const success = await Promise.race([
        whatsappService.sendMessage(ownerPhone, msg),
        new Promise(resolve => setTimeout(() => resolve(false), TIMEOUT_AVISO_MS))
      ]);
      console.log(`[WA] Admin ${ownerPhone}: ${success ? 'confirmado' : 'despachado SIN confirmar (Baileys lo entregará)'}`);
      if (customerPhone) {
        // Pequeño delay para evitar bloqueo por spam (error 401)
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    if (customerPhone) {
      const msg = processWhatsAppTemplate(customerTemplate, order);
      console.log(`[WA] Enviando al cliente: ${customerPhone}`);
      const success = await Promise.race([
        whatsappService.sendMessage(customerPhone, msg),
        new Promise(resolve => setTimeout(() => resolve(false), TIMEOUT_AVISO_MS))
      ]);
      console.log(`[WA] Cliente ${customerPhone}: ${success ? 'confirmado' : 'despachado SIN confirmar (Baileys lo entregará)'}`);
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

app.use(cors({
  // cb(null, false) simplemente no añade las cabeceras CORS y el navegador
  // bloquea la respuesta. Devolver un Error aquí daría un 500 y ensuciaría
  // los logs con algo que no es un fallo del servidor.
  origin: (origin, cb) => cb(null, esOrigenPermitido(origin)),
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));

// Cabeceras de seguridad básicas. No se usa helmet para no añadir una
// dependencia: el backend sólo sirve JSON y la página de /api/bold-checkout,
// así que con estas cuatro se cubre lo que aplica.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // La API no debe quedar guardada en cachés intermedias: hay respuestas con
  // pedidos y teléfonos de clientes.
  res.setHeader('Cache-Control', 'no-store');
  next();
});

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
    uptimeSeconds: Math.round(process.uptime()),
    // Las dos sesiones de WhatsApp van aquí para poder comprobar de un curl si los
    // recordatorios de CREDILOCK están vivos. La de la tienda cayéndose se nota
    // enseguida (no salen las confirmaciones de pedido); la de CREDILOCK puede estar
    // muerta meses sin que nadie lo vea, que es justo lo que pasó.
    whatsapp: {
      tienda: whatsappService.getInfoSalud(),
      credilock: credilockService.getInfoSalud(),
    },
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

// ---------------------------------------------------------------------------
// Autenticación
//
// Antes el token era la cadena 'admin-token-' + Date.now(): cualquiera podía
// fabricarse uno, pero daba igual porque además NINGUNA ruta lo comprobaba.
// El panel entero (pedidos, caja, inventario, teléfonos de clientes) estaba
// abierto a quien supiera la URL del backend. Lo que sigue arregla las dos
// mitades: tokens firmados que no se pueden falsificar y un middleware que
// los exige en todo lo que no sea explícitamente público.
// ---------------------------------------------------------------------------

// El secreto de firma. Si no está definido se deriva de las credenciales de
// admin en lugar de usar un valor por defecto fijo: un secreto por defecto en
// el código fuente no es un secreto. Derivarlo tiene un efecto secundario
// deseable: al cambiar la contraseña caducan todas las sesiones abiertas.
const AUTH_SECRET: string = (() => {
  const explicito = (process.env.AUTH_SECRET || '').trim();
  if (explicito.length >= 32) return explicito;
  if (explicito) {
    console.warn('[auth] AUTH_SECRET es demasiado corto (mínimo 32 caracteres); se ignora.');
  }
  if (ADMIN_USER && ADMIN_PASSWORD) {
    console.warn('[auth] AUTH_SECRET no está configurada: se deriva de las credenciales de admin. Define AUTH_SECRET en Railway.');
    return createHash('sha256').update(`${ADMIN_USER}:${ADMIN_PASSWORD}:xiaomictg`).digest('hex');
  }
  // Sin nada de dónde derivar, se genera uno al azar en cada arranque: el
  // panel sigue funcionando pero las sesiones no sobreviven a un reinicio.
  console.error('[auth] No hay AUTH_SECRET ni credenciales de admin: las sesiones se invalidarán en cada reinicio.');
  return randomBytes(32).toString('hex');
})();

const TOKEN_VIGENCIA_MS = 12 * 60 * 60 * 1000; // 12 h: una jornada de tienda

function base64url(valor: Buffer | string): string {
  return Buffer.from(valor as any)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function desdeBase64url(valor: string): Buffer {
  return Buffer.from(valor.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

interface SesionAdmin {
  usuario: string;
  rol: string;
  exp: number;
}

function firmarToken(usuario: string, rol: string): string {
  const cuerpo: SesionAdmin = { usuario, rol, exp: Date.now() + TOKEN_VIGENCIA_MS };
  const cuerpoCodificado = base64url(JSON.stringify(cuerpo));
  const firma = base64url(createHmac('sha256', AUTH_SECRET).update(cuerpoCodificado).digest());
  return `${cuerpoCodificado}.${firma}`;
}

function verificarToken(token: string): SesionAdmin | null {
  if (!token || typeof token !== 'string') return null;
  const partes = token.split('.');
  if (partes.length !== 2) return null;
  const [cuerpoCodificado, firmaRecibida] = partes;

  const firmaEsperada = base64url(createHmac('sha256', AUTH_SECRET).update(cuerpoCodificado).digest());
  const bufRecibida = Buffer.from(firmaRecibida, 'utf8');
  const bufEsperada = Buffer.from(firmaEsperada, 'utf8');
  if (bufRecibida.length !== bufEsperada.length) return null;
  if (!timingSafeEqual(bufRecibida, bufEsperada)) return null;

  try {
    const cuerpo = JSON.parse(desdeBase64url(cuerpoCodificado).toString('utf8')) as SesionAdmin;
    if (!cuerpo?.usuario || typeof cuerpo.exp !== 'number') return null;
    if (Date.now() > cuerpo.exp) return null;
    return cuerpo;
  } catch {
    return null;
  }
}

// Socket.io también exige sesión. Por estos sockets se emiten los QR de
// WhatsApp ('whatsapp-qr', 'credilock-qr'): quien escanee uno se queda con la
// sesión de WhatsApp de la tienda. Antes cualquiera podía conectarse y
// quedarse escuchando. Sólo los conecta el panel, así que no rompe la tienda.
io.use((socket, next) => {
  const token = (socket.handshake.auth as any)?.token || '';
  if (verificarToken(String(token))) return next();
  console.warn(`[socket] Conexión rechazada sin sesión válida (${socket.handshake.address}).`);
  next(new Error('No autorizado'));
});

// Comparación en tiempo constante de dos cadenas de longitud distinta.
// Se hashean antes para que los buffers midan siempre lo mismo y la propia
// longitud de la contraseña no se filtre por el tiempo de respuesta.
function igualSeguro(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

// Contraseñas de la colección `users`.
// Formato nuevo: scrypt$<sal>$<hash>. Se mantiene la verificación del SHA-256
// antiguo (64 hexadecimales) para no dejar fuera a los usuarios ya creados,
// pero se ha quitado la comparación en texto plano que había antes: aceptaba
// como válida una contraseña guardada sin cifrar.
function hashPasswordScrypt(plain: string, sal?: string): string {
  const salUsada = sal || randomBytes(16).toString('hex');
  const derivada = scryptSync(plain, salUsada, 64).toString('hex');
  return `scrypt$${salUsada}$${derivada}`;
}

function verificarPassword(plain: string, almacenada: unknown): boolean {
  if (typeof almacenada !== 'string' || !almacenada) return false;

  if (almacenada.startsWith('scrypt$')) {
    const [, sal, hash] = almacenada.split('$');
    if (!sal || !hash) return false;
    try {
      const derivada = scryptSync(plain, sal, 64).toString('hex');
      return igualSeguro(derivada, hash);
    } catch {
      return false;
    }
  }

  // Formato antiguo: SHA-256 sin sal.
  if (/^[a-f\d]{64}$/i.test(almacenada)) {
    return igualSeguro(hashPassword(plain), almacenada);
  }

  // Cualquier otra cosa es una contraseña en texto plano guardada en la base
  // de datos. No se acepta: hay que regenerarla con hashPasswordScrypt.
  console.error('[login] El usuario tiene la contraseña sin cifrar en la base de datos; se rechaza el acceso.');
  return false;
}

// Límite de intentos de login por IP. En memoria, sin dependencias: con un
// solo proceso en Railway es suficiente, y lo que evita es que alguien pruebe
// contraseñas a miles por minuto contra /api/login.
const INTENTOS_MAX = 8;
const VENTANA_INTENTOS_MS = 15 * 60 * 1000;
const BLOQUEO_MS = 15 * 60 * 1000;
const intentosLogin = new Map<string, { fallos: number; primero: number; bloqueadoHasta: number }>();

function ipDe(req: express.Request): string {
  // Railway va detrás de un proxy, así que req.ip es la IP del proxy.
  const reenviada = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return reenviada || req.ip || 'desconocida';
}

function loginBloqueado(ip: string): number {
  const registro = intentosLogin.get(ip);
  if (!registro) return 0;
  if (registro.bloqueadoHasta > Date.now()) return registro.bloqueadoHasta - Date.now();
  return 0;
}

function anotarFalloLogin(ip: string): void {
  const ahora = Date.now();
  const registro = intentosLogin.get(ip);
  if (!registro || ahora - registro.primero > VENTANA_INTENTOS_MS) {
    intentosLogin.set(ip, { fallos: 1, primero: ahora, bloqueadoHasta: 0 });
    return;
  }
  registro.fallos += 1;
  if (registro.fallos >= INTENTOS_MAX) {
    registro.bloqueadoHasta = ahora + BLOQUEO_MS;
    registro.fallos = 0;
    registro.primero = ahora;
    console.warn(`[login] IP ${ip} bloqueada ${BLOQUEO_MS / 60000} minutos por intentos fallidos.`);
  }
}

function limpiarIntentos(ip: string): void {
  intentosLogin.delete(ip);
}

// El Map no debe crecer sin límite si alguien rota IPs: se purgan las entradas
// que ya no están bloqueadas y cuya ventana ha expirado.
setInterval(() => {
  const ahora = Date.now();
  for (const [ip, registro] of intentosLogin) {
    if (registro.bloqueadoHasta < ahora && ahora - registro.primero > VENTANA_INTENTOS_MS) {
      intentosLogin.delete(ip);
    }
  }
}, 10 * 60 * 1000).unref();

// Login: variables de entorno (Railway) o colección users (MongoDB)
app.post('/api/login', async (req, res) => {
  const ip = ipDe(req);
  const restante = loginBloqueado(ip);
  if (restante > 0) {
    return res.status(429).json({
      success: false,
      message: `Demasiados intentos fallidos. Espera ${Math.ceil(restante / 60000)} minutos.`,
    });
  }

  const { username, password } = req.body || {};

  if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ success: false, message: 'Usuario y contraseña requeridos' });
  }

  const user = username.trim();
  const pass = password;

  if (ADMIN_USER && ADMIN_PASSWORD) {
    if (igualSeguro(user, ADMIN_USER.trim()) && igualSeguro(pass, ADMIN_PASSWORD.trim())) {
      limpiarIntentos(ip);
      return res.json({
        success: true,
        token: firmarToken(user, 'admin'),
        user: { username: user, role: 'admin' },
      });
    }
  }

  if (!db) {
    anotarFalloLogin(ip);
    return res.status(401).json({ success: false, message: 'Credenciales incorrectas' });
  }

  try {
    const dbUser = await db.collection('users').findOne({ username: user });

    if (dbUser && verificarPassword(pass, dbUser.password)) {
      // Migración silenciosa: si la contraseña seguía en SHA-256 se reescribe
      // con scrypt ahora que la tenemos en claro y ya validada.
      if (!String(dbUser.password || '').startsWith('scrypt$')) {
        db.collection('users')
          .updateOne({ _id: dbUser._id }, { $set: { password: hashPasswordScrypt(pass) } })
          .catch(err => console.error('[login] No se pudo migrar la contraseña a scrypt:', err));
      }
      limpiarIntentos(ip);
      return res.json({
        success: true,
        token: firmarToken(dbUser.username, dbUser.role || 'admin'),
        user: { username: dbUser.username, role: dbUser.role || 'admin' },
      });
    }
  } catch (error) {
    console.error('[login] Error:', error);
    return res.status(500).json({ success: false, message: 'Error del servidor' });
  }

  anotarFalloLogin(ip);
  return res.status(401).json({ success: false, message: 'Credenciales incorrectas' });
});

// Limitador genérico por IP, para las rutas que escriben en la base de datos
// sin pedir sesión (pedidos, reseñas, avisos de stock). Sin esto cualquiera
// puede meter documentos en Mongo en bucle: no roba nada, pero llena la base
// de basura y deja el panel inservible.
function limitadorPorIp(nombre: string, maximo: number, ventanaMs: number) {
  const registro = new Map<string, { usos: number; desde: number }>();

  setInterval(() => {
    const ahora = Date.now();
    for (const [ip, dato] of registro) {
      if (ahora - dato.desde > ventanaMs) registro.delete(ip);
    }
  }, ventanaMs).unref();

  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = ipDe(req);
    const ahora = Date.now();
    const dato = registro.get(ip);

    if (!dato || ahora - dato.desde > ventanaMs) {
      registro.set(ip, { usos: 1, desde: ahora });
      return next();
    }

    dato.usos += 1;
    if (dato.usos > maximo) {
      console.warn(`[${nombre}] IP ${ip} ha excedido el límite (${dato.usos} en ${Math.round(ventanaMs / 60000)} min).`);
      return res.status(429).json({ error: 'Demasiadas peticiones', message: 'Has hecho demasiadas peticiones. Espera unos minutos.' });
    }
    return next();
  };
}

// 20 escrituras cada 10 minutos: un cliente real hace una o dos (su pedido,
// quizá un aviso de stock), así que sobra margen de forma holgada.
const limitarEscrituraPublica = limitadorPorIp('escritura-publica', 20, 10 * 60 * 1000);

// ---------------------------------------------------------------------------
// Rutas públicas: TODO lo que no esté en esta lista exige un token válido.
//
// La lista es blanca a propósito. Al revés (marcar lo privado) cada ruta nueva
// nacería abierta y bastaría olvidarse una vez para volver al punto de
// partida; así una ruta nueva nace cerrada y, si de verdad tiene que ser
// pública, se añade aquí a mano.
//
// Las rutas van relativas a /api, que es donde está montado el middleware.
// ---------------------------------------------------------------------------
const RUTAS_PUBLICAS: { metodo: string; patron: RegExp }[] = [
  { metodo: 'GET', patron: /^\/health$/ },
  { metodo: 'POST', patron: /^\/login$/ },
  // Imágenes de productos y banners servidas desde Mongo.
  { metodo: 'GET', patron: /^\/media\/[^/]+$/ },
  // Catálogo de la tienda.
  { metodo: 'GET', patron: /^\/products$/ },
  { metodo: 'GET', patron: /^\/products\/[^/]+$/ },
  { metodo: 'GET', patron: /^\/banners$/ },
  // Reseñas: el cliente las lee y las escribe (quedan pendientes de aprobar).
  { metodo: 'GET', patron: /^\/products\/[^/]+\/reviews$/ },
  { metodo: 'POST', patron: /^\/products\/[^/]+\/reviews$/ },
  // Avisos de "notifícame cuando haya stock".
  { metodo: 'POST', patron: /^\/stock-alerts$/ },
  { metodo: 'GET', patron: /^\/stock-alerts\/[^/]+\/count$/ },
  // Pasarela de pago: la página del SDK y el webhook de Bold, que llega desde
  // los servidores de Bold y se valida con su propia firma HMAC.
  { metodo: 'GET', patron: /^\/bold-checkout$/ },
  { metodo: 'POST', patron: /^\/bold\/webhook$/ },
  // Portal del cliente. El token firmado que va en la ruta ES la autenticación:
  // lo verifica cada handler contra el secreto del portal y sólo abre la ficha de
  // ese contrato. Las tres acciones van listadas una por una, no con un comodín,
  // para que añadir mañana una ruta bajo /portal/ no la publique sin querer.
  //
  // Ojo: /portal-admin/* NO entra aquí y por tanto sigue exigiendo sesión de
  // administrador. El patrón pide la barra después de "portal" justamente para
  // que no se cuele.
  { metodo: 'GET', patron: /^\/portal\/[^/]+$/ },
  { metodo: 'POST', patron: /^\/portal\/[^/]+\/pagar$/ },
  { metodo: 'POST', patron: /^\/portal\/[^/]+\/comprobante$/ },
  { metodo: 'POST', patron: /^\/portal\/[^/]+\/plazo$/ },
  // Creación del pedido al terminar la compra. Ojo: sólo POST /orders.
  // El GET /orders (listado completo con datos de clientes) es de admin.
  { metodo: 'POST', patron: /^\/orders$/ },
  // Webhook de Trustonic: lo llaman los servidores del proveedor, que no
  // tienen sesión de administrador. Se autentica con el secreto compartido que
  // va en la propia ruta y que compara el handler; además el evento no se cree
  // tal cual, sólo dispara una reconsulta. El resto de /api/blocking/* sigue
  // exigiendo token.
  { metodo: 'POST', patron: /^\/blocking\/webhook\/[^/]+$/ },
];

function esRutaPublica(metodo: string, ruta: string): boolean {
  // El preflight CORS nunca lleva cabecera Authorization.
  if (metodo === 'OPTIONS') return true;
  // Normalizar la barra final para que /products/ no esquive la lista.
  const limpia = ruta.length > 1 ? ruta.replace(/\/+$/, '') : ruta;
  return RUTAS_PUBLICAS.some(r => r.metodo === metodo && r.patron.test(limpia));
}

// Todas las rutas /api requieren DB disponible (salvo login y health) y,
// si no son públicas, un token de administrador válido.
app.use('/api', (req, res, next) => {
  if (!esRutaPublica(req.method, req.path)) {
    const cabecera = req.headers.authorization || '';
    const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7).trim() : '';
    const sesion = verificarToken(token);
    if (!sesion) {
      return res.status(401).json({
        error: 'No autorizado',
        message: 'Sesión no válida o caducada. Vuelve a iniciar sesión.',
      });
    }
    (req as any).sesion = sesion;
  }

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

app.post('/api/stock-alerts', limitarEscrituraPublica, async (req, res) => {
  try {
    const { productId, productName, phone } = req.body || {};
    if (!productId || !phone) {
      return res.status(400).json({ error: 'productId y phone son requeridos' });
    }
    // Ruta pública: se acotan las longitudes antes de guardar nada.
    if (String(productId).length > 120 || String(phone).length > 25 || String(productName || '').length > 200) {
      return res.status(400).json({ error: 'Datos demasiado largos' });
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

// ====================================================================
// ██████  BOLD — Pasarela de pago con tarjeta  ██████
// ====================================================================
app.get('/api/bold-checkout', async (req, res) => {
  const BOLD_API_KEY = process.env.BOLD_API_KEY;
  const BOLD_SECRET_KEY = process.env.BOLD_SECRET_KEY;

  if (!BOLD_API_KEY || !BOLD_SECRET_KEY) {
    return res.status(500).send('<h1>Error de configuración: claves de pago no disponibles</h1>');
  }

  const { orderId, amount, currency = 'COP', redirectionUrl, description, titulo, etiqueta } =
    req.query as Record<string, string>;
  if (!orderId || !amount) {
    return res.status(400).send('<h1>Parámetros faltantes</h1>');
  }

  /**
   * El importe y la referencia entran en la firma de integridad, así que tienen
   * que ser exactamente lo que se le va a cobrar. Un importe que no sea un
   * número entero positivo no se firma: se rechaza. Antes un `amount=abc`
   * producía `NaN`, se firmaba y la pasarela recibía una página de pago sin
   * importe.
   */
  const amountInt = Math.round(Number(amount));
  if (!Number.isFinite(amountInt) || amountInt <= 0) {
    return res.status(400).send('<h1>Importe no válido</h1>');
  }
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(orderId)) {
    return res.status(400).send('<h1>Referencia no válida</h1>');
  }
  const moneda = /^[A-Z]{3}$/.test(String(currency)) ? String(currency) : 'COP';

  // Compute BOLD integrity hash
  const integrityMsg = `${orderId}${amountInt}${moneda}${BOLD_SECRET_KEY}`;
  const integrity = createHash('sha256').update(integrityMsg).digest('hex');

  /**
   * A dónde vuelve el cliente después de pagar. Lo decide la pasarela, así que
   * un valor libre aquí convierte esta ruta —que es PÚBLICA— en un redirector
   * hacia cualquier sitio, con la credibilidad del dominio de la tienda detrás.
   * Sólo se acepta volver a este mismo backend o a un origen de la lista.
   */
  const vueltaPorDefecto = `${BASE_PUBLICA}/?bold_status=success`;
  const safeRedirect = (() => {
    if (!redirectionUrl) return vueltaPorDefecto;
    try {
      const destino = new URL(redirectionUrl);
      const propio = new URL(BASE_PUBLICA);
      if (destino.origin === propio.origin) return destino.toString();
      if (ORIGENES_PERMITIDOS.has(destino.origin)) return destino.toString();
      console.warn(`[bold-checkout] URL de vuelta no permitida: ${destino.origin}. Se usa la de siempre.`);
    } catch {
      console.warn('[bold-checkout] URL de vuelta ilegible. Se usa la de siempre.');
    }
    return vueltaPorDefecto;
  })();

  const desc = description || `Pedido Xiaomi Cartagena ${orderId}`;

  /**
   * Todo lo de abajo va dentro de atributos HTML. Sin escapar, un `orderId` o un
   * `description` con una comilla cierra el atributo y escribe etiquetas nuevas
   * en una página pública: es una inyección de HTML servida desde el dominio de
   * la tienda, justo en la pantalla donde el cliente va a teclear una tarjeta.
   */
  const esc = (valor: unknown) =>
    String(valor ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  // El mismo botón sirve para un pedido de la tienda y para una cuota del
  // financiamiento, y "Resumen de tu pedido" sobre una cuota desconcierta.
  const tituloPagina = titulo ? String(titulo).slice(0, 80) : 'Resumen de tu pedido';
  const etiquetaRef = etiqueta ? String(etiqueta).slice(0, 30) : 'Pedido';

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
    <p class="title">${esc(tituloPagina)}</p>
    <p class="sub">Haz clic en el bot&oacute;n de abajo para pagar de forma segura</p>
    <div class="info">
      <div class="label">Total a pagar</div>
      <div class="val">$${amountInt.toLocaleString('es-CO')} ${esc(moneda)}</div>
      <div class="oid">${esc(etiquetaRef)} ${esc(orderId)}</div>
    </div>
    <div id="bold-btn-wrap">
      <script
        src="https://checkout.bold.co/library/boldPaymentButton.js"
        data-bold-button="dark-L"
        data-order-id="${esc(orderId)}"
        data-amount="${amountInt}"
        data-currency="${esc(moneda)}"
        data-api-key="${esc(BOLD_API_KEY)}"
        data-integrity-signature="${esc(integrity)}"
        data-redirection-url="${esc(safeRedirect)}"
        data-description="${esc(desc)}"
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

    // No se vuelca el payload entero: el objeto `data` de Bold trae datos de
    // la tarjeta y del comprador, y esto se registra ANTES de validar la firma,
    // así que cualquiera que conozca la URL podría llenar los logs de Railway
    // con lo que quisiera. Se dejan sólo los campos necesarios para depurar.
    console.log('[bold-webhook] Evento recibido:', JSON.stringify({
      id: payload?.id,
      type: payload?.type,
      subject: payload?.subject,
      referencia: payload?.data?.metadata?.reference || payload?.data?.reference || payload?.subject,
    }));

    // Aceptar la recepción de inmediato como exige Bold
    res.status(200).send('OK');

    const signature = req.headers['x-bold-signature'];
    const secret = process.env.BOLD_SECRET_KEY;

    // La firma es OBLIGATORIA. Antes se validaba sólo "si venía": al no
    // mandar la cabecera x-bold-signature se saltaba el bloque entero y el
    // evento se procesaba como auténtico, así que cualquiera que conociera
    // la URL podía hacer un POST con type SALE_APPROVED y marcar pagado un
    // pedido que nunca se cobró. Ahora, si falta la firma, el secreto o el
    // cuerpo crudo, no se procesa nada.
    if (!secret) {
      console.error('[bold-webhook] BOLD_SECRET_KEY no está configurada: se descarta el evento por seguridad.');
      return;
    }
    if (!signature || typeof signature !== 'string') {
      console.error('[bold-webhook] Evento sin cabecera x-bold-signature: se descarta.');
      return;
    }
    if (!req.rawBody) {
      console.error('[bold-webhook] No se conservó el cuerpo crudo de la petición: no se puede verificar la firma, se descarta.');
      return;
    }

    // El formato documentado por Bold (developers.bold.co/webhook) es
    //   x-bold-signature = hex( HMAC-SHA256( llave secreta, base64(cuerpo crudo) ) )
    // que es el primer candidato de la lista. Los otros tres (hex/base64 sobre
    // el cuerpo crudo o sobre su base64) se mantienen como red de seguridad:
    // la firma es obligatoria, así que si Bold cambiase la codificación sin
    // avisar, sin estas variantes dejaríamos de confirmar pagos reales.
    const rawBodyBase64 = req.rawBody.toString('base64');

    // El ejemplo de Bold calcula el base64 sobre JSON.stringify(body), o sea
    // sobre el cuerpo RE-serializado, no sobre los bytes recibidos. Normalmente
    // coinciden, pero si Bold enviase el JSON con otro espaciado u otro orden
    // de claves dejarían de coincidir y, al ser la firma obligatoria, se
    // caerían los pagos reales. Se incluye también esa variante.
    let cuerpoReserializadoBase64 = '';
    try {
      cuerpoReserializadoBase64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    } catch {
      /* si no se puede re-serializar, basta con las variantes del cuerpo crudo */
    }

    const candidatos = [
      createHmac('sha256', secret).update(rawBodyBase64).digest('hex'),
      createHmac('sha256', secret).update(rawBodyBase64).digest('base64'),
      createHmac('sha256', secret).update(req.rawBody).digest('hex'),
      createHmac('sha256', secret).update(req.rawBody).digest('base64'),
      ...(cuerpoReserializadoBase64 && cuerpoReserializadoBase64 !== rawBodyBase64
        ? [
            createHmac('sha256', secret).update(cuerpoReserializadoBase64).digest('hex'),
            createHmac('sha256', secret).update(cuerpoReserializadoBase64).digest('base64'),
          ]
        : []),
    ];

    const firmaRecibida = Buffer.from(signature.trim(), 'utf8');
    let isSignatureValid = false;
    for (const candidato of candidatos) {
      try {
        const esperada = Buffer.from(candidato, 'utf8');
        // timingSafeEqual exige la misma longitud; distinta longitud ya es un fallo.
        if (esperada.length === firmaRecibida.length && timingSafeEqual(esperada, firmaRecibida)) {
          isSignatureValid = true;
          break;
        }
      } catch (err) {
        console.error('[bold-webhook] Error verificando firma:', err);
      }
    }

    if (!isSignatureValid) {
      // No se registra la firma calculada: dársela a quien la falla es
      // regalarle la respuesta correcta.
      console.error('[bold-webhook] Firma de seguridad inválida: se descarta el evento.');
      return;
    }
    console.log('[bold-webhook] Firma de seguridad validada con éxito.');

    const { type, data } = payload;
    if (type !== 'SALE_APPROVED') {
      console.log(`[bold-webhook] Tipo de evento no manejado o no es SALE_APPROVED: ${type}`);
      
      // Si la venta es rechazada, podemos actualizar a cancelada para informar al admin
      if (type === 'SALE_REJECTED') {
        const orderNumber = data?.metadata?.reference || data?.reference || payload.subject;
        // Las cuotas del financiamiento comparten webhook con las ventas de la
        // tienda y se distinguen por el prefijo de la referencia. Un rechazo no
        // toca ninguna cuota —nunca se marcó nada— pero sí cierra la intención,
        // para que el portal pueda decir "no se pudo cobrar" en vez de dejar al
        // cliente mirando un "estamos confirmando" que no va a cambiar nunca.
        if (esReferenciaDeCuota(orderNumber)) {
          await rechazarPagoDeCuotas(depsPortal, String(orderNumber));
          return;
        }
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

    /**
     * Pago de una cuota de financiamiento, no de un pedido de la tienda.
     *
     * Se bifurca por el prefijo de la referencia y no buscando en las dos
     * colecciones: la referencia la escribió este servidor al crear la intención
     * de pago, así que es un dato propio, mientras que lo que trae el payload es
     * de un tercero. Con el prefijo, un número de pedido no puede acabar
     * marcando cuotas pagadas ni al contrario.
     */
    if (esReferenciaDeCuota(orderNumber)) {
      await confirmarPagoDeCuotas(depsPortal, String(orderNumber), {
        paymentId: data?.payment_id || data?.paymentId || payload?.id,
        metodo: data?.payment_method || data?.paymentMethod || data?.method,
      });
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


app.post('/api/orders', limitarEscrituraPublica, async (req, res) => {
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

/**
 * Registra status/connect/disconnect para una sesión de WhatsApp.
 *
 * Es una fábrica y no tres rutas copiadas porque hay dos sesiones (tienda y
 * CREDILOCK) y duplicar el bloque garantizaba que cualquier arreglo futuro se
 * aplicara a una y se olvidara en la otra.
 *
 * El contrato de la respuesta se mantiene igual que antes ({ status, qr }) para no
 * romper el WhatsAppPanel que ya existe; `numero` es un campo nuevo añadido.
 */
function registrarRutasWhatsApp(base: string, servicio: WhatsAppService) {
  const tag = servicio.getConfig().tagLog;

  app.get(`${base}/status`, (_req, res) => {
    const status = servicio.getStatus();
    const result: Record<string, any> = { status, numero: servicio.getNumero() };
    if (status === 'qr_ready') result.qr = servicio.getQRDataUrl();
    res.json(result);
  });

  app.post(`${base}/connect`, async (_req, res) => {
    if (!db) return res.status(503).json({ error: 'Base de datos no disponible' });
    try {
      await servicio.init(db, io);
      // Devolver el estado actual; si hay QR disponible, incluirlo
      const status = servicio.getStatus();
      const result: Record<string, any> = { success: true, status, numero: servicio.getNumero() };
      if (status === 'qr_ready') result.qr = servicio.getQRDataUrl();
      res.json(result);
    } catch (err) {
      console.error(tag, 'Error al conectar:', err);
      res.status(500).json({ error: 'Error al inicializar WhatsApp' });
    }
  });

  app.post(`${base}/disconnect`, async (_req, res) => {
    try {
      await servicio.disconnect();
      res.json({ success: true });
    } catch (err) {
      console.error(tag, 'Error al desconectar:', err);
      res.status(500).json({ error: 'Error al desconectar WhatsApp' });
    }
  });
}

registrarRutasWhatsApp('/api/whatsapp', whatsappService);
registrarRutasWhatsApp('/api/credilock', credilockService);

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

app.post('/api/products/:id/reviews', limitarEscrituraPublica, async (req, res) => {
  try {
    const { author, rating, comment } = req.body || {};

    // Esta ruta es pública y escribe en Mongo, así que valida de verdad.
    // Antes insertaba lo que llegara: un POST con el cuerpo vacío creaba una
    // reseña con autor, nota y comentario a null.
    const autorLimpio = String(author ?? '').trim();
    const comentarioLimpio = String(comment ?? '').trim();
    const notaNumero = Number(rating);

    if (!autorLimpio || !comentarioLimpio) {
      return res.status(400).json({ error: 'El nombre y el comentario son obligatorios' });
    }
    if (!Number.isInteger(notaNumero) || notaNumero < 1 || notaNumero > 5) {
      return res.status(400).json({ error: 'La valoración debe ser un número entero del 1 al 5' });
    }
    // Topes de longitud para que nadie use el campo como almacén de texto.
    if (autorLimpio.length > 60 || comentarioLimpio.length > 1000) {
      return res.status(400).json({ error: 'El nombre o el comentario son demasiado largos' });
    }

    const review = {
      productId: String(req.params.id).slice(0, 120),
      author: autorLimpio,
      rating: notaNumero,
      comment: comentarioLimpio,
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

/**
 * Captura del pago que el cliente manda por WhatsApp. Es la prueba de que la
 * cuota entró: sin esto, marcar "Pagada" era la palabra de quien apretó el
 * botón contra la de un cliente al que, si se equivoca el conteo, se le bloquea
 * el teléfono.
 *
 * No se guarda la imagen aquí sino su `mediaId`: el documento de financiación
 * viaja entero en cada `GET /api/financing` (113 registros), y meterle los
 * binarios lo volvería inmanejable.
 */
interface ComprobantePago {
  mediaId: string;
  mime: string;
  bytes: number;
  nombreArchivo: string;
  subidoEn: string; // ISO
  subidoPor: string;
}

interface FinancingInstallment {
  number: number;
  dueDate: string; // ISO — la fecha PACTADA; no se toca nunca
  paidDate?: string; // ISO — cuando se marcó como pagada
  status: 'pending' | 'paid' | 'overdue';
  comprobante?: ComprobantePago | null;
  /**
   * Plazo extra concedido sobre esta cuota. Ver `server/prorroga.ts`: la fecha
   * que manda para mora, bloqueos y recordatorios es `fechaLimite(cuota)`, no
   * `dueDate`.
   */
  prorroga?: Prorroga | null;
  /**
   * Pago hecho por el cliente desde el portal, ya confirmado por la pasarela.
   * Lo escribe `confirmarPagoDeCuotas` (server/portal-rutas.ts) al recibir el
   * webhook de Bold, nunca el panel.
   *
   * Hace el mismo papel que `comprobante`: es el respaldo de la cuota. La
   * diferencia es que esto no es una imagen que alguien manda, es plata que
   * entró, así que no se puede editar ni borrar desde el panel.
   */
  pagoEnLinea?: {
    referencia: string;
    monto: number;
    metodo?: string;
    boldPaymentId?: string;
    aprobadoEn: string; // ISO
  } | null;
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
 *  Solo marca overdue si ya pasó la horaBloqueo en hora Colombia (UTC-5).
 *
 *  Una cuota con prórroga vigente NO sale vencida: se mide contra la fecha del
 *  plazo, no contra la pactada. Este estado es sólo de lectura (nunca se guarda
 *  en Mongo), así que conceder o anular una prórroga se refleja al instante. */
function refreshOverdueStatus(cuotas: FinancingInstallment[], horaBloqueo = '08:00'): FinancingInstallment[] {
  // Hora actual en Colombia
  const nowCO = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
  const todayStr = nowCO.toISOString().slice(0, 10);
  const [bH, bM] = horaBloqueo.split(':').map(Number);

  return cuotas.map(c => {
    if (c.status !== 'pending') return c;
    const dueDateStr = fechaLimite(c); // yyyy-mm-dd, con la prórroga ya aplicada

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

        /**
         * Las capturas de pago sobreviven a la regeneración. Antes se perdían
         * sin aviso: editar el número de cuotas o la fecha de inicio borraba el
         * array de pendientes entero, y con él el comprobante que alguien ya
         * había subido. Es prueba de un pago, no un adorno.
         *
         * Las prórrogas NO se conservan, y es a propósito: una prórroga dice
         * "sobre la cuota que vencía el 10, te doy hasta el 20". Si la fecha de
         * esa cuota se acaba de mover, el plazo ya no se refiere a nada y
         * mantenerlo sólo serviría para despistar al automatismo.
         */
        const comprobantesPorNumero = new Map(
          (oldCuotas as FinancingInstallment[])
            .filter(c => c.comprobante?.mediaId)
            .map(c => [c.number, c.comprobante!])
        );
        const prorrogasDescartadas = (oldCuotas as FinancingInstallment[]).filter(
          c => c.status !== 'paid' && c.prorroga?.hasta
        ).length;

        const unpaidCuotas: FinancingInstallment[] = [];
        const start = new Date(newFechaInicio);
        for (let i = 0; i < unpaidCount; i++) {
          const d = new Date(start);
          d.setUTCDate(d.getUTCDate() + i * 15);
          const numero = nextNumber + i;
          const comprobante = comprobantesPorNumero.get(numero);
          comprobantesPorNumero.delete(numero);
          unpaidCuotas.push({
            number: numero,
            dueDate: d.toISOString(),
            status: 'pending',
            ...(comprobante ? { comprobante } : {}),
          });
        }

        // Lo que no encontró hueco (porque bajó el número de cuotas) se borra de
        // verdad, en vez de quedar como binario huérfano en `media`.
        for (const sobrante of comprobantesPorNumero.values()) {
          await borrarMediaComprobante(sobrante);
        }
        if (prorrogasDescartadas > 0) {
          console.log(`[financing] ${existing.nombre}: se descartaron ${prorrogasDescartadas} prórroga(s) al regenerar las cuotas.`);
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
/* ────────────────────  Comprobantes de pago  ──────────────────── */

/** Tope por comprobante. El servidor guarda hasta MAX_STORED_IMAGE_BYTES. */
const MAX_COMPROBANTE_BYTES = 700 * 1024;

/**
 * Localiza la cuota dentro de la financiación. Las tres rutas de comprobante
 * empiezan igual, y repetir la búsqueda en cada una era la vía rápida a que
 * sólo dos de las tres validaran el índice.
 */
async function buscarCuota(id: string, numero: string) {
  const record = await db.collection('financing').findOne({ id });
  if (!record) return { error: 'Financiamiento no encontrado' as const, status: 404 };

  const cuotas: FinancingInstallment[] = record.cuotas || [];
  const idx = cuotas.findIndex(c => c.number === Number(numero));
  if (idx === -1) return { error: 'Cuota no encontrada' as const, status: 404 };

  return { record, cuotas, idx };
}

/**
 * Borra el binario de un comprobante. Se llama al reemplazar y al eliminar: sin
 * esto, cambiar una captura dejaba la anterior ocupando espacio en Mongo para
 * siempre, sin nada que la referenciara.
 */
async function borrarMediaComprobante(comprobante?: ComprobantePago | null) {
  if (!comprobante?.mediaId) return;
  await db.collection('media').deleteOne({ mediaId: comprobante.mediaId }).catch(() => {});
}

/** Sube (o reemplaza) la captura del pago de una cuota. */
app.post('/api/financing/:id/comprobante/:cuotaNumber', async (req, res) => {
  try {
    const encontrado = await buscarCuota(req.params.id, req.params.cuotaNumber);
    if ('error' in encontrado) return res.status(encontrado.status).json({ error: encontrado.error });
    const { cuotas, idx } = encontrado;

    const { image, filename } = req.body || {};
    if (!image || typeof image !== 'string') {
      return res.status(400).json({ error: 'Falta la imagen del comprobante' });
    }

    const parsed = parseBase64Image(image);
    if (!parsed) return res.status(400).json({ error: 'La imagen no es válida' });
    if (parsed.buffer.length > MAX_COMPROBANTE_BYTES) {
      return res.status(413).json({
        error: `El comprobante pesa ${Math.round(parsed.buffer.length / 1024)}KB y el máximo son ${Math.round(
          MAX_COMPROBANTE_BYTES / 1024
        )}KB.`,
      });
    }

    /**
     * Identificador aleatorio, no correlativo. Aunque la imagen sólo se sirve
     * con sesión de administrador, un id predecible como `financiacion-3-cuota-7`
     * convertiría cualquier fuga futura de la ruta en "descarga todas las
     * capturas bancarias de la cartera".
     */
    const mediaId = `comprobante-${randomBytes(16).toString('hex')}`;
    await db.collection('media').insertOne({
      mediaId,
      mime: parsed.mime,
      data: parsed.buffer,
      folder: 'comprobantes',
      createdAt: new Date().toISOString(),
    });

    // El binario nuevo ya está guardado, así que si el borrado del viejo falla
    // se pierde espacio, no la prueba.
    await borrarMediaComprobante(cuotas[idx].comprobante);

    cuotas[idx].comprobante = {
      mediaId,
      mime: parsed.mime,
      bytes: parsed.buffer.length,
      nombreArchivo: String(filename || 'comprobante.jpg').slice(0, 120),
      subidoEn: new Date().toISOString(),
      subidoPor: (req as any).sesion?.usuario || 'admin',
    };

    await db.collection('financing').updateOne({ id: req.params.id }, { $set: { cuotas } });
    const updated = await db.collection('financing').findOne({ id: req.params.id });
    return res.json(updated);
  } catch (error) {
    console.error('[financing] Error subiendo comprobante:', error);
    return res.status(500).json({ error: 'No se pudo guardar el comprobante' });
  }
});

/**
 * Devuelve la imagen. Va por aquí y no por /api/media/:id —que es público para
 * las fotos del catálogo— porque un comprobante es una captura bancaria de un
 * cliente: nombre, banco y a veces el número de cuenta. Esta ruta cuelga de
 * /api/financing, así que hereda la exigencia de sesión de administrador.
 */
app.get('/api/financing/:id/comprobante/:cuotaNumber/imagen', async (req, res) => {
  try {
    const encontrado = await buscarCuota(req.params.id, req.params.cuotaNumber);
    if ('error' in encontrado) return res.status(encontrado.status).end();

    const comprobante = encontrado.cuotas[encontrado.idx].comprobante;
    if (!comprobante?.mediaId) return res.status(404).end();

    const doc = await db.collection('media').findOne({ mediaId: comprobante.mediaId });
    if (!doc) return res.status(404).end();

    res.setHeader('Content-Type', doc.mime || comprobante.mime || 'image/jpeg');
    // Privado: que no quede en la caché de un proxy compartido.
    res.setHeader('Cache-Control', 'private, max-age=3600');

    if (Buffer.isBuffer(doc.data)) return res.send(doc.data);
    if (doc.data?.buffer) return res.send(Buffer.from(doc.data.buffer));
    return res.send(Buffer.from(doc.data));
  } catch (error) {
    console.error('[financing] Error sirviendo comprobante:', error);
    return res.status(500).end();
  }
});

/** Elimina la captura. Reemplazar es un POST; esto es quitarla del todo. */
app.delete('/api/financing/:id/comprobante/:cuotaNumber', async (req, res) => {
  try {
    const encontrado = await buscarCuota(req.params.id, req.params.cuotaNumber);
    if ('error' in encontrado) return res.status(encontrado.status).json({ error: encontrado.error });
    const { cuotas, idx } = encontrado;

    /**
     * Una cuota pagada no se queda sin prueba. Si se permitiera, bastaría un
     * clic de más para tener un pago registrado que nadie puede justificar
     * cuando el cliente reclame. Para corregir una captura equivocada está el
     * reemplazo, que sí funciona con la cuota pagada.
     */
    if (cuotas[idx].status === 'paid') {
      return res.status(409).json({
        error: 'La cuota está pagada y el comprobante es su respaldo. Desmárcala primero, o sube otra captura para reemplazarla.',
      });
    }

    await borrarMediaComprobante(cuotas[idx].comprobante);
    cuotas[idx].comprobante = null;

    await db.collection('financing').updateOne({ id: req.params.id }, { $set: { cuotas } });
    const updated = await db.collection('financing').findOne({ id: req.params.id });
    return res.json(updated);
  } catch (error) {
    console.error('[financing] Error eliminando comprobante:', error);
    return res.status(500).json({ error: 'No se pudo eliminar el comprobante' });
  }
});

/* ─── Prórrogas ─────────────────────────────────────────────────────────────
 *
 * Dar plazo sin perder la fecha pactada. Ver `server/prorroga.ts` para el
 * porqué del modelo; aquí sólo se valida, se guarda y —lo importante— se suelta
 * el teléfono si estaba bloqueado por esta misma cuota.
 */

/** Concede o amplía el plazo de una cuota. */
app.post('/api/financing/:id/prorroga/:cuotaNumber', async (req, res) => {
  try {
    const encontrado = await buscarCuota(req.params.id, req.params.cuotaNumber);
    if ('error' in encontrado) return res.status(encontrado.status).json({ error: encontrado.error });
    const { record, cuotas, idx } = encontrado;

    const hoy = getColombiaDate().dateStr;
    const revision = validarProrroga(req.body?.hasta, cuotas[idx], hoy);
    if ('error' in revision) return res.status(400).json({ error: revision.error });

    const anterior = cuotas[idx].prorroga || null;
    const motivo = String(req.body?.motivo || '').trim().slice(0, 300);

    cuotas[idx].prorroga = {
      hasta: revision.hasta,
      otorgadaEn: new Date().toISOString(),
      otorgadaPor: (req as any).sesion?.usuario || 'admin',
      fechaOriginal: String(cuotas[idx].dueDate).slice(0, 10),
      ...(motivo ? { motivo } : {}),
    };

    /**
     * Contador que sólo sube, incluso al anular. Es la señal que el dueño
     * necesita para decidir si sigue dando plazos a alguien: si se llevara
     * contando las prórrogas vivas, el cliente que pide una cada quincena se
     * vería siempre como si fuera la primera vez.
     */
    const vecesPedidas = Number(record.prorrogasOtorgadas || 0) + 1;

    await db.collection('financing').updateOne(
      { id: req.params.id },
      { $set: { cuotas, prorrogasOtorgadas: vecesPedidas } }
    );

    // Se guarda ANTES de tocar el teléfono: si la orden al proveedor falla, el
    // plazo ya quedó registrado y el automatismo respeta la prórroga en su
    // siguiente vuelta. Al revés habríamos soltado un equipo sin constancia.
    const equipo = await alOtorgarProrroga(
      depsBloqueo,
      req.params.id,
      revision.hasta,
      cuotas[idx].number
    );

    /**
     * Si el cliente había pedido este plazo desde el portal, su solicitud queda
     * cerrada aquí. Conceder sigue siendo UNA sola operación: no hay un botón
     * "aprobar solicitud" aparte que otorgue prórrogas por su cuenta, porque
     * entonces habría dos caminos que soltar el equipo y un día uno de los dos
     * se quedaría sin el arreglo. El dueño concede como siempre y la solicitud
     * se da por atendida sola.
     */
    await cerrarSolicitudAlConceder(
      depsPortal,
      record,
      cuotas[idx].number,
      (req as any).sesion?.usuario || 'admin'
    );

    console.log(
      `[financing] Prórroga para ${record.nombre} cuota #${cuotas[idx].number}: ` +
      `${cuotas[idx].dueDate.slice(0, 10)} → ${revision.hasta}` +
      `${anterior ? ` (ampliaba la de ${anterior.hasta})` : ''}. ` +
      `Equipo: ${equipo.liberado ? 'desbloqueado' : equipo.detalle || 'sin cambios'}`
    );

    const updated = await db.collection('financing').findOne({ id: req.params.id });
    return res.json({
      record: updated,
      prorroga: cuotas[idx].prorroga,
      equipoLiberado: equipo.liberado,
      detalleEquipo: equipo.detalle,
      vecesPedidas,
      /** Para que el panel avise si el plazo se pasa de la cuota siguiente. */
      pisaCuotaSiguiente: cuotas.some(
        c => c.number > cuotas[idx].number && c.status !== 'paid' && fechaLimite(c) < revision.hasta
      ),
    });
  } catch (error) {
    console.error('[financing] Error otorgando prórroga:', error);
    return res.status(500).json({ error: 'No se pudo registrar la prórroga' });
  }
});

/** Anula el plazo y devuelve la cuota a su fecha pactada. */
app.delete('/api/financing/:id/prorroga/:cuotaNumber', async (req, res) => {
  try {
    const encontrado = await buscarCuota(req.params.id, req.params.cuotaNumber);
    if ('error' in encontrado) return res.status(encontrado.status).json({ error: encontrado.error });
    const { record, cuotas, idx } = encontrado;

    if (!cuotas[idx].prorroga) {
      return res.status(409).json({ error: 'Esta cuota no tiene ninguna prórroga.' });
    }

    /**
     * Anular devuelve la cuota a su fecha pactada, y si esa fecha ya pasó el
     * cliente vuelve a estar en mora en el acto — el automatismo puede
     * bloquearle el equipo en su siguiente vuelta. No se bloquea desde aquí: no
     * es una acción que el dueño haya pedido, y encadenar un bloqueo a un
     * "anular" sorprendería a quien sólo quería corregir una fecha mal tecleada.
     */
    const volveriaAMora = fechaLimite({ dueDate: cuotas[idx].dueDate }) < getColombiaDate().dateStr;
    const anulada = cuotas[idx].prorroga;
    cuotas[idx].prorroga = null;

    await db.collection('financing').updateOne({ id: req.params.id }, { $set: { cuotas } });

    // Borra el plazo que el panel de bloqueo tenía copiado. Si se dejara para la
    // vuelta de media hora, esa pestaña seguiría anunciando un plazo que acaba
    // de dejar de existir, que es lo contrario de lo que se quiso al anularlo.
    await alAnularProrroga(depsBloqueo, req.params.id);

    console.log(
      `[financing] Prórroga anulada para ${record.nombre} cuota #${cuotas[idx].number} ` +
      `(era hasta ${anulada!.hasta}). Vuelve a mora: ${volveriaAMora}`
    );

    const updated = await db.collection('financing').findOne({ id: req.params.id });
    return res.json({ record: updated, volveriaAMora });
  } catch (error) {
    console.error('[financing] Error anulando prórroga:', error);
    return res.status(500).json({ error: 'No se pudo anular la prórroga' });
  }
});

app.post('/api/financing/:id/pay/:cuotaNumber', async (req, res) => {
  try {
    const record = await db.collection('financing').findOne({ id: req.params.id });
    if (!record) return res.status(404).json({ error: 'Financiamiento no encontrado' });

    const cuotaNum = Number(req.params.cuotaNumber);
    const cuotas: FinancingInstallment[] = record.cuotas || [];
    const idx = cuotas.findIndex(c => c.number === cuotaNum);
    if (idx === -1) return res.status(404).json({ error: 'Cuota no encontrada' });

    /**
     * Sin comprobante no se marca pagada. La regla se aplica aquí y no sólo en
     * el botón del panel porque un pago registrado dispara el desbloqueo del
     * teléfono y mueve la contabilidad: si viviera únicamente en la interfaz,
     * cualquier recarga a medias o una llamada suelta la saltaría.
     *
     * Sólo afecta a lo que se marque de ahora en adelante; las cuotas que ya
     * estaban pagadas antes de existir esta columna se quedan como están.
     *
     * Un pago en línea confirmado por la pasarela también vale como respaldo, y
     * de hecho vale MÁS que una captura: la captura es una imagen que alguien
     * manda, el pago en línea es dinero que entró y que Bold firmó. Exigir
     * además la foto sería pedirle al cliente que demuestre con una pantalla
     * algo que ya está cobrado.
     */
    if (!cuotas[idx].comprobante?.mediaId && !cuotas[idx].pagoEnLinea?.referencia) {
      return res.status(409).json({
        error: 'Sube primero la captura del pago. Es el respaldo de la cuota.',
        faltaComprobante: true,
      });
    }

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

    // Desbloqueo automático, DESPUÉS de responder: el cliente suele estar en el
    // mostrador y la respuesta no tiene por qué esperar a que Trustonic
    // conteste. Si falla, queda en el historial y el cron de política lo vuelve
    // a intentar; no se arrastra el error hasta el recibo del pago.
    void alRegistrarPago(depsBloqueo, req.params.id);
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

/** La firma con la que terminan TODOS los avisos de cartera. */
const FIRMA_CREDILOCK = '_CREDILOCK — Sistema de financiamiento_';

/**
 * Le mete el link del portal a un aviso de cartera, justo encima de la firma.
 *
 * Va aquí y no dentro de cada plantilla por una razón práctica: hay 8 variantes
 * de mensaje entre el cron y el botón manual, y si el link se escribe a mano en
 * cada una, la novena que alguien añada saldrá sin él y nadie se dará cuenta
 * hasta que un cliente llame a preguntar cuánto debe. Esto lo pone en el único
 * sitio por el que pasan todas: el envío.
 *
 * Si todavía no hay secreto —arranque en frío, Mongo caído— `linkPortal`
 * devuelve `null` y el mensaje sale tal cual. Un aviso sin link sirve; un aviso
 * con un link que da error de firma hace que el cliente desconfíe del resto.
 */
function conLinkDelPortal(msg: string, record: any): string {
  const link = linkPortal(BASE_PUBLICA, secretoPortal, record);
  if (!link) return msg;

  const bloque =
    `👉 *Mira tus cuotas y paga en línea:*\n${link}\n\n` +
    // Los métodos nombrados aquí son los mismos que permite METODOS_CUOTA en
    // bold-link.ts. Si allí cambian, este texto cambia: prometerle al cliente un
    // medio de pago que el checkout no le va a ofrecer es una llamada al local.
    `Ahí ves cuánto debes, tu próxima fecha, puedes pagar con Nequi, PSE o el botón ` +
    `de Bancolombia, subir el comprobante o pedir un plazo. Es tu link privado, no lo compartas.`;

  // Se inserta ANTES de la firma para que el mensaje no termine en una URL:
  // WhatsApp recorta la vista previa y el link suelto al final se lee como
  // publicidad pegada. Si la firma no apareciera, se añade al final y listo.
  return msg.includes(FIRMA_CREDILOCK)
    ? msg.replace(FIRMA_CREDILOCK, `${bloque}\n\n${FIRMA_CREDILOCK}`)
    : `${msg}\n\n${bloque}`;
}

// --- Enviar recordatorio WhatsApp manual ---
app.post('/api/financing/:id/remind', async (req, res) => {
  try {
    const record = await db.collection('financing').findOne({ id: req.params.id });
    if (!record) return res.status(404).json({ error: 'No encontrado' });

    // Los avisos de cobro salen SIEMPRE por el número de CREDILOCK, nunca por el
    // de la tienda. No hay fallback a propósito: si CREDILOCK está caído el dueño
    // tiene que verlo y volver a emparejar, no que los cobros se cuelen por el
    // número comercial sin que nadie se entere.
    if (credilockService.getStatus() !== 'connected') {
      return res.status(400).json({ error: 'El WhatsApp de CREDILOCK no está conectado. Escanea el QR en Financiamiento.' });
    }

    // Encontrar próxima cuota pendiente
    const cuotas: FinancingInstallment[] = refreshOverdueStatus(record.cuotas || [], record.horaBloqueo || '08:00');
    const nextPending = cuotas.find(c => c.status === 'pending' || c.status === 'overdue');

    if (!nextPending) {
      return res.status(400).json({ error: 'No hay cuotas pendientes' });
    }

    // Misma fecha efectiva que usa la política de bloqueo: con la prórroga
    // aplicada y leída en UTC, no en UTC-5 (ver `fechaLimite`).
    const hoy = getColombiaDate().dateStr;
    const fechaStr = fechaLarga(fechaLimite(nextPending));
    const prorroga = prorrogaVigente(nextPending, hoy);
    const isOverdue = nextPending.status === 'overdue';

    const valorStr = record.valorCuota.toLocaleString('es-CO');
    const previas = record.cuotasPrevias || 0;
    const paidCountStr = previas + cuotas.filter((c: FinancingInstallment) => c.status === 'paid').length;
    const hora = record.horaBloqueo || '08:00';

    let msg: string;
    if (prorroga) {
      // Tiene plazo abierto: no se le puede decir "venció" ni "vence el", porque
      // su fecha pactada ya pasó y lo que corre es el acuerdo.
      msg = `⏳ *CREDILOCK — Tienes plazo*\n\nHola *${nombreBonito(record.nombre)}*, te recordamos que tienes plazo hasta el *${fechaStr}* para pagar tu cuota #${nextPending.number} de *$${valorStr} COP*.\n\n⏰ *Si no se realiza el pago, el equipo será bloqueado a las ${hora}.*\n\nCuotas pagadas: ${paidCountStr}/${record.numeroCuotas}\n\n📱 IMEI: ${record.imei}\n📞 Contacto: 302 287 5280\n\n_CREDILOCK — Sistema de financiamiento_`;
    } else if (isOverdue) {
      const queVencio = tieneProrroga(nextPending)
        ? `el plazo que acordamos para tu cuota #${nextPending.number} de *$${valorStr} COP* se cumplió el *${fechaStr}*`
        : `tu cuota #${nextPending.number} de *$${valorStr} COP* venció el *${fechaStr}*`;
      msg = `🔒 *CREDILOCK — Pago Vencido*\n\nHola *${nombreBonito(record.nombre)}*, ${queVencio}.\n\n⚠️ *Tu equipo será bloqueado a las ${hora} si no realizas el pago.*\n\nEvita el bloqueo realizando tu pago lo antes posible.\n\n📱 IMEI: ${record.imei}\nCuotas pagadas: ${paidCountStr}/${record.numeroCuotas}\n📞 Contacto: 302 287 5280\n\n_CREDILOCK — Sistema de financiamiento_`;
    } else {
      msg = `📅 *CREDILOCK — Recordatorio de Pago*\n\nHola *${nombreBonito(record.nombre)}*, te recordamos que tu cuota #${nextPending.number} de *$${valorStr} COP* vence el *${fechaStr}*.\n\n⏰ *Si no se realiza el pago, el equipo será bloqueado a las ${hora}.*\n\nCuotas pagadas: ${paidCountStr}/${record.numeroCuotas}\n\n📱 IMEI: ${record.imei}\n📞 Contacto: 302 287 5280\n\n_CREDILOCK — Sistema de financiamiento_`;
    }

    const success = await credilockService.sendMessage(record.telefono, conLinkDelPortal(msg, record));
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

/**
 * Candado de reentrada, igual que en los mensajes programados. Con 109 clientes
 * activos y 3 s de espera entre mensajes, una vuelta normal tarda ~5 min; pero si
 * los envíos se cuelgan (pasa, lo vimos el 2026-09-30) la vuelta puede superar la
 * hora y arrancaría otra encima, duplicando avisos de bloqueo a clientes reales.
 */
let financingReminderRunning = false;

/** Días de calendario entre dos fechas 'YYYY-MM-DD'. Negativo si `hasta` es anterior. */
function diasEntreFechas(desdeStr: string, hastaStr: string): number {
  const a = Date.parse(desdeStr + 'T00:00:00Z');
  const b = Date.parse(hastaStr + 'T00:00:00Z');
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return Math.round((b - a) / 86400000);
}

/**
 * AVISO DE MORA (añadido 2026-09-30, a petición del dueño).
 *
 * Antes solo se avisaba el día antes del vencimiento y el mismo día. Quien se
 * pasaba de la fecha no volvía a recibir nada nunca: había 41 clientes vencidos
 * sin un solo mensaje. Ahora se les avisa, pero con tres frenos:
 *
 *  - CADA_CUANTOS_DIAS_MORA: como mínimo 3 días entre avisos. Se lleva en un campo
 *    aparte (lastOverdueReminderSent) para no chocar con el candado diario de
 *    lastReminderSent, que sigue valiendo para los avisos de vencimiento normal.
 *  - MAX_DIAS_MORA_AVISO: a partir de 60 días de atraso dejamos de escribir. Un
 *    cliente con dos meses de mora ya no es un olvido, y hay registros viejos que
 *    posiblemente se arreglaron en tienda sin actualizar aquí; seguir mandándoles
 *    mensajes automáticos es contraproducente. Esos salen por log para que los
 *    revise una persona.
 *  - El mensaje es distinto y más suave: sin 🔒, sin amenaza de bloqueo y sin hora
 *    límite. Da por hecho que puede ser un olvido o que ya pagaron.
 */
const CADA_CUANTOS_DIAS_MORA = 3;
const MAX_DIAS_MORA_AVISO = 60;

/**
 * Tope de avisos de mora por vuelta. La primera vez que esto corra hay ~41 clientes
 * vencidos esperando, y soltar 41 mensajes seguidos desde un número que hace nada
 * mandó 131 duplicados es justo el patrón por el que WhatsApp banea cuentas. Con 12
 * por vuelta y tres vueltas en la ventana de mediodía, la primera tanda se reparte
 * en el día en vez de salir toda de golpe. Los avisos normales de vencimiento NO
 * cuentan contra este tope: esos son pocos y no pueden esperar.
 */
const MAX_AVISOS_MORA_POR_CICLO = 12;

/**
 * Los nombres están guardados como los tecleó quien creó el registro: casi todos en
 * minúsculas y algunos con espacios dobles ("cristian  david mestre payares"). Un
 * "Hola *jhon luis otero chiquillo*" se lee descuidado, así que lo presentamos
 * capitalizado. Solo afecta al mensaje; en la base no se toca nada.
 */
function nombreBonito(nombre: unknown): string {
  return String(nombre ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/(^|\s)(\p{Ll})/gu, (_m, sep, letra) => sep + letra.toLocaleUpperCase('es-CO'));
}

/**
 * Última vez que avisamos por log de que CREDILOCK está desconectado, para no
 * escribir la misma línea en cada vuelta del cron.
 */
let ultimoAvisoCredilockCaido = 0;

async function checkFinancingReminders() {
  if (!db) return;

  // Solo enviar recordatorios entre 11:30 AM y 12:30 PM Colombia (ventana del mediodía)
  const colombia = getColombiaDate();
  if (colombia.hour < 11 || colombia.hour > 13) return;

  // Los recordatorios salen por el número de CREDILOCK, no por el de la tienda.
  //
  // Antes esto era un `return` mudo: la sesión se cayó el 2026-07-26 y los avisos
  // dejaron de salir DOS MESES sin que nadie lo notase. Ahora grita en los logs
  // (una vez por hora, no en cada vuelta) y además se refleja en /api/health y en
  // el panel de financiamiento.
  if (credilockService.getStatus() !== 'connected') {
    if (Date.now() - ultimoAvisoCredilockCaido > 3600000) {
      ultimoAvisoCredilockCaido = Date.now();
      console.error('[financing] ⛔ RECORDATORIOS PAUSADOS: el WhatsApp de CREDILOCK no está conectado ' +
        `(estado: ${credilockService.getStatus()}). Hay que escanear el QR en Admin → Financiamiento.`);
    }
    return;
  }

  if (financingReminderRunning) {
    console.log('[financing] La vuelta anterior sigue en curso; se omite este turno.');
    return;
  }
  financingReminderRunning = true;

  try {
    const records = await db.collection('financing').find({ status: 'active' }).toArray();
    const todayStr = colombia.dateStr;
    let avisosMoraEnviados = 0;

    for (const record of records) {
      const cuotas: FinancingInstallment[] = record.cuotas || [];
      const nextPending = cuotas.find((c: FinancingInstallment) => c.status === 'pending' || c.status === 'overdue');
      if (!nextPending) continue;

      /**
       * La fecha que manda, con la prórroga ya aplicada.
       *
       * Antes esto era `new Date(dueDate).toLocaleDateString('en-CA', { timeZone:
       * 'America/Bogota' })`, y estaba un día desfasado: las cuotas se guardan a
       * medianoche UTC, así que pasarlas a UTC-5 las corría al día anterior. El
       * cliente recibía el "hoy vence tu cuota" la víspera y los avisos de mora
       * empezaban un día antes de que el automatismo —que sí lee la fecha en
       * UTC— considerara que debía algo. `fechaLimite` es ahora la única
       * definición, compartida con la política de bloqueo.
       */
      const dueDateStr = fechaLimite(nextPending);
      const prorroga = prorrogaVigente(nextPending, todayStr);

      // Días transcurridos desde el vencimiento: -1 = vence mañana, 0 = vence hoy,
      // 1 o más = ya está en mora.
      const diasVencido = diasEntreFechas(dueDateStr, todayStr);
      if (Number.isNaN(diasVencido)) {
        console.warn(`[financing] Fecha ilegible en ${record.nombre} (${record.id}); se omite.`);
        continue;
      }

      // Los motivos posibles para escribir viven en `recordatorios.ts`, que es
      // una función pura y con tests: es la única parte de este cron que se
      // puede probar sin levantar el servidor contra la base de producción.
      const tipoAviso = tipoDeAviso(diasVencido);
      if (!tipoAviso) continue;
      const faltan = diasQueFaltan(diasVencido);

      // Evitar enviar dos veces el mismo día (vale para cualquier tipo de aviso).
      const lastSent = record.lastReminderSent ? record.lastReminderSent.slice(0, 10) : '';
      if (lastSent === todayStr) continue;

      if (tipoAviso === 'mora') {
        // Los que no quepan hoy salen en la vuelta siguiente (ver el tope arriba).
        if (avisosMoraEnviados >= MAX_AVISOS_MORA_POR_CICLO) continue;
        // Pasados MAX_DIAS_MORA_AVISO esto deja de ser un recordatorio útil.
        // Lo sacamos por log para que lo mire una persona y no le insistimos más.
        if (diasVencido > MAX_DIAS_MORA_AVISO) {
          console.log(`[financing] ${record.nombre} lleva ${diasVencido} días de mora (> ${MAX_DIAS_MORA_AVISO}); requiere gestión manual, no se envía aviso automático.`);
          continue;
        }
        // Tope de frecuencia: un aviso de mora cada CADA_CUANTOS_DIAS_MORA días.
        const ultimoMora = record.lastOverdueReminderSent ? String(record.lastOverdueReminderSent).slice(0, 10) : '';
        if (ultimoMora) {
          const desdeUltimo = diasEntreFechas(ultimoMora, todayStr);
          if (!Number.isNaN(desdeUltimo) && desdeUltimo < CADA_CUANTOS_DIAS_MORA) continue;
        }
      }

      // Un teléfono inservible colgaría el envío hasta el timeout y retrasaría a
      // todos los que vienen detrás. Mejor saltarlo y dejar constancia.
      const telefonoOk = normalizarTelefonoCo(record.telefono);
      if (!telefonoOk) {
        console.warn(`[financing] Teléfono inutilizable en ${record.nombre} (${record.id}): "${record.telefono}". Se omite; corregir a mano.`);
        continue;
      }

      const fechaStr = fechaLarga(dueDateStr);
      const hora = record.horaBloqueo || '08:00';
      const previas = record.cuotasPrevias || 0;
      const paidCount = previas + cuotas.filter((c: FinancingInstallment) => c.status === 'paid').length;
      const valorStr = record.valorCuota.toLocaleString('es-CO');

      let msg: string;
      if (prorroga) {
        /**
         * Tiene plazo. El mensaje lo nombra en vez de hablar de "tu cuota":
         * este cliente YA sabe que su fecha pasó y que habló con la tienda, así
         * que un recordatorio que ignore el acuerdo le dice que no se lo
         * registraron — y la llamada siguiente es para quejarse.
         *
         * Sólo llega aquí con el plazo abierto; si se venció, `prorrogaVigente`
         * devuelve null y cae en los avisos normales de mora.
         */
        msg = tipoAviso === 'hoy'
          ? `⏳ *CREDILOCK — Hoy vence tu plazo*\n\nHola *${nombreBonito(record.nombre)}*, hoy *${fechaStr}* se cumple el plazo que acordamos para tu cuota #${nextPending.number} de *$${valorStr} COP*.\n\n⚠️ *Si no pagas antes de las ${hora}, el equipo será bloqueado.*\n\nCuotas pagadas: ${paidCount}/${record.numeroCuotas}\n\n📱 IMEI: ${record.imei}\n📞 Contacto: 302 287 5280\n\n_CREDILOCK — Sistema de financiamiento_`
          : tipoAviso === 'previo'
          ? `⏳ *CREDILOCK — Tienes plazo hasta mañana*\n\nHola *${nombreBonito(record.nombre)}*, te recordamos que tienes plazo hasta mañana *${fechaStr}* para tu cuota #${nextPending.number} de *$${valorStr} COP*.\n\n⏰ *Si no se realiza el pago, el equipo será bloqueado a las ${hora}.*\n\nCuotas pagadas: ${paidCount}/${record.numeroCuotas}\n\n📱 IMEI: ${record.imei}\n📞 Contacto: 302 287 5280\n\n_CREDILOCK — Sistema de financiamiento_`
          // Anticipo con plazo acordado. No nombra bloqueo: a este cliente ya se
          // le dio una fecha nueva y todavía faltan días para ella; amenazarlo
          // dentro del acuerdo que él mismo pidió es la forma más rápida de que
          // no vuelva a avisar cuando tenga un problema.
          : `⏳ *Xiaomi Cartagena*\n\nHola *${nombreBonito(record.nombre)}*, te recordamos que el plazo que acordamos para tu cuota #${nextPending.number} de *$${valorStr} COP* vence el *${fechaStr}*. Faltan ${faltan} días.\n\nCuotas pagadas: ${paidCount}/${record.numeroCuotas}\n\n📞 Contacto: 302 287 5280\n\n_CREDILOCK — Sistema de financiamiento_`;
      } else if (tipoAviso === 'anticipo') {
        /**
         * Aviso de cortesía, varios días antes de que venza. A propósito NO
         * menciona el bloqueo, por tres razones que se sostienen solas:
         *
         *  1. A 7 o 3 días el cliente no debe nada todavía. Amenazar a alguien
         *     que está al día es como un número de cobro termina reportado.
         *  2. Parte de la cartera no está enrolada en el proveedor, así que para
         *     esos equipos la amenaza no se podría cumplir aunque quisiéramos.
         *  3. El automatismo de bloqueo está en simulación; hoy no bloquea nadie.
         *
         * Los avisos de la víspera y del día sí lo nombran, y ahí sí corresponde:
         * la fecha está encima y el dueño bloquea a mano.
         */
        msg = `💚 *Xiaomi Cartagena*\n\nHola *${nombreBonito(record.nombre)}*, te contamos con tiempo: tu cuota #${nextPending.number} de *$${valorStr} COP* vence el *${fechaStr}*. Faltan ${faltan} días.\n\nSi ya la tienes lista puedes pagarla desde ahora y queda registrada al instante.\n\nCuotas pagadas: ${paidCount}/${record.numeroCuotas}\n\n📞 Contacto: 302 287 5280\n\n_CREDILOCK — Sistema de financiamiento_`;
      } else if (tipoAviso === 'hoy') {
        msg = `🔒 *CREDILOCK — ¡Hoy vence tu cuota!*\n\nHola *${nombreBonito(record.nombre)}*, hoy vence tu cuota #${nextPending.number} de *$${valorStr} COP*.\n\n⚠️ *Si no pagas antes de las ${hora}, tu equipo será bloqueado.*\n\nCuotas pagadas: ${paidCount}/${record.numeroCuotas}\n\n📱 IMEI: ${record.imei}\n📞 Contacto: 302 287 5280\n\n_CREDILOCK — Sistema de financiamiento_`;
      } else if (tipoAviso === 'previo') {
        msg = `🔔 *CREDILOCK — Recordatorio de Pago*\n\nHola *${nombreBonito(record.nombre)}*, mañana *${fechaStr}* vence tu cuota #${nextPending.number} de *$${valorStr} COP*.\n\n⏰ *Si no se realiza el pago, el equipo será bloqueado a las ${hora}.*\n\nCuotas pagadas: ${paidCount}/${record.numeroCuotas}\n\n📱 IMEI: ${record.imei}\n📞 Contacto: 302 287 5280\n\n_CREDILOCK — Sistema de financiamiento_`;
      } else {
        // AVISO DE MORA. A propósito no lleva 🔒 ni amenaza de bloqueo ni hora
        // límite: quien está vencido normalmente ya fue bloqueado o ya habló con la
        // tienda, y repetirle la amenaza cada 3 días solo consigue que bloquee el
        // número. Damos por hecho que puede ser un olvido o que ya pagó.
        const vencidas = cuotas.filter((c: FinancingInstallment) => {
          if (c.status !== 'pending' && c.status !== 'overdue') return false;
          return diasEntreFechas(fechaLimite(c), todayStr) >= 1;
        }).length;

        const cuantoHace = diasVencido === 1 ? 'ayer' : `hace ${diasVencido} días`;
        /**
         * Si la fecha que se le pasó era la de una prórroga hay que decirlo así.
         * "Tu cuota venció hace 2 días" sobre alguien a quien se le dio plazo
         * suena a que no le contaron el acuerdo; "se cumplió el plazo" es lo que
         * de verdad pasó, y además le recuerda que ya se le dio una oportunidad.
         */
        const seVencioElPlazo = tieneProrroga(nextPending);
        const detalle = vencidas > 1
          ? `tienes *${vencidas} cuotas* pendientes por un total de *$${(record.valorCuota * vencidas).toLocaleString('es-CO')} COP*. La más antigua es la #${nextPending.number}, que venció ${cuantoHace}`
          : seVencioElPlazo
            ? `tienes pendiente la cuota #${nextPending.number} de *$${valorStr} COP*. El plazo que acordamos se cumplió ${cuantoHace} (${fechaStr})`
            : `tienes pendiente la cuota #${nextPending.number} de *$${valorStr} COP*, que venció ${cuantoHace} (${fechaStr})`;

        msg = `👋 *Xiaomi Cartagena*\n\nHola *${nombreBonito(record.nombre)}*, según nuestros registros ${detalle}.\n\n✅ Si ya realizaste el pago, avísanos y lo verificamos de inmediato.\n🤝 Si aún no has podido, escríbenos y buscamos una solución juntos.\n\nCuotas pagadas: ${paidCount}/${record.numeroCuotas}\n\n📞 Contacto: 302 287 5280\n\n_CREDILOCK — Sistema de financiamiento_`;
      }

      let success = false;
      try {
        success = await Promise.race([
          credilockService.sendMessage(record.telefono, conLinkDelPortal(msg, record)),
          new Promise<boolean>(r => setTimeout(() => r(false), 20000)),
        ]);
      } catch (e) {
        console.error(`[financing] Error enviando a ${record.nombre}:`, e);
      }

      // OJO: marcamos el día SIEMPRE, se confirme o no el envío.
      // Antes solo se marcaba con success=true, y como un envío colgado devuelve
      // false, el mismo cliente volvía a recibir el aviso en el tick siguiente
      // (la ventana abarca las 11, 12 y 13 h → hasta 3 copias del mismo mensaje).
      // Baileys suele entregarlo igual, así que preferimos no repetir: este mensaje
      // dice "tu equipo será bloqueado" y recibirlo varias veces alarma al cliente.
      await db.collection('financing').updateOne(
        { id: record.id },
        {
          $set: {
            lastReminderSent: todayStr,
            // Campo aparte para el tope de 3 días: si reusáramos lastReminderSent
            // no podríamos distinguir "ya le escribí hoy" de "ya le insistí por mora".
            ...(tipoAviso === 'mora' ? { lastOverdueReminderSent: todayStr } : {}),
            ...(success ? {} : { ultimoAvisoSinConfirmar: true }),
          },
        }
      );
      if (tipoAviso === 'mora') avisosMoraEnviados++;
      console.log(`[financing] Aviso (${tipoAviso}) ${success ? 'enviado' : 'despachado SIN confirmar'} a ${record.nombre} (${record.telefono})`);

      // Delay entre mensajes para no ser bloqueado
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  } catch (err) {
    console.error('[financing] Error en cron de recordatorios:', err);
  } finally {
    financingReminderRunning = false;
  }
}

let scheduledNotificationsInterval: NodeJS.Timeout | null = null;

/**
 * Candado de reentrada. SIN ESTO PASÓ ESTO (incidente 2026-09-30):
 * el cron corre cada 60 s, pero cada vuelta esperaba 3 s de cortesía por mensaje y,
 * si un envío se quedaba colgado, no terminaba nunca. Al minuto arrancaba otra vuelta
 * ENCIMA de la anterior, leía los mismos documentos (que seguían en 'pending' porque
 * la vuelta anterior aún no los había marcado) y los volvía a enviar. Resultado real
 * en producción: un cliente recibió el mismo mensaje 42 veces, y las vueltas solapadas
 * saturaron el socket de Baileys, dejando las notificaciones de pedido nuevo
 * encoladas unos 15 minutos.
 */
let scheduledNotificationsRunning = false;

/** Un envío colgado no puede bloquear la cola entera. */
const ENVIO_PROGRAMADO_TIMEOUT_MS = 20000;
/** Máximo de mensajes por vuelta, para que un ciclo no se eternice. */
const MAX_PROGRAMADOS_POR_CICLO = 25;
/** Si el proceso muere a mitad de un envío la fila queda en 'processing'; la rescatamos. */
const RECLAMO_PROGRAMADOS_MS = 5 * 60 * 1000;

async function checkScheduledNotifications() {
  if (scheduledNotificationsRunning) {
    console.log('[Scheduled-WA] La vuelta anterior sigue en curso; se omite este turno.');
    return;
  }
  scheduledNotificationsRunning = true;

  try {
    // Rescatar lo que quedó atascado en 'processing' por un reinicio del servidor.
    const limite = new Date(Date.now() - RECLAMO_PROGRAMADOS_MS).toISOString();
    const rescatados = await db.collection('scheduled_notifications').updateMany(
      { status: 'processing', claimedAt: { $lt: limite } },
      { $set: { status: 'pending' }, $unset: { claimedAt: '' } }
    );
    if (rescatados.modifiedCount > 0) {
      console.log(`[Scheduled-WA] ${rescatados.modifiedCount} mensajes atascados devueltos a la cola.`);
    }

    if (whatsappService.getStatus() !== 'connected') return;

    let procesados = 0;
    while (procesados < MAX_PROGRAMADOS_POR_CICLO) {
      const ahora = new Date().toISOString();

      // Tomamos los mensajes DE UNO EN UNO y de forma atómica: findOneAndUpdate marca
      // la fila como 'processing' en la misma operación en que la lee, así que ni
      // aunque se solaparan dos vueltas podrían coger el mismo mensaje las dos.
      const tomado = await db.collection('scheduled_notifications').findOneAndUpdate(
        { status: 'pending', sendAt: { $lte: ahora } },
        { $set: { status: 'processing', claimedAt: ahora } },
        { returnDocument: 'after' }
      );
      // El driver 6/7 devuelve el documento directo; el 5 lo envolvía en .value.
      const notif: any = (tomado && (tomado as any).value !== undefined) ? (tomado as any).value : tomado;
      if (!notif || !notif._id) break;

      if (whatsappService.getStatus() !== 'connected') {
        await db.collection('scheduled_notifications').updateOne(
          { _id: notif._id },
          { $set: { status: 'pending' }, $unset: { claimedAt: '' } }
        );
        console.log('[Scheduled-WA] WhatsApp se desconectó; se reanuda en el próximo ciclo.');
        break;
      }

      let enviado = false;
      try {
        enviado = await Promise.race([
          whatsappService.sendMessage(notif.phone, notif.message),
          new Promise<boolean>(r => setTimeout(() => r(false), ENVIO_PROGRAMADO_TIMEOUT_MS)),
        ]);
      } catch (err) {
        console.error(`[Scheduled-WA] Error al enviar a ${notif.phone}:`, err);
      }

      // OJO: aunque no llegue confirmación lo damos por consumido y NO lo reintentamos.
      // Baileys suele entregarlo igual unos minutos después; si lo devolviéramos a
      // 'pending' el cliente recibiría el mensaje dos veces. Preferimos un mensaje
      // sin confirmar antes que repetir spam.
      await db.collection('scheduled_notifications').updateOne(
        { _id: notif._id },
        {
          $set: {
            status: 'sent',
            sentAt: new Date().toISOString(),
            ...(enviado ? {} : { sinConfirmar: true, lastError: 'Sin confirmación dentro del timeout' }),
          },
          $unset: { claimedAt: '' },
        }
      );
      console.log(`[Scheduled-WA] Mensaje ${enviado ? 'enviado' : 'despachado SIN confirmar'} a ${notif.phone}`);

      procesados++;
      // Pequeño delay de cortesía para no parecer spam ante WhatsApp.
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    if (procesados > 0) {
      console.log(`[Scheduled-WA] Vuelta terminada: ${procesados} mensajes procesados.`);
    }
  } catch (error) {
    console.error('[Scheduled-WA] Error en cron de mensajes programados:', error);
  } finally {
    scheduledNotificationsRunning = false;
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

// ====================================================================
// 🔒  CREDILOCK — bloqueo remoto de equipos financiados
// ====================================================================
//
// `db` se reasigna cada vez que se reconecta a Mongo, así que el módulo recibe
// un getter y no el valor: pasarlo por valor le dejaría una referencia muerta
// tras la primera reconexión.
const depsBloqueo: DepsBloqueo = {
  getDb: () => db,
  // Los avisos de cobro salen SIEMPRE por el número de CREDILOCK, nunca por el
  // comercial, igual que los recordatorios de financiamiento.
  enviarWhatsApp: (telefono, texto) => credilockService.sendMessage(telefono, texto),
  whatsappListo: () => credilockService.getStatus() === 'connected',
  nombreBonito,
  // Para que el aviso de bloqueo traiga el botón de pagar: el cliente al que se
  // le acaba de apagar el teléfono es el que más necesita poder resolverlo solo,
  // y pasa a la madrugada o un domingo, cuando no hay nadie en la tienda.
  linkPortal: (registro) => linkPortal(BASE_PUBLICA, secretoPortal, registro),
  // El de la pantalla de bloqueo. Asigna el código la primera vez que a ese
  // cliente se le bloquea el equipo, y a partir de ahí es siempre el mismo:
  // puede leerlo hoy, apuntarlo, y volver a usarlo en el siguiente bloqueo.
  linkCortoPortal: async (registro) => {
    const codigo = await asegurarCodigoCorto(db, String(registro?.id || ''));
    return codigo ? `${PORTAL_DOMINIO_CORTO}/p/${codigo}` : null;
  },
};
registrarBloqueo(app, depsBloqueo);

// ====================================================================
// 🔗  PORTAL DEL CLIENTE — ver cuotas, pagar en línea, pedir plazo
// ====================================================================

/**
 * Freno por IP para las acciones del portal.
 *
 * Es más holgado que `escritura-publica` (20/10min) porque aquí un mismo
 * cliente hace varias cosas seguidas de forma legítima: abre el link, mira el
 * resumen, intenta subir un comprobante que pesa demasiado, lo reintenta
 * reducido, y después le da a pagar. Con 20 se quedaba fuera a mitad de camino.
 *
 * Y va por IP y no por token a propósito: el token es público —está en el
 * WhatsApp del cliente— así que limitarlo por token dejaría que cualquiera que
 * lo vea agote la cuota del dueño del link y lo deje sin poder pagar.
 */
const limitarPortal = limitadorPorIp('portal-cliente', 40, 10 * 60 * 1000);

/**
 * Le avisa al dueño de algo que tiene que decidir él (una solicitud de plazo
 * que no entró en las reglas automáticas, un pago que llegó sin registro).
 *
 * El número sale de `DUENO_WHATSAPP` o, si no está, de `settings`. Cuando no
 * hay ninguno de los dos NO se cae ni se queda callado: deja el aviso en el log
 * y lo emite por socket, que es donde el panel lo puede mostrar. La alternativa
 * —tirar el aviso a la basura— significaría solicitudes que nadie ve nunca.
 */
async function avisarAlDueno(texto: string): Promise<void> {
  const mensaje = String(texto || '').trim();
  if (!mensaje) return;

  // Siempre al log y al panel, haya WhatsApp o no. Es el rastro que queda.
  console.log('[portal][aviso-dueño]', mensaje.replace(/\n+/g, ' | '));
  try { io.emit('portalAviso', { texto: mensaje, en: new Date().toISOString() }); } catch { /* el socket no es crítico */ }

  let crudo = (process.env.DUENO_WHATSAPP || '').trim();
  if (!crudo && db) {
    try {
      const doc = await db.collection('settings').findOne({ key: 'dueno_whatsapp' });
      crudo = String(doc?.value || '').trim();
    } catch { /* si Mongo no responde, el aviso ya quedó en el log */ }
  }
  if (!crudo) return;

  const telefono = normalizarTelefonoCo(crudo);
  if (!telefono) {
    console.warn('[portal][aviso-dueño] El número configurado no es un móvil colombiano válido:', crudo);
    return;
  }
  if (!depsBloqueo.whatsappListo()) return;

  try {
    await depsBloqueo.enviarWhatsApp(telefono, mensaje);
  } catch (err) {
    console.error('[portal][aviso-dueño] No se pudo enviar:', err);
  }
}

// Igual que con el bloqueo: getters y no valores, porque `db` se reasigna en
// cada reconexión y `secretoPortal` se llena después de arrancar el servidor.
/**
 * Config de Bold para las llamadas salientes, o `null` si no hay llave.
 *
 * Se lee en caliente —y no una vez al arrancar— porque las variables de entorno
 * pueden aparecer en un redeploy sin que este código se toque.
 */
function configBold(): ConfigBold | null {
  const apiKey = (process.env.BOLD_API_KEY || '').trim();
  return apiKey ? { apiKey } : null;
}

const depsPortal: DepsPortal = {
  getDb: () => db,
  secreto: () => secretoPortal,
  baseUrl: () => BASE_PUBLICA,
  // Sin llaves de Bold el portal no muestra un botón de pago muerto: ofrece
  // escribir por WhatsApp. Se consulta en caliente porque las variables de
  // entorno pueden aparecer en un redeploy sin tocar este código.
  boldConfigurado: () => Boolean(process.env.BOLD_API_KEY && process.env.BOLD_SECRET_KEY),
  // El link lo crea la API de Link de Pagos y no el botón embebido, porque es la
  // única de las dos que acepta `payment_methods`: aquí se cobra sin tarjeta a
  // propósito. El motivo largo está en la cabecera de portal-rutas.ts.
  crearLinkPago: (o) => crearLinkDePago(configBold()!, o),
  // Todo lo de cartera sale por el número de CREDILOCK, nunca por el comercial.
  enviarWhatsApp: (telefono, texto) => credilockService.sendMessage(telefono, texto),
  whatsappListo: () => credilockService.getStatus() === 'connected',
  nombreBonito,
  hoy: () => getColombiaDate().dateStr,
  parsearImagen: parseBase64Image,
  maxBytesComprobante: MAX_COMPROBANTE_BYTES,
  // Un pago o un plazo del portal sueltan el equipo por el MISMO camino que el
  // panel. Si el portal tuviera su propia lógica de desbloqueo, un día una de
  // las dos se quedaría sin el arreglo que se le hizo a la otra.
  alRegistrarPago: (financingId) => alRegistrarPago(depsBloqueo, financingId),
  alOtorgarProrroga: (financingId, hasta, cuotaNumber) =>
    alOtorgarProrroga(depsBloqueo, financingId, hasta, cuotaNumber),
  avisarAlDueno,
  emitir: (evento, datos) => io.emit(evento, datos as any),
  limitador: limitarPortal,
};
registrarPortal(app, depsPortal);

/* ═══════════════════════  Conciliador de pagos de Bold  ════════════════════ */

const depsConciliador: DepsConciliador = {
  getDb: () => db,
  bold: configBold,
  // Exactamente los mismos caminos que usa el webhook. Si el conciliador
  // tuviera los suyos, un arreglo hecho en uno dejaría el otro atrás.
  confirmarCuotas: (referencia, extra) =>
    confirmarPagoDeCuotas(depsPortal, referencia, extra),
  confirmarPedido: (pedido, metodo) => transitionOrderAndNotify(pedido, 'paid', metodo),
  avisarAlDueno,
};

/**
 * Cada 4 minutos. Es un compromiso entre dos cosas:
 *
 *  - Un cliente que paga a las 2am y se queda bloqueado no debería esperar más
 *    que un café.
 *  - Cada vuelta son llamadas a la API de Bold, y en el caso normal —webhook
 *    funcionando— no encuentra absolutamente nada que hacer.
 *
 * El `catch` de arriba es deliberado: un error aquí no puede tumbar el proceso,
 * porque este proceso también es el que atiende la tienda.
 */
const MINUTOS_CONCILIACION = 4;
let conciliacionEnCurso = false;

async function vueltaDeConciliacion(): Promise<void> {
  // Sin este cerrojo, una vuelta lenta se solaparía con la siguiente y las dos
  // leerían las mismas intenciones pendientes.
  if (conciliacionEnCurso || !db) return;
  conciliacionEnCurso = true;
  try {
    await conciliarPagos(depsConciliador);
  } catch (err) {
    console.error('[conciliador] Vuelta fallida:', err);
  } finally {
    conciliacionEnCurso = false;
  }
}

setInterval(vueltaDeConciliacion, MINUTOS_CONCILIACION * 60 * 1000);

httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

void connectDB();
