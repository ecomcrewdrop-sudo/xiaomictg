import { useState, useMemo, useEffect } from 'react';
import { useProducts, Product } from '../ProductContext';
import { Button } from '../ui/button';
import { Link2, Copy, Check, ChevronRight, Search, Zap, Smartphone, Sparkles, AlertCircle, Package, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';

export function AdminLinkGenerator() {
  const { products } = useProducts();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  
  const [selectedStorage, setSelectedStorage] = useState<string>('');
  const [selectedColor, setSelectedColor] = useState<string>('');
  const [isCopied, setIsCopied] = useState(false);

  // Filtrar productos
  const filteredProducts = useMemo(() => {
    return products.filter(p => 
      p.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [products, searchTerm]);

  const selectedProduct = useMemo(() => {
    return products.find(p => p.id === selectedProductId) || null;
  }, [products, selectedProductId]);

  // Si cambia el producto, auto-seleccionar la primera variante DISPONIBLE si existe
  useEffect(() => {
    if (selectedProduct) {
      if (selectedProduct.storageVariants && selectedProduct.storageVariants.length > 0) {
        const availableStorage = selectedProduct.storageVariants.find(s => s.stock > 0);
        setSelectedStorage(availableStorage ? availableStorage.storage : selectedProduct.storageVariants[0].storage);
      } else {
        setSelectedStorage('');
      }
      
      if (selectedProduct.colorVariants && selectedProduct.colorVariants.length > 0) {
        const availableColor = selectedProduct.colorVariants.find(c => c.stock > 0);
        setSelectedColor(availableColor ? availableColor.color : selectedProduct.colorVariants[0].color);
      } else {
        setSelectedColor('');
      }
    } else {
      setSelectedStorage('');
      setSelectedColor('');
    }
  }, [selectedProduct]);

  // Calcular stock seleccionado
  const currentStock = useMemo(() => {
    if (!selectedProduct) return 0;
    
    let colorStock = Infinity;
    let storageStock = Infinity;

    if (selectedProduct.colorVariants && selectedProduct.colorVariants.length > 0 && selectedColor) {
      const cv = selectedProduct.colorVariants.find(c => c.color === selectedColor);
      if (cv) colorStock = cv.stock;
    }
    
    if (selectedProduct.storageVariants && selectedProduct.storageVariants.length > 0 && selectedStorage) {
      const sv = selectedProduct.storageVariants.find(s => s.storage === selectedStorage);
      if (sv) storageStock = sv.stock;
    }

    if (colorStock === Infinity && storageStock === Infinity) {
      return selectedProduct.stock; // Stock general si no hay variantes seleccionadas pero las requiere? (usamos el default)
    }
    
    return Math.min(colorStock, storageStock);
  }, [selectedProduct, selectedColor, selectedStorage]);

  const isLinkReady = selectedProduct && currentStock > 0;

  const generatedUrl = useMemo(() => {
    if (!isLinkReady) return '';
    const baseUrl = `${window.location.origin}/comprar`;
    const params = new URLSearchParams();
    params.append('p', selectedProduct.id);
    if (selectedStorage) params.append('s', selectedStorage);
    if (selectedColor) params.append('c', selectedColor);
    return `${baseUrl}?${params.toString()}`;
  }, [isLinkReady, selectedProduct, selectedStorage, selectedColor]);

  const copyToClipboard = async () => {
    if (!generatedUrl) return;
    try {
      await navigator.clipboard.writeText(generatedUrl);
      setIsCopied(true);
      toast.success('¡Enlace VIP copiado al portapapeles!', {
        icon: '🔗',
        duration: 3000,
        style: {
          background: '#0ea5e9',
          color: 'white',
          border: 'none',
          borderRadius: '1.25rem',
          padding: '1rem 1.5rem',
          boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)'
        }
      });
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      toast.error('Error al copiar el enlace');
    }
  };

  return (
    <div className="w-full bg-slate-50/50 min-h-full pb-24 px-4 sm:px-6 md:px-8">
      <div className="max-w-6xl mx-auto space-y-8 pt-4">
        
        {/* Header Hero */}
        <div className="bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 rounded-[2.5rem] p-8 md:p-12 shadow-[0_20px_50px_rgba(15,23,42,0.15)] relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-8 border border-white/5">
          {/* Decorative Glow Elements */}
          <div className="absolute top-0 right-0 w-96 h-96 bg-sky-500 rounded-full mix-blend-multiply filter blur-[128px] opacity-25 animate-pulse"></div>
          <div className="absolute bottom-0 left-0 w-72 h-72 bg-orange-500 rounded-full mix-blend-multiply filter blur-[128px] opacity-15"></div>
          
          <div className="relative z-10 space-y-4 text-center md:text-left">
            <div className="inline-flex items-center gap-2 px-4.5 py-1.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20 text-xs font-black uppercase tracking-wider backdrop-blur-md">
              <Zap className="w-3.5 h-3.5" fill="currentColor" />
              VENTAS DIRECTAS VIP
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-black text-white tracking-tight leading-tight">
              Generador de <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-sky-600">Enlaces VIP</span>
            </h1>
            <p className="text-slate-400 text-base md:text-lg max-w-xl font-medium leading-relaxed">
              Crea links de pago directos para tus clientes. Cierra ventas por WhatsApp en segundos con una experiencia de compra premium, rápida y sin distracciones.
            </p>
          </div>
          
          <div className="relative z-10 hidden md:flex items-center justify-center p-8 bg-white/5 rounded-[2rem] backdrop-blur-xl border border-white/10 shadow-2xl">
            <Smartphone className="w-24 h-24 text-sky-400 opacity-80" strokeWidth={1.5} />
            <Link2 className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-10 h-10 text-white animate-bounce" />
          </div>
        </div>

        {/* Main Content Workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Left Column: Product Search (Responsive Mobile Toggled) */}
          <div className={`lg:col-span-5 flex flex-col h-[700px] transition-all duration-300 ${selectedProductId ? 'hidden lg:flex' : 'flex'}`}>
            <div className="bg-white rounded-[2rem] shadow-[0_15px_35px_rgba(0,0,0,0.03)] border border-slate-100 flex flex-col h-full overflow-hidden">
              
              <div className="p-6 md:p-8 pb-5 border-b border-slate-50 bg-white/85 backdrop-blur-xl z-10">
                <h2 className="text-lg font-black flex items-center gap-3 text-slate-800 mb-5 tracking-tight">
                  <div className="w-7.5 h-7.5 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center text-xs font-black">1</div>
                  SELECCIONA EQUIPO
                </h2>
                
                <div className="relative group">
                  <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-400 group-focus-within:text-sky-500 w-5 h-5 transition-colors" />
                  <input
                    type="text"
                    placeholder="Escribe el nombre del teléfono..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-12 pr-4 py-3.5 bg-slate-50 hover:bg-slate-100/70 border border-slate-100 rounded-2xl text-base focus:outline-none focus:border-sky-500 focus:bg-white focus:ring-4 focus:ring-sky-500/10 transition-all font-medium placeholder:text-slate-400 shadow-inner"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-2.5 bg-slate-50/30">
                {filteredProducts.map(product => {
                  const isSelected = product.id === selectedProductId;
                  const isOutOfStock = product.stock === 0;

                  return (
                    <button
                      key={product.id}
                      onClick={() => !isOutOfStock && setSelectedProductId(product.id)}
                      disabled={isOutOfStock}
                      className={`w-full text-left p-4 rounded-2xl transition-all duration-300 flex items-center gap-4 border cursor-pointer ${
                        isSelected 
                          ? 'bg-sky-50/50 border-sky-500 shadow-md ring-4 ring-sky-500/5' 
                          : isOutOfStock
                            ? 'bg-white border-slate-100 opacity-40 cursor-not-allowed'
                            : 'bg-white border-slate-100 hover:border-sky-200 hover:shadow-sm'
                      }`}
                    >
                      <div className="relative w-16 h-16 rounded-xl overflow-hidden bg-slate-50 shrink-0 shadow-inner border border-slate-100 flex items-center justify-center">
                        <img src={product.image} alt={product.name} className="w-full h-full object-contain p-1" />
                        {isOutOfStock && (
                          <div className="absolute inset-0 bg-slate-900/60 flex items-center justify-center backdrop-blur-[1px]">
                            <span className="text-[10px] font-black text-white uppercase text-center leading-tight tracking-wider">Agotado</span>
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className={`font-black truncate text-sm md:text-base ${isSelected ? 'text-sky-950' : 'text-slate-900'}`}>
                          {product.name}
                        </h3>
                        <p className={`font-black text-sm mt-0.5 ${isSelected ? 'text-sky-600' : 'text-slate-600'}`}>
                          ${Math.round(product.price).toLocaleString('es-CO')} COP
                        </p>
                        <div className="flex items-center gap-1 mt-1.5 text-xs font-semibold text-slate-400">
                          <Package className="w-3.5 h-3.5 text-slate-400" />
                          <span>Stock: {product.stock} u.</span>
                        </div>
                      </div>
                      <ChevronRight className={`w-5 h-5 transition-transform shrink-0 ${isSelected ? 'text-sky-500 translate-x-1' : 'text-slate-300'}`} />
                    </button>
                  );
                })}
                {filteredProducts.length === 0 && (
                  <div className="text-center py-16 px-4">
                    <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-100">
                      <Search className="w-7 h-7 text-slate-300" />
                    </div>
                    <p className="text-slate-500 font-bold text-sm">No encontramos productos con ese nombre.</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Configuration and Generation (Responsive Mobile Toggled) */}
          <div className={`lg:col-span-7 flex flex-col transition-all duration-300 ${!selectedProductId ? 'hidden lg:flex' : 'flex'}`}>
            <div className="bg-white rounded-[2rem] shadow-[0_15px_35px_rgba(0,0,0,0.03)] border border-slate-100 p-6 md:p-8 h-full relative overflow-hidden flex flex-col justify-between">
              
              <div>
                {/* Mobile Back Button */}
                {selectedProduct && (
                  <button
                    onClick={() => setSelectedProductId(null)}
                    className="lg:hidden mb-6 inline-flex items-center gap-2 text-slate-500 hover:text-slate-800 font-black text-xs bg-slate-100 hover:bg-slate-200 px-4 py-2.5 rounded-full transition-all cursor-pointer shadow-sm border border-slate-200/40"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    VOLVER A BUSCAR EQUIPOS
                  </button>
                )}

                <h2 className="text-lg font-black flex items-center gap-3 text-slate-800 mb-8 relative z-10 tracking-tight">
                  <div className="w-7.5 h-7.5 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center text-xs font-black">2</div>
                  CONFIGURAR ENLACE VIP
                </h2>

                {!selectedProduct ? (
                  <div className="h-[480px] flex flex-col items-center justify-center text-center px-4 relative z-10">
                    <div className="w-24 h-24 bg-sky-50 rounded-full flex items-center justify-center mb-6 shadow-inner border border-sky-100/50">
                      <Sparkles className="w-10 h-10 text-sky-400 animate-pulse" />
                    </div>
                    <h3 className="text-xl font-black text-slate-800 mb-2">Selecciona un equipo</h3>
                    <p className="text-slate-500 max-w-sm text-sm md:text-base leading-relaxed">
                      Elige un producto de la lista izquierda para configurar las opciones de color, almacenamiento y generar su link de pago directo en segundos.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-8 relative z-10 animate-in fade-in slide-in-from-bottom-3 duration-300">
                    
                    {/* Selected Product Preview */}
                    <div className="bg-slate-50 p-5 rounded-2xl flex items-center gap-5 border border-slate-100 shadow-inner">
                      <div className="w-20 h-20 bg-white rounded-xl overflow-hidden shadow-sm border border-slate-100 p-1 flex items-center justify-center shrink-0">
                        <img src={selectedProduct.image} alt={selectedProduct.name} className="w-full h-full object-contain" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-base md:text-lg font-black text-slate-900 truncate leading-snug">{selectedProduct.name}</h3>
                        <span className="inline-block bg-sky-100/60 text-sky-700 px-3 py-0.5 mt-1.5 rounded-full text-xs font-bold border border-sky-200/30">
                          {selectedProduct.category}
                        </span>
                      </div>
                    </div>

                    {/* Storage Variants */}
                    {selectedProduct.storageVariants && selectedProduct.storageVariants.length > 0 && (
                      <div className="space-y-3.5">
                        <label className="text-xs font-black text-slate-400 tracking-wider uppercase block">Capacidad disponible en inventario</label>
                        <div className="flex flex-wrap gap-2.5">
                          {selectedProduct.storageVariants.map(variant => {
                            const isSelected = selectedStorage === variant.storage;
                            const isOutOfStock = variant.stock === 0;
                            
                            return (
                              <button
                                key={variant.storage}
                                onClick={() => !isOutOfStock && setSelectedStorage(variant.storage)}
                                disabled={isOutOfStock}
                                className={`px-4.5 py-3 rounded-2xl border-2 font-black transition-all relative overflow-hidden text-sm flex flex-col items-center justify-center min-w-[90px] cursor-pointer ${
                                  isSelected
                                    ? 'border-sky-500 bg-sky-50/50 text-sky-700 shadow-sm scale-[1.03] ring-4 ring-sky-500/5'
                                    : isOutOfStock
                                      ? 'border-slate-100 bg-slate-50/30 text-slate-300 opacity-40 cursor-not-allowed line-through'
                                      : 'border-slate-200 hover:border-sky-300 text-slate-600 bg-white hover:shadow-xs'
                                }`}
                              >
                                <span>{variant.storage}</span>
                                <span className={`text-[9px] mt-0.5 uppercase tracking-wide font-black ${
                                  isSelected ? 'text-sky-500' : isOutOfStock ? 'text-rose-500' : variant.stock <= 3 ? 'text-amber-500' : 'text-slate-400'
                                }`}>
                                  {isOutOfStock ? 'Agotado' : variant.stock <= 3 ? `¡Últimas ${variant.stock}!` : `${variant.stock} disp.`}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Color Variants */}
                    {selectedProduct.colorVariants && selectedProduct.colorVariants.length > 0 && (
                      <div className="space-y-3.5">
                        <label className="text-xs font-black text-slate-400 tracking-wider uppercase block">Color disponible en inventario</label>
                        <div className="flex flex-wrap gap-3">
                          {selectedProduct.colorVariants.map(variant => {
                            const isSelected = selectedColor === variant.color;
                            const isOutOfStock = variant.stock === 0;

                            return (
                              <button
                                key={variant.color}
                                onClick={() => !isOutOfStock && setSelectedColor(variant.color)}
                                disabled={isOutOfStock}
                                className={`group flex items-center gap-3 px-4 py-2.5 rounded-2xl border-2 font-bold transition-all text-xs md:text-sm cursor-pointer ${
                                  isSelected
                                    ? 'border-sky-500 bg-white shadow-sm scale-[1.03] ring-4 ring-sky-500/5'
                                    : isOutOfStock
                                      ? 'border-slate-100 bg-slate-50/30 text-slate-300 opacity-40 cursor-not-allowed'
                                      : 'border-slate-200 hover:border-slate-300 bg-white hover:shadow-xs text-slate-700'
                                }`}
                              >
                                <div 
                                  className="w-5 h-5 rounded-full border border-slate-200 shadow-inner flex items-center justify-center shrink-0"
                                  style={{ backgroundColor: variant.colorHex }}
                                >
                                  {isSelected && <Check className="w-3 h-3 text-white drop-shadow-md" strokeWidth={4} />}
                                </div>
                                <div className="flex flex-col items-start leading-tight">
                                  <span className={isOutOfStock ? 'line-through' : ''}>{variant.color}</span>
                                  <span className={`text-[8.5px] uppercase font-black tracking-wide ${
                                    isSelected ? 'text-sky-500' : isOutOfStock ? 'text-rose-500' : variant.stock <= 3 ? 'text-amber-500' : 'text-slate-400'
                                  }`}>
                                    {isOutOfStock ? 'Agotado' : variant.stock <= 3 ? `¡Última ${variant.stock}!` : `${variant.stock} disp.`}
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <hr className="border-slate-100 my-6" />

                    {/* Link Generation Area */}
                    <div className="space-y-4 bg-white rounded-3xl p-1 relative z-10">
                      <label className="text-xs font-black text-slate-400 tracking-wider uppercase flex items-center gap-2">
                        <Link2 className="w-4 h-4 text-sky-500" /> ENLACE VIP AUTOGENERADO
                      </label>
                      
                      {!isLinkReady ? (
                        <div className="bg-rose-50 text-rose-600 p-4 rounded-2xl flex items-start gap-3 border border-rose-100">
                          <AlertCircle className="w-5.5 h-5.5 shrink-0 text-rose-500" />
                          <div>
                            <p className="font-black text-sm">No se puede generar el link</p>
                            <p className="text-xs md:text-sm mt-0.5">La combinación seleccionada no tiene stock disponible en inventario.</p>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col sm:flex-row gap-3 relative">
                          <div className="relative flex-1 group">
                            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                              <LockIcon className="h-4.5 w-4.5 text-sky-500" />
                            </div>
                            <input 
                              type="text" 
                              readOnly 
                              value={generatedUrl}
                              className="w-full pl-11 pr-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-500 text-xs md:text-sm font-mono overflow-ellipsis focus:outline-none focus:border-sky-500 focus:bg-white transition-all shadow-inner"
                            />
                          </div>
                          <Button
                            onClick={copyToClipboard}
                            size="lg"
                            className={`rounded-2xl py-6.5 px-6 font-black text-sm shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all cursor-pointer ${
                              isCopied 
                                ? 'bg-sky-500 hover:bg-sky-600 text-white' 
                                : 'bg-gradient-to-r from-slate-900 to-slate-950 hover:from-black hover:to-slate-900 text-white'
                            }`}
                          >
                            {isCopied ? (
                              <>
                                <Check className="w-5 h-5 mr-2 shrink-0" />
                                ¡COPIADO!
                              </>
                            ) : (
                              <>
                                <Copy className="w-5 h-5 mr-2 shrink-0" />
                                COPIAR LINK VIP
                              </>
                            )}
                          </Button>
                        </div>
                      )}
                      
                      <div className="bg-sky-50/50 border border-sky-100/50 rounded-2xl p-4.5 flex items-start gap-3.5 mt-4">
                        <div className="bg-sky-100/80 p-2 rounded-xl shrink-0">
                          <Zap className="w-5 h-5 text-sky-600 animate-pulse" />
                        </div>
                        <p className="text-xs md:text-sm text-sky-800 leading-relaxed font-semibold">
                          Envía este enlace por WhatsApp. El cliente irá directo al checkout con <span className="font-black text-sky-950 bg-sky-100 px-1.5 py-0.5 rounded">{selectedProduct.name}</span> pre-cargado, sin distracciones, garantizando un cierre inmediato.
                        </p>
                      </div>
                    </div>

                  </div>
                )}
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LockIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
