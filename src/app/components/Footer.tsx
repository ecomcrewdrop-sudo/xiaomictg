import { CreditCard, Truck, Phone, ShieldCheck } from 'lucide-react';

export function Footer() {
  return (
    <footer className="w-full font-sans">
      {/* Top Section - Dark Gradient */}
      <div className="bg-gradient-to-b from-[#11131a] to-[#000000] py-16 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-4 text-center">
            
            {/* Item 1 */}
            <div className="flex flex-col items-center justify-center">
              <span className="text-[#ff6600] text-[40px] md:text-5xl font-light mb-3">+150</span>
              <span className="text-gray-300 text-[10px] tracking-[0.2em] uppercase font-medium">Equipos Entregados</span>
            </div>

            {/* Item 2 */}
            <div className="flex flex-col items-center justify-center">
              <span className="text-[#ff6600] text-[40px] md:text-5xl font-light mb-3">100%</span>
              <span className="text-gray-300 text-[10px] tracking-[0.2em] uppercase font-medium">Equipos Originales</span>
            </div>

            {/* Item 3 */}
            <div className="flex flex-col items-center justify-center">
              <span className="text-[#ff6600] text-[40px] md:text-5xl font-light mb-3">24/7</span>
              <span className="text-gray-300 text-[10px] tracking-[0.2em] uppercase font-medium">Soporte y Garantía</span>
            </div>

          </div>
        </div>
      </div>

      {/* Bottom Section - White (Información Original) */}
      <div className="bg-white py-14 px-4 border-t border-gray-100">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-y-12 gap-x-6 text-center">
            
            {/* Column 1: Pago */}
            <div className="flex flex-col items-center justify-center p-6 border border-gray-200 rounded-2xl hover:border-gray-300 transition-colors">
              <div className="w-12 h-12 rounded-full border border-gray-200 flex items-center justify-center mb-4">
                <CreditCard className="w-5 h-5 text-[#1a202c]" strokeWidth={1.5} />
              </div>
              <h4 className="text-[#1a202c] text-[13px] font-bold mb-1.5">Múltiples Formas de Pago</h4>
              <p className="text-gray-500 text-[11px]">Contra entrega disponible</p>
            </div>

            {/* Column 2: Envío */}
            <div className="flex flex-col items-center justify-center p-6 border border-gray-200 rounded-2xl hover:border-gray-300 transition-colors">
              <div className="w-12 h-12 rounded-full border border-gray-200 flex items-center justify-center mb-4">
                <Truck className="w-5 h-5 text-[#1a202c]" strokeWidth={1.5} />
              </div>
              <h4 className="text-[#1a202c] text-[13px] font-bold mb-1.5">Envíos a Domicilio</h4>
              <p className="text-gray-500 text-[11px]">$10.000 COP - Todo Cartagena</p>
            </div>

            {/* Column 3: Contacto */}
            <div className="flex flex-col items-center justify-center p-6 border border-gray-200 rounded-2xl hover:border-gray-300 transition-colors">
              <div className="w-12 h-12 rounded-full border border-gray-200 flex items-center justify-center mb-4">
                <Phone className="w-5 h-5 text-[#1a202c]" strokeWidth={1.5} />
              </div>
              <h4 className="text-[#1a202c] text-[13px] font-bold mb-1.5">Línea de Atención</h4>
              <p className="text-gray-500 text-[11px]">+57 302 287 5280</p>
            </div>

            {/* Column 4: Legal */}
            <div className="flex flex-col items-center justify-center p-6 border border-gray-200 rounded-2xl hover:border-gray-300 transition-colors">
              <div className="w-12 h-12 rounded-full border border-gray-200 flex items-center justify-center mb-4">
                <ShieldCheck className="w-5 h-5 text-[#1a202c]" strokeWidth={1.5} />
              </div>
              <h4 className="text-[#1a202c] text-[13px] font-bold mb-1.5">Garantía Oficial</h4>
              <p className="text-gray-500 text-[11px]">Equipos 100% seguros</p>
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
