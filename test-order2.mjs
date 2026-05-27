const API_URL = 'https://xiaomicartagena.com/api';

const testOrder = {
  items: [
    {
      product: {
        id: 'test-2',
        name: 'Xiaomi Mi 11',
        price: 1200000,
        category: 'moviles',
        description: 'Teléfono de prueba 2',
        image: '',
        stock: 5
      },
      quantity: 1,
      selectedColor: 'Negro',
      selectedStorage: '256GB'
    }
  ],
  customerInfo: {
    name: 'Cliente Prueba 2',
    email: 'test2@prueba.com',
    phone: '3009876543',
    idNumber: '87654321',
    deliveryMethod: 'pickup',
    address: ''
  },
  paymentMethod: 'Transferencia',
  total: 1200000,
  status: 'pending'
};

async function createTestOrder() {
  console.log('=== Creando orden de prueba 2 ===');
  
  try {
    const res = await fetch(`${API_URL}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testOrder)
    });
    
    const data = await res.json();
    console.log('Orden creada:', data.orderNumber);
    console.log('Revisa el correo para ver el ticket con:');
    console.log('- Tienda: TIENDA PRUEBA');
    console.log('- Tagline: Solo pruebas');
  } catch (error) {
    console.error('Error:', error);
  }
}

createTestOrder();
