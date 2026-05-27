import { MongoClient } from 'mongodb';
import { put } from '@vercel/blob';
import 'dotenv/config';

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://xiaomicartagenaventas_db_user:12345678x2020@xiaomicartagena.69n0rad.mongodb.net/xiaomi_cartagena?retryWrites=true&w=majority&connectTimeoutMS=30000';
const BLOB_TOKEN = 'vercel_blob_rw_hNjl5zqnBdNx2l71_hTFydHL4JOdxeKZZT3CKSGOe2EXFR6';

async function migrateImages() {
  console.log('Connecting to MongoDB...');
  const client = new MongoClient(MONGO_URI, {
    connectTimeoutMS: 30000,
    socketTimeoutMS: 30000
  });
  
  await client.connect();
  const db = client.db();
  const collection = db.collection('products');

  console.log('Finding products with base64 images...');
  const products = await collection.find({ 
    image: { $regex: '^data:' } 
  }).toArray();

  console.log(`Found ${products.length} products with base64 images`);

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const product of products) {
    try {
      console.log(`\nProcessing: ${product.name}`);
      
      const base64Data = product.image.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      
      const safeName = (product.name || 'product').replace(/[^a-zA-Z0-9]/g, '-');
      const filename = `productos/${product.id || Date.now()}-${safeName}.jpg`;
      
      console.log(`  Uploading to Vercel Blob: ${filename}`);
      
      const blob = await put(filename, buffer, {
        access: 'public',
        token: BLOB_TOKEN
      });

      await collection.updateOne(
        { _id: product._id },
        { $set: { image: blob.url } }
      );

      console.log(`  ✓ Migrated: ${blob.url}`);
      migrated++;
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (err: any) {
      console.error(`  ✗ Failed: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n=== Migration Complete ===`);
  console.log(`Migrated: ${migrated}`);
  console.log(`Failed: ${failed}`);
  console.log(`Skipped: ${skipped}`);

  await client.close();
  process.exit(0);
}

migrateImages().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
