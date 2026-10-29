/**
 * Adaptador de la API HBM de Trustonic — bloqueo remoto de equipos financiados.
 *
 * Toda la API es UN solo endpoint (POST {base}/v1/hbm) y lo que cambia es
 * `service.code`. Por eso aquí hay una única función de transporte,
 * `llamarHbm`, y encima de ella un ayudante por cada operación.
 *
 * IMPORTANTE — el token puede bloquear CUALQUIER equipo del inventario, así que
 * vive sólo en las variables de entorno del servidor y nunca sale hacia el
 * navegador. El panel llama a nuestras rutas /api/blocking/* y es el servidor
 * quien habla con Trustonic.
 *
 * La colección de Postman que nos pasó el proveedor no trae ni un ejemplo de
 * respuesta (todos los `response` venían vacíos), así que NO se inventa aquí un
 * tipo de respuesta: se devuelve el cuerpo tal como llega junto al status HTTP y
 * que decida quien llama. En cuanto veamos respuestas reales se podrá tipar.
 */

const BASE_URL = (process.env.TRUSTONIC_BASE_URL || '').trim().replace(/\/+$/, '');
const TOKEN = (process.env.TRUSTONIC_TOKEN || '').trim();
const TIMEOUT_MS = Number(process.env.TRUSTONIC_TIMEOUT_MS || 15000);

/**
 * Códigos de servicio de la API HBM.
 *
 * Los 22 están confirmados como habilitados para nuestro token: se probó cada
 * uno con cuerpo vacío y respondieron 400 "Missing required fields", mientras
 * que un código inventado de control responde 404 "Service not available for
 * this customer". Es decir, el 400 prueba que el servicio existe y está
 * autorizado; no es una suposición a partir de la documentación.
 */
export type CodigoServicio =
  | 'QUERY_DEVICES'
  | 'INVENTORY_UPLOAD'
  | 'SERVICE_ACTIVATE'
  | 'SERVICE_GET'
  | 'SERVICE_UPDATE'
  | 'SERVICE_DELETE'
  | 'DEVICE_LOCK'
  | 'DEVICE_UNLOCK'
  | 'DEVICE_PIN_UNLOCK'
  | 'DEVICE_NOTIFY'
  | 'DEVICE_LOCK_MESSAGE'
  | 'DEVICE_RELEASE'
  | 'DEVICE_ARCHIVE'
  | 'DEVICE_RELOAD'
  | 'DEVICE_BLOCK_FACTORY_RESET'
  | 'DEVICE_BLOCK_ADB'
  | 'DEVICE_BLOCK_AEPROVISION'
  | 'DEVICE_SIMCTRL_DISABLE'
  | 'DEVICE_IMSI_SWAP'
  | 'WEBHOOK_CREATE'
  | 'WEBHOOK_GET_ALL'
  | 'WEBHOOK_DELETE';

export interface RespuestaHbm {
  /** true sólo si Trustonic respondió 2xx. */
  ok: boolean;
  status: number;
  /** Cuerpo ya parseado si era JSON; si no, el texto crudo. */
  cuerpo: any;
  /** Mensaje legible cuando falla por red, timeout o falta de configuración. */
  error?: string;
}

export function trustonicConfigurado(): boolean {
  return Boolean(BASE_URL && TOKEN);
}

/**
 * Oculta el centro del IMEI para los logs: 351947257924263 -> 35194725****263
 * El IMEI identifica al equipo y al cliente, así que no se escribe completo en
 * los logs de Railway.
 */
export function enmascararImei(valor: unknown): string {
  const s = String(valor ?? '');
  if (s.length < 8) return '***';
  return `${s.slice(0, 8)}****${s.slice(-3)}`;
}

/**
 * Valida un IMEI: 15 dígitos y dígito de control de Luhn.
 *
 * El Luhn importa de verdad aquí: un IMEI mal tecleado por el vendedor no da un
 * error, da el equipo EQUIVOCADO, y en un sistema que bloquea teléfonos eso
 * significa dejar sin servicio a un cliente que sí pagó. Luhn detecta
 * prácticamente todos los errores de un solo dígito.
 *
 * Se aceptan también identificadores de 14 a 17 dígitos sin verificar Luhn,
 * porque la colección del proveedor usa `deviceUid` de 16 dígitos en varios
 * ejemplos y no sabemos si admiten números de serie además de IMEI.
 */
export function imeiValido(valor: unknown): boolean {
  const s = String(valor ?? '').trim();
  if (!/^\d{14,17}$/.test(s)) return false;
  if (s.length !== 15) return true; // no es un IMEI clásico: sólo se exige que sean dígitos

  let suma = 0;
  for (let i = 0; i < 15; i++) {
    let d = s.charCodeAt(i) - 48;
    // Se duplican las posiciones pares contando desde la izquierda (índices 1,3,5…)
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    suma += d;
  }
  return suma % 10 === 0;
}

/**
 * Única puerta de salida hacia Trustonic.
 *
 * No lanza excepciones por errores HTTP ni de red: devuelve siempre un
 * RespuestaHbm. Quien llama es una ruta del panel, y un throw aquí se
 * convertiría en un 500 sin explicación para el administrador.
 */
export async function llamarHbm(
  code: CodigoServicio,
  data: unknown,
  variant: string = 'A'
): Promise<RespuestaHbm> {
  if (!trustonicConfigurado()) {
    const error =
      'Trustonic no está configurado: faltan TRUSTONIC_BASE_URL o TRUSTONIC_TOKEN.';
    console.error(`[trustonic] ${error}`);
    return { ok: false, status: 0, cuerpo: null, error };
  }

  const url = `${BASE_URL}/v1/hbm`;
  const cuerpoPeticion = JSON.stringify({ service: { code, variant }, data });

  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  const iniciado = Date.now();

  try {
    const respuesta = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${TOKEN}`,
      },
      body: cuerpoPeticion,
      signal: controlador.signal,
    });

    const texto = await respuesta.text();
    let cuerpo: any = texto;
    try {
      cuerpo = texto ? JSON.parse(texto) : null;
    } catch {
      // Trustonic puede devolver texto plano en algunos errores; se deja crudo.
    }

    const ms = Date.now() - iniciado;
    if (!respuesta.ok) {
      console.error(`[trustonic] ${code} -> HTTP ${respuesta.status} en ${ms}ms`);
      return {
        ok: false,
        status: respuesta.status,
        cuerpo,
        error: `Trustonic respondió ${respuesta.status}.`,
      };
    }

    console.log(`[trustonic] ${code} -> HTTP ${respuesta.status} en ${ms}ms`);
    return { ok: true, status: respuesta.status, cuerpo };
  } catch (err: any) {
    const abortado = err?.name === 'AbortError';
    const error = abortado
      ? `Trustonic no respondió en ${TIMEOUT_MS}ms.`
      : `No se pudo contactar con Trustonic: ${err?.message || 'error desconocido'}`;
    console.error(`[trustonic] ${code} falló: ${error}`);
    return { ok: false, status: 0, cuerpo: null, error };
  } finally {
    clearTimeout(temporizador);
  }
}

/* ────────────────────────  Enrolamiento  ──────────────────────── */

/**
 * Paso 1 y 4 del enrolamiento. También sirve para reconciliar el estado real:
 * la API no tiene webhooks, así que la única forma de saber si un bloqueo entró
 * de verdad es preguntar.
 */
export async function consultarDispositivos(imeis: string[]): Promise<RespuestaHbm> {
  return llamarHbm('QUERY_DEVICES', {
    deviceList: imeis.map((deviceUid) => ({ deviceUid })),
  });
}

/** Paso 2: dar de alta el equipo en el inventario de Trustonic. */
export async function cargarInventario(
  imeis: string[],
  deviceType: string = 'smartphone'
): Promise<RespuestaHbm> {
  return llamarHbm('INVENTORY_UPLOAD', {
    deviceList: imeis.map((deviceUid) => ({ deviceType, idType: 'imei', deviceUid })),
  });
}

/**
 * Paso 3: activar el servicio de financiación sobre el equipo ya cargado.
 *
 * `additionalInfo` es lo que el equipo muestra como entidad financiadora. Se
 * manda AQUÍ porque es el único momento en que se puede: SERVICE_UPDATE sólo
 * cambia el método de pago y rechaza con SERVICE_TRANSITION_NOT_ALLOWED si el
 * equipo ya está en POSTPAID. Los 87 equipos enrolados antes de esto siguen
 * diciendo "Tu Financiera" y eso sólo se corrige desde el portal de Trustonic.
 */
export async function activarFinanciamiento(
  imeis: string[],
  paymentMethod: 'postpaid' | 'prepaid' = 'postpaid',
  additionalInfo?: Record<string, string>
): Promise<RespuestaHbm> {
  return llamarHbm('SERVICE_ACTIVATE', {
    deviceList: imeis.map((deviceUid) => ({
      deviceUid,
      serviceList: [
        { serviceName: 'deviceFinancing', paymentMethod, ...(additionalInfo ? { additionalInfo } : {}) },
      ],
    })),
  });
}

/* ────────────────────────  Lectura de estado  ──────────────────────── */

/** Un equipo tal como lo devuelve QUERY_DEVICES en `deviceResponseList`. */
export interface DispositivoHbm {
  deviceUid: string;
  tenantName?: string;
  lastCheckIn?: string | null;
  lastChanged?: string | null;
  createdTimeStamp?: string | null;
  deviceManufacturer?: string | null;
  deviceModel?: string | null;
  deviceMarketName?: string | null;
  stateInfo?: string | null;
  serviceDetails?: string | null;
  transitionState?: string | null;
  transitionQueue?: string[] | null;
  additionalInfo?: Record<string, string> | null;
  tac?: string | null;
  imsiInfo?: { IMSI?: string | null; 'IMSI Lock'?: boolean; 'IMSI Last Changed'?: string | null } | null;
}

/** Saca la lista de equipos de una respuesta de QUERY_DEVICES. */
export function leerDispositivos(respuesta: RespuestaHbm): DispositivoHbm[] {
  const lista = respuesta.cuerpo?.dataResponse?.deviceResponseList;
  return Array.isArray(lista) ? lista : [];
}

/**
 * Consulta UN equipo y dice si el proveedor lo reconoce como nuestro.
 *
 * Es de uno en uno a propósito. Los lotes de esta API son todo-o-nada: si un
 * solo deviceUid del lote no pertenece al socio, la petición COMPLETA falla con
 * 409 y no se sabe cuál fue. Con 87 equipos enrolados y 24 que están en otra
 * plataforma, un lote nunca llegaría a responder.
 */
export async function consultarUno(
  imei: string
): Promise<{ encontrado: boolean; dispositivo: DispositivoHbm | null; respuesta: RespuestaHbm }> {
  const respuesta = await consultarDispositivos([imei]);
  const dispositivo = leerDispositivos(respuesta).find((d) => String(d.deviceUid) === String(imei)) || null;
  return { encontrado: respuesta.ok && Boolean(dispositivo), dispositivo, respuesta };
}

/**
 * Traduce el `stateInfo` del proveedor al estado que usa el panel.
 *
 * `Locked` es el único que importa de verdad; el resto del ciclo de vida
 * (`readyForUse`, `enrolled`, `Active`…) significa "el cliente tiene su
 * teléfono funcionando", que para el panel es lo mismo.
 */
export function estadoDesdeHbm(stateInfo: unknown): 'active' | 'blocked' {
  return String(stateInfo ?? '').toLowerCase() === 'locked' ? 'blocked' : 'active';
}

/**
 * Horas desde el último contacto del equipo con el proveedor, o null si nunca
 * reportó.
 *
 * Este es el dato honesto de conectividad, NO `stateInfo`. Un equipo apagado
 * sigue diciendo `Active` indefinidamente, así que afirmar "está activo" sin
 * mirar esto es afirmar algo que no sabemos: puede llevar semanas apagado y el
 * bloqueo que se le mande no va a llegar nunca.
 */
export function horasDesdeCheckIn(lastCheckIn: unknown): number | null {
  if (!lastCheckIn) return null;
  const t = new Date(String(lastCheckIn)).getTime();
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 3600000;
}

/* ────────────────────────  Gestión  ──────────────────────── */

/**
 * Bloquea el equipo. `titulo` y `mensaje` SE LE MUESTRAN AL CLIENTE en la
 * pantalla del teléfono, así que van en español y con un tono correcto.
 */
export async function bloquear(
  imei: string,
  titulo: string,
  mensaje: string
): Promise<RespuestaHbm> {
  return llamarHbm('DEVICE_LOCK', {
    lockList: [
      {
        deviceUid: imei,
        lockType: 'lock',
        lockMsgTitle: titulo,
        lockMsgContent: mensaje,
      },
    ],
  });
}

export async function desbloquear(imei: string): Promise<RespuestaHbm> {
  return llamarHbm('DEVICE_UNLOCK', { unLockList: [{ deviceUid: imei }] });
}

/**
 * Desbloqueo sin conexión. El cliente paga, en la pantalla del equipo bloqueado
 * le aparece un código (`challenge`), llama a la tienda y con esto se genera el
 * PIN que lo libera. Pasa seguido: justo cuando no puede pagar en línea es
 * cuando tampoco tiene datos.
 */
export async function desbloquearConPin(imei: string, challenge: string): Promise<RespuestaHbm> {
  return llamarHbm('DEVICE_PIN_UNLOCK', {
    pinUnlockList: [{ deviceUid: imei, challenge }],
  });
}

/** Aviso al equipo sin bloquearlo (recordatorio de pago próximo). */
export async function notificar(
  imei: string,
  titulo: string,
  contenido: string,
  notificationType: string = 'headsup'
): Promise<RespuestaHbm> {
  return llamarHbm('DEVICE_NOTIFY', {
    messageList: [
      {
        deviceUid: imei,
        notificationTitle: titulo,
        notificationType,
        notificationContent: contenido,
      },
    ],
  });
}

/** Cambia el texto que se ve en la pantalla de un equipo YA bloqueado. */
export async function mensajeEnBloqueo(
  imei: string,
  titulo: string,
  contenido: string
): Promise<RespuestaHbm> {
  return llamarHbm('DEVICE_LOCK_MESSAGE', {
    lockMessageList: [{ deviceUid: imei, messageTitle: titulo, messageContent: contenido }],
  });
}

/**
 * Libera el equipo definitivamente al terminar de pagarlo. Es irreversible
 * desde el punto de vista del financiamiento: después de esto ya no se puede
 * volver a bloquear, así que la ruta que lo use debe pedir confirmación.
 */
export async function liberar(imei: string, motivo: string): Promise<RespuestaHbm> {
  return llamarHbm('DEVICE_RELEASE', {
    deviceReleaseList: [{ deviceUid: imei, reason: motivo }],
  });
}

/* ────────────────────────  Anti-evasión  ──────────────────────── */

/**
 * Impide el restablecimiento de fábrica.
 *
 * Es la contramedida que de verdad importa: sin esto, el cliente que no quiere
 * pagar resetea el equipo, la app de bloqueo desaparece y el teléfono queda
 * libre. Se activa al enrolar, no cuando ya hay mora — para entonces ya es
 * tarde.
 */
export async function bloquearReseteoFabrica(imei: string): Promise<RespuestaHbm> {
  return llamarHbm('DEVICE_BLOCK_FACTORY_RESET', {
    deviceList: [{ deviceUid: imei }],
  });
}

/** Impide la depuración por ADB, que es la otra vía para sacar la app. */
export async function bloquearAdb(imei: string): Promise<RespuestaHbm> {
  return llamarHbm('DEVICE_BLOCK_ADB', { deviceList: [{ deviceUid: imei }] });
}

/** Impide re-aprovisionar el equipo contra otro MDM. */
export async function bloquearReaprovisionamiento(imei: string): Promise<RespuestaHbm> {
  return llamarHbm('DEVICE_BLOCK_AEPROVISION', { deviceList: [{ deviceUid: imei }] });
}

/* ────────────────────────  Webhooks  ──────────────────────── */

/** Eventos que el proveedor sabe empujar. */
export type EventoHbm = 'readyForUse' | 'idle' | 'enrolled' | 'active' | 'locked' | 'released';

export async function crearWebhook(url: string, eventos: EventoHbm[]): Promise<RespuestaHbm> {
  return llamarHbm('WEBHOOK_CREATE', {
    subscriptionList: [{ callbackUrl: url, eventList: eventos }],
  });
}

export async function listarWebhooks(): Promise<RespuestaHbm> {
  return llamarHbm('WEBHOOK_GET_ALL', {});
}

export async function borrarWebhook(id: string): Promise<RespuestaHbm> {
  return llamarHbm('WEBHOOK_DELETE', { subscriptionList: [{ subscriptionId: id }] });
}
