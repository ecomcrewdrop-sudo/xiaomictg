import { Product, useProducts } from './ProductContext';
import { Link, useNavigate } from 'react-router';
import { ShoppingCart, Zap, Scale } from 'lucide-react';
import { useToast } from './ToastContext';
import { useState } from 'react';
import { useCompareStore } from './CompareStore';
import { QuickBuyDialog } from './QuickBuyDialog';

interface ProductCardProps {
  product: Product;
}

const EXCHANGE_RATE = 1;

export function ProductCard({ product }: ProductCardProps) {
  const { addToCart } = useProducts();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const { addItem } = useCompareStore();
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
  const isMediumStock = availableStock > 0 && availableStock <= 10;

  return (
    <>
      <Link to={`/product/${product.id}`}>
        <div className="group bg-white overflow-hidden hover:shadow-2xl transition-all duration-500 cursor-pointer border border-gray-100 relative flex flex-col h-full">

          {/* Badges Integrados (Optimizados para móvil) */}
          <div className="absolute top-2 left-2 sm:top-3 sm:left-3 z-10 flex flex-col gap-1.5 items-start max-w-[90%]">
            {/* Badge contra entrega */}
            <span className="bg-white/95 backdrop-blur-sm border border-gray-200 text-gray-800 text-[9px] sm:text-[10px] font-bold px-2 py-0.5 tracking-widest shadow-sm rounded-[2px]">
              CONTRA ENTREGA
            </span>
            
            {/* Badges de inventario */}
            {availableStock === 0 && (
              <span className="bg-black/80 backdrop-blur-sm text-gray-100 text-[9px] sm:text-[10px] font-bold px-2 py-0.5 tracking-widest shadow-sm rounded-[2px]">
                AGOTADO
              </span>
            )}
            {isLowStock && (
              <span className="bg-black text-white text-[9px] sm:text-[10px] font-bold px-2 py-0.5 tracking-widest shadow-sm rounded-[2px]">
                ÚLTIMAS {availableStock}
              </span>
            )}
          </div>

          {/* Imagen */}
          <div className="aspect-square overflow-hidden bg-white">
            <img
              src={product.image}
              alt={`${product.name} - Xiaomi Cartagena`}
              className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
              loading="lazy"
              onError={(e) => {
                const target = e.currentTarget;
                target.onerror = null;
                target.src = `https://placehold.co/400x400/f5f5f5/999999?text=${encodeURIComponent(product.name.split(' ').slice(0, 2).join(' '))}`;
              }}
            />
          </div>

          <div className="p-5 text-center flex flex-col flex-1 relative z-20">
            <h3 className="font-bold text-[13px] text-gray-900 leading-tight mb-2 group-hover:text-orange-500 transition-colors line-clamp-2 min-h-[36px]">
              {product.name}
            </h3>

            <p className="text-xs text-gray-500 mb-3 line-clamp-2 font-light leading-relaxed min-h-[2.5rem]">
              {product.description}
            </p>

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
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
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

            <div className="mt-auto">
              <div className="flex flex-col items-center gap-1 mb-4">
                <span className="text-2xl font-normal text-gray-600">
                  ${priceInCOP.toLocaleString('es-CO')}
                  <span className="text-sm font-normal text-gray-600 ml-1">COP</span>
                </span>

                {isLowStock && (
                  <span className="text-xs text-gray-800 font-semibold">
                    Solo {availableStock} disponibles
                  </span>
                )}
                {isMediumStock && (
                  <span className="text-xs text-gray-500 font-medium">
                    {availableStock} disponibles
                  </span>
                )}
                {availableStock === 0 && (
                  <span className="text-xs text-gray-400 font-medium">Agotado</span>
                )}

                {/* Envío badge */}
                {availableStock > 0 && (
                  <span className="text-xs text-green-600 font-medium flex items-center gap-1 mt-0.5">
                    <Zap className="w-3 h-3" />
                    Envío en 1 hora · Cartagena
                  </span>
                )}
              </div>

              {/* CTAs — siempre visibles en móvil, hover en desktop */}
              <div className="mt-2 flex flex-col gap-2 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-300 relative z-30">
                {/* Fila 1: Agregar al carrito + Comparar */}
                <div className="flex gap-2">
                  <button
                    onClick={handleAddToCart}
                    disabled={availableStock === 0}
                    className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-2.5 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 disabled:bg-gray-300 disabled:cursor-not-allowed rounded"
                  >
                    <ShoppingCart className="w-3.5 h-3.5" />
                    Agregar
                  </button>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      addItem(product);
                    }}
                    className="bg-gray-100 hover:bg-gray-200 text-gray-800 py-2.5 px-3 text-xs font-semibold transition-colors flex items-center justify-center rounded border border-gray-200"
                    title="Comparar equipo"
                  >
                    <Scale className="w-4 h-4" />
                  </button>
                </div>

                {/* Fila 2: Comprar Ahora (compra impulsiva) */}
                {availableStock > 0 && (
                  <button
                    onClick={handleQuickBuy}
                    className="w-full bg-gray-900 hover:bg-black text-white py-2.5 text-xs font-bold transition-colors flex items-center justify-center gap-1.5 rounded"
                  >
                    <Zap className="w-3.5 h-3.5 text-orange-400" />
                    Comprar Ahora
                  </button>
                )}

                {/* Fila 3: Ver detalles */}
                {availableStock === 0 && (
                  <div className="w-full bg-gray-200 text-gray-500 py-2.5 text-xs font-semibold flex items-center justify-center rounded cursor-default">
                    Sin stock
                  </div>
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
