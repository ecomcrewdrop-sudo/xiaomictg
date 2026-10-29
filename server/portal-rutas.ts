/**
 * RUTAS DEL PORTAL DEL CLIENTE Y DEL PAGO EN LÍNEA DE CUOTAS.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Dos cosas que se construyen juntas porque por separado quedan a medias:
 *
 *  - El portal: el cliente abre su link y ve su cuenta. Quita de encima las
 *    preguntas que hoy llegan por WhatsApp una por una ("¿cuánto debo?",
 *    "¿cuándo me toca?", "¿ya te llegó mi pago?").
 *  - El pago en línea: desde ese mismo link paga con PSE, Nequi o el botón de
 *    Bancolombia. El pago se registra solo y el equipo se desbloquea sin que
 *    nadie entre al panel. Desaparece el paso del comprobante, que es donde hoy
 *    se pierden las horas y donde el registro depende de que alguien mire una
 *    foto.
 *
 * La pasarela es Bold, que la tienda ya tiene contratada y en uso para las
 * ventas, y el webhook que valida firma HMAC ya existía.
 *
 *
 * POR QUÉ AQUÍ NO SE ACEPTA TARJETA
 * ─────────────────────────────────
 * La tienda sí la acepta, y debe seguir haciéndolo. Aquí no.
 *
 * Un contracargo de tarjeta puede llegar meses después del pago: el banco le
 * devuelve el dinero al cliente y la tienda se queda sin cobro. Pero el equipo
 * ya se desbloqueó automáticamente al confirmarse ese pago, y el desbloqueo no
 * tiene vuelta atrás desde este lado. Sería regalar la garantía que justifica
 * todo el sistema de bloqueo.
 *
 * PSE, Nequi y el botón de Bancolombia son transferencias y no admiten
 * contracargo. Por eso el link se crea con la API de Link de Pagos, que acepta
 * `payment_methods`, en vez de con el botón embebido, que no permite filtrar.
 *
 *
 * POR QUÉ UNA COLECCIÓN DE INTENCIONES DE PAGO
 * ────────────────────────────────────────────
 * Lo único que el webhook de Bold devuelve para identificar el cobro es la
 * referencia. Se podría codificar el id y las cuotas dentro de la propia
 * referencia, pero entonces el webhook —que es público y lo llama un tercero—
 * estaría leyendo instrucciones de un dato que viaja por fuera. Con la
 * colección `pagos_cuota`, la referencia es sólo una llave opaca: el monto, las
 * cuotas y el contrato los puso el servidor cuando creó la intención, y el
 * webhook no puede más que confirmar o no confirmar lo que ya estaba escrito.
 */
import type { Express, Request, RequestHandler, Response } from 'express';
import { randomBytes } from 'crypto';
import {
  type AlcancePago,
  type ReglasPlazoAuto,
  type SolicitudPlazo,
  armarResumenPortal,
  decidirPlazoAutomatico,
  elegirCuotasAPagar,
  firmaCorrecta,
  leerTokenPortal,
  linkPortal,
  normalizarReglasPlazo,
  nuevaReferenciaPago,
  nuevaSolicitudId,
  solicitudPendienteDe,
  solicitudesDe,
  tokenPortal,
} from './portal';
import {
  buscarPorCodigo,
  cedulaCoincide,
  controlDeIntentos,
  normalizarCodigo,
  pareceCodigoCorto,
} from './codigo-corto';
import { type AvisoPago, paginaCodigoCorto, paginaErrorPortal, paginaPortal } from './portal-page';
import type { LinkDePago, OpcionesLink } from './bold-link';
import { fechaLarga, fechaLimite, validarProrroga } from './prorroga';

const COL_PAGOS_CUOTA = 'pagos_cuota';
const COL_FINANCING = 'financing';
const COL_EQUIPOS = 'blocking_devices';
const COL_PAGOS_BLOQUEO = 'blocking_payments';
const COL_SETTINGS = 'settings';

/** Clave en `settings` de las reglas del plazo automático. */
const CLAVE_REGLAS = 'portal_plazo_auto';

/**
 * Cuánto vale una intención de pago sin usar.
 *
 * Si el cliente toca "pagar" y se arrepiende, el registro queda ahí. Al volver a
 * tocarlo dentro de este rato se reutiliza en vez de crear otro: con 112
 * clientes dubitativos la colección se llenaría de referencias muertas y el
 * historial de pagos del dueño sería ilegible.
 */
const MINUTOS_INTENCION_VIVA = 30;

/**
 * Cuánto vale el link de pago que entrega Bold.
 *
 * 48 horas porque el link viaja en un recordatorio de WhatsApp: el cliente lo
 * lee cuando puede, no cuando se le manda. Más corto convierte el recordatorio
 * en un link muerto; mucho más largo deja cobros abiertos sobre cuotas cuyo
 * importe ya cambió (una prórroga concedida en medio, por ejemplo).
 */
const HORAS_LINK_PAGO = 48;

export interface DepsPortal {
  getDb(): any;
  /** Secreto con el que se firman los links. Estable; ver `asegurarSecretoPortal`. */
  secreto(): string;
  /** Origen público del backend, sin barra final. */
  baseUrl(): string;
  /** ¿Están las llaves de Bold? Sin ellas el portal ofrece WhatsApp, no un botón muerto. */
  boldConfigurado(): boolean;
  /**
   * Pide a Bold el link de pago. Inyectado —y no importado— para que los tests
   * del portal no dependan de la red ni de que haya llaves en el entorno.
   */
  crearLinkPago(o: OpcionesLink): Promise<LinkDePago>;
  enviarWhatsApp(telefono: string, texto: string): Promise<boolean>;
  whatsappListo(): boolean;
  nombreBonito(valor: unknown): string;
  /** Fecha de hoy en Colombia, `YYYY-MM-DD`. */
  hoy(): string;
  parsearImagen(base64: string): { mime: string; buffer: Buffer } | null;
  maxBytesComprobante: number;
  /** Desbloqueo tras registrar el pago. Es `alRegistrarPago` de blocking.ts. */
  alRegistrarPago(financingId: string): Promise<void>;
  alOtorgarProrroga(
    financingId: string,
    hasta: string,
    cuotaNumber: number
  ): Promise<{ liberado: boolean; detalle: string }>;
  /** Avisa al dueño de algo que tiene que decidir. */
  avisarAlDueno(texto: string): Promise<void>;
  emitir(evento: string, datos: unknown): void;
  /** Freno por IP para las acciones del cliente. */
  limitador: RequestHandler;
}

/* ══════════════════════════  Secreto del portal  ══════════════════════════ */

/**
 * Deja listo el secreto con el que se firman los links, y lo deja ESTABLE.
 *
 * No se deriva de la contraseña de admin —como sí hace `AUTH_SECRET`— porque los
 * links ya están en el WhatsApp de 112 clientes: cambiar la contraseña del panel
 * no puede romperlos todos a la vez y en silencio. Y no se genera en cada
 * arranque por lo mismo. Así que se guarda una vez en `settings` y se reutiliza.
 *
 * `PORTAL_SECRET` en el entorno tiene prioridad, para poder rotarlos todos a
 * propósito el día que haga falta.
 */
export async function asegurarSecretoPortal(db: any): Promise<string> {
  const delEntorno = (process.env.PORTAL_SECRET || '').trim();
  if (delEntorno.length >= 32) return delEntorno;
  if (delEntorno) {
    console.warn('[portal] PORTAL_SECRET es demasiado corto (mínimo 32 caracteres); se ignora.');
  }

  if (!db) {
    console.error('[portal] Sin base de datos no se puede fijar el secreto: los links no funcionarán.');
    return '';
  }

  const guardado = await db.collection(COL_SETTINGS).findOne({ key: 'portal_secret' });
  if (guardado?.value && String(guardado.value).length >= 32) return String(guardado.value);

  const nuevo = randomBytes(32).toString('hex');
  await db.collection(COL_SETTINGS).updateOne(
    { key: 'portal_secret' },
    { $set: { key: 'portal_secret', value: nuevo, creadoEn: new Date().toISOString() } },
    { upsert: true }
  );
  console.log('[portal] Secreto del portal generado y guardado. Los links de cliente ya son estables.');
  return nuevo;
}

async function leerReglas(deps: DepsPortal): Promise<ReglasPlazoAuto> {
  try {
    const db = deps.getDb();
    if (!db) return normalizarReglasPlazo(null);
    const doc = await db.collection(COL_SETTINGS).findOne({ key: CLAVE_REGLAS });
    return normalizarReglasPlazo(doc?.value);
  } catch {
    return normalizarReglasPlazo(null);
  }
}

/* ══════════════════════════  Identificación  ══════════════════════════ */

interface Identificado {
  registro: any;
  token: string;
}

/**
 * Resuelve el token a un registro, o explica por qué no.
 *
 * El mismo texto para "no existe" y para "la firma no vale": son dos fallos
 * distintos para el servidor y el mismo para quien está probando ids ajenos, y
 * contarle cuál de los dos acertó es regalarle la mitad del trabajo.
 */
async function identificar(
  deps: DepsPortal,
  tokenCrudo: unknown
): Promise<Identificado | { error: string; status: number }> {
  const partes = leerTokenPortal(tokenCrudo);
  if (!partes) return { error: 'Este link no es válido.', status: 404 };

  const secreto = deps.secreto();
  if (!secreto) {
    console.error('[portal] No hay secreto configurado: no se puede verificar ningún link.');
    return { error: 'El portal no está disponible en este momento.', status: 503 };
  }

  const db = deps.getDb();
  if (!db) return { error: 'El portal no está disponible en este momento.', status: 503 };

  const registro = await db.collection(COL_FINANCING).findOne({ id: partes.id });
  if (!registro) return { error: 'Este link no es válido.', status: 404 };

  if (!firmaCorrecta(secreto, partes.id, registro.portalVersion, partes.firma)) {
    return { error: 'Este link no es válido.', status: 404 };
  }

  return { registro, token: String(tokenCrudo) };
}

async function equipoDe(deps: DepsPortal, financingId: string) {
  try {
    const db = deps.getDb();
    if (!db) return null;
    return await db.collection(COL_EQUIPOS).findOne({ financingId });
  } catch {
    return null;
  }
}

/** La cuota pendiente más antigua, que es la única sobre la que el cliente actúa. */
function cuotaEnJuego(registro: any): any | null {
  const cuotas: any[] = Array.isArray(registro?.cuotas) ? registro.cuotas : [];
  const pendientes = cuotas
    .filter((c) => c?.status !== 'paid')
    .sort((a, b) => fechaLimite(a).localeCompare(fechaLimite(b)));
  return pendientes[0] || null;
}

function pesos(valor: number): string {
  return `$${Math.round(Number(valor) || 0).toLocaleString('es-CO')}`;
}

/* ══════════════════════════  Pago en línea  ══════════════════════════ */

export interface IntencionPago {
  referencia: string;
  financingId: string;
  cuotas: number[];
  monto: number;
  concepto: string;
  estado: 'pendiente' | 'aprobado' | 'rechazado';
  creadoEn: string;
}

/**
 * Confirma un pago de cuotas que Bold aprobó.
 *
 * La llama el webhook, que ya validó la firma HMAC. Es idempotente a propósito:
 * Bold reintenta los webhooks, y un reintento sobre un pago ya aplicado no puede
 * volver a marcar cuotas ni volver a mandarle el WhatsApp al cliente.
 */
export async function confirmarPagoDeCuotas(
  deps: DepsPortal,
  referencia: string,
  datosBold: { paymentId?: string; metodo?: string } = {}
): Promise<void> {
  const db = deps.getDb();
  if (!db) {
    console.error(`[portal-pago] Sin base de datos: no se pudo aplicar ${referencia}.`);
    return;
  }

  const intencion = await db.collection(COL_PAGOS_CUOTA).findOne({ referencia });
  if (!intencion) {
    console.error(`[portal-pago] Referencia desconocida: ${referencia}. No se aplica nada.`);
    return;
  }

  /**
   * El candado: sólo pasa de `pendiente` a `aprobado` quien gane la carrera. El
   * segundo webhook no modifica nada y sale por aquí. Si se mirara el estado y
   * luego se escribiera, dos entregas simultáneas aplicarían el pago dos veces.
   */
  const marcado = await db.collection(COL_PAGOS_CUOTA).updateOne(
    { referencia, estado: 'pendiente' },
    {
      $set: {
        estado: 'aprobado',
        aprobadoEn: new Date().toISOString(),
        boldPaymentId: datosBold.paymentId || null,
        metodo: datosBold.metodo || null,
      },
    }
  );
  if (marcado.modifiedCount !== 1) {
    console.log(`[portal-pago] ${referencia} ya estaba resuelta (${intencion.estado}); no se repite.`);
    return;
  }

  const registro = await db.collection(COL_FINANCING).findOne({ id: intencion.financingId });
  if (!registro) {
    console.error(
      `[portal-pago] ${referencia} cobrada pero el financiamiento ${intencion.financingId} ya no existe. ` +
        `REVISAR A MANO: el dinero entró.`
    );
    await deps.avisarAlDueno(
      `⚠️ Entró un pago en línea de ${pesos(intencion.monto)} (ref ${referencia}) pero su financiamiento ya no está en el sistema. Hay que revisarlo a mano.`
    );
    return;
  }

  const cuotas: any[] = Array.isArray(registro.cuotas) ? registro.cuotas : [];
  const ahora = new Date().toISOString();
  const aplicadas: number[] = [];

  for (const numero of intencion.cuotas as number[]) {
    const idx = cuotas.findIndex((c) => Number(c?.number) === Number(numero));
    if (idx === -1) continue;
    if (cuotas[idx].status === 'paid') continue;
    cuotas[idx].status = 'paid';
    cuotas[idx].paidDate = ahora;
    /**
     * El respaldo de una cuota pagada en línea. Sustituye a la captura: es más
     * fuerte que una foto, porque el dinero lo confirmó la pasarela y no la
     * palabra de nadie. La regla de "sin comprobante no se marca pagada" lo
     * acepta por eso.
     */
    cuotas[idx].pagoEnLinea = {
      referencia,
      monto: Number(registro.valorCuota || 0),
      metodo: datosBold.metodo || 'Bold',
      boldPaymentId: datosBold.paymentId || null,
      aprobadoEn: ahora,
    };
    cuotas[idx].comprobante = cuotas[idx].comprobante || null;
    aplicadas.push(Number(numero));
  }

  const todasPagadas = cuotas.length > 0 && cuotas.every((c) => c.status === 'paid');
  await db.collection(COL_FINANCING).updateOne(
    { id: registro.id },
    { $set: { cuotas, ...(todasPagadas ? { status: 'completed' } : {}) } }
  );

  console.log(
    `[portal-pago] ${referencia}: ${pesos(intencion.monto)} de ${registro.nombre}. ` +
      `Cuotas aplicadas: ${aplicadas.join(', ') || 'ninguna (ya estaban pagadas)'}.`
  );

  // Queda en el historial de pagos que ve el panel de Bloqueo, junto a los de
  // mostrador. Si falla, el pago ya está aplicado: esto es la constancia, no el
  // pago.
  try {
    const equipo = await equipoDe(deps, registro.id);
    await db.collection(COL_PAGOS_BLOQUEO).insertOne({
      id: `${Date.now()}-${randomBytes(3).toString('hex')}`,
      deviceId: equipo?.id || null,
      amount: Number(intencion.monto || 0),
      method: `Bold en línea (${datosBold.metodo || 'pasarela'})`,
      date: ahora,
      status: 'completed',
      registradoPor: 'portal-cliente',
      referencia,
      cuotas: aplicadas,
    });
  } catch (err) {
    console.error('[portal-pago] No se pudo anotar el pago en el historial de bloqueo:', err);
  }

  // Desbloqueo. Después de haber guardado: si el proveedor falla, el pago no se
  // pierde y la vuelta de política lo suelta más tarde.
  try {
    await deps.alRegistrarPago(registro.id);
  } catch (err) {
    console.error('[portal-pago] Error desbloqueando tras el pago en línea:', err);
  }

  deps.emitir('financingUpdated', { id: registro.id, motivo: 'pago-en-linea' });

  // Recibo al cliente. Es lo que va a buscar si algún día hay discusión, así que
  // dice qué cuotas cubrió y cuánto queda.
  const hoy = deps.hoy();
  const frescos = await db.collection(COL_FINANCING).findOne({ id: registro.id });
  const resumen = armarResumenPortal(frescos, await equipoDe(deps, registro.id), hoy);
  const detalle =
    aplicadas.length === 1 ? `tu cuota #${aplicadas[0]}` : `tus cuotas #${aplicadas.join(', #')}`;
  const cierre = resumen.liquidado
    ? '\n\n🎉 *Con esto terminaste de pagar tu equipo.* Queda libre y sin restricciones. Gracias por cumplir.'
    : `\n\nTe quedan ${resumen.pendientes} cuota(s) por ${pesos(resumen.saldo)}.` +
      (resumen.proxima ? `\nLa próxima, la #${resumen.proxima.numero}, vence el *${resumen.proxima.venceLargo}*.` : '');

  await enviarAlCliente(
    deps,
    registro,
    `✅ *Pago recibido*\n\nHola *${deps.nombreBonito(registro.nombre)}*, recibimos ${pesos(
      intencion.monto
    )} y quedó registrado ${detalle}.${cierre}\n\nComprobante: ${referencia}\n\n_CREDILOCK — Sistema de financiamiento_`
  );

  await deps.avisarAlDueno(
    `💳 Pago en línea de *${deps.nombreBonito(registro.nombre)}*: ${pesos(intencion.monto)} ` +
      `(${detalle}). Ya quedó registrado${resumen.liquidado ? ' y el financiamiento quedó liquidado' : ''}.`
  );
}

/** Marca la intención como rechazada. No toca cuotas: nunca se marcó nada. */
export async function rechazarPagoDeCuotas(deps: DepsPortal, referencia: string): Promise<void> {
  try {
    const db = deps.getDb();
    if (!db) return;
    await db.collection(COL_PAGOS_CUOTA).updateOne(
      { referencia, estado: 'pendiente' },
      { $set: { estado: 'rechazado', rechazadoEn: new Date().toISOString() } }
    );
    console.log(`[portal-pago] ${referencia} rechazada por la pasarela.`);
  } catch (err) {
    console.error('[portal-pago] Error marcando el rechazo:', err);
  }
}

async function enviarAlCliente(deps: DepsPortal, registro: any, texto: string): Promise<void> {
  try {
    if (!deps.whatsappListo()) {
      console.warn('[portal] WhatsApp no está conectado; el mensaje al cliente no sale.');
      return;
    }
    await deps.enviarWhatsApp(String(registro?.telefono || ''), texto);
  } catch (err) {
    console.error('[portal] Error enviando WhatsApp al cliente:', err);
  }
}

/* ══════════════════════════  Registro de rutas  ══════════════════════════ */

export function registrarPortal(app: Express, deps: DepsPortal): void {
  /**
   * Freno de la puerta corta. Vive aquí —una sola instancia por proceso— porque
   * su memoria ES el freno: si se creara por petición, contaría siempre desde
   * cero y no frenaría nada.
   *
   * 15 minutos y 5 intentos. El cálculo: 10.000 combinaciones de cuatro dígitos
   * a 5 por cuarto de hora son 20 por hora, o sea unas 20 años para recorrerlas.
   */
  const frenoCodigos = controlDeIntentos(5, 15 * 60_000);

  /** Lo mismo para un código inexistente y para una cédula que no cuadra. */
  const NO_CUADRA = 'Los datos no coinciden. Revisa el código del equipo y los 4 dígitos.';

  function servirCodigoCorto(res: Response, codigo: string, error?: string) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const espera = frenoCodigos.esperaMinutos(codigo);
    // 200 incluso con error: es un formulario que se vuelve a pintar, no un
    // fallo de la petición. Un 4xx aquí haría que el navegador del cliente
    // mostrara su propia pantalla de error en algunos WebView.
    return res.status(200).send(paginaCodigoCorto({ codigo, error, esperaMinutos: espera }));
  }

  /* ─── La puerta corta: el código que sale en la pantalla de bloqueo ───────
   *
   * Se resuelve DENTRO de `/p/:token` y no en una ruta aparte (`/c/:codigo`)
   * por una razón práctica: así el cliente no tiene que distinguir dos
   * direcciones. Pega lo que tenga en la barra y el servidor decide. Un token
   * largo lleva punto y un código corto no: ésa es toda la diferencia que hace
   * falta, y está en `pareceCodigoCorto` con sus tests.
   */
  app.get('/p/:token', async (req: Request, res: Response, siguiente) => {
    if (!pareceCodigoCorto(req.params.token)) return siguiente();
    // Se sirve el código ya canónico: si leyó un cero como O y escribió
    // "k7m2qo", ve "K7M2Q0" y el formulario envía eso mismo. Así el que teclea
    // y el que verifica hablan del mismo código.
    return servirCodigoCorto(res, normalizarCodigo(req.params.token)!);
  });

  /**
   * Los 4 dígitos. Formulario HTML, sin JavaScript: ver `paginaCodigoCorto`.
   *
   * Al acertar NO se renderiza el portal aquí: se redirige al link largo de
   * siempre. El portal entero —pagar, subir comprobante, pedir plazo— sigue
   * funcionando sin saber que existe esta puerta, y no hay dos caminos que
   * mantener en paralelo.
   */
  app.post('/p/:codigo', deps.limitador, async (req: Request, res: Response) => {
    try {
      const codigo = normalizarCodigo(req.params.codigo);
      if (!codigo) {
        const { html, codigo: status } = paginaErrorPortal(
          'Este link no funciona',
          'Revisa el código que aparece en la pantalla de tu equipo, o escríbenos.',
          404
        );
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(status).send(html);
      }

      if (!frenoCodigos.permite(codigo)) return servirCodigoCorto(res, codigo);

      const db = deps.getDb();
      if (!db) {
        return servirCodigoCorto(res, codigo, 'No podemos consultar tu cuenta ahora mismo. Inténtalo en un rato.');
      }

      const registro = await buscarPorCodigo(db, codigo);
      // Un código inexistente también cuenta como fallo. Si no contara, probar
      // códigos sería gratis y el freno sólo protegería a los que ya existen.
      if (!registro || !cedulaCoincide(registro.cedula, req.body?.cedula)) {
        frenoCodigos.fallo(codigo);
        return servirCodigoCorto(res, codigo, NO_CUADRA);
      }

      const secreto = deps.secreto();
      const token = tokenPortal(secreto, registro.id, registro.portalVersion);
      if (!token) {
        console.error('[portal] Cédula correcta pero no se pudo firmar el token; ¿falta el secreto?');
        return servirCodigoCorto(res, codigo, 'No podemos abrir tu cuenta ahora mismo. Escríbenos y te ayudamos.');
      }

      frenoCodigos.exito(codigo);
      res.setHeader('Cache-Control', 'no-store, private');
      res.setHeader('Referrer-Policy', 'no-referrer');
      // 303 y no 302: obliga al navegador a pasar a GET. Con 302 algunos
      // clientes repiten el POST en la URL nueva, y el cliente vería un
      // "Cannot POST" justo después de haber acertado.
      return res.redirect(303, `/p/${token}`);
    } catch (error) {
      console.error('[portal] Error verificando el código corto:', error);
      const normal = normalizarCodigo(req.params.codigo);
      if (normal) {
        return servirCodigoCorto(res, normal, 'Algo se rompió de nuestro lado. Vuelve a intentarlo en un rato.');
      }
      const { html } = paginaErrorPortal(
        'Algo se rompió de nuestro lado',
        'No es culpa tuya ni afecta a tu cuenta. Vuelve a intentarlo en un rato.',
        500
      );
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(500).send(html);
    }
  });

  /* ─── La página ──────────────────────────────────────────────────────────
   *
   * Fuera de `/api` a propósito: el link lo lee un cliente en un WhatsApp, y
   * `/p/xxxx` cabe y se entiende. También esquiva el middleware de admin sin
   * tener que añadir excepciones.
   */
  app.get('/p/:token', async (req: Request, res: Response) => {
    try {
      const quien = await identificar(deps, req.params.token);
      if ('error' in quien) {
        const { html, codigo } = paginaErrorPortal(
          'Este link no funciona',
          quien.status === 503
            ? 'Estamos teniendo un problema técnico. Vuelve a intentarlo en un rato.'
            : 'Puede que sea viejo o que esté incompleto. Escríbenos y te mandamos uno nuevo.',
          quien.status
        );
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(codigo).send(html);
      }

      const hoy = deps.hoy();
      const resumen = armarResumenPortal(quien.registro, await equipoDe(deps, quien.registro.id), hoy);

      // Vuelta desde la pasarela: se mira el estado real de la intención, no lo
      // que diga la URL. Bold devuelve al cliente antes de que llegue el
      // webhook, así que "volví de pagar" no es "el pago está confirmado".
      let avisoPago: AvisoPago | null = null;
      const ref = String((req.query.pago as string) || '').trim();
      if (ref) {
        const db = deps.getDb();
        const intencion = db
          ? await db.collection(COL_PAGOS_CUOTA).findOne({ referencia: ref, financingId: quien.registro.id })
          : null;
        if (intencion) {
          avisoPago =
            intencion.estado === 'aprobado'
              ? 'aprobado'
              : intencion.estado === 'rechazado'
                ? 'rechazado'
                : 'pendiente';
        }
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, private');
      // La ficha de un cliente no se indexa ni se referencia desde fuera.
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      res.setHeader('Referrer-Policy', 'no-referrer');
      return res.status(200).send(
        paginaPortal({
          resumen,
          token: quien.token,
          api: deps.baseUrl(),
          avisoPago,
          pagoActivo: deps.boldConfigurado(),
        })
      );
    } catch (error) {
      console.error('[portal] Error sirviendo la página:', error);
      const { html } = paginaErrorPortal(
        'Algo se rompió de nuestro lado',
        'No es culpa tuya ni afecta a tu cuenta. Vuelve a intentarlo en un rato.',
        500
      );
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(500).send(html);
    }
  });

  /* ─── Los datos en JSON ─────────────────────────────────────────────────── */
  app.get('/api/portal/:token', async (req: Request, res: Response) => {
    try {
      const quien = await identificar(deps, req.params.token);
      if ('error' in quien) return res.status(quien.status).json({ error: quien.error });
      const resumen = armarResumenPortal(
        quien.registro,
        await equipoDe(deps, quien.registro.id),
        deps.hoy()
      );
      res.setHeader('Cache-Control', 'no-store, private');
      return res.json({ ...resumen, pagoActivo: deps.boldConfigurado() });
    } catch (error) {
      console.error('[portal] Error devolviendo el resumen:', error);
      return res.status(500).json({ error: 'No se pudo cargar tu cuenta.' });
    }
  });

  /* ─── Pagar ─────────────────────────────────────────────────────────────── */
  app.post('/api/portal/:token/pagar', deps.limitador, async (req: Request, res: Response) => {
    try {
      if (!deps.boldConfigurado()) {
        return res.status(503).json({ error: 'El pago en línea no está disponible. Escríbenos por WhatsApp.' });
      }

      const quien = await identificar(deps, req.params.token);
      if ('error' in quien) return res.status(quien.status).json({ error: quien.error });

      const alcanceCrudo = String(req.body?.alcance || 'proxima');
      if (!['proxima', 'vencidas', 'saldo'].includes(alcanceCrudo)) {
        return res.status(400).json({ error: 'No se entendió qué quieres pagar.' });
      }
      const alcance = alcanceCrudo as AlcancePago;

      const seleccion = elegirCuotasAPagar(quien.registro, alcance, deps.hoy());
      if ('error' in seleccion) return res.status(409).json({ error: seleccion.error });

      const db = deps.getDb();
      const desde = new Date(Date.now() - MINUTOS_INTENCION_VIVA * 60000).toISOString();

      /**
       * Reutiliza la intención viva si es exactamente la misma. El cliente que
       * toca el botón, se lo piensa y vuelve a tocarlo no genera dos cobros
       * posibles por lo mismo: una referencia pendiente es una puerta abierta a
       * cobrar, y dos abiertas por el mismo importe es cómo se cobra doble.
       */
      let intencion = await db.collection(COL_PAGOS_CUOTA).findOne({
        financingId: quien.registro.id,
        estado: 'pendiente',
        monto: seleccion.monto,
        alcance,
        creadoEn: { $gte: desde },
      });

      if (!intencion) {
        intencion = {
          referencia: nuevaReferenciaPago(),
          financingId: quien.registro.id,
          cliente: String(quien.registro.nombre || ''),
          cuotas: seleccion.cuotas,
          monto: seleccion.monto,
          concepto: seleccion.concepto,
          alcance,
          moneda: 'COP',
          estado: 'pendiente',
          creadoEn: new Date().toISOString(),
        };
        await db.collection(COL_PAGOS_CUOTA).insertOne(intencion);
        console.log(
          `[portal-pago] Intención ${intencion.referencia} para ${quien.registro.nombre}: ` +
            `${pesos(seleccion.monto)} (${seleccion.concepto}).`
        );
      }

      const base = deps.baseUrl();
      const vuelta = `${base}/p/${encodeURIComponent(quien.token)}?pago=${encodeURIComponent(intencion.referencia)}`;

      /**
       * Un link de Bold por intención, reutilizado mientras siga vivo.
       *
       * Crear uno nuevo en cada clic dejaría varios links pagables para la misma
       * referencia. Bold no permitiría cobrar dos veces la misma referencia,
       * pero sí dejaría al cliente delante de un link que ya no es el que
       * miramos, y eso es exactamente el tipo de duda que este portal existe
       * para quitar.
       *
       * Se descarta el link a falta de 5 minutos para que nadie se quede a
       * medias de escribir su cédula en PSE cuando el link caduca.
       */
      const margenMs = 5 * 60000;
      const vivo =
        intencion.linkUrl &&
        intencion.linkVenceEn &&
        new Date(intencion.linkVenceEn).getTime() > Date.now() + margenMs;

      let urlPago: string = intencion.linkUrl;
      let venceEn: string = intencion.linkVenceEn;

      if (!vivo) {
        let link: LinkDePago;
        try {
          link = await deps.crearLinkPago({
            referencia: intencion.referencia,
            montoCOP: intencion.monto,
            descripcion: `${seleccion.concepto} — ${deps.nombreBonito(quien.registro.nombre)}`,
            callbackUrl: vuelta,
            validoHoras: HORAS_LINK_PAGO,
          });
        } catch (err) {
          // Bold caído o rechazando. No es culpa del cliente y no tiene arreglo
          // por su parte: que le quede el camino de siempre.
          console.error('[portal-pago] Bold no entregó link para', intencion.referencia, err);
          return res.status(503).json({
            error: 'El pago en línea no está disponible ahora mismo. Escríbenos por WhatsApp.',
          });
        }

        urlPago = link.url;
        venceEn = link.venceEn;
        await db.collection(COL_PAGOS_CUOTA).updateOne(
          { referencia: intencion.referencia },
          { $set: { linkId: link.id, linkUrl: link.url, linkVenceEn: link.venceEn } }
        );
      }

      return res.json({
        url: urlPago,
        referencia: intencion.referencia,
        monto: intencion.monto,
        venceEn,
      });
    } catch (error) {
      console.error('[portal] Error preparando el pago:', error);
      return res.status(500).json({ error: 'No se pudo abrir el pago. Inténtalo otra vez.' });
    }
  });

  /* ─── Subir el comprobante ──────────────────────────────────────────────── */
  app.post('/api/portal/:token/comprobante', deps.limitador, async (req: Request, res: Response) => {
    try {
      const quien = await identificar(deps, req.params.token);
      if ('error' in quien) return res.status(quien.status).json({ error: quien.error });

      const cuota = cuotaEnJuego(quien.registro);
      if (!cuota) return res.status(409).json({ error: 'No tienes cuotas pendientes.' });

      const { image, filename } = req.body || {};
      if (!image || typeof image !== 'string') {
        return res.status(400).json({ error: 'No llegó la imagen. Vuelve a elegir la captura.' });
      }
      const parsed = deps.parsearImagen(image);
      if (!parsed) return res.status(400).json({ error: 'El archivo no parece ser una imagen.' });
      if (parsed.buffer.length > deps.maxBytesComprobante) {
        return res.status(413).json({
          error: `La imagen pesa ${Math.round(parsed.buffer.length / 1024)} KB y el máximo son ${Math.round(
            deps.maxBytesComprobante / 1024
          )} KB. Prueba con una captura de pantalla en vez de una foto.`,
        });
      }

      const db = deps.getDb();

      /**
       * No se reemplaza una captura ya subida.
       *
       * Si el cliente pudiera sobrescribirla, podría dejar una ilegible encima de
       * la buena después de que el dueño la viera, y el respaldo de la cuota
       * dependería del último que tocó el botón. Para corregir hay una persona al
       * otro lado del WhatsApp, y el panel sí permite reemplazarla.
       */
      if (cuota.comprobante?.mediaId) {
        return res.status(409).json({
          error: 'Ya tenemos una captura de esta cuota. Si te equivocaste, escríbenos y la cambiamos.',
        });
      }

      const mediaId = `comprobante-${randomBytes(16).toString('hex')}`;
      await db.collection('media').insertOne({
        mediaId,
        mime: parsed.mime,
        data: parsed.buffer,
        folder: 'comprobantes',
        createdAt: new Date().toISOString(),
      });

      const cuotas: any[] = quien.registro.cuotas || [];
      const idx = cuotas.findIndex((c) => Number(c?.number) === Number(cuota.number));
      cuotas[idx].comprobante = {
        mediaId,
        mime: parsed.mime,
        bytes: parsed.buffer.length,
        nombreArchivo: String(filename || 'comprobante.jpg').slice(0, 120),
        subidoEn: new Date().toISOString(),
        /**
         * Queda escrito que lo subió el cliente y no el mostrador. Importa: una
         * captura que trajo el cliente sin que nadie la contrastara con el banco
         * no vale lo mismo que una que el dueño ya verificó, y la cuota sigue
         * SIN marcarse pagada hasta que una persona lo haga.
         */
        subidoPor: 'cliente (portal)',
      };

      await db.collection(COL_FINANCING).updateOne({ id: quien.registro.id }, { $set: { cuotas } });

      console.log(
        `[portal] ${quien.registro.nombre} subió comprobante de la cuota #${cuota.number} desde el portal.`
      );
      deps.emitir('financingUpdated', { id: quien.registro.id, motivo: 'comprobante-portal' });
      await deps.avisarAlDueno(
        `📎 *${deps.nombreBonito(quien.registro.nombre)}* subió el comprobante de su cuota #${cuota.number} ` +
          `(${pesos(Number(quien.registro.valorCuota || 0))}) desde el portal. Falta verificarlo y marcar la cuota en el panel.`
      );

      return res.json({
        ok: true,
        mensaje: 'Listo, ya nos llegó. Lo revisamos y te registramos la cuota.',
      });
    } catch (error) {
      console.error('[portal] Error guardando el comprobante del cliente:', error);
      return res.status(500).json({ error: 'No se pudo guardar la captura. Inténtalo otra vez.' });
    }
  });

  /* ─── Pedir plazo ───────────────────────────────────────────────────────── */
  app.post('/api/portal/:token/plazo', deps.limitador, async (req: Request, res: Response) => {
    try {
      const quien = await identificar(deps, req.params.token);
      if ('error' in quien) return res.status(quien.status).json({ error: quien.error });

      const { registro } = quien;
      const hoy = deps.hoy();

      const cuota = cuotaEnJuego(registro);
      if (!cuota) return res.status(409).json({ error: 'No tienes cuotas pendientes.' });

      if (solicitudPendienteDe(registro)) {
        return res.status(409).json({
          error: 'Ya tienes una solicitud pendiente. Te avisamos en cuanto la revisemos.',
        });
      }

      const revision = validarProrroga(req.body?.hasta, cuota, hoy);
      if ('error' in revision) return res.status(400).json({ error: revision.error });

      const motivo = String(req.body?.motivo || '').trim().slice(0, 300);
      const solicitud: SolicitudPlazo = {
        id: nuevaSolicitudId(),
        cuotaNumber: Number(cuota.number),
        hasta: revision.hasta,
        motivo,
        pedidaEn: new Date().toISOString(),
        estado: 'pendiente',
      };

      const db = deps.getDb();
      await db.collection(COL_FINANCING).updateOne(
        { id: registro.id },
        { $push: { solicitudesPlazo: solicitud } } as any
      );

      const reglas = await leerReglas(deps);
      const veredicto = decidirPlazoAutomatico(reglas, registro, revision.hasta, hoy);

      if (veredicto.auto) {
        /**
         * Plazo automático. Pasa por el MISMO camino que el botón del panel
         * —`alOtorgarProrroga`— y no por una copia: ahí viven el desbloqueo del
         * equipo, el refresco del panel de bloqueo y el WhatsApp de confirmación.
         * Duplicarlo sería garantizar que un día una de las dos vías se quede sin
         * el desbloqueo.
         */
        const cuotas: any[] = registro.cuotas || [];
        const idx = cuotas.findIndex((c) => Number(c?.number) === Number(cuota.number));
        cuotas[idx].prorroga = {
          hasta: revision.hasta,
          otorgadaEn: new Date().toISOString(),
          otorgadaPor: 'portal (automático)',
          fechaOriginal: String(cuotas[idx].dueDate).slice(0, 10),
          ...(motivo ? { motivo } : {}),
        };

        await db.collection(COL_FINANCING).updateOne(
          { id: registro.id },
          {
            $set: {
              cuotas,
              prorrogasOtorgadas: Number(registro.prorrogasOtorgadas || 0) + 1,
            },
          }
        );
        await marcarSolicitud(deps, registro.id, solicitud.id, 'automatica', 'portal');

        const equipo = await deps.alOtorgarProrroga(registro.id, revision.hasta, Number(cuota.number));
        deps.emitir('financingUpdated', { id: registro.id, motivo: 'plazo-automatico' });

        await deps.avisarAlDueno(
          `⏳ Plazo *automático* concedido a *${deps.nombreBonito(registro.nombre)}*: cuota #${cuota.number} ` +
            `hasta el ${fechaLarga(revision.hasta)}.${motivo ? ` Dijo: "${motivo}".` : ''}` +
            `${equipo.liberado ? ' El equipo quedó desbloqueado.' : ''}`
        );

        console.log(
          `[portal] Plazo automático para ${registro.nombre} cuota #${cuota.number} hasta ${revision.hasta}.`
        );
        return res.json({
          ok: true,
          automatico: true,
          mensaje: `Listo. Tienes plazo hasta el ${fechaLarga(revision.hasta)}.`,
        });
      }

      // Lo decide una persona. El aviso lleva el motivo del cliente y el motivo
      // por el que no se concedió solo, que es lo que el dueño necesita saber
      // para contestar sin tener que abrir nada.
      deps.emitir('solicitudPlazo', {
        financingId: registro.id,
        cliente: registro.nombre,
        cuotaNumber: solicitud.cuotaNumber,
        hasta: solicitud.hasta,
      });

      await deps.avisarAlDueno(
        `⏳ *${deps.nombreBonito(registro.nombre)}* pide plazo para su cuota #${cuota.number} ` +
          `(${pesos(Number(registro.valorCuota || 0))}) hasta el *${fechaLarga(revision.hasta)}*.\n` +
          `${motivo ? `Dice: "${motivo}"\n` : ''}` +
          `Sin conceder: ${veredicto.motivo}.\n` +
          `Plazos que ya se le dieron: ${Number(registro.prorrogasOtorgadas || 0)}.\n\n` +
          `Apruébalo o recházalo en Financiamiento → Prórroga.`
      );

      console.log(
        `[portal] ${registro.nombre} pide plazo hasta ${revision.hasta} (cuota #${cuota.number}). ` +
          `No automático: ${veredicto.motivo}.`
      );

      return res.json({
        ok: true,
        automatico: false,
        mensaje: 'Tu solicitud quedó registrada. Te avisamos por WhatsApp en cuanto la revisemos.',
      });
    } catch (error) {
      console.error('[portal] Error registrando la solicitud de plazo:', error);
      return res.status(500).json({ error: 'No se pudo registrar tu solicitud. Inténtalo otra vez.' });
    }
  });

  /* ══════════════════════  Lo que ve el dueño  ══════════════════════ */

  /** El link del cliente, para copiarlo o mandarlo desde el panel. */
  app.get('/api/portal-admin/link/:id', async (req: Request, res: Response) => {
    try {
      const db = deps.getDb();
      const registro = await db.collection(COL_FINANCING).findOne({ id: req.params.id });
      if (!registro) return res.status(404).json({ error: 'Financiamiento no encontrado' });
      const url = linkPortal(deps.baseUrl(), deps.secreto(), registro);
      if (!url) return res.status(500).json({ error: 'No se pudo generar el link del portal.' });
      return res.json({ url, version: Number(registro.portalVersion || 0) });
    } catch (error) {
      console.error('[portal] Error generando el link:', error);
      return res.status(500).json({ error: 'No se pudo generar el link.' });
    }
  });

  /**
   * Invalida el link anterior de un cliente y devuelve el nuevo.
   *
   * Hace falta cuando un cliente reenvía su link —a un familiar, a un grupo— y
   * se arrepiente. Sube sólo su `portalVersion`: los otros 111 no se enteran.
   */
  app.post('/api/portal-admin/link/:id/rotar', async (req: Request, res: Response) => {
    try {
      const db = deps.getDb();
      const registro = await db.collection(COL_FINANCING).findOne({ id: req.params.id });
      if (!registro) return res.status(404).json({ error: 'Financiamiento no encontrado' });
      const version = Number(registro.portalVersion || 0) + 1;
      await db.collection(COL_FINANCING).updateOne({ id: req.params.id }, { $set: { portalVersion: version } });
      const url = linkPortal(deps.baseUrl(), deps.secreto(), { ...registro, portalVersion: version });
      console.log(`[portal] Link rotado para ${registro.nombre} (versión ${version}).`);
      return res.json({ url, version });
    } catch (error) {
      console.error('[portal] Error rotando el link:', error);
      return res.status(500).json({ error: 'No se pudo rotar el link.' });
    }
  });

  /** Solicitudes de plazo sin resolver, de toda la cartera. */
  app.get('/api/portal-admin/solicitudes', async (_req: Request, res: Response) => {
    try {
      const db = deps.getDb();
      const registros = await db
        .collection(COL_FINANCING)
        .find({ 'solicitudesPlazo.estado': 'pendiente' })
        .toArray();
      const pendientes = registros
        .map((r: any) => {
          const s = solicitudPendienteDe(r);
          if (!s) return null;
          return {
            financingId: r.id,
            cliente: r.nombre,
            telefono: r.telefono,
            valorCuota: r.valorCuota,
            plazosPrevios: Number(r.prorrogasOtorgadas || 0),
            ...s,
            hastaLargo: fechaLarga(s.hasta),
          };
        })
        .filter(Boolean)
        .sort((a: any, b: any) => String(a.pedidaEn).localeCompare(String(b.pedidaEn)));
      return res.json(pendientes);
    } catch (error) {
      console.error('[portal] Error listando solicitudes:', error);
      return res.status(500).json({ error: 'No se pudieron cargar las solicitudes.' });
    }
  });

  /**
   * Rechaza una solicitud. Conceder NO pasa por aquí: se concede con el botón de
   * prórroga que ya existe, y esa ruta marca la solicitud como concedida sola.
   * Tener dos sitios donde se otorga un plazo es tener dos sitios donde arreglar
   * el desbloqueo cuando falle.
   */
  app.post('/api/portal-admin/solicitudes/:id/rechazar', async (req: Request, res: Response) => {
    try {
      const solicitudId = String(req.params.id || '');
      const db = deps.getDb();
      const registro = await db
        .collection(COL_FINANCING)
        .findOne({ 'solicitudesPlazo.id': solicitudId });
      if (!registro) return res.status(404).json({ error: 'Solicitud no encontrada' });

      const solicitud = solicitudesDe(registro).find((s) => s.id === solicitudId);
      if (!solicitud || solicitud.estado !== 'pendiente') {
        return res.status(409).json({ error: 'Esa solicitud ya estaba resuelta.' });
      }

      await marcarSolicitud(
        deps,
        registro.id,
        solicitudId,
        'rechazada',
        (req as any).sesion?.usuario || 'admin'
      );

      const nota = String(req.body?.nota || '').trim().slice(0, 300);
      await enviarAlCliente(
        deps,
        registro,
        `⏳ *Sobre tu solicitud de plazo*\n\nHola *${deps.nombreBonito(registro.nombre)}*, revisamos tu solicitud ` +
          `para la cuota #${solicitud.cuotaNumber} y por ahora no podemos darte plazo hasta el ${fechaLarga(
            solicitud.hasta
          )}.${nota ? `\n\n${nota}` : ''}\n\nEscríbenos al 302 287 5280 y buscamos una solución juntos.\n\n` +
          `_CREDILOCK — Sistema de financiamiento_`
      );

      console.log(`[portal] Solicitud ${solicitudId} de ${registro.nombre} rechazada.`);
      deps.emitir('financingUpdated', { id: registro.id, motivo: 'solicitud-rechazada' });
      return res.json({ ok: true });
    } catch (error) {
      console.error('[portal] Error rechazando la solicitud:', error);
      return res.status(500).json({ error: 'No se pudo rechazar la solicitud.' });
    }
  });

  /** Reglas del plazo automático: leerlas y cambiarlas. */
  app.get('/api/portal-admin/reglas', async (_req: Request, res: Response) => {
    return res.json(await leerReglas(deps));
  });

  app.put('/api/portal-admin/reglas', async (req: Request, res: Response) => {
    try {
      const reglas = normalizarReglasPlazo(req.body);
      const db = deps.getDb();
      await db.collection(COL_SETTINGS).updateOne(
        { key: CLAVE_REGLAS },
        { $set: { key: CLAVE_REGLAS, value: reglas, actualizadoEn: new Date().toISOString() } },
        { upsert: true }
      );
      console.log(
        `[portal] Plazo automático ${reglas.activo ? 'ACTIVADO' : 'desactivado'} ` +
          `(máx ${reglas.maxDias} días, ${reglas.maxPorContrato} por contrato).`
      );
      return res.json(reglas);
    } catch (error) {
      console.error('[portal] Error guardando las reglas:', error);
      return res.status(500).json({ error: 'No se pudieron guardar las reglas.' });
    }
  });

  /** Pagos en línea, para que el dueño los vea junto a los del mostrador. */
  app.get('/api/portal-admin/pagos', async (req: Request, res: Response) => {
    try {
      const db = deps.getDb();
      const filtro: Record<string, unknown> = {};
      if (req.query.financingId) filtro.financingId = String(req.query.financingId);
      if (req.query.estado) filtro.estado = String(req.query.estado);
      const pagos = await db
        .collection(COL_PAGOS_CUOTA)
        .find(filtro)
        .sort({ creadoEn: -1 })
        .limit(300)
        .toArray();
      return res.json(pagos);
    } catch (error) {
      console.error('[portal] Error listando pagos en línea:', error);
      return res.status(500).json({ error: 'No se pudieron cargar los pagos.' });
    }
  });
}

/**
 * Cambia el estado de una solicitud dentro del array.
 *
 * Exportada porque la ruta de prórroga de `index.ts` la usa para cerrar la
 * solicitud cuando el dueño concede el plazo con el botón de siempre. Así
 * conceder sigue siendo una sola operación en un solo sitio.
 */
export async function marcarSolicitud(
  deps: DepsPortal,
  financingId: string,
  solicitudId: string,
  estado: SolicitudPlazo['estado'],
  porQuien: string
): Promise<void> {
  try {
    const db = deps.getDb();
    if (!db) return;
    await db.collection(COL_FINANCING).updateOne(
      { id: financingId, 'solicitudesPlazo.id': solicitudId },
      {
        $set: {
          'solicitudesPlazo.$.estado': estado,
          'solicitudesPlazo.$.resueltaEn': new Date().toISOString(),
          'solicitudesPlazo.$.resueltaPor': porQuien,
        },
      }
    );
  } catch (err) {
    console.error('[portal] No se pudo marcar la solicitud:', err);
  }
}

/**
 * Cierra la solicitud pendiente de una cuota al concederse el plazo por el
 * camino normal. Si no había ninguna, no hace nada: la mayoría de las prórrogas
 * las sigue dando el dueño por teléfono, sin que el cliente pida nada.
 */
export async function cerrarSolicitudAlConceder(
  deps: DepsPortal,
  registro: any,
  cuotaNumber: number,
  porQuien: string
): Promise<void> {
  const pendiente = solicitudesDe(registro).find(
    (s) => s.estado === 'pendiente' && Number(s.cuotaNumber) === Number(cuotaNumber)
  );
  if (!pendiente) return;
  await marcarSolicitud(deps, registro.id, pendiente.id, 'concedida', porQuien);
}
