// @vitest-environment node
/**
 * Lo que pasa cuando Bold avisa de que el cliente pagó.
 *
 * Esta es la parte del portal que mueve dinero, y la que no se puede probar en
 * producción: el webhook lo llama un tercero, no hay ambiente de pruebas de la
 * pasarela, y cada ensayo real sería un cobro de verdad a un cliente de verdad.
 * Así que se prueba contra un Mongo de juguete, que es suficiente para lo que
 * de verdad se rompe aquí.
 *
 * Lo que más importa de este archivo es la idempotencia. Bold reintenta los
 * webhooks, y los reintenta en paralelo cuando el primero tarda. Si el segundo
 * aviso volviera a aplicar el pago, el cliente recibiría dos recibos por la
 * misma plata, el panel contaría el pago dos veces y —lo peor— se dispararía
 * otra vez el desbloqueo y el aviso al dueño. El candado es un `updateOne`
 * condicional, y es lo único que lo evita.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  confirmarPagoDeCuotas,
  rechazarPagoDeCuotas,
  type DepsPortal,
} from '../../server/portal-rutas';

/* ───────────────────────  Mongo de juguete  ─────────────────────── */

const coincide = (doc: any, filtro: any): boolean =>
  Object.entries(filtro || {}).every(([clave, valor]) => doc[clave] === valor);

function coleccion(docs: any[]) {
  return {
    docs,
    findOne: async (filtro: any) => {
      const d = docs.find((x) => coincide(x, filtro));
      // Mongo devuelve una copia, no el documento vivo. Importa: si devolviera
      // la referencia, mutar `registro.cuotas` en el código de producción
      // "guardaría" sin pasar por updateOne y la prueba no vería el fallo.
      return d ? JSON.parse(JSON.stringify(d)) : null;
    },
    insertOne: async (doc: any) => {
      docs.push({ ...doc });
      return { insertedId: doc.id };
    },
    updateOne: async (filtro: any, cambios: any) => {
      const doc = docs.find((x) => coincide(x, filtro));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      Object.assign(doc, cambios.$set || {});
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };
}

let colecciones: Record<string, ReturnType<typeof coleccion>>;
const db = { collection: (nombre: string) => (colecciones[nombre] ||= coleccion([])) };

/* ───────────────────────  Deps de juguete  ─────────────────────── */

const espias = {
  alRegistrarPago: vi.fn(async () => {}),
  alOtorgarProrroga: vi.fn(async () => ({ liberado: true, detalle: '' })),
  avisarAlDueno: vi.fn(async () => {}),
  enviarWhatsApp: vi.fn(async () => true),
  emitir: vi.fn(),
};

const deps: DepsPortal = {
  getDb: () => db,
  secreto: () => 'secreto-de-pruebas-de-mas-de-treinta-y-dos-chars',
  baseUrl: () => 'https://api.ejemplo.com',
  boldConfigurado: () => true,
  enviarWhatsApp: (t, x) => espias.enviarWhatsApp(t as any, x as any) as any,
  whatsappListo: () => true,
  nombreBonito: (v) => String(v ?? '').trim(),
  hoy: () => '2026-10-10',
  parsearImagen: () => null,
  maxBytesComprobante: 700 * 1024,
  alRegistrarPago: (id) => espias.alRegistrarPago(id as any) as any,
  alOtorgarProrroga: (id, h, n) => espias.alOtorgarProrroga(id as any, h as any, n as any) as any,
  avisarAlDueno: (t) => espias.avisarAlDueno(t as any) as any,
  emitir: (e, d) => espias.emitir(e as any, d as any),
  limitador: (_req: any, _res: any, next: any) => next(),
};

const REF = 'CL-A1B2C3D4E5F6';

function sembrar(cambios: { intencion?: any; registro?: any } = {}) {
  colecciones = {};
  colecciones['pagos_cuota'] = coleccion([
    {
      referencia: REF,
      financingId: 'fin-1',
      cuotas: [3],
      monto: 200_000,
      concepto: 'Cuota #3',
      alcance: 'proxima',
      estado: 'pendiente',
      creadoEn: '2026-10-10T12:00:00.000Z',
      ...(cambios.intencion || {}),
    },
  ]);
  colecciones['financing'] = coleccion([
    {
      id: 'fin-1',
      nombre: 'maría camila restrepo',
      telefono: '3002875280',
      imei: '352099001761481',
      valorCuota: 200_000,
      numeroCuotas: 4,
      cuotasPrevias: 0,
      horaBloqueo: '08:00',
      status: 'active',
      cuotas: [
        { number: 1, dueDate: '2026-08-10T00:00:00.000Z', status: 'paid' },
        { number: 2, dueDate: '2026-09-10T00:00:00.000Z', status: 'paid' },
        { number: 3, dueDate: '2026-10-10T00:00:00.000Z', status: 'pending' },
        { number: 4, dueDate: '2026-11-10T00:00:00.000Z', status: 'pending' },
      ],
      ...(cambios.registro || {}),
    },
  ]);
  colecciones['blocking_devices'] = coleccion([
    { id: 'eq-1', financingId: 'fin-1', imei: '352099001761481', status: 'blocked', plataforma: 'trustonic' },
  ]);
  colecciones['blocking_payments'] = coleccion([]);
  colecciones['settings'] = coleccion([]);
}

const intencion = () => colecciones['pagos_cuota'].docs[0];
const registro = () => colecciones['financing'].docs[0];
const cuotaNum = (n: number) => registro().cuotas.find((c: any) => c.number === n);

beforeEach(() => {
  sembrar();
  for (const e of Object.values(espias)) e.mockClear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

/* ══════════════════════════════════════════════════════════════════════════
   El pago entra
   ══════════════════════════════════════════════════════════════════════════ */

describe('confirmarPagoDeCuotas', () => {
  it('marca la cuota pagada y deja el respaldo del pago', async () => {
    await confirmarPagoDeCuotas(deps, REF, { paymentId: 'bold-999', metodo: 'NEQUI' });

    const c = cuotaNum(3);
    expect(c.status).toBe('paid');
    expect(c.paidDate).toBeTruthy();
    expect(c.pagoEnLinea.referencia).toBe(REF);
    expect(c.pagoEnLinea.monto).toBe(200_000);
    expect(c.pagoEnLinea.metodo).toBe('NEQUI');
    expect(c.pagoEnLinea.boldPaymentId).toBe('bold-999');
  });

  it('no toca las cuotas que el pago no cubría', async () => {
    await confirmarPagoDeCuotas(deps, REF, {});
    expect(cuotaNum(4).status).toBe('pending');
    expect(cuotaNum(4).pagoEnLinea).toBeUndefined();
  });

  it('suelta el teléfono por el mismo camino que el panel', async () => {
    // Si el portal tuviera su propia lógica de desbloqueo, un día una de las dos
    // se quedaría sin el arreglo que se le hizo a la otra.
    await confirmarPagoDeCuotas(deps, REF, {});
    expect(espias.alRegistrarPago).toHaveBeenCalledTimes(1);
    expect(espias.alRegistrarPago).toHaveBeenCalledWith('fin-1');
  });

  it('le manda el recibo al cliente con la referencia', async () => {
    // Es lo que el cliente va a buscar si algún día hay discusión.
    await confirmarPagoDeCuotas(deps, REF, {});
    expect(espias.enviarWhatsApp).toHaveBeenCalledTimes(1);
    const [telefono, texto] = espias.enviarWhatsApp.mock.calls[0] as unknown as [string, string];
    expect(telefono).toBe('3002875280');
    expect(texto).toContain(REF);
    expect(texto).toContain('Pago recibido');
  });

  it('el recibo dice cuánto queda y cuándo vence lo siguiente', async () => {
    await confirmarPagoDeCuotas(deps, REF, {});
    const [, texto] = espias.enviarWhatsApp.mock.calls[0] as unknown as [string, string];
    expect(texto).toContain('#4');
    expect(texto).toContain('noviembre');
  });

  it('avisa al dueño de que entró plata', async () => {
    await confirmarPagoDeCuotas(deps, REF, {});
    expect(espias.avisarAlDueno).toHaveBeenCalledTimes(1);
    expect(String(espias.avisarAlDueno.mock.calls[0][0])).toContain('200.000');
  });

  it('anota el pago en el historial que ve el panel de Bloqueo', async () => {
    await confirmarPagoDeCuotas(deps, REF, { metodo: 'PSE' });
    const pagos = colecciones['blocking_payments'].docs;
    expect(pagos).toHaveLength(1);
    expect(pagos[0].amount).toBe(200_000);
    expect(pagos[0].referencia).toBe(REF);
    expect(pagos[0].cuotas).toEqual([3]);
    expect(pagos[0].registradoPor).toBe('portal-cliente');
    expect(pagos[0].method).toContain('PSE');
    // Queda colgado del equipo, que es por donde lo busca el panel.
    expect(pagos[0].deviceId).toBe('eq-1');
  });

  it('refresca el panel', async () => {
    await confirmarPagoDeCuotas(deps, REF, {});
    expect(espias.emitir).toHaveBeenCalledWith('financingUpdated', expect.objectContaining({ id: 'fin-1' }));
  });

  it('liquida el financiamiento cuando con este pago no queda nada', async () => {
    sembrar({
      intencion: { cuotas: [3, 4], monto: 400_000, alcance: 'saldo' },
    });
    await confirmarPagoDeCuotas(deps, REF, {});

    expect(registro().status).toBe('completed');
    expect(cuotaNum(3).status).toBe('paid');
    expect(cuotaNum(4).status).toBe('paid');
    const [, texto] = espias.enviarWhatsApp.mock.calls[0] as unknown as [string, string];
    expect(texto).toContain('terminaste de pagar');
  });

  it('no liquida mientras quede algo pendiente', async () => {
    await confirmarPagoDeCuotas(deps, REF, {});
    expect(registro().status).toBe('active');
  });

  it('aplica varias cuotas de un solo pago', async () => {
    sembrar({ intencion: { cuotas: [3, 4], monto: 400_000, alcance: 'saldo' } });
    await confirmarPagoDeCuotas(deps, REF, {});
    expect(colecciones['blocking_payments'].docs[0].cuotas).toEqual([3, 4]);
    const [, texto] = espias.enviarWhatsApp.mock.calls[0] as unknown as [string, string];
    expect(texto).toContain('#3');
    expect(texto).toContain('#4');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Idempotencia — lo que de verdad protege este archivo
   ══════════════════════════════════════════════════════════════════════════ */

describe('reintentos del webhook', () => {
  it('el segundo aviso de la misma referencia no aplica nada', async () => {
    await confirmarPagoDeCuotas(deps, REF, { paymentId: 'bold-999' });
    espias.alRegistrarPago.mockClear();
    espias.enviarWhatsApp.mockClear();
    espias.avisarAlDueno.mockClear();

    await confirmarPagoDeCuotas(deps, REF, { paymentId: 'bold-999' });

    // Ni un segundo recibo al cliente, ni un segundo aviso al dueño, ni un
    // segundo desbloqueo, ni una segunda línea en el historial.
    expect(espias.enviarWhatsApp).not.toHaveBeenCalled();
    expect(espias.avisarAlDueno).not.toHaveBeenCalled();
    expect(espias.alRegistrarPago).not.toHaveBeenCalled();
    expect(colecciones['blocking_payments'].docs).toHaveLength(1);
  });

  it('dos avisos simultáneos sólo cuentan una vez', async () => {
    // El caso real: Bold reintenta antes de que el primero termine. Con
    // leer-y-luego-escribir, los dos verían "pendiente" y los dos cobrarían.
    await Promise.all([
      confirmarPagoDeCuotas(deps, REF, { paymentId: 'bold-999' }),
      confirmarPagoDeCuotas(deps, REF, { paymentId: 'bold-999' }),
    ]);

    expect(espias.alRegistrarPago).toHaveBeenCalledTimes(1);
    expect(espias.enviarWhatsApp).toHaveBeenCalledTimes(1);
    expect(colecciones['blocking_payments'].docs).toHaveLength(1);
  });

  it('la intención queda en aprobado, con el id de Bold', async () => {
    await confirmarPagoDeCuotas(deps, REF, { paymentId: 'bold-999', metodo: 'NEQUI' });
    expect(intencion().estado).toBe('aprobado');
    expect(intencion().boldPaymentId).toBe('bold-999');
    expect(intencion().aprobadoEn).toBeTruthy();
  });

  it('una referencia ya rechazada no se puede aprobar después', async () => {
    sembrar({ intencion: { estado: 'rechazado' } });
    await confirmarPagoDeCuotas(deps, REF, {});
    expect(cuotaNum(3).status).toBe('pending');
    expect(espias.alRegistrarPago).not.toHaveBeenCalled();
  });

  it('una cuota que ya estaba pagada no se vuelve a marcar', async () => {
    // Pasa de verdad: el dueño la marca a mano desde el panel en el rato que la
    // pasarela tarda en avisar.
    sembrar({
      registro: {
        cuotas: [
          { number: 1, dueDate: '2026-08-10T00:00:00.000Z', status: 'paid' },
          { number: 2, dueDate: '2026-09-10T00:00:00.000Z', status: 'paid' },
          { number: 3, dueDate: '2026-10-10T00:00:00.000Z', status: 'paid', paidDate: '2026-10-10T09:00:00.000Z' },
          { number: 4, dueDate: '2026-11-10T00:00:00.000Z', status: 'pending' },
        ],
      },
    });
    await confirmarPagoDeCuotas(deps, REF, {});

    // No se le pisa la fecha de pago original ni se le inventa un respaldo.
    expect(cuotaNum(3).paidDate).toBe('2026-10-10T09:00:00.000Z');
    expect(cuotaNum(3).pagoEnLinea).toBeUndefined();
    expect(colecciones['blocking_payments'].docs[0].cuotas).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Lo que llega torcido
   ══════════════════════════════════════════════════════════════════════════ */

describe('avisos que no cuadran', () => {
  it('una referencia que no existe no aplica nada', async () => {
    // El webhook es público: cualquiera puede mandarle un POST con una
    // referencia inventada. No puede acabar marcando cuotas de nadie.
    await confirmarPagoDeCuotas(deps, 'CL-FFFFFFFFFFFF', {});
    expect(cuotaNum(3).status).toBe('pending');
    expect(espias.alRegistrarPago).not.toHaveBeenCalled();
    expect(espias.enviarWhatsApp).not.toHaveBeenCalled();
    expect(colecciones['blocking_payments'].docs).toHaveLength(0);
  });

  it('si el financiamiento ya no existe, se avisa al dueño porque el dinero entró', async () => {
    sembrar({ intencion: { financingId: 'fin-borrado' } });
    await confirmarPagoDeCuotas(deps, REF, {});

    expect(espias.avisarAlDueno).toHaveBeenCalledTimes(1);
    expect(String(espias.avisarAlDueno.mock.calls[0][0])).toContain('revisarlo a mano');
    // Y no se intenta desbloquear un equipo de un contrato que no está.
    expect(espias.alRegistrarPago).not.toHaveBeenCalled();
  });

  it('sin base de datos no se cae', async () => {
    const sinDb: DepsPortal = { ...deps, getDb: () => null };
    await expect(confirmarPagoDeCuotas(sinDb, REF, {})).resolves.toBeUndefined();
  });

  it('el pago se aplica igual si el desbloqueo falla', async () => {
    // El proveedor de bloqueo se cae. La plata entró: no se puede perder el
    // registro por eso. La vuelta de política lo suelta más tarde.
    espias.alRegistrarPago.mockRejectedValueOnce(new Error('HBM 503'));
    await confirmarPagoDeCuotas(deps, REF, {});

    expect(cuotaNum(3).status).toBe('paid');
    expect(intencion().estado).toBe('aprobado');
    expect(espias.enviarWhatsApp).toHaveBeenCalledTimes(1);
  });

  it('el pago se aplica igual si el WhatsApp falla', async () => {
    espias.enviarWhatsApp.mockRejectedValueOnce(new Error('Baileys caído'));
    await confirmarPagoDeCuotas(deps, REF, {});
    expect(cuotaNum(3).status).toBe('paid');
    expect(espias.alRegistrarPago).toHaveBeenCalledTimes(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Rechazos
   ══════════════════════════════════════════════════════════════════════════ */

describe('rechazarPagoDeCuotas', () => {
  it('marca la intención rechazada sin tocar ninguna cuota', async () => {
    await rechazarPagoDeCuotas(deps, REF);
    expect(intencion().estado).toBe('rechazado');
    expect(intencion().rechazadoEn).toBeTruthy();
    expect(cuotaNum(3).status).toBe('pending');
  });

  it('no manda nada al cliente ni al dueño', async () => {
    // Un rechazo de tarjeta no es una noticia: el cliente lo vio en la pantalla
    // de Bold, y escribirle "tu pago falló" sólo lo asusta.
    await rechazarPagoDeCuotas(deps, REF);
    expect(espias.enviarWhatsApp).not.toHaveBeenCalled();
    expect(espias.avisarAlDueno).not.toHaveBeenCalled();
    expect(espias.alRegistrarPago).not.toHaveBeenCalled();
  });

  it('no puede deshacer un pago ya aprobado', async () => {
    // Un SALE_REJECTED que llega tarde, después del SALE_APPROVED, no puede
    // desmarcar una cuota cobrada.
    await confirmarPagoDeCuotas(deps, REF, {});
    await rechazarPagoDeCuotas(deps, REF);

    expect(intencion().estado).toBe('aprobado');
    expect(cuotaNum(3).status).toBe('paid');
  });

  it('una referencia desconocida no revienta', async () => {
    await expect(rechazarPagoDeCuotas(deps, 'CL-000000000000')).resolves.toBeUndefined();
  });
});
