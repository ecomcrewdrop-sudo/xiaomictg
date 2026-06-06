import { Truck, Lock, ShieldCheck, MessageCircle } from 'lucide-react';

export function Footer() {
  return (
    <footer className="w-full font-sans">
      {/* Top Section - Dark Gradient */}
      <div className="bg-gradient-to-b from-[#11131a] to-[#000000] py-16 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-4 text-center">
            
            {/* Item 1 */}
            <div className="flex flex-col items-center justify-center">
              <span className="text-[#ff6600] text-[40px] md:text-5xl font-light mb-3">38</span>
              <span className="text-gray-300 text-[10px] tracking-[0.2em] uppercase font-medium">Productos Disponibles</span>
            </div>

            {/* Item 2 */}
            <div className="flex flex-col items-center justify-center">
              <span className="text-[#ff6600] text-[40px] md:text-5xl font-light mb-3">24/7</span>
              <span className="text-gray-300 text-[10px] tracking-[0.2em] uppercase font-medium">Soporte Técnico</span>
            </div>

            {/* Item 3 */}
            <div className="flex flex-col items-center justify-center">
              <span className="text-[#ff6600] text-[40px] md:text-5xl font-light mb-3">100%</span>
              <span className="text-gray-300 text-[10px] tracking-[0.2em] uppercase font-medium">Productos Originales</span>
            </div>

          </div>
        </div>
      </div>

      {/* Bottom Section - White */}
      <div className="bg-white py-14 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-y-10 gap-x-4 text-center">
            
            {/* Feature 1 */}
            <div className="flex flex-col items-center justify-center">
              <Truck className="w-8 h-8 text-[#1a202c] mb-4" strokeWidth={1.5} />
              <h4 className="text-[#1a202c] text-[13px] font-medium mb-1.5">Envío a domicilio</h4>
              <p className="text-gray-400 text-[11px]">+$10.000 - Todo Cartagena</p>
            </div>

            {/* Feature 2 */}
            <div className="flex flex-col items-center justify-center">
              <Lock className="w-8 h-8 text-[#1a202c] mb-4" strokeWidth={1.5} />
              <h4 className="text-[#1a202c] text-[13px] font-medium mb-1.5">Pago Seguro</h4>
              <p className="text-gray-400 text-[11px]">Contra entrega disponible</p>
            </div>

            {/* Feature 3 */}
            <div className="flex flex-col items-center justify-center">
              <ShieldCheck className="w-8 h-8 text-[#1a202c] mb-4" strokeWidth={1.5} />
              <h4 className="text-[#1a202c] text-[13px] font-medium mb-1.5">Garantía Oficial</h4>
              <p className="text-gray-400 text-[11px]">12 meses - Xiaomi</p>
            </div>

            {/* Feature 4 */}
            <div className="flex flex-col items-center justify-center">
              <MessageCircle className="w-8 h-8 text-[#1a202c] mb-4" strokeWidth={1.5} />
              <h4 className="text-[#1a202c] text-[13px] font-medium mb-1.5">Soporte WhatsApp</h4>
              <p className="text-gray-400 text-[11px]">Respuesta inmediata</p>
            </div>

          </div>
          
          <div className="mt-16 text-center text-gray-400 text-[11px]">
             © {new Date().getFullYear()} Xiaomi Cartagena. Todos los derechos reservados.
          </div>
        </div>
      </div>
    </footer>
  );
}
