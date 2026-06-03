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
  "Diego Fernando", "Valentina Ríos", "Sebastián Castro", "Laura Muñoz", "José Luis",
  "Mateo Rojas", "Valeria Pineda", "Daniela Vega", "Miguel Ángel", "Santiago López"
];

// Comentarios por categoría para evitar incongruencias
const COMMENTS_POR_CATEGORIA = {
  telefonos: {
    5: [
      "Excelente celular, la cámara es increíble y va súper fluido.",
      "Llegó súper rápido y la batería dura todo el día sin problemas.",
      "La mejor compra que he hecho. Calidad precio insuperable en teléfonos.",
      "Todo perfecto, sellado y original. El rendimiento en juegos es top.",
      "Muy buena atención y el equipo vuela. 10/10."
    ],
    4: [
      "Muy buen teléfono, aunque me gustaría que trajera funda incluida.",
      "Llegó bien y rápido, la cámara frontal me parece apenas decente.",
      "Funciona de maravilla, muy rápido. Solo la carga inicial tardó un poco.",
      "Buen celular por el precio. Cumple con lo que necesito.",
      "Todo bien, me gustó mucho el diseño y la pantalla."
    ],
    3: [
      "Es un celular decente, pero el sonido podría mejorar."
    ]
  },
  accesorios: { // Audífonos, powerbanks, etc.
    5: [
      "Excelente calidad de audio, se escuchan perfecto.",
      "Súper cómodos y el material se siente de mucha calidad.",
      "La batería les dura muchísimo, valen cada peso.",
      "Todo original y sellado. Muy prácticos para llevar a todos lados.",
      "10/10, los uso para hacer ejercicio y no se caen."
    ],
    4: [
      "Se escuchan muy bien, aunque el estuche se raya fácil.",
      "Buena relación calidad-precio. Cumplen su función.",
      "Buen sonido, pero tardan un poquito en conectarse al bluetooth.",
      "Son cómodos y bonitos. Todo llegó en orden."
    ],
    3: [
      "Son buenos, pero después de un par de horas pueden llegar a cansar un poco."
    ]
  },
  scooter: { // Patinetas
    5: [
      "Una maravilla para moverme por la ciudad, la autonomía es brutal.",
      "Súper potente, sube pendientes sin problema. 100% original.",
      "Me ahorra muchísimo tiempo en tráfico. Totalmente recomendada.",
      "Llegó armada prácticamente, solo fue ajustar y a rodar. Excelente.",
      "Los frenos son precisos y las llantas de buena calidad."
    ],
    4: [
      "Muy buena patineta, solo que es un poco pesada para subir escaleras.",
      "Cumple muy bien, aunque en terrenos empedrados vibra un poco.",
      "Rápida y segura, la batería dura un poco menos en subidas largas."
    ],
    3: [
      "Es buena patineta, pero para personas muy altas el manillar queda un poco bajo."
    ]
  },
  relojes: { // Smartwatches
    5: [
      "La pantalla se ve increíble incluso bajo el sol, súper preciso en el pulso.",
      "Excelente reloj, las notificaciones llegan al instante y la batería dura días.",
      "Muy bonito diseño, ligero y con muchísimos modos de deporte.",
      "Me encantó, 100% original. Monitorea todo el sueño a la perfección."
    ],
    4: [
      "Muy buen smartwatch, aunque algunas correas son difíciles de conseguir.",
      "Cumple con todas las funciones. Me gustaría que tuviera más carátulas gratis.",
      "Buen reloj inteligente, mide bien los pasos y las calorías."
    ],
    3: [
      "Es bonito, pero pensé que se podían responder mensajes directamente desde él."
    ]
  },
  combo: { // Teléfono + Audífonos / Regalo
    5: [
      "Excelente promoción, el celular es una bala y los audífonos de regalo suenan brutal.",
      "Súper recomendado. Llegó el celular y los audífonos sellados en perfecto estado.",
      "La mejor compra, te llevas dos productos top por un precio increíble.",
      "El teléfono funciona perfecto y el regalo de los audífonos es un detallazo. ¡10/10!",
      "Me encantó el combo. Ambos productos originales y el envío fue rapidísimo."
    ],
    4: [
      "Buen combo, el celular es muy rápido aunque los audífonos tardan en conectar a veces.",
      "Llegó todo completo, el celular y el regalo. La caja venía un poquito golpeada pero todo bien adentro.",
      "Excelente relación calidad-precio por los dos productos, recomendado."
    ],
    3: [
      "El celular es bueno pero los audífonos de regalo podrían tener mejor bajo."
    ]
  },
  hogar: { // Aspiradoras, purificadores, freidoras
    5: [
      "Me ha facilitado la vida un montón, súper recomendada.",
      "Excelente potencia, la aplicación funciona perfecto y mapea muy bien.",
      "Llegó rapidísimo. Un electrodoméstico indispensable en la casa.",
      "Cumple 100% lo que promete. Muy buena calidad de materiales.",
      "Gran inversión para el hogar. Funciona de maravilla."
    ],
    4: [
      "Muy buen producto, aunque los repuestos a veces son escasos.",
      "Funciona muy bien, pero hace un poco más de ruido del que esperaba.",
      "Hace su trabajo, la conexión con la app fue un poco demorada."
    ],
    3: [
      "Es bueno, pero el manual es un poco confuso para configurarlo al principio."
    ]
  },
  generico: { // Por si hay productos sin categoría clara
    5: [
      "Excelente producto, totalmente recomendado.",
      "¡Me encantó! Llegó súper rápido y funciona perfecto.",
      "La mejor compra que he hecho. Calidad precio insuperable.",
      "Todo perfecto, sellado y original como lo prometen.",
      "Muy buena atención y el producto es excelente. 10/10."
    ],
    4: [
      "Muy buen artículo, aunque el manual podría ser más claro.",
      "Llegó bien y rápido, pero la caja venía un poco maltratada.",
      "Funciona de maravilla, recomendado. Lo uso todos los días.",
      "Buen producto por el precio. Cumple con lo que necesito."
    ],
    3: [
      "Es un producto decente, pero esperaba un poco más por el precio."
    ]
  }
};

// Asignar categoría lógica si el producto no la tiene clara
function mapCategory(product) {
  const name = (product.name || "").toLowerCase();
  const cat = (product.category || "").toLowerCase();

  // Detectar combos (ej. Poco M5s + Audifonos o regalos)
  if (name.includes(' + ') || name.includes('regalo') || name.includes('combo')) return 'combo';

  if (name.includes('vacuum') || name.includes('aspiradora') || name.includes('robot') || name.includes('air fryer') || name.includes('purifier') || cat.includes('hogar')) return 'hogar';
  if (cat.includes('scooter') || name.includes('scooter') || name.includes('patineta')) return 'scooter';
  if (name.includes('watch') || name.includes('band') || name.includes('reloj') || cat.includes('reloj') || cat.includes('band')) return 'relojes';
  if (name.includes('buds') || name.includes('audifonos') || name.includes('audífonos') || name.includes('earphones') || cat.includes('accesorio') || cat.includes('audio')) return 'accesorios';
  
  // Por defecto, si es redmi, poco o xiaomi sin las palabras anteriores, asumimos celular
  if (cat.includes('telefono') || cat.includes('celular') || name.includes('poco') || name.includes('redmi') || name.includes('xiaomi 1') || name.includes('pro')) return 'telefonos';

  return 'generico';
}

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
    
    const products = await db.collection('products').find({}).toArray();
    console.log(`Encontrados ${products.length} productos.`);

    await db.collection('reviews').deleteMany({});
    console.log('Reseñas genéricas anteriores eliminadas.');

    const newReviews = [];

    for (const product of products) {
      const numReviews = Math.floor(Math.random() * 6) + 3; 
      const mappedCat = mapCategory(product);
      const commentsPool = COMMENTS_POR_CATEGORIA[mappedCat];
      
      for (let i = 0; i < numReviews; i++) {
        const rand = Math.random();
        let rating = 5;
        let comment = commentsPool['5'][Math.floor(Math.random() * commentsPool['5'].length)];
        
        if (rand > 0.6) {
          rating = 4;
          comment = commentsPool['4'][Math.floor(Math.random() * commentsPool['4'].length)];
        }
        if (rand > 0.95) {
          rating = 3;
          comment = commentsPool['3'][Math.floor(Math.random() * commentsPool['3'].length)];
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
      console.log(`Se insertaron ${newReviews.length} reseñas específicas con éxito.`);
    }

  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}

run();
