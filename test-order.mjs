const API_URL = 'https://xiaomicartagena.com/api';

const testOrder = {
  items: [
    {
      product: {
        id: 'test-1',
        name: 'Xiaomi Redmi Note 12',
        price: 800000,
        category: 'moviles',
        description: 'Teléfono de prueba',
        image: '',
        stock: 10
      },
      quantity: 1,
      selectedColor: 'Azul',
      selectedStorage: '128GB'
    }
  ],
  customerInfo: {
    name: 'Cliente Prueba',
    email: 'test@prueba.com',
    phone: '3001234567',
    idNumber: '12345678',
    deliveryMethod: 'delivery',
    address: 'Calle 123, Cartagena'
  },
  paymentMethod: 'Efectivo',
  total: 800000,
  status: 'pending'
};

async function createTestOrder() {
  console.log('=== Creando orden de prueba ===');
  console.log('URL:', `${API_URL}/orders`);
  console.log('Data:', JSON.stringify(testOrder, null, 2));
  
  try {
    const res = await fetch(`${API_URL}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testOrder)
    });
    
    console.log('Status:', res.status);
    const data = await res.json();
    console.log('Response:', JSON.stringify(data, null, 2));
    
    if (res.ok) {
      console.log('✅ Orden creada exitosamente');
      console.log('Número de orden:', data.orderNumber);
      console.log('Revisa el correo xiaomi.cartagenaventas@gmail.com para ver el ticket');
    } else {
      console.log('❌ Error:', data);
    }
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

createTestOrder();
