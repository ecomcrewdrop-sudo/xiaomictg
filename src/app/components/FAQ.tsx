import { useState } from 'react';
import { Plus, Minus } from 'lucide-react';

const faqs = [
  {
    q: '¿Los productos que venden son 100% originales?',
    a: 'Sí. Todos nuestros productos son completamente originales, sellados de fábrica y provienen de distribuidores oficiales Xiaomi. Nunca vendemos réplicas ni productos de segunda mano. Puedes verificar la autenticidad escaneando el código QR incluido en la caja.'
  },
  {
    q: '¿Cómo funciona el pago contra entrega?',
    a: 'Es muy sencillo: realizas tu pedido en la web o por WhatsApp, nuestro domiciliario te lleva el equipo a tu dirección y tú pagas en el momento de recibirlo — en efectivo, Nequi, transferencia o con tarjeta. No necesitas pagar nada por adelantado.'
  },
  {
    q: '¿Cuánto tiempo tarda el domicilio en Cartagena?',
    a: 'Normalmente entre 30 minutos y 1 hora dentro de Cartagena. El costo del domicilio es de $10.000 COP para cualquier dirección en la ciudad. Si prefieres, también puedes recoger el pedido gratis en nuestra tienda (Cl. 31 #61-64, Los Ángeles).'
  },
  {
    q: '¿Hacen envíos fuera de Cartagena?',
    a: 'Por el momento solo hacemos domicilios en Cartagena y Turbaco. Para otras ciudades, puedes recoger en tienda o consultarnos por WhatsApp para coordinar el envío por empresa de mensajería.'
  },
  {
    q: '¿Qué garantía tienen los productos?',
    a: 'Todos los productos cuentan con garantía oficial de 12 meses contra defectos de fábrica. Si tu equipo presenta algún problema durante ese período, lo gestionamos directamente con el servicio técnico autorizado Xiaomi sin costo adicional para ti.'
  },
  {
    q: '¿Qué pasa si el producto llega dañado o con fallas?',
    a: 'Si al recibir el equipo notas algún daño físico o falla de fábrica, tienes hasta 24 horas para reportarlo por WhatsApp al +57 302 287 5280 con fotos o video. Hacemos el cambio o devolución sin preguntas. Tu tranquilidad es nuestra prioridad.'
  },
  {
    q: '¿Puedo pagar con tarjeta de crédito o débito?',
    a: 'Sí. Aceptamos tarjetas débito y crédito a través de nuestra pasarela segura BOLD (sin necesidad de efectivo). También aceptamos Nequi, Llave bre-b, transferencia bancaria y efectivo.'
  },
  {
    q: '¿Tienen tienda física donde puedo ver los productos?',
    a: 'Sí, estamos ubicados en la Cl. 31 #61-64, barrio Los Ángeles, Cartagena de Indias. Atendemos de lunes a viernes de 9:00 AM a 6:00 PM. Puedes venir a ver los equipos y hacer tu compra directamente en tienda.'
  },
];

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggle = (i: number) => setOpenIndex(openIndex === i ? null : i);

  return (
    <section className="bg-gray-950 py-14 md:py-20">
      <div className="container mx-auto px-4 max-w-3xl">

        {/* Encabezado */}
        <div className="text-center mb-10 md:mb-14">
          <span className="text-xs font-medium uppercase tracking-[0.25em] text-orange-500 mb-3 block">
            Resolvemos tus dudas
          </span>
          <h2 className="text-2xl md:text-4xl font-light text-white">
            Preguntas Frecuentes
          </h2>
        </div>

        {/* Acordeón */}
        <div className="divide-y divide-gray-800">
          {faqs.map((item, i) => {
            const isOpen = openIndex === i;
            return (
              <div key={i}>
                <button
                  onClick={() => toggle(i)}
                  className="w-full flex items-start justify-between gap-4 py-5 text-left group"
                  aria-expanded={isOpen}
                >
                  <span className={`text-sm md:text-base font-medium transition-colors duration-200 ${
                    isOpen ? 'text-orange-400' : 'text-gray-200 group-hover:text-orange-400'
                  }`}>
                    {item.q}
                  </span>
                  <span className={`flex-shrink-0 w-6 h-6 rounded-full border flex items-center justify-center transition-all duration-200 mt-0.5 ${
                    isOpen
                      ? 'border-orange-500 bg-orange-500 text-white'
                      : 'border-gray-600 text-gray-400 group-hover:border-orange-500 group-hover:text-orange-400'
                  }`}>
                    {isOpen
                      ? <Minus className="w-3 h-3" />
                      : <Plus className="w-3 h-3" />
                    }
                  </span>
                </button>

                {/* Respuesta con animación */}
                <div className={`overflow-hidden transition-all duration-300 ease-in-out ${
                  isOpen ? 'max-h-64 opacity-100' : 'max-h-0 opacity-0'
                }`}>
                  <p className="pb-5 text-sm md:text-base text-gray-400 font-light leading-relaxed">
                    {item.a}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* CTA inferior */}
        <div className="mt-10 text-center">
          <p className="text-sm text-gray-500 mb-4">
            ¿Tienes otra pregunta? Escríbenos directamente.
          </p>
          <a
            href="https://wa.me/573022875280?text=Hola%2C%20tengo%20una%20pregunta%20sobre%20un%20producto"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium px-6 py-3 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            Preguntar por WhatsApp
          </a>
        </div>

      </div>
    </section>
  );
}
