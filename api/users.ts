import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from './lib/db.js';
import { createHash } from 'crypto';

function hashPassword(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const db = await getDb();
  const usersCollection = db.collection('users');

  if (req.method === 'GET') {
    try {
      const users = await usersCollection.find({}, { projection: { password: 0 } }).toArray();
      return res.json(users);
    } catch (error) {
      return res.status(500).json({ error: 'Error fetching users' });
    }
  }

  if (req.method === 'POST') {
    try {
      const { username, password, role } = req.body;
      
      if (!username || !password) {
        return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
      }

      const existingUser = await usersCollection.findOne({ username });
      if (existingUser) {
        return res.status(400).json({ error: 'El usuario ya existe' });
      }

      const result = await usersCollection.insertOne({
        username,
        password: hashPassword(password),
        role: role || 'admin',
        createdAt: new Date().toISOString()
      });

      return res.json({ 
        success: true, 
        user: { 
          _id: result.insertedId, 
          username, 
          role: role || 'admin' 
        } 
      });
    } catch (error) {
      return res.status(500).json({ error: 'Error creating user' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
