import type { VercelRequest, VercelResponse } from '@vercel/node';
import { put } from '@vercel/blob';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '15mb'
    }
  }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.error('BLOB_READ_WRITE_TOKEN no está configurado');
    return res.status(500).json({ error: 'Blob storage no configurado' });
  }

  try {
    const { image, filename, productId, folder = 'productos' } = req.body;

    if (!image || !filename) {
      return res.status(400).json({ error: 'image y filename son requeridos' });
    }

    // Soportar base64 con o sin prefijo data:
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Determinar extensión del archivo original
    const ext = filename.split('.').pop() || 'jpg';
    const safeFolder = ['productos', 'banners', 'general'].includes(folder) ? folder : 'productos';
    const uniqueFilename = `${safeFolder}/${productId || Date.now()}-${Date.now()}.${ext}`;

    const blob = await put(uniqueFilename, buffer, {
      access: 'public',
      token,
    });

    console.log(`✅ Imagen subida a Vercel Blob: ${blob.url}`);
    return res.json({ url: blob.url, success: true });

  } catch (error: any) {
    console.error('Error subiendo a Blob:', error);
    return res.status(500).json({ error: 'Error al subir imagen: ' + error.message });
  }
}
