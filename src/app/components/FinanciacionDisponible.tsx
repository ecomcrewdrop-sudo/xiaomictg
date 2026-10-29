import { useState, type ReactNode } from 'react';

/**
 * Bloque informativo de aliados de financiación.
 *
 * OJO: esto NO es un método de pago del checkout. Solo comunica al cliente que puede
 * financiar la compra con estos aliados; el trámite se hace por fuera (en tienda o
 * directamente con el aliado). Addi se eliminó como método de pago del carrito.
 *
 * LOGOS: son los oficiales que entregó el dueño, ya recortados y optimizados en
 * public/logos/*.png. Si alguno faltara, la tarjeta cae a un wordmark de texto con
 * los colores de marca, así que nunca se ve una imagen rota.
 *
 * POR QUÉ CADA LOGO LLEVA SU PROPIA ALTURA: las proporciones son muy distintas
 * (Sistecrédito 8,1:1 · Addi 2,7:1 · Brilla 3,1:1). Con una altura común, Sistecrédito
 * se veía tres veces más pequeño que los otros dos. Las alturas de abajo están
 * ajustadas a ojo para que los tres pesen visualmente lo mismo. Si cambias un
 * archivo de logo, revisa también su altura aquí.
 */

interface Aliado {
  nombre: string;
  src: string;
  alt: string;
  /** Clases de alto (móvil / sm+), afinadas por marca. Ver comentario de arriba. */
  alto: string;
  /** Wordmark de respaldo si el archivo del logo no carga. */
  respaldo: ReactNode;
}

// Colores tomados directamente de los logos oficiales.
const AZUL_SISTECREDITO = '#01369C';
const VERDE_SISTECREDITO = '#43D12F';
const AZUL_ADDI = '#5780F7';
const ROJO_BRILLA = '#E10C2E';

const ALIADOS: Aliado[] = [
  {
    nombre: 'Sistecrédito',
    src: '/logos/sistecredito.png',
    alt: 'Logo de Sistecrédito',
    alto: 'h-3.5 sm:h-5',
    respaldo: (
      <span className="font-black text-sm sm:text-base tracking-tight leading-none">
        <span style={{ color: AZUL_SISTECREDITO }}>siste</span>
        <span style={{ color: VERDE_SISTECREDITO }}>crédito</span>
      </span>
    ),
  },
  {
    nombre: 'Addi',
    src: '/logos/addi.png',
    alt: 'Logo de Addi',
    alto: 'h-5 sm:h-7',
    respaldo: (
      <span
        className="font-black text-base sm:text-lg tracking-tight leading-none"
        style={{ color: AZUL_ADDI }}
      >
        Addi
      </span>
    ),
  },
  {
    nombre: 'Cupo Brilla',
    src: '/logos/brilla.png',
    alt: 'Logo de Cupo Brilla',
    alto: 'h-5 sm:h-7',
    respaldo: (
      <span
        className="font-black text-base sm:text-lg tracking-tight leading-none"
        style={{ color: ROJO_BRILLA }}
      >
        Brilla
      </span>
    ),
  },
];

function LogoAliado({ aliado }: { aliado: Aliado }) {
  const [falloImagen, setFalloImagen] = useState(false);

  if (falloImagen) return <>{aliado.respaldo}</>;

  return (
    <img
      src={aliado.src}
      alt={aliado.alt}
      title={aliado.nombre}
      loading="lazy"
      className={`${aliado.alto} w-auto max-w-full object-contain`}
      onError={() => setFalloImagen(true)}
    />
  );
}

export function FinanciacionDisponible({ className = '' }: { className?: string }) {
  return (
    <div className={`bg-gray-50 border border-gray-200 rounded-2xl p-4 ${className}`}>
      <p className="text-sm font-semibold text-gray-800 mb-1">Financiación disponible con</p>
      <p className="text-xs text-gray-500 mb-3">
        Aprobación sujeta a estudio de crédito del aliado. Consúltanos y te asesoramos.
      </p>
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm px-4 py-3 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 sm:gap-x-9">
        {ALIADOS.map(aliado => (
          <LogoAliado key={aliado.nombre} aliado={aliado} />
        ))}
      </div>
    </div>
  );
}
