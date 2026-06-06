import { useState, useEffect } from 'react';
import { Order, TicketConfig } from './ProductContext';

interface ThermalTicketProps {
  order: Order;
  finalTotal: number;
  cardFee: number;
  addiFee?: number;
  totalCOP: number;
  finalTotalCOP: number;
  ticketId?: string;
  config?: TicketConfig;
  preview?: boolean;
}

const defaultConfig: TicketConfig = {
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

export function ThermalTicket({ order, finalTotal, cardFee, addiFee = 0, totalCOP, finalTotalCOP, ticketId = 'thermal-ticket', config, preview = false }: ThermalTicketProps) {
  const [ticketConfig, setTicketConfig] = useState<TicketConfig>(config || defaultConfig);
  const orderDate = new Date(order.createdAt);
  
  useEffect(() => {
    async function fetchTicketConfig() {
      try {
        console.log('=== Fetching ticket config ===');
        const res = await fetch('/api/ticket-config');
        console.log('Response status:', res.status);
        if (res.ok) {
          const data = await res.json();
          console.log('Ticket config loaded:', data);
          setTicketConfig(data);
        }
      } catch (error) {
        console.error('Error fetching ticket config:', error);
      }
    }
    fetchTicketConfig();
  }, []);

  useEffect(() => {
    if (config) {
      setTicketConfig(config);
    }
  }, [config]);

  const c = ticketConfig;
  const exchangeRate = 1;
  const nitValue = c.nit || '1043345642-7';
  
  return (
    <div 
      id={ticketId} 
      style={{
        width: '302px',
        backgroundColor: 'white',
        padding: '16px',
        fontFamily: "'Courier New', Courier, monospace", // More authentic thermal font
        fontSize: '12px',
        lineHeight: '1.4',
        position: preview ? 'relative' : 'absolute',
        left: preview ? 'auto' : '-9999px',
        top: preview ? 'auto' : '-9999px',
        color: 'black',
        margin: preview ? '0 auto' : '0'
      }}
    >
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '16px', borderBottom: '2px dashed #000', paddingBottom: '12px' }}>
        <div style={{ fontSize: '22px', fontWeight: 'bold', marginBottom: '4px', textTransform: 'uppercase' }}>{c.storeName}</div>
        {c.tagline && <div style={{ fontSize: '11px', marginBottom: '6px' }}>{c.tagline}</div>}
        <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>NIT: {nitValue}</div>
        
        <div style={{ fontSize: '10px', marginTop: '8px' }}>{c.address}</div>
        <div style={{ fontSize: '10px' }}>{c.city}</div>
        <div style={{ fontSize: '10px', marginTop: '4px', fontWeight: 'bold' }}>Tel: {c.phone}</div>
        <div style={{ fontSize: '10px', marginTop: '4px' }}>{c.website}</div>
      </div>

      {/* Información de la orden */}
      <div style={{ marginBottom: '12px', fontSize: '11px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
          <strong>ORDEN:</strong>
          <span style={{ fontWeight: 'bold' }}>#{order.orderNumber}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
          <strong>FECHA:</strong>
          <span>{orderDate.toLocaleDateString('es-CO')}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <strong>HORA:</strong>
          <span>{orderDate.toLocaleTimeString('es-CO', { hour12: true })}</span>
        </div>
      </div>

      {/* Línea divisoria */}
      <div style={{ borderTop: '1px dashed #000', margin: '10px 0' }}></div>

      {/* Información del cliente */}
      <div style={{ marginBottom: '12px', fontSize: '11px' }}>
        <div style={{ marginBottom: '4px', fontWeight: 'bold' }}>CLIENTE</div>
        <div>Nombre: <span style={{ textTransform: 'uppercase' }}>{order.customerInfo?.name || 'N/A'}</span></div>
        <div>Cédula: {order.customerInfo?.idNumber || 'N/A'}</div>
        <div>Tel: {order.customerInfo?.phone || 'N/A'}</div>
        <div style={{ wordBreak: 'break-all' }}>Email: {order.customerInfo?.email || 'N/A'}</div>
      </div>

      {/* Línea divisoria */}
      <div style={{ borderTop: '1px dashed #000', margin: '10px 0' }}></div>

      {/* Método de entrega */}
      <div style={{ marginBottom: '12px', fontSize: '11px' }}>
        <div style={{ marginBottom: '4px', fontWeight: 'bold' }}>ENTREGA</div>
        <div style={{ textTransform: 'uppercase' }}>
          {order.customerInfo?.deliveryMethod === 'delivery' ? 'Envío a domicilio' : 'Retiro en tienda'}
        </div>
        {order.customerInfo?.deliveryMethod === 'delivery' && (
          <div style={{ wordBreak: 'break-word', marginTop: '2px' }}>Dir: {order.customerInfo?.address}</div>
        )}
      </div>

      {/* Línea gruesa antes de productos */}
      <div style={{ borderTop: '2px solid #000', margin: '10px 0' }}></div>

      {/* Productos */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '8px' }}>PRODUCTOS</div>
        {order.items.map((item, index) => (
          <div key={index} style={{ marginBottom: '10px', fontSize: '11px' }}>
            <div style={{ fontWeight: 'bold', textTransform: 'uppercase' }}>
              {item.product.name}
            </div>
            <div style={{ fontSize: '10px', marginBottom: '4px' }}>
              {item.selectedStorage && <span>[{item.selectedStorage}] </span>}
              {item.selectedColor && <span>- Color: {item.selectedColor}</span>}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <span>{item.quantity} x ${(item.product.price * exchangeRate).toLocaleString('es-CO')}</span>
              <strong style={{ fontSize: '12px' }}>${(item.product.price * item.quantity * exchangeRate).toLocaleString('es-CO')}</strong>
            </div>
            {/* Mostrar seriales: uno por unidad si hay array, o el serial único */}
            {item.serialNumbers && item.serialNumbers.length > 0
              ? item.serialNumbers.map((sn, snIdx) => sn ? (
                  <div key={snIdx} style={{ fontSize: '10px', marginTop: '4px' }}>
                    IMEI {item.serialNumbers!.length > 1 ? `#${snIdx + 1}` : ''}: {sn}
                  </div>
                ) : null)
              : item.serialNumber && (
                  <div style={{ fontSize: '10px', marginTop: '4px' }}>
                    SN: {item.serialNumber}
                  </div>
                )
            }
            {item.invoiceNumber && (
              <div style={{ fontSize: '10px', marginTop: '2px' }}>
                Factura: {item.invoiceNumber}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Línea divisoria */}
      <div style={{ borderTop: '1px dashed #000', margin: '10px 0' }}></div>

      {/* Totales */}
      <div style={{ fontSize: '11px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
          <span>Subtotal:</span>
          <span>${totalCOP.toLocaleString('es-CO')}</span>
        </div>
        {(order.customerInfo?.deliveryFee || 0) > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span>Domicilio:</span>
            <span>${order.customerInfo.deliveryFee.toLocaleString('es-CO')}</span>
          </div>
        )}
        {cardFee > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span>Recargo Tarjeta (5%):</span>
            <span>${(cardFee * exchangeRate).toLocaleString('es-CO')}</span>
          </div>
        )}
        {addiFee > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span>Recargo Addi (25%):</span>
            <span>${(addiFee * exchangeRate).toLocaleString('es-CO')}</span>
          </div>
        )}
        
        {/* Línea gruesa antes del total final */}
        <div style={{ borderTop: '2px solid #000', margin: '10px 0' }}></div>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '16px', fontWeight: 'bold' }}>
          <span>TOTAL:</span>
          <span>${finalTotalCOP.toLocaleString('es-CO')} COP</span>
        </div>
      </div>

      {/* Método de pago */}
      <div style={{ marginBottom: '16px', fontSize: '11px', borderTop: '1px dashed #000', paddingTop: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <strong>MÉTODO DE PAGO:</strong>
          <span style={{ textTransform: 'uppercase' }}>{order.paymentMethod}</span>
        </div>
        {order.customerInfo?.cardType && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
            <strong>TIPO:</strong>
            <span style={{ textTransform: 'uppercase' }}>{order.customerInfo.cardType}</span>
          </div>
        )}
      </div>

      {/* Línea decorativa */}
      <div style={{ borderTop: '2px dashed #000', margin: '16px 0' }}></div>

      {/* Footer */}
      <div style={{ textAlign: 'center', fontSize: '10px', marginTop: '16px' }}>
        <div style={{ marginBottom: '12px', fontWeight: 'bold', fontSize: '14px', textTransform: 'uppercase' }}>{c.footerMessage}</div>
        
        <div style={{ marginTop: '12px', lineHeight: '1.5', textAlign: 'justify' }}>{c.warrantyMessage}</div>
        
        <div style={{ marginTop: '12px' }}>
          <div style={{ fontWeight: 'bold', marginBottom: '2px' }}>Horario de atención:</div>
          <div>{c.schedule}</div>
        </div>
        
        <div style={{ marginTop: '16px', fontWeight: 'bold', fontSize: '12px' }}>
          Estado: {order.status === 'pending' ? '⏳ PENDIENTE' : order.status === 'processing' ? '🔄 PROCESANDO' : order.status === 'completed' ? '✅ COMPLETADO' : '❌ CANCELADO'}
        </div>
      </div>

      {/* Línea divisoria y Código de barras simulado */}
      <div style={{ 
        marginTop: '16px', 
        textAlign: 'center',
        borderTop: '1px dashed #000',
        paddingTop: '16px'
      }}>
        <div style={{ 
          display: 'inline-block',
          border: '2px solid #000',
          padding: '10px 16px',
          fontSize: '16px',
          fontWeight: 'bold',
          letterSpacing: '3px'
        }}>
          {order.orderNumber}
        </div>
      </div>
    </div>
  );
}
