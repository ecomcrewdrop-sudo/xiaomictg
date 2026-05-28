import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from './lib/db.js';
import { Resend } from 'resend';

// Aumentar límite del body — el carrito puede incluir datos de múltiples productos
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '15mb'
    }
  }
};

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

function sanitizeImageUrl(image: unknown): string {
  if (typeof image !== 'string' || !image) return '';
  if (image.startsWith('data:')) return '';
  if (image.length > 2048 && !image.startsWith('http') && !image.includes('/api/media/')) {
    return '';
  }
  if (
    image.startsWith('http://') ||
    image.startsWith('https://') ||
    image.includes('/api/media/')
  ) {
    return image;
  }
  return '';
}

type OrderItemDoc = {
  product?: { id?: string; image?: string; [key: string]: unknown };
  [key: string]: unknown;
};

type OrderDoc = {
  items?: OrderItemDoc[];
  [key: string]: unknown;
};

async function hydrateOrdersWithProductImages(
  db: Awaited<ReturnType<typeof getDb>>,
  orders: OrderDoc[]
): Promise<OrderDoc[]> {
  const productIds = new Set<string>();
  for (const order of orders) {
    for (const item of order.items || []) {
      const pid = item.product?.id;
      if (typeof pid === 'string' && pid) productIds.add(pid);
    }
  }

  const imageById = new Map<string, string>();
  if (productIds.size > 0) {
    const products = await db
      .collection('products')
      .find({ id: { $in: [...productIds] } })
      .project({ id: 1, image: 1 })
      .toArray();
    for (const p of products) {
      const id = typeof p.id === 'string' ? p.id : '';
      if (id) imageById.set(id, sanitizeImageUrl(p.image));
    }
  }

  return orders.map((order) => ({
    ...order,
    items: (order.items || []).map((item) => {
      const product = item.product || {};
      const stored = sanitizeImageUrl(product.image);
      const fromCatalog =
        typeof product.id === 'string' ? imageById.get(product.id) || '' : '';
      return {
        ...item,
        product: { ...product, image: stored || fromCatalog },
      };
    }),
  }));
}

async function sendOrderEmail(order: any) {
  if (!resend) {
    console.log('RESEND_API_KEY not configured, skipping email');
    return;
  }
  
  try {
    const db = await getDb();
    const ticketConfig = await db.collection('ticketConfig').findOne({ type: 'config' });
    
    const config = ticketConfig || {
      storeName: 'XIAOMI STORE',
      tagline: 'Tecnología Premium',
      address: 'Cl. 31 #61-64, Los Ángeles',
      city: 'Cartagena de Indias',
      phone: '(605) 123-4567',
      website: 'www.xiaomi.com',
      footerMessage: '¡Gracias por tu compra!',
      warrantyMessage: 'Conserva este ticket para tu garantía',
      schedule: 'Lun - Vie: 9:00 AM - 7:00 PM | Dom: 10:30 AM - 3:00 PM'
    };

    const deliveryFee = order.customerInfo?.deliveryFee || 0;
    const isCard = order.paymentMethod?.toLowerCase().includes('tarjeta') || order.paymentMethod?.toLowerCase().includes('bold');
    const cardFee = isCard ? Math.round(order.total * 0.05) : 0;
    const grandTotal = order.total + cardFee + deliveryFee;

    const itemsHtml = order.items.map((item: any) => {
      const imageUrl = item.product?.image || '';
      const imageHtml = imageUrl ? `<img src="${imageUrl}" alt="${item.product.name}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 4px; margin-right: 10px;" />` : '';
      return `
        <li style="display: flex; align-items: center; margin-bottom: 15px; padding: 10px; background: #f9f9f9; border-radius: 8px;">
          ${imageHtml}
          <div>
            <strong>${item.product?.name || 'Producto'}</strong><br/>
            <span style="color: #666;">Cantidad: ${item.quantity}</span><br/>
            <span style="color: #e65100; font-weight: bold;">$${((item.product?.price || 0) * item.quantity).toFixed(2)}</span>
          </div>
        </li>
      `;
    }).join('');

    const emailHtml = `
      <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
        <div style="background-color: #ff6900; padding: 30px 20px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 28px; letter-spacing: -0.5px;">¡Tu pedido ha sido confirmado! 🎉</h1>
          <p style="color: #fff3e0; margin: 10px 0 0 0; font-size: 16px;">Gracias por elegir Xiaomi Cartagena</p>
        </div>
        
        <div style="padding: 30px;">
          <p style="font-size: 16px; color: #333; line-height: 1.5; margin-top: 0;">Hola <strong>${order.customerInfo?.name || 'Cliente'}</strong>,</p>
          <p style="font-size: 16px; color: #555; line-height: 1.5;">Hemos recibido tu orden <strong>#${order.orderNumber}</strong> y estamos preparándola con mucho cuidado.</p>
          
          <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #ff6900;">
            <h3 style="margin-top: 0; color: #333; font-size: 16px; text-transform: uppercase; letter-spacing: 0.5px;">Resumen de tu Orden</h3>
            <ul style="list-style: none; padding: 0; margin: 0;">${itemsHtml}</ul>
            
            <div style="margin-top: 20px; padding-top: 15px; border-top: 1px dashed #ccc; text-align: right;">
              <p style="margin: 5px 0; font-size: 14px; color: #666;">Subtotal: $${order.total.toLocaleString('es-CO')} COP</p>
              ${deliveryFee > 0 ? `<p style="margin: 5px 0; font-size: 14px; color: #666;">Envío: $${deliveryFee.toLocaleString('es-CO')} COP</p>` : ''}
              ${cardFee > 0 ? `<p style="margin: 5px 0; font-size: 14px; color: #666;">Recargo Tarjeta (5%): $${cardFee.toLocaleString('es-CO')} COP</p>` : ''}
              <h2 style="margin: 10px 0 0 0; color: #ff6900; font-size: 22px;">Total: $${grandTotal.toLocaleString('es-CO')} COP</h2>
            </div>
          </div>
          
          <div style="margin-top: 25px;">
            <h4 style="color: #333; margin-bottom: 10px; font-size: 15px;">Detalles de Entrega</h4>
            <p style="margin: 5px 0; color: #555; font-size: 14px;"><strong>Método:</strong> ${order.customerInfo?.deliveryMethod === 'delivery' ? 'Domicilio' : 'Retiro en tienda'}</p>
            ${order.customerInfo?.deliveryMethod === 'delivery' ? `<p style="margin: 5px 0; color: #555; font-size: 14px;"><strong>Dirección:</strong> ${order.customerInfo?.address || ''}</p>` : ''}
            <p style="margin: 5px 0; color: #555; font-size: 14px;"><strong>Pago:</strong> ${order.paymentMethod}</p>
          </div>
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; text-align: center;">
            <p style="color: #888; font-size: 13px; margin: 0;">¿Tienes alguna pregunta? Contáctanos a nuestro WhatsApp: ${config.phone}</p>
          </div>
        </div>
      </div>
    `;

    const toEmails = ['xiaomi.cartagenaventas@gmail.com'];
    if (order.customerInfo?.email) {
      toEmails.push(order.customerInfo.email);
    }

    await resend.emails.send({
      from: 'Xiaomi Cartagena <ventas@xiaomicartagena.com>',
      to: toEmails,
      subject: `Confirmación de Pedido #${order.orderNumber} - Xiaomi Cartagena`,
      html: emailHtml
    });

    console.log('Email sent successfully');
  } catch (error) {
    console.error('Error sending email:', error);
  }
}

async function sendInvoiceEmail(order: any) {
  if (!resend) {
    console.log('RESEND_API_KEY not configured, skipping email');
    return;
  }
  
  try {
    const db = await getDb();
    const ticketConfig = await db.collection('ticketConfig').findOne({ type: 'config' });
    
    const config = ticketConfig || {
      storeName: 'XIAOMI STORE',
      tagline: 'Tecnología Premium',
      address: 'Cl. 31 #61-64, Los Ángeles',
      city: 'Cartagena de Indias',
      phone: '302 287 5280',
      nit: '1043345642-7',
      website: 'www.xiaomicartagena.com',
      footerMessage: '¡Gracias por tu compra!',
      warrantyMessage: 'Conserva este ticket para tu garantía',
      schedule: 'Lun - Vie: 9:00 AM - 7:00 PM | Dom: 10:30 AM - 3:00 PM'
    };

    const deliveryFee = order.customerInfo?.deliveryFee || 0;
    const isCard = order.paymentMethod?.toLowerCase().includes('tarjeta') || order.paymentMethod?.toLowerCase().includes('bold');
    const cardFee = isCard ? Math.round(order.total * 0.05) : 0;
    const grandTotal = order.total + cardFee + deliveryFee;
    const nitValue = config.nit || '1043345642-7';

    const ticketHtml = `
      <div style="border: 2px solid #333; padding: 20px; max-width: 320px; font-family: 'Courier New', Courier, monospace; font-size: 12px; background: #fff; margin: 0 auto; color: #000;">
        <div style="text-align: center; border-bottom: 2px dashed #000; padding-bottom: 12px; margin-bottom: 16px;">
          <h2 style="margin: 0 0 4px 0; font-size: 22px; text-transform: uppercase;">${config.storeName}</h2>
          <p style="margin: 0 0 6px 0; font-size: 11px;">${config.tagline}</p>
          <p style="margin: 0 0 4px 0; font-weight: bold; font-size: 12px;">NIT: ${nitValue}</p>
          <p style="margin: 8px 0 0 0; font-size: 10px;">${config.address}</p>
          <p style="margin: 0; font-size: 10px;">${config.city}</p>
          <p style="margin: 4px 0 0 0; font-size: 10px; font-weight: bold;">Tel: ${config.phone}</p>
          <p style="margin: 4px 0 0 0; font-size: 10px;">${config.website}</p>
        </div>
        
        <div style="margin-bottom: 12px; font-size: 11px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <strong>ORDEN:</strong> <span style="font-weight: bold;">#${order.orderNumber}</span>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
            <strong>FECHA:</strong> <span>${new Date(order.date).toLocaleDateString('es-CO')}</span>
          </div>
        </div>
        
        <div style="border-top: 1px dashed #000; margin: 10px 0;"></div>
        
        <div style="margin-bottom: 12px; font-size: 11px;">
          <div style="margin-bottom: 4px; font-weight: bold;">CLIENTE</div>
          <div>Nombre: <span style="text-transform: uppercase;">${order.customerInfo?.name || 'N/A'}</span></div>
          <div>Cédula/NIT: ${order.customerInfo?.idNumber || 'N/A'}</div>
          <div>Tel: ${order.customerInfo?.phone || 'N/A'}</div>
        </div>

        <div style="border-top: 1px dashed #000; margin: 10px 0;"></div>
        
        <div style="margin-bottom: 12px; font-size: 11px;">
          <div style="margin-bottom: 4px; font-weight: bold;">ENTREGA</div>
          <div style="text-transform: uppercase;">${order.customerInfo?.deliveryMethod === 'delivery' ? 'Envío a domicilio' : 'Retiro en tienda'}</div>
          ${order.customerInfo?.deliveryMethod === 'delivery' ? `<div style="margin-top: 2px;">Dir: ${order.customerInfo?.address || ''}</div>` : ''}
        </div>

        <div style="border-top: 2px solid #000; margin: 10px 0;"></div>
        
        <div style="margin-bottom: 12px;">
          <div style="font-size: 12px; font-weight: bold; margin-bottom: 8px;">PRODUCTOS</div>
          ${order.items.map((item: any) => `
            <div style="margin-bottom: 10px; font-size: 11px;">
              <div style="font-weight: bold; text-transform: uppercase;">${item.product?.name || 'Producto'}</div>
              <div style="font-size: 10px; margin-bottom: 4px;">
                ${item.selectedStorage ? `[${item.selectedStorage}]` : ''} 
                ${item.selectedColor ? `- Color: ${item.selectedColor}` : ''}
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span>${item.quantity} x $${(item.product?.price || 0).toLocaleString('es-CO')}</span>
                <strong>$${((item.product?.price || 0) * item.quantity).toLocaleString('es-CO')}</strong>
              </div>
              ${item.serialNumber ? `<div style="font-size: 10px; margin-top: 4px;">SN: ${item.serialNumber}</div>` : ''}
              ${item.invoiceNumber ? `<div style="font-size: 10px; margin-top: 2px;">Factura: ${item.invoiceNumber}</div>` : ''}
            </div>
          `).join('')}
        </div>
        
        <div style="border-top: 1px dashed #000; margin: 10px 0;"></div>

        <div style="font-size: 11px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span>Subtotal:</span>
            <span>$${order.total.toLocaleString('es-CO')}</span>
          </div>
          ${deliveryFee > 0 ? `
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span>Domicilio:</span>
            <span>$${deliveryFee.toLocaleString('es-CO')}</span>
          </div>` : ''}
          ${cardFee > 0 ? `
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span>Recargo Tarjeta (5%):</span>
            <span>$${cardFee.toLocaleString('es-CO')}</span>
          </div>` : ''}
          
          <div style="border-top: 2px solid #000; margin: 10px 0;"></div>
          
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 16px; font-weight: bold;">
            <span>TOTAL:</span>
            <span>$${grandTotal.toLocaleString('es-CO')} COP</span>
          </div>
        </div>

        <div style="margin-bottom: 16px; font-size: 11px; border-top: 1px dashed #000; padding-top: 10px;">
          <div style="display: flex; justify-content: space-between;">
            <strong>MÉTODO DE PAGO:</strong>
            <span style="text-transform: uppercase;">${order.paymentMethod}</span>
          </div>
        </div>
        
        <div style="border-top: 2px dashed #000; margin: 16px 0;"></div>
        
        <div style="text-align: center; font-size: 10px; margin-top: 16px;">
          <div style="margin-bottom: 12px; font-weight: bold; font-size: 14px; text-transform: uppercase;">${config.footerMessage}</div>
          <div style="margin-top: 12px; line-height: 1.5; text-align: justify;">${config.warrantyMessage}</div>
          <div style="margin-top: 12px;">
            <div style="font-weight: bold; margin-bottom: 2px;">Horario de atención:</div>
            <div>${config.schedule}</div>
          </div>
        </div>
      </div>
    `;

    const emailHtml = `
      <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #333; margin-bottom: 10px;">Tu Factura Oficial</h1>
          <p style="color: #666; font-size: 16px;">Hola <strong>${order.customerInfo?.name}</strong>, adjuntamos tu ticket de compra detallado de la orden #${order.orderNumber}.</p>
        </div>
        
        <div style="background-color: #f9f9f9; padding: 30px; border-radius: 12px;">
          ${ticketHtml}
        </div>
        
        <div style="text-align: center; margin-top: 30px;">
          <p style="color: #888; font-size: 13px;">Si tienes alguna duda con tu factura, contáctanos a nuestro WhatsApp: ${config.phone}</p>
        </div>
      </div>
    `;

    await resend.emails.send({
      from: 'Xiaomi Cartagena <ventas@xiaomicartagena.com>',
      to: [order.customerInfo.email],
      subject: `Factura Oficial - Orden #${order.orderNumber} - Xiaomi Cartagena`,
      html: emailHtml
    });
  } catch (error) {
    console.error('Error sending invoice email:', error);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
  
  let db;
  try {
    db = await getDb();
  } catch (err: any) {
    console.error('[orders] DB connection error:', err.message);
    return res.status(500).json({ error: 'Error connecting to database: ' + err.message });
  }
  
  const collection = db.collection('orders');
  
  let orderId = '';
  if (req.query.path) {
    const pathParts = (req.query.path as string).split('/');
    orderId = pathParts[pathParts.length - 1];
  } else if (req.body && req.body.id) {
    orderId = req.body.id;
  }

  if (req.method === 'GET') {
    if (orderId && orderId !== 'orders') {
      try {
        const order = await collection.findOne({ id: orderId });
        if (!order) return res.status(404).json({ error: 'Order not found' });
        return res.json(order);
      } catch (error) {
        return res.status(500).json({ error: 'Error fetching order' });
      }
    }
    try {
      const orders = await collection.find({})
        .project({ 'items.product.image': 0 })
        .sort({ createdAt: -1 })
        .toArray();
      return res.json(await hydrateOrdersWithProductImages(db, orders as OrderDoc[]));
    } catch (error) {
      return res.status(500).json({ error: 'Error fetching orders' });
    }
  }

  if (req.method === 'POST') {
    try {
      const { action, order: invoiceOrder } = req.body;
      
      if (action === 'send-invoice') {
        if (!invoiceOrder || !invoiceOrder.customerInfo?.email) {
          return res.status(400).json({ error: 'Invalid order or missing email' });
        }
        await sendInvoiceEmail(invoiceOrder);
        return res.json({ success: true });
      }

      const { orderNumber: clientOrderNumber, date, createdAt, items, total, status, customerInfo, paymentMethod } = req.body;

      // Validación básica de la orden
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'La orden debe tener al menos un producto' });
      }
      if (total === undefined || total === null || isNaN(Number(total)) || Number(total) < 0) {
        return res.status(400).json({ error: 'Total inválido' });
      }

      const id = Date.now().toString();
      const orderNumber = clientOrderNumber || `XM-${Date.now().toString().slice(-8)}`;
      const now = new Date().toISOString();
      const order = {
        id,
        orderNumber,
        date: date || now,
        createdAt: createdAt || now,
        items,
        total,
        status: status || 'pending',
        customerInfo,
        paymentMethod
      };
      
      await collection.insertOne(order);

      const notification = {
        orderId: id,
        orderNumber,
        total,
        message: `Nuevo pedido recibido: ${orderNumber}`,
        createdAt: new Date().toISOString(),
        read: false
      };
      await db.collection('notifications').insertOne(notification);

      const [hydratedOrder] = await hydrateOrdersWithProductImages(db, [order as OrderDoc]);
      sendOrderEmail(hydratedOrder).catch(err => console.error('Error sending email:', err));

      return res.json(hydratedOrder);
    } catch (error) {
      return res.status(500).json({ error: 'Error creating order' });
    }
  }

  if (req.method === 'PUT' && orderId) {
    try {
      const { status, items, customerInfo, total } = req.body;
      const updateData: any = {};
      if (status) updateData.status = status;
      if (items) updateData.items = items;
      if (customerInfo) updateData.customerInfo = customerInfo;
      if (total !== undefined) updateData.total = total;
      
      await collection.updateOne(
        { id: orderId },
        { $set: updateData }
      );
      return res.json({ id: orderId, ...updateData });
    } catch (error) {
      return res.status(500).json({ error: 'Error updating order' });
    }
  }

  if (req.method === 'DELETE' && orderId) {
    try {
      await collection.deleteOne({ id: orderId });
      return res.json({ success: true, id: orderId });
    } catch (error) {
      return res.status(500).json({ error: 'Error deleting order' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error('=== Orders API Error ===');
    console.error('Error:', error.message || error);
    console.error('Stack:', error.stack);
    return res.status(500).json({ error: 'Internal server error: ' + (error.message || 'Unknown error') });
  }
}
