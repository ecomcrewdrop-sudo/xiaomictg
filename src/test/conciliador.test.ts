// @vitest-environment node
/**
 * El conciliador: lo que rescata un pago cuando el webhook no llega.
 *
 * Este archivo existe porque el fallo que cubre ya ocurrió de verdad. En la base
 * de datos de producción había 14 pedidos parados en `pending_bold` por
 * $18.770.000, sin una sola señal de que el webhook de Bold hubiera funcionado
 * nunca. Lo que más duele de ese caso no es el dinero: es que no había forma de
 * distinguir "nadie pagó" de "pagaron y no nos enteramos".
 *
 * Por eso las dos pruebas que más importan aquí son negativas:
 *
 *  - Que `sin_datos` NO cierre nada. Bold olvida la transacción a las 24 horas,
 *    así que a partir de ahí no sabe distinguir pagado de no intentado. Si el
 *    conciliador cerrara por silencio, enterraría justo los casos que busca.
 *  - Que un importe que no cuadra NO se aplique. El desbloqueo no tiene vuelta
 *    atrás desde la tienda.
 *
 * Y una positiva igual de importante: que un error en una intención no aborte el
 * repaso de las demás. Un conciliador que se cae en el primer fallo es un
 * conciliador que no concilia el día que hace falta.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { conciliarPagos, type DepsConciliador } from '../../server/conciliador';
import type { TransaccionBold } from '../../server/bold-link';

/* ───────────────────────  Mongo de juguete  ─────────────────────── */

function cumple(doc: any, filtro: any): boolean {
  return Object.entries(filtro || {}).every(([clave, cond]) => {
    const valor = doc[clave];
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      const c = cond as any;
      if (c.$gte !== undefined && !(valor >= c.$gte)) return false;
      if (c.$lte !== undefined && !(valor <= c.$lte)) return false;
      return true;
    }
    return valor === cond;
  });
}

function coleccion(docs: any[]) {
  return {
    docs,
    find(filtro: any) {
      let res = docs.filter((d) => cumple(d, filtro));
      return {
        limit(n: number) {
          res = res.slice(0, n);
          return this;
        },
        // Copias, no los documentos vivos: si el código de producción mutara el
        // objeto recibido, la prueba no vería que nunca pasó por updateOne.
        toArray: async () => res.map((d) => JSON.parse(JSON.stringify(d))),
      };
    },
    updateOne: async (filtro: any, cambios: any) => {
      const doc = docs.find((d) => cumple(d, filtro));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      Object.assign(doc, cambios?.$set || {});
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };
}

function mongoFalso(inicial: Record<string, any[]>) {
  const cols: Record<string, any> = {};
  for (const [nombre, docs] of Object.entries(inicial)) cols[nombre] = coleccion(docs);
  return {
    collection: (nombre: string) => (cols[nombre] ??= coleccion([])),
    _col: (nombre: string) => cols[nombre],
  };
}

/* ────────────────────────  Montaje  ──────────────────────── */

const AHORA = new Date('2026-10-13T12:00:00.000Z');
const haceMinutos = (m: number) => new Date(AHORA.getTime() - m * 60_000).toISOString();
const haceHoras = (h: number) => new Date(AHORA.getTime() - h * 3600_000).toISOString();

/** Una intención pendiente, lo bastante vieja para que el conciliador la mire. */
function intencion(extra: Partial<any> = {}) {
  return {
    referencia: 'CL-AABBCCDDEEFF',
    financingId: 'F1',
    cliente: 'Elsi Carreño',
    cuotas: [1],
    monto: 93000,
    estado: 'pendiente',
    creadoEn: haceMinutos(20),
    ...extra,
  };
}

function pedido(extra: Partial<any> = {}) {
  return {
    id: 'o1',
    orderNumber: 'XM-12345678',
    total: 480000,
    status: 'pending_bold',
    createdAt: haceMinutos(20),
    ...extra,
  };
}

interface Montaje {
  deps: DepsConciliador;
  db: ReturnType<typeof mongoFalso>;
  confirmarCuotas: ReturnType<typeof vi.fn>;
  confirmarPedido: ReturnType<typeof vi.fn>;
  avisos: string[];
  consultas: string[];
}

/**
 * `respuestas` mapea referencia → lo que contesta Bold. Lo que no esté listado
 * responde `sin_datos`, que es el caso más común en la realidad.
 */
function montar(
  datos: Record<string, any[]>,
  respuestas: Record<string, TransaccionBold>,
  opciones: { sinLlave?: boolean; sinDb?: boolean; avisoRoto?: boolean } = {}
): Montaje {
  const db = mongoFalso(datos);
  const avisos: string[] = [];
  const consultas: string[] = [];
  const confirmarCuotas = vi.fn(async () => {});
  const confirmarPedido = vi.fn(async () => {});

  const deps: DepsConciliador = {
    getDb: () => (opciones.sinDb ? null : db),
    bold: () =>
      opciones.sinLlave
        ? null
        : {
            apiKey: 'LLAVE',
            fetchImpl: (async (url: any) => {
              const ref = decodeURIComponent(String(url).split('/').pop()!);
              consultas.push(ref);
              const t = respuestas[ref];
              if (!t) return { status: 404, text: async () => '{}' } as any;
              const mapa: Record<string, string> = {
                aprobada: 'APPROVED',
                rechazada: 'REJECTED',
                en_proceso: 'PENDING',
                sin_datos: 'NO_TRANSACTION_FOUND',
                error: 'ESTADO_RARO',
              };
              return {
                status: 200,
                text: async () =>
                  JSON.stringify({
                    payment_status: mapa[t.estado],
                    transaction_id: t.paymentId,
                    payment_method: t.metodo,
                    total: t.total,
                  }),
              } as any;
            }) as unknown as typeof fetch,
          },
    confirmarCuotas,
    confirmarPedido,
    avisarAlDueno: async (texto: string) => {
      avisos.push(texto);
      if (opciones.avisoRoto) throw new Error('WhatsApp caído');
    },
    ahora: () => AHORA,
  };

  return { deps, db, confirmarCuotas, confirmarPedido, avisos, consultas };
}

const aprobada = (total?: number, extra: Partial<TransaccionBold> = {}): TransaccionBold => ({
  estado: 'aprobada',
  total,
  ...extra,
});

/* ═══════════════════════════  Cuándo no hace nada  ═════════════════ */

describe('conciliador — cuándo se queda quieto', () => {
  it('sin llave de Bold no consulta nada', async () => {
    const m = montar({ pagos_cuota: [intencion()] }, {}, { sinLlave: true });
    const r = await conciliarPagos(m.deps);
    expect(r.revisadas).toBe(0);
    expect(m.consultas).toHaveLength(0);
  });

  it('sin base de datos no revienta', async () => {
    const m = montar({}, {}, { sinDb: true });
    await expect(conciliarPagos(m.deps)).resolves.toMatchObject({ revisadas: 0 });
  });

  it('no toca una intención recién creada: al webhook se le da su margen', async () => {
    const m = montar({ pagos_cuota: [intencion({ creadoEn: haceMinutos(1) })] }, {});
    const r = await conciliarPagos(m.deps);
    expect(r.revisadas).toBe(0);
    expect(m.consultas).toHaveLength(0);
  });

  it('no pregunta por intenciones de hace más de 24h: Bold ya no sabe', async () => {
    const m = montar({ pagos_cuota: [intencion({ creadoEn: haceHoras(30) })] }, {});
    const r = await conciliarPagos(m.deps);
    expect(r.revisadas).toBe(0);
  });

  it('deja esa intención vieja PENDIENTE, para que un webhook tardío aún valga', async () => {
    const vieja = intencion({ creadoEn: haceHoras(30) });
    const m = montar({ pagos_cuota: [vieja] }, {});
    await conciliarPagos(m.deps);
    expect(m.db._col('pagos_cuota').docs[0].estado).toBe('pendiente');
  });

  it('ignora lo que ya no está pendiente', async () => {
    const m = montar({ pagos_cuota: [intencion({ estado: 'aprobado' })] }, {});
    expect((await conciliarPagos(m.deps)).revisadas).toBe(0);
  });
});

/* ═══════════════════════════  Rescate de cuotas  ═══════════════════ */

describe('conciliador — cuotas', () => {
  it('aplica un pago aprobado por el mismo camino que el webhook', async () => {
    const m = montar(
      { pagos_cuota: [intencion()] },
      { 'CL-AABBCCDDEEFF': aprobada(93000, { paymentId: 'TRX-1', metodo: 'NEQUI' }) }
    );
    const r = await conciliarPagos(m.deps);

    expect(r.rescatadas).toBe(1);
    expect(m.confirmarCuotas).toHaveBeenCalledWith('CL-AABBCCDDEEFF', {
      paymentId: 'TRX-1',
      metodo: 'NEQUI',
    });
  });

  it('avisa al dueño, porque un rescate significa que el webhook está roto', async () => {
    const m = montar({ pagos_cuota: [intencion()] }, { 'CL-AABBCCDDEEFF': aprobada(93000) });
    await conciliarPagos(m.deps);
    expect(m.avisos).toHaveLength(1);
    expect(m.avisos[0]).toContain('CL-AABBCCDDEEFF');
    expect(m.avisos[0]).toMatch(/webhook/i);
  });

  it('si el aviso falla, el rescate sigue contando como rescate', async () => {
    // El pago ya está aplicado cuando se intenta avisar. Que WhatsApp esté caído
    // no puede convertir un rescate real en un "error": si el resumen miente, el
    // dueño va a buscar un pago perdido que en realidad sí entró.
    const m = montar(
      { pagos_cuota: [intencion()] },
      { 'CL-AABBCCDDEEFF': aprobada(93000) },
      { avisoRoto: true }
    );
    const r = await conciliarPagos(m.deps);

    expect(m.confirmarCuotas).toHaveBeenCalledTimes(1);
    expect(r.rescatadas).toBe(1);
    expect(r.errores).toBe(0);
  });

  it('NO aplica si el importe no cuadra, y lo denuncia', async () => {
    const m = montar({ pagos_cuota: [intencion()] }, { 'CL-AABBCCDDEEFF': aprobada(100) });
    const r = await conciliarPagos(m.deps);

    expect(m.confirmarCuotas).not.toHaveBeenCalled();
    expect(r.rescatadas).toBe(0);
    expect(r.errores).toBe(1);
    expect(m.avisos[0]).toMatch(/no cuadra/i);
  });

  it('un rechazo explícito sí cierra la intención', async () => {
    const m = montar(
      { pagos_cuota: [intencion()] },
      { 'CL-AABBCCDDEEFF': { estado: 'rechazada' } }
    );
    const r = await conciliarPagos(m.deps);

    expect(r.rechazadas).toBe(1);
    expect(m.db._col('pagos_cuota').docs[0].estado).toBe('rechazado');
    expect(m.db._col('pagos_cuota').docs[0].cerradoPor).toBe('conciliador');
    expect(m.confirmarCuotas).not.toHaveBeenCalled();
  });

  it('el silencio de Bold NO cierra la intención', async () => {
    // Lo más importante del archivo: sin datos no es un rechazo.
    const m = montar({ pagos_cuota: [intencion()] }, { 'CL-AABBCCDDEEFF': { estado: 'sin_datos' } });
    const r = await conciliarPagos(m.deps);

    expect(r.sinDatos).toBe(1);
    expect(r.rechazadas).toBe(0);
    expect(m.db._col('pagos_cuota').docs[0].estado).toBe('pendiente');
    expect(m.avisos).toHaveLength(0);
  });

  it('un pago en proceso se deja para la siguiente vuelta', async () => {
    const m = montar({ pagos_cuota: [intencion()] }, { 'CL-AABBCCDDEEFF': { estado: 'en_proceso' } });
    await conciliarPagos(m.deps);
    expect(m.db._col('pagos_cuota').docs[0].estado).toBe('pendiente');
    expect(m.confirmarCuotas).not.toHaveBeenCalled();
  });

  it('un error de Bold tampoco cierra nada', async () => {
    const m = montar({ pagos_cuota: [intencion()] }, { 'CL-AABBCCDDEEFF': { estado: 'error' } });
    const r = await conciliarPagos(m.deps);
    expect(r.errores).toBe(1);
    expect(m.db._col('pagos_cuota').docs[0].estado).toBe('pendiente');
  });

  it('si aplicar falla, sigue con las demás en vez de abortar', async () => {
    const m = montar(
      {
        pagos_cuota: [
          intencion({ referencia: 'CL-111111111111' }),
          intencion({ referencia: 'CL-222222222222' }),
        ],
      },
      {
        'CL-111111111111': aprobada(93000),
        'CL-222222222222': aprobada(93000),
      }
    );
    m.confirmarCuotas.mockImplementationOnce(async () => {
      throw new Error('Mongo caído');
    });

    const r = await conciliarPagos(m.deps);
    expect(m.confirmarCuotas).toHaveBeenCalledTimes(2);
    expect(r.errores).toBe(1);
    expect(r.rescatadas).toBe(1);
  });

  it('revisa varias intenciones en la misma vuelta', async () => {
    const m = montar(
      {
        pagos_cuota: [
          intencion({ referencia: 'CL-111111111111' }),
          intencion({ referencia: 'CL-222222222222', monto: 50000 }),
          intencion({ referencia: 'CL-333333333333' }),
        ],
      },
      {
        'CL-111111111111': aprobada(93000),
        'CL-222222222222': { estado: 'sin_datos' },
        'CL-333333333333': { estado: 'rechazada' },
      }
    );
    const r = await conciliarPagos(m.deps);
    expect(r).toMatchObject({ revisadas: 3, rescatadas: 1, sinDatos: 1, rechazadas: 1 });
  });

  it('no consulta más de 40 por vuelta', async () => {
    const muchas = Array.from({ length: 60 }, (_, i) =>
      intencion({ referencia: `CL-${String(i).padStart(12, '0')}` })
    );
    const m = montar({ pagos_cuota: muchas }, {});
    const r = await conciliarPagos(m.deps);
    expect(r.revisadas).toBe(40);
  });
});

/* ═══════════════════════════  Pedidos de tienda  ═══════════════════ */

describe('conciliador — pedidos de la tienda', () => {
  it('rescata un pedido pagado que el webhook no reportó', async () => {
    const m = montar(
      { orders: [pedido()] },
      { 'XM-12345678': aprobada(480000, { metodo: 'CREDIT_CARD' }) }
    );
    const r = await conciliarPagos(m.deps);

    expect(r.rescatadas).toBe(1);
    expect(m.confirmarPedido).toHaveBeenCalledTimes(1);
    expect(m.confirmarPedido.mock.calls[0][1]).toContain('CREDIT_CARD');
  });

  it('acepta tarjeta en la tienda: aquí no cuelga de un desbloqueo', async () => {
    const m = montar({ orders: [pedido()] }, { 'XM-12345678': aprobada(480000, { metodo: 'CREDIT_CARD' }) });
    expect((await conciliarPagos(m.deps)).rescatadas).toBe(1);
  });

  it('si el aviso falla, el pedido rescatado sigue contando', async () => {
    const m = montar(
      { orders: [pedido()] },
      { 'XM-12345678': aprobada(480000) },
      { avisoRoto: true }
    );
    const r = await conciliarPagos(m.deps);

    expect(m.confirmarPedido).toHaveBeenCalledTimes(1);
    expect(r.rescatadas).toBe(1);
    expect(r.errores).toBe(0);
  });

  it('no aplica un pedido cuyo importe no cuadra', async () => {
    const m = montar({ orders: [pedido()] }, { 'XM-12345678': aprobada(1000) });
    const r = await conciliarPagos(m.deps);
    expect(m.confirmarPedido).not.toHaveBeenCalled();
    expect(r.errores).toBe(1);
  });

  it('no toca pedidos que ya no están en pending_bold', async () => {
    const m = montar({ orders: [pedido({ status: 'completed' })] }, { 'XM-12345678': aprobada(480000) });
    expect((await conciliarPagos(m.deps)).revisadas).toBe(0);
  });

  it('el silencio tampoco cancela un pedido', async () => {
    const m = montar({ orders: [pedido()] }, {});
    const r = await conciliarPagos(m.deps);
    expect(r.sinDatos).toBe(1);
    expect(m.db._col('orders').docs[0].status).toBe('pending_bold');
  });

  it('cuotas y pedidos se revisan en la misma vuelta', async () => {
    const m = montar(
      { pagos_cuota: [intencion()], orders: [pedido()] },
      { 'CL-AABBCCDDEEFF': aprobada(93000), 'XM-12345678': aprobada(480000) }
    );
    const r = await conciliarPagos(m.deps);
    expect(r.revisadas).toBe(2);
    expect(r.rescatadas).toBe(2);
  });

  it('si las cuotas fallan enteras, los pedidos se revisan igual', async () => {
    const m = montar({ orders: [pedido()] }, { 'XM-12345678': aprobada(480000) });
    const original = m.deps.getDb;
    let primera = true;
    m.deps.getDb = () => {
      if (primera) {
        primera = false;
        throw new Error('fallo al leer cuotas');
      }
      return original();
    };
    const r = await conciliarPagos(m.deps);
    expect(r.rescatadas).toBe(1);
  });
});
