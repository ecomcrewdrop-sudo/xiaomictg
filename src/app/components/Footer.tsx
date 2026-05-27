const KeyLabel = ({ children }: { children: React.ReactNode }) => (
  <span
    style={{
      display: 'inline-block',
      color: '#ffffff',
      background: '#000000',
      border: '1px solid rgba(255,255,255,0.25)',
      fontWeight: 700,
      fontSize: '0.65rem',
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      padding: '2px 7px',
      lineHeight: 1.5,
    }}
  >
    {children}
  </span>
);

export function Footer() {
  return (
    <footer className="bg-black text-gray-400">
      <div className="container mx-auto px-4 py-12">

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-10">

          {/* Formas de pago */}
          <div>
            <h3 className="text-white text-xs font-semibold mb-4 uppercase tracking-widest">Formas de pago</h3>
            <ul className="space-y-2 text-xs">
              <li>Transferencia bancaria</li>
              <li>Efectivo</li>
              <li><KeyLabel>Tarjetas débito y crédito</KeyLabel> — vía BOLD</li>
              <li>Nequi · Llave bre-b</li>
              <li className="text-orange-400 font-semibold pt-1">Pago contra entrega disponible</li>
            </ul>
          </div>

          {/* Métodos de envío */}
          <div>
            <h3 className="text-white text-xs font-semibold mb-4 uppercase tracking-widest">Métodos de envío</h3>
            <ul className="space-y-2 text-xs">
              <li>
                Domicilio — <KeyLabel>$10.000 COP</KeyLabel> · cualquier dirección en Cartagena
              </li>
              <li>
                Retiro en tienda — <KeyLabel>Gratis</KeyLabel>
              </li>
              <li className="pt-1 text-gray-500 leading-relaxed">
                Realiza el pedido y pagas cuando recibas el equipo.<br />
                Disponible en <strong className="text-gray-400">Cartagena</strong> y Turbaco.
              </li>
            </ul>
          </div>

          {/* Contacto */}
          <div>
            <h3 className="text-white text-xs font-semibold mb-4 uppercase tracking-widest">Contacto</h3>
            <ul className="space-y-2 text-xs">
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
              <li className="pt-1 text-gray-500 leading-relaxed">
                Cl. 31 #61-64, Los Ángeles<br />
                Cartagena de Indias, Bolívar
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h3 className="text-white text-xs font-semibold mb-4 uppercase tracking-widest">Legal</h3>
            <ul className="space-y-2 text-xs">
              <li><a href="#" className="hover:text-white transition-colors">Política de privacidad</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Términos y condiciones</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Garantía de compra</a></li>
            </ul>
          </div>
        </div>

        {/* Mapa */}
        <div className="mb-10">
          <h3 className="text-white text-xs font-semibold mb-4 uppercase tracking-widest">Ubicación</h3>
          <div className="w-full h-56 md:h-72 overflow-hidden border border-gray-800">
            <iframe
              src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d981.7586736642847!2d-75.52847983047!3d10.414282899125!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x8ef625f0b6b18e17%3A0x3f0d6c3e8b8d9e8f!2sCl.%2031%20%2361-64%2C%20Cartagena%20de%20Indias%2C%20Provincia%20de%20Cartagena%2C%20Bol%C3%ADvar!5e0!3m2!1ses!2sco!4v1639000000000!5m2!1ses!2sco"
              width="100%"
              height="100%"
              style={{ border: 0 }}
              allowFullScreen
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              title="Ubicación Xiaomi Cartagena"
            />
          </div>
        </div>

        <div className="border-t border-gray-800 pt-6 text-center text-xs text-gray-600">
          © 2026 Xiaomi Cartagena. Todos los derechos reservados.
        </div>

      </div>
    </footer>
  );
}
