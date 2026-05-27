const API_URL = 'https://xiaomicartagena.com/api';

function log(title, message, status = 'INFO') {
  const symbols = { 'OK': '✅', 'ERROR': '❌', 'INFO': 'ℹ️' };
  console.log(`${symbols[status]} ${title}: ${message}`);
}

async function testProducts() {
  console.log('\n' + '='.repeat(50));
  console.log('TEST: PRODUCTOS');
  console.log('='.repeat(50));
  
  try {
    // 1. Listar productos
    log('Productos', 'Obteniendo lista...', 'INFO');
    const productsRes = await fetch(`${API_URL}/products`);
    const products = await productsRes.json();
    log('Productos', `Encontrados: ${products.length}`, 'OK');
    
    // 2. Crear producto
    log('Productos', 'Creando producto de prueba...', 'INFO');
    const newProduct = {
      name: 'Producto Test ' + Date.now(),
      price: 99999,
      category: 'test',
      description: 'Producto de prueba',
      stock: 10
    };
    const createRes = await fetch(`${API_URL}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newProduct)
    });
    const createdProduct = await createRes.json();
    log('Productos', `Creado ID: ${createdProduct.id}`, 'OK');
    
    // 3. Editar producto
    log('Productos', 'Editando producto...', 'INFO');
    const editRes = await fetch(`${API_URL}/products`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: createdProduct.id, price: 88888 })
    });
    const editedProduct = await editRes.json();
    log('Productos', `Editado, nuevo precio: ${editedProduct.price}`, 'OK');
    
    // 4. Eliminar producto
    log('Productos', 'Eliminando producto...', 'INFO');
    const deleteRes = await fetch(`${API_URL}/products`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: createdProduct.id })
    });
    log('Productos', 'Eliminado', 'OK');
    
  } catch (error) {
    log('Productos', error.message, 'ERROR');
  }
}

async function testBanners() {
  console.log('\n' + '='.repeat(50));
  console.log('TEST: BANNERS');
  console.log('='.repeat(50));
  
  try {
    // 1. Listar banners
    log('Banners', 'Obteniendo lista...', 'INFO');
    const bannersRes = await fetch(`${API_URL}/banners`);
    const banners = await bannersRes.json();
    log('Banners', `Encontrados: ${banners.length}`, 'OK');
    
    // 2. Crear banner
    log('Banners', 'Creando banner de prueba...', 'INFO');
    const newBanner = {
      title: 'Banner Test ' + Date.now(),
      description: 'Banner de prueba',
      image: 'https://example.com/image.jpg',
      link: 'https://example.com'
    };
    const createRes = await fetch(`${API_URL}/banners`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newBanner)
    });
    const createdBanner = await createRes.json();
    log('Banners', `Creado ID: ${createdBanner._id || createdBanner.id}`, 'OK');
    
    // 3. Editar banner
    log('Banners', 'Editando banner...', 'INFO');
    const bannerId = createdBanner._id || createdBanner.id;
    const editRes = await fetch(`${API_URL}/banners/${bannerId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Banner Editado' })
    });
    log('Banners', 'Editado', 'OK');
    
    // 4. Eliminar banner
    log('Banners', 'Eliminando banner...', 'INFO');
    const deleteRes = await fetch(`${API_URL}/banners/${bannerId}`, {
      method: 'DELETE'
    });
    log('Banners', 'Eliminado', 'OK');
    
  } catch (error) {
    log('Banners', error.message, 'ERROR');
  }
}

async function testOrders() {
  console.log('\n' + '='.repeat(50));
  console.log('TEST: ÓRDENES');
  console.log('='.repeat(50));
  
  try {
    // 1. Listar órdenes
    log('Órdenes', 'Obteniendo lista...', 'INFO');
    const ordersRes = await fetch(`${API_URL}/orders`);
    const orders = await ordersRes.json();
    log('Órdenes', `Encontradas: ${orders.length}`, 'OK');
    
    // 2. Crear orden
    log('Órdenes', 'Creando orden de prueba...', 'INFO');
    const newOrder = {
      items: [{
        product: { id: 'test', name: 'Producto Test', price: 50000 },
        quantity: 1
      }],
      customerInfo: {
        name: 'Cliente Test',
        email: 'test@test.com',
        phone: '3000000000',
        idNumber: '12345678',
        deliveryMethod: 'pickup',
        address: ''
      },
      paymentMethod: 'Efectivo',
      total: 50000,
      status: 'pending'
    };
    const createRes = await fetch(`${API_URL}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newOrder)
    });
    const createdOrder = await createRes.json();
    log('Órdenes', `Creada ID: ${createdOrder.id}`, 'OK');
    
    // 3. Cambiar estado
    log('Órdenes', 'Cambiando estado...', 'INFO');
    const statusRes = await fetch(`${API_URL}/orders`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: createdOrder.id, status: 'processing' })
    });
    const statusOrder = await statusRes.json();
    log('Órdenes', `Nuevo estado: ${statusOrder.status}`, 'OK');
    
    // 4. Eliminar orden
    log('Órdenes', 'Eliminando orden...', 'INFO');
    const deleteRes = await fetch(`${API_URL}/orders`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: createdOrder.id })
    });
    const deleteResult = await deleteRes.json();
    log('Órdenes', `Eliminada: ${deleteResult.success}`, 'OK');
    
  } catch (error) {
    log('Órdenes', error.message, 'ERROR');
  }
}

async function testTicketConfig() {
  console.log('\n' + '='.repeat(50));
  console.log('TEST: TICKET CONFIG');
  console.log('='.repeat(50));
  
  try {
    // 1. Obtener configuración
    log('Ticket', 'Obteniendo configuración...', 'INFO');
    const configRes = await fetch(`${API_URL}/ticket-config`);
    const config = await configRes.json();
    log('Ticket', `Tienda actual: ${config.storeName}`, 'OK');
    
    // 2. Actualizar configuración
    log('Ticket', 'Actualizando configuración...', 'INFO');
    const updateRes = await fetch(`${API_URL}/ticket-config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeName: 'TIENDA TEST ' + Date.now(),
        tagline: 'Test tagline',
        address: 'Test address',
        city: 'Test city',
        phone: '12345678',
        website: 'test.com',
        footerMessage: 'Test footer',
        warrantyMessage: 'Test warranty',
        schedule: 'Test schedule'
      })
    });
    const updatedConfig = await updateRes.json();
    log('Ticket', `Actualizada: ${updatedConfig.success}`, 'OK');
    
  } catch (error) {
    log('Ticket', error.message, 'ERROR');
  }
}

async function runAllTests() {
  console.log('\n' + '#'.repeat(50));
  console.log('# PANEL DE ADMINISTRACIÓN - SUITE DE PRUEBAS');
  console.log('#'.repeat(50));
  
  await testProducts();
  await testBanners();
  await testOrders();
  await testTicketConfig();
  
  console.log('\n' + '#'.repeat(50));
  console.log('# TODOS LOS TESTS COMPLETADOS');
  console.log('#'.repeat(50));
}

runAllTests();