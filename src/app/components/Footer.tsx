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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-y-12 gap-x-6 text-center">
            
            {/* Column 1: Pago */}
            <div className="flex flex-col items-center justify-start">
              <CreditCard className="w-8 h-8 text-[#1a202c] mb-4" strokeWidth={1.5} />
              <h4 className="text-[#1a202c] text-[13px] font-bold mb-3 uppercase tracking-wider">Formas de pago</h4>
              <ul className="text-gray-500 text-[11px] space-y-2">
                <li>Transferencia bancaria</li>
                <li>Efectivo</li>
                <li>Tarjetas débito y crédito — vía BOLD</li>
                <li>Nequi · Llave bre-b</li>
                <li className="font-semibold text-[#1a202c] pt-1">Pago contra entrega disponible</li>
              </ul>
            </div>

            {/* Column 2: Envío */}
            <div className="flex flex-col items-center justify-start">
              <Truck className="w-8 h-8 text-[#1a202c] mb-4" strokeWidth={1.5} />
              <h4 className="text-[#1a202c] text-[13px] font-bold mb-3 uppercase tracking-wider">Métodos de envío</h4>
              <ul className="text-gray-500 text-[11px] space-y-2">
                <li><span className="font-semibold text-gray-700">Domicilio</span> — $10.000 COP</li>
                <li><span className="font-semibold text-gray-700">Retiro en tienda</span> — Gratis</li>
                <li className="pt-2 leading-relaxed">
                  Realiza el pedido y pagas cuando recibas el equipo.<br />
                  Disponible en Cartagena y Turbaco.
                </li>
              </ul>
            </div>

            {/* Column 3: Contacto */}
            <div className="flex flex-col items-center justify-start">
              <Phone className="w-8 h-8 text-[#1a202c] mb-4" strokeWidth={1.5} />
              <h4 className="text-[#1a202c] text-[13px] font-bold mb-3 uppercase tracking-wider">Contacto</h4>
              <ul className="text-gray-500 text-[11px] space-y-2">
                <li>
                  <a href="mailto:xiaomi.cartagenaventas@gmail.com" className="hover:text-black transition-colors">
                    xiaomi.cartagenaventas@gmail.com
                  </a>
                </li>
                <li>
                  <a href="tel:+573022875280" className="hover:text-black transition-colors font-semibold text-gray-700">
                    +57 302 287 5280
                  </a>
                </li>
                <li className="pt-2 leading-relaxed">
                  Cl. 31 #61-64, Los Ángeles<br />
                  Cartagena de Indias, Bolívar
                </li>
              </ul>
            </div>

            {/* Column 4: Legal */}
            <div className="flex flex-col items-center justify-start">
              <ShieldCheck className="w-8 h-8 text-[#1a202c] mb-4" strokeWidth={1.5} />
              <h4 className="text-[#1a202c] text-[13px] font-bold mb-3 uppercase tracking-wider">Legal</h4>
              <ul className="text-gray-500 text-[11px] space-y-2">
                <li><a href="#" className="hover:text-black transition-colors">Política de privacidad</a></li>
                <li><a href="#" className="hover:text-black transition-colors">Términos y condiciones</a></li>
                <li><a href="#" className="hover:text-black transition-colors">Garantía de compra</a></li>
              </ul>
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
