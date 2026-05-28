import { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router';
import { useProducts, Product } from './ProductContext';
import { Search, X, Sparkles, AlertCircle, ShoppingCart, CornerDownLeft } from 'lucide-react';

// Precios en la base de datos ya están en COP — NO multiplicar por exchangeRate
const formatCOP = (price: number) =>
  `$${(price || 0).toLocaleString('es-CO', { minimumFractionDigits: 0 })} COP`;

interface SmartSearchProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ScoredProduct {
  product: Product;
  score: number;
  matchedSpec?: string;
  matchedColor?: string;
}

export function SmartSearch({ isOpen, onClose }: SmartSearchProps) {
  const { products, addToCart } = useProducts();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Auto-focus input when modal opens — delayed on mobile to avoid iOS keyboard jump
  useEffect(() => {
    if (isOpen) {
      const isMobile = window.innerWidth < 768;
      const delay = isMobile ? 350 : 100; // iOS needs extra time after sheet animation
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, delay);

      // iOS Safari: use position sticky hack instead of overflow:hidden to prevent scroll
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'relative';

      return () => clearTimeout(timer);
    } else {
      document.body.style.overflow = '';
      document.body.style.position = '';
      setQuery('');
    }
  }, [isOpen]);

  // Handle ESC and keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Click outside to close
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
      onClose();
    }
  };

  // Safe normalizer to prevent crashes on null/undefined database values
  const normalize = (str: any) => {
    if (str === null || str === undefined) return '';
    const safeStr = typeof str === 'string' ? str : String(str);
    return safeStr
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  };

  // Generate search chips DYNAMICALLY from actual in-stock products
  const dynamicSearches = useMemo(() => {
    if (!products || !Array.isArray(products)) {
      return [
        { label: 'Celulares', term: 'moviles' },
        { label: 'Smartwatch', term: 'smartwatch' },
        { label: 'Audífonos', term: 'audifonos' }
      ];
    }

    const inStockProducts = products.filter(p => p && p.stock > 0);
    if (inStockProducts.length === 0) {
      return [
        { label: 'Celulares', term: 'moviles' },
        { label: 'Smartwatch', term: 'smartwatch' },
        { label: 'Audífonos', term: 'audifonos' }
      ];
    }

    const activeCategories = Array.from(new Set(inStockProducts.map(p => p.category).filter(Boolean)));
    const categoryMapping: { [key: string]: string } = {
      moviles: 'Celulares',
      poco: 'POCO',
      smartwatch: 'Smartwatches',
      audifonos: 'Audífonos',
      scooter: 'Scooters',
      accesorios: 'Accesorios'
    };

    const chips: { label: string; term: string }[] = [];

    // Add up to 3 active categories
    activeCategories.slice(0, 3).forEach(cat => {
      chips.push({
        label: categoryMapping[cat] || cat.charAt(0).toUpperCase() + cat.slice(1),
        term: cat
      });
    });

    // Add names of top in-stock products (first 2 words of the name as a search term)
    inStockProducts.slice(0, 5).forEach(p => {
      if (!p || !p.name) return;
      const words = p.name.split(' ').slice(0, 2).join(' ');
      if (words && !chips.some(c => c.label.toLowerCase() === words.toLowerCase())) {
        chips.push({
          label: words,
          term: words
        });
      }
    });

    return chips.slice(0, 6); // Max 6 quick search chips
  }, [products]);

  // Smart Search logic with comprehensive safety nets
  const searchResults = useMemo(() => {
    if (!query.trim() || !products || !Array.isArray(products)) return [];

    const cleanQuery = normalize(query);
    const queryWords = cleanQuery.split(/\s+/).filter(Boolean);

    const scored: ScoredProduct[] = products.map((product) => {
      let score = 0;
      let matchedSpec = '';
      let matchedColor = '';

      if (!product) return { product, score: 0 };

      const nameNorm = normalize(product.name);
      const catNorm = normalize(product.category);
      const descNorm = normalize(product.description);

      // 1. Exact name match gets absolute priority
      if (nameNorm && nameNorm === cleanQuery) {
        score += 200;
      }
      // 2. Starts with clean query
      else if (nameNorm && nameNorm.startsWith(cleanQuery)) {
        score += 100;
      }
      // 3. Category exact match
      if (catNorm && catNorm === cleanQuery) {
        score += 80;
      }

      // 4. Word-by-word matches
      queryWords.forEach((word) => {
        if (!word) return;

        // Name contains word
        if (nameNorm && nameNorm.includes(word)) {
          score += 40;
        }
        // Category contains word
        if (catNorm && catNorm.includes(word)) {
          score += 20;
        }
        // Description contains word
        if (descNorm && descNorm.includes(word)) {
          score += 8;
        }

        // Color variants match (e.g. "Negro", "Azul")
        if (product.colorVariants && Array.isArray(product.colorVariants)) {
          const colorMatch = product.colorVariants.find((c) =>
            c && c.color && normalize(c.color).includes(word)
          );
          if (colorMatch) {
            score += 30;
            matchedColor = colorMatch.color;
          }
        }

        // Storage variants match (e.g. "128GB", "256GB")
        if (product.storageVariants && Array.isArray(product.storageVariants)) {
          const storageMatch = product.storageVariants.find((s) =>
            s && s.storage && normalize(s.storage).includes(word)
          );
          if (storageMatch) {
            score += 35;
          }
        }

        // Technical Specifications map match
        if (product.specifications && typeof product.specifications === 'object') {
          Object.entries(product.specifications).forEach(([key, val]) => {
            if (!key) return;
            const keyNorm = normalize(key);
            const valNorm = normalize(val);
            if (valNorm.includes(word) || keyNorm.includes(word)) {
              score += 25;
              matchedSpec = `${key}: ${val}`;
            }
          });
        }
      });

      return { product, score, matchedSpec, matchedColor };
    });

    // Filter out items with 0 score and sort descending
    return scored
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8); // Return top 8 matches
  }, [query, products]);

  // Helpers for category colors
  const getCategoryTheme = (category: string) => {
    const cat = category ? category.toLowerCase() : '';
    if (cat.includes('movil') || cat.includes('telefono')) {
      return { bg: 'bg-orange-50 text-orange-600 border-orange-100', name: '📱 Celular' };
    }
    if (cat.includes('poco')) {
      return { bg: 'bg-amber-100 text-amber-800 border-amber-200 font-extrabold', name: '💛 POCO' };
    }
    if (cat.includes('watch') || cat.includes('reloj')) {
      return { bg: 'bg-purple-50 text-purple-600 border-purple-100', name: '⌚ Smartwatch' };
    }
    if (cat.includes('audi') || cat.includes('sonido')) {
      return { bg: 'bg-sky-50 text-sky-600 border-sky-100', name: '🎧 Sonido' };
    }
    if (cat.includes('scooter') || cat.includes('bici')) {
      return { bg: 'bg-emerald-50 text-emerald-600 border-emerald-100', name: '🛴 Scooter' };
    }
    return { bg: 'bg-gray-50 text-gray-600 border-gray-100', name: '📦 Accesorio' };
  };

  const handleQuickAdd = (product: Product, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!product) return;

    // Select default storage or color if available
    const defaultColor = product.colorVariants && product.colorVariants.length > 0
      ? product.colorVariants[0].color
      : undefined;
    const defaultStorage = product.storageVariants && product.storageVariants.length > 0
      ? product.storageVariants[0].storage
      : undefined;

    addToCart(product, 1, defaultColor, defaultStorage);
  };

  // Safe SVG rendering for broken images
  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    e.currentTarget.onerror = null; // Prevent infinite loop
    e.currentTarget.src = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="%23cbd5e1" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-smartphone"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/></svg>`;
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-[100] flex flex-col justify-end md:justify-start md:items-center md:pt-20 md:px-4 animate-in fade-in duration-200"
      style={{ height: '100dvh' }}
      onClick={handleBackdropClick}
    >
      <div
        ref={modalRef}
        className="bg-white w-full md:max-w-3xl shadow-2xl flex flex-col
          rounded-t-3xl md:rounded-3xl
          max-h-[92dvh] md:max-h-[84dvh]
          animate-in slide-in-from-bottom duration-300 md:zoom-in-95 md:slide-in-from-top-4"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {/* Header Search Input */}
        <div className="relative border-b border-slate-100 px-4 py-3 md:p-6 flex items-center gap-3 bg-white"
          style={{ paddingTop: 'max(12px, env(safe-area-inset-top, 12px))' }}
        >
          {/* Mobile drag indicator */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-10 h-1 bg-slate-200 rounded-full md:hidden" />
          <div className="relative flex-1 mt-2 md:mt-0">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              ref={inputRef}
              type="text"
              inputMode="search"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar producto, color, capacidad..."
              className="w-full pl-11 pr-10 bg-slate-50 border border-slate-200 focus:border-orange-500 rounded-2xl text-slate-800 placeholder-slate-400 focus:outline-none transition-all"
              style={{ fontSize: '16px', lineHeight: '1.5', padding: '12px 40px 12px 44px' }}
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-700 bg-slate-200/70 hover:bg-slate-200 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 mt-2 md:mt-0 flex-shrink-0 flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-all active:bg-slate-200"
            aria-label="Cerrar buscador"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Dynamic content scrollable area */}
        <div
          className="flex-1 overflow-y-auto p-4 md:p-6 bg-slate-50/50"
          style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
        >
          {/* EMPTY QUERY STATE */}
          {!query.trim() ? (
            <div className="space-y-6 animate-in fade-in duration-200">
              {/* Popular tags */}
              <div>
                <div className="flex items-center gap-1.5 text-xs font-black uppercase text-slate-400 tracking-wider mb-3">
                  <Sparkles className="w-3.5 h-3.5 text-orange-500" />
                  <span>Búsquedas Populares</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {dynamicSearches.map((s, idx) => (
                    <button
                      key={idx}
                      onClick={() => setQuery(s.term)}
                      className="px-3.5 py-1.5 bg-white border border-slate-200 hover:border-orange-400 hover:bg-orange-50 text-slate-600 hover:text-orange-600 text-xs font-semibold rounded-full cursor-pointer transition-all hover:scale-[1.02] shadow-xs active:scale-[0.98]"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* ACTIVE RESULTS STATE */
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="flex items-center justify-between text-xs text-slate-400 font-bold uppercase tracking-wider px-1">
                <span>Resultados de la Búsqueda ({searchResults.length})</span>
                <span className="font-mono text-[10px] hidden sm:block">Filtro inteligente activado</span>
              </div>

              {searchResults.length > 0 ? (
                <div className="space-y-3">
                  {searchResults.map(({ product, matchedSpec, matchedColor }) => {
                    if (!product) return null;
                    const theme = getCategoryTheme(product.category);
                    const isOutOfStock = product.stock <= 0;
                    const isLowStock = product.stock > 0 && product.stock <= 3;

                    return (
                      <Link
                        key={product.id}
                        to={`/product/${product.id}`}
                        onClick={onClose}
                        className="group flex flex-col sm:flex-row sm:items-center justify-between p-3.5 bg-white border border-slate-100 hover:border-orange-100 rounded-2xl hover:shadow-md transition-all duration-300 gap-4"
                      >
                        {/* Image & Title Info */}
                        <div className="flex items-center gap-4 flex-1">
                          <div className="w-16 h-16 bg-slate-50 border border-slate-100 rounded-xl overflow-hidden flex items-center justify-center flex-shrink-0">
                            <img
                              src={product.image || ''}
                              alt={product.name || 'Xiaomi'}
                              onError={handleImageError}
                              className="max-h-[85%] max-w-[85%] object-contain group-hover:scale-105 transition-transform duration-300"
                            />
                          </div>
                          <div>
                            <div className="flex items-center flex-wrap gap-1.5 mb-1">
                              <span className={`text-[9px] font-black px-2 py-0.5 rounded-full border ${theme.bg}`}>
                                {theme.name}
                              </span>
                              {isOutOfStock ? (
                                <span className="bg-red-50 text-red-600 border border-red-100 text-[9px] font-bold px-2 py-0.5 rounded-full">
                                  Agotado
                                </span>
                              ) : isLowStock ? (
                                <span className="bg-amber-50 text-amber-600 border border-amber-100 text-[9px] font-bold px-2 py-0.5 rounded-full">
                                  🔥 ¡Solo {product.stock} disponibles!
                                </span>
                              ) : (
                                <span className="bg-emerald-50 text-emerald-600 border border-emerald-100 text-[9px] font-bold px-2 py-0.5 rounded-full">
                                  ✓ En Stock
                                </span>
                              )}
                            </div>
                            <h3 className="text-sm font-black text-slate-800 group-hover:text-orange-500 transition-colors line-clamp-1">
                              {product.name}
                            </h3>
                            
                            {/* Smart matches descriptions */}
                            {matchedColor && (
                              <p className="text-[11px] text-slate-500 mt-0.5">
                                Variante coincidente: <span className="text-slate-800 font-bold bg-slate-100 px-1 py-0.5 rounded">{matchedColor}</span>
                              </p>
                            )}
                            {matchedSpec && !matchedColor && (
                              <p className="text-[11px] text-slate-500 mt-0.5 truncate max-w-[300px]">
                                Coincidencia en especificaciones: <span className="text-slate-800 font-medium italic">{matchedSpec}</span>
                              </p>
                            )}
                            {!matchedColor && !matchedSpec && product.description && (
                              <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5 max-w-[340px]">
                                {product.description}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Price & CTA Action */}
                        <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center border-t sm:border-t-0 pt-2.5 sm:pt-0 border-slate-100">
                          <div className="sm:text-right">
                            <div className="text-sm font-black text-slate-900 leading-tight">
                              {formatCOP(product.price)}
                            </div>
                          </div>
                          
                          {/* Fast Action */}
                          {!isOutOfStock ? (
                            <button
                              onClick={(e) => handleQuickAdd(product, e)}
                              className="mt-2 text-xs font-bold text-orange-600 hover:text-white bg-orange-50 hover:bg-orange-500 border border-orange-100 hover:border-orange-500 px-3.5 py-1.5 rounded-xl cursor-pointer flex items-center gap-1.5 transition-all shadow-xs"
                            >
                              <ShoppingCart className="w-3.5 h-3.5" />
                              <span>Añadir</span>
                            </button>
                          ) : (
                            <div className="mt-2 text-[10px] font-bold text-slate-400 uppercase tracking-wide bg-slate-100 px-3 py-1.5 rounded-xl">
                              Sin Stock
                            </div>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                /* NO MATCHES STATE */
                <div className="py-10 text-center animate-in fade-in duration-200">
                  <div className="inline-flex items-center justify-center w-14 h-14 bg-red-50 text-red-500 border border-red-100 rounded-full mb-4">
                    <AlertCircle className="w-7 h-7" />
                  </div>
                  <h3 className="text-base font-bold text-slate-800 mb-1">
                    No se encontraron resultados
                  </h3>
                  <p className="text-sm text-slate-500 max-w-sm mx-auto mb-6">
                    No encontramos ningún producto que coincida con "<span className="font-bold text-slate-800">{query}</span>". Intenta buscar con otros términos.
                  </p>

                  {/* Suggest alternatives */}
                  <div className="border-t border-slate-150 pt-8 max-w-md mx-auto">
                    <div className="text-xs font-black uppercase text-slate-400 tracking-wider mb-4">
                      💡 Te sugerimos buscar:
                    </div>
                    <div className="flex flex-wrap justify-center gap-2">
                      {dynamicSearches.map((s, i) => (
                        <button
                          key={i}
                          onClick={() => setQuery(s.term)}
                          className="px-3.5 py-1.5 bg-white border border-slate-200 hover:border-orange-400 hover:bg-orange-50 text-slate-600 text-orange-600 text-xs font-semibold rounded-full cursor-pointer transition-all hover:scale-105 shadow-xs"
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer — hidden on mobile to save space */}
        <div className="hidden md:flex bg-slate-50 border-t border-slate-100 py-3 px-6 items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-1">
            <span className="font-bold text-slate-500 bg-white border border-slate-200 px-1.5 py-0.5 rounded shadow-xs font-mono">Esc</span>
            <span>para cerrar</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-0.5">
              <span className="font-bold text-slate-500 bg-white border border-slate-200 px-1.5 py-0.5 rounded shadow-xs font-mono">Enter</span>
              <CornerDownLeft className="w-3 h-3 text-slate-400" />
            </div>
            <span>para ver detalles del producto</span>
          </div>
        </div>
      </div>
    </div>
  );
}
