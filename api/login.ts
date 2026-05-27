import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from './lib/db.js';
import { generateToken } from './lib/auth.js';
import { createHash } from 'crypto';

/** Hash simple SHA-256 para comparar contraseñas almacenadas en texto plano (legacy).
 *  Las contraseñas nuevas deberían guardarse ya hasheadas. */
function hashPassword(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Usuario y contraseña requeridos' });
  }

  // Sanitizar
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ success: false, message: 'Datos inválidos' });
  }

  try {
    const db = await getDb();
    const usersCollection = db.collection('users');

    // Buscar usuario — soporta contraseñas en texto plano (legacy) y hasheadas
    const hashedPwd = hashPassword(password);
    const user = await usersCollection.findOne({
      username: username.trim(),
      $or: [{ password }, { password: hashedPwd }],
    });

    if (user) {
      const token = generateToken(user.username, user.role || 'admin');
      return res.json({
        success: true,
        token,
        user: { username: user.username, role: user.role },
      });
    } else {
      return res.status(401).json({ success: false, message: 'Credenciales incorrectas' });
    }
  } catch (error) {
    console.error('[login] Error:', error);
    return res.status(500).json({ success: false, message: 'Error del servidor' });
  }
}
