import { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router';
import { useProducts, Product } from './ProductContext';
import { Search, X, Sparkles, AlertCircle, ShoppingCart, ArrowRight, CornerDownLeft } from 'lucide-react';

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
  const { products, ticketConfig, addToCart } = useProducts();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const exchangeRate = ticketConfig.exchangeRate || 4200;

  // Generate search chips DYNAMICALLY from actual in-stock products
  const dynamicSearches = useMemo(() => {
    const inStockProducts = products.filter(p => p.stock > 0);
    if (inStockProducts.length === 0) {
      return [
        { label: 'Celulares', term: 'moviles' },
        { label: 'Smartwatch', term: 'smartwatch' },
        { label: 'Audífonos', term: 'audifonos' }
      ];
    }

    const activeCategories = Array.from(new Set(inStockProducts.map(p => p.category)));
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

  // Auto-focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
      document.body.style.overflow = 'hidden'; // Lock background scroll
    } else {
      document.body.style.overflow = '';
      setQuery('');
    }
    return () => {
      document.body.style.overflow = '';
    };
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

  // Smart Search logic
  const searchResults = useMemo(() => {
    if (!query.trim()) return [];

    // Normalize helper: lowercase, remove accents
    const normalize = (str: string) =>
      str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();

    const cleanQuery = normalize(query);
    const queryWords = cleanQuery.split(/\s+/).filter(Boolean);

    const scored: ScoredProduct[] = products.map((product) => {
      let score = 0;
      let matchedSpec = '';
      let matchedColor = '';

      const nameNorm = normalize(product.name);
      const catNorm = normalize(product.category);
      const descNorm = normalize(product.description || '');

      // 1. Exact name match gets absolute priority
      if (nameNorm === cleanQuery) {
        score += 200;
      }
      // 2. Starts with clean query
      else if (nameNorm.startsWith(cleanQuery)) {
        score += 100;
      }
      // 3. Category exact match
      if (catNorm === cleanQuery) {
        score += 80;
      }

      // 4. Word-by-word matches
      queryWords.forEach((word) => {
        // Name contains word
        if (nameNorm.includes(word)) {
          score += 40;
        }
        // Category contains word
        if (catNorm.includes(word)) {
          score += 20;
        }
        // Description contains word
        if (descNorm.includes(word)) {
          score += 8;
        }

        // Color variants match (e.g. "Negro", "Azul")
        if (product.colorVariants) {
          const colorMatch = product.colorVariants.find((c) =>
            normalize(c.color).includes(word)
          );
          if (colorMatch) {
            score += 30;
            matchedColor = colorMatch.color;
          }
        }

        // Storage variants match (e.g. "128GB", "256GB")
        if (product.storageVariants) {
          const storageMatch = product.storageVariants.find((s) =>
            normalize(s.storage).includes(word)
          );
          if (storageMatch) {
            score += 35;
          }
        }

        // Technical Specifications map match
        if (product.specifications) {
          Object.entries(product.specifications).forEach(([key, val]) => {
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

  // Curated recommended products (shown when query is empty, in stock only)
  const recommendedProducts = useMemo(() => {
    // Show top 3 in-stock premium products
    return products
      .filter((p) => p.stock > 0)
      .sort((a, b) => b.price - a.price)
      .slice(0, 3);
  }, [products]);

  // Helpers for category colors
  const getCategoryTheme = (category: string) => {
    const cat = category.toLowerCase();
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

    // Select default storage or color if available
    const defaultColor = product.colorVariants && product.colorVariants.length > 0
      ? product.colorVariants[0].color
      : undefined;
    const defaultStorage = product.storageVariants && product.storageVariants.length > 0
      ? product.storageVariants[0].storage
      : undefined;

    addToCart(product, 1, defaultColor, defaultStorage);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-[100] flex justify-center items-start pt-12 md:pt-24 px-4 overflow-hidden animate-in fade-in duration-200"
      onClick={handleBackdropClick}
    >
      <div
        ref={modalRef}
        className="bg-white/95 border border-slate-100 rounded-3xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[82vh] animate-in zoom-in-95 slide-in-from-top-6 duration-300"
      >
        {/* Header Search Input */}
        <div className="relative border-b border-slate-100 p-4 md:p-6 flex items-center gap-4 bg-white">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5.5 h-5.5 text-slate-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="¿Qué estás buscando hoy? (ej. Celulares, Smartwatch, Audífonos...)"
              className="w-full pl-12 pr-10 py-3.5 bg-slate-50 border border-slate-200 focus:border-orange-500 rounded-2xl text-base text-slate-800 placeholder-slate-400 focus:outline-none transition-all"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 rounded-full text-slate-400 hover:text-slate-700 bg-slate-200/50 hover:bg-slate-200 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all border border-transparent hover:border-slate-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Dynamic content scrollable area */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 scrollbar-thin bg-slate-50/50">
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

              {/* Recommended Catalog */}
              <div className="pt-2">
                <div className="text-xs font-black uppercase text-slate-400 tracking-wider mb-4">
                  🔥 Recomendados para ti
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {recommendedProducts.map((p) => {
                    const theme = getCategoryTheme(p.category);
                    return (
                      <Link
                        key={p.id}
                        to={`/producto/${p.id}`}
                        onClick={onClose}
                        className="group bg-white rounded-2xl border border-slate-100 hover:border-orange-200 p-4 transition-all duration-300 flex flex-col hover:shadow-lg hover:-translate-y-1"
                      >
                        <div className="aspect-square bg-slate-50 rounded-xl overflow-hidden mb-3 relative flex items-center justify-center">
                          <img
                            src={p.image}
                            alt={p.name}
                            className="max-h-[85%] max-w-[85%] object-contain group-hover:scale-105 transition-transform duration-300"
                          />
                          <span className={`absolute top-2 left-2 text-[9px] font-black px-2 py-0.5 rounded-full border ${theme.bg}`}>
                            {theme.name}
                          </span>
                        </div>
                        <h4 className="text-sm font-bold text-slate-800 line-clamp-1 group-hover:text-orange-600 transition-colors">
                          {p.name}
                        </h4>
                        <div className="mt-2 flex items-center justify-between">
                          <div className="text-xs font-black text-slate-900">
                            ${(p.price * exchangeRate).toLocaleString('es-CO', { minimumFractionDigits: 0 })} COP
                          </div>
                          <span className="text-[10px] text-slate-400">${p.price} USD</span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            /* ACTIVE RESULTS STATE */
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="flex items-center justify-between text-xs text-slate-400 font-bold uppercase tracking-wider px-1">
                <span>Resultados de la búsqueda ({searchResults.length})</span>
                <span className="font-mono text-[10px] hidden sm:block">Filtro inteligente activado</span>
              </div>

              {searchResults.length > 0 ? (
                <div className="space-y-3">
                  {searchResults.map(({ product, matchedSpec, matchedColor }) => {
                    const theme = getCategoryTheme(product.category);
                    const isOutOfStock = product.stock <= 0;
                    const isLowStock = product.stock > 0 && product.stock <= 3;
                    const priceCOP = product.price * exchangeRate;

                    return (
                      <Link
                        key={product.id}
                        to={`/producto/${product.id}`}
                        onClick={onClose}
                        className="group flex flex-col sm:flex-row sm:items-center justify-between p-3.5 bg-white border border-slate-100 hover:border-orange-100 rounded-2xl hover:shadow-md transition-all duration-300 gap-4"
                      >
                        {/* Image & Title Info */}
                        <div className="flex items-center gap-4 flex-1">
                          <div className="w-16 h-16 bg-slate-50 border border-slate-100 rounded-xl overflow-hidden flex items-center justify-center flex-shrink-0">
                            <img
                              src={product.image}
                              alt={product.name}
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
                              ${priceCOP.toLocaleString('es-CO', { minimumFractionDigits: 0 })} COP
                            </div>
                            <div className="text-[10px] text-slate-400">${product.price} USD</div>
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

        {/* Modal Footer (with shortcut indications) */}
        <div className="bg-slate-50 border-t border-slate-100 py-3 px-6 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-1">
            <span className="font-bold text-slate-500 bg-white border border-slate-200 px-1.5 py-0.5 rounded shadow-xs font-mono">Esc</span>
            <span>para cerrar</span>
          </div>
          <div className="hidden sm:flex items-center gap-1.5">
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
