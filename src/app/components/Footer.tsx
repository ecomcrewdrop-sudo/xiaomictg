export function Footer() {
  return (
    <footer className="bg-black text-gray-400 border-t border-gray-900">
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-10">
          {/* Formas de pago */}
          <div>
            <h3 className="text-white text-xs font-semibold mb-4 uppercase tracking-widest">Formas de pago</h3>
            <ul className="space-y-2 text-sm">
              <li>Transferencia bancaria</li>
              <li>Efectivo</li>
              <li>Tarjetas débito y crédito — vía BOLD</li>
              <li>Nequi · Llave bre-b</li>
              <li className="text-orange-400 font-semibold pt-1">Pago contra entrega disponible</li>
            </ul>
          </div>

          {/* Métodos de envío */}
          <div>
            <h3 className="text-white text-xs font-semibold mb-4 uppercase tracking-widest">Métodos de envío</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <span className="text-white font-medium">Domicilio</span> — $10.000 COP
              </li>
              <li>
                <span className="text-white font-medium">Retiro en tienda</span> — Gratis
              </li>
              <li className="pt-2 text-gray-500 text-xs leading-relaxed">
                Realiza el pedido y pagas cuando recibas el equipo.<br />
                Disponible en <strong className="text-gray-400">Cartagena</strong> y Turbaco.
              </li>
            </ul>
          </div>

          {/* Contacto */}
          <div>
            <h3 className="text-white text-xs font-semibold mb-4 uppercase tracking-widest">Contacto</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <a href="mailto:xiaomi.cartagenaventas@gmail.com" className="hover:text-white transition-colors">
                  xiaomi.cartagenaventas@gmail.com
                </a>
              </li>
              <li>
                <a href="tel:+573022875280" className="hover:text-white transition-colors font-semibold text-white">
                  +57 302 287 5280
                </a>
              </li>
              <li className="pt-2 text-gray-500 text-xs leading-relaxed">
                Cl. 31 #61-64, Los Ángeles<br />
                Cartagena de Indias, Bolívar
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h3 className="text-white text-xs font-semibold mb-4 uppercase tracking-widest">Legal</h3>
            <ul className="space-y-2 text-sm">
              <li><a href="#" className="hover:text-white transition-colors">Política de privacidad</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Términos y condiciones</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Garantía de compra</a></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-gray-800 pt-6 text-center text-xs text-gray-600">
          © {new Date().getFullYear()} Xiaomi Cartagena. Todos los derechos reservados.
        </div>
      </div>
    </footer>
  );
}
