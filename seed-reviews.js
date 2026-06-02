import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('No MONGO_URI');
  process.exit(1);
}

const AUTHORS = [
  "Carlos Martínez", "María Fernanda", "Jorge Ruiz", "Ana Sofía", "Luis González", 
  "Carolina Herrera", "Andrés Felipe", "Diana Carolina", "Juan Pablo", "Camila Gómez",
  "Diego Fernando", "Valentina Ríos", "Sebastián Castro", "Laura Muñoz", "José Luis"
];

const COMMENTS_5 = [
  "Excelente producto, totalmente recomendado.",
  "¡Me encantó! Llegó súper rápido y funciona perfecto.",
  "La mejor compra que he hecho. Calidad precio insuperable.",
  "Todo perfecto, sellado y original como lo prometen.",
  "Muy buena atención y el equipo es una bala. 10/10."
];

const COMMENTS_4 = [
  "Muy buen equipo, aunque la batería podría durar un poco más.",
  "Llegó bien y rápido, pero la caja venía un poco golpeada.",
  "Funciona de maravilla, recomendado. Solo tuve dudas con la configuración inicial.",
  "Buen celular por el precio. Cumple con lo que necesito.",
  "Todo bien, me gustó mucho la cámara."
];

// Generar una fecha aleatoria en el último mes
function getRandomDate() {
  const now = new Date();
  const past = new Date(now.getTime() - Math.random() * 30 * 24 * 60 * 60 * 1000);
  return past.toISOString();
}

async function run() {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    console.log('Conectado a MongoDB');
    const db = client.db();
    
    // Obtener productos
    const products = await db.collection('products').find({}).toArray();
    console.log(`Encontrados ${products.length} productos.`);

    // Eliminar reseñas anteriores (opcional, pero asegura que no se saturen si corremos el script varias veces)
    await db.collection('reviews').deleteMany({});
    console.log('Reseñas anteriores eliminadas.');

    const newReviews = [];

    for (const product of products) {
      // Generar entre 3 y 8 reseñas por producto
      const numReviews = Math.floor(Math.random() * 6) + 3; 
      
      for (let i = 0; i < numReviews; i++) {
        // Para que quede entre 3.9 y 4.7, necesitamos la mayoría de 5 y 4, 
        // y muy pocas de 3. Nada de 1 o 2.
        const rand = Math.random();
        let rating = 5;
        let comment = COMMENTS_5[Math.floor(Math.random() * COMMENTS_5.length)];
        
        if (rand > 0.6) {
          rating = 4;
          comment = COMMENTS_4[Math.floor(Math.random() * COMMENTS_4.length)];
        }
        if (rand > 0.95) {
          rating = 3;
          comment = "Es un producto decente, pero esperaba un poco más por el precio.";
        }

        newReviews.push({
          productId: product.id,
          author: AUTHORS[Math.floor(Math.random() * AUTHORS.length)],
          rating,
          comment,
          status: 'approved',
          verifiedPurchase: true,
          date: getRandomDate(),
        });
      }
    }

    if (newReviews.length > 0) {
      await db.collection('reviews').insertMany(newReviews);
      console.log(`Se insertaron ${newReviews.length} reseñas con éxito.`);
    }

  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}

run();
