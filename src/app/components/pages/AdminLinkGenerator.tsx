import { useState, useMemo } from 'react';
import { useProducts, Product } from '../ProductContext';
import { Button } from '../ui/button';
import { Link2, Copy, Check, ChevronRight, Search, Zap, Smartphone, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

export function AdminLinkGenerator() {
  const { products } = useProducts();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedColor, setSelectedColor] = useState<string>('');
  const [selectedStorage, setSelectedStorage] = useState<string>('');
  const [copied, setCopied] = useState(false);

  // Filtrar productos
  const filteredProducts = useMemo(() => {
    return products.filter(p => 
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
      p.category.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [products, searchTerm]);

  // Manejar selección de producto
  const handleSelectProduct = (product: Product) => {
    setSelectedProduct(product);
    // Auto-seleccionar si solo hay una variante o resetear
    setSelectedColor(product.colorVariants?.length === 1 ? product.colorVariants[0].color : '');
    setSelectedStorage(product.storageVariants?.length === 1 ? product.storageVariants[0].storage : '');
    setCopied(false);
  };

  // Generar URL
  const generatedLink = useMemo(() => {
    if (!selectedProduct) return '';
    const baseUrl = window.location.origin;
    const params = new URLSearchParams();
    params.set('productId', selectedProduct.id);
    if (selectedColor) params.set('color', selectedColor);
    if (selectedStorage) params.set('storage', selectedStorage);
    
    return `${baseUrl}/comprar?${params.toString()}`;
  }, [selectedProduct, selectedColor, selectedStorage]);

  const handleCopy = async () => {
    if (!generatedLink) return;
    
    // Validar variantes
    if (selectedProduct?.colorVariants?.length && !selectedColor) {
      toast.error('Por favor selecciona un color');
      return;
    }
    if (selectedProduct?.storageVariants?.length && !selectedStorage) {
      toast.error('Por favor selecciona una capacidad');
      return;
    }

    try {
      await navigator.clipboard.writeText(generatedLink);
      setCopied(true);
      toast.success('¡Enlace copiado al portapapeles!');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error('Error al copiar el enlace');
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 lg:p-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* HEADER BRUTAL */}
      <div className="relative overflow-hidden rounded-3xl bg-gray-900 border border-gray-800 p-8 sm:p-10 text-white shadow-2xl">
        <div className="absolute top-0 right-0 w-64 h-64 bg-orange-500 rounded-full mix-blend-overlay filter blur-3xl opacity-20 translate-x-20 -translate-y-20" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-500 rounded-full mix-blend-overlay filter blur-3xl opacity-20 -translate-x-20 translate-y-20" />
        
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/20 text-xs font-semibold uppercase tracking-wider mb-4 backdrop-blur-md">
            <Sparkles className="w-4 h-4 text-orange-400" />
            <span className="text-orange-400">Ventas Directas</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-black tracking-tight mb-4">
            Generador de <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-red-500">Enlaces VIP</span>
          </h1>
          <p className="text-gray-400 text-lg max-w-xl">
            Crea links de pago directos para tus clientes. Cierra ventas por WhatsApp en segundos con una experiencia premium.
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-8">
        
        {/* COLUMNA IZQUIERDA: BUSCADOR */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
            <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wide mb-4 flex items-center gap-2">
              <Search className="w-4 h-4 text-orange-500" />
              1. Buscar Equipo
            </h2>
            
            <div className="relative mb-4">
              <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Ej. Redmi Note 13 Pro..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:bg-white focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all text-sm font-medium"
              />
            </div>

            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
              {filteredProducts.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">No se encontraron productos</div>
              ) : (
                filteredProducts.map(product => (
                  <button
                    key={product.id}
                    onClick={() => handleSelectProduct(product)}
                    className={`w-full text-left flex items-center gap-3 p-3 rounded-xl border-2 transition-all ${
                      selectedProduct?.id === product.id 
                        ? 'border-orange-500 bg-orange-50' 
                        : 'border-transparent hover:border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <div className="w-12 h-12 bg-white rounded-lg border border-gray-100 flex items-center justify-center p-1 shrink-0">
                      {product.image ? (
                        <img src={product.image} alt={product.name} className="w-full h-full object-contain" />
                      ) : (
                        <Smartphone className="w-5 h-5 text-gray-300" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-gray-900 text-sm truncate">{product.name}</div>
                      <div className="text-xs text-gray-500 font-medium">${product.price.toLocaleString('es-CO')} COP</div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* COLUMNA DERECHA: CONFIGURADOR Y LINK */}
        <div className="lg:col-span-7 space-y-6">
          
          <div className={`bg-white rounded-2xl border shadow-sm p-6 lg:p-8 transition-all duration-300 ${selectedProduct ? 'border-orange-200 shadow-orange-500/5' : 'border-gray-200 opacity-50 grayscale pointer-events-none'}`}>
            <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wide mb-6 flex items-center gap-2">
              <Zap className="w-4 h-4 text-orange-500" />
              2. Configurar y Generar
            </h2>

            {selectedProduct ? (
              <div className="space-y-6">
                
                {/* Producto Info */}
                <div className="flex items-center gap-4 bg-gray-50 p-4 rounded-xl border border-gray-100">
                  <div className="w-16 h-16 bg-white rounded-xl border border-gray-200 p-2 shrink-0">
                    <img src={selectedProduct.image} alt={selectedProduct.name} className="w-full h-full object-contain" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900 leading-tight">{selectedProduct.name}</h3>
                    <p className="text-sm text-gray-500 font-medium">{selectedProduct.category}</p>
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-6">
                  {/* Selector Almacenamiento */}
                  {selectedProduct.storageVariants && selectedProduct.storageVariants.length > 0 && (
                    <div className="space-y-3">
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Capacidad</label>
                      <div className="grid grid-cols-2 gap-2">
                        {selectedProduct.storageVariants.map(v => (
                          <button
                            key={v.storage}
                            onClick={() => setSelectedStorage(v.storage)}
                            disabled={v.stock === 0}
                            className={`p-2.5 rounded-lg border-2 text-sm font-semibold transition-all ${
                              selectedStorage === v.storage
                                ? 'border-orange-500 bg-orange-50 text-orange-700'
                                : v.stock === 0
                                ? 'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed'
                                : 'border-gray-200 hover:border-gray-300 text-gray-700 bg-white'
                            }`}
                          >
                            {v.storage}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Selector Color */}
                  {selectedProduct.colorVariants && selectedProduct.colorVariants.length > 0 && (
                    <div className="space-y-3">
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Color {selectedColor && `- ${selectedColor}`}</label>
                      <div className="flex flex-wrap gap-2">
                        {selectedProduct.colorVariants.map(v => (
                          <button
                            key={v.color}
                            onClick={() => setSelectedColor(v.color)}
                            disabled={v.stock === 0}
                            title={v.color}
                            className={`w-10 h-10 rounded-full border-2 transition-all relative ${
                              selectedColor === v.color
                                ? 'border-orange-500 ring-4 ring-orange-100 scale-110'
                                : v.stock === 0
                                ? 'border-gray-200 opacity-30 cursor-not-allowed'
                                : 'border-gray-300 hover:scale-105'
                            }`}
                            style={{ backgroundColor: v.colorHex }}
                          >
                            {selectedColor === v.color && (
                              <div className="absolute inset-0 flex items-center justify-center">
                                <div className="w-2 h-2 bg-white rounded-full shadow-sm" />
                              </div>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Área de Link */}
                <div className="pt-6 border-t border-gray-100 space-y-4">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                    <Link2 className="w-4 h-4" /> Enlace Generado
                  </label>
                  
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex-1 bg-gray-50 border border-gray-200 rounded-xl p-3 flex items-center overflow-hidden group hover:border-gray-300 transition-colors">
                      <span className="text-sm font-medium text-gray-600 truncate mr-2 select-all">
                        {generatedLink}
                      </span>
                    </div>
                    
                    <Button 
                      onClick={handleCopy}
                      className={`h-12 px-6 rounded-xl font-bold transition-all shadow-lg ${
                        copied 
                          ? 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/20 text-white' 
                          : 'bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 shadow-orange-500/20 text-white'
                      }`}
                    >
                      {copied ? (
                        <><Check className="w-5 h-5 mr-2" /> Copiado</>
                      ) : (
                        <><Copy className="w-5 h-5 mr-2" /> Copiar Link</>
                      )}
                    </Button>
                  </div>
                  
                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex gap-3 text-sm text-blue-800">
                    <Sparkles className="w-5 h-5 shrink-0 mt-0.5" />
                    <p>Envía este enlace por WhatsApp. El cliente irá directo al checkout con este producto pre-cargado, sin distracciones.</p>
                  </div>
                </div>

              </div>
            ) : (
              <div className="h-64 flex flex-col items-center justify-center text-gray-400">
                <Smartphone className="w-12 h-12 mb-4 opacity-50" />
                <p className="font-medium">Selecciona un producto primero</p>
              </div>
            )}
          </div>
          
        </div>
      </div>
    </div>
  );
}
