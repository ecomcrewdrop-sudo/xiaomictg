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
                <span className="text-sm text-gray-500 font-medium mt-2 inline-block">
                  Producto agotado
                </span>
              )}
            </div>

            {/* Urgencia stock bajo */}
            {availableStock > 0 && availableStock < 5 && (
              <div className="mb-4 bg-orange-50 border border-orange-200 rounded-lg px-4 py-3 flex items-center gap-2">
                <Zap className="w-4 h-4 text-orange-500 flex-shrink-0" />
                <span className="text-sm font-semibold text-orange-700">
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

            {/* WhatsApp CTA + Comprar Ahora */}
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
                <a
                  href={`https://wa.me/573022875280?text=Hola%2C%20quiero%20comprar%20el%20${encodeURIComponent(product.name)}%20%E2%80%93%20precio%3A%20%24${currentPrice.toLocaleString('es-CO')}%20COP`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-2 border-2 border-gray-900 text-gray-900 hover:bg-gray-50 py-3 font-semibold transition-colors rounded"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                  Comprar por WhatsApp
                </a>
              </div>
            )}

            {/* Beneficios */}
            <div className="border-t border-gray-200 pt-5 space-y-3">
              <div className="flex items-center gap-3 text-sm text-gray-700">
                <Truck className="w-5 h-5 text-orange-500 flex-shrink-0" />
                <span><strong>Envío a domicilio $10.000</strong> · Todo Cartagena · ~1 hora</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-gray-700">
                <CheckCircle className="w-5 h-5 text-gray-900 flex-shrink-0" />
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
