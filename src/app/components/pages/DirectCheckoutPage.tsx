import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { useProducts, Product } from '../ProductContext';
import { Button } from '../ui/button';
import { Zap, Store, Truck, CreditCard, Loader2, ShoppingBag, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { ThermalTicket } from '../ThermalTicket';
import { API_ORIGIN } from '../../lib/api-base';

const DELIVERY_FEE = 10000;
type DeliveryMethod = 'delivery' | 'pickup';
type PaymentMethod = 'efectivo' | 'transferencia' | 'tarjeta' | 'nequi' | 'bold';

export function DirectCheckoutPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { products, addOrder, ticketConfig, loading } = useProducts();

  // Soporta tanto los parámetros descriptivos como los abreviados generados por el Generador VIP
  const productId = searchParams.get('productId') || searchParams.get('p');
  const initialColor = searchParams.get('color') || searchParams.get('c');
  const initialStorage = searchParams.get('storage') || searchParams.get('s');

  const [product, setProduct] = useState<Product | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | undefined>(initialColor || undefined);
  const [selectedStorage, setSelectedStorage] = useState<string | undefined>(initialStorage || undefined);
  const [quantity, setQuantity] = useState(1);

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
    const baseTotal = currentPrice * quantity;
    const addiSurcharge = paymentMethod === 'addi' ? Math.round(baseTotal * 0.25) : 0;
    const surcharge = (paymentMethod === 'tarjeta' || paymentMethod === 'bold') ? Math.round(baseTotal * 0.05) : addiSurcharge;
    
    return {
      unitPrice: currentPrice,
      availableStock: currentStock,
      deliveryFee: dFee,
      cardSurcharge: surcharge,
      grandTotal: baseTotal + dFee + surcharge
    };
  }, [product, selectedStorage, selectedColor, deliveryMethod, paymentMethod]);

  const paymentMethodText =
    paymentMethod === 'efectivo' ? 'Efectivo' :
    paymentMethod === 'transferencia' ? 'Transferencia bancaria' :
    paymentMethod === 'nequi' ? 'Nequi' :
    paymentMethod === 'bold' ? 'BOLD (Tarjeta)' :
    paymentMethod === 'addi' ? 'Addi (Crédito a cuotas)' :
    'Tarjeta';

  // Utils para orden
  const buildCartItem = () => ({
    product: { ...product!, price: unitPrice },
    quantity: quantity,
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
        total: unitPrice * quantity,
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
        total: unitPrice * quantity,
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

  // Enviar Orden (Addi)
  const handleAddiPayment = async () => {
    if (!validateForm()) return;
    setIsSubmitting(true);
    try {
      const newOrder = await addOrder({
        items: [buildCartItem()],
        total: unitPrice * quantity,
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
        (window as any).fbq('track', 'InitiateCheckout', { content_ids: [product!.id], value: grandTotal, currency: 'COP' });
      }

      // Separar nombre y apellido (Aproximación simple)
      const nameParts = customerName.trim().split(' ');
      const firstName = nameParts[0] || 'Cliente';
      const lastName = nameParts.slice(1).join(' ') || 'Xiaomi';

      if (ticketConfig.addiMode === 'whatsapp') {
        const text = `Hola, acabo de realizar el pedido *#${newOrder.orderNumber}*
        
*🛍️ PRODUCTOS:*
• ${product!.name} x${quantity} ${selectedStorage ? `[${selectedStorage}]` : ''} ${selectedColor ? `(${selectedColor})` : ''}
  *Valor:* $${(unitPrice * quantity + addiSurcharge).toLocaleString()} COP

*📍 DATOS DE ENVÍO:*
*Nombre:* ${customerName}
*Cédula:* ${customerIdNumber}
*Teléfono:* ${phone}
*Dirección:* ${deliveryMethod === 'delivery' ? address : 'Retiro en Tienda'}

*💳 PAGO CON ADDI A CUOTAS:*
*Subtotal:* $${(unitPrice * quantity + addiSurcharge).toLocaleString()} COP
*Envío:* $${deliveryFee.toLocaleString()} COP

💰 *TOTAL A PAGAR: $${grandTotal.toLocaleString()} COP* 💰

Seleccioné *Addi* como método de pago para pagar a cuotas. Por favor envíame el link de pago.`;
        window.location.href = `https://wa.me/57${ticketConfig.phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(text)}`;
        return;
      }

      // Llamar al endpoint de Addi
      const addiRes = await fetch(`${API_ORIGIN}/api/addi/create-transaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: newOrder.orderNumber,
          totalAmount: grandTotal,
          items: [{
            sku: product!.id || 'XM-01',
            name: `${product!.name} ${selectedStorage || ''}`.trim(),
            quantity: Number(quantity),
            unitPrice: unitPrice
          }],
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

  const paymentMethods = [
    { value: 'efectivo', label: 'Efectivo', sub: 'Contra entrega', icon: '💵' },
    { value: 'nequi', label: 'Nequi', sub: 'Contra entrega', icon: '📱' },
    { value: 'transferencia', label: 'Transferencia', sub: 'Bancaria Directa', icon: '🏦' },
    { value: 'tarjeta', label: 'Datáfono físico', sub: 'Contra entrega (+5%)', icon: '💳' },
    { value: 'bold', label: 'Pago Seguro Online', sub: 'Bold (+5%)', icon: '🌐' },
    { value: 'addi', label: 'Paga con Addi', sub: 'Crédito a cuotas', icon: '🛍️' },
  ];

  if (loading || !product) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center bg-slate-50/50">
        <Loader2 className="w-12 h-12 text-sky-500 animate-spin mb-4" />
        <p className="text-slate-500 font-black tracking-wider animate-pulse text-sm">PREPARANDO TU COMPRA SEGURA...</p>
      </div>
    );
  }

  if (orderSuccess) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center bg-slate-50/50 p-6">
        <div className="bg-white rounded-[2.5rem] p-8 md:p-12 max-w-lg w-full shadow-2xl text-center space-y-6 animate-in zoom-in-95 duration-500 border border-slate-100">
          <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
            <CheckCircle2 className="w-10 h-10" />
          </div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight">¡Pedido Confirmado!</h2>
          <p className="text-slate-500 text-base md:text-lg">Tu número de orden es <strong className="text-slate-900 bg-slate-100 px-2 py-1 rounded">{orderSuccess.orderNumber}</strong></p>
          <p className="text-slate-400 text-sm">Hemos enviado los detalles a <b className="text-slate-700">{customerEmail}</b></p>
          
          {paymentMethod === 'addi' ? (
            <div className="mt-8">
              <p className="text-sm text-slate-600 mb-4">Para finalizar tu pago con Addi, haz clic en el botón de abajo para que un asesor te envíe el link de aprobación a tu WhatsApp.</p>
              <a 
                href={`https://wa.me/573022875280?text=Hola%21%20Acabo%20de%20hacer%20el%20pedido%20%23${orderSuccess.orderNumber}%20por%20${grandTotal.toLocaleString('es-CO')}%20COP%20y%20quiero%20pagarlo%20con%20Addi.%20Me%20env%C3%ADan%20el%20link%20de%20pago%3F`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center h-14 text-base font-black bg-[#4A3BFA] hover:bg-[#392CD1] text-white rounded-2xl shadow-lg transition-all cursor-pointer"
              >
                Solicitar link de Addi
              </a>
            </div>
          ) : (
            <Button onClick={() => navigate('/')} className="mt-8 w-full h-14 text-base font-black bg-gradient-to-r from-slate-900 to-slate-950 hover:from-black hover:to-slate-900 text-white rounded-2xl shadow-lg transition-all cursor-pointer">
              Volver a la tienda
            </Button>
          )}
        </div>
        <div id="quick-thermal-ticket" className="hidden">
          <ThermalTicket order={orderSuccess} finalTotal={grandTotal} cardFee={cardSurcharge} totalCOP={unitPrice} finalTotalCOP={grandTotal} config={ticketConfig} preview={true} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50/50 pt-6 pb-28 lg:pb-16 px-4 md:px-6">
      <div className="max-w-5xl mx-auto">
        
        {/* HEADER COMPRA SEGURA */}
        <div className="mb-8 flex items-center justify-center gap-2.5">
          <ShieldCheck className="w-7 h-7 text-sky-500" strokeWidth={2.5} />
          <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight uppercase">Checkout Seguro</h1>
        </div>

        {/* TOP MOBILE SUMMARY CARD */}
        <div className="lg:hidden bg-white p-4.5 rounded-[2rem] border border-slate-100 shadow-[0_10px_30px_rgba(0,0,0,0.02)] flex items-center gap-4.5 mb-6">
          <div className="w-18 h-18 bg-slate-50 rounded-2xl p-1.5 border border-slate-100 shadow-inner shrink-0 flex items-center justify-center">
            <img src={product.image} alt={product.name} className="w-full h-full object-contain" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-[9px] font-black text-sky-600 uppercase tracking-wider block leading-none">Estás comprando</span>
            <h3 className="font-black text-slate-900 text-sm leading-snug truncate mt-1">{product.name}</h3>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              {selectedStorage && <span className="bg-slate-50 px-2 py-0.5 rounded-lg border border-slate-100 text-[10px] font-bold text-slate-500">{selectedStorage}</span>}
              {selectedColor && <span className="bg-slate-50 px-2 py-0.5 rounded-lg border border-slate-100 text-[10px] font-bold text-slate-500">{selectedColor}</span>}
              
              <div className="flex items-center gap-2 bg-slate-100 rounded-lg ml-2">
                <button 
                  onClick={() => setQuantity(Math.max(1, quantity - 1))} 
                  className="w-6 h-6 flex items-center justify-center font-bold text-slate-500"
                >-</button>
                <span className="text-xs font-black">{quantity}</span>
                <button 
                  onClick={() => setQuantity(Math.min(availableStock, quantity + 1))} 
                  className="w-6 h-6 flex items-center justify-center font-bold text-slate-500"
                >+</button>
              </div>
            </div>
          </div>
          <div className="text-right shrink-0">
            <span className="text-[9px] text-slate-400 font-bold block uppercase tracking-wide">Total</span>
            <span className="font-black text-slate-955 text-base block mt-0.5">${grandTotal.toLocaleString('es-CO')}</span>
          </div>
        </div>

        <div className="grid lg:grid-cols-12 gap-8 items-start">
          
          {/* COLUMNA IZQUIERDA: FORMULARIOS */}
          <div className="lg:col-span-7 space-y-6">
            
            {/* Paso 1: Datos */}
            <div className="bg-white p-6 md:p-8 rounded-[2rem] border border-slate-100 shadow-[0_15px_35px_rgba(0,0,0,0.02)]">
              <h3 className="font-black text-slate-900 text-base md:text-lg mb-6 flex items-center gap-3 tracking-tight">
                <span className="w-7.5 h-7.5 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-black">1</span>
                DATOS PERSONALES
              </h3>
              <div className="grid sm:grid-cols-2 gap-5">
                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">Nombre completo *</label>
                  <input type="text" value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Ej. Juan Pérez"
                    className="w-full px-4.5 py-3.5 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:bg-white focus:border-sky-500 focus:ring-4 focus:ring-sky-500/10 transition-all font-semibold text-slate-800 placeholder:text-slate-400 shadow-inner text-sm md:text-base" />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">Cédula o NIT *</label>
                  <input type="text" value={customerIdNumber} onChange={e => setCustomerIdNumber(e.target.value)} placeholder="Documento"
                    className="w-full px-4.5 py-3.5 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:bg-white focus:border-sky-500 focus:ring-4 focus:ring-sky-500/10 transition-all font-semibold text-slate-800 placeholder:text-slate-400 shadow-inner text-sm md:text-base" />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">Teléfono *</label>
                  <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Ej. 302 287 5280"
                    className="w-full px-4.5 py-3.5 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:bg-white focus:border-sky-500 focus:ring-4 focus:ring-sky-500/10 transition-all font-semibold text-slate-800 placeholder:text-slate-400 shadow-inner text-sm md:text-base" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">Correo Electrónico *</label>
                  <input type="email" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} placeholder="Para enviarte la factura digital"
                    className="w-full px-4.5 py-3.5 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:bg-white focus:border-sky-500 focus:ring-4 focus:ring-sky-500/10 transition-all font-semibold text-slate-800 placeholder:text-slate-400 shadow-inner text-sm md:text-base" />
                </div>
              </div>
            </div>

            {/* Paso 2: Entrega */}
            <div className="bg-white p-6 md:p-8 rounded-[2rem] border border-slate-100 shadow-[0_15px_35px_rgba(0,0,0,0.02)]">
              <h3 className="font-black text-slate-900 text-base md:text-lg mb-6 flex items-center gap-3 tracking-tight">
                <span className="w-7.5 h-7.5 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-black">2</span>
                MÉTODO DE ENTREGA
              </h3>
              <div className="grid grid-cols-2 gap-4 mb-6">
                {([
                  { value: 'delivery', label: 'A Domicilio', sub: '+$10.000 COP', Icon: Truck },
                  { value: 'pickup', label: 'Retiro Tienda', sub: '¡Gratis!', Icon: Store },
                ] as const).map(opt => (
                  <button key={opt.value} type="button" onClick={() => setDeliveryMethod(opt.value)}
                    className={`p-4 border-2 rounded-2xl transition-all flex flex-col items-center text-center cursor-pointer ${
                      deliveryMethod === opt.value 
                        ? 'border-sky-500 bg-sky-50/50 shadow-sm scale-[1.02] ring-4 ring-sky-500/5' 
                        : 'border-slate-100 hover:border-slate-300 hover:bg-slate-50'
                    }`}>
                    <opt.Icon className={`w-7 h-7 mb-1.5 ${deliveryMethod === opt.value ? 'text-sky-500' : 'text-slate-400'}`} />
                    <div className={`font-black text-xs md:text-sm ${deliveryMethod === opt.value ? 'text-sky-950' : 'text-slate-700'}`}>{opt.label}</div>
                    <div className={`text-[10px] font-black mt-0.5 ${deliveryMethod === opt.value ? 'text-sky-600' : 'text-slate-500'}`}>{opt.sub}</div>
                  </button>
                ))}
              </div>

              {deliveryMethod === 'delivery' && (
                <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">Barrio y Dirección Exacta *</label>
                  <textarea value={address} onChange={e => setAddress(e.target.value)} placeholder="Ej. Barrio Manga, Calle 24 # 17-50, Apto 302" rows={3}
                    className="w-full px-4.5 py-3.5 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:bg-white focus:border-sky-500 focus:ring-4 focus:ring-sky-500/10 transition-all resize-none font-semibold text-slate-800 placeholder:text-slate-400 shadow-inner text-sm" />
                  <p className="text-xs text-sky-800 mt-2.5 flex items-center gap-1.5 font-bold">
                    <Zap className="w-4 h-4 text-sky-500 animate-pulse" /> Entrega flash en menos de 1 hora en Cartagena.
                  </p>
                </div>
              )}
            </div>

            {/* Paso 3: Pago */}
            <div className="bg-white p-6 md:p-8 rounded-[2rem] border border-slate-100 shadow-[0_15px_35px_rgba(0,0,0,0.02)]">
              <h3 className="font-black text-slate-900 text-base md:text-lg mb-6 flex items-center gap-3 tracking-tight">
                <span className="w-7.5 h-7.5 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-black">3</span>
                MÉTODO DE PAGO
              </h3>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {paymentMethods.map(opt => {
                  const isSelected = paymentMethod === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setPaymentMethod(opt.value as PaymentMethod)}
                      className={`p-4 border-2 rounded-2xl transition-all flex items-center gap-4 text-left cursor-pointer ${
                        isSelected 
                          ? 'border-sky-500 bg-sky-50/50 shadow-sm ring-4 ring-sky-500/5' 
                          : 'border-slate-100 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <span className="text-2xl shrink-0">{opt.icon}</span>
                      <div className="min-w-0">
                        <div className={`font-black text-xs md:text-sm ${isSelected ? 'text-sky-950' : 'text-slate-700'}`}>{opt.label}</div>
                        <div className={`text-[10px] font-bold mt-0.5 ${isSelected ? 'text-sky-600' : 'text-slate-400'}`}>{opt.sub}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

          </div>

          {/* COLUMNA DERECHA: RESUMEN PRODUCTO (DESKTOP ONLY) */}
          <div className="lg:col-span-5 sticky top-24 hidden lg:block">
            <div className="bg-white rounded-[2rem] border border-slate-100 shadow-[0_15px_35px_rgba(0,0,0,0.03)] overflow-hidden">
              
              <div className="bg-slate-50/60 p-6 flex items-center gap-4 border-b border-slate-100/55">
                <div className="w-20 h-20 bg-white rounded-2xl p-2 border border-slate-100 shadow-sm shrink-0 flex items-center justify-center">
                  <img src={product.image} alt={product.name} className="w-full h-full object-contain" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-black text-slate-900 text-base leading-tight mb-1 truncate">{product.name}</h3>
                  <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500 mt-1">
                    {selectedStorage && <span className="bg-white px-2 py-0.5 rounded-lg border border-slate-200">{selectedStorage}</span>}
                    {selectedColor && <span className="bg-white px-2 py-0.5 rounded-lg border border-slate-200">{selectedColor}</span>}
                    
                    <div className="flex items-center gap-2 bg-slate-100 rounded-lg ml-auto">
                      <button 
                        onClick={() => setQuantity(Math.max(1, quantity - 1))} 
                        className="w-7 h-7 flex items-center justify-center font-bold text-slate-500 hover:bg-slate-200 rounded-l-lg transition-colors"
                      >-</button>
                      <span className="text-sm font-black w-4 text-center">{quantity}</span>
                      <button 
                        onClick={() => setQuantity(Math.min(availableStock, quantity + 1))} 
                        className="w-7 h-7 flex items-center justify-center font-bold text-slate-500 hover:bg-slate-200 rounded-r-lg transition-colors"
                      >+</button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-4">
                <div className="flex justify-between text-slate-600 font-bold text-sm">
                  <span>Subtotal ({quantity}x)</span>
                  <span>${(unitPrice * quantity).toLocaleString('es-CO')}</span>
                </div>
                {deliveryFee > 0 && (
                  <div className="flex justify-between text-slate-600 font-bold text-sm">
                    <span>Envío a Domicilio</span>
                    <span>+${DELIVERY_FEE.toLocaleString('es-CO')}</span>
                  </div>
                )}
                {(paymentMethod === 'tarjeta' || paymentMethod === 'bold') && (
                  <div className="flex justify-between text-sky-600 font-bold text-sm">
                    <span>Recargo Tarjeta (5%)</span>
                    <span>+${cardSurcharge.toLocaleString('es-CO')}</span>
                  </div>
                )}
                
                {paymentMethod === 'addi' && (
                  <div className="flex justify-between text-orange-500 font-bold text-sm">
                    <span>Recargo Addi (25%)</span>
                    <span>+${addiSurcharge.toLocaleString('es-CO')}</span>
                  </div>
                )}
                
                <div className="border-t border-slate-100 pt-4 mt-2">
                  <div className="flex justify-between items-end">
                    <span className="text-slate-400 font-black uppercase tracking-wider text-[10px]">Total a Pagar</span>
                    <div className="text-3xl font-black text-slate-955 tracking-tight leading-none">
                      <span className="text-lg text-sky-500 mr-0.5">$</span>
                      {grandTotal.toLocaleString('es-CO')}
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-6 bg-slate-50/60 border-t border-slate-100/55">
                {paymentMethod === 'bold' ? (
                  <Button onClick={handleBoldPayment} disabled={boldLoading || availableStock === 0}
                    className="w-full h-15 text-base font-black bg-gradient-to-r from-blue-600 to-blue-800 hover:from-blue-700 hover:to-blue-900 text-white shadow-lg shadow-blue-500/10 rounded-2xl transition-all cursor-pointer flex items-center justify-center gap-2 animate-in fade-in duration-300">
                    {boldLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <CreditCard className="w-5 h-5" />}
                    Pagar Seguro con BOLD
                  </Button>
                ) : paymentMethod === 'addi' ? (
                  <Button onClick={handleAddiPayment} disabled={isSubmitting || availableStock === 0}
                    className="w-full h-15 text-base font-black bg-[#4A3BFA] hover:bg-[#392CD1] text-white shadow-lg rounded-2xl transition-all cursor-pointer flex items-center justify-center gap-2 animate-in fade-in duration-300">
                    {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShoppingBag className="w-5 h-5" />}
                    Pagar con Addi
                  </Button>
                ) : (
                  <Button onClick={handleCompleteOrder} disabled={isSubmitting || availableStock === 0}
                    className="w-full h-15 text-base font-black bg-gradient-to-r from-slate-900 to-slate-950 hover:from-black hover:to-slate-900 text-white shadow-lg rounded-2xl transition-all cursor-pointer flex items-center justify-center gap-2 animate-in fade-in duration-300">
                    {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShoppingBag className="w-5 h-5" />}
                    Confirmar mi Pedido
                  </Button>
                )}
                {boldError && <p className="mt-4 text-xs text-rose-600 font-bold text-center">{boldError}</p>}
                {availableStock === 0 && <p className="mt-4 text-xs text-rose-600 font-black text-center bg-rose-50 p-2.5 rounded-xl border border-rose-100">Este producto se encuentra agotado en inventario</p>}
              </div>

            </div>
          </div>

        </div>
      </div>

      {/* STICKY BOTTOM BAR FOR MOBILE */}
      <div 
        className="fixed bottom-0 left-0 right-0 lg:hidden bg-white border-t border-slate-100 px-5 shadow-[0_-12px_40px_rgba(15,23,42,0.08)] z-50 flex items-center justify-between gap-4"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)', paddingTop: '12px' }}
      >
        <div className="flex flex-col">
          <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider block leading-none">Total a pagar</span>
          <span className="text-xl font-black text-slate-955 leading-none mt-1.5 block">
            ${grandTotal.toLocaleString('es-CO')}
          </span>
        </div>
        
        <div className="flex-1 max-w-[210px]">
          {availableStock === 0 ? (
            <div className="w-full h-13 bg-rose-50 border border-rose-100 text-rose-600 rounded-xl flex items-center justify-center text-xs font-black">
              AGOTADO
            </div>
          ) : paymentMethod === 'bold' ? (
            <Button 
              onClick={handleBoldPayment} 
              disabled={boldLoading}
              className="w-full h-13 text-sm font-black bg-gradient-to-r from-blue-600 to-blue-800 hover:from-blue-700 hover:to-blue-900 text-white shadow-md shadow-blue-500/10 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 animate-in fade-in duration-300"
            >
              {boldLoading ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <CreditCard className="w-4.5 h-4.5" />}
              Pagar con BOLD
            </Button>
          ) : paymentMethod === 'addi' ? (
            <Button 
              onClick={handleAddiPayment} 
              disabled={isSubmitting}
              className="w-full h-13 text-sm font-black bg-[#4A3BFA] hover:bg-[#392CD1] text-white shadow-md rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 animate-in fade-in duration-300"
            >
              {isSubmitting ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <ShoppingBag className="w-4.5 h-4.5" />}
              Pagar con Addi
            </Button>
          ) : (
            <Button 
              onClick={handleCompleteOrder} 
              disabled={isSubmitting}
              className="w-full h-13 text-sm font-black bg-gradient-to-r from-slate-900 to-slate-950 hover:from-black hover:to-slate-900 text-white shadow-md rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 animate-in fade-in duration-300"
            >
              {isSubmitting ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <ShoppingBag className="w-4.5 h-4.5" />}
              Confirmar Pedido
            </Button>
          )}
        </div>
      </div>

    </div>
  );
}
