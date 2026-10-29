/**
 * CONCILIADOR DE PAGOS: el respaldo del webhook de Bold.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * POR QUÉ EXISTE
 * ──────────────
 * Toda la automatización del cobro colgaba de un único aviso HTTP. Si ese aviso
 * no llega —porque la URL cambió, porque nadie la registró en el panel de Bold,
 * porque hubo un corte de treinta segundos— el cliente pagó y el equipo sigue
 * bloqueado. El cliente llama enfadado, con razón, y el dueño no tiene ni idea
 * de qué pasó porque en su panel no hay ningún pago.
 *
 * Y no es un supuesto. Al revisar la base de datos aparecieron 14 pedidos de la
 * tienda parados en `pending_bold`, por $18.770.000, sin una sola señal de que
 * ese webhook hubiera funcionado nunca. Puede que casi todos sean carritos
 * abandonados; el problema es que no hay forma de distinguirlos, y esa es
 * exactamente la situación que este archivo impide que se repita.
 *
 * QUÉ HACE
 * ────────
 * Cada pocos minutos mira lo que lleva rato esperando y le pregunta a Bold
 * directamente. Si Bold dice que está aprobado, lo aplica por el mismo camino
 * que habría seguido el webhook. El webhook pasa a ser un atajo: cuando
 * funciona, el desbloqueo es instantáneo; cuando no, llega con unos minutos de
 * retraso en vez de no llegar nunca.
 *
 * LAS DOS REGLAS QUE NO SE TOCAN
 * ──────────────────────────────
 * 1. **Nunca dar por impagado.** La API de Bold sólo conserva la transacción 24
 *    horas. Pasado ese plazo, una referencia que se pagó responde exactamente
 *    igual que una que nunca se intentó. Por eso `sin_datos` no cierra nada:
 *    sólo un "rechazado" explícito de Bold marca un rechazo.
 *
 * 2. **Nunca aplicar sin cuadrar el importe.** El desbloqueo es irreversible
 *    desde este lado. Comparar el total cuesta una resta.
 *
 * Aplicar dos veces no es un riesgo: `confirmarCuotas` se cierra con un update
 * condicional sobre el estado, así que si el webhook y el conciliador coinciden,
 * el segundo no hace nada.
 */
import {
  type ConfigBold,
  type TransaccionBold,
  consultarTransaccion,
  pagoConfirmado,
} from './bold-link';

const COL_PAGOS_CUOTA = 'pagos_cuota';
const COL_ORDERS = 'orders';

/**
 * Cuánto se le deja al webhook antes de desconfiar.
 *
 * El webhook normal llega en segundos. Este margen evita preguntar por pagos que
 * están llegando ahora mismo y, sobre todo, evita avisar al dueño de una avería
 * que no existe.
 */
const MINUTOS_DE_GRACIA = 4;

/**
 * Hasta dónde se mira hacia atrás.
 *
 * Es la ventana de consulta de Bold: 24 horas. Más allá, preguntar no aporta
 * información —responde lo mismo para pagado y para no intentado— así que no se
 * pregunta. Lo viejo se queda como está, pendiente, para que un webhook tardío
 * todavía pueda aplicarlo.
 */
const HORAS_VENTANA = 24;

/** Tope por vuelta, para que una acumulación no dispare cientos de llamadas. */
const MAX_POR_VUELTA = 40;

export interface DepsConciliador {
  getDb(): any;
  /** `null` si no hay llaves de Bold: entonces el conciliador no corre. */
  bold(): ConfigBold | null;
  /** Mismo camino que usa el webhook. Es `confirmarPagoDeCuotas`. */
  confirmarCuotas(
    referencia: string,
    extra: { paymentId?: string; metodo?: string }
  ): Promise<void>;
  /** Mismo camino que usa el webhook para la tienda. Es `transitionOrderAndNotify`. */
  confirmarPedido(pedido: any, metodo: string): Promise<void>;
  avisarAlDueno(texto: string): Promise<void>;
  /** Inyectable para los tests. */
  ahora?(): Date;
}

export interface ResumenConciliacion {
  revisadas: number;
  rescatadas: number;
  rechazadas: number;
  sinDatos: number;
  errores: number;
}

function vacio(): ResumenConciliacion {
  return { revisadas: 0, rescatadas: 0, rechazadas: 0, sinDatos: 0, errores: 0 };
}

function sumar(a: ResumenConciliacion, b: ResumenConciliacion): ResumenConciliacion {
  return {
    revisadas: a.revisadas + b.revisadas,
    rescatadas: a.rescatadas + b.rescatadas,
    rechazadas: a.rechazadas + b.rechazadas,
    sinDatos: a.sinDatos + b.sinDatos,
    errores: a.errores + b.errores,
  };
}

function pesos(valor: number): string {
  return `$${Math.round(Number(valor) || 0).toLocaleString('es-CO')}`;
}

/* ═══════════════════════════  Cuotas del portal  ═══════════════════════════ */

async function conciliarCuotas(
  deps: DepsConciliador,
  cfg: ConfigBold,
  ahora: Date
): Promise<ResumenConciliacion> {
  const r = vacio();
  const db = deps.getDb();
  if (!db) return r;

  const desde = new Date(ahora.getTime() - HORAS_VENTANA * 3600_000).toISOString();
  const hasta = new Date(ahora.getTime() - MINUTOS_DE_GRACIA * 60_000).toISOString();

  const pendientes = await db
    .collection(COL_PAGOS_CUOTA)
    .find({ estado: 'pendiente', creadoEn: { $gte: desde, $lte: hasta } })
    .limit(MAX_POR_VUELTA)
    .toArray();

  for (const intencion of pendientes) {
    r.revisadas++;
    let t: TransaccionBold;
    try {
      t = await consultarTransaccion(cfg, intencion.referencia);
    } catch (err) {
      r.errores++;
      console.error('[conciliador] Falló la consulta de', intencion.referencia, err);
      continue;
    }

    if (t.estado === 'aprobada') {
      if (!pagoConfirmado(t, intencion.monto)) {
        // Aprobada pero por otro importe. No se aplica: se avisa, porque esto
        // no se arregla solo y alguien tiene que mirarlo.
        r.errores++;
        console.error(
          `[conciliador] ${intencion.referencia} aprobada por ${pesos(t.total ?? 0)} ` +
            `pero la intención era de ${pesos(intencion.monto)}. No se aplica.`
        );
        await deps.avisarAlDueno(
          `⚠️ Pago con importe que no cuadra\n\n` +
            `Referencia: ${intencion.referencia}\n` +
            `Esperado: ${pesos(intencion.monto)}\n` +
            `Pagado: ${pesos(t.total ?? 0)}\n\n` +
            `No se aplicó ni se desbloqueó nada. Revísalo a mano.`
        );
        continue;
      }

      try {
        await deps.confirmarCuotas(intencion.referencia, {
          paymentId: t.paymentId,
          metodo: t.metodo,
        });
      } catch (err) {
        r.errores++;
        console.error('[conciliador] No se pudo aplicar', intencion.referencia, err);
        continue;
      }

      // El pago ya está aplicado. Lo que sigue es sólo avisar, y avisar no puede
      // reabrir lo que ya se cerró: va fuera del try de arriba para que un fallo
      // del aviso no se registre como "no se pudo aplicar" ni descuente el
      // rescate. Un conciliador que miente sobre lo que hizo es peor que ninguno.
      r.rescatadas++;
      console.log(`[conciliador] Rescatado el pago ${intencion.referencia} (${pesos(intencion.monto)}).`);
      try {
        await deps.avisarAlDueno(
          `🔔 Un pago entró por el conciliador, no por el webhook\n\n` +
            `Referencia: ${intencion.referencia}\n` +
            `Monto: ${pesos(intencion.monto)}\n` +
            `Cliente: ${intencion.cliente || '—'}\n\n` +
            `El pago ya quedó aplicado y el equipo desbloqueado. Pero que haga ` +
            `falta el conciliador significa que el webhook de Bold no está ` +
            `llegando: revisa que esté registrado en el panel de Bold.`
        );
      } catch (err) {
        console.error('[conciliador] Rescate aplicado, pero el aviso falló:', err);
      }
      continue;
    }

    if (t.estado === 'rechazada') {
      // Un rechazo explícito sí cierra la intención: deja de ser una puerta
      // abierta a cobrar y desaparece de las siguientes vueltas.
      await db
        .collection(COL_PAGOS_CUOTA)
        .updateOne(
          { referencia: intencion.referencia, estado: 'pendiente' },
          { $set: { estado: 'rechazado', cerradoEn: ahora.toISOString(), cerradoPor: 'conciliador' } }
        );
      r.rechazadas++;
      continue;
    }

    if (t.estado === 'sin_datos') r.sinDatos++;
    else if (t.estado === 'error') r.errores++;
  }

  return r;
}

/* ════════════════════════════  Pedidos de tienda  ══════════════════════════ */

/**
 * Lo mismo para la tienda online.
 *
 * Aquí la tarjeta sí está permitida —vende más y el riesgo de contracargo no
 * cuelga de un desbloqueo automático— así que el método que devuelva Bold se
 * acepta tal cual y sólo se usa para la etiqueta del movimiento de caja.
 */
async function conciliarPedidos(
  deps: DepsConciliador,
  cfg: ConfigBold,
  ahora: Date
): Promise<ResumenConciliacion> {
  const r = vacio();
  const db = deps.getDb();
  if (!db) return r;

  const desde = new Date(ahora.getTime() - HORAS_VENTANA * 3600_000).toISOString();
  const hasta = new Date(ahora.getTime() - MINUTOS_DE_GRACIA * 60_000).toISOString();

  const pendientes = await db
    .collection(COL_ORDERS)
    .find({ status: 'pending_bold', createdAt: { $gte: desde, $lte: hasta } })
    .limit(MAX_POR_VUELTA)
    .toArray();

  for (const pedido of pendientes) {
    r.revisadas++;
    let t: TransaccionBold;
    try {
      t = await consultarTransaccion(cfg, pedido.orderNumber);
    } catch (err) {
      r.errores++;
      console.error('[conciliador] Falló la consulta del pedido', pedido.orderNumber, err);
      continue;
    }

    if (t.estado !== 'aprobada') {
      if (t.estado === 'sin_datos') r.sinDatos++;
      else if (t.estado === 'error') r.errores++;
      else if (t.estado === 'rechazada') r.rechazadas++;
      continue;
    }

    if (!pagoConfirmado(t, pedido.total)) {
      r.errores++;
      console.error(
        `[conciliador] Pedido ${pedido.orderNumber} aprobado por ${pesos(t.total ?? 0)} ` +
          `y el pedido es de ${pesos(pedido.total)}. No se aplica.`
      );
      continue;
    }

    try {
      await deps.confirmarPedido(pedido, `BOLD (${t.metodo || 'en línea'})`);
    } catch (err) {
      r.errores++;
      console.error('[conciliador] No se pudo aplicar el pedido', pedido.orderNumber, err);
      continue;
    }

    // Igual que en las cuotas: ya está aplicado, el aviso no puede desdecirlo.
    r.rescatadas++;
    console.log(`[conciliador] Rescatado el pedido ${pedido.orderNumber} (${pesos(pedido.total)}).`);
    try {
      await deps.avisarAlDueno(
        `🔔 Pedido pagado que el webhook no reportó\n\n` +
          `Pedido: ${pedido.orderNumber}\n` +
          `Monto: ${pesos(pedido.total)}\n\n` +
          `Ya quedó marcado como pagado. Revisa que el webhook de Bold esté ` +
          `registrado en el panel.`
      );
    } catch (err) {
      console.error('[conciliador] Rescate aplicado, pero el aviso falló:', err);
    }
  }

  return r;
}

/* ══════════════════════════════  Punto de entrada  ═════════════════════════ */

export async function conciliarPagos(
  deps: DepsConciliador
): Promise<ResumenConciliacion> {
  const cfg = deps.bold();
  if (!cfg?.apiKey) return vacio();

  const ahora = deps.ahora?.() ?? new Date();

  // Las dos mitades por separado: que la tienda falle no puede dejar sin
  // conciliar las cuotas, que es donde un fallo deja a alguien sin su equipo.
  let total = vacio();
  try {
    total = sumar(total, await conciliarCuotas(deps, cfg, ahora));
  } catch (err) {
    console.error('[conciliador] Error conciliando cuotas:', err);
  }
  try {
    total = sumar(total, await conciliarPedidos(deps, cfg, ahora));
  } catch (err) {
    console.error('[conciliador] Error conciliando pedidos:', err);
  }

  if (total.revisadas) {
    console.log(
      `[conciliador] Revisadas ${total.revisadas} · rescatadas ${total.rescatadas} · ` +
        `rechazadas ${total.rechazadas} · sin datos ${total.sinDatos} · errores ${total.errores}`
    );
  }
  return total;
}
