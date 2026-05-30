import { useState } from 'react';
import { Star, MessageCircle, CreditCard, CheckCircle2, ShieldCheck, Smile, Meh, Frown } from 'lucide-react';

export function DemoFeaturesPage() {
  const [activeTab, setActiveTab] = useState<'reviews' | 'installments' | 'survey'>('reviews');
  const [surveyStep, setSurveyStep] = useState<0 | 1 | 2>(0);

  return (
    <div className="min-h-screen bg-slate-50 pt-8 pb-24 px-4 md:px-8 font-sans selection:bg-sky-500/30">
      
      {/* HEADER DEMO */}
      <div className="max-w-5xl mx-auto mb-10 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-sky-100/80 border border-sky-200 text-sky-800 text-xs font-black uppercase tracking-widest mb-4">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
          </span>
          Entorno de Pruebas
        </div>
        <h1 className="text-3xl md:text-5xl font-black text-slate-900 tracking-tight mb-4">
          Demostración de <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-500 to-blue-700">Nuevas Funciones</span>
        </h1>
        <p className="text-slate-500 max-w-2xl mx-auto text-sm md:text-base font-medium">
          Prueba de forma interactiva cómo las nuevas herramientas mejorarán la confianza de tus clientes, aumentarán la conversión de ventas y potenciarán la reputación de Xiaomi Cartagena.
        </p>
      </div>

      {/* TABS NAVIGATION */}
      <div className="max-w-3xl mx-auto mb-8 bg-white p-1.5 rounded-2xl border border-slate-200 shadow-sm flex overflow-x-auto hide-scrollbar">
        {[
          { id: 'reviews', icon: Star, title: 'Reseñas Reales' },
          { id: 'installments', icon: CreditCard, title: 'Calculadora Cuotas' },
          { id: 'survey', icon: MessageCircle, title: 'Encuesta Post-Compra' }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex-1 min-w-[140px] flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-sm transition-all duration-300 ${
              activeTab === tab.id 
                ? 'bg-slate-900 text-white shadow-md scale-100' 
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50 scale-95'
            }`}
          >
            <tab.icon className={`w-4 h-4 ${activeTab === tab.id ? 'text-sky-400' : ''}`} />
            {tab.title}
          </button>
        ))}
      </div>

      <div className="max-w-4xl mx-auto">
        {/* TAB 1: RESEÑAS */}
        {activeTab === 'reviews' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-white rounded-[2rem] border border-slate-100 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.05)] overflow-hidden">
              <div className="bg-slate-900 px-8 py-6 text-white">
                <h2 className="text-xl font-black flex items-center gap-2">
                  <Star className="w-5 h-5 text-yellow-400 fill-yellow-400" />
                  Sistema de Reseñas y Calificaciones
                </h2>
                <p className="text-slate-400 text-sm mt-1">Aumenta la confianza mostrando opiniones verificadas directamente en tus productos.</p>
              </div>
              
              <div className="p-8">
                {/* PROTOTIPO PRODUCTO */}
                <div className="bg-slate-50 p-6 rounded-3xl border border-slate-200 mb-8 max-w-lg mx-auto">
                  <h3 className="font-black text-slate-800 text-lg mb-4 text-center">Vista en Página de Producto</h3>
                  
                  {/* Resumen de estrellas */}
                  <div className="flex flex-col items-center justify-center bg-white p-6 rounded-2xl shadow-sm border border-slate-100 mb-6">
                    <div className="text-5xl font-black text-slate-900 tracking-tighter mb-2">4.8</div>
                    <div className="flex gap-1 mb-2">
                      {[1,2,3,4,5].map((_, i) => (
                        <Star key={i} className={`w-6 h-6 ${i < 4 ? 'text-yellow-400 fill-yellow-400' : 'text-yellow-400 fill-yellow-400'}`} style={i === 4 ? {clipPath: 'inset(0 20% 0 0)'} : {}} />
                      ))}
                    </div>
                    <p className="text-sm font-bold text-slate-500 flex items-center gap-1.5">
                      Basado en 47 opiniones <ShieldCheck className="w-4 h-4 text-green-500" />
                    </p>
                  </div>

                  {/* Reseñas individuales (Ejemplo) */}
                  <div className="space-y-4">
                    {[
                      { name: 'Andrés Felipe M.', date: 'Hace 2 días', rating: 5, text: 'Excelente celular, la cámara es brutal y la batería le dura todo el día. El envío fue súper rápido acá en Cartagena.', verified: true },
                      { name: 'Carolina V.', date: 'Hace 1 semana', rating: 5, text: 'Lo compré con algo de miedo por ser mi primera vez en la página, pero la atención fue 10/10. Recomendados.', verified: true }
                    ].map((review, i) => (
                      <div key={i} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <p className="font-black text-slate-800 text-sm flex items-center gap-1">
                              {review.name}
                              {review.verified && <CheckCircle2 className="w-3.5 h-3.5 text-sky-500" />}
                            </p>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{review.date}</p>
                          </div>
                          <div className="flex gap-0.5">
                            {[...Array(review.rating)].map((_, j) => <Star key={j} className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />)}
                          </div>
                        </div>
                        <p className="text-slate-600 text-sm leading-relaxed">{review.text}</p>
                      </div>
                    ))}
                    <button className="w-full py-3.5 bg-slate-900 hover:bg-black text-white font-black text-sm rounded-xl transition-all shadow-md">
                      Ver todas las 47 reseñas
                    </button>
                  </div>
                </div>

                {/* Explicación de valor */}
                <div className="grid md:grid-cols-3 gap-4">
                  <div className="bg-sky-50 border border-sky-100 p-5 rounded-2xl">
                    <h4 className="font-black text-sky-900 mb-2">Fricción Cero</h4>
                    <p className="text-sm text-sky-800/80 leading-relaxed">Los clientes confían más al ver a otros cartageneros comprando. Reduce las dudas y acelera la compra.</p>
                  </div>
                  <div className="bg-green-50 border border-green-100 p-5 rounded-2xl">
                    <h4 className="font-black text-green-900 mb-2">SEO y Prestigio</h4>
                    <p className="text-sm text-green-800/80 leading-relaxed">Google premia las páginas con reseñas reales, ayudando a posicionar tus productos más arriba en las búsquedas.</p>
                  </div>
                  <div className="bg-purple-50 border border-purple-100 p-5 rounded-2xl">
                    <h4 className="font-black text-purple-900 mb-2">Control Total</h4>
                    <p className="text-sm text-purple-800/80 leading-relaxed">Solo tú decides qué reseñas aprobar o rechazar desde el panel de administrador. Cero spam.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: CALCULADORA DE CUOTAS */}
        {activeTab === 'installments' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-white rounded-[2rem] border border-slate-100 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.05)] overflow-hidden">
              <div className="bg-slate-900 px-8 py-6 text-white">
                <h2 className="text-xl font-black flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-sky-400" />
                  Calculadora de Cuotas (Psicología de Precios)
                </h2>
                <p className="text-slate-400 text-sm mt-1">Convierte precios altos en pagos mensuales asequibles visualmente.</p>
              </div>
              
              <div className="p-8">
                {/* PROTOTIPO */}
                <div className="flex flex-col md:flex-row items-center justify-center gap-8 p-8 bg-slate-50 border border-slate-200 rounded-3xl mb-8">
                  
                  {/* Vista Clásica */}
                  <div className="w-full max-w-sm">
                    <p className="text-xs font-black text-slate-400 uppercase tracking-widest text-center mb-3">Diseño Actual</p>
                    <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm text-center opacity-70 grayscale">
                      <p className="text-3xl font-black text-slate-900">$2.199.000</p>
                      <button className="mt-3 w-full bg-orange-500 text-white font-bold py-3 rounded-xl pointer-events-none">Añadir al Carrito</button>
                    </div>
                  </div>

                  {/* Vista Nueva con Cuotas */}
                  <div className="w-full max-w-sm relative">
                    <div className="absolute -left-6 -top-2 bg-gradient-to-r from-sky-500 to-blue-600 text-white text-[10px] font-black uppercase tracking-widest py-1 px-3 rounded-full shadow-lg z-10 animate-bounce">
                      ¡Nuevo Diseño!
                    </div>
                    <p className="text-xs font-black text-sky-600 uppercase tracking-widest text-center mb-3">Diseño Optimizado</p>
                    <div className="bg-white p-6 rounded-2xl border-2 border-sky-100 shadow-xl shadow-sky-900/5 relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-sky-50 rounded-full blur-3xl -z-10 translate-x-10 -translate-y-10"></div>
                      
                      <div className="flex items-center justify-center mb-1">
                        <span className="text-4xl font-black text-slate-900 tracking-tighter">$2.199.000</span>
                      </div>
                      
                      {/* El hack psicológico */}
                      <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 mt-3 flex items-center justify-center gap-2">
                        <CreditCard className="w-4 h-4 text-sky-500" />
                        <div className="text-sm font-bold text-slate-700">
                          O págalo en <span className="text-sky-600">3x de $733.000</span>
                        </div>
                      </div>
                      <div className="text-[10px] text-center font-bold text-slate-400 mt-2 mb-4">
                        También disponible hasta 12 cuotas.
                      </div>
                      
                      <button className="w-full bg-slate-900 hover:bg-black text-white font-black text-sm py-4 rounded-xl shadow-lg transition-all scale-100 hover:scale-[1.02]">
                        Añadir al Carrito
                      </button>
                    </div>
                  </div>

                </div>

                {/* Explicación de valor */}
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="bg-amber-50 border border-amber-100 p-5 rounded-2xl">
                    <h4 className="font-black text-amber-900 mb-2">Reducción del Shock del Precio</h4>
                    <p className="text-sm text-amber-800/80 leading-relaxed">Ver "2 millones" asusta. Ver "3 cuotas de 733 mil" se siente mucho más fácil de asumir para el cliente.</p>
                  </div>
                  <div className="bg-indigo-50 border border-indigo-100 p-5 rounded-2xl">
                    <h4 className="font-black text-indigo-900 mb-2">Mayor Venta de Gamas Altas</h4>
                    <p className="text-sm text-indigo-800/80 leading-relaxed">Los clientes estarán más dispuestos a comprar celulares más costosos si desde el principio ven que hay facilidades de pago.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: ENCUESTA WHATSAPP */}
        {activeTab === 'survey' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-white rounded-[2rem] border border-slate-100 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.05)] overflow-hidden">
              <div className="bg-slate-900 px-8 py-6 text-white">
                <h2 className="text-xl font-black flex items-center gap-2">
                  <MessageCircle className="w-5 h-5 text-[#25D366]" />
                  Encuesta Automática Post-Compra (Bot)
                </h2>
                <p className="text-slate-400 text-sm mt-1">Genera reseñas automáticas y ataja problemas de clientes insatisfechos a tiempo.</p>
              </div>
              
              <div className="p-8">
                
                {/* PROTOTIPO WHATSAPP */}
                <div className="max-w-sm mx-auto mb-8 bg-[#EFEAE2] rounded-3xl border-[8px] border-slate-900 overflow-hidden shadow-2xl relative">
                  {/* Top bar WhatsApp */}
                  <div className="bg-[#075E54] text-white px-4 py-3 flex items-center gap-3">
                    <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center shrink-0">
                      <span className="text-orange-500 font-black text-xs">XC</span>
                    </div>
                    <div>
                      <div className="font-bold text-sm">Xiaomi Cartagena</div>
                      <div className="text-[10px] text-white/80">cuenta de empresa</div>
                    </div>
                  </div>

                  {/* Chat Area */}
                  <div className="p-4 h-[400px] overflow-y-auto bg-[url('https://web.whatsapp.com/img/bg-chat-tile-dark_a4be512e7195b6b733d9110b408f075d.png')] bg-cover relative">
                    
                    {/* Mensaje 1 */}
                    <div className="bg-white p-3 rounded-xl rounded-tl-none max-w-[85%] shadow-sm text-sm text-slate-800 mb-3 animate-in fade-in zoom-in duration-500">
                      ¡Hola Santiago! 👋 Soy el asistente de Xiaomi Cartagena. 
                      <br/><br/>
                      Hace 3 días recibiste tu nuevo <strong>Poco X6 Pro</strong>. Queríamos saber, ¿cómo ha sido tu experiencia con el equipo y con nuestra atención?
                      <br/><br/>
                      Por favor selecciona una opción:
                    </div>

                    {/* Botones Interactivos WhatsApp */}
                    {surveyStep === 0 && (
                      <div className="flex flex-col gap-2 max-w-[85%] animate-in fade-in duration-700 delay-300 fill-mode-backwards">
                        <button onClick={() => setSurveyStep(1)} className="bg-white hover:bg-sky-50 text-sky-600 font-bold text-sm py-2.5 rounded-xl shadow-sm border border-slate-100 flex items-center justify-center gap-2 transition-colors">
                          <Smile className="w-4 h-4" /> Excelente
                        </button>
                        <button onClick={() => setSurveyStep(2)} className="bg-white hover:bg-slate-50 text-slate-600 font-bold text-sm py-2.5 rounded-xl shadow-sm border border-slate-100 flex items-center justify-center gap-2 transition-colors">
                          <Meh className="w-4 h-4" /> Regular
                        </button>
                        <button onClick={() => setSurveyStep(2)} className="bg-white hover:bg-rose-50 text-rose-600 font-bold text-sm py-2.5 rounded-xl shadow-sm border border-slate-100 flex items-center justify-center gap-2 transition-colors">
                          <Frown className="w-4 h-4" /> Malo
                        </button>
                      </div>
                    )}

                    {/* Si responde Excelente */}
                    {surveyStep === 1 && (
                      <>
                        <div className="bg-[#dcf8c6] p-2 px-3 rounded-xl rounded-tr-none max-w-[85%] ml-auto shadow-sm text-sm text-slate-800 mb-3">
                          Excelente 😊
                        </div>
                        <div className="bg-white p-3 rounded-xl rounded-tl-none max-w-[85%] shadow-sm text-sm text-slate-800 animate-in fade-in zoom-in duration-300">
                          ¡Qué alegría saberlo! 🎉<br/><br/>
                          Nos ayudarías muchísimo si nos dejas una rápida reseña de 5 estrellas contándole a otros tu experiencia. Solo te tomará 1 minuto:
                          <br/><br/>
                          <a href="#" className="text-sky-600 underline font-bold">xiaomicartagena.com/dejar-resena</a>
                          <br/><br/>
                          ¡Disfruta tu equipo!
                        </div>
                      </>
                    )}

                    {/* Si responde Malo/Regular */}
                    {surveyStep === 2 && (
                      <>
                        <div className="bg-[#dcf8c6] p-2 px-3 rounded-xl rounded-tr-none max-w-[85%] ml-auto shadow-sm text-sm text-slate-800 mb-3">
                          Regular / Malo
                        </div>
                        <div className="bg-white p-3 rounded-xl rounded-tl-none max-w-[85%] shadow-sm text-sm text-slate-800 animate-in fade-in zoom-in duration-300">
                          Lamentamos mucho que tu experiencia no haya sido la mejor 😔.<br/><br/>
                          Un asesor humano se conectará en este mismo chat en breve para solucionar tu inconveniente lo más rápido posible.
                        </div>
                      </>
                    )}
                    
                    {surveyStep !== 0 && (
                      <button onClick={() => setSurveyStep(0)} className="absolute bottom-4 left-4 right-4 bg-slate-900 text-white font-bold text-xs py-2 rounded-lg text-center opacity-80 hover:opacity-100 transition-opacity">
                        Reiniciar Simulación
                      </button>
                    )}

                  </div>
                </div>

                {/* Explicación de valor */}
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="bg-rose-50 border border-rose-100 p-5 rounded-2xl">
                    <h4 className="font-black text-rose-900 mb-2 flex items-center gap-2"><ShieldCheck className="w-4 h-4"/> Protección de Marca</h4>
                    <p className="text-sm text-rose-800/80 leading-relaxed">Si alguien tuvo un problema, el bot ataja la queja en privado por WhatsApp ANTES de que el cliente vaya enojado a Google a poner 1 estrella.</p>
                  </div>
                  <div className="bg-emerald-50 border border-emerald-100 p-5 rounded-2xl">
                    <h4 className="font-black text-emerald-900 mb-2 flex items-center gap-2"><Star className="w-4 h-4"/> Reseñas en Piloto Automático</h4>
                    <p className="text-sm text-emerald-800/80 leading-relaxed">Filtra a los clientes felices y mándalos directo a dejarte una calificación de 5 estrellas en tu web o en Google, todo sin mover un dedo.</p>
                  </div>
                </div>

              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
