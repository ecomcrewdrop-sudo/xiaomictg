import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { useProducts, Product } from '../ProductContext';
import { Button } from '../ui/button';
import { Zap, Store, Truck, CreditCard, Loader2, ShoppingBag, ShieldCheck, ChevronRight, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { ThermalTicket } from '../ThermalTicket';

const DELIVERY_FEE = 10000;
type DeliveryMethod = 'delivery' | 'pickup';
type PaymentMethod = 'efectivo' | 'transferencia' | 'tarjeta' | 'nequi' | 'bold';

export function DirectCheckoutPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { products, addOrder, ticketConfig, loading } = useProducts();

  const productId = searchParams.get('productId');
  const initialColor = searchParams.get('color');
  const initialStorage = searchParams.get('storage');

  const [product, setProduct] = useState<Product | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | undefined>(initialColor || undefined);
  const [selectedStorage, setSelectedStorage] = useState<string | undefined>(initialStorage || undefined);

  // Estados de Checkout
  const [customerName, setCustomerName] = useState('');
  const [customerIdNumber, setCustomerIdNumber] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('delivery');
  const [address, setAddress] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('efectivo');

  // Estados de proceso
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [boldLoading, setBoldLoading] = useState(false);
  const [boldError, setBoldError] = useState('');
  const [orderSuccess, setOrderSuccess] = useState<any>(null);

  // Inicializar producto
  useEffect(() => {
    if (!loading && products.length > 0 && productId) {
      const found = products.find(p => p.id === productId);
      if (found) {
        setProduct(found);
        if (initialColor) setSelectedColor(initialColor);
        else if (found.colorVariants?.length === 1) setSelectedColor(found.colorVariants[0].color);

        if (initialStorage) setSelectedStorage(initialStorage);
        else if (found.storageVariants?.length === 1) setSelectedStorage(found.storageVariants[0].storage);
      } else {
        toast.error('Producto no encontrado');
        navigate('/');
      }
    }
  }, [loading, products, productId, initialColor, initialStorage, navigate]);

  // Cálculos de precio
  const { unitPrice, availableStock, grandTotal, cardSurcharge, deliveryFee } = useMemo(() => {
    if (!product) return { unitPrice: 0, availableStock: 0, grandTotal: 0, cardSurcharge: 0, deliveryFee: 0 };
    
    let currentPrice = product.price;
    let currentStock = product.stock;

    if (selectedStorage && product.storageVariants) {
      const v = product.storageVariants.find(v => v.storage === selectedStorage);
      if (v) { currentPrice = v.price; currentStock = v.stock; }
    } else if (selectedColor && product.colorVariants) {
      const v = product.colorVariants.find(v => v.color === selectedColor);
      if (v) currentStock = v.stock;
    }

    const dFee = deliveryMethod === 'delivery' ? DELIVERY_FEE : 0;
    const surcharge = (paymentMethod === 'tarjeta' || paymentMethod === 'bold') ? Math.round(currentPrice * 0.05) : 0;
    
    return {
      unitPrice: currentPrice,
      availableStock: currentStock,
      deliveryFee: dFee,
      cardSurcharge: surcharge,
      grandTotal: currentPrice + dFee + surcharge
    };
  }, [product, selectedStorage, selectedColor, deliveryMethod, paymentMethod]);

  const paymentMethodText =
    paymentMethod === 'efectivo' ? 'Efectivo' :
    paymentMethod === 'transferencia' ? 'Transferencia bancaria' :
    paymentMethod === 'nequi' ? 'Nequi' :
    paymentMethod === 'bold' ? 'BOLD (Tarjeta)' :
    'Tarjeta';

  // Utils para orden
  const buildCartItem = () => ({
    product: { ...product!, price: unitPrice },
    quantity: 1,
    selectedColor,
    selectedStorage,
  });

  const printTicket = async (order: any) => {
    await new Promise(r => setTimeout(r, 80));
    const el = document.getElementById('quick-thermal-ticket');
    if (!el) return;
    const win = window.open('', '_blank', 'width=400,height=700');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Ticket</title><style>body{font-family:monospace;padding:16px}</style></head><body>${el.innerHTML}</body></html>`);
    win.document.close();
    setTimeout(() => { win.print(); }, 200);
  };

  const validateForm = () => {
    if (!customerName || !customerIdNumber || !customerEmail || !phone) {
      toast.error('Por favor completa todos tus datos');
      return false;
    }
    if (deliveryMethod === 'delivery' && !address) {
      toast.error('Por favor ingresa la dirección de envío');
      return false;
    }
    return true;
  };

  // Enviar Orden (No Bold)
  const handleCompleteOrder = async () => {
    if (!validateForm()) return;
    setIsSubmitting(true);
    try {
      const newOrder = await addOrder({
        items: [buildCartItem()],
        total: unitPrice,
        status: 'pending',
        createdAt: new Date().toISOString(),
        customerInfo: {
          email: customerEmail, name: customerName, idNumber: customerIdNumber, phone, deliveryMethod,
          address: deliveryMethod === 'delivery' ? address : 'Retiro en tienda',
          paymentMethod: paymentMethodText, deliveryFee,
        },
        paymentMethod: paymentMethodText,
      });

      if (typeof window !== 'undefined' && (window as any).fbq) {
        (window as any).fbq('track', 'Purchase', { content_ids: [product!.id], value: grandTotal, currency: 'COP' });
      }

      setOrderSuccess(newOrder);
      await printTicket(newOrder);
    } catch (err) {
      toast.error('Hubo un error al procesar el pedido. Intenta de nuevo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Enviar Orden (Bold)
  const handleBoldPayment = async () => {
    if (!validateForm()) return;
    setBoldLoading(true); setBoldError('');
    try {
      const newOrder = await addOrder({
        items: [buildCartItem()],
        total: unitPrice,
        status: 'pending_bold',
        createdAt: new Date().toISOString(),
        customerInfo: {
          email: customerEmail, name: customerName, idNumber: customerIdNumber, phone, deliveryMethod,
          address: deliveryMethod === 'delivery' ? address : 'Retiro en tienda',
          paymentMethod: 'BOLD (Tarjeta)', deliveryFee,
        },
        paymentMethod: 'BOLD (Tarjeta)',
      });

      if (typeof window !== 'undefined' && (window as any).fbq) {
        (window as any).fbq('track', 'InitiateCheckout', { content_ids: [product!.id], value: grandTotal, currency: 'COP' });
      }

      const params = new URLSearchParams({
        orderId: newOrder.orderNumber,
        amount: String(grandTotal),
        currency: 'COP',
        description: `${product!.name}${selectedStorage ? ` ${selectedStorage}` : ''}`.slice(0, 200),
        redirectionUrl: `${window.location.origin}/?bold_order=${newOrder.orderNumber}&bold_status=success`,
      });
      window.location.href = `/api/bold-checkout?${params.toString()}`;
    } catch (err: any) {
      setBoldError(err.message || 'Error al iniciar BOLD.');
      setBoldLoading(false);
    }
  };

  if (loading || !product) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center bg-gray-50">
        <Loader2 className="w-12 h-12 text-orange-500 animate-spin mb-4" />
        <p className="text-gray-500 font-medium tracking-wide animate-pulse">Preparando tu compra segura...</p>
      </div>
    );
  }

  if (orderSuccess) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center bg-gray-50 p-6">
        <div className="bg-white rounded-3xl p-10 max-w-lg w-full shadow-2xl text-center space-y-6 animate-in zoom-in-95 duration-500">
          <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-12 h-12 text-green-500" />
          </div>
          <h2 className="text-3xl font-black text-gray-900">¡Pedido Confirmado!</h2>
          <p className="text-gray-500 text-lg">Tu número de orden es <strong className="text-gray-900">{orderSuccess.orderNumber}</strong></p>
          <p className="text-gray-500">Hemos enviado los detalles a <b>{customerEmail}</b></p>
          <Button onClick={() => navigate('/')} className="mt-8 w-full h-14 text-lg bg-orange-500 hover:bg-orange-600 rounded-xl">
            Volver a la tienda
          </Button>
        </div>
        <div id="quick-thermal-ticket" className="hidden">
          <ThermalTicket order={orderSuccess} finalTotal={grandTotal} cardFee={cardSurcharge} totalCOP={unitPrice} finalTotalCOP={grandTotal} config={ticketConfig} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50/50 py-12">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        
        {/* HEADER COMPRA SEGURA */}
        <div className="mb-8 flex items-center justify-center gap-3">
          <ShieldCheck className="w-8 h-8 text-green-500" />
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">Checkout Seguro</h1>
        </div>

        <div className="grid lg:grid-cols-12 gap-8 lg:gap-12">
          
          {/* COLUMNA IZQUIERDA: FORMULARIOS */}
          <div className="lg:col-span-7 space-y-8 animate-in slide-in-from-left-4 duration-500">
            
            {/* Paso 1: Datos */}
            <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
              <h3 className="font-bold text-gray-900 text-lg mb-6 flex items-center gap-3">
                <span className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center text-sm">1</span>
                Tus Datos Personales
              </h3>
              <div className="grid sm:grid-cols-2 gap-5">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Nombre completo *</label>
                  <input type="text" value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Ej. Juan Pérez"
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:bg-white focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all font-medium" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Cédula *</label>
                  <input type="text" value={customerIdNumber} onChange={e => setCustomerIdNumber(e.target.value)} placeholder="Documento"
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:bg-white focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all font-medium" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Teléfono *</label>
                  <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Ej. 300 123 4567"
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:bg-white focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all font-medium" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Correo Electrónico *</label>
                  <input type="email" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} placeholder="Para enviarte el recibo"
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:bg-white focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all font-medium" />
                </div>
              </div>
            </div>

            {/* Paso 2: Entrega */}
            <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
              <h3 className="font-bold text-gray-900 text-lg mb-6 flex items-center gap-3">
                <span className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center text-sm">2</span>
                Método de Entrega
              </h3>
              <div className="grid grid-cols-2 gap-4 mb-6">
                {([
                  { value: 'delivery', label: 'Envío a Domicilio', sub: '+$10.000 COP', Icon: Truck },
                  { value: 'pickup', label: 'Retirar en Tienda', sub: '¡Gratis!', Icon: Store },
                ] as const).map(opt => (
                  <button key={opt.value} type="button" onClick={() => setDeliveryMethod(opt.value)}
                    className={`p-4 border-2 rounded-2xl transition-all flex flex-col items-center text-center ${
                      deliveryMethod === opt.value ? 'border-orange-500 bg-orange-50' : 'border-gray-100 hover:border-gray-300 hover:bg-gray-50'
                    }`}>
                    <opt.Icon className={`w-8 h-8 mb-2 ${deliveryMethod === opt.value ? 'text-orange-500' : 'text-gray-400'}`} />
                    <div className={`font-bold ${deliveryMethod === opt.value ? 'text-orange-900' : 'text-gray-700'}`}>{opt.label}</div>
                    <div className={`text-sm font-semibold mt-1 ${deliveryMethod === opt.value ? 'text-orange-600' : 'text-gray-500'}`}>{opt.sub}</div>
                  </button>
                ))}
              </div>

              {deliveryMethod === 'delivery' && (
                <div className="animate-in fade-in slide-in-from-top-2">
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Barrio y Dirección Exacta *</label>
                  <textarea value={address} onChange={e => setAddress(e.target.value)} placeholder="Ej. Barrio Manga, Calle 24 # 17-50, Apto 302" rows={3}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:bg-white focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all resize-none font-medium" />
                  <p className="text-sm text-gray-500 mt-2 flex items-center gap-1.5 font-medium">
                    <Zap className="w-4 h-4 text-orange-500" /> Entrega flash en ~1 hora (aplica Cartagena).
                  </p>
                </div>
              )}
            </div>

            {/* Paso 3: Pago */}
            <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
              <h3 className="font-bold text-gray-900 text-lg mb-6 flex items-center gap-3">
                <span className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center text-sm">3</span>
                Método de Pago
              </h3>
              <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as PaymentMethod)}
                className="w-full px-4 py-4 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:bg-white focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all font-bold text-gray-800 cursor-pointer text-base">
                <option value="efectivo">💵 Pago en Efectivo (Contra entrega)</option>
                <option value="nequi">📱 Nequi (Contra entrega)</option>
                <option value="transferencia">🏦 Transferencia Bancaria</option>
                <option value="tarjeta">💳 Tarjeta con Datáfono (Contra entrega) (+5%)</option>
                <option value="bold">🌐 Pago Seguro en Línea - BOLD (+5%)</option>
              </select>
            </div>

          </div>

          {/* COLUMNA DERECHA: RESUMEN PRODUCTO */}
          <div className="lg:col-span-5 animate-in slide-in-from-right-4 duration-500 delay-100">
            <div className="sticky top-24 bg-white rounded-3xl border border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.06)] overflow-hidden">
              
              <div className="bg-gray-50 p-6 flex items-center gap-4 border-b border-gray-100">
                <div className="w-20 h-20 bg-white rounded-2xl p-2 border border-gray-200 shadow-sm shrink-0">
                  <img src={product.image} alt={product.name} className="w-full h-full object-contain" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 text-lg leading-tight mb-1">{product.name}</h3>
                  <div className="flex flex-wrap gap-2 text-sm font-semibold text-gray-500">
                    {selectedStorage && <span className="bg-white px-2 py-0.5 rounded-md border border-gray-200">{selectedStorage}</span>}
                    {selectedColor && <span className="bg-white px-2 py-0.5 rounded-md border border-gray-200">{selectedColor}</span>}
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-4">
                <div className="flex justify-between text-gray-600 font-medium">
                  <span>Subtotal</span>
                  <span>${unitPrice.toLocaleString('es-CO')}</span>
                </div>
                {deliveryFee > 0 && (
                  <div className="flex justify-between text-gray-600 font-medium">
                    <span>Envío a Domicilio</span>
                    <span>+${DELIVERY_FEE.toLocaleString('es-CO')}</span>
                  </div>
                )}
                {cardSurcharge > 0 && (
                  <div className="flex justify-between text-blue-600 font-medium">
                    <span>Recargo Tarjeta (5%)</span>
                    <span>+${cardSurcharge.toLocaleString('es-CO')}</span>
                  </div>
                )}
                
                <div className="border-t border-gray-100 pt-4 mt-2">
                  <div className="flex justify-between items-end">
                    <span className="text-gray-500 font-bold uppercase tracking-wider text-sm">Total a Pagar</span>
                    <div className="text-4xl font-black text-gray-900 tracking-tight">
                      <span className="text-2xl text-orange-500 mr-1">$</span>
                      {grandTotal.toLocaleString('es-CO')}
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-6 bg-gray-50 border-t border-gray-100">
                {paymentMethod === 'bold' ? (
                  <Button onClick={handleBoldPayment} disabled={boldLoading || availableStock === 0}
                    className="w-full h-16 text-lg font-black bg-gradient-to-r from-blue-600 to-blue-800 hover:from-blue-700 hover:to-blue-900 text-white shadow-xl shadow-blue-500/30 rounded-2xl transition-all hover:scale-[1.02]">
                    {boldLoading ? <Loader2 className="w-6 h-6 mr-2 animate-spin" /> : <CreditCard className="w-6 h-6 mr-2" />}
                    Pagar Seguro con BOLD
                  </Button>
                ) : (
                  <Button onClick={handleCompleteOrder} disabled={isSubmitting || availableStock === 0}
                    className="w-full h-16 text-lg font-black bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white shadow-xl shadow-orange-500/30 rounded-2xl transition-all hover:scale-[1.02]">
                    {isSubmitting ? <Loader2 className="w-6 h-6 mr-2 animate-spin" /> : <ShoppingBag className="w-6 h-6 mr-2" />}
                    Confirmar mi Pedido
                  </Button>
                )}
                {boldError && <p className="mt-4 text-sm text-red-600 font-medium text-center">{boldError}</p>}
                {availableStock === 0 && <p className="mt-4 text-sm text-red-600 font-bold text-center bg-red-50 p-2 rounded-lg">Este producto se encuentra agotado</p>}
              </div>

            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
