import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { useProducts } from './ProductContext';
import { Button } from './ui/button';
import { Minus, Plus, Trash2, ShoppingBag, CreditCard, Store, Truck, Loader2 } from 'lucide-react';
import { useState, useRef } from 'react';
import { ThermalTicket } from './ThermalTicket';
import { toast } from 'sonner';
import { API_ORIGIN } from '../lib/api-base';

const DELIVERY_FEE = 0; // Domicilio GRATIS en Cartagena

type DeliveryMethod = 'delivery' | 'pickup';
type PaymentMethod = 'efectivo' | 'transferencia' | 'tarjeta' | 'nequi' | 'bold' | 'addi';

interface CartDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CartDialog({ isOpen, onClose }: CartDialogProps) {
  const { cart, removeFromCart, updateCartQuantity, clearCart, getCartTotal, addOrder, ticketConfig } = useProducts();

  // Helper: obtener stock máximo de un item según su variante seleccionada
  const getItemMaxStock = (item: (typeof cart)[0]): number => {
    // Stock general = 0 actúa como interruptor maestro (producto agotado)
    if (item.product.stock <= 0) return 0;
    if (item.selectedStorage && item.product.storageVariants) {
      const v = item.product.storageVariants.find(v => v.storage === item.selectedStorage);
      return v?.stock ?? 0;
    }
    if (item.selectedColor && item.product.colorVariants) {
      const v = item.product.colorVariants.find(v => v.color === item.selectedColor);
      return v?.stock ?? 0;
    }
    return item.product.stock;
  };

  const [showCheckout, setShowCheckout] = useState(false);
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerIdNumber, setCustomerIdNumber] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('delivery');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('efectivo');
  const [cardType, setCardType] = useState<'debito' | 'credito'>('debito');
  const [currentOrder, setCurrentOrder] = useState<any>(null);
  const [boldLoading, setBoldLoading] = useState(false);
  const [boldError, setBoldError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Única fuente de verdad para el total: siempre desde getCartTotal() del contexto
  const totalCOP = getCartTotal();
  const addiSurcharge = paymentMethod === 'addi' ? Math.round(totalCOP * 0.20) : 0;
  const cardSurcharge = (paymentMethod === 'tarjeta' || paymentMethod === 'bold') ? Math.round(totalCOP * 0.05) : addiSurcharge;
  const deliveryFee = deliveryMethod === 'delivery' ? DELIVERY_FEE : 0;
  const grandTotal = totalCOP + cardSurcharge + deliveryFee;

  const handleClose = () => {
    setShowCheckout(false);
    setCustomerEmail('');
    setCustomerName('');
    setCustomerIdNumber('');
    setDeliveryMethod('delivery');
    setAddress('');
    setPhone('');
    setPaymentMethod('efectivo');
    setCardType('debito');
    setCurrentOrder(null);
    setBoldLoading(false);
    setBoldError('');
    onClose();
  };

  const handleCheckout = () => {
    if (cart.length === 0) return;
    setShowCheckout(true);
  };


  const downloadTicket = async (order: any) => {
    await new Promise(resolve => setTimeout(resolve, 80));

    const ticketElement = document.getElementById('thermal-ticket');
    if (!ticketElement) {
      console.error('Elemento del ticket no encontrado');
      return;
    }

    const printWindow = window.open('', '_blank', 'width=400,height=700');
    if (!printWindow) {
      toast.error('Por favor permite ventanas emergentes para imprimir el ticket.');
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Ticket #${order.orderNumber}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Courier New', Courier, monospace;
            font-size: 12px;
            background: white;
            color: black;
            width: 302px;
            padding: 16px;
          }
          @media print {
            body { width: 100%; padding: 8px; }
            .no-print { display: none !important; }
            @page { margin: 4mm; size: 80mm auto; }
          }
          .btn-print { display: block; margin: 16px auto 0; padding: 10px 24px; background: #ff5a00; color: white; border: none; border-radius: 6px; font-size: 14px; font-weight: bold; cursor: pointer; }
        </style>
      </head>
      <body>
        ${ticketElement.innerHTML}
        <div class="no-print" style="margin-top:16px;text-align:center;">
          <button class="btn-print" onclick="window.print()">🖨️ Imprimir / Guardar PDF</button>
        </div>
        <script>
          window.onload = function() {
            setTimeout(function() { window.print(); }, 200);
          };
        <\/script>
      </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleCompleteOrder = async () => {
    if (!customerName || !customerIdNumber || !customerEmail || !phone) {
      toast.error('Por favor completa todos los campos obligatorios');
      return;
    }

    if (deliveryMethod === 'delivery' && !address) {
      toast.error('Por favor ingresa el barrio/dirección de envío');
      return;
    }

    const paymentMethodText =
      paymentMethod === 'efectivo' ? 'Efectivo' :
      paymentMethod === 'transferencia' ? 'Transferencia bancaria' :
      paymentMethod === 'nequi' ? 'Nequi' :
      paymentMethod === 'llave' ? 'Llave bre-b' :
      paymentMethod === 'bold' ? 'BOLD (Tarjeta)' :
      paymentMethod === 'addi' ? 'Addi (Crédito a cuotas)' :
      'Tarjeta';

    setIsSubmitting(true);
    try {
      const newOrder = await addOrder({
        items: cart,
        total: totalCOP,
        status: 'pending',
        createdAt: new Date().toISOString(),
        customerInfo: {
          email: customerEmail,
          name: customerName,
          idNumber: customerIdNumber,
          phone: phone,
          deliveryMethod: deliveryMethod,
          address: deliveryMethod === 'delivery' ? address : 'Retiro en tienda',
          paymentMethod: paymentMethodText,
          deliveryFee: deliveryFee
        },
        paymentMethod: paymentMethodText
      });

      // Meta Pixel Event: Purchase
      if (typeof window !== 'undefined' && (window as any).fbq) {
        (window as any).fbq('track', 'Purchase', {
          content_ids: newOrder.items.map((i: any) => i.product.id),
          content_type: 'product',
          value: grandTotal,
          currency: 'COP',
          num_items: newOrder.items.length
        });
      }

      // Guardar la orden y esperar a que el ticket se renderice
      setCurrentOrder(newOrder);
      await new Promise(resolve => setTimeout(resolve, 600));
      await downloadTicket(newOrder);

      toast.success(
        `¡Pedido ${newOrder.orderNumber} realizado con éxito! Revisa tu email: ${customerEmail}`,
        { duration: 6000 }
      );

      clearCart();
      handleClose();
    } catch (err: any) {
      console.error('[CartDialog] Error al crear orden:', err);
      toast.error('Hubo un error al procesar el pedido. Intenta de nuevo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddiPayment = async () => {
    if (!customerName || !customerIdNumber || !customerEmail || !phone) {
      toast.error('Por favor completa todos los campos obligatorios antes de pagar con Addi');
      return;
    }
    if (deliveryMethod === 'delivery' && !address) {
      toast.error('Por favor ingresa el barrio/dirección de envío');
      return;
    }

    setIsSubmitting(true);
    try {
      const newOrder = await addOrder({
        items: cart,
        total: totalCOP,
        status: 'pending_addi',
        createdAt: new Date().toISOString(),
        customerInfo: {
          email: customerEmail, name: customerName, idNumber: customerIdNumber, phone, deliveryMethod,
          address: deliveryMethod === 'delivery' ? address : 'Retiro en tienda',
          paymentMethod: 'Addi (Crédito a cuotas)', deliveryFee,
        },
        paymentMethod: 'Addi (Crédito a cuotas)',
      });

      if (typeof window !== 'undefined' && (window as any).fbq) {
        (window as any).fbq('track', 'InitiateCheckout', {
          content_ids: cart.map(i => i.product.id),
          content_type: 'product',
          value: grandTotal,
          currency: 'COP',
          num_items: cart.length
        });
      }

      const nameParts = customerName.trim().split(' ');
      const firstName = nameParts[0] || 'Cliente';
      const lastName = nameParts.slice(1).join(' ') || 'Xiaomi';

      const items = cart.map(item => ({
        sku: item.product.id || 'XM-01',
        name: `${item.product.name} ${item.selectedStorage || ''}`.trim(),
        quantity: Number(item.quantity),
        unitPrice: item.product.price
      }));

      if (ticketConfig.addiMode === 'whatsapp') {
        const text = `Hola, acabo de realizar el pedido *#${newOrder.orderNumber}*
        
*🛍️ PRODUCTOS:*
${cart.map(item => `• ${item.product.name} x${item.quantity} ${item.selectedStorage ? `[${item.selectedStorage}]` : ''} ${item.selectedColor ? `(${item.selectedColor})` : ''}\n  *Financiado por Addi:* $${(((item.product.price || 0) * (item.quantity || 1)) + Math.round((item.product.price || 0) * (item.quantity || 1) * 0.20)).toLocaleString()} COP`).join('\n\n')}

*📍 DATOS DE ENVÍO:*
*Nombre:* ${customerName}
*Cédula:* ${customerIdNumber}
*Teléfono:* ${phone}
*Dirección:* ${deliveryMethod === 'delivery' ? address : 'Retiro en Tienda'}

*💳 PAGO CON ADDI A CUOTAS:*
*Subtotal:* $${(totalCOP + addiSurcharge).toLocaleString()} COP
*Envío:* $${deliveryFee.toLocaleString()} COP

💰 *TOTAL A PAGAR: $${grandTotal.toLocaleString()} COP* 💰

Seleccioné *Addi* como método de pago para pagar a cuotas. Por favor envíame el link de pago.`;
        window.location.href = `https://wa.me/57${ticketConfig.phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(text)}`;
        return;
      }

      const addiRes = await fetch(`${API_ORIGIN}/api/addi/create-transaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: newOrder.orderNumber,
          totalAmount: grandTotal,
          items,
          client: {
            idType: "CC",
            idNumber: customerIdNumber,
            firstName,
            lastName,
            email: customerEmail,
            cellphone: phone.replace(/[^0-9]/g, ''),
            cellphoneCountryCode: "+57",
            address: {
              lineOne: deliveryMethod === 'delivery' ? address : 'Tienda Fisica',
              city: "Cartagena",
              country: "CO"
            }
          }
        })
      });

      const addiData = await addiRes.json();
      if (addiData.success && addiData.redirectUrl) {
        window.location.href = addiData.redirectUrl;
      } else {
        throw new Error(addiData.error || 'Error conectando con Addi');
      }

    } catch (err: any) {
      toast.error(err.message || 'Error al iniciar pago con Addi.');
      setIsSubmitting(false);
    }
  };

  const handleBoldPayment = async () => {
    if (!customerName || !customerIdNumber || !customerEmail || !phone) {
      toast.error('Por favor completa todos los campos obligatorios antes de pagar con BOLD');
      return;
    }
    if (deliveryMethod === 'delivery' && !address) {
      toast.error('Por favor ingresa el barrio/dirección de envío');
      return;
    }

    setBoldLoading(true);
    setBoldError('');

    try {
      // 1. Registrar el pedido en la BD
      const newOrder = await addOrder({
        items: cart,
        total: totalCOP,
        status: 'pending_bold',
        createdAt: new Date().toISOString(),
        customerInfo: {
          email: customerEmail,
          name: customerName,
          idNumber: customerIdNumber,
          phone: phone,
          deliveryMethod: deliveryMethod,
          address: deliveryMethod === 'delivery' ? address : 'Retiro en tienda',
          paymentMethod: 'BOLD (Tarjeta)',
          deliveryFee: deliveryFee
        },
        paymentMethod: 'BOLD (Tarjeta)'
      });

      // Meta Pixel Event: InitiateCheckout
      if (typeof window !== 'undefined' && (window as any).fbq) {
        (window as any).fbq('track', 'InitiateCheckout', {
          content_ids: cart.map(i => i.product.id),
          content_type: 'product',
          value: grandTotal,
          currency: 'COP',
          num_items: cart.length
        });
      }

      // 2. Redirigir a /api/bold-checkout — página HTML que carga el SDK de BOLD correctamente
      const params = new URLSearchParams({
        orderId: newOrder.orderNumber,
        amount: String(grandTotal),
        currency: 'COP',
        description: cart.map(i => `${i.product.name} x${i.quantity}`).join(', ').slice(0, 200),
        redirectionUrl: `${window.location.origin}/?bold_order=${newOrder.orderNumber}&bold_status=success`,
      });

      window.location.href = `${API_ORIGIN}/api/bold-checkout?${params.toString()}`;

    } catch (err: any) {
      console.error('BOLD payment error:', err);
      setBoldError(err.message || 'Error al iniciar el pago. Intenta de nuevo.');
      setBoldLoading(false);
    }
  };


  if (showCheckout) {
    return (
      <>
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[550px] p-0 overflow-hidden bg-gray-50/50">
          <DialogHeader className="bg-white p-5 border-b border-gray-100 flex-shrink-0">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center">
                <ShoppingBag className="w-4 h-4 text-orange-600" />
              </div>
              Finaliza tu Compra
            </DialogTitle>
            <DialogDescription className="text-gray-500">
              Estás a un paso de estrenar tu equipo. Completa tu información.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 max-h-[70vh] overflow-y-auto p-5">
            
            {/* Paso 1: Información del cliente */}
            <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm space-y-4">
              <h3 className="font-bold text-gray-800 border-b border-gray-50 pb-2 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center text-xs">1</span>
                Tus Datos
              </h3>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label htmlFor="name" className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Nombre completo *</label>
                  <input
                    id="name"
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Ej. Juan Pérez"
                    className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:bg-white focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="idNumber" className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Cédula *</label>
                  <input
                    id="idNumber"
                    type="text"
                    value={customerIdNumber}
                    onChange={(e) => setCustomerIdNumber(e.target.value)}
                    placeholder="Documento de identidad"
                    className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:bg-white focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="phone" className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Teléfono *</label>
                  <input
                    id="phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Ej. 300 123 4567"
                    className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:bg-white focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all"
                    required
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="email" className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Correo Electrónico *</label>
                  <input
                    id="email"
                    type="email"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    placeholder="Para enviarte el recibo"
                    className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:bg-white focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all"
                    required
                  />
                </div>
              </div>
            </div>

            {/* Paso 2: Método de entrega */}
            <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm space-y-4">
              <h3 className="font-bold text-gray-800 border-b border-gray-50 pb-2 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center text-xs">2</span>
                Método de Entrega
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setDeliveryMethod('delivery')}
                  className={`p-4 border-2 rounded-xl transition-all flex flex-col items-center justify-center text-center ${
                    deliveryMethod === 'delivery'
                      ? 'border-orange-500 bg-orange-50/50 shadow-sm'
                      : 'border-gray-100 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <Truck className={`w-7 h-7 mb-2 ${deliveryMethod === 'delivery' ? 'text-orange-500' : 'text-gray-400'}`} />
                  <div className={`text-sm font-bold ${deliveryMethod === 'delivery' ? 'text-orange-900' : 'text-gray-700'}`}>Domicilio</div>
                  <div className="text-xs text-green-600 font-semibold mt-0.5">GRATIS</div>
                </button>
                <button
                  type="button"
                  onClick={() => setDeliveryMethod('pickup')}
                  className={`p-4 border-2 rounded-xl transition-all flex flex-col items-center justify-center text-center ${
                    deliveryMethod === 'pickup'
                      ? 'border-orange-500 bg-orange-50/50 shadow-sm'
                      : 'border-gray-100 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <Store className={`w-7 h-7 mb-2 ${deliveryMethod === 'pickup' ? 'text-orange-500' : 'text-gray-400'}`} />
                  <div className={`text-sm font-bold ${deliveryMethod === 'pickup' ? 'text-orange-900' : 'text-gray-700'}`}>Retirar en Tienda</div>
                  <div className="text-xs text-emerald-600 font-semibold mt-0.5">¡Gratis!</div>
                </button>
              </div>

              {deliveryMethod === 'delivery' && (
                <div className="pt-2">
                  <label htmlFor="address" className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Barrio y Dirección Exacta *</label>
                  <textarea
                    id="address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Ej. Barrio Manga, Calle 24 # 17-50, Apto 302"
                    rows={2}
                    className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:bg-white focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all resize-none"
                    required
                  />
                  <p className="text-[11px] text-gray-500 mt-1 flex items-center gap-1"><Truck className="w-3 h-3"/> Entrega estimada en ~1 hora en toda Cartagena.</p>
                </div>
              )}

              {deliveryMethod === 'pickup' && (
                <div className="bg-orange-50/50 border border-orange-100 rounded-lg p-3 pt-2">
                  <p className="text-[13px] text-orange-800">
                    <strong>Nuestra Tienda:</strong> Cl. 31 #61-64, Los Ángeles, Cartagena.<br/>
                    <strong>Horario:</strong> Lun - Vie: 9:00 AM - 7:00 PM | Dom: 10:30 AM - 3:00 PM
                  </p>
                </div>
              )}
            </div>

            {/* Paso 3: Método de pago */}
            <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm space-y-4">
              <h3 className="font-bold text-gray-800 border-b border-gray-50 pb-2 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center text-xs">3</span>
                Método de Pago
              </h3>
              <div>
                <select
                  id="paymentMethod"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                  className="w-full px-3 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:bg-white focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all font-medium text-gray-800 cursor-pointer appearance-none"
                  required
                >
                  <option value="efectivo">💵 Pago en Efectivo (Contra entrega)</option>
                  <option value="nequi">📱 Nequi (Contra entrega)</option>
                  <option value="transferencia">🏦 Transferencia Bancaria</option>
                  <option value="tarjeta">💳 Tarjeta con Datáfono (Contra entrega) (+5%)</option>
                  <option value="bold">🌐 Pago Seguro en Línea - BOLD (+5%)</option>
                  <option value="addi">🛍️ Paga con Addi a Cuotas</option>
                </select>

                {(paymentMethod === 'bold' || paymentMethod === 'tarjeta') && (
                  <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-800 mt-3 flex items-start gap-2">
                    <CreditCard className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>Se aplicó un recargo del <strong>5%</strong> por transacción con tarjeta. Este valor ya está sumado en el total a pagar.</span>
                  </div>
                )}
              </div>
            </div>

            {/* Total desglosado (Nuevo diseño) */}
            <div className="bg-gray-900 rounded-xl p-5 text-white shadow-xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500 rounded-full mix-blend-overlay filter blur-3xl opacity-50 translate-x-10 -translate-y-10"></div>
              <h3 className="font-semibold text-gray-300 mb-4 text-sm uppercase tracking-wider relative z-10">Resumen de Compra</h3>
              
              <div className="space-y-2.5 relative z-10">
                {cart.map((item) => (
                  <div key={`${item.product.id}-${item.selectedStorage || ''}-${item.selectedColor || 'default'}`} className="flex justify-between text-[13px] text-gray-300 border-b border-gray-700/50 pb-2">
                    <span className="truncate pr-4">
                      {item.quantity}x {item.product.name}
                    </span>
                    <span className="shrink-0">
                      ${(item.product.price * item.quantity + (paymentMethod === 'addi' ? Math.round(item.product.price * item.quantity * 0.20) : 0)).toLocaleString('es-CO')}
                    </span>
                  </div>
                ))}
                
                <div className="flex justify-between items-center text-sm pt-2 text-gray-400">
                  <span>Subtotal</span>
                  <span>${(totalCOP + (paymentMethod === 'addi' ? addiSurcharge : 0)).toLocaleString('es-CO')}</span>
                </div>
                
                {deliveryMethod === 'delivery' && (
                  <div className="flex justify-between items-center text-sm text-gray-300">
                    <span>Domicilio</span>
                    <span className="text-green-400 font-semibold">GRATIS</span>
                  </div>
                )}
                
                {(paymentMethod === 'tarjeta' || paymentMethod === 'bold') && (
                  <div className="flex justify-between items-center text-sm text-gray-300">
                    <span>Recargo (5%)</span>
                    <span>+${cardSurcharge.toLocaleString('es-CO')}</span>
                  </div>
                )}
                
                <div className="flex justify-between items-end pt-4 mt-2 border-t border-gray-700">
                  <span className="text-gray-400 text-sm mb-1">Total a Pagar</span>
                  <div className="text-3xl font-black text-white tracking-tight">
                    <span className="text-xl text-orange-500 font-bold mr-1">$</span>
                    {grandTotal.toLocaleString('es-CO')}
                  </div>
                </div>
              </div>
            </div>

            {/* Error BOLD */}
            {boldError && (
              <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-lg text-sm text-red-800 shadow-sm animate-in fade-in slide-in-from-top-2">
                <strong>Error con el pago:</strong> {boldError}
              </div>
            )}
          </div>

          {/* Botones de acción */}
          <div className="bg-white p-5 border-t border-gray-100 flex-shrink-0">
            {paymentMethod === 'bold' ? (
              <Button
                onClick={handleBoldPayment}
                className="w-full h-14 text-base font-bold bg-gradient-to-r from-blue-600 to-blue-800 hover:from-blue-700 hover:to-blue-900 text-white shadow-lg shadow-blue-500/30 rounded-xl transition-all"
                disabled={boldLoading}
              >
                {boldLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Generando Link de Pago...
                  </>
                ) : (
                  <>
                    <CreditCard className="w-5 h-5 mr-2" />
                    Pagar y Confirmar Pedido
                  </>
                )}
              </Button>
            ) : paymentMethod === 'addi' ? (
              <Button
                onClick={handleAddiPayment}
                className="w-full h-14 text-base font-bold bg-[#4A3BFA] hover:bg-[#392CD1] text-white shadow-lg rounded-xl transition-all"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Procesando crédito...
                  </>
                ) : (
                  <>
                    <ShoppingBag className="w-5 h-5 mr-2" />
                    Pagar con Addi
                  </>
                )}
              </Button>
            ) : (
              <Button
                onClick={handleCompleteOrder}
                disabled={isSubmitting}
                className="w-full h-14 text-base font-bold bg-gradient-to-r from-orange-500 to-[#FF3D00] hover:from-orange-600 hover:to-red-600 text-white shadow-lg shadow-orange-500/30 rounded-xl transition-all hover:scale-[1.01] disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                {isSubmitting ? (
                  <><Loader2 className="w-5 h-5 mr-2 animate-spin" />Procesando pedido...</>
                ) : (
                  <><ShoppingBag className="w-5 h-5 mr-2" />Confirmar mi Pedido</>
                )}
              </Button>
            )}
            <button 
              onClick={() => setShowCheckout(false)}
              className="w-full mt-3 py-2 text-sm text-gray-500 font-medium hover:text-gray-800 transition-colors"
            >
              ← Volver al carrito
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Ticket térmico oculto — disponible en modo checkout */}
      {currentOrder && (
        <ThermalTicket
          order={currentOrder}
          finalTotal={grandTotal}
          cardFee={cardSurcharge}
          totalCOP={totalCOP}
          finalTotalCOP={grandTotal}
          config={ticketConfig}
        />
      )}
      </>
    );
  }

  return (
    <>
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[600px] h-[90vh] sm:h-[85vh] p-0 flex flex-col bg-[#FDFDFD] overflow-hidden">
          
          <DialogHeader className="bg-white px-6 py-4 border-b border-gray-100 flex-shrink-0 flex flex-row items-center justify-between">
            <div>
              <DialogTitle className="flex items-center gap-2 text-xl font-bold">
                <ShoppingBag className="w-5 h-5 text-orange-500" />
                Tu Carrito
              </DialogTitle>
              <DialogDescription className="text-xs text-gray-500 mt-1">
                {cart.length === 0
                  ? 'Agrega equipos para continuar'
                  : `${cart.length} equipo${cart.length > 1 ? 's' : ''} listo${cart.length > 1 ? 's' : ''} para ti`}
              </DialogDescription>
            </div>
            
            {cart.length > 0 && (
              <button 
                onClick={() => {
                  toast('¿Vaciar todo el carrito?', {
                    action: {
                      label: 'Sí, vaciar',
                      onClick: () => clearCart()
                    },
                    cancel: {
                      label: 'Cancelar',
                      onClick: () => {}
                    },
                    duration: 5000,
                  });
                }}
                className="text-gray-400 hover:text-red-500 transition-colors p-2 rounded-full hover:bg-red-50"
                title="Vaciar carrito"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </DialogHeader>

          {cart.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
              <div className="w-24 h-24 bg-gray-50 rounded-full flex items-center justify-center mb-6">
                <ShoppingBag className="w-10 h-10 text-gray-300" />
              </div>
              <h3 className="text-xl font-bold text-gray-800 mb-2">Tu carrito está dormido 😴</h3>
              <p className="text-gray-500 max-w-[250px] mx-auto mb-8">
                No has agregado ningún equipo. ¡Descubre nuestro catálogo y despiértalo!
              </p>
              <Button 
                onClick={onClose} 
                className="bg-gray-900 text-white rounded-full px-8 py-6 h-auto hover:bg-orange-500 hover:scale-105 transition-all duration-300 shadow-xl shadow-gray-200"
              >
                Explorar Equipos
              </Button>
            </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {cart.map((item) => (
                <div
                  key={`${item.product.id}-${item.selectedStorage || ''}-${item.selectedColor || 'default'}`}
                  className="group relative flex gap-4 p-4 bg-white border border-gray-100 rounded-2xl shadow-sm hover:shadow-md hover:border-orange-200 transition-all duration-300"
                >
                  {/* Botón de eliminar visible siempre en móvil */}
                  <button
                    onClick={() => removeFromCart(item.product.id, item.selectedColor, item.selectedStorage)}
                    className="absolute top-2 right-2 text-gray-400 hover:text-red-500 bg-gray-50 hover:bg-red-50 p-2 rounded-lg transition-colors z-10 active:scale-95"
                    title="Eliminar producto"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>

                  {/* Imagen */}
                  <div className="w-24 h-24 shrink-0 bg-gray-50 rounded-xl overflow-hidden border border-gray-100 p-2 flex items-center justify-center">
                    <img
                      src={item.product.image}
                      alt={item.product.name}
                      className="w-full h-full object-contain group-hover:scale-110 transition-transform duration-500"
                      onError={(e) => {
                        const t = e.currentTarget;
                        t.onerror = null;
                        t.src = `https://placehold.co/80x80/f5f5f5/999999?text=Xiaomi`;
                      }}
                    />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0 flex flex-col justify-between py-1">
                    <div>
                      <h4 className="font-bold text-gray-900 text-base leading-tight truncate pr-6">
                        {item.product.name}
                      </h4>
                      <div className="flex flex-wrap items-center gap-2 mt-1.5">
                        {item.selectedStorage && (
                          <span className="text-[11px] font-semibold bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full">
                            {item.selectedStorage}
                          </span>
                        )}
                        {item.selectedColor && (
                          <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded-full">
                            <div
                              className="w-2.5 h-2.5 rounded-full shadow-inner"
                              style={{
                                backgroundColor: item.product.colorVariants?.find(v => v.color === item.selectedColor)?.colorHex || '#ccc'
                              }}
                            />
                            <span className="text-[11px] font-medium text-gray-600">{item.selectedColor}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between mt-3">
                      <div className="font-black text-orange-600">
                        ${((item.product.price)).toLocaleString('es-CO')}
                      </div>
                      
                      {/* Control de cantidad — usa getItemMaxStock como única fuente de verdad */}
                      <div className="flex items-center bg-gray-50 border border-gray-200 rounded-full h-8">
                        <button
                          onClick={() => updateCartQuantity(item.product.id, item.quantity - 1, item.selectedColor, item.selectedStorage)}
                          className="w-8 h-full flex items-center justify-center text-gray-500 hover:text-black hover:bg-gray-200 rounded-l-full transition-colors disabled:opacity-30"
                          disabled={item.quantity <= 1}
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="w-6 text-center text-xs font-bold text-gray-800">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => {
                            const maxStock = getItemMaxStock(item);
                            if (item.quantity < maxStock) {
                              updateCartQuantity(item.product.id, item.quantity + 1, item.selectedColor, item.selectedStorage);
                            }
                          }}
                          className="w-8 h-full flex items-center justify-center text-gray-500 hover:text-black hover:bg-gray-200 rounded-r-full transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                          disabled={item.quantity >= getItemMaxStock(item)}
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Mensaje de Garantía Xiaomi */}
              <div className="mt-6 flex items-center gap-3 bg-blue-50/50 border border-blue-100 p-4 rounded-xl text-blue-800">
                <div className="bg-blue-100 p-2 rounded-full shrink-0">
                  <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                </div>
                <div className="text-sm leading-tight">
                  <span className="font-bold">Garantía Oficial Xiaomi</span><br/>
                  <span className="text-blue-700/80">Todos los equipos son 100% originales, sellados y con 1 año de garantía.</span>
                </div>
              </div>
            </div>

            {/* CTA Final */}
            <div className="bg-white border-t border-gray-100 p-6 flex-shrink-0 shadow-[0_-10px_30px_rgba(0,0,0,0.03)] z-10">
              <div className="flex justify-between items-end mb-4">
                <span className="text-gray-500 font-medium">Total</span>
                <div className="text-3xl font-black text-gray-900 tracking-tight">
                  ${totalCOP.toLocaleString('es-CO')}
                  <span className="text-sm font-normal text-gray-500 ml-1">COP</span>
                </div>
              </div>
              
              <Button
                onClick={handleCheckout}
                className="w-full h-14 bg-gradient-to-r from-orange-500 to-[#FF3D00] hover:from-orange-600 hover:to-red-600 text-white rounded-xl shadow-xl shadow-orange-500/25 transition-all duration-300 hover:scale-[1.02] text-lg font-bold flex items-center justify-center group"
              >
                Procesar Pedido
                <svg className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
              </Button>
            </div>
          </>
        )}
      </DialogContent>

    </Dialog>

      {/* Ticket térmico oculto — fuera del Dialog para que html2canvas lo encuentre */}
      {currentOrder && (
        <ThermalTicket
          order={currentOrder}
          finalTotal={grandTotal}
          cardFee={cardSurcharge}
          totalCOP={totalCOP}
          finalTotalCOP={grandTotal}
          config={ticketConfig}
        />
      )}
    </>
  );
}
