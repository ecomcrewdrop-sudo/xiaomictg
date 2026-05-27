import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from './lib/db.js';
import { ObjectId } from 'mongodb';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  const db = await getDb();

  if (req.method === 'GET') {
    try {
      const notifications = await db.collection('notifications').find({}).sort({ createdAt: -1 }).limit(50).toArray();
      return res.json(notifications);
    } catch (error) {
      return res.status(500).json({ error: 'Error fetching notifications' });
    }
  }

  if (req.method === 'PUT') {
    try {
      const { id } = req.body;
      if (id) {
        await db.collection('notifications').updateOne(
          { _id: new ObjectId(id) },
          { $set: { read: true } }
        );
        return res.json({ success: true });
      }
      return res.status(400).json({ error: 'ID is required' });
    } catch (error) {
      return res.status(500).json({ error: 'Error updating notification' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const { id } = req.body;
      if (id) {
        await db.collection('notifications').deleteOne({ _id: new ObjectId(id) });
        return res.json({ success: true });
      }
      return res.status(400).json({ error: 'ID is required' });
    } catch (error) {
      return res.status(500).json({ error: 'Error deleting notification' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
