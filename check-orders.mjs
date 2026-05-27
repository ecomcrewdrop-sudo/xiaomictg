import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config();

const uri = process.env.MONGO_URI;

async function checkOrders() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    console.log("Conectado a MongoDB");
    const db = client.db();
    
    const count = await db.collection('orders').countDocuments();
    console.log(`Total órdenes en DB: ${count}`);
    
    if (count > 0) {
      const orders = await db.collection('orders').find({}).sort({ createdAt: -1 }).limit(1).toArray();
      console.log("Estructura de la última orden:");
      console.log(JSON.stringify(orders[0], null, 2).substring(0, 500) + "...");
    }
    
    // Verificar si hay errores al proyectar sin imagen
    try {
      const projectedOrders = await db.collection('orders').find({})
        .project({ "items.product.image": 0 })
        .sort({ createdAt: -1 })
        .toArray();
      console.log(`Órdenes obtenidas con proyección: ${projectedOrders.length}`);
    } catch (err) {
      console.error("Error al hacer find con proyección:", err.message);
    }

  } catch (error) {
    console.error("Error conectando:", error);
  } finally {
    await client.close();
  }
}

checkOrders();
