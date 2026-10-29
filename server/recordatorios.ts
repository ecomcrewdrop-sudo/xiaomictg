/**
 * Cuándo toca escribirle a un cliente por su cuota.
 *
 * Esto vive aparte de `index.ts` por una razón concreta: la decisión de "¿hoy le
 * escribo a esta persona?" se aplica sobre 112 clientes reales y el cron no se
 * puede arrancar en local para probarlo (levantar `index.ts` contra la base de
 * producción dispara los envíos de verdad). Una función pura sí se puede probar
 * sin tocar WhatsApp ni Mongo, y es la única parte donde un error se traduce en
 * mensajes de más a gente real.
 */

/**
 * Días ANTES del vencimiento en los que sale un aviso de cortesía.
 * Lista vacía para no enviar avisos con días de anticipación (solo día previo y día de vencimiento).
 */
export const DIAS_DE_ANTICIPO: readonly number[] = [];

export type TipoAviso = 'anticipo' | 'previo' | 'hoy' | 'mora' | null;

/**
 * `diasVencido` es la distancia a la fecha límite: negativo = aún no vence
 * (-1 = vence mañana), 0 = vence hoy, positivo = ya está en mora.
 *
 * Devuelve `null` cuando no toca escribir. Solo se envía aviso el día previo (-1) y el día de pago (0).
 */
export function tipoDeAviso(diasVencido: number): TipoAviso {
  if (!Number.isFinite(diasVencido)) return null;
  if (diasVencido >= 1) return 'mora';
  if (diasVencido === 0) return 'hoy';
  if (diasVencido === -1) return 'previo';
  if (DIAS_DE_ANTICIPO.includes(-diasVencido)) return 'anticipo';
  return null;
}

/**
 * Cuántos días faltan, para redactar el mensaje. Sólo tiene sentido antes del
 * vencimiento; de ahí en adelante devuelve 0 y el texto lo arma otra rama.
 */
export function diasQueFaltan(diasVencido: number): number {
  return diasVencido < 0 ? -diasVencido : 0;
}
