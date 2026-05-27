import { MongoClient, MongoNotConnectedError, MongoNetworkError } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  throw new Error('MONGO_URI environment variable is not defined');
}

let cachedClient: MongoClient | null = null;
let isConnecting = false;

export async function getDb() {
  // Si ya hay cliente y la conexión está activa, reutilizarla
  if (cachedClient) {
    try {
      // Ping rápido para verificar que la conexión sigue viva
      await cachedClient.db().admin().ping();
      return cachedClient.db();
    } catch {
      // Conexión caída — limpiar y reconectar
      console.warn('[DB] Conexión perdida, reconectando...');
      try { await cachedClient.close(); } catch {}
      cachedClient = null;
    }
  }

  // Evitar múltiples conexiones simultáneas en funciones serverless
  if (isConnecting) {
    await new Promise(resolve => setTimeout(resolve, 200));
    if (cachedClient) return cachedClient.db();
  }

  isConnecting = true;

  try {
    const client = new MongoClient(MONGO_URI!, {
      maxPoolSize: 10,
      minPoolSize: 1,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      serverSelectionTimeoutMS: 30000,
    });

    await client.connect();
    cachedClient = client;
    console.log('[DB] Conectado a MongoDB');
    return cachedClient.db();
  } finally {
    isConnecting = false;
  }
}
