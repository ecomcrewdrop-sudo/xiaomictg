import { useParams, useNavigate, Link } from 'react-router';
import { useProducts } from '../ProductContext';
import { Star, ShoppingCart, ArrowLeft, Package, Shield, Truck, Zap, CheckCircle } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useToast } from '../ToastContext';
import { QuickBuyDialog } from '../QuickBuyDialog';
import { ProductReviews } from '../ProductReviews';
import { API_ORIGIN } from '../../lib/api-base';

const EXCHANGE_RATE = 1; // Precios en COP

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { products, addToCart } = useProducts();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'specs' | 'reviews'>('specs');
  const [quantity, setQuantity] = useState(1);
  const [selectedColor, setSelectedColor] = useState<string | undefined>(undefined);
  const [selectedStorage, setSelectedStorage] = useState<string | undefined>(undefined);
  const [quickBuyOpen, setQuickBuyOpen] = useState(false);
  const [ratingSummary, setRatingSummary] = useState({ average: 0, count: 0 });

  // Scroll al top cuando se monta el componente o cambia el ID
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);

  const product = products.find(p => p.id === id);
  
  // Inicializar selecciones por defecto y cargar reseñas
  useEffect(() => {
    if (product) {
      if (product.storageVariants && product.storageVariants.length > 0 && !selectedStorage) {
        setSelectedStorage(product.storageVariants[0].storage);
      }
      if (product.colorVariants && product.colorVariants.length > 0 && !selectedColor) {
        setSelectedColor(product.colorVariants[0].color);
      }
      
      // Fetch dynamic reviews for the star badge
      fetch(`${API_ORIGIN}/api/products/${product.id}/reviews`)
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data) && data.length > 0) {
            const avg = data.reduce((acc, r) => acc + r.rating, 0) / data.length;
            setRatingSummary({ average: avg, count: data.length });
          } else {
            setRatingSummary({ average: 5, count: 0 }); // Fallback visual
          }
        })
        .catch(console.error);
    }
  }, [product, selectedStorage, selectedColor]);

  if (!product) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <h2 className="text-2xl font-light text-gray-900 mb-4">Producto no encontrado</h2>
        <Link to="/" className="text-orange-500 hover:text-orange-600">
          Volver al inicio
        </Link>
      </div>
    );
  }

  // Obtener precio según el almacenamiento seleccionado
  const getCurrentPrice = () => {
    if (product.storageVariants && selectedStorage) {
      const variant = product.storageVariants.find(v => v.storage === selectedStorage);
      return variant?.price || product.price;
    }
    return product.price;
  };
  
  const currentPrice = getCurrentPrice();
  const totalPriceCOP = currentPrice * quantity;
  
  // Obtener stock disponible
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

  const handleAddToCart = () => {
    if (product) {
      // Verificar variantes de almacenamiento
      if (product.storageVariants && product.storageVariants.length > 0 && !selectedStorage) {
        showToast('Por favor selecciona una capacidad de almacenamiento');
        return;
      }
      
      // Verificar variantes de colores
      if (product.colorVariants && product.colorVariants.length > 0 && !selectedColor) {
        showToast('Por favor selecciona un color');
        return;
      }
      
      addToCart(product, quantity, selectedColor, selectedStorage);
      
      let message = `${quantity} ${product.name}`;
      if (selectedStorage) message += ` ${selectedStorage}`;
      if (selectedColor) message += ` (${selectedColor})`;
      showToast(`${message} agregado${quantity > 1 ? 's' : ''} al carrito`);
    }
  };

  return (
    <div className="bg-white min-h-screen">
      {/* Breadcrumb */}
      <div className="bg-gray-50 border-b border-gray-200">
        <div className="container mx-auto px-4 py-4">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-orange-500 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver
          </button>
        </div>
      </div>

      {/* Sección Principal */}
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          {/* Imagen del Producto */}
          <div className="aspect-square bg-white border border-gray-200 overflow-hidden">
            <img
              src={product.image}
              alt={product.name}
              className="w-full h-full object-cover"
            />
          </div>

          {/* Información del Producto */}
          <div className="flex flex-col">
            <div className="mb-4">
              <span className="text-xs uppercase tracking-wider text-gray-500 font-medium">
                {product.category === 'moviles' ? 'Teléfonos y Tabletas' :
                 product.category === 'smartwatch' ? 'Smartwatch' :
                 product.category === 'audifonos' ? 'Audífonos' :
                 product.category === 'accesorios' ? 'Estilo de Vida' :
                 product.category === 'scooter' ? 'Scooter' :
                 product.category === 'poco' ? 'POCO' : product.category}
              </span>
            </div>

            <h1 className="text-3xl md:text-4xl font-light text-gray-900 mb-4">
              {product.name}
            </h1>

            {/* Rating Stars Badge */}
            <div 
              className="flex items-center gap-3 mb-6 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => {
                setActiveTab('reviews');
                document.getElementById('tabs-section')?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star
                    key={star}
                    className={`w-5 h-5 ${
                      star <= Math.round(ratingSummary.average)
                        ? 'fill-amber-400 text-amber-400'
                        : 'text-slate-200 fill-slate-100'
                    }`}
                  />
                ))}
              </div>
              <div className="text-sm font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-100">
                {ratingSummary.average.toFixed(1)}
              </div>
              <span className="text-sm text-slate-500 underline decoration-slate-300 underline-offset-4">
                {ratingSummary.count > 0 ? `${ratingSummary.count} reseñas` : 'Sé el primero en opinar'}
              </span>
            </div>

            <p className="text-gray-600 font-light leading-relaxed mb-6">
              {product.description}
            </p>

            {/* Selector de Almacenamiento */}
            {product.storageVariants && product.storageVariants.length > 0 && (
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Capacidad de Almacenamiento
                </label>
                <div className="flex flex-wrap gap-3">
                  {product.storageVariants.map((variant) => (
                    <button
                      key={variant.storage}
                      onClick={() => setSelectedStorage(variant.storage)}
                      className={`px-6 py-3 rounded-lg border-2 text-sm font-medium transition-all ${
                        selectedStorage === variant.storage
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                      }`}
                    >
                      <div className="text-center">
                        <div className="font-semibold">{variant.storage}</div>
                        <div className="text-xs mt-1">
                          ${(variant.price * EXCHANGE_RATE).toLocaleString('es-CO')} COP
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Selector de Colores */}
            {product.colorVariants && product.colorVariants.length > 0 && (
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Color {selectedColor && `- ${selectedColor}`}
                </label>
                <div className="flex flex-wrap gap-3">
                  {product.colorVariants.map((variant) => (
                    <button
                      key={variant.color}
                      onClick={() => setSelectedColor(variant.color)}
                      className={`relative w-12 h-12 rounded-full border-2 transition-all ${
                        selectedColor === variant.color
                          ? 'border-orange-500 ring-4 ring-orange-200'
                          : 'border-gray-300 hover:border-gray-400'
                      }`}
                      style={{ backgroundColor: variant.colorHex }}
                      title={`${variant.color} (${variant.stock} disponibles)`}
                    >
                      {selectedColor === variant.color && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-3 h-3 bg-white rounded-full shadow"></div>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Precio */}
            <div className="mb-8">
              <div className="flex flex-col gap-2">
                <div className="text-4xl font-light text-gray-600">
                  ${currentPrice.toLocaleString('es-CO')} COP
                </div>
              </div>
              {availableStock < 10 && availableStock > 0 && (
                <span className="text-sm text-orange-500 font-medium mt-2 inline-block">
                  Solo {availableStock} disponibles
                </span>
              )}
              {availableStock === 0 && (
                <span className="text-sm text-red-500 font-medium mt-2 inline-block">
                  Producto agotado
                </span>
              )}
            </div>

            {/* Urgencia stock bajo */}
            {availableStock > 0 && availableStock < 5 && (
              <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-center gap-2">
                <Zap className="w-4 h-4 text-red-500 flex-shrink-0" />
                <span className="text-sm font-semibold text-red-700">
                  ¡Solo quedan {availableStock} unidades! Asegura el tuyo ahora.
                </span>
              </div>
            )}

            {/* Cantidad y Compra */}
            <div className="flex flex-col sm:flex-row gap-4 mb-4">
              <div className="flex items-center border border-gray-300">
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="px-4 py-3 hover:bg-gray-100 transition-colors"
                  disabled={availableStock === 0}
                >
                  -
                </button>
                <input
                  type="number"
                  min="1"
                  max={availableStock}
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, Math.min(availableStock, parseInt(e.target.value) || 1)))}
                  className="w-16 text-center py-3 border-x border-gray-300 focus:outline-none"
                  disabled={availableStock === 0}
                />
                <button
                  onClick={() => setQuantity(Math.min(availableStock, quantity + 1))}
                  className="px-4 py-3 hover:bg-gray-100 transition-colors"
                  disabled={availableStock === 0}
                >
                  +
                </button>
              </div>

              <button
                onClick={handleAddToCart}
                disabled={availableStock === 0}
                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-3 px-4 font-semibold transition-colors flex items-center justify-center gap-2 disabled:bg-gray-400 disabled:cursor-not-allowed text-base rounded"
              >
                <ShoppingCart className="w-5 h-5" />
                <span className="hidden sm:inline">{availableStock > 0 ? 'Agregar al Carrito' : 'Agotado'}</span>
                <span className="sm:hidden">{availableStock > 0 ? 'Agregar' : 'Agotado'}</span>
              </button>
            </div>

            {/* Comprar Ahora */}
            {availableStock > 0 && (
              <div className="flex flex-col gap-3 mb-6">
                {/* Botón Comprar Ahora - Compra impulsiva */}
                <button
                  onClick={() => setQuickBuyOpen(true)}
                  className="w-full flex items-center justify-center gap-2 bg-gray-900 hover:bg-black text-white py-3.5 font-bold transition-colors rounded text-base"
                >
                  <Zap className="w-5 h-5 text-orange-400" />
                  Comprar Ahora
                </button>
              </div>
            )}

            {/* Beneficios */}
            <div className="border-t border-gray-200 pt-5 space-y-3">
              <div className="flex items-center gap-3 text-sm text-gray-700">
                <Truck className="w-5 h-5 text-orange-500 flex-shrink-0" />
                <span><strong>Envío a domicilio $10.000</strong> · Todo Cartagena · ~1 hora</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-gray-700">
                <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                <span><strong>Pago contra entrega</strong> · Pagas al recibir el equipo</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-gray-700">
                <Shield className="w-5 h-5 text-orange-500 flex-shrink-0" />
                <span>12 meses de garantía oficial</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-gray-700">
                <Package className="w-5 h-5 text-orange-500 flex-shrink-0" />
                <span>Productos 100% originales sellados</span>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs: Especificaciones y Opiniones */}
        <div className="mt-16">
          <div className="border-b border-gray-200 mb-8">
            <div className="flex gap-8">
              <button
                onClick={() => setActiveTab('specs')}
                className={`pb-4 text-sm font-medium transition-colors relative ${
                  activeTab === 'specs'
                    ? 'text-orange-500 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-orange-500'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Especificaciones
              </button>
              <button
                onClick={() => setActiveTab('reviews')}
                className={`pb-4 text-sm font-medium transition-colors relative ${
                  activeTab === 'reviews'
                    ? 'text-orange-500 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-orange-500'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Opiniones {product.reviews && product.reviews.length > 0 && `(${product.reviews.length})`}
              </button>
            </div>
          </div>

          {/* Contenido de Especificaciones */}
          {activeTab === 'specs' && (
            <div className="bg-gray-50 p-8">
              {product.specifications ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Object.entries(product.specifications).map(([key, value]) => (
                    <div key={key} className="flex border-b border-gray-200 py-3">
                      <div className="w-1/2 text-sm font-medium text-gray-700">{key}</div>
                      <div className="w-1/2 text-sm text-gray-600">{value}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-600 text-center py-8">
                  No hay especificaciones disponibles para este producto.
                </p>
              )}
            </div>
          )}

          {/* Contenido de Opiniones */}
          {activeTab === 'reviews' && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
              <ProductReviews productId={product.id} productName={product.name} />
            </div>
          )}
        </div>
      </div>

      {/* Modal de compra impulsiva */}
      {quickBuyOpen && (
        <QuickBuyDialog
          isOpen={quickBuyOpen}
          onClose={() => setQuickBuyOpen(false)}
          product={product}
          initialColor={selectedColor}
          initialStorage={selectedStorage}
        />
      )}
    </div>
  );
}
