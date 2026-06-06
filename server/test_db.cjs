require('dotenv').config({path: '../.env'});
const { MongoClient } = require('mongodb');
async function run() {
  const client = new MongoClient(process.env.MONGO_URI);
  await client.connect();
  const db = client.db('xiaomi_cartagena');
  const result = await db.collection('products').updateOne(
    { id: '1774469611961' },
    { $set: { isFeatured: true } }
  );
  console.log('Update result:', result);
  const p = await db.collection('products').findOne({ id: '1774469611961' });
  console.log('Updated isFeatured:', p.isFeatured);
  await client.close();
}
run();
