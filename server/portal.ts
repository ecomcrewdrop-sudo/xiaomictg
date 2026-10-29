/**
 * PORTAL DEL CLIENTE — lo suyo, y nada más que lo suyo.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Hoy el cliente no tiene forma de ver su propia cuenta. Para saber cuánto debe,
 * cuándo le toca o si le registraron el pago que hizo el sábado tiene que
 * escribir a la tienda, y alguien tiene que parar lo que esté haciendo, buscarlo
 * en el panel y contestar. Con 112 contratos eso es la mayor parte del trabajo
 * de cobranza, y es trabajo que no decide nada.
 *
 * Este módulo es la parte que se puede probar sin servidor ni base de datos: el
 * token que identifica al cliente y el resumen que se le muestra. Las rutas
 * están en `portal-rutas.ts` y la página en `portal-page.ts`.
 *
 *
 * EL TOKEN
 * ────────
 * Es `<id del financiamiento>.<firma HMAC>`. No se guarda en ninguna parte: se
 * recalcula, y por eso el link de un cliente es siempre el mismo y se puede
 * volver a mandar en cada recordatorio sin tener que leer nada antes. Un volcado
 * de la base de datos no entrega los links, porque la firma necesita el secreto,
 * que vive fuera de la colección.
 *
 * Lleva dentro una `version` que sale del propio registro (`portalVersion`).
 * Subirla invalida el link anterior de ESE cliente sin tocar a los otros 111,
 * que es lo que hace falta cuando alguien reenvía su link a quien no debe.
 *
 * Lo que el token NO es: una sesión de administrador. Da acceso de lectura a una
 * sola ficha y a tres acciones sobre ella (pagar, subir comprobante, pedir
 * plazo). Por eso el resumen de aquí abajo se construye campo a campo en vez de
 * devolver el documento de Mongo: el registro trae la cédula del cliente, el
 * IMEI completo, el costo al que la tienda compró el equipo y su margen, y nada
 * de eso tiene por qué viajar a un navegador.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import {
  MAX_DIAS_PRORROGA,
  diasEntreFechas,
  fechaLarga,
  fechaLimite,
  prorrogaVigente,
  soloFecha,
  tieneProrroga,
} from './prorroga';

/* ══════════════════════════  Token  ══════════════════════════ */

/**
 * Largo de la firma en el link. 24 caracteres base64url son 144 bits: de sobra
 * para que no se pueda adivinar, y corto para que el link quepa en un WhatsApp
 * sin convertirse en un muro de letras que el cliente no se atreve a tocar.
 */
const LARGO_FIRMA = 24;

/**
 * Los ids de financiamiento son marcas de tiempo (`1791322553685`), pero esto no
 * se fía: el id entra en una URL y sale en la consulta a Mongo, así que lo que no
 * sea un identificador limpio se rechaza antes de llegar a cualquiera de los dos.
 */
const ID_VALIDO = /^[A-Za-z0-9_-]{1,64}$/;

function base64url(valor: Buffer): string {
  return valor.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function firmaPortal(secreto: string, financingId: string, version: number): string {
  const mensaje = `portal:${financingId}:${Number(version) || 0}`;
  return base64url(createHmac('sha256', secreto).update(mensaje).digest()).slice(0, LARGO_FIRMA);
}

/** El token que va en el link. `null` si el id no sirve para formar uno. */
export function tokenPortal(secreto: string, financingId: unknown, version: unknown = 0): string | null {
  const id = String(financingId ?? '');
  if (!secreto || !ID_VALIDO.test(id)) return null;
  return `${id}.${firmaPortal(secreto, id, Number(version) || 0)}`;
}

/** Parte el token sin validar nada. El id sirve para ir a buscar el registro. */
export function leerTokenPortal(token: unknown): { id: string; firma: string } | null {
  const texto = String(token ?? '');
  const punto = texto.lastIndexOf('.');
  if (punto <= 0) return null;
  const id = texto.slice(0, punto);
  const firma = texto.slice(punto + 1);
  if (!ID_VALIDO.test(id) || !firma) return null;
  return { id, firma };
}

/**
 * ¿La firma es la que corresponde a este registro?
 *
 * Comparación en tiempo constante, igual que en los tokens de administrador. No
 * es paranoia de manual: la firma es lo único que separa la ficha de un cliente
 * de la de cualquier otro, y los ids son correlativos en el tiempo, así que
 * quien tenga un link tiene también los ids de sus vecinos de cartera.
 */
export function firmaCorrecta(secreto: string, financingId: string, version: unknown, firma: string): boolean {
  if (!secreto) return false;
  const esperada = Buffer.from(firmaPortal(secreto, financingId, Number(version) || 0), 'utf8');
  const recibida = Buffer.from(String(firma || ''), 'utf8');
  if (esperada.length !== recibida.length) return false;
  return timingSafeEqual(esperada, recibida);
}

/** El link completo, listo para pegar en un WhatsApp. */
export function linkPortal(base: string, secreto: string, registro: any): string | null {
  const token = tokenPortal(secreto, registro?.id, registro?.portalVersion);
  if (!token) return null;
  return `${String(base).replace(/\/+$/, '')}/p/${token}`;
}

/* ══════════════════════════  Referencias de pago  ══════════════════════════ */

/**
 * Prefijo de las referencias de pago de cuotas.
 *
 * El webhook de Bold es el mismo para las ventas de la tienda y para los pagos
 * de financiamiento, y lo único que llega para distinguirlos es la referencia.
 * Con el prefijo, el webhook sabe a qué colección ir sin tener que buscar en las
 * dos y sin que un número de pedido pueda colarse como pago de cuota.
 */
export const PREFIJO_PAGO_CUOTA = 'CL-';

export function nuevaReferenciaPago(): string {
  return `${PREFIJO_PAGO_CUOTA}${randomBytes(6).toString('hex').toUpperCase()}`;
}

/** La forma exacta de lo que emite `nuevaReferenciaPago`, y nada más. */
const FORMA_REFERENCIA = /^CL-[0-9A-F]{12}$/;

/**
 * Se comprueba la forma COMPLETA y no sólo el prefijo.
 *
 * El webhook es público: lo llama un tercero y cualquiera puede mandarle un
 * POST. Si bastara con que la referencia empezara por `CL-`, un `CL-` pelado
 * entraría por la rama de cuotas, no encontraría la intención de pago y
 * dispararía el aviso de "llegó un pago sin registro" al WhatsApp del dueño —
 * que es justo la alarma que tiene que significar algo cuando suene.
 */
export function esReferenciaDeCuota(referencia: unknown): boolean {
  return FORMA_REFERENCIA.test(String(referencia ?? ''));
}

/* ══════════════════════════  Qué se puede pagar  ══════════════════════════ */

export type AlcancePago = 'proxima' | 'vencidas' | 'saldo';

export interface SeleccionPago {
  /** Números de cuota que cubre el pago, en orden. */
  cuotas: number[];
  monto: number;
  concepto: string;
}

/**
 * Traduce "quiero pagar X" a cuotas concretas y un monto.
 *
 * Se resuelve en el servidor y no en el navegador a propósito: el monto es lo
 * que se le va a cobrar al cliente y lo que se va a firmar para Bold, así que no
 * puede venir de un campo del formulario. Lo único que manda el cliente es el
 * alcance, y de ahí no se puede sacar un cobro que no corresponda.
 *
 * Las cuotas van siempre de la más antigua hacia adelante. Pagar la #9 dejando
 * la #7 sin pagar no desbloquea nada —el automatismo mira si hay vencidas, no
 * cuántas se pagaron— y el cliente acabaría pagando sin que el teléfono se
 * suelte, que es la peor consecuencia posible de cobrar bien.
 */
export function elegirCuotasAPagar(
  registro: any,
  alcance: AlcancePago,
  hoy: string
): SeleccionPago | { error: string } {
  const valorCuota = Number(registro?.valorCuota || 0);
  if (!(valorCuota > 0)) return { error: 'Este financiamiento no tiene un valor de cuota válido.' };

  const todas: any[] = Array.isArray(registro?.cuotas) ? registro.cuotas : [];
  const pendientes = todas
    .filter((c) => c?.status !== 'paid')
    .sort((a, b) => fechaLimite(a).localeCompare(fechaLimite(b)));

  if (!pendientes.length) return { error: 'No te quedan cuotas pendientes.' };

  let elegidas: any[];
  if (alcance === 'saldo') {
    elegidas = pendientes;
  } else if (alcance === 'vencidas') {
    elegidas = pendientes.filter((c) => {
      const f = fechaLimite(c);
      return f !== '' && diasEntreFechas(f, hoy) >= 0;
    });
    // "Vencidas" incluye la que vence hoy: el cliente que entra el día de su
    // cuota y toca "pagar lo vencido" espera que entre la de hoy, no que le
    // cobre sólo las de antes y lo deje igual de bloqueado mañana.
    if (!elegidas.length) elegidas = [pendientes[0]];
  } else {
    elegidas = [pendientes[0]];
  }

  const cuotas = elegidas.map((c) => Number(c.number)).filter((n) => Number.isFinite(n));
  if (!cuotas.length) return { error: 'No se pudo determinar qué cuota cobrar.' };

  const monto = cuotas.length * valorCuota;
  const concepto =
    cuotas.length === 1
      ? `Cuota #${cuotas[0]}`
      : `Cuotas #${cuotas[0]} a #${cuotas[cuotas.length - 1]} (${cuotas.length})`;

  return { cuotas, monto, concepto };
}

/* ══════════════════════════  Resumen  ══════════════════════════ */

export type EstadoCuotaPortal = 'pagada' | 'con-plazo' | 'vencida' | 'vence-hoy' | 'pendiente';

export interface CuotaPortal {
  numero: number;
  estado: EstadoCuotaPortal;
  /** Fecha que de verdad manda, con el plazo aplicado. */
  vence: string;
  venceLargo: string;
  /** La pactada. Sólo viaja cuando es distinta, para poder enseñar las dos. */
  vencePactada: string | null;
  valor: number;
  pagadaEn: string | null;
  /** Si tiene respaldo (captura subida o pago en línea confirmado). */
  conRespaldo: boolean;
  /** Pagada por la pasarela, no en el mostrador. */
  enLinea: boolean;
  diasDeMora: number;
}

export interface ResumenPortal {
  nombre: string;
  producto: string;
  /** Enmascarado: sirve para que el cliente reconozca su equipo, no para nada más. */
  imei: string;
  valorCuota: number;
  totalCuotas: number;
  pagadas: number;
  pendientes: number;
  vencidas: number;
  saldo: number;
  diasDeMora: number;
  liquidado: boolean;
  horaBloqueo: string;
  equipo: { bloqueado: boolean; automatico: boolean };
  proxima: CuotaPortal | null;
  cuotas: CuotaPortal[];
  plazo: { hasta: string; hastaLargo: string } | null;
  /** Solicitud de plazo que el cliente ya mandó y nadie ha resuelto todavía. */
  solicitudPendiente: { hasta: string; hastaLargo: string; pedidaEn: string } | null;
  puedePedirPlazo: boolean;
  /** Qué se le puede ofrecer pagar ahora mismo. */
  opcionesPago: { alcance: AlcancePago; etiqueta: string; monto: number }[];
  maxDiasPlazo: number;
  hoy: string;
}

/**
 * Deja ver los últimos cuatro dígitos y nada más.
 *
 * El IMEI completo identifica el equipo ante el proveedor de bloqueo y ante
 * cualquier operador; el cliente sólo necesita reconocer que la ficha es la
 * suya, y para eso bastan cuatro números.
 */
export function imeiCorto(imei: unknown): string {
  const limpio = String(imei ?? '').replace(/\D/g, '');
  if (limpio.length <= 4) return limpio ? `••••${limpio}` : '—';
  return `•••• •••• ${limpio.slice(-4)}`;
}

function estadoDeCuota(cuota: any, hoy: string): EstadoCuotaPortal {
  if (cuota?.status === 'paid') return 'pagada';
  if (prorrogaVigente(cuota, hoy)) return 'con-plazo';
  const limite = fechaLimite(cuota);
  if (!limite) return 'pendiente';
  if (limite < hoy) return 'vencida';
  if (limite === hoy) return 'vence-hoy';
  return 'pendiente';
}

function aCuotaPortal(cuota: any, valorCuota: number, hoy: string): CuotaPortal {
  const limite = fechaLimite(cuota);
  const pactada = soloFecha(cuota?.dueDate);
  const estado = estadoDeCuota(cuota, hoy);
  const mora = estado === 'vencida' ? diasEntreFechas(limite, hoy) : 0;
  return {
    numero: Number(cuota?.number) || 0,
    estado,
    vence: limite,
    venceLargo: limite ? fechaLarga(limite) : '—',
    vencePactada: tieneProrroga(cuota) && pactada && pactada !== limite ? pactada : null,
    valor: valorCuota,
    pagadaEn: cuota?.paidDate ? soloFecha(cuota.paidDate) : null,
    conRespaldo: Boolean(cuota?.comprobante?.mediaId || cuota?.pagoEnLinea?.referencia),
    enLinea: Boolean(cuota?.pagoEnLinea?.referencia),
    diasDeMora: Number.isNaN(mora) ? 0 : Math.max(0, mora),
  };
}

/**
 * Todo lo que la página del cliente necesita, y sólo eso.
 *
 * `equipo` puede llegar `null`: hay registros de financiamiento sin equipo
 * emparejado (IMEI mal tecleado, equipos que nunca se enrolaron). En ese caso el
 * portal no afirma que el teléfono esté libre, simplemente no habla del equipo:
 * decirle "tu equipo está activo" a alguien que lo tiene bloqueado desde Nuovo
 * garantiza una llamada enfadada.
 */
export function armarResumenPortal(registro: any, equipo: any, hoy: string): ResumenPortal {
  const valorCuota = Number(registro?.valorCuota || 0);
  const previas = Number(registro?.cuotasPrevias || 0);
  const todas: any[] = Array.isArray(registro?.cuotas) ? registro.cuotas : [];

  const cuotas = todas
    .map((c) => aCuotaPortal(c, valorCuota, hoy))
    .sort((a, b) => a.numero - b.numero);

  const pendientes = cuotas.filter((c) => c.estado !== 'pagada');
  const vencidas = pendientes.filter((c) => c.estado === 'vencida');
  const ordenadasPorFecha = [...pendientes].sort((a, b) => a.vence.localeCompare(b.vence));
  const proxima = ordenadasPorFecha[0] || null;

  const cuotaCruda = proxima ? todas.find((c) => Number(c?.number) === proxima.numero) : null;
  const plazo = prorrogaVigente(cuotaCruda, hoy);

  const solicitud = solicitudPendienteDe(registro);

  const opcionesPago: ResumenPortal['opcionesPago'] = [];
  if (proxima) {
    opcionesPago.push({
      alcance: 'proxima',
      etiqueta: `Pagar la cuota #${proxima.numero}`,
      monto: valorCuota,
    });
    // Sólo se ofrece "lo vencido" si de verdad son varias: con una sola seria el
    // mismo botón de arriba con otro nombre, y dos botones que cobran lo mismo
    // hacen dudar de los dos.
    const alDia = pendientes.filter((c) => c.estado === 'vencida' || c.estado === 'vence-hoy').length;
    if (alDia > 1) {
      opcionesPago.push({
        alcance: 'vencidas',
        etiqueta: `Pagar lo vencido (${alDia} cuotas)`,
        monto: alDia * valorCuota,
      });
    }
    if (pendientes.length > alDia && pendientes.length > 1) {
      opcionesPago.push({
        alcance: 'saldo',
        etiqueta: `Pagar todo y terminar (${pendientes.length} cuotas)`,
        monto: pendientes.length * valorCuota,
      });
    }
  }

  return {
    nombre: String(registro?.nombre || '').trim(),
    producto: String(registro?.producto || '').trim(),
    imei: imeiCorto(registro?.imei),
    valorCuota,
    totalCuotas: todas.length + previas,
    pagadas: cuotas.filter((c) => c.estado === 'pagada').length + previas,
    pendientes: pendientes.length,
    vencidas: vencidas.length,
    saldo: pendientes.length * valorCuota,
    diasDeMora: vencidas.length ? Math.max(...vencidas.map((c) => c.diasDeMora)) : 0,
    liquidado: todas.length > 0 && pendientes.length === 0,
    horaBloqueo: String(registro?.horaBloqueo || '08:00'),
    equipo: {
      bloqueado: Boolean(equipo && (equipo.status === 'blocked' || equipo.intencion === 'blocked')),
      automatico: Boolean(equipo && equipo.plataforma === 'trustonic'),
    },
    proxima,
    cuotas,
    plazo: plazo ? { hasta: soloFecha(plazo.hasta), hastaLargo: fechaLarga(plazo.hasta) } : null,
    solicitudPendiente: solicitud
      ? {
          hasta: solicitud.hasta,
          hastaLargo: fechaLarga(solicitud.hasta),
          pedidaEn: String(solicitud.pedidaEn || ''),
        }
      : null,
    // Sin cuotas pendientes no hay nada que aplazar, y con una solicitud sin
    // resolver el botón sólo serviría para que el dueño reciba el mismo mensaje
    // cinco veces mientras decide.
    puedePedirPlazo: Boolean(proxima) && !solicitud && !plazo,
    opcionesPago,
    maxDiasPlazo: MAX_DIAS_PRORROGA,
    hoy,
  };
}

/* ══════════════════════════  Solicitudes de plazo  ══════════════════════════ */

export interface SolicitudPlazo {
  id: string;
  cuotaNumber: number;
  hasta: string;
  motivo: string;
  pedidaEn: string;
  estado: 'pendiente' | 'concedida' | 'rechazada' | 'automatica';
  resueltaEn?: string;
  resueltaPor?: string;
}

export function solicitudesDe(registro: any): SolicitudPlazo[] {
  return Array.isArray(registro?.solicitudesPlazo) ? registro.solicitudesPlazo : [];
}

export function solicitudPendienteDe(registro: any): SolicitudPlazo | null {
  return solicitudesDe(registro).find((s) => s?.estado === 'pendiente') || null;
}

export function nuevaSolicitudId(): string {
  return `sol-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
}

/**
 * Reglas del plazo automático.
 *
 * Por defecto está apagado: conceder plazos es una decisión de negocio y no la
 * toma el programa por su cuenta el día que se despliega. Cuando el dueño lo
 * enciende, estas tres condiciones son las que lo hacen razonable:
 *
 *  - `maxDias`: un plazo corto se parece a lo que ya concede por teléfono. Nadie
 *    regala tres semanas sin hablar.
 *  - `maxPorContrato`: el cliente que pide plazo cada quincena no está pidiendo
 *    plazo, está pagando tarde con permiso. A partir del tope, lo mira una
 *    persona.
 *  - `nadaSiIncumplio`: si ya se le dio un plazo y lo dejó pasar sin pagar, su
 *    palabra deja de valer para el automatismo.
 */
export interface ReglasPlazoAuto {
  activo: boolean;
  maxDias: number;
  maxPorContrato: number;
  nadaSiIncumplio: boolean;
}

export const REGLAS_PLAZO_AUTO_POR_DEFECTO: ReglasPlazoAuto = {
  activo: false,
  maxDias: 4,
  maxPorContrato: 1,
  nadaSiIncumplio: true,
};

export function normalizarReglasPlazo(crudo: any): ReglasPlazoAuto {
  const d = REGLAS_PLAZO_AUTO_POR_DEFECTO;
  const num = (v: unknown, pordefecto: number, tope: number) => {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n) || n < 0) return pordefecto;
    return Math.min(n, tope);
  };
  return {
    activo: crudo?.activo === true,
    maxDias: num(crudo?.maxDias, d.maxDias, MAX_DIAS_PRORROGA),
    maxPorContrato: num(crudo?.maxPorContrato, d.maxPorContrato, 12),
    nadaSiIncumplio: crudo?.nadaSiIncumplio !== false,
  };
}

/**
 * ¿Se le puede conceder solo, o lo tiene que mirar el dueño?
 *
 * Devuelve el motivo cuando NO, para que quede en el aviso: "pide 6 días y el
 * tope automático son 4" le dice al dueño qué decidir, mientras que un
 * "requiere revisión" a secas lo obliga a reconstruirlo él.
 */
export function decidirPlazoAutomatico(
  reglas: ReglasPlazoAuto,
  registro: any,
  hasta: string,
  hoy: string
): { auto: true } | { auto: false; motivo: string } {
  if (!reglas.activo) return { auto: false, motivo: 'el plazo automático está desactivado' };

  const dias = diasEntreFechas(hoy, hasta);
  if (Number.isNaN(dias)) return { auto: false, motivo: 'la fecha no se pudo interpretar' };
  if (dias > reglas.maxDias) {
    return { auto: false, motivo: `pide ${dias} días y el tope automático son ${reglas.maxDias}` };
  }

  const yaDadas = Number(registro?.prorrogasOtorgadas || 0);
  if (yaDadas >= reglas.maxPorContrato) {
    return {
      auto: false,
      motivo: `ya se le dieron ${yaDadas} plazo(s) y el tope automático es ${reglas.maxPorContrato}`,
    };
  }

  if (reglas.nadaSiIncumplio) {
    const incumplio = (Array.isArray(registro?.cuotas) ? registro.cuotas : []).some(
      (c: any) => c?.status !== 'paid' && tieneProrroga(c) && soloFecha(c?.prorroga?.hasta) < hoy
    );
    if (incumplio) return { auto: false, motivo: 'ya dejó pasar un plazo anterior sin pagar' };
  }

  return { auto: true };
}
