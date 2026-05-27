import { MongoClient } from 'mongodb' with { "resolution-mode": "import" };

const MONGO_URI = 'mongodb+srv://xiaomicartagenaventas_db_user:12345678x2020@xiaomicartagena.69n0rad.mongodb.net/xiaomi_cartagena?retryWrites=true&w=majority';

const client = new MongoClient(MONGO_URI);

async function createAdmin() {
  await client.connect();
  const db = client.db();
  const usersCollection = db.collection('users');

  const adminUser = {
    username: 'adminxiaomi@xiaomi.com',
    password: 'cartagenaxiaomi2026',
    role: 'admin',
    createdAt: new Date()
  };

  const existing = await usersCollection.findOne({ username: adminUser.username });
  if (existing) {
    console.log('El usuario ya existe');
  } else {
    await usersCollection.insertOne(adminUser);
    console.log('Usuario admin creado exitosamente');
  }

  await client.close();
}

createAdmin().catch(console.error);
