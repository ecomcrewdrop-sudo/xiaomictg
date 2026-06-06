import { CreditCard, Truck, Headset, ShieldCheck, MapPin, Phone, ExternalLink } from 'lucide-react';

export function Footer() {
  return (
    <footer className="bg-[#050505] text-gray-400 border-t border-gray-900 relative overflow-hidden">
      {/* Resplandor decorativo */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-orange-500/10 rounded-full blur-[120px] pointer-events-none"></div>
      
      <div className="container mx-auto px-5 py-12 lg:py-16 relative z-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-8 lg:gap-12 mb-12">
          
          {/* Formas de pago */}
          <div className="bg-gray-900/40 p-5 rounded-2xl border border-gray-800/50 backdrop-blur-sm">
            <h3 className="text-white text-sm font-bold mb-4 uppercase tracking-wider flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-orange-500" />
              Pago
            </h3>
            <ul className="space-y-3 text-sm">
              <li className="flex items-center gap-2 transition-colors hover:text-gray-200">
                <div className="w-1.5 h-1.5 rounded-full bg-gray-700"></div> Transferencia
              </li>
              <li className="flex items-center gap-2 transition-colors hover:text-gray-200">
                <div className="w-1.5 h-1.5 rounded-full bg-gray-700"></div> Efectivo
              </li>
              <li className="flex items-center gap-2 transition-colors hover:text-gray-200">
                <div className="w-1.5 h-1.5 rounded-full bg-gray-700"></div> Tarjetas (BOLD)
              </li>
              <li className="flex items-center gap-2 transition-colors hover:text-gray-200">
                <div className="w-1.5 h-1.5 rounded-full bg-gray-700"></div> Addi y Nequi
              </li>
            </ul>
            <div className="mt-5 inline-flex w-full justify-center px-3 py-2 bg-orange-500/10 border border-orange-500/20 rounded-lg text-orange-400 text-xs font-semibold">
              Pago contra entrega
            </div>
          </div>

          {/* Métodos de envío */}
          <div className="bg-gray-900/40 p-5 rounded-2xl border border-gray-800/50 backdrop-blur-sm">
            <h3 className="text-white text-sm font-bold mb-4 uppercase tracking-wider flex items-center gap-2">
              <Truck className="w-4 h-4 text-orange-500" />
              Envío
            </h3>
            <ul className="space-y-4 text-sm">
              <li className="flex flex-col gap-1.5">
                <div className="flex items-start justify-between group">
                  <span className="group-hover:text-gray-200 transition-colors font-medium">Domicilio</span>
                  <span className="text-white font-medium bg-gray-800/80 px-2 py-0.5 rounded text-xs border border-gray-700">$10.000</span>
                </div>
              </li>
              <li className="flex flex-col gap-1.5">
                <div className="flex items-start justify-between group">
                  <span className="group-hover:text-gray-200 transition-colors font-medium">Retiro Tienda</span>
                  <span className="text-green-400 font-medium bg-green-500/10 px-2 py-0.5 rounded text-xs border border-green-500/20">Gratis</span>
                </div>
              </li>
            </ul>
            <p className="mt-5 text-xs text-gray-500 leading-relaxed border-l-2 border-orange-500/30 pl-3">
              Disponible en <strong className="text-gray-300">Cartagena</strong> y Turbaco.
            </p>
          </div>

          {/* Contacto */}
          <div className="sm:col-span-2 md:col-span-1">
            <h3 className="text-white text-sm font-bold mb-4 uppercase tracking-wider flex items-center gap-2">
              <Headset className="w-4 h-4 text-orange-500" />
              Contacto
            </h3>
            <ul className="space-y-5 text-sm">
              <li>
                <a href="tel:+573022875280" className="flex items-center gap-3 group">
                  <div className="w-10 h-10 rounded-xl bg-gray-900 border border-gray-800 flex items-center justify-center shrink-0 group-hover:bg-orange-500 group-hover:border-orange-400 transition-all duration-300 shadow-lg">
                    <Phone className="w-4 h-4 text-gray-400 group-hover:text-white transition-colors" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[11px] text-gray-500 uppercase tracking-widest mb-0.5">Línea de Ventas</span>
                    <span className="text-gray-200 font-bold tracking-wide">+57 302 287 5280</span>
                  </div>
                </a>
              </li>
              <li>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gray-900 border border-gray-800 flex items-center justify-center shrink-0">
                    <MapPin className="w-4 h-4 text-gray-400" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[11px] text-gray-500 uppercase tracking-widest mb-0.5">Sede Principal</span>
                    <span className="text-gray-300 text-xs leading-relaxed">Cl. 31 #61-64, Los Ángeles<br/>Cartagena</span>
                  </div>
                </div>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div className="sm:col-span-2 md:col-span-1">
            <h3 className="text-white text-sm font-bold mb-4 uppercase tracking-wider flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-orange-500" />
              Legal
            </h3>
            <div className="bg-gray-900/30 rounded-xl border border-gray-800/30 p-2">
              <ul className="space-y-1 text-sm">
                <li>
                  <a href="#" className="flex items-center justify-between group hover:bg-gray-800/50 p-2 rounded-lg transition-colors">
                    <span className="text-gray-400 group-hover:text-white transition-colors">Privacidad</span>
                    <ExternalLink className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-orange-500" />
                  </a>
                </li>
                <li>
                  <a href="#" className="flex items-center justify-between group hover:bg-gray-800/50 p-2 rounded-lg transition-colors">
                    <span className="text-gray-400 group-hover:text-white transition-colors">Términos</span>
                    <ExternalLink className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-orange-500" />
                  </a>
                </li>
                <li>
                  <a href="#" className="flex items-center justify-between group hover:bg-gray-800/50 p-2 rounded-lg transition-colors">
                    <span className="text-gray-400 group-hover:text-white transition-colors">Garantía</span>
                    <ExternalLink className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-orange-500" />
                  </a>
                </li>
              </ul>
            </div>
          </div>

        </div>

        {/* Separador final */}
        <div className="border-t border-gray-800/60 pt-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="text-xs text-gray-500 font-medium">
            © {new Date().getFullYear()} Xiaomi Cartagena. Todos los derechos reservados.
          </div>
        </div>
      </div>
    </footer>
  );
}
