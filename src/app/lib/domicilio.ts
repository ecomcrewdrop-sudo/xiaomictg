/**
 * Costo del domicilio en Cartagena. ÚNICA fuente de verdad.
 *
 * REGLA (la pidió el dueño, 2026-09-30): el domicilio cuesta $10.000 en todo,
 * MENOS cuando el pedido lleva un celular: ahí sigue siendo gratis.
 *
 * Antes esto era `const DELIVERY_FEE = 0` repetido en los tres checkouts
 * (CartDialog, QuickBuyDialog y DirectCheckoutPage). Al tener que depender del
 * contenido del carrito ya no vale una constante, y tres copias de una regla de
 * precios es como se acaba cobrando distinto según por dónde entró el cliente.
 * Por eso vive aquí y los tres la importan.
 */

/** Lo que se cobra por domicilio cuando NO aplica la exención. */
export const COSTO_DOMICILIO = 10000;

/**
 * Categorías que cuentan como celular.
 *
 * `category` en la base es texto libre y hay variantes históricas con acento y en
 * singular/plural ('moviles', 'móviles', 'telefono'...). Ver `categoryAliases` en
 * CategoryPage.tsx, que arrastra el mismo problema. Normalizamos antes de comparar
 * para que un acento no acabe cobrándole $10.000 a alguien que compró un teléfono.
 *
 * 'poco' está aquí porque esa categoría son los Poco (son celulares); hoy en la
 * tienda son 4 productos, todos teléfonos.
 */
const CATEGORIAS_CELULAR = new Set([
  'moviles',
  'movil',
  'telefono',
  'telefonos',
  'celular',
  'celulares',
  'poco',
]);

/** Quita acentos y espacios para comparar categorías sin sorpresas. */
function normalizar(texto: unknown): string {
  return String(texto ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** ¿Este producto es un celular? */
export function esCelular(producto: { category?: string } | null | undefined): boolean {
  return CATEGORIAS_CELULAR.has(normalizar(producto?.category));
}

/**
 * Costo de domicilio para un pedido.
 *
 * PEDIDOS MIXTOS (celular + accesorio): se cobra GRATIS. El celular es lo que
 * dispara la exención, y cobrarle $10.000 de domicilio a alguien que se lleva un
 * teléfono de un millón y medio porque además metió un forro al carrito es la
 * clase de detalle que tumba la venta en el último paso. Si el dueño lo prefiere
 * al contrario (cobrar salvo que el pedido sea SOLO celulares), es cambiar el
 * `some` por un `every` aquí abajo y nada más.
 */
export function calcularDomicilio(
  productos: Array<{ category?: string } | null | undefined>,
  metodoEntrega: 'delivery' | 'pickup'
): number {
  if (metodoEntrega !== 'delivery') return 0;
  if (productos.some(esCelular)) return 0;
  return COSTO_DOMICILIO;
}

/** Texto para los selectores de entrega: 'GRATIS' o '$10.000'. */
export function etiquetaDomicilio(costo: number): string {
  return costo === 0 ? 'GRATIS' : `$${costo.toLocaleString('es-CO')}`;
}
