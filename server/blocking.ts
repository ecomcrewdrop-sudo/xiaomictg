/**
 * CrediLock — bloqueo remoto de equipos financiados.
 *
 * Vive aparte de index.ts porque index.ts ya pasa de 5.600 líneas; se engancha
 * con registrarBloqueo(app, deps) al final del arranque.
 *
 *
 * LA IDEA CENTRAL: INTENCIÓN vs ESTADO CONFIRMADO
 *
 * Un bloqueo enviado a un teléfono apagado NO llega. La API lo acepta, responde
 * REQUEST_SUCCESS, y el equipo sigue funcionando cuando se enciende horas
 * después. Si guardáramos "bloqueado" al recibir ese REQUEST_SUCCESS, el panel
 * le mentiría al dueño: vería un cliente bloqueado que en realidad está usando
 * su teléfono con normalidad.
 *
 * Por eso cada equipo lleva DOS campos:
 *
 *   intencion  — lo que queremos que pase ('active' | 'blocked'). Lo fija el
 *                dueño o la política de mora. Es nuestro.
 *   status     — lo que el proveedor confirma que pasa. Sólo lo escribe la
 *                reconciliación a partir de QUERY_DEVICES. Nunca se deduce de
 *                la respuesta de un DEVICE_LOCK.
 *
 * Cuando difieren, el reconciliador reintenta. Eso convierte "apagado" de un
 * fallo silencioso en un reintento automático, y es lo que hace que el sistema
 * funcione sin que nadie lo vigile.
 *
 *
 * DOS PLATAFORMAS
 *
 * 24 equipos de la cartera están enrolados en Nuovo, no en Trustonic, y NO son
 * alcanzables por esta API (se comprobó: sólo el variant "A" está habilitado y
 * los demás responden 404). Enrolar en Trustonic exige el equipo recién sacado
 * de fábrica, así que migrarlos a mitad de contrato significaría que el cliente
 * venga a la tienda y pierda sus datos. Se sostienen las dos plataformas hasta
 * que esa cartera termine de pagar (último vencimiento: 2027-02-18).
 *
 * Todo lo automático de aquí se salta los equipos marcados `nuovo`. El panel
 * los muestra como "gestión manual" para que nadie crea que un botón que no
 * hace nada sí hizo algo.
 */

import type { Express, Request, Response } from 'express';
import {
  bloquear,
  bloquearAdb,
  bloquearReaprovisionamiento,
  bloquearReseteoFabrica,
  cargarInventario,
  activarFinanciamiento,
  consultarUno,
  desbloquear,
  desbloquearConPin,
  enmascararImei,
  estadoDesdeHbm,
  horasDesdeCheckIn,
  imeiValido,
  liberar,
  mensajeEnBloqueo,
  notificar,
  crearWebhook,
  listarWebhooks,
  borrarWebhook,
  trustonicConfigurado,
  type DispositivoHbm,
  type RespuestaHbm,
} from './trustonic';
import { fechaLarga, fechaLimite, prorrogaVigente, type Prorroga } from './prorroga';

export interface DepsBloqueo {
  /** db se reasigna al reconectar a Mongo, así que hay que leerlo cada vez. */
  getDb: () => any;
  /** Los cobros salen por el WhatsApp de CREDILOCK, nunca por el de la tienda. */
  enviarWhatsApp: (telefono: string, texto: string) => Promise<boolean>;
  whatsappListo: () => boolean;
  nombreBonito: (valor: string) => string;
  /**
   * Link del portal de ese cliente, o `null` si no se puede armar.
   *
   * Es opcional para no obligar a los tests de bloqueo a montar el portal
   * entero: cuando no está, los avisos salen como salían antes. Cuando está,
   * el cliente al que acabamos de bloquear puede pagar y desbloquearse solo,
   * que es exactamente lo que ya le promete el mensaje ("al registrar el pago
   * se desbloquea automáticamente") y que hasta ahora exigía que alguien de la
   * tienda estuviera despierto.
   */
  linkPortal?: (registro: any) => string | null;
  /**
   * Link CORTO del portal para la pantalla de bloqueo, o `null`.
   *
   * Separado de `linkPortal` porque son dos cosas distintas aunque se parezcan:
   * el largo viaja en un WhatsApp y se toca con el dedo, el corto se lee en una
   * pantalla y se teclea en otro aparato. Es asíncrono porque la primera vez que
   * se pide puede tener que asignar el código y guardarlo.
   *
   * Opcional por el mismo motivo que `linkPortal`: sin él, el texto de bloqueo
   * sale como salía antes.
   */
  linkCortoPortal?: (registro: any) => Promise<string | null>;
}

/**
 * Añade el link para pagar, si lo hay. Sólo se usa en los avisos donde queda
 * algo por pagar: en un "ya quedaste al día" el link sobra y encima sembraría
 * la duda de si de verdad quedó al día.
 */
function conLinkDePago(deps: DepsBloqueo, registro: any, texto: string): string {
  const link = deps.linkPortal?.(registro);
  if (!link) return texto;
  const bloque = `💳 *Paga aquí y se desbloquea solo:*\n${link}\n\n`;
  const firma = '_CREDILOCK — Sistema de financiamiento_';
  return texto.includes(firma) ? texto.replace(firma, `${bloque}${firma}`) : `${texto}\n\n${bloque}`;
}

const COL_EQUIPOS = 'blocking_devices';
const COL_HISTORIAL = 'blocking_history';
const COL_CONFIG = 'blocking_config';
const COL_ALERTAS = 'blocking_alerts';
const COL_PAGOS = 'blocking_payments';

const TELEFONO_TIENDA = '302 287 5280';

/** Cuántos equipos se consultan por vuelta del reconciliador. Ver CADENCIA. */
const EQUIPOS_POR_VUELTA = 10;

/**
 * Horas sin reportar a partir de las cuales dejamos de afirmar que sabemos el
 * estado del equipo. Dos días cubre un fin de semana con el teléfono apagado.
 */
const HORAS_PARA_DAR_POR_INCOMUNICADO = 48;

/* ══════════════════════════  Configuración  ══════════════════════════ */

export interface ConfigBloqueo {
  /** Interruptor general del automatismo. Nace apagado: ver abajo. */
  autoBloqueoActivo: boolean;
  /**
   * Simulación. Decide todo, lo escribe en el historial, pero no llama a la
   * API. Permite ver una semana de decisiones reales antes de dejarlo suelto.
   */
  simulacion: boolean;
  /** Días de gracia tras el vencimiento antes de bloquear. */
  diasDeGracia: number;
  /** Tope de bloqueos nuevos por vuelta. Un error de datos no vacía la calle. */
  maxBloqueosPorVuelta: number;
  /** Aviso en la pantalla del equipo el día antes de vencer. */
  avisoEnPantallaActivo: boolean;
  /** Secreto que debe traer el webhook del proveedor para que lo creamos. */
  secretoWebhook: string;
}

/**
 * El automatismo nace APAGADO y en simulación, y es deliberado.
 *
 * Esto bloquea teléfonos de clientes reales y no hay ambiente de pruebas: la
 * documentación del proveedor dice literalmente "Base URL (Sandbox): N/A".
 * Un bug aquí no da un error, deja a decenas de personas sin teléfono — y
 * varios usan el teléfono para trabajar. Además la auditoría de la cartera ya
 * encontró un IMEI mal digitado, y bloquear por IMEI equivocado significa
 * bloquear a alguien que SÍ pagó.
 *
 * Así que el dueño lo enciende desde el panel cuando haya visto unos días de
 * decisiones en simulación y le cuadren. El valor por defecto no es timidez:
 * es que el coste de equivocarse es asimétrico.
 */
const CONFIG_POR_DEFECTO: ConfigBloqueo = {
  autoBloqueoActivo: false,
  simulacion: true,
  diasDeGracia: 1,
  maxBloqueosPorVuelta: 5,
  avisoEnPantallaActivo: true,
  secretoWebhook: '',
};

async function leerConfig(deps: DepsBloqueo): Promise<ConfigBloqueo> {
  const db = deps.getDb();
  if (!db) return CONFIG_POR_DEFECTO;
  const doc = await db.collection(COL_CONFIG).findOne({ _id: 'config' });
  return { ...CONFIG_POR_DEFECTO, ...(doc || {}) };
}

/* ══════════════════════════  Fechas  ══════════════════════════ */

/** Hoy en Colombia como YYYY-MM-DD y la hora local, para la hora de bloqueo. */
function hoyColombia(): { fecha: string; hora: number; minuto: number } {
  const ahora = new Date();
  const fecha = ahora.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  const [h, m] = ahora
    .toLocaleTimeString('en-GB', { timeZone: 'America/Bogota', hour12: false })
    .split(':');
  return { fecha, hora: Number(h), minuto: Number(m) };
}

/** Días completos de `desde` a `hasta`, ambos YYYY-MM-DD. */
function diasEntre(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T00:00:00Z`);
  const b = Date.parse(`${hasta}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return Math.round((b - a) / 86400000);
}

function pesos(valor: number): string {
  return `$${Math.round(valor).toLocaleString('es-CO')} COP`;
}

/* ══════════════════════════  Auditoría  ══════════════════════════ */

export interface EntradaHistorial {
  deviceId: string;
  imei: string;
  action: string;
  user: string;
  reason?: string;
  deviceInfo: string;
  /** Respuesta cruda del proveedor, para poder reconstruir qué pasó. */
  metadata?: any;
}

/**
 * Historial append-only. No hay ruta que borre ni modifique entradas.
 *
 * Importa porque dejar a un cliente sin teléfono es una acción con
 * consecuencias legales (Ley 1581 de 2012 sobre datos personales, y un
 * contrato de por medio). Si un cliente reclama "me bloquearon habiendo
 * pagado", la única defensa es poder decir con fecha y hora quién lo ordenó,
 * con qué cuotas vencidas, y qué respondió el proveedor.
 *
 * Nunca lanza: un fallo escribiendo la bitácora no debe tumbar la operación
 * que la generó, pero sí tiene que gritar en los logs.
 */
async function auditar(deps: DepsBloqueo, entrada: EntradaHistorial): Promise<void> {
  try {
    const db = deps.getDb();
    if (!db) return;
    await db.collection(COL_HISTORIAL).insertOne({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...entrada,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[credilock] No se pudo escribir en el historial:', err);
  }
}

async function alertar(
  deps: DepsBloqueo,
  deviceId: string,
  type: string,
  message: string
): Promise<void> {
  try {
    const db = deps.getDb();
    if (!db) return;
    await db.collection(COL_ALERTAS).insertOne({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      deviceId,
      type,
      message,
      timestamp: new Date().toISOString(),
      acknowledged: false,
    });
  } catch (err) {
    console.error('[credilock] No se pudo crear la alerta:', err);
  }
}

/* ══════════════════════════  Cartera  ══════════════════════════ */

interface Cuota {
  number: number;
  dueDate: string;
  status: string;
  paidDate?: string;
  prorroga?: Prorroga | null;
}

export interface EstadoCartera {
  totalCuotas: number;
  pagadas: number;
  pendientes: number;
  vencidas: number;
  /** Cuota pendiente más antigua; es la que se le nombra al cliente. */
  proxima: Cuota | null;
  diasDeMora: number;
  saldo: number;
  liquidado: boolean;
  /**
   * Prórroga vigente sobre la próxima cuota, si la hay. El automatismo no la
   * necesita (ya viene descontada de `vencidas`), pero sí la necesitan el panel
   * y los mensajes: sin esto, un cliente con plazo hasta el viernes se vería
   * igual que uno que ya pagó, y no es lo mismo.
   */
  prorroga: Prorroga | null;
  /** Cuántas cuotas pendientes están cubiertas por un plazo que sigue abierto. */
  conProrrogaVigente: number;
}

/**
 * Resume la cartera de un registro de financiamiento.
 *
 * `cuotasPrevias` existe porque varios contratos se migraron a mitad de camino
 * y su array `cuotas` no empieza en 1. Para contarle cuotas al cliente hay que
 * sumarlas, o le diremos que pagó 3 de 12 cuando lleva 8.
 */
export function resumirCartera(registro: any, hoy: string): EstadoCartera {
  const cuotas: Cuota[] = Array.isArray(registro?.cuotas) ? registro.cuotas : [];
  const previas = Number(registro?.cuotasPrevias || 0);
  const valorCuota = Number(registro?.valorCuota || 0);

  const pagadas = cuotas.filter((c) => c.status === 'paid').length;
  const pendientes = cuotas.filter((c) => c.status !== 'paid');

  /**
   * `fechaLimite` y no `dueDate`: una cuota con prórroga vigente NO está
   * vencida, y ésta es la única puerta por la que el automatismo se entera.
   * Todo lo que decide bloquear cuelga de este filtro, así que es aquí —y no en
   * la interfaz— donde el plazo tiene que valer.
   */
  const vencidas = pendientes.filter((c) => {
    const f = fechaLimite(c);
    return f !== '' && diasEntre(f, hoy) >= 1;
  });

  const ordenadas = [...pendientes].sort((a, b) =>
    fechaLimite(a).localeCompare(fechaLimite(b))
  );
  const proxima = ordenadas[0] || null;

  const diasDeMora = vencidas.length
    ? Math.max(
        ...vencidas.map((c) => {
          const d = diasEntre(fechaLimite(c), hoy);
          return Number.isNaN(d) ? 0 : d;
        })
      )
    : 0;

  return {
    totalCuotas: cuotas.length + previas,
    pagadas: pagadas + previas,
    pendientes: pendientes.length,
    vencidas: vencidas.length,
    proxima,
    diasDeMora,
    saldo: pendientes.length * valorCuota,
    liquidado: cuotas.length > 0 && pendientes.length === 0,
    prorroga: prorrogaVigente(proxima, hoy),
    conProrrogaVigente: pendientes.filter((c) => prorrogaVigente(c, hoy)).length,
  };
}

/* ══════════════════════════  Mensajes al cliente  ══════════════════════════ */

/**
 * Texto de la pantalla de bloqueo.
 *
 * Se arma en cada llamada con los datos del momento, y no es un detalle: los
 * campos `additionalInfo` del proveedor (Due Date, Amount owed) están vacíos en
 * los 87 equipos y SERVICE_UPDATE no los puede rellenar — sólo cambia el método
 * de pago. Así que este texto es el único sitio donde el cliente ve cuánto debe
 * y a quién llamar, y por eso lleva la cifra concreta en vez de un "contáctanos".
 *
 *
 * POR QUÉ EL LINK VA CORTO Y NO ES UN BOTÓN
 * ─────────────────────────────────────────
 * No hay botón posible: `DEVICE_LOCK` acepta `lockMsgTitle` y `lockMsgContent`,
 * los dos texto plano. No existe un campo de acción ni de URL, así que lo único
 * que podemos cambiar es lo que dice.
 *
 * Y lo que dice se lee en la pantalla de un equipo bloqueado y se teclea en OTRO
 * aparato, a mano. El link normal del portal mide unos 95 caracteres y termina
 * en una firma de 24: pedir que se copie eso es pedir que no se pague. El código
 * corto son seis caracteres. Que sean adivinables es justamente el precio de que
 * se puedan teclear, y por eso el código sólo identifica: los cuatro últimos
 * dígitos de la cédula son los que abren. Sin ellos no se ve ni el nombre.
 *
 * El teléfono se queda aunque haya link. Un equipo bloqueado puede ser el único
 * teléfono de la casa, y entonces no hay "otro aparato" donde abrir nada.
 */
function textoBloqueo(nombre: string, cartera: EstadoCartera, linkCorto?: string | null) {
  const cuota = cartera.proxima ? `#${cartera.proxima.number}` : '';
  const detalle =
    cartera.vencidas > 1
      ? `Tienes ${cartera.vencidas} cuotas vencidas por ${pesos(cartera.saldo)}.`
      : `Tienes la cuota ${cuota} vencida.`;

  // Sin link se mantiene el texto de antes, palabra por palabra. Si un día falla
  // la asignación del código, el cliente lee el mensaje que siempre leyó en vez
  // de uno mutilado que le habla de una página que no le dimos.
  const comoPagar = linkCorto
    ? `Paga en ${linkCorto} con los 4 últimos dígitos de tu cédula y se desbloquea solo. `
    : 'Al registrar el pago se desbloquea automáticamente. ';

  return {
    titulo: 'Equipo bloqueado por pago pendiente',
    mensaje: `${nombre}: ${detalle} ${comoPagar}Comunícate al ${TELEFONO_TIENDA} para reactivarlo.`,
  };
}

function textoAvisoPantalla(cartera: EstadoCartera) {
  const cuota = cartera.proxima ? `#${cartera.proxima.number}` : '';
  // Si el plazo salió de una prórroga hay que nombrarlo así. El cliente sabe
  // que su fecha original ya pasó; leer "tu cuota vence mañana" lo haría pensar
  // que no le registraron el acuerdo.
  if (cartera.prorroga) {
    return {
      titulo: 'Mañana vence tu plazo',
      contenido: `Cuota ${cuota}. Se te dio plazo hasta mañana. Tel: ${TELEFONO_TIENDA}`,
    };
  }
  return {
    titulo: 'Tu cuota vence mañana',
    contenido: `Cuota ${cuota}. Paga a tiempo para evitar el bloqueo. Tel: ${TELEFONO_TIENDA}`,
  };
}

/* ══════════════════════════  Equipos  ══════════════════════════ */

export type Plataforma = 'trustonic' | 'nuovo' | 'desconocida';

/**
 * Crea o actualiza los equipos a partir de la colección `financing`.
 *
 * La cartera es la fuente de verdad del dueño: él da de alta financiamientos,
 * no "dispositivos". Si el panel de bloqueo tuviera su propia lista a mano, se
 * desincronizaría la primera semana. Así que aquí se derivan, y lo único que
 * vive sólo en el equipo es lo que la cartera no sabe: plataforma, estado real
 * y conectividad.
 */
async function sincronizarDesdeCartera(deps: DepsBloqueo): Promise<{ creados: number; actualizados: number; sinImei: number }> {
  const db = deps.getDb();
  if (!db) return { creados: 0, actualizados: 0, sinImei: 0 };

  const registros = await db.collection('financing').find({}).toArray();
  const { fecha: hoy } = hoyColombia();
  let creados = 0;
  let actualizados = 0;
  let sinImei = 0;

  for (const registro of registros) {
    const imei = String(registro.imei || '').trim();

    // Sin IMEI válido no hay nada que bloquear, y callarlo sería lo peor: el
    // dueño creería que ese cliente está cubierto. Se deja una alerta visible.
    if (!imeiValido(imei)) {
      sinImei++;
      const existe = await db.collection(COL_ALERTAS).findOne({
        deviceId: `financing:${registro.id}`,
        type: 'imei_invalido',
        acknowledged: false,
      });
      if (!existe) {
        await alertar(
          deps,
          `financing:${registro.id}`,
          'imei_invalido',
          `${registro.nombre}: el IMEI "${imei}" no es válido, así que este equipo NO se puede bloquear. ` +
            `Hay que corregirlo mirando el equipo o la caja.`
        );
      }
      continue;
    }

    const cartera = resumirCartera(registro, hoy);
    const existente = await db.collection(COL_EQUIPOS).findOne({ imei });

    const desdeCartera = {
      imei,
      owner: registro.nombre || 'Sin nombre',
      phoneNumber: registro.telefono || '',
      financingId: registro.id,
      producto: registro.producto || '',
      horaBloqueo: registro.horaBloqueo || '08:00',
      cuotasVencidas: cartera.vencidas,
      cuotasPendientes: cartera.pendientes,
      cuotasPagadas: cartera.pagadas,
      totalCuotas: cartera.totalCuotas,
      saldo: cartera.saldo,
      diasDeMora: cartera.diasDeMora,
      liquidado: cartera.liquidado,
      financingStatus: registro.status || 'active',
      /**
       * Se copia al equipo para que el panel de bloqueo pueda decir "con plazo
       * hasta el 20" sin tener que cargar la cartera entera de 113 registros
       * para pintar una fila. `null` explícito y no omitido: al vencerse o
       * anularse la prórroga, este `$set` tiene que borrar el valor anterior.
       */
      prorrogaHasta: cartera.prorroga?.hasta || null,
    };

    if (!existente) {
      await db.collection(COL_EQUIPOS).insertOne({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ...desdeCartera,
        brand: '',
        model: '',
        // Provisionales hasta la primera reconciliación: aquí todavía no se ha
        // hablado con el proveedor. Si el equipo ya venía bloqueado de antes,
        // `reconciliarEquipo` adopta su estado real como intención, porque
        // nadie ha pedido nada y una diferencia sin orden no es una orden.
        status: 'active',
        intencion: 'active',
        plataforma: 'desconocida' as Plataforma,
        enrolledInMDM: false,
        autoBloqueo: true,
        lastCheckIn: null,
        lastSync: null,
        createdAt: registro.createdAt || new Date().toISOString(),
      });
      creados++;
    } else {
      // Sólo los campos que manda la cartera. `status`, `plataforma` y
      // `lastCheckIn` son del proveedor y los escribe la reconciliación.
      await db.collection(COL_EQUIPOS).updateOne({ imei }, { $set: desdeCartera });
      actualizados++;
    }
  }

  return { creados, actualizados, sinImei };
}

/**
 * Pregunta al proveedor por un equipo y guarda lo que diga.
 *
 * De paso resuelve la plataforma: si Trustonic lo reconoce es `trustonic`; si
 * responde que no es nuestro (404/409), está en Nuovo. No hay forma de
 * preguntárselo a Nuovo, así que se deduce por descarte — pero es fiable,
 * porque toda la cartera está en una de las dos.
 */
async function reconciliarEquipo(deps: DepsBloqueo, equipo: any): Promise<void> {
  const db = deps.getDb();
  if (!db) return;

  const { encontrado, dispositivo, respuesta } = await consultarUno(equipo.imei);
  const ahora = new Date().toISOString();

  // Un fallo de red no es una respuesta: no se toca el estado guardado, porque
  // marcar "desconocida" por un timeout haría que el panel pareciera romperse
  // cada vez que la red tiene un hipo.
  if (!respuesta.ok && respuesta.status === 0) {
    await db.collection(COL_EQUIPOS).updateOne(
      { imei: equipo.imei },
      { $set: { ultimoErrorApi: respuesta.error || 'sin respuesta', lastSyncIntento: ahora } }
    );
    return;
  }

  if (!encontrado) {
    await db.collection(COL_EQUIPOS).updateOne(
      { imei: equipo.imei },
      {
        $set: {
          plataforma: 'nuovo' as Plataforma,
          enrolledInMDM: false,
          lastSync: ahora,
          ultimoErrorApi: null,
        },
      }
    );
    return;
  }

  const d = dispositivo as DispositivoHbm;
  const estadoReal = estadoDesdeHbm(d.stateInfo);
  const horas = horasDesdeCheckIn(d.lastCheckIn);

  /**
   * Equipos que ya estaban bloqueados (o liberados) en el proveedor antes de
   * existir CrediLock. Al crearlos, `sincronizarDesdeCartera` les pone
   * `intencion: 'active'` a ciegas, así que quedaban divergentes para siempre y
   * el panel anunciaba un "desbloqueo en cola" que nadie pidió nunca.
   *
   * Si no hay rastro de ninguna orden, lo que dice el proveedor ES la intención:
   * no hay nada en camino que confirmar. En cuanto se manda una orden real esta
   * adopción deja de aplicar y la divergencia vuelve a significar lo que debe.
   */
  const nuncaSeMandoOrden = !equipo.ordenBloqueoEnviadaEn && !equipo.ordenDesbloqueoEnviadaEn;
  const adoptarEstadoDelProveedor =
    nuncaSeMandoOrden && equipo.intencion !== estadoReal ? { intencion: estadoReal } : {};

  await db.collection(COL_EQUIPOS).updateOne(
    { imei: equipo.imei },
    {
      $set: {
        ...adoptarEstadoDelProveedor,
        plataforma: 'trustonic' as Plataforma,
        enrolledInMDM: true,
        status: estadoReal,
        trustonicState: d.stateInfo || null,
        brand: d.deviceManufacturer || equipo.brand || '',
        model: d.deviceMarketName || d.deviceModel || equipo.model || '',
        lastCheckIn: d.lastCheckIn || null,
        horasSinReportar: horas,
        incomunicado: horas === null || horas > HORAS_PARA_DAR_POR_INCOMUNICADO,
        organizacionEnEquipo: d.additionalInfo?.['Organization Name'] || null,
        imsiLock: d.imsiInfo?.['IMSI Lock'] ?? null,
        lastSync: ahora,
        ultimoErrorApi: null,
        ...(estadoReal === 'blocked' && !equipo.blockedAt ? { blockedAt: ahora } : {}),
        ...(estadoReal === 'active' && equipo.status === 'blocked' ? { blockedAt: null } : {}),
      },
    }
  );

  // Divergencia REAL: hay una orden enviada que el proveedor todavía no refleja.
  // Lo más común es un bloqueo mandado a un equipo apagado. No se reenvía desde
  // aquí a propósito: el dueño decide si reintenta o anula, y un reenvío
  // automático en cada reconciliación martillearía al proveedor sin que nadie
  // lo haya pedido.
  if (equipo.intencion && equipo.intencion !== estadoReal && !nuncaSeMandoOrden) {
    console.log(
      `[credilock] ${enmascararImei(equipo.imei)} divergente: queremos ${equipo.intencion}, el proveedor dice ${estadoReal}.`
    );
  }
}

/* ══════════════════════════  Acciones  ══════════════════════════ */

export interface ResultadoAccion {
  ok: boolean;
  /** Mensaje para mostrarle al administrador en el panel. */
  mensaje: string;
  /** true si la acción quedó pedida pero aún no confirmada por el proveedor. */
  pendienteDeEntrega?: boolean;
  respuesta?: RespuestaHbm;
}

/** Nunca se bloquea a ciegas: estas comprobaciones van antes de cada acción. */
function revisarAntesDeActuar(equipo: any): string | null {
  if (!trustonicConfigurado()) {
    return 'Trustonic no está configurado en el servidor (faltan TRUSTONIC_BASE_URL o TRUSTONIC_TOKEN).';
  }
  if (!imeiValido(equipo?.imei)) {
    return `El IMEI "${equipo?.imei}" no es válido; corrígelo antes de operar sobre este equipo.`;
  }
  if (equipo.plataforma === 'nuovo') {
    return (
      'Este equipo está enrolado en Nuovo, no en Trustonic, y esta API no lo alcanza. ' +
      'Hay que bloquearlo a mano desde el portal de Nuovo.'
    );
  }
  return null;
}

/**
 * Pide el bloqueo y NO da por hecho que entró.
 *
 * REQUEST_SUCCESS aquí significa "el proveedor aceptó la orden", no "el
 * teléfono está bloqueado". Si está apagado, la orden se queda esperando. Por
 * eso se guarda la intención y se deja que la reconciliación confirme.
 */
async function aplicarBloqueo(
  deps: DepsBloqueo,
  equipo: any,
  motivo: string,
  usuario: string
): Promise<ResultadoAccion> {
  const db = deps.getDb();
  const problema = revisarAntesDeActuar(equipo);
  if (problema) return { ok: false, mensaje: problema };

  const { fecha: hoy } = hoyColombia();
  const registro = equipo.financingId
    ? await db.collection('financing').findOne({ id: equipo.financingId })
    : null;
  const cartera = resumirCartera(registro || {}, hoy);
  // Si la asignación del código falla, el bloqueo sigue adelante sin link. Lo
  // que no puede pasar es que un equipo se quede sin bloquear porque no hubo
  // forma de generar una URL bonita.
  const linkCorto = registro ? await deps.linkCortoPortal?.(registro).catch(() => null) : null;
  const { titulo, mensaje } = textoBloqueo(deps.nombreBonito(equipo.owner || ''), cartera, linkCorto);

  const respuesta = await bloquear(equipo.imei, titulo, mensaje);
  const ahora = new Date().toISOString();

  await db.collection(COL_EQUIPOS).updateOne(
    { imei: equipo.imei },
    {
      $set: {
        intencion: 'blocked',
        reason: motivo,
        ordenBloqueoEnviadaEn: ahora,
        // Quién pidió el bloqueo. El automatismo no debe deshacer lo que el
        // dueño decidió a mano: ver `decidir`.
        bloqueoManual: usuario !== 'automatismo',
        ultimoErrorApi: respuesta.ok ? null : respuesta.error || `HTTP ${respuesta.status}`,
      },
    }
  );

  await auditar(deps, {
    deviceId: equipo.id,
    imei: equipo.imei,
    action: 'block',
    user: usuario,
    reason: motivo,
    deviceInfo: `${equipo.brand || ''} ${equipo.model || ''} — ${equipo.owner || ''}`.trim(),
    metadata: {
      cuotasVencidas: cartera.vencidas,
      diasDeMora: cartera.diasDeMora,
      saldo: cartera.saldo,
      httpStatus: respuesta.status,
      resultCode: respuesta.cuerpo?.dataResponse?.resultCode,
      respuesta: respuesta.cuerpo,
    },
  });

  if (!respuesta.ok) {
    return {
      ok: false,
      mensaje: `El proveedor rechazó el bloqueo: ${respuesta.error || `HTTP ${respuesta.status}`}`,
      respuesta,
    };
  }

  // Si lleva días sin reportar, decirlo. Es la diferencia entre "ya está" y
  // "hay que llamar al cliente".
  const horas = equipo.horasSinReportar;
  const dudoso = horas === null || horas === undefined || horas > HORAS_PARA_DAR_POR_INCOMUNICADO;

  if (dudoso) {
    return {
      ok: true,
      pendienteDeEntrega: true,
      mensaje:
        'Orden de bloqueo aceptada, pero el equipo no reporta desde hace ' +
        (horas == null ? 'nunca' : `${Math.round(horas)} h`) +
        '. Si está apagado o sin datos, el bloqueo entrará cuando se conecte. ' +
        'El panel lo confirmará solo.',
      respuesta,
    };
  }

  return {
    ok: true,
    pendienteDeEntrega: true,
    mensaje: 'Orden de bloqueo aceptada. Suele entrar en menos de un minuto; se confirmará solo.',
    respuesta,
  };
}

async function aplicarDesbloqueo(
  deps: DepsBloqueo,
  equipo: any,
  usuario: string,
  motivo = 'Desbloqueo manual'
): Promise<ResultadoAccion> {
  const db = deps.getDb();
  const problema = revisarAntesDeActuar(equipo);
  if (problema) return { ok: false, mensaje: problema };

  const respuesta = await desbloquear(equipo.imei);

  await db.collection(COL_EQUIPOS).updateOne(
    { imei: equipo.imei },
    {
      $set: {
        intencion: 'active',
        reason: null,
        bloqueoManual: false,
        ordenDesbloqueoEnviadaEn: new Date().toISOString(),
        ultimoErrorApi: respuesta.ok ? null : respuesta.error || `HTTP ${respuesta.status}`,
      },
    }
  );

  await auditar(deps, {
    deviceId: equipo.id,
    imei: equipo.imei,
    action: 'unblock',
    user: usuario,
    reason: motivo,
    deviceInfo: `${equipo.brand || ''} ${equipo.model || ''} — ${equipo.owner || ''}`.trim(),
    metadata: { httpStatus: respuesta.status, respuesta: respuesta.cuerpo },
  });

  if (!respuesta.ok) {
    return {
      ok: false,
      mensaje: `El proveedor rechazó el desbloqueo: ${respuesta.error || `HTTP ${respuesta.status}`}`,
      respuesta,
    };
  }
  return { ok: true, pendienteDeEntrega: true, mensaje: 'Orden de desbloqueo aceptada.', respuesta };
}

/* ══════════════════════════  Política de mora  ══════════════════════════ */

export interface Decision {
  imei: string;
  owner: string;
  accion: 'bloquear' | 'desbloquear' | 'liberar' | 'avisar_pantalla' | 'nada';
  motivo: string;
}

/**
 * Decide qué hacer con un equipo. Función pura: no llama a la API ni a Mongo.
 *
 * Está separada para poder razonarla y probarla sin tocar un teléfono. Es la
 * pieza que decide dejar a alguien sin servicio, así que tiene que poder
 * leerse de corrido y no esconder nada detrás de un await.
 */
export function decidir(
  equipo: any,
  cartera: EstadoCartera,
  config: ConfigBloqueo,
  ahora: { fecha: string; hora: number; minuto: number }
): Decision {
  const base = { imei: equipo.imei, owner: equipo.owner || '' };

  if (equipo.plataforma !== 'trustonic') {
    return { ...base, accion: 'nada', motivo: 'No está en Trustonic; se gestiona a mano.' };
  }
  if (equipo.autoBloqueo === false) {
    return { ...base, accion: 'nada', motivo: 'Automatismo desactivado para este equipo.' };
  }

  // Terminó de pagar: liberarlo es lo correcto y es irreversible, así que sólo
  // se propone cuando la cartera lo confirma.
  if (cartera.liquidado) {
    return equipo.status === 'blocked'
      ? { ...base, accion: 'desbloquear', motivo: 'Terminó de pagar y sigue bloqueado.' }
      : { ...base, accion: 'liberar', motivo: 'Terminó de pagar; corresponde liberar el equipo.' };
  }

  // Pagó lo vencido: desbloquear tiene prioridad sobre todo lo demás. Un
  // cliente que pagó y sigue bloqueado es el peor fallo posible de este
  // sistema, bastante peor que uno que debe y no está bloqueado.
  if (cartera.vencidas === 0) {
    if (equipo.status === 'blocked' || equipo.intencion === 'blocked') {
      // Un bloqueo que pidió una persona no se deshace solo. El automatismo
      // sólo sabe de cuotas, y se bloquea a mano por cosas que no están en la
      // cartera: equipo reportado como robado, cliente que desapareció con el
      // teléfono, acuerdo roto. Si el automatismo lo desbloqueara por "está al
      // día", devolvería el teléfono justo en el caso en que el dueño ya había
      // decidido lo contrario — y en silencio.
      if (equipo.bloqueoManual) {
        return { ...base, accion: 'nada', motivo: 'Bloqueado a mano; sólo se quita a mano.' };
      }
      /**
       * El motivo se escribe en la bitácora y es lo que el dueño lee para
       * entender por qué se movió un teléfono. "No tiene cuotas vencidas" sobre
       * alguien que no ha pagado nada parece un error del sistema; decir que fue
       * la prórroga lo explica.
       */
      return cartera.prorroga
        ? { ...base, accion: 'desbloquear', motivo: `Tiene prórroga hasta el ${cartera.prorroga.hasta}.` }
        : { ...base, accion: 'desbloquear', motivo: 'No tiene cuotas vencidas.' };
    }
    // Aviso en pantalla el día antes, que es cuando sirve de algo. Cuenta sobre
    // la fecha de la prórroga si la hay: avisarle "vence mañana" el día antes de
    // la fecha original, cuando se le dio plazo hasta la semana siguiente, es
    // desdecirse en la pantalla del teléfono.
    if (config.avisoEnPantallaActivo && cartera.proxima) {
      const limite = fechaLimite(cartera.proxima);
      const dias = diasEntre(ahora.fecha, limite);
      if (dias === 1 && equipo.avisoPantallaEnviado !== limite) {
        return {
          ...base,
          accion: 'avisar_pantalla',
          motivo: cartera.prorroga ? 'Su prórroga vence mañana.' : 'Su cuota vence mañana.',
        };
      }
    }
    return {
      ...base,
      accion: 'nada',
      motivo: cartera.prorroga ? `Con prórroga hasta el ${cartera.prorroga.hasta}.` : 'Al día.',
    };
  }

  // Hay mora. Dos frenos antes de bloquear, y los dos son promesas hechas al
  // cliente, no cortesías: los días de gracia configurados, y la hora pactada
  // que los recordatorios de WhatsApp le anuncian como "a las HH:MM".
  //
  // `diasDeMora` nunca vale 0 aquí: una cuota que vence hoy no cuenta como
  // vencida, la mora empieza en 1. Así que el primer día en el que se puede
  // bloquear es el mayor entre 1 y los días de gracia, y con gracia 0 el primer
  // día sigue respetando la hora pactada en vez de bloquear a medianoche.
  const primerDiaConBloqueo = Math.max(1, config.diasDeGracia);

  if (cartera.diasDeMora < primerDiaConBloqueo) {
    return {
      ...base,
      accion: 'nada',
      motivo: `En mora de ${cartera.diasDeMora} día(s), dentro de los ${config.diasDeGracia} día(s) de gracia.`,
    };
  }

  if (cartera.diasDeMora === primerDiaConBloqueo) {
    const [hPactada, mPactada] = String(equipo.horaBloqueo || '08:00').split(':').map(Number);
    const minutosAhora = ahora.hora * 60 + ahora.minuto;
    const minutosPactados = (hPactada || 8) * 60 + (mPactada || 0);
    if (minutosAhora < minutosPactados) {
      return {
        ...base,
        accion: 'nada',
        motivo: `En mora, pero aún no llega la hora pactada (${equipo.horaBloqueo || '08:00'}).`,
      };
    }
  }

  if (equipo.status === 'blocked' && equipo.intencion === 'blocked') {
    return { ...base, accion: 'nada', motivo: 'Ya está bloqueado.' };
  }

  return {
    ...base,
    accion: 'bloquear',
    motivo:
      `${cartera.vencidas} cuota(s) vencida(s), ${cartera.diasDeMora} día(s) de mora, ` +
      `saldo ${pesos(cartera.saldo)}.`,
  };
}

/**
 * Recorre la cartera, decide y ejecuta. Es el corazón del automatismo.
 *
 * En simulación hace todo menos llamar a la API, y deja las decisiones en el
 * historial. Así el dueño puede ver una semana de "esto habría hecho" antes de
 * encenderlo.
 */
async function ejecutarPolitica(deps: DepsBloqueo): Promise<Decision[]> {
  const db = deps.getDb();
  if (!db) return [];

  const config = await leerConfig(deps);
  const ahora = hoyColombia();
  const equipos = await db.collection(COL_EQUIPOS).find({ financingStatus: { $ne: 'cancelled' } }).toArray();

  const decisiones: Decision[] = [];
  let bloqueosHechos = 0;

  for (const equipo of equipos) {
    const registro = await db.collection('financing').findOne({ id: equipo.financingId });
    if (!registro) continue;

    const cartera = resumirCartera(registro, ahora.fecha);
    const decision = decidir(equipo, cartera, config, ahora);
    if (decision.accion === 'nada') continue;

    decisiones.push(decision);

    // Apagado del todo: ni actúa ni escribe. Antes dejaba una entrada
    // `simulado:*` por equipo y por vuelta, así que el historial se llenaba de
    // decisiones que nadie pidió y el dueño leía "desbloquear" un minuto
    // después de bloquear a mano, creyendo que el panel se había contradicho.
    // Las decisiones siguen consultables en /preview, que no escribe nada.
    if (!config.autoBloqueoActivo) continue;

    // Encendido pero en simulación: ahí sí interesa el registro, porque el
    // objetivo de la simulación es poder revisar después qué habría hecho.
    if (config.simulacion) {
      await auditar(deps, {
        deviceId: equipo.id,
        imei: equipo.imei,
        action: `simulado:${decision.accion}`,
        user: 'automatismo',
        reason: decision.motivo,
        deviceInfo: `${equipo.brand || ''} ${equipo.model || ''} — ${equipo.owner || ''}`.trim(),
        metadata: { simulacion: true, autoBloqueoActivo: config.autoBloqueoActivo },
      });
      continue;
    }

    if (decision.accion === 'bloquear') {
      // El tope existe para que un error de datos no vacíe la calle de
      // teléfonos en una sola vuelta. Lo que sobra espera a la siguiente.
      if (bloqueosHechos >= config.maxBloqueosPorVuelta) {
        console.log(
          `[credilock] Tope de ${config.maxBloqueosPorVuelta} bloqueos por vuelta alcanzado; ` +
            `el resto espera a la próxima.`
        );
        break;
      }
      const r = await aplicarBloqueo(deps, equipo, `Automático: ${decision.motivo}`, 'automatismo');
      if (r.ok) {
        bloqueosHechos++;
        await avisarPorWhatsApp(deps, equipo, registro, 'bloqueado');
      }
    } else if (decision.accion === 'desbloquear') {
      const r = await aplicarDesbloqueo(deps, equipo, 'automatismo', `Automático: ${decision.motivo}`);
      if (r.ok) await avisarPorWhatsApp(deps, equipo, registro, 'desbloqueado');
    } else if (decision.accion === 'avisar_pantalla') {
      const { titulo, contenido } = textoAvisoPantalla(cartera);
      const r = await notificar(equipo.imei, titulo, contenido);
      if (r.ok && cartera.proxima) {
        await db.collection(COL_EQUIPOS).updateOne(
          { imei: equipo.imei },
          { $set: { avisoPantallaEnviado: fechaLimite(cartera.proxima) } }
        );
      }
      await auditar(deps, {
        deviceId: equipo.id,
        imei: equipo.imei,
        action: 'notify',
        user: 'automatismo',
        reason: decision.motivo,
        deviceInfo: `${equipo.brand || ''} ${equipo.model || ''}`.trim(),
        metadata: { httpStatus: r.status, respuesta: r.cuerpo },
      });
    } else if (decision.accion === 'liberar') {
      // DEVICE_RELEASE es irreversible: después ya no se puede volver a
      // bloquear. No se automatiza; se deja como alerta para que lo apruebe
      // una persona desde el panel.
      await alertar(
        deps,
        equipo.id,
        'payment_completed',
        `${equipo.owner} terminó de pagar. Corresponde liberar el equipo en Trustonic ` +
          `(acción irreversible, confírmala desde el panel).`
      );
    }

    await new Promise((r) => setTimeout(r, 1200));
  }

  return decisiones;
}

/** Avisa al cliente por WhatsApp. El bloqueo sin explicación genera llamadas. */
async function avisarPorWhatsApp(
  deps: DepsBloqueo,
  equipo: any,
  registro: any,
  que: 'bloqueado' | 'desbloqueado'
): Promise<void> {
  if (!deps.whatsappListo()) return;
  const nombre = deps.nombreBonito(equipo.owner || '');
  const { fecha: hoy } = hoyColombia();
  const cartera = resumirCartera(registro, hoy);

  let texto: string;
  if (que === 'bloqueado') {
    texto =
      `🔒 *CREDILOCK — Equipo bloqueado*\n\nHola *${nombre}*, tu equipo fue bloqueado por ` +
      `${cartera.vencidas} cuota(s) pendiente(s) (${pesos(cartera.saldo)}).\n\n` +
      `✅ Al registrar el pago se desbloquea automáticamente.\n\n📞 ${TELEFONO_TIENDA}\n\n` +
      `_CREDILOCK — Sistema de financiamiento_`;
    texto = conLinkDePago(deps, registro, texto);
  } else {
    texto =
      `🔓 *CREDILOCK — Equipo desbloqueado*\n\nHola *${nombre}*, ya registramos tu pago y tu ` +
      `equipo quedó desbloqueado.\n\nCuotas pagadas: ${cartera.pagadas}/${cartera.totalCuotas}\n\n` +
      `Gracias por estar al día.\n\n_CREDILOCK — Sistema de financiamiento_`;
  }

  await deps.enviarWhatsApp(equipo.phoneNumber || registro.telefono, texto).catch(() => false);
}

/**
 * Le confirma al cliente el plazo que se le acaba de dar.
 *
 * Va aparte de `avisarPorWhatsApp` porque se manda SIEMPRE, y ésa sólo se
 * dispara cuando un teléfono se mueve. El caso corriente de una prórroga es
 * precisamente el del teléfono que todavía no está bloqueado: el cliente llama
 * el día que le toca la cuota y pide unos días, y el bloqueo no llegaría hasta
 * la mañana siguiente. Colgado de `liberarPorqueYaNoDebe`, ese cliente —la
 * mayoría— no recibía nada, y el único registro del acuerdo quedaba en la
 * memoria de quien atendió la llamada.
 *
 * El plazo llega por parámetro y no se lee de `resumirCartera`: ahí sólo está
 * la prórroga de la *próxima* cuota, y si el dueño da plazo sobre una posterior
 * el mensaje anunciaría una fecha que no es la que se acaba de pactar.
 */
export async function avisarDeProrroga(
  deps: DepsBloqueo,
  financingId: string,
  hasta: string,
  cuotaNumber: number,
  seDesbloqueo: boolean
): Promise<void> {
  try {
    if (!deps.whatsappListo()) return;
    const db = deps.getDb();
    if (!db) return;
    const registro = await db.collection('financing').findOne({ id: financingId });
    if (!registro) return;

    const nombre = deps.nombreBonito(registro.nombre || '');
    const plazo = fechaLarga(hasta);
    const valor = pesos(Number(registro.valorCuota || 0));

    /**
     * Ninguna de las dos versiones dice "ya registramos tu pago". El cliente no
     * ha pagado: decírselo sería regalarle la cuota por un error de redacción, y
     * es justo el mensaje que guardaría como prueba de que no debe nada.
     */
    const texto = seDesbloqueo
      ? `🔓 *CREDILOCK — Equipo desbloqueado con plazo*\n\nHola *${nombre}*, te dimos plazo hasta el ` +
        `*${plazo}* para tu cuota #${cuotaNumber} de *${valor}* y tu equipo ya quedó desbloqueado.\n\n` +
        `⚠️ *La cuota sigue pendiente.* Si no se paga dentro del plazo, el equipo se vuelve a ` +
        `bloquear.\n\n📞 ${TELEFONO_TIENDA}\n\n_CREDILOCK — Sistema de financiamiento_`
      : `⏳ *CREDILOCK — Tienes plazo*\n\nHola *${nombre}*, quedó registrado que tienes plazo hasta el ` +
        `*${plazo}* para pagar tu cuota #${cuotaNumber} de *${valor}*.\n\n` +
        `⚠️ *La cuota sigue pendiente.* Si no se paga dentro del plazo, el equipo será ` +
        `bloqueado.\n\n📞 ${TELEFONO_TIENDA}\n\n_CREDILOCK — Sistema de financiamiento_`;

    // Las dos versiones dejan la cuota pendiente, así que las dos llevan link:
    // si puede pagarla dentro del plazo, mejor para todos.
    await deps.enviarWhatsApp(registro.telefono, conLinkDePago(deps, registro, texto)).catch(() => false);
  } catch (err) {
    // Que falle el aviso no puede tumbar la prórroga: el plazo ya está guardado
    // y es lo que respeta el automatismo. El dueño siempre puede reenviarlo.
    console.error('[credilock] Error avisando de la prórroga:', err);
  }
}

/** Qué pasó con el teléfono. Lo necesita la ruta para poder contárselo al dueño. */
export interface ResultadoLiberacion {
  liberado: boolean;
  /** Legible, para mostrar en el panel. Vacío cuando no había nada que hacer. */
  detalle: string;
}

/**
 * Suelta el teléfono cuando la cartera dice que ya no hay por qué retenerlo.
 *
 * Es el mismo camino para las dos razones por las que eso puede pasar —el
 * cliente pagó, o se le dio plazo— y está unificado a propósito: son la misma
 * decisión ("¿seguimos teniendo motivo para tenerlo bloqueado?") y tenerla
 * escrita dos veces es como se consigue que una de las dos se quede sin el
 * arreglo la próxima vez.
 */
async function liberarPorqueYaNoDebe(
  deps: DepsBloqueo,
  financingId: string,
  opts: {
    usuario: string;
    motivo: string;
    /**
     * Qué WhatsApp mandar si el equipo llega a soltarse, o `null` para que lo
     * mande quien llama. La prórroga pasa `null`: su aviso tiene que salir
     * también cuando el teléfono no estaba bloqueado, que es el caso corriente,
     * y desde aquí sólo se vería el que sí se movió.
     */
    aviso: 'desbloqueado' | null;
    /** Si un humano lo bloqueó a mano, ¿lo dejamos en paz? */
    respetarBloqueoManual: boolean;
  }
): Promise<ResultadoLiberacion> {
  const db = deps.getDb();
  if (!db) return { liberado: false, detalle: '' };

  const equipo = await db.collection(COL_EQUIPOS).findOne({ financingId });
  if (!equipo) return { liberado: false, detalle: '' };
  if (equipo.plataforma !== 'trustonic') {
    return { liberado: false, detalle: 'El equipo no se gestiona desde Trustonic; si está bloqueado hay que soltarlo a mano.' };
  }

  const registro = await db.collection('financing').findOne({ id: financingId });
  if (!registro) return { liberado: false, detalle: '' };

  const { fecha: hoy } = hoyColombia();
  const cartera = resumirCartera(registro, hoy);
  if (cartera.vencidas > 0) {
    return {
      liberado: false,
      detalle: `Sigue con ${cartera.vencidas} cuota(s) vencida(s), así que el equipo no se suelta.`,
    };
  }

  const estaBloqueado = equipo.status === 'blocked' || equipo.intencion === 'blocked';
  if (!estaBloqueado) return { liberado: false, detalle: '' };

  /**
   * Un bloqueo puesto a mano no se deshace por una prórroga. Se bloquea a mano
   * por cosas que la cartera no sabe —equipo reportado como robado, cliente
   * desaparecido— y una prórroga habla de fechas de pago, no de eso. Al pagar
   * sí se suelta: ahí el dueño está afirmando que el dinero entró.
   */
  if (opts.respetarBloqueoManual && equipo.bloqueoManual) {
    return {
      liberado: false,
      detalle: 'El equipo fue bloqueado a mano, así que sigue bloqueado. Si quieres soltarlo, usa Desbloquear.',
    };
  }

  const r = await aplicarDesbloqueo(deps, equipo, opts.usuario, opts.motivo);
  if (!r.ok) {
    return { liberado: false, detalle: `No se pudo desbloquear: ${r.mensaje || 'el proveedor rechazó la orden'}.` };
  }

  console.log(`[credilock] ${enmascararImei(equipo.imei)} desbloqueado: ${opts.motivo}`);
  if (opts.aviso) await avisarPorWhatsApp(deps, equipo, registro, opts.aviso);
  return { liberado: true, detalle: 'El equipo quedó desbloqueado.' };
}

/**
 * Se llama justo después de marcar una cuota como pagada.
 *
 * Es la automatización que más se nota: el cliente paga en el mostrador y el
 * teléfono se le desbloquea mientras sigue ahí, sin que nadie entre al panel.
 * Antes esto era una tarea manual que se olvidaba, y un cliente que pagó y
 * sigue bloqueado es la peor cara posible del sistema.
 */
export async function alRegistrarPago(deps: DepsBloqueo, financingId: string): Promise<void> {
  try {
    await liberarPorqueYaNoDebe(deps, financingId, {
      usuario: 'pago-registrado',
      motivo: 'Pago registrado: ya no tiene cuotas vencidas',
      aviso: 'desbloqueado',
      respetarBloqueoManual: false,
    });
  } catch (err) {
    console.error('[credilock] Error desbloqueando tras el pago:', err);
  }
}

/**
 * Copia al equipo el plazo que esté abierto ahora mismo en su cartera.
 *
 * `sincronizarDesdeCartera` ya lo hace, pero sólo cada media hora. Sin esto, el
 * dueño concede un plazo, se pasa a la pestaña de Bloqueo y encuentra el equipo
 * con cuotas atrasadas, sin mora y sin bloquear, sin nada que explique por qué:
 * el hueco duraba hasta treinta minutos y caía justo en el momento en que se va
 * a mirar. Pasa el valor por `$set` incluso cuando es `null`, porque al anular
 * una prórroga hay que borrar la fecha anterior, no dejarla puesta.
 */
async function refrescarPlazoDelEquipo(deps: DepsBloqueo, financingId: string): Promise<void> {
  try {
    const db = deps.getDb();
    if (!db) return;
    const registro = await db.collection('financing').findOne({ id: financingId });
    if (!registro) return;
    const { fecha: hoy } = hoyColombia();
    const cartera = resumirCartera(registro, hoy);
    await db.collection(COL_EQUIPOS).updateOne(
      { financingId },
      { $set: { prorrogaHasta: cartera.prorroga?.hasta || null } }
    );
  } catch (err) {
    // Es un dato de presentación: si falla, la próxima vuelta lo arregla. Lo que
    // no puede hacer es tumbar la prórroga, que ya está guardada.
    console.error('[credilock] No se pudo refrescar el plazo en el equipo:', err);
  }
}

/** Mantiene al día lo que el panel de bloqueo muestra tras anular un plazo. */
export async function alAnularProrroga(deps: DepsBloqueo, financingId: string): Promise<void> {
  await refrescarPlazoDelEquipo(deps, financingId);
}

/**
 * Se llama justo después de conceder una prórroga.
 *
 * Sin esto la prórroga sería un adorno: el dueño le diría al cliente "tienes
 * hasta el viernes" y el teléfono seguiría bloqueado hasta que alguien se
 * acordara de soltarlo a mano. Devuelve lo que pasó para que el panel lo diga
 * en el mismo aviso, en vez de dejar al dueño adivinando si el equipo se movió.
 *
 * El WhatsApp se manda aquí y no dentro de `liberarPorqueYaNoDebe` porque el
 * cliente tiene que recibir la confirmación del plazo haya pasado algo con el
 * teléfono o no: lo habitual es que llame el día de la cuota, antes de que el
 * automatismo bloquee nada. Si el aviso dependiera del desbloqueo, la mayoría
 * de las prórrogas no dejarían más rastro que la memoria de quien atendió.
 */
export async function alOtorgarProrroga(
  deps: DepsBloqueo,
  financingId: string,
  hasta: string,
  cuotaNumber: number
): Promise<ResultadoLiberacion> {
  let r: ResultadoLiberacion = { liberado: false, detalle: '' };
  try {
    r = await liberarPorqueYaNoDebe(deps, financingId, {
      usuario: 'prorroga',
      motivo: `Prórroga concedida hasta el ${hasta}`,
      aviso: null,
      respetarBloqueoManual: true,
    });
  } catch (err) {
    console.error('[credilock] Error desbloqueando tras la prórroga:', err);
    r = { liberado: false, detalle: 'La prórroga quedó guardada, pero falló el desbloqueo del equipo. Revísalo en CrediLock.' };
  }

  await refrescarPlazoDelEquipo(deps, financingId);
  await avisarDeProrroga(deps, financingId, hasta, cuotaNumber, r.liberado);
  return r;
}

/* ══════════════════════════  Rutas  ══════════════════════════ */

function usuarioDe(req: Request): string {
  return (req as any).sesion?.usuario || 'admin';
}

/** Lo que ve el panel. Añade lo que la UI necesita para no mentir. */
function paraElPanel(equipo: any) {
  /**
   * Cuándo salió la última orden. El panel lo necesita para poder decir
   * "en cola desde hace 4 min" después de recargar la página: sin esto el
   * contador nacía de cero en cada F5 y el dueño no sabía si la orden llevaba
   * un minuto o dos días esperando a que el teléfono se conectara.
   */
  const ordenEnviadaEn: string | null =
    (equipo.intencion === 'blocked' ? equipo.ordenBloqueoEnviadaEn : equipo.ordenDesbloqueoEnviadaEn) || null;

  return {
    id: equipo.id,
    imei: equipo.imei,
    brand: equipo.brand || '',
    model: equipo.model || equipo.producto || '',
    phoneNumber: equipo.phoneNumber || '',
    owner: equipo.owner || '',
    status: equipo.status || 'active',
    intencion: equipo.intencion || 'active',
    plataforma: equipo.plataforma || 'desconocida',
    gestionManual: equipo.plataforma !== 'trustonic',
    enrolledInMDM: Boolean(equipo.enrolledInMDM),
    blockedAt: equipo.blockedAt || undefined,
    createdAt: equipo.createdAt,
    reason: equipo.reason || undefined,
    lastSync: equipo.lastSync || undefined,
    lastCheckIn: equipo.lastCheckIn || null,
    horasSinReportar: equipo.horasSinReportar ?? null,
    incomunicado: Boolean(equipo.incomunicado),
    trustonicState: equipo.trustonicState || null,
    /**
     * Sólo es divergencia si HAY una orden esperando. Antes bastaba con que
     * `intencion` y `status` no coincidieran, y eso marcaba como "orden en cola"
     * a los equipos que ya estaban bloqueados en el proveedor desde antes de
     * CrediLock: nadie había pedido nada, pero el panel ofrecía "Reintentar" y
     * "Anular orden" sobre una orden inexistente.
     */
    divergente: Boolean(ordenEnviadaEn && equipo.intencion !== equipo.status),
    bloqueoManual: Boolean(equipo.bloqueoManual),
    ordenEnviadaEn,
    cuotasVencidas: equipo.cuotasVencidas ?? 0,
    cuotasPagadas: equipo.cuotasPagadas ?? 0,
    totalCuotas: equipo.totalCuotas ?? 0,
    saldo: equipo.saldo ?? 0,
    diasDeMora: equipo.diasDeMora ?? 0,
    liquidado: Boolean(equipo.liquidado),
    /** Plazo concedido que sigue abierto, o null. Ver `prorrogaHasta` en el sync. */
    prorrogaHasta: equipo.prorrogaHasta || null,
    autoBloqueo: equipo.autoBloqueo !== false,
    financingId: equipo.financingId || null,
    ultimoErrorApi: equipo.ultimoErrorApi || null,
    organizacionEnEquipo: equipo.organizacionEnEquipo || null,
  };
}

export function registrarBloqueo(app: Express, deps: DepsBloqueo): void {
  const db = () => deps.getDb();

  /**
   * Relee el equipo tras actuar sobre él y lo devuelve ya listo para el panel.
   *
   * Va en la misma respuesta de block/unblock para que la fila cambie en el
   * acto. Antes el panel tenía que pedir los 115 equipos otra vez, así que
   * durante un segundo seguía mostrando el estado viejo y parecía que el botón
   * no había hecho nada.
   */
  async function equipoFresco(id: string) {
    const doc = await db().collection(COL_EQUIPOS).findOne({ id });
    return doc ? paraElPanel(doc) : null;
  }

  /* ---- equipos ---- */

  app.get('/api/blocking/devices', async (_req: Request, res: Response) => {
    try {
      const equipos = await db().collection(COL_EQUIPOS).find({}).sort({ owner: 1 }).toArray();
      res.json(equipos.map(paraElPanel));
    } catch (error) {
      console.error('[credilock] Error listando equipos:', error);
      res.status(500).json({ error: 'Error al cargar los equipos' });
    }
  });

  app.post('/api/blocking/devices', async (req: Request, res: Response) => {
    try {
      const { imei, owner, phoneNumber, brand, model, financingId } = req.body || {};
      if (!imeiValido(imei)) {
        return res.status(400).json({ error: 'IMEI no válido: deben ser 15 dígitos con dígito de control correcto.' });
      }
      const existente = await db().collection(COL_EQUIPOS).findOne({ imei: String(imei).trim() });
      if (existente) return res.status(409).json({ error: 'Ese IMEI ya está registrado.' });

      const equipo = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        imei: String(imei).trim(),
        owner: owner || 'Sin nombre',
        phoneNumber: phoneNumber || '',
        brand: brand || '',
        model: model || '',
        financingId: financingId || null,
        status: 'active',
        intencion: 'active',
        plataforma: 'desconocida' as Plataforma,
        enrolledInMDM: false,
        autoBloqueo: true,
        createdAt: new Date().toISOString(),
      };
      await db().collection(COL_EQUIPOS).insertOne(equipo);
      await auditar(deps, {
        deviceId: equipo.id,
        imei: equipo.imei,
        action: 'add',
        user: usuarioDe(req),
        deviceInfo: `${equipo.brand} ${equipo.model} — ${equipo.owner}`.trim(),
      });

      // Resolver plataforma y estado real de inmediato: si no, el equipo nuevo
      // aparece como "desconocida" hasta la siguiente vuelta y parece roto.
      await reconciliarEquipo(deps, equipo).catch(() => {});
      const fresco = await db().collection(COL_EQUIPOS).findOne({ imei: equipo.imei });
      res.json(paraElPanel(fresco));
    } catch (error) {
      console.error('[credilock] Error creando equipo:', error);
      res.status(500).json({ error: 'Error al registrar el equipo' });
    }
  });

  app.put('/api/blocking/devices', async (req: Request, res: Response) => {
    try {
      const { id, action, reason } = req.body || {};
      if (!id || !action) return res.status(400).json({ error: 'Faltan id y action.' });

      const equipo = await db().collection(COL_EQUIPOS).findOne({ id });
      if (!equipo) return res.status(404).json({ error: 'Equipo no encontrado.' });

      if (action === 'block') {
        if (!reason || !String(reason).trim()) {
          // Sin motivo la bitácora no sirve de nada el día que haya un reclamo.
          return res.status(400).json({ error: 'El motivo del bloqueo es obligatorio.' });
        }
        const r = await aplicarBloqueo(deps, equipo, String(reason).trim(), usuarioDe(req));
        if (!r.ok) return res.status(502).json({ error: r.mensaje });
        return res.json({
          mensaje: r.mensaje,
          pendienteDeEntrega: r.pendienteDeEntrega,
          equipo: await equipoFresco(id),
        });
      }

      if (action === 'unblock') {
        const r = await aplicarDesbloqueo(deps, equipo, usuarioDe(req));
        if (!r.ok) return res.status(502).json({ error: r.mensaje });
        return res.json({
          mensaje: r.mensaje,
          pendienteDeEntrega: r.pendienteDeEntrega,
          equipo: await equipoFresco(id),
        });
      }

      if (action === 'notify') {
        const titulo = String(req.body.titulo || 'Aviso de CrediLock').slice(0, 60);
        const contenido = String(req.body.contenido || '').slice(0, 300);
        if (!contenido) return res.status(400).json({ error: 'Falta el contenido del aviso.' });
        const problema = revisarAntesDeActuar(equipo);
        if (problema) return res.status(400).json({ error: problema });
        const r = await notificar(equipo.imei, titulo, contenido);
        await auditar(deps, {
          deviceId: equipo.id,
          imei: equipo.imei,
          action: 'notify',
          user: usuarioDe(req),
          reason: contenido,
          deviceInfo: `${equipo.brand || ''} ${equipo.model || ''}`.trim(),
          metadata: { httpStatus: r.status, respuesta: r.cuerpo },
        });
        if (!r.ok) return res.status(502).json({ error: r.error || `El proveedor respondió ${r.status}.` });
        return res.json({ mensaje: 'Aviso enviado a la pantalla del equipo.' });
      }

      if (action === 'lock_message') {
        const problema = revisarAntesDeActuar(equipo);
        if (problema) return res.status(400).json({ error: problema });
        const r = await mensajeEnBloqueo(
          equipo.imei,
          String(req.body.titulo || 'Equipo bloqueado').slice(0, 60),
          String(req.body.contenido || '').slice(0, 300)
        );
        if (!r.ok) return res.status(502).json({ error: r.error || `El proveedor respondió ${r.status}.` });
        return res.json({ mensaje: 'Mensaje de la pantalla de bloqueo actualizado.' });
      }

      if (action === 'pin_unlock') {
        const challenge = String(req.body.challenge || '').trim();
        if (!challenge) {
          return res.status(400).json({ error: 'Falta el código que muestra la pantalla del equipo.' });
        }
        const problema = revisarAntesDeActuar(equipo);
        if (problema) return res.status(400).json({ error: problema });
        const r = await desbloquearConPin(equipo.imei, challenge);
        await auditar(deps, {
          deviceId: equipo.id,
          imei: equipo.imei,
          action: 'pin_unlock',
          user: usuarioDe(req),
          reason: 'Desbloqueo por PIN (equipo sin datos)',
          deviceInfo: `${equipo.brand || ''} ${equipo.model || ''}`.trim(),
          metadata: { httpStatus: r.status, respuesta: r.cuerpo },
        });
        if (!r.ok) return res.status(502).json({ error: r.error || `El proveedor respondió ${r.status}.` });
        return res.json({ mensaje: 'PIN generado.', datos: r.cuerpo?.dataResponse ?? null });
      }

      if (action === 'release') {
        const problema = revisarAntesDeActuar(equipo);
        if (problema) return res.status(400).json({ error: problema });
        // Irreversible: después de esto el equipo sale del financiamiento y ya
        // no se puede volver a bloquear nunca. Se exige confirmación explícita.
        if (req.body.confirmar !== true) {
          return res.status(400).json({
            error:
              'Liberar es irreversible: el equipo sale del financiamiento y no se podrá volver a bloquear. ' +
              'Vuelve a enviar con confirmar: true.',
          });
        }
        const r = await liberar(equipo.imei, String(reason || 'Financiamiento liquidado'));
        await auditar(deps, {
          deviceId: equipo.id,
          imei: equipo.imei,
          action: 'release',
          user: usuarioDe(req),
          reason: String(reason || 'Financiamiento liquidado'),
          deviceInfo: `${equipo.brand || ''} ${equipo.model || ''} — ${equipo.owner || ''}`.trim(),
          metadata: { httpStatus: r.status, respuesta: r.cuerpo },
        });
        if (!r.ok) return res.status(502).json({ error: r.error || `El proveedor respondió ${r.status}.` });
        await db().collection(COL_EQUIPOS).updateOne(
          { id },
          { $set: { liberado: true, liberadoEn: new Date().toISOString(), autoBloqueo: false } }
        );
        return res.json({ mensaje: 'Equipo liberado del financiamiento.' });
      }

      if (action === 'harden') {
        const problema = revisarAntesDeActuar(equipo);
        if (problema) return res.status(400).json({ error: problema });
        const resultados = {
          reseteoFabrica: await bloquearReseteoFabrica(equipo.imei),
          adb: await bloquearAdb(equipo.imei),
          reaprovisionamiento: await bloquearReaprovisionamiento(equipo.imei),
        };
        await auditar(deps, {
          deviceId: equipo.id,
          imei: equipo.imei,
          action: 'harden',
          user: usuarioDe(req),
          reason: 'Anti-evasión: reseteo de fábrica, ADB y re-aprovisionamiento',
          deviceInfo: `${equipo.brand || ''} ${equipo.model || ''}`.trim(),
          metadata: Object.fromEntries(
            Object.entries(resultados).map(([k, v]) => [k, { status: v.status, cuerpo: v.cuerpo }])
          ),
        });
        const fallidos = Object.entries(resultados).filter(([, v]) => !v.ok).map(([k]) => k);
        return res.json({
          mensaje: fallidos.length
            ? `Protecciones aplicadas parcialmente. Falló: ${fallidos.join(', ')}.`
            : 'Reseteo de fábrica, ADB y re-aprovisionamiento bloqueados.',
        });
      }

      if (action === 'set_auto') {
        const activo = req.body.autoBloqueo !== false;
        await db().collection(COL_EQUIPOS).updateOne({ id }, { $set: { autoBloqueo: activo } });
        await auditar(deps, {
          deviceId: equipo.id,
          imei: equipo.imei,
          action: activo ? 'auto_on' : 'auto_off',
          user: usuarioDe(req),
          deviceInfo: `${equipo.owner || ''}`.trim(),
        });
        return res.json({ mensaje: activo ? 'Automatismo activado para este equipo.' : 'Automatismo desactivado para este equipo.' });
      }

      if (action === 'refresh') {
        await reconciliarEquipo(deps, equipo);
        const fresco = await db().collection(COL_EQUIPOS).findOne({ id });
        return res.json(paraElPanel(fresco));
      }

      return res.status(400).json({ error: `Acción no reconocida: ${action}` });
    } catch (error) {
      console.error('[credilock] Error en acción sobre equipo:', error);
      res.status(500).json({ error: 'Error al ejecutar la acción' });
    }
  });

  app.delete('/api/blocking/devices', async (req: Request, res: Response) => {
    try {
      const id = String(req.query.id || '');
      const equipo = await db().collection(COL_EQUIPOS).findOne({ id });
      if (!equipo) return res.status(404).json({ error: 'Equipo no encontrado.' });

      // Quitarlo del panel no lo desenrola del proveedor. Si se borra estando
      // bloqueado, el cliente se queda bloqueado y sin nadie a quien reclamarle.
      if (equipo.status === 'blocked' || equipo.intencion === 'blocked') {
        return res.status(400).json({
          error: 'Este equipo está bloqueado. Desbloquéalo antes de quitarlo del panel.',
        });
      }

      await db().collection(COL_EQUIPOS).deleteOne({ id });
      await auditar(deps, {
        deviceId: id,
        imei: equipo.imei,
        action: 'delete',
        user: usuarioDe(req),
        deviceInfo: `${equipo.brand || ''} ${equipo.model || ''} — ${equipo.owner || ''}`.trim(),
        metadata: { nota: 'Sólo se quitó del panel; sigue enrolado en el proveedor.' },
      });
      res.status(204).end();
    } catch (error) {
      console.error('[credilock] Error borrando equipo:', error);
      res.status(500).json({ error: 'Error al quitar el equipo' });
    }
  });

  /* ---- historial ---- */

  app.get('/api/blocking/history', async (req: Request, res: Response) => {
    try {
      const limite = Math.min(Number(req.query.limit) || 50, 500);
      const entradas = await db()
        .collection(COL_HISTORIAL)
        .find({})
        .sort({ timestamp: -1 })
        .limit(limite)
        .toArray();
      res.json(entradas);
    } catch (error) {
      console.error('[credilock] Error cargando historial:', error);
      res.status(500).json({ error: 'Error al cargar el historial' });
    }
  });

  // El historial es sólo de lectura: lo escribe el servidor cuando algo pasa de
  // verdad. Si el navegador pudiera añadir entradas, la bitácora dejaría de ser
  // prueba de nada — cualquiera podría inventar un bloqueo que nunca ocurrió.
  app.post('/api/blocking/history', (_req: Request, res: Response) => {
    res.status(405).json({
      error: 'El historial lo escribe el servidor. No se pueden añadir entradas desde el panel.',
    });
  });

  /* ---- alertas, pagos y resumen ---- */

  app.get('/api/blocking/data', async (req: Request, res: Response) => {
    try {
      const tipo = String(req.query.type || '');
      if (tipo === 'alerts') {
        const alertas = await db().collection(COL_ALERTAS).find({}).sort({ timestamp: -1 }).limit(200).toArray();
        return res.json(alertas);
      }
      if (tipo === 'payments') {
        const filtro = req.query.deviceId ? { deviceId: String(req.query.deviceId) } : {};
        const pagos = await db().collection(COL_PAGOS).find(filtro).sort({ date: -1 }).limit(500).toArray();
        return res.json(pagos);
      }
      if (tipo === 'config') {
        return res.json(await leerConfig(deps));
      }
      if (tipo === 'stats') {
        const equipos = await db().collection(COL_EQUIPOS).find({}).toArray();
        // Mismo defecto que `paraElPanel`. Los registros anteriores a este módulo
        // no traen `plataforma`, y comparando el campo crudo no caían en ninguno
        // de los tres grupos: el panel mostraba 4 equipos y un cero en cada
        // contador de plataforma, que no suman al total y no se pueden leer.
        const plataformaDe = (e: any) => e.plataforma || 'desconocida';
        const trustonic = equipos.filter((e: any) => plataformaDe(e) === 'trustonic');
        return res.json({
          total: equipos.length,
          active: equipos.filter((e: any) => e.status === 'active').length,
          blocked: equipos.filter((e: any) => e.status === 'blocked').length,
          enrolled: trustonic.length,
          enNuovo: equipos.filter((e: any) => plataformaDe(e) === 'nuovo').length,
          sinResolver: equipos.filter((e: any) => plataformaDe(e) === 'desconocida').length,
          // Lo que de verdad hay que mirar: equipos que no reportan (un bloqueo
          // no les llegaría) y equipos en los que intención y realidad difieren.
          incomunicados: trustonic.filter((e: any) => e.incomunicado).length,
          divergentes: trustonic.filter((e: any) => paraElPanel(e).divergente).length,
          enMora: equipos.filter((e: any) => (e.cuotasVencidas || 0) > 0).length,
          liquidados: equipos.filter((e: any) => e.liquidado).length,
          saldoTotal: equipos.reduce((a: number, e: any) => a + (e.saldo || 0), 0),
          kioskMode: 0,
        });
      }
      return res.status(400).json({ error: `Tipo no reconocido: ${tipo}` });
    } catch (error) {
      console.error('[credilock] Error en /data:', error);
      res.status(500).json({ error: 'Error al cargar los datos' });
    }
  });

  app.post('/api/blocking/data', async (req: Request, res: Response) => {
    try {
      const { type, data } = req.body || {};

      if (type === 'acknowledge_alert') {
        await db().collection(COL_ALERTAS).updateOne({ id: data?.id }, { $set: { acknowledged: true } });
        return res.status(204).end();
      }

      if (type === 'payment') {
        const pago = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          deviceId: data?.deviceId,
          amount: Number(data?.amount || 0),
          method: data?.method || 'efectivo',
          date: new Date().toISOString(),
          status: 'completed',
          registradoPor: usuarioDe(req),
        };
        await db().collection(COL_PAGOS).insertOne(pago);
        return res.json(pago);
      }

      if (type === 'config') {
        const actual = await leerConfig(deps);
        const nueva: ConfigBloqueo = {
          autoBloqueoActivo: Boolean(data?.autoBloqueoActivo ?? actual.autoBloqueoActivo),
          simulacion: Boolean(data?.simulacion ?? actual.simulacion),
          diasDeGracia: Math.max(0, Math.min(Number(data?.diasDeGracia ?? actual.diasDeGracia), 30)),
          maxBloqueosPorVuelta: Math.max(1, Math.min(Number(data?.maxBloqueosPorVuelta ?? actual.maxBloqueosPorVuelta), 50)),
          avisoEnPantallaActivo: Boolean(data?.avisoEnPantallaActivo ?? actual.avisoEnPantallaActivo),
          secretoWebhook: String(data?.secretoWebhook ?? actual.secretoWebhook),
        };
        await db().collection(COL_CONFIG).updateOne({ _id: 'config' }, { $set: nueva }, { upsert: true });
        await auditar(deps, {
          deviceId: 'config',
          imei: '',
          action: 'config',
          user: usuarioDe(req),
          reason: `autoBloqueo=${nueva.autoBloqueoActivo} simulacion=${nueva.simulacion} gracia=${nueva.diasDeGracia}d tope=${nueva.maxBloqueosPorVuelta}`,
          deviceInfo: 'Configuración de CrediLock',
          metadata: { antes: actual, despues: nueva },
        });
        return res.json(nueva);
      }

      return res.status(400).json({ error: `Tipo no reconocido: ${type}` });
    } catch (error) {
      console.error('[credilock] Error en POST /data:', error);
      res.status(500).json({ error: 'Error al guardar' });
    }
  });

  /* ---- operación ---- */

  app.post('/api/blocking/sync', async (_req: Request, res: Response) => {
    try {
      const resumen = await sincronizarDesdeCartera(deps);
      res.json({
        ...resumen,
        mensaje:
          `${resumen.creados} equipo(s) nuevo(s), ${resumen.actualizados} actualizado(s)` +
          (resumen.sinImei ? `, ${resumen.sinImei} sin IMEI válido (ver alertas)` : '') + '.',
      });
    } catch (error) {
      console.error('[credilock] Error sincronizando desde la cartera:', error);
      res.status(500).json({ error: 'Error al sincronizar con la cartera' });
    }
  });

  /** Vuelve a preguntar al proveedor por TODOS los equipos. Es lento a propósito. */
  app.post('/api/blocking/reconcile', async (_req: Request, res: Response) => {
    try {
      const equipos = await db().collection(COL_EQUIPOS).find({}).toArray();
      let consultados = 0;
      for (const equipo of equipos) {
        if (!imeiValido(equipo.imei)) continue;
        await reconciliarEquipo(deps, equipo);
        consultados++;
        // Las consultas van de una en una porque los lotes de esta API son
        // todo-o-nada: un IMEI que no es nuestro tumba la petición completa
        // con 409 y no dice cuál fue.
        await new Promise((r) => setTimeout(r, 400));
      }
      res.json({ consultados, mensaje: `${consultados} equipo(s) consultado(s) al proveedor.` });
    } catch (error) {
      console.error('[credilock] Error reconciliando:', error);
      res.status(500).json({ error: 'Error al reconciliar con el proveedor' });
    }
  });

  /** Qué haría la política ahora mismo, sin ejecutar nada. */
  app.get('/api/blocking/preview', async (_req: Request, res: Response) => {
    try {
      const config = await leerConfig(deps);
      const ahora = hoyColombia();
      const equipos = await db().collection(COL_EQUIPOS).find({}).toArray();
      const decisiones: Decision[] = [];
      for (const equipo of equipos) {
        const registro = await db().collection('financing').findOne({ id: equipo.financingId });
        if (!registro) continue;
        const d = decidir(equipo, resumirCartera(registro, ahora.fecha), config, ahora);
        if (d.accion !== 'nada') decisiones.push(d);
      }
      res.json({ config, decisiones });
    } catch (error) {
      console.error('[credilock] Error calculando la previsualización:', error);
      res.status(500).json({ error: 'Error al calcular las decisiones' });
    }
  });

  /**
   * Reescribe la pantalla de los equipos YA bloqueados con el texto de hoy.
   *
   * Hace falta porque el texto de bloqueo se calcula una sola vez, al mandar la
   * orden. Los equipos que llevan semanas bloqueados siguen mostrando el mensaje
   * con el que se bloquearon: sin link para pagar, y con una cifra de deuda que
   * puede haber cambiado. `DEVICE_LOCK_MESSAGE` cambia ese texto sin tocar el
   * bloqueo, así que esto no desbloquea ni bloquea a nadie — sólo actualiza lo
   * que se lee.
   *
   * Nace EN SECO. Sin `aplicar: true` devuelve los textos exactos y no llama al
   * proveedor. Son pantallas de clientes reales y la API no tiene ambiente de
   * pruebas: el que las vaya a cambiar tiene que poder leer antes qué van a
   * decir. Y va de uno en uno, con pausa, porque los lotes de esta API son
   * todo-o-nada y un IMEI malo tumbaría la petición entera sin decir cuál.
   */
  app.post('/api/blocking/refrescar-mensajes', async (req: Request, res: Response) => {
    try {
      const aplicar = req.body?.aplicar === true;
      const { fecha: hoy } = hoyColombia();
      const equipos = await db()
        .collection(COL_EQUIPOS)
        .find({ intencion: 'blocked', status: 'blocked' })
        .toArray();

      const detalle: any[] = [];
      let enviados = 0;

      for (const equipo of equipos) {
        const problema = revisarAntesDeActuar(equipo);
        if (problema) {
          detalle.push({ imei: enmascararImei(equipo.imei), owner: equipo.owner, omitido: problema });
          continue;
        }

        const registro = equipo.financingId
          ? await db().collection('financing').findOne({ id: equipo.financingId })
          : null;
        if (!registro) {
          detalle.push({
            imei: enmascararImei(equipo.imei),
            owner: equipo.owner,
            omitido: 'No se encontró su financiamiento.',
          });
          continue;
        }

        const cartera = resumirCartera(registro, hoy);
        const linkCorto = await deps.linkCortoPortal?.(registro).catch(() => null);
        const { titulo, mensaje } = textoBloqueo(deps.nombreBonito(equipo.owner || ''), cartera, linkCorto);

        const fila: any = {
          imei: enmascararImei(equipo.imei),
          owner: equipo.owner,
          linkCorto: linkCorto || null,
          titulo,
          mensaje,
          caracteres: mensaje.length,
        };

        if (aplicar) {
          const r = await mensajeEnBloqueo(equipo.imei, titulo.slice(0, 60), mensaje.slice(0, 300));
          fila.enviado = r.ok;
          if (!r.ok) fila.error = r.error || `El proveedor respondió ${r.status}.`;
          else enviados++;
          await auditar(deps, {
            deviceId: equipo.id,
            imei: equipo.imei,
            action: 'lock_message',
            user: usuarioDe(req),
            reason: 'Refresco masivo del texto de bloqueo (añade el link corto para pagar)',
            deviceInfo: `${equipo.brand || ''} ${equipo.model || ''} — ${equipo.owner || ''}`.trim(),
            metadata: { httpStatus: r.status, respuesta: r.cuerpo, mensaje },
          });
          await new Promise((r2) => setTimeout(r2, 400));
        }

        detalle.push(fila);
      }

      return res.json({
        aplicado: aplicar,
        bloqueados: equipos.length,
        candidatos: detalle.filter((d) => !d.omitido).length,
        enviados,
        detalle,
        mensaje: aplicar
          ? `${enviados} de ${detalle.filter((d) => !d.omitido).length} pantalla(s) actualizada(s).`
          : `En seco: ${detalle.filter((d) => !d.omitido).length} pantalla(s) se actualizarían. ` +
            'Repite con {"aplicar":true} para enviarlo de verdad.',
      });
    } catch (error) {
      console.error('[credilock] Error refrescando los mensajes de bloqueo:', error);
      return res.status(500).json({ error: 'Error al refrescar los mensajes de bloqueo' });
    }
  });

  /* ---- webhooks ---- */

  app.get('/api/blocking/webhooks', async (_req: Request, res: Response) => {
    const r = await listarWebhooks();
    if (!r.ok) return res.status(502).json({ error: r.error || `El proveedor respondió ${r.status}.` });
    res.json(r.cuerpo?.dataResponse ?? {});
  });

  app.post('/api/blocking/webhooks', async (req: Request, res: Response) => {
    try {
      const url = String(req.body?.url || '').trim();
      if (!/^https:\/\//.test(url)) {
        return res.status(400).json({ error: 'La URL del webhook debe ser https.' });
      }
      const r = await crearWebhook(url, ['locked', 'released', 'active', 'enrolled', 'idle', 'readyForUse']);
      if (!r.ok) return res.status(502).json({ error: r.error || `El proveedor respondió ${r.status}.` });
      res.json(r.cuerpo?.dataResponse ?? {});
    } catch (error) {
      console.error('[credilock] Error creando webhook:', error);
      res.status(500).json({ error: 'Error al crear el webhook' });
    }
  });

  app.delete('/api/blocking/webhooks', async (req: Request, res: Response) => {
    const r = await borrarWebhook(String(req.query.id || ''));
    if (!r.ok) return res.status(502).json({ error: r.error || `El proveedor respondió ${r.status}.` });
    res.status(204).end();
  });

  /**
   * Entrada de eventos del proveedor.
   *
   * El proveedor avisa de que sus webhooks llegan con retraso y recomienda
   * QUERY_DEVICES para el estado real, así que esto NO se cree el evento: lo
   * usa como disparador para ir a preguntar. Un webhook que diga "locked" sobre
   * un equipo que no lo está nos dejaría mostrando algo falso.
   *
   * Es público (lo llama el proveedor, no nuestro panel) y por eso exige el
   * secreto compartido en la URL.
   */
  app.post('/api/blocking/webhook/:secreto', async (req: Request, res: Response) => {
    // El secreto se comprueba ANTES de responder, y un secreto que no cuadra
    // devuelve 401 en vez de 200. Antes se respondía 200 a todo y la validación
    // venía después: con el secreto mal configurado en el proveedor, cada
    // evento se descartaba en silencio y su panel los veía todos entregados.
    // El módulo se quedaba sin disparador y nadie se enteraba.
    const config = await leerConfig(deps);
    if (!config.secretoWebhook || req.params.secreto !== config.secretoWebhook) {
      console.warn('[credilock] Webhook con secreto incorrecto; se rechaza.');
      return res.status(401).json({ error: 'Secreto no válido.' });
    }

    // A partir de aquí sí se responde enseguida y se trabaja después: si
    // tardamos, el proveedor reintenta y procesaríamos el mismo evento varias
    // veces.
    res.status(200).json({ recibido: true });
    try {
      const imeis: string[] = [];
      const cuerpo = req.body || {};
      const candidatos = [cuerpo, ...(Array.isArray(cuerpo.eventList) ? cuerpo.eventList : [])];
      for (const c of candidatos) {
        const v = c?.deviceUid || c?.imei;
        if (v && imeiValido(v)) imeis.push(String(v));
      }
      for (const imei of [...new Set(imeis)]) {
        const equipo = await db().collection(COL_EQUIPOS).findOne({ imei });
        if (equipo) await reconciliarEquipo(deps, equipo);
      }
      console.log(`[credilock] Webhook procesado: ${imeis.length} equipo(s) reconsultado(s).`);
    } catch (err) {
      console.error('[credilock] Error procesando el webhook:', err);
    }
  });

  /* ══════════════  Crones  ══════════════ */

  let reconciliando = false;
  let cursor = 0;

  /**
   * CADENCIA: 10 equipos cada 2 minutos.
   *
   * Con ~110 equipos eso da una vuelta completa cada ~22 minutos, que es de
   * sobra: un bloqueo tarda entre instantáneo y 10 minutos en entrar. Consultar
   * los 110 de golpe serían 110 peticiones en ráfaga contra la API del
   * proveedor cada vez, sin ninguna ventaja.
   */
  async function vueltaDeReconciliacion() {
    if (reconciliando || !deps.getDb() || !trustonicConfigurado()) return;
    reconciliando = true;
    try {
      const equipos = await db()
        .collection(COL_EQUIPOS)
        .find({})
        .sort({ imei: 1 })
        .skip(cursor)
        .limit(EQUIPOS_POR_VUELTA)
        .toArray();

      if (!equipos.length) {
        cursor = 0;
        return;
      }
      cursor += equipos.length;

      for (const equipo of equipos) {
        if (!imeiValido(equipo.imei)) continue;
        await reconciliarEquipo(deps, equipo);
        await new Promise((r) => setTimeout(r, 400));
      }
    } catch (err) {
      console.error('[credilock] Error en la vuelta de reconciliación:', err);
    } finally {
      reconciliando = false;
    }
  }

  let aplicandoPolitica = false;

  async function vueltaDePolitica() {
    if (aplicandoPolitica || !deps.getDb()) return;
    aplicandoPolitica = true;
    try {
      await sincronizarDesdeCartera(deps);
      const decisiones = await ejecutarPolitica(deps);
      if (decisiones.length) {
        const config = await leerConfig(deps);
        const modo = !config.autoBloqueoActivo
          ? 'APAGADO'
          : config.simulacion
            ? 'SIMULACIÓN'
            : 'EJECUTANDO';
        console.log(`[credilock] Política (${modo}): ${decisiones.length} decisión(es).`);
        for (const d of decisiones) {
          console.log(`[credilock]   ${d.accion} ${enmascararImei(d.imei)} — ${d.motivo}`);
        }
      }
    } catch (err) {
      console.error('[credilock] Error en la vuelta de política:', err);
    } finally {
      aplicandoPolitica = false;
    }
  }

  setInterval(vueltaDeReconciliacion, 2 * 60 * 1000);
  setTimeout(vueltaDeReconciliacion, 45000);

  // La política cada 30 min. No cada hora: la hora de bloqueo pactada con cada
  // cliente es a y media en varios contratos, y un cron horario la pasaría de
  // largo hasta 59 minutos — justo el rato en que el cliente cree que todavía
  // tiene tiempo de pagar.
  setInterval(vueltaDePolitica, 30 * 60 * 1000);
  setTimeout(vueltaDePolitica, 90000);

  console.log('[credilock] Módulo de bloqueo montado en /api/blocking/*.');
  if (!trustonicConfigurado()) {
    console.warn('[credilock] ⚠ Sin TRUSTONIC_BASE_URL/TRUSTONIC_TOKEN: el panel funciona pero no se puede bloquear nada.');
  }
}
