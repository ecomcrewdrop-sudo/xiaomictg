import { Product, useProducts } from './ProductContext';
import { Link } from 'react-router';
import { ShoppingCart, Zap, Bell } from 'lucide-react';
import { useToast } from './ToastContext';
import { useState } from 'react';
import { QuickBuyDialog } from './QuickBuyDialog';
import { API_BASE_URL, fetchWithTimeout } from '../lib/api-base';

interface ProductCardProps {
  product: Product;
}

const EXCHANGE_RATE = 1;

export function ProductCard({ product }: ProductCardProps) {
  const { addToCart } = useProducts();
  const { showToast } = useToast();
  const [selectedColor, setSelectedColor] = useState<string | undefined>(
    product.colorVariants?.[0]?.color
  );
  const [selectedStorage, setSelectedStorage] = useState<string | undefined>(
    product.storageVariants?.[0]?.storage
  );
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showStoragePicker, setShowStoragePicker] = useState(false);

  // Estado del modal de compra impulsiva
  const [quickBuyOpen, setQuickBuyOpen] = useState(false);

  // Estado para "Notificarme cuando haya stock"
  const [showNotifyInput, setShowNotifyInput] = useState(false);
  const [notifyPhone, setNotifyPhone] = useState('');
  const [notifyDone, setNotifyDone] = useState(false);
  const [notifySending, setNotifySending] = useState(false);

  const getCurrentPrice = () => {
    if (product.storageVariants && selectedStorage) {
      const variant = product.storageVariants.find(v => v.storage === selectedStorage);
      return variant?.price || product.price;
    }
    return product.price;
  };

  const currentPrice = getCurrentPrice();
  const priceInCOP = Math.round(currentPrice * EXCHANGE_RATE);

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (product.storageVariants && product.storageVariants.length > 0 && !selectedStorage) {
      showToast('Por favor selecciona una capacidad de almacenamiento');
      setShowStoragePicker(true);
      return;
    }
    if (product.colorVariants && product.colorVariants.length > 0 && !selectedColor) {
      showToast('Por favor selecciona un color');
      setShowColorPicker(true);
      return;
    }

    addToCart(product, 1, selectedColor, selectedStorage);
    let message = product.name;
    if (selectedStorage) message += ` ${selectedStorage}`;
    if (selectedColor) message += ` (${selectedColor})`;
    showToast(`${message} agregado al carrito`);
  };

  // Abre el modal de compra impulsiva sin navegar al detalle
  const handleQuickBuy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setQuickBuyOpen(true);
  };

  const getAvailableStock = () => {
    // Stock general = 0 actúa como interruptor maestro (producto agotado)
    if (product.stock <= 0) return 0;
    if (product.storageVariants && selectedStorage) {
      const variant = product.storageVariants.find(v => v.storage === selectedStorage);
      return variant?.stock || 0;
    }
    if (product.colorVariants && selectedColor) {
      const variant = product.colorVariants.find(v => v.color === selectedColor);
      return variant?.stock || 0;
    }
    return product.stock;
  };

  const availableStock = getAvailableStock();
  const isLowStock = availableStock > 0 && availableStock < 5;
  const isMediumStock = availableStock >= 5 && availableStock <= 10;

  const handleNotifySubmit = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!notifyPhone || notifyPhone.length < 10) return;
    setNotifySending(true);
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/stock-alerts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: product.id, productName: product.name, phone: notifyPhone }),
      });
      if (res.ok) {
        setNotifyDone(true);
        showToast('✅ Te avisaremos por WhatsApp cuando haya stock');
      }
    } catch { /* silently fail */ }
    setNotifySending(false);
  };

  return (
    <>
      <Link to={`/product/${product.id}`}>
        <div className="group bg-white overflow-hidden hover:shadow-[0_20px_50px_rgba(0,0,0,0.06)] transition-all duration-500 cursor-pointer border border-transparent hover:border-gray-50 relative flex flex-col h-full rounded-2xl md:rounded-[2rem]">

          {/* Badges Integrados (Optimizados para móvil) */}
          <div className="absolute top-2 left-2 sm:top-4 sm:left-4 z-20 flex flex-col gap-1 sm:gap-2 items-start max-w-[90%]">
            {/* Badge contra entrega */}
            <span className="bg-black/90 backdrop-blur-md text-white text-[8px] sm:text-[10px] font-bold px-2 py-0.5 sm:px-3 sm:py-1 tracking-widest shadow-lg rounded-full">
              CONTRA ENTREGA
            </span>
            
            {/* Badges de inventario */}
            {availableStock === 0 && (
              <span className="bg-gray-900/90 backdrop-blur-md text-white text-[8px] sm:text-[10px] font-bold px-2 py-0.5 sm:px-3 sm:py-1 tracking-widest shadow-lg rounded-full">
                AGOTADO
              </span>
            )}
            {isLowStock && (
              <span className="bg-orange-500/90 backdrop-blur-md text-white text-[8px] sm:text-[10px] font-bold px-2 py-0.5 sm:px-3 sm:py-1 tracking-widest shadow-lg rounded-full">
                ÚLTIMAS {availableStock}
              </span>
            )}
          </div>

          {/* Imagen con Glow 2026 */}
          <div className="aspect-square overflow-visible bg-transparent relative flex items-center justify-center p-3 md:p-6 mt-1 md:mt-2">
            <div className="absolute inset-0 bg-gradient-to-tr from-gray-100 to-gray-50 opacity-0 group-hover:opacity-100 transition-opacity duration-700 rounded-full blur-2xl scale-75"></div>
            <img
              src={product.image}
              alt={`${product.name} - Xiaomi Cartagena`}
              className="w-full h-full object-contain relative z-10 group-hover:scale-110 group-hover:-translate-y-2 transition-all duration-700 drop-shadow-xl"
              loading="lazy"
              onError={(e) => {
                const target = e.currentTarget;
                target.onerror = null;
                target.src = `https://placehold.co/400x400/f5f5f5/999999?text=${encodeURIComponent(product.name.split(' ').slice(0, 2).join(' '))}`;
              }}
            />
          </div>

          <div className="p-3 md:p-5 text-center flex flex-col flex-1 relative z-20">
            <h3 className="font-bold text-[13px] md:text-[14px] text-gray-900 leading-tight mb-3 group-hover:text-orange-500 transition-colors line-clamp-2 min-h-[32px] md:min-h-[36px]">
              {product.name}
            </h3>

            {/* Selector almacenamiento */}
            {product.storageVariants && product.storageVariants.length > 0 && (
              <div className="mb-3">
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {product.storageVariants.map((variant) => (
                    <button
                      key={variant.storage}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setSelectedStorage(variant.storage);
                        setShowStoragePicker(true);
                      }}
                      className={`px-2.5 py-1 rounded border-2 text-xs font-medium transition-all ${
                        selectedStorage === variant.storage
                          ? 'border-orange-500 bg-orange-50 text-orange-700'
                          : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                      }`}
                    >
                      {variant.storage}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Selector colores */}
            {product.colorVariants && product.colorVariants.length > 0 && (
              <div className="mb-3">
                <div className="flex flex-wrap gap-2 justify-center">
                  {product.colorVariants.map((variant) => (
                    <button
                      key={variant.color}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setSelectedColor(variant.color);
                        setShowColorPicker(true);
                      }}
                      className={`relative w-6 h-6 rounded-full border-2 transition-all ${
                        selectedColor === variant.color
                          ? 'border-orange-500 ring-2 ring-orange-200'
                          : 'border-gray-300 hover:border-gray-400'
                      }`}
                      style={{ backgroundColor: variant.colorHex }}
                      title={variant.color}
                    >
                      {selectedColor === variant.color && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-1.5 h-1.5 bg-white rounded-full shadow" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-auto pt-2">
              <div className="flex flex-col items-center gap-0.5 md:gap-1 mb-2 md:mb-4">
                <span className="text-lg md:text-2xl font-semibold text-gray-800">
                  ${priceInCOP.toLocaleString('es-CO')}
                </span>

                {/* Envío badge y stock unificados */}
                {availableStock > 0 ? (
                  <div className="flex flex-col items-center mt-0.5 md:mt-1">
                    <span className="text-[10px] md:text-xs text-gray-600 font-medium flex items-center gap-1">
                      <Zap className="w-3 h-3 text-orange-500" /> Envío en 1 hora
                    </span>
                  </div>
                ) : (
                  <span className="text-[10px] md:text-xs text-gray-400 font-medium mt-1">Agotado</span>
                )}
              </div>

              {/* CTAs */}
              <div className="mt-1 md:mt-2 flex flex-col gap-1.5 md:gap-2 relative z-30 transition-transform duration-500 group-hover:-translate-y-1">
                <button
                  onClick={handleAddToCart}
                  disabled={availableStock === 0}
                  className="w-full bg-gradient-to-r from-orange-500 to-orange-400 hover:from-orange-600 hover:to-orange-500 text-white py-1.5 md:py-2.5 text-[10px] md:text-[13px] font-bold transition-all shadow-md flex items-center justify-center gap-1 disabled:from-gray-300 disabled:to-gray-300 disabled:shadow-none disabled:cursor-not-allowed rounded-lg md:rounded-xl"
                >
                  <ShoppingCart className="w-3 h-3 md:w-4 md:h-4" />
                  Al Carrito
                </button>

                {availableStock > 0 && (
                  <button
                    onClick={handleQuickBuy}
                    className="w-full bg-gradient-to-b from-gray-800 to-gray-900 hover:from-black hover:to-black text-white py-1.5 md:py-2.5 text-[10px] md:text-[13px] font-bold transition-all shadow-md flex items-center justify-center gap-1 rounded-lg md:rounded-xl border-t border-gray-700"
                  >
                    <Zap className="w-3 h-3 md:w-4 md:h-4 text-orange-400" />
                    Comprar Ahora
                  </button>
                )}

                {availableStock === 0 && (
                  notifyDone ? (
                    <div className="w-full bg-green-50 text-green-600 py-1.5 md:py-2.5 text-[10px] md:text-[13px] font-semibold flex items-center justify-center gap-1 rounded-lg md:rounded-xl cursor-default">
                      <Bell className="w-3 h-3" /> Te avisaremos
                    </div>
                  ) : showNotifyInput ? (
                    <div className="w-full flex gap-1" onClick={e => e.preventDefault()}>
                      <input
                        type="tel"
                        value={notifyPhone}
                        onChange={e => setNotifyPhone(e.target.value)}
                        onClick={e => e.preventDefault()}
                        placeholder="Tu WhatsApp"
                        className="flex-1 min-w-0 border border-gray-300 rounded-lg px-2 py-1.5 text-[10px] md:text-xs focus:outline-none focus:border-orange-400"
                      />
                      <button
                        onClick={handleNotifySubmit}
                        disabled={notifySending || notifyPhone.length < 10}
                        className="bg-orange-500 hover:bg-orange-600 text-white px-2 py-1.5 rounded-lg text-[10px] md:text-xs font-bold disabled:opacity-50 whitespace-nowrap"
                      >
                        {notifySending ? '...' : 'Avisar'}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => { e.preventDefault(); setShowNotifyInput(true); }}
                      className="w-full bg-orange-50 hover:bg-orange-100 text-orange-600 py-1.5 md:py-2.5 text-[10px] md:text-[13px] font-semibold flex items-center justify-center gap-1 rounded-lg md:rounded-xl transition-colors"
                    >
                      <Bell className="w-3 h-3 md:w-4 md:h-4" />
                      Avísame cuando haya
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      </Link>

      {/* Modal de compra impulsiva — solo se monta cuando está abierto */}
      {quickBuyOpen && (
        <QuickBuyDialog
          isOpen={quickBuyOpen}
          onClose={() => setQuickBuyOpen(false)}
          product={product}
          initialColor={selectedColor}
          initialStorage={selectedStorage}
        />
      )}
    </>
  );
}
