import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from './lib/db.js';
import { ObjectId } from 'mongodb';

// Aumentar límite del body para soportar imágenes base64 (~5MB imagen = ~7MB base64)
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '15mb'
    }
  }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  let body = req.body;
  if (typeof req.body === 'string') {
    try {
      body = JSON.parse(req.body);
    } catch (e) {
      body = {};
    }
  }
  
  const db = await getDb();
  const collection = db.collection('products');

  let productId = '';
  if (req.query.path) {
    const pathParts = (req.query.path as string).split('/');
    productId = pathParts[pathParts.length - 1];
  } else if (body && body.id) {
    productId = body.id;
  }

  if (req.method === 'GET') {
    if (productId) {
      try {
        const product = await collection.findOne({ id: productId });
        if (!product) {
          return res.status(404).json({ error: 'Product not found' });
        }
        return res.json(product);
      } catch (error) {
        return res.status(500).json({ error: 'Error fetching product' });
      }
    }
    try {
      const products = await collection.find({}).toArray();
      return res.json(products);
    } catch (error) {
      return res.status(500).json({ error: 'Error fetching products' });
    }
  }

  if (req.method === 'POST') {
    try {
      // Usar `body` (ya parseado arriba), NO req.body directamente
      const { name, category, price, description, image, stock, colorVariants, storageVariants, specifications, reviews } = body;

      if (!name || price === undefined) {
        return res.status(400).json({ error: 'name y price son obligatorios' });
      }

      const newId = Date.now().toString();
      const product = {
        id: newId,
        name,
        category,
        price: Number(price),
        description: description || '',
        image: image || '',
        stock: Number(stock) || 0,
        colorVariants: colorVariants || [],
        storageVariants: storageVariants || [],
        specifications: specifications || {},
        reviews: reviews || []
      };
      await collection.insertOne(product);
      return res.status(201).json(product);
    } catch (error: any) {
      console.error('Error creating product:', error);
      return res.status(500).json({ error: 'Error al crear el producto: ' + error.message });
    }
  }

  if (req.method === 'PUT' && productId) {
    try {
      // Usar `body` (ya parseado arriba)
      const { name, category, price, description, image, stock, colorVariants, storageVariants, specifications, reviews } = body;
      const updateFields: any = {};
      if (name !== undefined) updateFields.name = name;
      if (category !== undefined) updateFields.category = category;
      if (price !== undefined) updateFields.price = Number(price);
      if (description !== undefined) updateFields.description = description;
      if (image !== undefined) updateFields.image = image;
      if (stock !== undefined) updateFields.stock = Number(stock);
      if (colorVariants !== undefined) updateFields.colorVariants = colorVariants;
      if (storageVariants !== undefined) updateFields.storageVariants = storageVariants;
      if (specifications !== undefined) updateFields.specifications = specifications;
      if (reviews !== undefined) updateFields.reviews = reviews;

      // Construir la query correctamente (soportar tanto id string como _id ObjectId)
      let query: any = { id: productId };
      try {
        if (ObjectId.isValid(productId) && productId.length === 24) {
          query = { $or: [{ id: productId }, { _id: new ObjectId(productId) }] };
        }
      } catch (_) { /* productId no es un ObjectId válido, se usa query por id */ }

      const result = await collection.updateOne(query, { $set: updateFields });
      if (result.matchedCount === 0) {
        return res.status(404).json({ error: 'Producto no encontrado' });
      }
      return res.json({ id: productId, ...updateFields });
    } catch (error: any) {
      console.error('Error updating product:', error);
      return res.status(500).json({ error: 'Error al actualizar el producto: ' + error.message });
    }
  }

  if (req.method === 'DELETE' && productId) {
    try {
      let query: any = { id: productId };
      if (ObjectId.isValid(productId) && productId.length === 24) {
        query = { $or: [{ id: productId }, { _id: new ObjectId(productId) }] };
      }
      const result = await collection.deleteOne(query);
      return res.json({ success: true, deletedCount: result.deletedCount });
    } catch (error: any) {
      console.error('Error deleting product:', error);
      return res.status(500).json({ error: 'Error deleting product' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
