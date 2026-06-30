import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { useProducts, Product } from './ProductContext';
import { Button } from './ui/button';
import { Zap, Store, Truck, CreditCard, Loader2, ShoppingBag, ChevronRight } from 'lucide-react';
import { useState, useEffect } from 'react';
import { ThermalTicket } from './ThermalTicket';
import { toast } from 'sonner';
import { API_ORIGIN } from '../lib/api-base';

const DELIVERY_FEE = 0; // Domicilio GRATIS en Cartagena

type DeliveryMethod = 'delivery' | 'pickup';
type PaymentMethod = 'efectivo' | 'transferencia' | 'tarjeta' | 'nequi' | 'bold' | 'addi';

interface QuickBuyDialogProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product;
  initialColor?: string;
  initialStorage?: string;
  initialPaymentMethod?: PaymentMethod;
}

export function QuickBuyDialog({ isOpen, onClose, product, initialColor, initialStorage, initialPaymentMethod }: QuickBuyDialogProps) {
  const { addOrder, ticketConfig } = useProducts();

  // Variantes seleccionadas
  const [selectedColor, setSelectedColor] = useState<string | undefined>(
    initialColor ?? product.colorVariants?.[0]?.color
  );
  const [selectedStorage, setSelectedStorage] = useState<string | undefined>(
    initialStorage ?? product.storageVariants?.[0]?.storage
  );

  // Paso de la UI: 'config' | 'checkout' | 'done'
  const [step, setStep] = useState<'config' | 'checkout' | 'done'>('config');

  // Datos de cliente
  const [customerName, setCustomerName] = useState('');
  const [customerIdNumber, setCustomerIdNumber] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('delivery');
  const [address, setAddress] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(initialPaymentMethod || 'efectivo');

  // Estado de la orden
  const [currentOrder, setCurrentOrder] = useState<any>(null);
  const [boldLoading, setBoldLoading] = useState(false);
  const [boldError, setBoldError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sincronizar variantes cuando cambia el producto
  useEffect(() => {
    setSelectedColor(initialColor ?? product.colorVariants?.[0]?.color);
    setSelectedStorage(initialStorage ?? product.storageVariants?.[0]?.storage);
  }, [product.id, initialColor, initialStorage]);

  // Reset completo al cerrar
  const handleClose = () => {
    setStep('config');
    setCustomerName('');
    setCustomerIdNumber('');
    setCustomerEmail('');
    setPhone('');
    setDeliveryMethod('delivery');
    setAddress('');
    setPaymentMethod('efectivo');
    setCurrentOrder(null);
    setBoldLoading(false);
    setBoldError('');
    setIsSubmitting(false);
    onClose();
  };

  // ─── Calcular precio y stock ────────────────────────────────────────────────
  const getCurrentPrice = (): number => {
    if (selectedStorage && product.storageVariants) {
      const v = product.storageVariants.find(v => v.storage === selectedStorage);
      if (v) return v.price;
    }
    return product.price;
  };

  const getAvailableStock = (): number => {
    // Stock general = 0 actúa como interruptor maestro (producto agotado)
    if (product.stock <= 0) return 0;
    if (selectedStorage && product.storageVariants) {
      const v = product.storageVariants.find(v => v.storage === selectedStorage);
      return v?.stock ?? 0;
    }
    if (selectedColor && product.colorVariants) {
      const v = product.colorVariants.find(v => v.color === selectedColor);
      return v?.stock ?? 0;
    }
    return product.stock;
  };

  const unitPrice = selectedStorage ? product.storageVariants?.find(v => v.storage === selectedStorage)?.price || product.price : product.price;
  const totalCOP = unitPrice;
  const addiSurcharge = paymentMethod === 'addi' ? Math.round(totalCOP * 0.20) : 0;
  const cardSurcharge = (paymentMethod === 'tarjeta' || paymentMethod === 'bold')
    ? Math.round(totalCOP * 0.05)
    : addiSurcharge;
  const deliveryFee = deliveryMethod === 'delivery' ? DELIVERY_FEE : 0;
  const grandTotal = totalCOP + cardSurcharge + deliveryFee;
  const availableStock = getAvailableStock();

  const paymentMethodText =
    paymentMethod === 'efectivo' ? 'Efectivo' :
    paymentMethod === 'transferencia' ? 'Transferencia bancaria' :
    paymentMethod === 'nequi' ? 'Nequi' :
    paymentMethod === 'bold' ? 'BOLD (Tarjeta)' :
    paymentMethod === 'addi' ? 'Addi (Crédito a cuotas)' :
    'Tarjeta';

  // ─── Construir el CartItem para la orden ────────────────────────────────────
  const buildCartItem = () => ({
    product: { ...product, price: unitPrice },
    quantity: 1,
    selectedColor,
    selectedStorage,
  });

  // ─── Imprimir ticket ─────────────────────────────────────────────────────────
  const printTicket = async (order: any) => {
    await new Promise(r => setTimeout(r, 80));
    const el = document.getElementById('quick-thermal-ticket');
    if (!el) return;

    const win = window.open('', '_blank', 'width=400,height=700');
    if (!win) { toast.error('Permite ventanas emergentes para imprimir el ticket.'); return; }

    win.document.write(`<!DOCTYPE html><html><head>
      <meta charset="UTF-8">
      <title>Ticket #${order.orderNumber}</title>
      <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:'Courier New',Courier,monospace;font-size:12px;background:white;color:black;width:302px;padding:16px}
        @media print{body{width:100%;padding:8px}.no-print{display:none!important}@page{margin:4mm;size:80mm auto}}
        .btn-print{display:block;margin:16px auto 0;padding:10px 24px;background:#ff5a00;color:white;border:none;border-radius:6px;font-size:14px;font-weight:bold;cursor:pointer}
      </style>
    </head><body>
      ${el.innerHTML}
      <div class="no-print" style="margin-top:16px;text-align:center;">
        <button class="btn-print" onclick="window.print()">🖨️ Imprimir / Guardar PDF</button>
      </div>
      <script>window.onload=function(){setTimeout(function(){window.print()},200)}<\/script>
    </body></html>`);
    win.document.close();
  };

  // ─── Confirmar orden (pago no-Bold) ─────────────────────────────────────────
  const handleCompleteOrder = async () => {
    if (!customerName || !customerIdNumber || !customerEmail || !phone) {
      toast.error('Por favor completa todos los campos obligatorios');
      return;
    }
    if (deliveryMethod === 'delivery' && !address) {
      toast.error('Por favor ingresa el barrio/dirección de envío');
      return;
    }

    setIsSubmitting(true);
    try {
      const newOrder = await addOrder({
        items: [buildCartItem()],
        total: unitPrice,
        status: 'pending',
        createdAt: new Date().toISOString(),
        customerInfo: {
          email: customerEmail,
          name: customerName,
          idNumber: customerIdNumber,
          phone,
          deliveryMethod,
          address: deliveryMethod === 'delivery' ? address : 'Retiro en tienda',
          paymentMethod: paymentMethodText,
          deliveryFee,
        },
        paymentMethod: paymentMethodText,
      });

      // Meta Pixel
      if (typeof window !== 'undefined' && (window as any).fbq) {
        (window as any).fbq('track', 'Purchase', {
          content_ids: [product.id],
          content_type: 'product',
          value: grandTotal,
          currency: 'COP',
          num_items: 1,
        });
      }

      setCurrentOrder(newOrder);
      await new Promise(r => setTimeout(r, 600));
      await printTicket(newOrder);

      toast.success(`¡Pedido ${newOrder.orderNumber} realizado! Revisa tu email: ${customerEmail}`, { duration: 6000 });

      handleClose();
    } catch (err) {
      console.error('Error al crear orden:', err);
      toast.error('Hubo un error al procesar el pedido. Intenta de nuevo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── Pago Addi ──────────────────────────────────────────────────────────────
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
      const orderItem = {
        product: { ...product, price: unitPrice },
        quantity: 1,
        selectedColor,
        selectedStorage
      };

      const newOrder = await addOrder({
        items: [orderItem],
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
          content_ids: [product.id],
          content_type: 'product',
          value: grandTotal,
          currency: 'COP',
          num_items: 1
        });
      }

      const nameParts = customerName.trim().split(' ');
      const firstName = nameParts[0] || 'Cliente';
      const lastName = nameParts.slice(1).join(' ') || 'Xiaomi';

      const items = [{
        sku: product.id || 'XM-01',
        name: `${product.name} ${selectedStorage || ''}`.trim(),
        quantity: 1,
        unitPrice: unitPrice
      }];

      if (ticketConfig.addiMode === 'whatsapp') {
        const text = `Hola, acabo de realizar el pedido *#${newOrder.orderNumber}*
        
*🛍️ PRODUCTOS:*
• ${product.name} x1 ${selectedStorage ? `[${selectedStorage}]` : ''} ${selectedColor ? `(${selectedColor})` : ''}
  *Financiado por Addi:* $${(totalCOP + addiSurcharge).toLocaleString()} COP

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

  // ─── Pago Bold ──────────────────────────────────────────────────────────────
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
      const newOrder = await addOrder({
        items: [buildCartItem()],
        total: unitPrice,
        status: 'pending_bold',
        createdAt: new Date().toISOString(),
        customerInfo: {
          email: customerEmail,
          name: customerName,
          idNumber: customerIdNumber,
          phone,
          deliveryMethod,
          address: deliveryMethod === 'delivery' ? address : 'Retiro en tienda',
          paymentMethod: 'BOLD (Tarjeta)',
          deliveryFee,
        },
        paymentMethod: 'BOLD (Tarjeta)',
      });

      if (typeof window !== 'undefined' && (window as any).fbq) {
        (window as any).fbq('track', 'InitiateCheckout', {
          content_ids: [product.id],
          content_type: 'product',
          value: grandTotal,
          currency: 'COP',
          num_items: 1,
        });
      }

      const params = new URLSearchParams({
        orderId: newOrder.orderNumber,
        amount: String(grandTotal),
        currency: 'COP',
        description: `${product.name}${selectedStorage ? ` ${selectedStorage}` : ''}`.slice(0, 200),
        redirectionUrl: `${window.location.origin}/?bold_order=${newOrder.orderNumber}&bold_status=success`,
      });

      window.location.href = `${API_ORIGIN}/api/bold-checkout?${params.toString()}`;
    } catch (err: any) {
      console.error('BOLD error:', err);
      setBoldError(err.message || 'Error al iniciar el pago. Intenta de nuevo.');
      setBoldLoading(false);
    }
  };

  // ─── RENDER: Paso 1 — Selección de variante ─────────────────────────────────
  const renderConfigStep = () => (
    <>
      <DialogHeader className="bg-white px-6 py-4 border-b border-gray-100 flex-shrink-0">
        <DialogTitle className="flex items-center gap-2 text-xl font-bold">
          <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center">
            <Zap className="w-4 h-4 text-orange-600" />
          </div>
          Comprar Ahora
        </DialogTitle>
        <DialogDescription className="text-gray-500">
          {product.name} — compra directa y rápida
        </DialogDescription>
      </DialogHeader>

      <div className="overflow-y-auto max-h-[65vh] px-6 py-5 space-y-5">
        {/* Producto */}
        <div className="flex gap-4 p-4 bg-gray-50 rounded-xl border border-gray-100">
          <div className="w-20 h-20 shrink-0 bg-white rounded-xl overflow-hidden border border-gray-200 flex items-center justify-center p-2">
            <img src={product.image} alt={product.name} className="w-full h-full object-contain" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-gray-900 text-sm leading-tight mb-1">{product.name}</h3>
            <p className="text-xs text-gray-500 line-clamp-2">{product.description}</p>
            <div className="mt-2 text-lg font-black text-orange-600">
              ${unitPrice.toLocaleString('es-CO')}
              <span className="text-xs font-normal text-gray-500 ml-1">COP</span>
            </div>
          </div>
        </div>

        {/* Selector de almacenamiento */}
        {product.storageVariants && product.storageVariants.length > 0 && (
          <div>
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-2">Capacidad</p>
            <div className="flex flex-wrap gap-2">
              {product.storageVariants.map(v => {
                const isOut = v.stock === 0;
                return (
                  <button
                    key={v.storage}
                    onClick={() => !isOut && setSelectedStorage(v.storage)}
                    disabled={isOut}
                    className={`px-4 py-2 rounded-lg border-2 text-sm font-semibold transition-all ${
                      selectedStorage === v.storage
                        ? 'border-orange-500 bg-orange-50 text-orange-700'
                        : isOut
                        ? 'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed'
                        : 'border-gray-200 bg-white text-gray-700 hover:border-gray-400'
                    }`}
                  >
                    <span>{v.storage}</span>
                    <span className="block text-xs mt-0.5">
                      {isOut ? 'Agotado' : `$${v.price.toLocaleString('es-CO')}`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Selector de color */}
        {product.colorVariants && product.colorVariants.length > 0 && (
          <div>
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-2">
              Color{selectedColor && ` — ${selectedColor}`}
            </p>
            <div className="flex flex-wrap gap-3">
              {product.colorVariants.map(v => {
                const isOut = v.stock === 0;
                return (
                  <button
                    key={v.color}
                    onClick={() => !isOut && setSelectedColor(v.color)}
                    disabled={isOut}
                    className={`relative w-10 h-10 rounded-full border-2 transition-all ${
                      selectedColor === v.color
                        ? 'border-orange-500 ring-4 ring-orange-100'
                        : isOut
                        ? 'border-gray-200 opacity-30 cursor-not-allowed'
                        : 'border-gray-300 hover:border-gray-500'
                    }`}
                    style={{ backgroundColor: v.colorHex }}
                    title={`${v.color}${isOut ? ' (Agotado)' : ''}`}
                  >
                    {selectedColor === v.color && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-2.5 h-2.5 bg-white rounded-full shadow" />
                      </div>
                    )}
                    {isOut && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-0.5 h-8 bg-gray-400 rotate-45 rounded-full" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Stock aviso */}
        {availableStock > 0 && availableStock < 5 && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            <Zap className="w-4 h-4 text-red-500 flex-shrink-0" />
            <span className="text-sm font-semibold text-red-700">
              ¡Solo quedan {availableStock} unidades! Asegura el tuyo ahora.
            </span>
          </div>
        )}

        {/* Total rápido */}
        <div className="bg-gray-900 rounded-xl p-4 text-white">
          <div className="flex justify-between items-center">
            <span className="text-gray-400 text-sm">Total a pagar</span>
            <div className="text-2xl font-black">
              <span className="text-orange-500 text-lg mr-1">$</span>
              {unitPrice.toLocaleString('es-CO')}
              <span className="text-xs font-normal text-gray-400 ml-1">COP</span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white px-6 py-4 border-t border-gray-100">
        <Button
          onClick={() => {
            if (availableStock === 0) return;
            if (product.storageVariants?.length && !selectedStorage) {
              toast.error('Por favor selecciona una capacidad de almacenamiento');
              return;
            }
            if (product.colorVariants?.length && !selectedColor) {
              toast.error('Por favor selecciona un color');
              return;
            }
            setStep('checkout');
          }}
          disabled={availableStock === 0}
          className="w-full h-13 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white font-bold rounded-xl text-base flex items-center justify-center gap-2 shadow-lg shadow-orange-500/30 transition-all hover:scale-[1.01] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Zap className="w-5 h-5" />
          {availableStock === 0 ? 'Producto agotado' : 'Continuar con mi compra'}
          <ChevronRight className="w-4 h-4 ml-auto" />
        </Button>
      </div>
    </>
  );

  // ─── RENDER: Paso 2 — Checkout ───────────────────────────────────────────────
  const renderCheckoutStep = () => (
    <>
      <DialogHeader className="bg-white px-6 py-4 border-b border-gray-100 flex-shrink-0">
        <DialogTitle className="flex items-center gap-2 text-xl font-bold">
          <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center">
            <ShoppingBag className="w-4 h-4 text-orange-600" />
          </div>
          Finaliza tu Compra
        </DialogTitle>
        <DialogDescription className="text-gray-500">
          Un paso más para estrenar tu equipo
        </DialogDescription>
      </DialogHeader>

      <div className="overflow-y-auto max-h-[65vh] px-6 py-5 space-y-5">
        {/* Resumen producto seleccionado */}
        <div className="flex items-center gap-3 p-3 bg-orange-50 border border-orange-100 rounded-xl text-sm">
          <img src={product.image} alt={product.name} className="w-12 h-12 object-contain rounded-lg bg-white p-1 border border-orange-100" />
          <div className="flex-1 min-w-0">
            <div className="font-bold text-gray-900 truncate">{product.name}</div>
            <div className="text-xs text-gray-600">
              {selectedStorage && <span className="mr-2">{selectedStorage}</span>}
              {selectedColor && <span>{selectedColor}</span>}
            </div>
          </div>
          <button
            onClick={() => setStep('config')}
            className="text-orange-500 text-xs font-semibold hover:text-orange-700 shrink-0"
          >
            Cambiar
          </button>
        </div>

        {/* Paso 1: Datos */}
        <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm space-y-3">
          <h3 className="font-bold text-gray-800 text-sm border-b border-gray-50 pb-2 flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center text-xs">1</span>
            Tus Datos
          </h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Nombre completo *</label>
              <input type="text" value={customerName} onChange={e => setCustomerName(e.target.value)}
                placeholder="Ej. Juan Pérez"
                className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:bg-white focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Cédula *</label>
              <input type="text" value={customerIdNumber} onChange={e => setCustomerIdNumber(e.target.value)}
                placeholder="Documento de identidad"
                className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:bg-white focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Teléfono *</label>
              <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                placeholder="Ej. 300 123 4567"
                className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:bg-white focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all text-sm" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Correo Electrónico *</label>
              <input type="email" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)}
                placeholder="Para enviarte el recibo"
                className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:bg-white focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all text-sm" />
            </div>
          </div>
        </div>

        {/* Paso 2: Entrega */}
        <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm space-y-3">
          <h3 className="font-bold text-gray-800 text-sm border-b border-gray-50 pb-2 flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center text-xs">2</span>
            Método de Entrega
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {([
              { value: 'delivery', label: 'Domicilio', sub: 'GRATIS', Icon: Truck, subClass: 'text-green-600' },
              { value: 'pickup', label: 'Retirar en Tienda', sub: '¡Gratis!', Icon: Store, subClass: 'text-emerald-600' },
            ] as const).map(opt => (
              <button key={opt.value} type="button" onClick={() => setDeliveryMethod(opt.value)}
                className={`p-3 border-2 rounded-xl transition-all flex flex-col items-center text-center ${
                  deliveryMethod === opt.value
                    ? 'border-orange-500 bg-orange-50/50'
                    : 'border-gray-100 hover:border-gray-300 hover:bg-gray-50'
                }`}>
                <opt.Icon className={`w-6 h-6 mb-1.5 ${deliveryMethod === opt.value ? 'text-orange-500' : 'text-gray-400'}`} />
                <div className={`text-xs font-bold ${deliveryMethod === opt.value ? 'text-orange-900' : 'text-gray-700'}`}>{opt.label}</div>
                <div className={`text-xs font-semibold mt-0.5 ${opt.subClass}`}>{opt.sub}</div>
              </button>
            ))}
          </div>

          {deliveryMethod === 'delivery' && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Barrio y Dirección Exacta *</label>
              <textarea value={address} onChange={e => setAddress(e.target.value)}
                placeholder="Ej. Barrio Manga, Calle 24 # 17-50, Apto 302"
                rows={2}
                className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:bg-white focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all resize-none text-sm" />
              <p className="text-[11px] text-gray-500 mt-1 flex items-center gap-1">
                <Truck className="w-3 h-3" /> Entrega estimada en ~1 hora en toda Cartagena.
              </p>
            </div>
          )}
          {deliveryMethod === 'pickup' && (
            <div className="bg-orange-50/50 border border-orange-100 rounded-lg p-3">
              <p className="text-[13px] text-orange-800">
                <strong>Nuestra Tienda:</strong> Cl. 31 #61-64, Los Ángeles, Cartagena.<br />
                <strong>Horario:</strong> Lun - Vie: 9:00 AM - 7:00 PM | Dom: 10:30 AM - 3:00 PM
              </p>
            </div>
          )}
        </div>

        {/* Paso 3: Pago */}
        <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm space-y-3">
          <h3 className="font-bold text-gray-800 text-sm border-b border-gray-50 pb-2 flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center text-xs">3</span>
            Método de Pago
          </h3>
          <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as PaymentMethod)}
            className="w-full px-3 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:bg-white focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all font-medium text-gray-800 cursor-pointer text-sm">
            <option value="efectivo">💵 Pago en Efectivo (Contra entrega)</option>
            <option value="nequi">📱 Nequi (Contra entrega)</option>
            <option value="transferencia">🏦 Transferencia Bancaria</option>
            <option value="tarjeta">💳 Tarjeta con Datáfono (Contra entrega) (+5%)</option>
            <option value="bold">🌐 Pago Seguro en Línea - BOLD (+5%)</option>
            <option value="addi">🛍️ Paga con Addi a Cuotas</option>
          </select>
          {(paymentMethod === 'bold' || paymentMethod === 'tarjeta') && (
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-800 flex items-start gap-2">
              <CreditCard className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Recargo del <strong>5%</strong> por transacción con tarjeta. Ya incluido en el total.</span>
            </div>
          )}
        </div>

        {/* Total desglosado */}
        <div className="bg-gray-900 rounded-xl p-5 text-white shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500 rounded-full mix-blend-overlay filter blur-3xl opacity-50 translate-x-10 -translate-y-10" />
          <h3 className="font-semibold text-gray-300 mb-4 text-xs uppercase tracking-wider relative z-10">Resumen</h3>
          <div className="space-y-2.5 relative z-10">
            <div className="flex justify-between text-sm text-gray-300 border-b border-gray-700/50 pb-2">
              <span className="truncate pr-4">1x {product.name}{selectedStorage ? ` ${selectedStorage}` : ''}</span>
              <span className="shrink-0">${(unitPrice + addiSurcharge).toLocaleString('es-CO')}</span>
            </div>
            <div className="flex justify-between items-center text-sm text-gray-400">
              <span>Subtotal</span>
              <span>${(unitPrice + addiSurcharge).toLocaleString('es-CO')}</span>
            </div>
            {deliveryFee > 0 && (
              <div className="flex justify-between items-center text-sm text-gray-300">
                <span>Domicilio</span>
                <span>+${DELIVERY_FEE.toLocaleString('es-CO')}</span>
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

        {boldError && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-lg text-sm text-red-800">
            <strong>Error:</strong> {boldError}
          </div>
        )}
      </div>

      <div className="bg-white px-6 py-4 border-t border-gray-100 space-y-3">
        {paymentMethod === 'bold' ? (
          <Button onClick={handleBoldPayment} disabled={boldLoading}
            className="w-full h-14 text-base font-bold bg-gradient-to-r from-blue-600 to-blue-800 hover:from-blue-700 hover:to-blue-900 text-white shadow-lg shadow-blue-500/30 rounded-xl transition-all">
            {boldLoading ? (
              <><Loader2 className="w-5 h-5 mr-2 animate-spin" />Generando Link de Pago...</>
            ) : (
              <><CreditCard className="w-5 h-5 mr-2" />Pagar y Confirmar Pedido</>
            )}
          </Button>
        ) : paymentMethod === 'addi' ? (
          <Button onClick={handleAddiPayment} disabled={isSubmitting}
            className="w-full h-14 text-base font-bold bg-[#4A3BFA] hover:bg-[#392CD1] text-white shadow-lg rounded-xl transition-all">
            {isSubmitting ? (
              <><Loader2 className="w-5 h-5 mr-2 animate-spin" />Procesando crédito...</>
            ) : (
              <><ShoppingBag className="w-5 h-5 mr-2" />Pagar con Addi</>
            )}
          </Button>
        ) : (
          <Button onClick={handleCompleteOrder} disabled={isSubmitting}
            className="w-full h-14 text-base font-bold bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white shadow-lg shadow-orange-500/30 rounded-xl transition-all hover:scale-[1.01]">
            {isSubmitting ? (
              <><Loader2 className="w-5 h-5 mr-2 animate-spin" />Procesando...</>
            ) : (
              <><ShoppingBag className="w-5 h-5 mr-2" />Confirmar mi Pedido</>
            )}
          </Button>
        )}
        <button onClick={() => setStep('config')}
          className="w-full py-2 text-sm text-gray-500 font-medium hover:text-gray-800 transition-colors">
          ← Volver a selección
        </button>
      </div>
    </>
  );

  return (
    <>
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[520px] p-0 overflow-hidden bg-gray-50/50 flex flex-col max-h-[95vh]">
          {step === 'config' ? renderConfigStep() : renderCheckoutStep()}
        </DialogContent>
      </Dialog>

      {/* Ticket térmico oculto */}
      {currentOrder && (
        <div id="quick-thermal-ticket" style={{ position: 'fixed', left: '-9999px', top: 0, zIndex: -1 }}>
          <ThermalTicket
            order={currentOrder}
            finalTotal={grandTotal}
            cardFee={cardSurcharge}
            totalCOP={unitPrice}
            finalTotalCOP={grandTotal}
            config={ticketConfig}
            preview={true}
          />
        </div>
      )}
    </>
  );
}
