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
 *
 * Van de más lejano a más cercano porque así se leen en los tests y en los logs.
 * Cambiar esta lista cambia el calendario completo: no hay nada más que tocar.
 *
 * Por qué 7 y 3 y no otros: 7 da tiempo a organizar la plata antes de que la
 * fecha apriete, y 3 cae en fin de semana con la frecuencia suficiente para que
 * quien cobra quincenal alcance a moverse. Juntos con el de la víspera (-1) y el
 * del día (0) suman cuatro toques por cuota, que es el techo de lo tolerable:
 * pasarse de ahí es como el número termina reportado por spam.
 */
export const DIAS_DE_ANTICIPO: readonly number[] = [7, 3];

export type TipoAviso = 'anticipo' | 'previo' | 'hoy' | 'mora' | null;

/**
 * `diasVencido` es la distancia a la fecha límite: negativo = aún no vence
 * (-7 = faltan siete días), 0 = vence hoy, positivo = ya está en mora.
 *
 * Devuelve `null` cuando no toca escribir, que es el caso más común: un cliente
 * cuya cuota vence en 20 días no debe recibir nada.
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
