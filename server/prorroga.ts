/**
 * PRÓRROGAS — plazo extra sobre una cuota, sin tocar el contrato.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * El cliente llama el día que le toca y pide unos días. Antes eso no se podía
 * registrar en ningún sitio: el dueño tenía dos salidas, o le movía la fecha de
 * la cuota (y perdía para siempre cuál era la fecha pactada) o se acordaba de
 * memoria de no bloquearle el teléfono. Con 113 clientes, la memoria falla y el
 * automatismo bloquea.
 *
 * La prórroga NO modifica `dueDate`. Se guarda al lado, y la fecha que manda
 * para decidir mora, bloqueos y recordatorios es la que devuelve `fechaLimite`.
 * Así queda constancia de las dos cosas: lo que se pactó y el plazo que se dio.
 *
 * Este módulo vive aparte a propósito. `server/index.ts` ya importa de
 * `server/blocking.ts`, así que si la fecha efectiva se definiera en cualquiera
 * de los dos tendríamos que importarla en círculo o —peor— duplicarla. Una
 * cuota con dos definiciones de "¿está vencida?" es exactamente la clase de bug
 * que deja a un cliente con el teléfono bloqueado mientras el panel lo muestra
 * en verde.
 */

export interface Prorroga {
  /** Nueva fecha límite, `YYYY-MM-DD`. Es un día del calendario, no un instante. */
  hasta: string;
  /** ISO del momento en que se concedió. */
  otorgadaEn: string;
  otorgadaPor: string;
  /** Lo que dijo el cliente. Opcional, pero es lo que hace útil el historial. */
  motivo?: string;
  /**
   * La fecha que tenía la cuota cuando se concedió. Redundante con `dueDate`
   * mientras nadie lo toque, y justamente por eso se guarda: si algún día se
   * regeneran las cuotas, esta copia es la única prueba de sobre qué fecha se
   * dio el plazo.
   */
  fechaOriginal: string;
}

/** Cualquier cosa con fecha de vencimiento y, quizá, una prórroga encima. */
export interface CuotaConPlazo {
  dueDate: unknown;
  prorroga?: Prorroga | null;
}

/**
 * Normaliza a `YYYY-MM-DD`. Devuelve '' si no hay forma de leer la fecha.
 *
 * Se lee la parte UTC, NO se convierte a la zona de Colombia.
 * `generateInstallments` genera las cuotas con `setUTCDate` + `toISOString`, así
 * que cada una es medianoche UTC y su día correcto es el que trae la propia
 * cadena. Pasarlas por America/Bogota (UTC-5) las corría un día hacia atrás:
 * una cuota que vencía hoy aparecía con un día de mora y el equipo se bloqueaba
 * el mismo día del vencimiento, antes de que el cliente llegara a pagar.
 */
export function soloFecha(valor: unknown): string {
  const texto = String(valor ?? '');
  if (/^\d{4}-\d{2}-\d{2}/.test(texto)) return texto.slice(0, 10);
  const d = new Date(texto);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/**
 * La fecha que de verdad manda sobre esta cuota.
 *
 * Ojo con lo que NO hace: no comprueba si la prórroga ya se venció. Es
 * deliberado. Si se dio plazo hasta el 20 y hoy es 25, la mora tiene que
 * contar 5 días desde el 20, no 15 desde la fecha original. Contarla desde el
 * contrato convertiría la prórroga en una trampa: al vencerse, el cliente
 * aparecería de golpe con más mora que días de gracia y el automatismo le
 * bloquearía el teléfono en el mismo minuto, sin el aviso que sí recibe
 * cualquier otro.
 */
export function fechaLimite(cuota: CuotaConPlazo | null | undefined): string {
  if (!cuota) return '';
  const prorrogada = soloFecha(cuota.prorroga?.hasta);
  return prorrogada || soloFecha(cuota.dueDate);
}

/** ¿Se le movió la fecha a esta cuota? (Sin mirar si el plazo sigue abierto.) */
export function tieneProrroga(cuota: CuotaConPlazo | null | undefined): boolean {
  return Boolean(cuota?.prorroga?.hasta);
}

/**
 * La prórroga sólo si el plazo sigue abierto (`hasta` es hoy o más adelante).
 *
 * Esto es para lo que se le MUESTRA y se le DICE al cliente: "tienes plazo
 * hasta el 20". Pasado el 20 deja de estar vigente y el cliente vuelve a verse
 * en mora, aunque la mora se siga contando desde el 20 (ver `fechaLimite`).
 * Son dos preguntas distintas y por eso son dos funciones distintas.
 */
export function prorrogaVigente(
  cuota: CuotaConPlazo | null | undefined,
  hoy: string
): Prorroga | null {
  const p = cuota?.prorroga;
  if (!p?.hasta) return null;
  const hasta = soloFecha(p.hasta);
  if (!hasta || !hoy) return null;
  return hasta >= hoy ? p : null;
}

/**
 * La fecha como se la escribimos al cliente: "miércoles, 21 de octubre de 2026".
 *
 * `timeZone: 'UTC'` y no 'America/Bogota', aunque el cliente esté en Cartagena.
 * `new Date('2026-10-21')` es medianoche UTC, y pintarla en UTC-5 la corre al
 * día anterior: le prometeríamos por WhatsApp un plazo un día más corto que el
 * que respeta el automatismo. Es el mismo tropiezo que documenta `soloFecha`.
 */
export function fechaLarga(fecha: string): string {
  const d = new Date(`${soloFecha(fecha)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(fecha);
  return d.toLocaleDateString('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Días completos entre dos `YYYY-MM-DD`. Negativo si `hasta` es anterior. */
export function diasEntreFechas(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T00:00:00Z`);
  const b = Date.parse(`${hasta}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return Math.round((b - a) / 86400000);
}

/**
 * Tope de plazo. No es una regla contable, es un freno contra el dedo gordo:
 * teclear 2027 en vez de 2026 en el calendario dejaría a un cliente un año sin
 * que el automatismo lo mire, y nadie se daría cuenta hasta que la cuota se
 * perdiera del todo.
 */
export const MAX_DIAS_PRORROGA = 60;

export interface ProrrogaRechazada {
  error: string;
}

/**
 * Valida una prórroga antes de guardarla. Devuelve la fecha normalizada o el
 * motivo del rechazo, en el texto que va a leer el dueño en pantalla.
 */
export function validarProrroga(
  hastaCrudo: unknown,
  cuota: { dueDate: unknown; status?: string },
  hoy: string
): { hasta: string } | ProrrogaRechazada {
  const hasta = soloFecha(hastaCrudo);
  if (!hasta) {
    return { error: 'La fecha de la prórroga no es válida.' };
  }
  if (cuota.status === 'paid') {
    return { error: 'Esta cuota ya está pagada; no necesita prórroga.' };
  }

  // Una prórroga "hasta ayer" no da plazo a nada: el cliente seguiría en mora y
  // el automatismo lo bloquearía igual, pero el panel diría que tiene plazo.
  if (hasta < hoy) {
    return { error: 'La prórroga tiene que ser para hoy o más adelante.' };
  }

  // Adelantar el cobro no es una prórroga. Si la intención es cambiar la fecha
  // pactada, eso se hace editando el financiamiento, no desde aquí.
  const original = soloFecha(cuota.dueDate);
  if (original && hasta < original) {
    return {
      error: `La cuota vence el ${original}. Una prórroga sólo puede dar más plazo, no adelantarlo.`,
    };
  }

  const dias = diasEntreFechas(hoy, hasta);
  if (!Number.isNaN(dias) && dias > MAX_DIAS_PRORROGA) {
    return {
      error: `Son ${dias} días de plazo. El máximo es ${MAX_DIAS_PRORROGA}; revisa el año en la fecha.`,
    };
  }

  return { hasta };
}
