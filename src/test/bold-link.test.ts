// @vitest-environment node
/**
 * El cliente de la API de Bold.
 *
 * Dos cosas se prueban aquí con especial saña, porque las dos cuestan dinero
 * real cuando fallan:
 *
 *  1. **Que la tarjeta no se cuele.** Todo el motivo de crear el link por API en
 *     vez de con el botón embebido es poder excluirla: un contracargo llega
 *     meses después y el equipo ya se desbloqueó solo. Si un refactor dejara
 *     `CREDIT_CARD` dentro de los métodos por defecto, nadie lo notaría hasta el
 *     primer contracargo.
 *
 *  2. **Que "no sé" nunca se confunda con "no pagó".** Bold sólo guarda la
 *     transacción 24 horas; pasado ese plazo, una referencia pagada responde
 *     igual que una que nunca se intentó, y responde con un 404. Traducir ese
 *     404 a "rechazada" dejaría a un cliente que sí pagó con el equipo
 *     bloqueado y la cuota sin registrar. Es el peor error posible aquí.
 *
 * No se toca la red: `fetchImpl` se inyecta. Las URLs y cabeceras que se
 * comprueban son las verificadas contra la API real de Bold.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  BOLD_API_LINKS,
  BOLD_API_PAGOS,
  METODOS_CUOTA,
  aNanosegundos,
  consultarTransaccion,
  crearLinkDePago,
  pagoConfirmado,
  type TransaccionBold,
} from '../../server/bold-link';

/* ──────────────────────────  Ayudas  ────────────────────────── */

/** Un `fetch` falso que devuelve lo que se le diga y apunta cómo lo llamaron. */
function fetchFalso(status: number, cuerpo: unknown) {
  const llamadas: { url: string; init: any }[] = [];
  const impl = vi.fn(async (url: any, init: any) => {
    llamadas.push({ url: String(url), init });
    return {
      status,
      text: async () => (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)),
    } as any;
  });
  return { impl: impl as unknown as typeof fetch, llamadas };
}

const cfgCon = (impl: typeof fetch) => ({ apiKey: 'LLAVE_DE_PRUEBA', fetchImpl: impl });

const respuestaOk = {
  payload: { payment_link: 'LNK_ABC123', url: 'https://checkout.bold.co/payment/LNK_ABC123' },
  errors: [],
};

const opcionesMinimas = {
  referencia: 'CL-AABBCCDDEEFF',
  montoCOP: 93000,
  descripcion: 'Cuota 1 de 12',
};

function cuerpoEnviado(llamadas: { init: any }[]): any {
  return JSON.parse(llamadas[0].init.body);
}

/* ═════════════════════════  aNanosegundos  ═════════════════════════ */

describe('aNanosegundos', () => {
  it('convierte milisegundos a nanosegundos', () => {
    expect(aNanosegundos(new Date(1_700_000_000_000))).toBe(1_700_000_000_000_000_000);
  });

  it('no se queda en milisegundos, que es el error que hace nacer el link vencido', () => {
    const d = new Date();
    expect(aNanosegundos(d)).toBeGreaterThan(d.getTime() * 1000);
  });
});

/* ═════════════════════════  crearLinkDePago  ═══════════════════════ */

describe('crearLinkDePago', () => {
  it('llama al endpoint y con la cabecera que Bold espera', async () => {
    const { impl, llamadas } = fetchFalso(200, respuestaOk);
    await crearLinkDePago(cfgCon(impl), opcionesMinimas);

    expect(llamadas[0].url).toBe(`${BOLD_API_LINKS}/online/link/v1`);
    expect(llamadas[0].init.method).toBe('POST');
    // El formato es "x-api-key <llave>" dentro de Authorization, no un header
    // x-api-key propio. Es raro, pero es lo que pide Bold.
    expect(llamadas[0].init.headers.Authorization).toBe('x-api-key LLAVE_DE_PRUEBA');
  });

  it('devuelve el id y la url que entrega Bold', async () => {
    const { impl } = fetchFalso(200, respuestaOk);
    const link = await crearLinkDePago(cfgCon(impl), opcionesMinimas);
    expect(link.id).toBe('LNK_ABC123');
    expect(link.url).toBe('https://checkout.bold.co/payment/LNK_ABC123');
  });

  it('NUNCA ofrece tarjeta por defecto', async () => {
    const { impl, llamadas } = fetchFalso(200, respuestaOk);
    await crearLinkDePago(cfgCon(impl), opcionesMinimas);
    const metodos = cuerpoEnviado(llamadas).payment_methods;
    expect(metodos).not.toContain('CREDIT_CARD');
    expect(metodos).toEqual([...METODOS_CUOTA]);
  });

  it('los métodos por defecto son exactamente PSE, Nequi y Bancolombia', () => {
    // Clavado a propósito: si alguien añade un método aquí, que tenga que venir
    // a este test y pensar si de verdad acepta contracargos.
    expect([...METODOS_CUOTA].sort()).toEqual(['BOTON_BANCOLOMBIA', 'NEQUI', 'PSE']);
  });

  it('respeta una lista de métodos explícita', async () => {
    const { impl, llamadas } = fetchFalso(200, respuestaOk);
    await crearLinkDePago(cfgCon(impl), { ...opcionesMinimas, metodos: ['NEQUI'] });
    expect(cuerpoEnviado(llamadas).payment_methods).toEqual(['NEQUI']);
  });

  it('manda el monto como entero y con amount_type CLOSE', async () => {
    const { impl, llamadas } = fetchFalso(200, respuestaOk);
    await crearLinkDePago(cfgCon(impl), { ...opcionesMinimas, montoCOP: 93000.6 });
    const cuerpo = cuerpoEnviado(llamadas);
    expect(cuerpo.amount_type).toBe('CLOSE');
    expect(cuerpo.amount).toEqual({ currency: 'COP', total_amount: 93001 });
  });

  it('manda nuestra referencia tal cual, que es la que vuelve en el webhook', async () => {
    const { impl, llamadas } = fetchFalso(200, respuestaOk);
    await crearLinkDePago(cfgCon(impl), opcionesMinimas);
    expect(cuerpoEnviado(llamadas).reference).toBe('CL-AABBCCDDEEFF');
  });

  it('pone el vencimiento en nanosegundos y a las horas pedidas', async () => {
    const { impl, llamadas } = fetchFalso(200, respuestaOk);
    const antes = Date.now();
    await crearLinkDePago(cfgCon(impl), { ...opcionesMinimas, validoHoras: 2 });
    const ns = cuerpoEnviado(llamadas).expiration_date;
    const ms = ns / 1_000_000;
    expect(ms).toBeGreaterThanOrEqual(antes + 2 * 3600_000 - 5000);
    expect(ms).toBeLessThanOrEqual(Date.now() + 2 * 3600_000 + 5000);
  });

  it('por defecto el link vale 48 horas', async () => {
    const { impl } = fetchFalso(200, respuestaOk);
    const link = await crearLinkDePago(cfgCon(impl), opcionesMinimas);
    const horas = (new Date(link.venceEn).getTime() - Date.now()) / 3600_000;
    expect(horas).toBeGreaterThan(47.9);
    expect(horas).toBeLessThan(48.1);
  });

  it('recorta la descripción a 100 caracteres', async () => {
    const { impl, llamadas } = fetchFalso(200, respuestaOk);
    await crearLinkDePago(cfgCon(impl), { ...opcionesMinimas, descripcion: 'x'.repeat(250) });
    expect(cuerpoEnviado(llamadas).description).toHaveLength(100);
  });

  it('incluye callback_url sólo si se le da uno', async () => {
    const a = fetchFalso(200, respuestaOk);
    await crearLinkDePago(cfgCon(a.impl), opcionesMinimas);
    expect(cuerpoEnviado(a.llamadas)).not.toHaveProperty('callback_url');

    const b = fetchFalso(200, respuestaOk);
    await crearLinkDePago(cfgCon(b.impl), { ...opcionesMinimas, callbackUrl: 'https://x.co/p/t' });
    expect(cuerpoEnviado(b.llamadas).callback_url).toBe('https://x.co/p/t');
  });

  it('rechaza montos imposibles sin llegar a llamar a Bold', async () => {
    for (const monto of [0, -1, NaN, Infinity]) {
      const { impl } = fetchFalso(200, respuestaOk);
      await expect(
        crearLinkDePago(cfgCon(impl), { ...opcionesMinimas, montoCOP: monto })
      ).rejects.toThrow(/Monto inválido/);
      expect(impl).not.toHaveBeenCalled();
    }
  });

  it('propaga el mensaje de error que da Bold', async () => {
    const { impl } = fetchFalso(400, { payload: {}, errors: [{ message: 'La referencia ya existe' }] });
    await expect(crearLinkDePago(cfgCon(impl), opcionesMinimas)).rejects.toThrow(
      /La referencia ya existe/
    );
  });

  it('falla si Bold responde 200 pero sin url', async () => {
    const { impl } = fetchFalso(200, { payload: { payment_link: 'LNK_X' }, errors: [] });
    await expect(crearLinkDePago(cfgCon(impl), opcionesMinimas)).rejects.toThrow(/no creó el link/);
  });

  it('falla con un HTTP raro aunque no traiga errors', async () => {
    const { impl } = fetchFalso(502, '<html>Bad Gateway</html>');
    await expect(crearLinkDePago(cfgCon(impl), opcionesMinimas)).rejects.toThrow(/HTTP 502/);
  });
});

/* ════════════════════════  consultarTransaccion  ═══════════════════ */

describe('consultarTransaccion', () => {
  it('pregunta por la referencia en el endpoint de vouchers', async () => {
    const { impl, llamadas } = fetchFalso(200, { payment_status: 'APPROVED' });
    await consultarTransaccion(cfgCon(impl), 'CL-AABBCCDDEEFF');
    expect(llamadas[0].url).toBe(`${BOLD_API_PAGOS}/v2/payment-voucher/CL-AABBCCDDEEFF`);
    expect(llamadas[0].init.method).toBe('GET');
  });

  it('escapa la referencia en la URL', async () => {
    const { impl, llamadas } = fetchFalso(404, {});
    await consultarTransaccion(cfgCon(impl), 'a b/c');
    expect(llamadas[0].url).toContain('a%20b%2Fc');
  });

  it('un 404 es "sin datos", NUNCA un rechazo', async () => {
    // Verificado contra la API real: una referencia desconocida —o de hace más
    // de 24h— responde 404. Tratarlo como rechazo dejaría bloqueado a alguien
    // que pagó.
    const { impl } = fetchFalso(404, {
      payload: {},
      errors: [{ message: 'La referencia CL-X no fue encontrada' }],
    });
    const t = await consultarTransaccion(cfgCon(impl), 'CL-X');
    expect(t.estado).toBe('sin_datos');
    expect(t.estado).not.toBe('rechazada');
  });

  it('lee una aprobación con todos sus datos', async () => {
    const { impl } = fetchFalso(200, {
      payment_status: 'APPROVED',
      transaction_id: 'TRX-99',
      payment_method: 'NEQUI',
      total: 93000,
    });
    const t = await consultarTransaccion(cfgCon(impl), 'CL-X');
    expect(t).toMatchObject({
      estado: 'aprobada',
      paymentId: 'TRX-99',
      metodo: 'NEQUI',
      total: 93000,
    });
  });

  it('entiende la respuesta venga envuelta en payload o no', async () => {
    const a = fetchFalso(200, { payload: { payment_status: 'APPROVED', total: 10 } });
    expect((await consultarTransaccion(cfgCon(a.impl), 'r')).estado).toBe('aprobada');
    const b = fetchFalso(200, { payment_status: 'APPROVED', total: 10 });
    expect((await consultarTransaccion(cfgCon(b.impl), 'r')).estado).toBe('aprobada');
  });

  it.each(['REJECTED', 'FAILED', 'VOIDED'])('%s es un rechazo', async (estado) => {
    const { impl } = fetchFalso(200, { payment_status: estado });
    expect((await consultarTransaccion(cfgCon(impl), 'r')).estado).toBe('rechazada');
  });

  it.each(['PROCESSING', 'PENDING'])('%s sigue en proceso', async (estado) => {
    const { impl } = fetchFalso(200, { payment_status: estado });
    expect((await consultarTransaccion(cfgCon(impl), 'r')).estado).toBe('en_proceso');
  });

  it('NO_TRANSACTION_FOUND es sin datos', async () => {
    const { impl } = fetchFalso(200, { payment_status: 'NO_TRANSACTION_FOUND' });
    expect((await consultarTransaccion(cfgCon(impl), 'r')).estado).toBe('sin_datos');
  });

  it('un estado desconocido es error, no una aprobación optimista', async () => {
    const { impl } = fetchFalso(200, { payment_status: 'ALGO_NUEVO_DE_BOLD' });
    expect((await consultarTransaccion(cfgCon(impl), 'r')).estado).toBe('error');
  });

  it('una respuesta sin estado es error', async () => {
    const { impl } = fetchFalso(200, {});
    expect((await consultarTransaccion(cfgCon(impl), 'r')).estado).toBe('error');
  });

  it('un 500 es error y no toca nada', async () => {
    const { impl } = fetchFalso(500, { errors: [{ message: 'boom' }] });
    expect((await consultarTransaccion(cfgCon(impl), 'r')).estado).toBe('error');
  });

  it('si la red se cae devuelve error, no un rechazo', async () => {
    const impl = (async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    const t = await consultarTransaccion(cfgCon(impl), 'CL-X');
    expect(t.estado).toBe('error');
    expect(t.estado).not.toBe('rechazada');
  });

  it('una referencia vacía no llega ni a llamar', async () => {
    const { impl } = fetchFalso(200, {});
    expect((await consultarTransaccion(cfgCon(impl), '  ')).estado).toBe('error');
    expect(impl).not.toHaveBeenCalled();
  });
});

/* ══════════════════════════  pagoConfirmado  ═══════════════════════ */

describe('pagoConfirmado', () => {
  const aprobada = (total?: number): TransaccionBold => ({ estado: 'aprobada', total });

  it('acepta una aprobación con el importe que esperábamos', () => {
    expect(pagoConfirmado(aprobada(93000), 93000)).toBe(true);
  });

  it('rechaza una aprobación por otro importe', () => {
    // Bold no debería permitirlo con amount_type CLOSE, pero el desbloqueo es
    // irreversible y comprobarlo cuesta una resta.
    expect(pagoConfirmado(aprobada(100), 93000)).toBe(false);
    expect(pagoConfirmado(aprobada(930000), 93000)).toBe(false);
  });

  it('si Bold no dice el total, se fía del estado', () => {
    expect(pagoConfirmado(aprobada(undefined), 93000)).toBe(true);
  });

  it('redondea antes de comparar', () => {
    expect(pagoConfirmado(aprobada(93000.4), 93000)).toBe(true);
  });

  it.each(['rechazada', 'en_proceso', 'sin_datos', 'error'] as const)(
    'no confirma nada en estado %s, aunque el importe cuadre',
    (estado) => {
      expect(pagoConfirmado({ estado, total: 93000 }, 93000)).toBe(false);
    }
  );
});
