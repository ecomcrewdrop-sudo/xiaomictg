import { useState, useEffect } from 'react';
import { useProducts } from './ProductContext';
import { CheckCircle2, X } from 'lucide-react';
import { Link, useLocation } from 'react-router';

const CITIES = ['Bocagrande', 'Manga', 'Crespo', 'Pie de la Popa', 'Centro Amurallado', 'Castillogrande', 'Los Alpes', 'Turbaco', 'El Recreo', 'Zaragocilla'];
const NAMES = ['Carlos', 'María', 'José', 'Ana', 'Luis', 'Laura', 'Pedro', 'Marta', 'Andrés', 'Daniela', 'Jorge', 'Camila', 'Santiago', 'Valentina'];

export function SocialProof() {
  const { products } = useProducts();
  const [notification, setNotification] = useState<any>(null);
  const [isVisible, setIsVisible] = useState(false);
  const location = useLocation();

  // Ocultar notificaciones de compras (SocialProof) en la página de checkout
  if (location.pathname.startsWith('/checkout') || location.pathname.startsWith('/admin')) {
    return null;
  }

  useEffect(() => {
    // Only run if we have products
    if (!products || products.length === 0) return;

    // Calcular stock REAL para cada producto (considerando todas las variantes)
    const getRealStock = (p: any): number => {
      // Si tiene variantes de almacenamiento, el stock real es la suma de esas variantes
      if (p.storageVariants && p.storageVariants.length > 0) {
        return p.storageVariants.reduce((sum: number, v: any) => sum + (v.stock ?? 0), 0);
      }
      // Si tiene variantes de color, el stock real es la suma de esas variantes
      if (p.colorVariants && p.colorVariants.length > 0) {
        return p.colorVariants.reduce((sum: number, v: any) => sum + (v.stock ?? 0), 0);
      }
      // Si no tiene variantes, usar el stock base
      return p.stock ?? 0;
    };

    // Filtrar: solo productos con stock real > 0, con nombre válido, con ID y con imagen
    const availableProducts = products.filter(p =>
      getRealStock(p) > 0 &&
      p.name &&
      p.name.trim() !== '' &&
      (p.id || p._id) &&
      p.image &&
      p.image.trim() !== ''
    );

    if (availableProducts.length === 0) return;

    const generateNotification = () => {
      const randomProduct = availableProducts[Math.floor(Math.random() * availableProducts.length)];
      const randomCity = CITIES[Math.floor(Math.random() * CITIES.length)];
      const randomName = NAMES[Math.floor(Math.random() * NAMES.length)];
      const timeAgo = Math.floor(Math.random() * 45) + 2; // 2 to 47 mins ago

      setNotification({
        name: randomName,
        city: randomCity,
        time: timeAgo,
        product: randomProduct
      });
      setIsVisible(true);

      // Hide after 6 seconds
      setTimeout(() => {
        setIsVisible(false);
      }, 6000);
    };

    // Initial delay before first popup
    const initialTimer = setTimeout(generateNotification, 4000);

    // Then random interval between 12s and 25s
    let timer: any;
    const intervalFunction = () => {
      generateNotification();
      timer = setTimeout(intervalFunction, Math.random() * 13000 + 12000);
    };
    
    timer = setTimeout(intervalFunction, 15000);

    return () => {
      clearTimeout(initialTimer);
      clearTimeout(timer);
    };
  }, [products]);

  if (!notification) return null;

  return (
    <div className={`fixed bottom-4 left-4 sm:bottom-6 sm:left-6 z-[40] transition-all duration-[800ms] ease-[cubic-bezier(0.16,1,0.3,1)] w-[300px] max-w-[calc(100vw-2rem)] ${isVisible ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0 pointer-events-none'}`}>
      <div className="bg-white rounded-xl shadow-[0_10px_30px_rgba(0,0,0,0.1)] border border-gray-100 p-3 flex items-start gap-3 relative overflow-hidden group">
        <div className="absolute top-0 left-0 w-1 h-full bg-green-500"></div>
        <button onClick={() => setIsVisible(false)} className="absolute top-2 right-2 text-gray-300 hover:text-gray-600 bg-white rounded-full p-0.5 transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
        
        <div className="w-12 h-12 bg-gray-50 rounded-lg shrink-0 border border-gray-100 overflow-hidden flex items-center justify-center p-1">
          <img src={notification.product.image} alt={notification.product.name} className="max-w-full max-h-full object-contain mix-blend-multiply" />
        </div>
        
        <div className="flex-1 min-w-0 pr-4">
          <p className="text-[12px] text-gray-600 mb-0.5 leading-tight">
            <span className="font-bold text-gray-900">{notification.name}</span> de {notification.city} compró:
          </p>
          <Link to={`/product/${notification.product.id}`} className="text-[13px] font-bold text-orange-600 hover:underline truncate block">
            {notification.product.name}
          </Link>
          <div className="flex items-center gap-1 mt-1.5">
            <CheckCircle2 className="w-3 h-3 text-green-500" />
            <span className="text-[10px] text-gray-500 font-medium tracking-wide">Hace {notification.time} min • Compra Verificada</span>
          </div>
        </div>
      </div>
    </div>
  );
}
