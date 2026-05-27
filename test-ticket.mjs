const API_URL = 'https://xiaomicartagena.com/api';

const testOrder = {
  items: [
    {
      product: {
        id: 'test-3',
        name: 'Xiaomi Poco X5',
        price: 950000,
        category: 'moviles',
        description: 'Prueba ticket',
        image: '',
        stock: 3
      },
      quantity: 1,
      selectedColor: 'Verde',
      selectedStorage: '128GB'
    }
  ],
  customerInfo: {
    name: 'Verificacion Ticket',
    email: 'verificacion@prueba.com',
    phone: '3105555555',
    idNumber: '11111111',
    deliveryMethod: 'pickup',
    address: ''
  },
  paymentMethod: 'Efectivo',
  total: 950000,
  status: 'pending'
};

async function createTestOrder() {
  console.log('=== Orden para verificar ticket ===');
  
  const res = await fetch(`${API_URL}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(testOrder)
  });
  
  const data = await res.json();
  console.log('Orden:', data.orderNumber);
  console.log('Ve a la tienda, completa una compra y verifica el ticket');
}

createTestOrder();
