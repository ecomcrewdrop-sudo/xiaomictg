import { useProducts } from '../ProductContext';
import { ProductCard } from '../ProductCard';
import { FAQ } from '../FAQ';
import { ArrowRight, Smartphone, Watch, Headphones, Cable, Bike, Truck, Lock, CheckCircle, MessageCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { useState, useEffect, useCallback } from 'react';
import pocoLogo from '../../../assets/bdec62b928a5d05f5545dc61d6bdafc532853fc1.png';

export function HomePage() {
  const { products, banners, loading } = useProducts();
  const showProductSkeleton = loading && products.length === 0;
  const [currentBannerIndex, setCurrentBannerIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const totalBanners = banners.length;

  const handlePrevBanner = useCallback(() => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    setTimeout(() => {
      setCurrentBannerIndex((prev) => (prev === 0 ? Math.max(totalBanners - 1, 0) : prev - 1));
      setIsTransitioning(false);
    }, 500);
  }, [isTransitioning, totalBanners]);

  const handleNextBanner = useCallback(() => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    setTimeout(() => {
      setCurrentBannerIndex((prev) => (totalBanners === 0 ? 0 : (prev === totalBanners - 1 ? 0 : prev + 1)));
      setIsTransitioning(false);
    }, 500);
  }, [isTransitioning, totalBanners]);

  // Auto-rotate banners — solo depende de handleNextBanner estabilizado
  useEffect(() => {
    if (totalBanners <= 1) return; // Sin rotación si hay 0 o 1 banner
    const interval = setInterval(() => {
      handleNextBanner();
    }, 5000);
    return () => clearInterval(interval);
  }, [handleNextBanner, totalBanners]);

  // Productos destacados (marcados manualmente desde el admin)
  const manuallyFeatured = products.filter(p => p.isFeatured);
  let featuredProducts = [...manuallyFeatured];

  // Fallback si hay menos de 6 marcados: rellenar con los más caros de cada categoría
  if (featuredProducts.length < 6) {
    const categories = ['moviles', 'smartwatch', 'audifonos', 'scooter', 'poco', 'accesorios'];
    const fallbackProducts = categories
      .map(cat =>
        products
          .filter(p => p.category === cat && !p.isFeatured) // no repetir
          .sort((a, b) => b.price - a.price)[0]
      )
      .filter(Boolean);

    // Rellenar hasta llegar a 6 o hasta que se acaben los de fallback
    for (const fb of fallbackProducts) {
      if (featuredProducts.length >= 6) break;
      if (fb) featuredProducts.push(fb);
    }
  }


  return (
    <div className="bg-white">
      {/* Banner Principal - Hero */}
      <div className="relative overflow-hidden h-[320px] md:h-[600px] flex items-center justify-center group">
        {/* Contenedor de banners con animación */}
        <div 
          className="absolute inset-0 flex transition-transform duration-500 ease-in-out"
          style={{
            transform: `translateX(-${currentBannerIndex * 100}%)`
          }}
        >
          {banners.map((bannerItem, index) => (
            <div
              key={index}
              className="min-w-full h-full flex items-center justify-center"
              style={{
                backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.2), rgba(0, 0, 0, 0.2)), url(${bannerItem.backgroundImage})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center'
              }}
            >
              <div className="container mx-auto px-4 text-center">
                <div className="max-w-3xl mx-auto text-white px-4">
                  <div className="text-[10px] md:text-xs font-medium uppercase tracking-[0.2em] mb-2 md:mb-4 text-white/90">
                    {bannerItem.subtitle}
                  </div>
                  <h1 className="text-2xl md:text-7xl font-light mb-3 md:mb-6 leading-tight tracking-tight">
                    {bannerItem.title}
                  </h1>
                  <p className="text-sm md:text-xl font-light text-white/90 mb-5 md:mb-10 leading-relaxed max-w-2xl mx-auto hidden sm:block">
                    {bannerItem.description}
                  </p>
                  <Link
                    to={bannerItem.buttonLink}
                    className="inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-6 md:px-10 py-3 md:py-4 text-sm font-medium transition-all duration-300 hover:shadow-2xl"
                  >
                    {bannerItem.buttonText}
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
        
        {/* Botón Anterior */}
        <button
          onClick={handlePrevBanner}
          disabled={isTransitioning}
          className="absolute left-4 z-10 bg-black/30 hover:bg-black/50 text-white p-3 transition-all duration-300 opacity-0 group-hover:opacity-100 disabled:opacity-50"
          aria-label="Banner anterior"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        
        {/* Botón Siguiente */}
        <button
          onClick={handleNextBanner}
          disabled={isTransitioning}
          className="absolute right-4 z-10 bg-black/30 hover:bg-black/50 text-white p-3 transition-all duration-300 opacity-0 group-hover:opacity-100 disabled:opacity-50"
          aria-label="Banner siguiente"
        >
          <ChevronRight className="w-6 h-6" />
        </button>
        
        {/* Indicadores */}
        <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-10 flex gap-2">
          {banners.map((_, index) => (
            <button
              key={index}
              onClick={() => {
                if (!isTransitioning) {
                  setIsTransitioning(true);
                  setTimeout(() => {
                    setCurrentBannerIndex(index);
                    setIsTransitioning(false);
                  }, 500);
                }
              }}
              disabled={isTransitioning}
              className={`w-2 h-2 rounded-full transition-all duration-300 disabled:opacity-50 ${
                index === currentBannerIndex 
                  ? 'bg-white w-8' 
                  : 'bg-white/50 hover:bg-white/75'
              }`}
              aria-label={`Ir a banner ${index + 1}`}
            />
          ))}
        </div>
      </div>

      {/* Categorías Destacadas */}
      <div className="py-6 md:py-12 bg-gray-50">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-1">
            {[
              { path: '/moviles', label: 'Teléfonos y Tabletas', icon: Smartphone, isPoco: false },
              { path: '/smartwatch', label: 'Smartwatch', icon: Watch, isPoco: false },
              { path: '/audifonos', label: 'Audífonos', icon: Headphones, isPoco: false },
              { path: '/scooter', label: 'Scooter', icon: Bike, isPoco: false },
              { path: '/accesorios', label: 'Estilo de Vida', icon: Cable, isPoco: false },
            ].map(category => {
              const Icon = category.icon;
              return (
                <Link
                  key={category.path}
                  to={category.path}
                  className="h-32 text-center hover:opacity-80 transition-all duration-300 flex flex-col items-center justify-center bg-white"
                >
                  {category.isPoco ? (
                    <img src={pocoLogo} alt="POCO" className="w-full h-full object-contain p-4" />
                  ) : Icon ? (
                    <>
                      <Icon className="w-10 h-10 mb-3 text-gray-700" />
                      <div className="text-xs font-normal text-gray-700">
                        {category.label}
                      </div>
                    </>
                  ) : null}
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {/* Productos Destacados */}
      <div className="py-10 md:py-20 bg-white">
        <div className="container mx-auto px-4">
          <div className="text-center mb-6 md:mb-16">
            <h2 className="text-xl md:text-4xl font-light text-gray-900 mb-2 md:mb-4">
              Productos Destacados
            </h2>
            <p className="text-gray-500 font-light max-w-2xl mx-auto">
              Explora nuestra selección de productos premium con la última tecnología
            </p>
          </div>
          
          {showProductSkeleton ? (
            <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="animate-pulse bg-gray-100 rounded h-64 md:h-80" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6">
              {featuredProducts.map(product => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )}

          <div className="text-center mt-12">
            <Link 
              to="/moviles" 
              className="inline-flex items-center gap-2 text-orange-500 hover:text-orange-600 font-medium text-sm transition-colors"
            >
              Ver todos los productos
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>

      {/* Banner Secundario */}
      <div className="py-10 md:py-20 bg-gradient-to-br from-gray-900 via-gray-800 to-black text-white">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 text-center">
            <div>
              <div className="text-5xl font-light mb-4 text-orange-500">{products.length}</div>
              <div className="text-sm font-light text-gray-300 uppercase tracking-wider">Productos Disponibles</div>
            </div>
            <div>
              <div className="text-5xl font-light mb-4 text-orange-500">24/7</div>
              <div className="text-sm font-light text-gray-300 uppercase tracking-wider">Soporte Técnico</div>
            </div>
            <div>
              <div className="text-5xl font-light mb-4 text-orange-500">100%</div>
              <div className="text-sm font-light text-gray-300 uppercase tracking-wider">Productos Originales</div>
            </div>
          </div>
        </div>
      </div>

      {/* Sección Info */}
      <div className="py-8 md:py-16 bg-white">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-6 md:gap-8 text-center">
            <div>
              <Truck className="w-10 h-10 md:w-12 md:h-12 mx-auto mb-3 md:mb-4 text-gray-700" />
              <div className="text-xs md:text-sm font-medium text-gray-900 mb-1">Envío a domicilio</div>
              <div className="text-xs text-gray-500 font-light">GRATIS · Todo Cartagena</div>
            </div>
            <div>
              <Lock className="w-10 h-10 md:w-12 md:h-12 mx-auto mb-3 md:mb-4 text-gray-700" />
              <div className="text-xs md:text-sm font-medium text-gray-900 mb-1">Pago Seguro</div>
              <div className="text-xs text-gray-500 font-light">Contra entrega disponible</div>
            </div>
            <div>
              <CheckCircle className="w-10 h-10 md:w-12 md:h-12 mx-auto mb-3 md:mb-4 text-gray-700" />
              <div className="text-xs md:text-sm font-medium text-gray-900 mb-1">Garantía Oficial</div>
              <div className="text-xs text-gray-500 font-light">12 meses · Xiaomi</div>
            </div>
            <div>
              <MessageCircle className="w-10 h-10 md:w-12 md:h-12 mx-auto mb-3 md:mb-4 text-gray-700" />
              <div className="text-xs md:text-sm font-medium text-gray-900 mb-1">Soporte WhatsApp</div>
              <div className="text-xs text-gray-500 font-light">Respuesta inmediata</div>
            </div>
          </div>
        </div>
      </div>

      {/* FAQ */}
      <FAQ />

    </div>
  );
}
