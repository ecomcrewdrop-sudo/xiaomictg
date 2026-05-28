import { Link, useLocation } from 'react-router';
import { Settings, ShoppingCart, Bell, MessageCircle, Menu, X, Search } from 'lucide-react';
import xiaomiLogo from '../../assets/logo-whatsapp.jpeg';
import { useState, useEffect } from 'react';
import { CartDialog } from './CartDialog';
import { useProducts } from './ProductContext';
import { NotificationBell } from './NotificationBell';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerClose } from './ui/drawer';
import { Button } from './ui/button';
import { SmartSearch } from './SmartSearch';

const carouselMessages = [
  "🔥 OFERTAS RELÁMPAGO: DISPONIBLES HOY",
  "📱 EQUIPOS 100% ORIGINALES Y SELLADOS",
  "⚠️ ÚLTIMAS UNIDADES EN REFERENCIAS SELECCIONADAS",
  "💳 PAGA EN CASA AL RECIBIR TU EQUIPO",
  "🛡️ 1 AÑO DE GARANTÍA POR DEFECTOS DE FÁBRICA"
];

function TopBarCarousel() {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % carouselMessages.length);
    }, 4000); // Cambia cada 4 segundos
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden min-h-[40px]">
      {/* Elemento invisible para mantener el ancho y alto intrínseco */}
      <div className="invisible whitespace-nowrap pointer-events-none">
        {carouselMessages[0]}
      </div>
      {carouselMessages.map((msg, idx) => (
        <div
          key={idx}
          className={`absolute inset-0 flex items-center justify-center w-full text-center transition-all duration-500 ease-in-out transform ${
            idx === currentIndex
              ? "opacity-100 translate-y-0"
              : idx < currentIndex
              ? "opacity-0 -translate-y-full"
              : "opacity-0 translate-y-full"
          }`}
        >
          {msg}
        </div>
      ))}
    </div>
  );
}

export function Header() {
  const location = useLocation();
  const { cart, unreadOrdersCount } = useProducts();
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  const cartItemCount = cart.reduce((total, item) => total + item.quantity, 0);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);
  
  const navItems = [
    { path: '/', label: 'Inicio' },
    { path: '/moviles', label: 'Teléfonos' },
    { path: '/smartwatch', label: 'Smartwatch' },
    { path: '/audifonos', label: 'Audífonos' },
    { path: '/tablet', label: 'Tablet' },
    { path: '/accesorios', label: 'Estilo de Vida' },
    { path: '/scooter', label: 'Scooter' },
  ];

  return (
    <header className="sticky top-0 z-50">
      {/* Top bar - Dynamic Carousel */}
      <div className={`bg-gradient-to-r from-orange-600 via-red-500 to-orange-600 text-white transition-all duration-300 overflow-hidden ${
        isScrolled ? 'h-0 opacity-0' : 'h-10 opacity-100'
      }`}>
        <div className="container mx-auto h-full relative">
          <div className="flex items-center justify-between h-full px-4 text-xs font-bold w-full">
            <div className="flex-1 hidden md:block"></div>
            <div className="flex-1 md:flex-1 w-full md:w-auto flex justify-center items-center overflow-hidden whitespace-nowrap">
              <TopBarCarousel />
            </div>
            <div className="hidden md:flex flex-1 justify-end">
              <a
                href="https://wa.me/573022875280"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-white/90 hover:text-white transition-colors bg-black/20 px-3 py-1 rounded-full text-[10px] sm:text-xs"
              >
                <MessageCircle className="w-3.5 h-3.5" />
                <span>+57 302 287 5280</span>
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Main navigation - Blanco */}
      <div className="bg-white border-b border-gray-200">
        <div className="container mx-auto">
          <div className="flex items-center justify-between gap-2 md:gap-8 px-2 md:px-4 h-16 md:h-20">
            {/* Mobile Menu Button - Visible on mobile */}
            <button 
              className="md:hidden p-2 text-gray-700 hover:text-orange-500 bg-gray-100 rounded-lg"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Menu className="w-7 h-7" />
            </button>

            {/* Logo - Visible on all screens */}
            <Link to="/" className="flex items-center flex-shrink-0">
              <img src={xiaomiLogo} alt="Xiaomi Logo" className="h-16 w-auto max-w-[200px] object-contain" />
            </Link>

            {/* Navigation - Hidden on mobile, shown on md+ */}
            <nav className="hidden md:flex items-center gap-4 lg:gap-6 flex-1 justify-center">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`text-sm font-bold whitespace-nowrap transition-colors relative py-1 ${
                    location.pathname === item.path
                      ? 'text-black after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-orange-500'
                      : 'text-gray-700 hover:text-black'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            {/* Right side - Cart & Search */}
            <div className="flex items-center flex-shrink-0 gap-1 md:gap-2">
              <button
                onClick={() => setIsSearchOpen(true)}
                className="flex items-center justify-center text-gray-700 hover:text-orange-500 hover:bg-orange-50/50 p-2 rounded-full cursor-pointer transition-all duration-300 group"
                title="Buscar productos"
              >
                <Search className="w-5 h-5 md:w-6 md:h-6 transition-transform group-hover:scale-110" />
              </button>

              {location.pathname === '/panel-gestion-xiaomi' && <NotificationBell />}
              <button
                onClick={() => setIsCartOpen(true)}
                className="relative flex items-center gap-2 text-gray-700 hover:text-orange-500 p-2 rounded-full transition-colors"
              >
                <ShoppingCart className="w-5 h-5 md:w-6 md:h-6" />
                {cartItemCount > 0 && (
                  <span className="absolute top-0 right-0 bg-orange-500 text-white text-[10px] font-black rounded-full w-4.5 h-4.5 flex items-center justify-center animate-in zoom-in">
                    {cartItemCount}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
      
      <CartDialog isOpen={isCartOpen} onClose={() => setIsCartOpen(false)} />
      <SmartSearch isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
      
      {/* Mobile Menu Drawer */}
      <Drawer open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)}>
        <DrawerContent>
          <DrawerHeader className="flex flex-row items-center justify-between border-b">
            <div className="flex items-center">
              <img src={xiaomiLogo} alt="Xiaomi Logo" className="h-12 w-[200px] object-contain" />
            </div>
            <DrawerClose asChild>
              <Button variant="ghost" size="icon">
                <X className="w-5 h-5" />
              </Button>
            </DrawerClose>
          </DrawerHeader>
          <div className="px-4 py-4 overflow-y-auto flex-1 pb-32">
            <nav className="flex flex-col gap-2">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`text-lg font-medium py-3 px-4 rounded-lg ${
                    location.pathname === item.path
                      ? 'bg-orange-100 text-orange-600'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </DrawerContent>
      </Drawer>
    </header>
  );
}
