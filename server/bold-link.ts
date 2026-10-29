/**
 * Cliente de la API de Bold: crear links de pago y consultar transacciones.
 *
 * Existe por dos motivos concretos, los dos aprendidos a golpes:
 *
 * 1. El botón embebido (`boldPaymentButton.js`) NO permite elegir qué métodos de
 *    pago se muestran. Sólo la API de Link de Pagos acepta `payment_methods`.
 *    Para cobrar cuotas necesitamos excluir la tarjeta: un contracargo llega
 *    meses después, y para entonces el equipo ya se desbloqueó solo. PSE, Nequi
 *    y el botón de Bancolombia son transferencias y no se pueden reversar.
 *
 * 2. El webhook es un único aviso HTTP. Si no llega, el cliente pagó y el equipo
 *    sigue bloqueado. `consultarTransaccion` permite preguntar activamente, que
 *    es lo que convierte el webhook en un atajo en vez de en el único camino.
 *
 * Todo el acceso a la red entra por `fetchImpl` para que los tests no toquen
 * internet. Las URLs y cabeceras de aquí están verificadas contra la API real.
 */

/* ═══════════════════════════════  Configuración  ═══════════════════════════ */

export const BOLD_API_LINKS = 'https://integrations.api.bold.co';
export const BOLD_API_PAGOS = 'https://payments.api.bold.co';

/**
 * Los únicos métodos que aceptamos para cobrar una cuota.
 *
 * No está la tarjeta, y es a propósito: ver el motivo 1 de la cabecera. Si algún
 * día se quiere volver a aceptar, el valor es `CREDIT_CARD` — pero piénsalo dos
 * veces, porque el desbloqueo es automático e irreversible desde el lado de la
 * tienda, y el contracargo no lo es desde el lado del banco.
 */
export const METODOS_CUOTA = ['PSE', 'NEQUI', 'BOTON_BANCOLOMBIA'] as const;

export type MetodoBold = (typeof METODOS_CUOTA)[number] | 'CREDIT_CARD';

export interface ConfigBold {
  apiKey: string;
  /** Inyectable para los tests. Por defecto, el `fetch` global de Node. */
  fetchImpl?: typeof fetch;
  /** Milisegundos antes de rendirse. Bold responde en ~300ms; 15s es de sobra. */
  timeoutMs?: number;
}

function clienteHttp(cfg: ConfigBold): typeof fetch {
  return cfg.fetchImpl ?? (globalThis.fetch as typeof fetch);
}

/**
 * Lanza la petición con un tope de tiempo propio.
 *
 * Sin esto, una llamada colgada deja al conciliador parado para siempre: corre
 * dentro de un cron, y un cron que no termina no vuelve a arrancar.
 */
async function pedir(
  cfg: ConfigBold,
  url: string,
  init: RequestInit
): Promise<{ status: number; cuerpo: any }> {
  const fetchFn = clienteHttp(cfg);
  if (typeof fetchFn !== 'function') {
    throw new Error('No hay fetch disponible en este entorno.');
  }

  const control = new AbortController();
  const corte = setTimeout(() => control.abort(), cfg.timeoutMs ?? 15000);
  try {
    const r = await fetchFn(url, { ...init, signal: control.signal });
    const texto = await r.text();
    let cuerpo: any = null;
    try {
      cuerpo = texto ? JSON.parse(texto) : null;
    } catch {
      // Bold siempre responde JSON. Si llega otra cosa es un error de
      // infraestructura (un proxy, un 502 en HTML), y el texto crudo es más
      // útil en el log que un "undefined".
      cuerpo = { _crudo: texto.slice(0, 500) };
    }
    return { status: r.status, cuerpo };
  } finally {
    clearTimeout(corte);
  }
}

function cabeceras(cfg: ConfigBold): Record<string, string> {
  return {
    Authorization: `x-api-key ${cfg.apiKey}`,
    'Content-Type': 'application/json',
  };
}

/** El primer mensaje de error que traiga la respuesta, si trae alguno. */
function primerError(cuerpo: any): string {
  const lista = cuerpo?.errors;
  if (Array.isArray(lista) && lista.length) {
    const m = lista[0]?.message ?? lista[0];
    return typeof m === 'string' ? m : JSON.stringify(m);
  }
  return '';
}

/* ═══════════════════════════  Crear link de pago  ═══════════════════════════ */

export interface OpcionesLink {
  /** Nuestra referencia. Para cuotas es la `CL-…`; es la que vuelve en el webhook. */
  referencia: string;
  montoCOP: number;
  descripcion: string;
  /** A dónde vuelve el cliente al terminar. */
  callbackUrl?: string;
  /** Cuánto vale el link. Por defecto 48h: lo que dura un recordatorio. */
  validoHoras?: number;
  /** Por defecto, `METODOS_CUOTA` (sin tarjeta). */
  metodos?: readonly MetodoBold[];
}

export interface LinkDePago {
  id: string;
  url: string;
  /** ISO. Guardado para poder decir "tu link vence a las…" sin recalcular. */
  venceEn: string;
}

/**
 * Bold espera el vencimiento en NANOsegundos desde epoch, no en milisegundos.
 *
 * Es un detalle fácil de pasar por alto y falla en silencio: con milisegundos el
 * link nace vencido en 1970 y Bold lo rechaza sin explicar por qué.
 */
export function aNanosegundos(fecha: Date): number {
  return Math.round(fecha.getTime()) * 1_000_000;
}

export async function crearLinkDePago(
  cfg: ConfigBold,
  o: OpcionesLink
): Promise<LinkDePago> {
  const monto = Math.round(Number(o.montoCOP));
  if (!Number.isFinite(monto) || monto <= 0) {
    throw new Error(`Monto inválido para el link de pago: ${o.montoCOP}`);
  }

  const horas = o.validoHoras && o.validoHoras > 0 ? o.validoHoras : 48;
  const vence = new Date(Date.now() + horas * 3600_000);

  const cuerpoPeticion = {
    amount_type: 'CLOSE',
    amount: { currency: 'COP', total_amount: monto },
    reference: o.referencia,
    description: o.descripcion.slice(0, 100),
    payment_methods: [...(o.metodos ?? METODOS_CUOTA)],
    expiration_date: aNanosegundos(vence),
    ...(o.callbackUrl ? { callback_url: o.callbackUrl } : {}),
  };

  const { status, cuerpo } = await pedir(cfg, `${BOLD_API_LINKS}/online/link/v1`, {
    method: 'POST',
    headers: cabeceras(cfg),
    body: JSON.stringify(cuerpoPeticion),
  });

  const url = cuerpo?.payload?.url;
  const id = cuerpo?.payload?.payment_link;
  if (status !== 200 || !url || !id) {
    const detalle = primerError(cuerpo) || `HTTP ${status}`;
    throw new Error(`Bold no creó el link de pago: ${detalle}`);
  }

  return { id: String(id), url: String(url), venceEn: vence.toISOString() };
}

/* ══════════════════════════  Consultar transacción  ════════════════════════ */

/**
 * Lo que sabemos de una referencia, ya traducido a decisiones.
 *
 * `sin_datos` NO es "no pagó". Bold sólo conserva la transacción 24 horas, así
 * que una referencia vieja responde igual que una que nunca se intentó. El
 * conciliador tiene que tratarlo como "no sé", nunca como un rechazo: dar por
 * impagada una cuota que sí se pagó es el peor error posible aquí.
 */
export type EstadoPago =
  | 'aprobada'
  | 'rechazada'
  | 'en_proceso'
  | 'sin_datos'
  | 'error';

export interface TransaccionBold {
  estado: EstadoPago;
  /** Identificador de Bold, para dejarlo guardado junto al pago. */
  paymentId?: string;
  metodo?: string;
  total?: number;
  /** Lo que respondió Bold, tal cual, para el log cuando algo no cuadra. */
  crudo?: unknown;
}

/** Traducción de los estados de Bold a los nuestros. */
function traducirEstado(valor: unknown): EstadoPago {
  const s = String(valor ?? '').trim().toUpperCase();
  if (s === 'APPROVED') return 'aprobada';
  if (s === 'REJECTED' || s === 'FAILED' || s === 'VOIDED') return 'rechazada';
  if (s === 'PROCESSING' || s === 'PENDING') return 'en_proceso';
  if (s === 'NO_TRANSACTION_FOUND') return 'sin_datos';
  return 'error';
}

/**
 * Pregunta por una referencia.
 *
 * Verificado contra la API real: una referencia desconocida responde HTTP 404
 * con "La referencia … no fue encontrada". Eso es `sin_datos`, no un fallo.
 */
export async function consultarTransaccion(
  cfg: ConfigBold,
  referencia: string
): Promise<TransaccionBold> {
  const ref = String(referencia || '').trim();
  if (!ref) return { estado: 'error' };

  let status: number;
  let cuerpo: any;
  try {
    ({ status, cuerpo } = await pedir(
      cfg,
      `${BOLD_API_PAGOS}/v2/payment-voucher/${encodeURIComponent(ref)}`,
      { method: 'GET', headers: cabeceras(cfg) }
    ));
  } catch (err) {
    // Red caída o timeout. No es información sobre el pago: que el conciliador
    // lo vuelva a intentar en la siguiente vuelta.
    return { estado: 'error', crudo: String((err as Error)?.message || err) };
  }

  if (status === 404) return { estado: 'sin_datos', crudo: cuerpo };
  if (status !== 200) return { estado: 'error', crudo: cuerpo };

  const p = cuerpo?.payload ?? cuerpo;
  return {
    estado: traducirEstado(p?.payment_status),
    paymentId: p?.transaction_id ? String(p.transaction_id) : undefined,
    metodo: p?.payment_method ? String(p.payment_method) : undefined,
    total: Number.isFinite(Number(p?.total)) ? Number(p.total) : undefined,
    crudo: cuerpo,
  };
}

/**
 * ¿Puedo dar este pago por bueno?
 *
 * Aparte del estado se compara el importe. Sin esta comprobación, una referencia
 * pagada por un importe distinto al que guardamos marcaría la cuota y
 * desbloquearía el equipo igual. Bold no debería permitirlo con `amount_type:
 * CLOSE`, pero el desbloqueo es irreversible y la comprobación cuesta una resta.
 *
 * Si Bold no devuelve el total, se acepta el estado: es un dato que falta, no
 * un dato que contradice.
 */
export function pagoConfirmado(t: TransaccionBold, montoEsperado: number): boolean {
  if (t.estado !== 'aprobada') return false;
  if (t.total === undefined) return true;
  return Math.round(t.total) === Math.round(montoEsperado);
}
