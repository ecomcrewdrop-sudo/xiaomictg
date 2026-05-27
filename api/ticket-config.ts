import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from './lib/db.js';

const defaultTicketConfig = {
  storeName: 'XIAOMI STORE',
  tagline: 'Tecnología Premium',
  address: 'Cl. 31 #61-64, Los Ángeles',
  city: 'Cartagena de Indias',
  phone: '(605) 123-4567',
  website: 'www.xiaomi.com',
  footerMessage: '¡Gracias por tu compra!',
  warrantyMessage: 'Conserva este ticket para tu garantía',
  schedule: 'Lunes a Viernes: 9:00 AM - 6:00 PM'
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  const db = await getDb();
  const collection = db.collection('ticketConfig');

  if (req.method === 'GET') {
    try {
      let config = await collection.findOne({ type: 'config' });
      if (!config) {
        await collection.insertOne({ type: 'config', ...defaultTicketConfig });
        config = await collection.findOne({ type: 'config' });
      }
      return res.json(config);
    } catch (error) {
      return res.status(500).json({ error: 'Error fetching ticket config' });
    }
  }

  if (req.method === 'PUT') {
    try {
      const config = req.body;
      await collection.updateOne(
        { type: 'config' },
        { $set: { ...config, type: 'config' } },
        { upsert: true }
      );
      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: 'Error updating ticket config' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
