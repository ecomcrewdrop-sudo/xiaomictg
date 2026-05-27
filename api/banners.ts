import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from './lib/db.js';
import { ObjectId } from 'mongodb';
import { put } from '@vercel/blob';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '15mb'
    }
  }
};

async function uploadImageIfNeeded(image: string | undefined): Promise<string | undefined> {
  if (!image || !image.startsWith('data:')) return image;

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.warn('BLOB_READ_WRITE_TOKEN no configurado — guardando base64');
    return image;
  }

  try {
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const filename = `banners/banner-${Date.now()}.jpg`;
    const blob = await put(filename, buffer, { access: 'public', token });
    console.log(`✅ Banner subido a Blob: ${blob.url}`);
    return blob.url;
  } catch (err: any) {
    console.error('Error subiendo banner a Blob:', err);
    return image; // fallback: guardar base64
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Parsear body de forma segura (puede llegar como string en algunos entornos)
  let body = req.body;
  if (typeof req.body === 'string') {
    try { body = JSON.parse(req.body); } catch { body = {}; }
  }

  const db = await getDb();
  const collection = db.collection('banners');

  if (req.method === 'GET') {
    try {
      const banners = await collection.find({}).toArray();
      return res.json(banners.map((b: any) => ({
        _id: b._id?.toString(),
        title: b.title,
        subtitle: b.subtitle,
        description: b.description,
        buttonText: b.buttonText,
        buttonLink: b.buttonLink,
        backgroundImage: b.backgroundImage
      })));
    } catch (error) {
      return res.status(500).json({ error: 'Error fetching banners' });
    }
  }

  if (req.method === 'POST') {
    try {
      const { title, subtitle, description, buttonText, buttonLink, backgroundImage } = body;
      if (!title) return res.status(400).json({ error: 'title es obligatorio' });
      const imageUrl = await uploadImageIfNeeded(backgroundImage);
      const banner = { title, subtitle, description, buttonText, buttonLink, backgroundImage: imageUrl };
      const result = await collection.insertOne(banner);
      return res.status(201).json({ _id: result.insertedId.toString(), ...banner });
    } catch (error: any) {
      console.error('Error creating banner:', error);
      return res.status(500).json({ error: 'Error al crear el banner: ' + error.message });
    }
  }

  if (req.method === 'PUT') {
    try {
      const { id, title, subtitle, description, buttonText, buttonLink, backgroundImage } = body;
      if (!id || !ObjectId.isValid(id)) {
        return res.status(400).json({ error: 'ID de banner inválido' });
      }
      const imageUrl = await uploadImageIfNeeded(backgroundImage);
      const update = { title, subtitle, description, buttonText, buttonLink, backgroundImage: imageUrl };
      const result = await collection.updateOne(
        { _id: new ObjectId(id) },
        { $set: update }
      );
      if (result.matchedCount === 0) {
        return res.status(404).json({ error: 'Banner no encontrado' });
      }
      return res.json({ id, ...update });
    } catch (error: any) {
      console.error('Error updating banner:', error);
      return res.status(500).json({ error: 'Error al actualizar el banner: ' + error.message });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const { id } = body;
      if (!id || !ObjectId.isValid(id)) {
        return res.status(400).json({ error: 'ID de banner inválido' });
      }
      await collection.deleteOne({ _id: new ObjectId(id) });
      return res.json({ success: true });
    } catch (error: any) {
      console.error('Error deleting banner:', error);
      return res.status(500).json({ error: 'Error al eliminar el banner: ' + error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
