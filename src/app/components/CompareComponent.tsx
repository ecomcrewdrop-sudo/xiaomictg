import { useCompareStore } from './CompareStore';
import { X, Scale, ChevronDown, ChevronUp, Check, Award, Truck, ShieldCheck, Zap, Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import { useState, useEffect } from 'react';

export function CompareComponent() {
  const { items, removeItem, clear, isOpen, setIsOpen } = useCompareStore();
  const [aiRecommendation, setAiRecommendation] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);

  useEffect(() => {
    if (items.length === 2) {
      const fetchRecommendation = async () => {
        setIsAiLoading(true);
        setAiRecommendation(null);
        try {
          const res = await fetch('/api/compare-ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productA: items[0], productB: items[1] })
          });
          if (res.ok) {
            const data = await res.json();
            setAiRecommendation(data.recommendation);
          }
        } catch (error) {
          console.error("Error fetching AI recommendation", error);
        } finally {
          setIsAiLoading(false);
        }
      };
      fetchRecommendation();
    } else {
      setAiRecommendation(null);
    }
  }, [items.length === 2 ? items[0].id + items[1].id : '']);

  if (items.length === 0) return null;

  const hasTwoItems = items.length === 2;
  const cheaperItemId = hasTwoItems 
    ? (items[0].price < items[1].price ? items[0].id : items[1].price < items[0].price ? items[1].id : null) 
    : null;

  return (
    <div className={`fixed inset-x-0 bottom-0 z-[90] transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${isOpen ? 'translate-y-0' : 'translate-y-[calc(100%-48px)]'}`}>
      
      {/* Backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/40 backdrop-blur-sm -z-10 transition-opacity" 
          onClick={() => setIsOpen(false)}
        />
      )}

      <div className="bg-white rounded-t-3xl border-t border-white/20 shadow-[0_-20px_60px_rgba(0,0,0,0.2)] flex flex-col max-h-[90vh]">
        
        {/* Header bar */}
        <div 
          onClick={() => setIsOpen(!isOpen)}
          className="h-14 sm:h-16 bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 text-white rounded-t-3xl flex items-center justify-between px-4 sm:px-8 cursor-pointer hover:from-black hover:to-black transition-all group relative overflow-hidden"
        >
          {/* Shimmer effect */}
          <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/5 to-transparent group-hover:animate-[shimmer_1.5s_infinite]" />
          
          <div className="flex items-center gap-3 relative z-10">
            <div className="relative">
              <Scale className="w-5 h-5 sm:w-6 sm:h-6 text-orange-500" />
              {items.length === 2 && (
                <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-orange-500"></span>
                </span>
              )}
            </div>
            <span className="font-black text-sm sm:text-base tracking-wide flex items-center gap-2">
              VS BATTLE <span className="text-gray-400 font-medium text-xs sm:text-sm">|</span>
              <span className="bg-orange-500/20 text-orange-400 border border-orange-500/30 text-[10px] sm:text-xs px-2 py-0.5 rounded-full font-bold">
                {items.length}/2 EQUIPOS
              </span>
            </span>
          </div>
          <div className="flex items-center gap-4 relative z-10">
            {isOpen && items.length > 0 && (
              <button 
                onClick={(e) => { e.stopPropagation(); clear(); }}
                className="text-[10px] sm:text-xs font-bold text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-full transition-all uppercase tracking-wider"
              >
                Limpiar
              </button>
            )}
            <div className="bg-white/10 p-1 rounded-full group-hover:bg-white/20 transition-colors">
              {isOpen ? <ChevronDown className="w-5 h-5 text-gray-300" /> : <ChevronUp className="w-5 h-5 text-orange-500" />}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-8 overflow-y-auto bg-gray-50/50 flex-1 relative">
          
          {/* Background decorations */}
          <div className="absolute top-0 left-0 w-full h-64 bg-gradient-to-b from-gray-100 to-transparent -z-10"></div>
          
          {items.length === 1 ? (
            <div className="text-center py-16 px-4 border-2 border-dashed border-orange-200/50 rounded-3xl bg-white max-w-2xl mx-auto shadow-xl shadow-orange-500/5 relative overflow-hidden">
              <div className="absolute -right-10 -top-10 w-40 h-40 bg-orange-500/5 rounded-full blur-3xl"></div>
              <div className="absolute -left-10 -bottom-10 w-40 h-40 bg-blue-500/5 rounded-full blur-3xl"></div>
              
              <div className="inline-flex p-5 rounded-2xl bg-gradient-to-br from-orange-50 to-orange-100 border border-orange-200 mb-6 shadow-inner relative">
                <div className="absolute -top-2 -right-2 bg-orange-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse">1/2</div>
                <Scale className="w-10 h-10 text-orange-500" />
              </div>
              <h3 className="text-2xl sm:text-3xl font-black text-gray-900 mb-3 tracking-tight">¡Enfrentamiento Épico!</h3>
              <p className="text-base text-gray-500 max-w-md mx-auto leading-relaxed mb-6">
                Tienes a <strong className="text-gray-900 border-b-2 border-orange-200">{items[0].name}</strong> en la esquina. Selecciona su rival del catálogo para descubrir cuál es tu mejor opción.
              </p>
              
              <button onClick={() => setIsOpen(false)} className="inline-flex items-center gap-2 bg-gray-900 hover:bg-black text-white px-6 py-3 rounded-xl font-bold text-sm transition-transform hover:-translate-y-1 shadow-lg shadow-gray-900/20">
                <Zap className="w-4 h-4 text-orange-500" />
                Buscar un rival
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-6 sm:gap-8 relative max-w-5xl mx-auto w-full">
              
              {/* AI Recommendation Box */}
              {(isAiLoading || aiRecommendation) && (
                <div className="bg-gradient-to-r from-orange-50 to-orange-100/50 rounded-2xl p-4 sm:p-6 border border-orange-200/50 shadow-inner relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-4 opacity-10">
                    <Sparkles className="w-24 h-24 text-orange-500" />
                  </div>
                  <div className="flex items-start gap-3 relative z-10">
                    <div className="bg-gradient-to-br from-orange-400 to-red-500 p-2 sm:p-2.5 rounded-xl shadow-lg shadow-orange-500/20 text-white shrink-0 mt-1">
                      <Sparkles className="w-5 h-5 sm:w-6 sm:h-6" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-black text-gray-900 text-sm sm:text-base mb-1.5 flex items-center gap-2">
                        Veredicto de Karol AI
                        {isAiLoading && (
                          <span className="flex gap-1 ml-1">
                            <span className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-bounce"></span>
                            <span className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-bounce" style={{animationDelay: '0.15s'}}></span>
                            <span className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-bounce" style={{animationDelay: '0.3s'}}></span>
                          </span>
                        )}
                      </h4>
                      {isAiLoading ? (
                        <div className="space-y-2.5 mt-3">
                          <div className="h-2 sm:h-2.5 bg-orange-200/60 rounded animate-pulse w-3/4"></div>
                          <div className="h-2 sm:h-2.5 bg-orange-200/60 rounded animate-pulse w-full"></div>
                          <div className="h-2 sm:h-2.5 bg-orange-200/60 rounded animate-pulse w-5/6"></div>
                        </div>
                      ) : (
                        <div className="text-gray-700 text-xs sm:text-sm leading-relaxed whitespace-pre-wrap font-medium">
                          {aiRecommendation}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 sm:gap-8 relative">
              {/* Divider line and VS badge */}
              <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-gray-300 to-transparent -translate-x-1/2 z-10 hidden sm:block">
                <div className="absolute top-[30%] left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gradient-to-br from-gray-900 to-black border-4 border-white rounded-full p-3 shadow-xl">
                  <span className="text-sm font-black text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-red-500 italic">VS</span>
                </div>
              </div>
              
              {items.map((product, idx) => {
                const isCheaper = cheaperItemId === product.id;
                
                return (
                <div key={product.id} className={`flex flex-col bg-white p-3 sm:p-8 rounded-[2rem] relative transition-all duration-500 hover:-translate-y-1 group ${isCheaper ? 'shadow-2xl shadow-orange-500/10 border-2 border-orange-500/50' : 'shadow-xl shadow-gray-200/50 border border-gray-100'}`}>
                  
                  {isCheaper && (
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-gradient-to-r from-orange-500 to-red-500 text-white px-4 py-1.5 rounded-full text-xs font-black flex items-center gap-1.5 shadow-lg shadow-orange-500/30 z-20 whitespace-nowrap">
                      <Award className="w-4 h-4" />
                      MEJOR PRECIO
                    </div>
                  )}

                  <button 
                    onClick={() => removeItem(product.id)}
                    className="absolute top-4 right-4 p-2 text-gray-300 hover:bg-red-50 hover:text-red-500 rounded-full transition-all z-20 bg-white shadow-sm border border-gray-100 hover:scale-110"
                  >
                    <X className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                  
                  <div className="aspect-square bg-gradient-to-b from-gray-50 to-white rounded-2xl mb-6 p-4 sm:p-8 flex items-center justify-center relative group-hover:scale-105 transition-transform duration-500 border border-gray-100">
                    <div className={`absolute top-3 left-3 text-[10px] font-black px-2.5 py-1 rounded-lg uppercase tracking-widest shadow-sm z-10 ${idx === 0 ? 'bg-black text-white' : 'bg-gray-200 text-gray-800'}`}>
                      {idx === 0 ? 'Opción A' : 'Opción B'}
                    </div>
                    <img src={product.image} alt={product.name} className="max-h-full object-contain drop-shadow-xl" />
                  </div>
                  
                  <div className="text-center mb-6">
                    <span className="text-[10px] font-bold text-orange-500 uppercase tracking-widest block mb-2 bg-orange-50 inline-block px-2 py-0.5 rounded-md">{product.category}</span>
                    <h3 className="font-black text-gray-900 text-lg sm:text-2xl mb-2 min-h-[56px] sm:min-h-[64px] leading-tight line-clamp-2">{product.name}</h3>
                    
                    <div className="flex flex-col items-center justify-center mb-2">
                      <p className={`text-2xl sm:text-4xl font-black tracking-tight ${isCheaper ? 'text-orange-600' : 'text-gray-900'}`}>
                        ${product.price.toLocaleString('es-CO')}
                      </p>
                    </div>
                  </div>

                  {/* Specs comparison */}
                  <div className="space-y-3 sm:space-y-4 mb-8 flex-1">
                    
                    {product.storageVariants && product.storageVariants.length > 0 && (
                      <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 group-hover:border-gray-200 transition-colors">
                        <span className="block text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-2 flex items-center gap-1.5">
                          <Zap className="w-3.5 h-3.5 text-orange-400" />
                          Versiones
                        </span>
                        <div className="flex flex-wrap gap-2">
                          {product.storageVariants.map(v => (
                            <span key={v.storage} className="bg-white border border-gray-200 text-gray-800 text-xs px-2.5 py-1.5 rounded-lg font-bold shadow-sm">{v.storage}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {product.colorVariants && product.colorVariants.length > 0 && (
                      <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 group-hover:border-gray-200 transition-colors">
                        <span className="block text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-2">Colores</span>
                        <div className="flex gap-2 flex-wrap">
                          {product.colorVariants.map(c => (
                            <div key={c.colorHex} title={c.color} className="w-6 h-6 rounded-full border-2 border-white shadow-md ring-1 ring-gray-200" style={{ backgroundColor: c.colorHex }}></div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 flex-1 relative overflow-hidden group-hover:border-gray-200 transition-colors">
                      <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-orange-100 to-transparent opacity-50 rounded-bl-full"></div>
                      <span className="block text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-2">Lo más destacado</span>
                      <p className="text-gray-600 text-xs sm:text-[13px] leading-relaxed line-clamp-4 relative z-10">{product.description}</p>
                    </div>
                  </div>

                  <div className="mt-auto pt-4 flex flex-col gap-3">
                    {/* Trust badges */}
                    <div className="flex items-center justify-center gap-4 mb-2">
                      <div className="flex items-center gap-1 text-[10px] text-gray-500 font-semibold uppercase">
                        <Truck className="w-3.5 h-3.5 text-green-500" /> Envío Rápido
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-gray-500 font-semibold uppercase">
                        <ShieldCheck className="w-3.5 h-3.5 text-blue-500" /> Garantía
                      </div>
                    </div>

                    <Link 
                      to={`/product/${product.id}`}
                      onClick={() => setIsOpen(false)}
                      className={`w-full font-black py-4 rounded-xl text-sm transition-all flex items-center justify-center gap-2 shadow-xl no-underline uppercase tracking-wide
                        ${isCheaper 
                          ? 'bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white shadow-orange-500/30 hover:shadow-orange-500/50 hover:-translate-y-1' 
                          : 'bg-gray-900 hover:bg-black text-white shadow-gray-900/20 hover:shadow-gray-900/40 hover:-translate-y-1'
                        }`}
                    >
                      <Check className="w-5 h-5" />
                      ME QUEDO CON ESTE
                    </Link>
                  </div>
                </div>
              )})}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
