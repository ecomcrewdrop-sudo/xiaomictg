// @vitest-environment node
/**
 * El portal del cliente, por partes.
 *
 * Aquí se prueba `server/portal.ts`, que es la pieza que decide dos cosas con
 * consecuencias: quién puede abrir un link y cuánto se le cobra. Las rutas y el
 * HTML se prueban aparte; esto es la lógica, y es la que no puede fallar.
 *
 * Lo que más importa de este archivo son tres bloques:
 *
 *  - Los tokens. El link va por WhatsApp a 112 personas y no se guarda en
 *    ninguna parte: si la firma se pudiera adivinar o si el mismo token sirviera
 *    para otro contrato, cualquiera vería la cartera de un vecino.
 *  - `elegirCuotasAPagar`. El monto sale de aquí, no del navegador. Y el orden
 *    importa tanto como el monto: cobrar la cuota equivocada deja al cliente
 *    pagando con el teléfono igual de bloqueado.
 *  - `armarResumenPortal`. Es lo único que se le manda al navegador del cliente,
 *    y el documento de Mongo del que sale lleva cédula, IMEI completo y el costo
 *    al que la tienda compró el equipo.
 */
import { describe, expect, it } from 'vitest';
import {
  PREFIJO_PAGO_CUOTA,
  REGLAS_PLAZO_AUTO_POR_DEFECTO,
  armarResumenPortal,
  decidirPlazoAutomatico,
  elegirCuotasAPagar,
  esReferenciaDeCuota,
  firmaCorrecta,
  firmaPortal,
  imeiCorto,
  leerTokenPortal,
  linkPortal,
  normalizarReglasPlazo,
  nuevaReferenciaPago,
  nuevaSolicitudId,
  solicitudPendienteDe,
  solicitudesDe,
  tokenPortal,
  type SeleccionPago,
  type SolicitudPlazo,
} from '../../server/portal';
import { MAX_DIAS_PRORROGA } from '../../server/prorroga';

const SECRETO = 'un-secreto-de-pruebas-de-al-menos-32-caracteres';
const HOY = '2026-10-10';

/** Una cuota con lo justo para lo que mira el portal. */
function cuota(
  number: number,
  dueDate: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return { number, dueDate: `${dueDate}T00:00:00.000Z`, status: 'pending', ...extra };
}

/**
 * Un contrato de 6 cuotas de $200.000 que empieza el 10 de agosto. Con HOY =
 * 10 de octubre quedan la #3 (vence hoy) y las siguientes; la #1 y la #2 están
 * pagadas. Es el caso corriente de la tienda, no un caso de laboratorio.
 */
function contrato(cambios: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'fin-001',
    nombre: 'maría  camila  restrepo',
    cedula: '1047123456',
    telefono: '3002875280',
    imei: '352099001761481',
    producto: 'Redmi Note 13 256GB',
    costoTotal: 1_400_000,
    costoEquipo: 980_000,
    cuotaInicial: 200_000,
    numeroCuotas: 6,
    valorCuota: 200_000,
    fechaInicio: '2026-08-10T00:00:00.000Z',
    horaBloqueo: '08:00',
    cuotasPrevias: 0,
    status: 'active',
    cuotas: [
      cuota(1, '2026-08-10', { status: 'paid', paidDate: '2026-08-10T14:00:00.000Z' }),
      cuota(2, '2026-09-10', { status: 'paid', paidDate: '2026-09-11T14:00:00.000Z' }),
      cuota(3, '2026-10-10'),
      cuota(4, '2026-11-10'),
      cuota(5, '2026-12-10'),
      cuota(6, '2027-01-10'),
    ],
    ...cambios,
  };
}

/** Estrecha el resultado de `elegirCuotasAPagar` y falla con un mensaje útil. */
function pagoOk(r: SeleccionPago | { error: string }): SeleccionPago {
  if ('error' in r) throw new Error(`Se esperaba un cobro y vino un error: ${r.error}`);
  return r;
}

/* ══════════════════════════════════════════════════════════════════════════
   Tokens
   ══════════════════════════════════════════════════════════════════════════ */

describe('tokens del portal', () => {
  it('el mismo contrato y la misma versión dan siempre el mismo token', () => {
    // Esto es la razón de ser del diseño: no se guarda nada, así que el link que
    // se mandó en el recordatorio de septiembre tiene que seguir funcionando en
    // el de octubre sin que nadie lo haya archivado.
    expect(tokenPortal(SECRETO, 'fin-001', 0)).toBe(tokenPortal(SECRETO, 'fin-001', 0));
  });

  it('dos contratos distintos nunca comparten token', () => {
    expect(tokenPortal(SECRETO, 'fin-001', 0)).not.toBe(tokenPortal(SECRETO, 'fin-002', 0));
  });

  it('cambiar el secreto invalida todos los tokens a la vez', () => {
    // Es la salida de emergencia: si el secreto se filtra, se rota la variable
    // de entorno y ningún link viejo vuelve a abrir nada.
    const antes = tokenPortal(SECRETO, 'fin-001', 0)!;
    const { firma } = leerTokenPortal(antes)!;
    expect(firmaCorrecta('otro-secreto-completamente-distinto-y-largo', 'fin-001', 0, firma)).toBe(false);
  });

  it('subir portalVersion revoca el link de ese cliente y sólo el de ese', () => {
    const v0 = leerTokenPortal(tokenPortal(SECRETO, 'fin-001', 0)!)!;
    const v1 = leerTokenPortal(tokenPortal(SECRETO, 'fin-001', 1)!)!;

    expect(v0.firma).not.toBe(v1.firma);
    expect(firmaCorrecta(SECRETO, 'fin-001', 1, v0.firma)).toBe(false);
    expect(firmaCorrecta(SECRETO, 'fin-001', 1, v1.firma)).toBe(true);
    // El vecino sigue entrando con el suyo: revocar uno no puede obligar a
    // reenviarle el link a los otros 111.
    const otro = leerTokenPortal(tokenPortal(SECRETO, 'fin-002', 0)!)!;
    expect(firmaCorrecta(SECRETO, 'fin-002', 0, otro.firma)).toBe(true);
  });

  it('una firma correcta de OTRO contrato no sirve para este', () => {
    // El ataque más obvio: tengo mi link y quiero ver el de otro, así que pego
    // su id delante de mi firma.
    const mia = leerTokenPortal(tokenPortal(SECRETO, 'fin-001', 0)!)!;
    expect(firmaCorrecta(SECRETO, 'fin-002', 0, mia.firma)).toBe(false);
  });

  it('acepta la versión como número, como texto o ausente, y da lo mismo', () => {
    // Mongo devuelve lo que se le guardó. Si "0", 0 y undefined dieran firmas
    // distintas, el link se rompería al tocar el registro por cualquier motivo.
    const base = leerTokenPortal(tokenPortal(SECRETO, 'fin-001', 0)!)!.firma;
    expect(firmaCorrecta(SECRETO, 'fin-001', '0', base)).toBe(true);
    expect(firmaCorrecta(SECRETO, 'fin-001', undefined, base)).toBe(true);
    expect(firmaCorrecta(SECRETO, 'fin-001', null, base)).toBe(true);
    expect(tokenPortal(SECRETO, 'fin-001')).toBe(tokenPortal(SECRETO, 'fin-001', 0));
  });

  it('no emite token sin secreto', () => {
    // Pasa de verdad: arranque en frío con Mongo caído. Vale más un
    // recordatorio sin link que un link que da error de firma.
    expect(tokenPortal('', 'fin-001', 0)).toBeNull();
    expect(linkPortal('https://api.ejemplo.com', '', contrato())).toBeNull();
  });

  it('no emite token con un id raro', () => {
    expect(tokenPortal(SECRETO, '', 0)).toBeNull();
    expect(tokenPortal(SECRETO, null, 0)).toBeNull();
    expect(tokenPortal(SECRETO, 'con.punto', 0)).toBeNull();
    expect(tokenPortal(SECRETO, 'con/barra', 0)).toBeNull();
    expect(tokenPortal(SECRETO, 'a'.repeat(65), 0)).toBeNull();
  });

  it('rechaza tokens mal formados en lugar de reventar', () => {
    for (const malo of ['', 'sinpunto', '.', 'fin-001.', '.firma', null, undefined, 42, {}]) {
      expect(leerTokenPortal(malo as unknown)).toBeNull();
    }
  });

  it('el link queda pegado a la base, sin barras dobles', () => {
    const link = linkPortal('https://api.ejemplo.com', SECRETO, contrato())!;
    expect(link.startsWith('https://api.ejemplo.com/p/fin-001.')).toBe(true);
    expect(link.slice('https://'.length)).not.toContain('//');
  });

  it('el token sólo lleva caracteres que sobreviven a un WhatsApp', () => {
    // base64 normal mete + y / y =, que WhatsApp parte al autoenlazar y que hay
    // que escapar en una URL. Se usa base64url justo por esto.
    const token = tokenPortal(SECRETO, 'fin-001', 0)!;
    expect(token).toMatch(/^[A-Za-z0-9_.-]+$/);
    expect(encodeURIComponent(token)).toBe(token);
  });

  it('la firma es corta pero no tanto como para adivinarla', () => {
    // 24 caracteres base64url son 144 bits. Sobra para que no se pueda probar a
    // ciegas y cabe en un mensaje sin ocupar tres líneas.
    expect(firmaPortal(SECRETO, 'fin-001', 0)).toHaveLength(24);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Referencias de pago
   ══════════════════════════════════════════════════════════════════════════ */

describe('referencias de pago', () => {
  it('cada referencia es nueva', () => {
    const vistas = new Set(Array.from({ length: 500 }, () => nuevaReferenciaPago()));
    expect(vistas.size).toBe(500);
  });

  it('se reconocen las de cuota y no se confunden con las de la tienda', () => {
    expect(esReferenciaDeCuota(nuevaReferenciaPago())).toBe(true);
    expect(esReferenciaDeCuota(`${PREFIJO_PAGO_CUOTA}A1B2C3D4E5F6`)).toBe(true);

    // Un número de pedido de la tienda NO puede entrar por la rama de cuotas:
    // el webhook de Bold es el mismo para los dos productos.
    expect(esReferenciaDeCuota('ORD-123456')).toBe(false);
    expect(esReferenciaDeCuota('1234567890')).toBe(false);
    expect(esReferenciaDeCuota('')).toBe(false);
    expect(esReferenciaDeCuota(null)).toBe(false);
    expect(esReferenciaDeCuota(undefined)).toBe(false);
  });

  it('no basta con que empiece por CL- para colarse', () => {
    // Si valiera el prefijo solo, cualquiera podría mandar una referencia
    // inventada al webhook y hacernos buscar intenciones que no existen.
    expect(esReferenciaDeCuota('CL-')).toBe(false);
    expect(esReferenciaDeCuota('CL-abc')).toBe(false);
    expect(esReferenciaDeCuota('CL-NOESHEXADECIM')).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Cuánto se cobra
   ══════════════════════════════════════════════════════════════════════════ */

describe('elegirCuotasAPagar', () => {
  it('"la próxima" cobra una sola cuota y es la más antigua pendiente', () => {
    const r = pagoOk(elegirCuotasAPagar(contrato(), 'proxima', HOY));
    expect(r.cuotas).toEqual([3]);
    expect(r.monto).toBe(200_000);
    expect(r.concepto).toBe('Cuota #3');
  });

  it('coge la más antigua aunque venga desordenada en la base', () => {
    // Las regeneraciones de cuotas han dejado arrays en cualquier orden. Si se
    // confiara en la posición, se cobraría la última y el teléfono seguiría
    // bloqueado por la primera.
    const desordenado = contrato({
      cuotas: [cuota(5, '2026-12-10'), cuota(3, '2026-10-10'), cuota(4, '2026-11-10')],
    });
    expect(pagoOk(elegirCuotasAPagar(desordenado, 'proxima', HOY)).cuotas).toEqual([3]);
  });

  it('ordena por la fecha de la prórroga, no por la pactada', () => {
    // La #3 tiene plazo hasta el 25; la #4 vence el 10 de noviembre. La que hay
    // que cobrar primero sigue siendo la #3: es la que arrastra la mora.
    const conPlazo = contrato({
      cuotas: [
        cuota(3, '2026-10-10', {
          prorroga: { hasta: '2026-10-25', otorgadaEn: '2026-10-09T10:00:00.000Z', otorgadaPor: 'admin' },
        }),
        cuota(4, '2026-11-10'),
      ],
    });
    expect(pagoOk(elegirCuotasAPagar(conPlazo, 'proxima', HOY)).cuotas).toEqual([3]);
  });

  it('"lo vencido" coge las atrasadas en orden y suma bien', () => {
    const moroso = contrato({
      cuotas: [
        cuota(1, '2026-08-10'),
        cuota(2, '2026-09-10'),
        cuota(3, '2026-10-10'),
        cuota(4, '2026-11-10'),
      ],
    });
    const r = pagoOk(elegirCuotasAPagar(moroso, 'vencidas', HOY));
    expect(r.cuotas).toEqual([1, 2, 3]); // la #3 vence HOY y entra
    expect(r.monto).toBe(600_000);
    expect(r.concepto).toContain('#1');
    expect(r.concepto).toContain('#3');
  });

  it('"lo vencido" incluye la que vence hoy', () => {
    // Quien entra el día de su cuota y toca "pagar lo vencido" espera que entre
    // la de hoy. Dejarla fuera lo deja bloqueado mañana habiendo pagado.
    const r = pagoOk(elegirCuotasAPagar(contrato(), 'vencidas', HOY));
    expect(r.cuotas).toContain(3);
  });

  it('"lo vencido" sin nada vencido cobra la próxima en vez de cobrar cero', () => {
    const alDia = contrato({ cuotas: [cuota(4, '2026-11-10'), cuota(5, '2026-12-10')] });
    const r = pagoOk(elegirCuotasAPagar(alDia, 'vencidas', HOY));
    expect(r.cuotas).toEqual([4]);
    expect(r.monto).toBe(200_000);
  });

  it('"todo" cobra el saldo completo', () => {
    const r = pagoOk(elegirCuotasAPagar(contrato(), 'saldo', HOY));
    expect(r.cuotas).toEqual([3, 4, 5, 6]);
    expect(r.monto).toBe(800_000);
  });

  it('nunca mete una cuota ya pagada en el cobro', () => {
    // Cobrar dos veces la misma cuota es el error del que el cliente no se
    // recupera: pierde la confianza en el link y vuelve a pagar en la tienda.
    for (const alcance of ['proxima', 'vencidas', 'saldo'] as const) {
      const r = pagoOk(elegirCuotasAPagar(contrato(), alcance, HOY));
      expect(r.cuotas).not.toContain(1);
      expect(r.cuotas).not.toContain(2);
    }
  });

  it('las cuotas elegidas son siempre un tramo que arranca en la más antigua', () => {
    // El automatismo mira si hay cuotas vencidas, no cuántas se pagaron. Pagar
    // la #5 dejando la #3 no suelta el teléfono.
    for (const alcance of ['proxima', 'vencidas', 'saldo'] as const) {
      const r = pagoOk(elegirCuotasAPagar(contrato(), alcance, HOY));
      expect(r.cuotas[0]).toBe(3);
      expect(r.cuotas).toEqual([...r.cuotas].sort((a, b) => a - b));
    }
  });

  it('el monto es siempre múltiplo exacto del valor de la cuota', () => {
    for (const alcance of ['proxima', 'vencidas', 'saldo'] as const) {
      const r = pagoOk(elegirCuotasAPagar(contrato(), alcance, HOY));
      expect(r.monto).toBe(r.cuotas.length * 200_000);
      expect(Number.isInteger(r.monto)).toBe(true);
      expect(r.monto).toBeGreaterThan(0);
    }
  });

  it('se niega cuando ya no queda nada pendiente', () => {
    const liquidado = contrato({
      cuotas: [cuota(1, '2026-08-10', { status: 'paid' }), cuota(2, '2026-09-10', { status: 'paid' })],
    });
    expect(elegirCuotasAPagar(liquidado, 'proxima', HOY)).toHaveProperty('error');
  });

  it('se niega con un valor de cuota que no sirve, en vez de cobrar cero', () => {
    // Un cobro de $0 en Bold es un pago aprobado que desbloquea el teléfono sin
    // que haya entrado un peso.
    for (const valor of [0, -1, null, undefined, 'abc', NaN]) {
      expect(elegirCuotasAPagar(contrato({ valorCuota: valor }), 'saldo', HOY)).toHaveProperty('error');
    }
  });

  it('se niega con un registro vacío o sin cuotas', () => {
    expect(elegirCuotasAPagar(null, 'proxima', HOY)).toHaveProperty('error');
    expect(elegirCuotasAPagar({}, 'proxima', HOY)).toHaveProperty('error');
    expect(elegirCuotasAPagar(contrato({ cuotas: [] }), 'proxima', HOY)).toHaveProperty('error');
    expect(elegirCuotasAPagar(contrato({ cuotas: 'no-es-un-array' }), 'proxima', HOY)).toHaveProperty('error');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Lo que ve el cliente
   ══════════════════════════════════════════════════════════════════════════ */

describe('armarResumenPortal', () => {
  it('no deja salir nada que el cliente no deba ver', () => {
    // El resumen se arma campo por campo justo por esto. Mandar el documento de
    // Mongo entero expondría la cédula, el IMEI completo y —peor— el costo al
    // que la tienda compró el equipo, o sea el margen.
    const r = armarResumenPortal(contrato(), null, HOY);
    const json = JSON.stringify(r);

    expect(json).not.toContain('1047123456'); // cédula
    expect(json).not.toContain('352099001761481'); // IMEI completo
    expect(json).not.toContain('980000'); // costoEquipo
    expect(json).not.toContain('costoEquipo');
    expect(json).not.toContain('3002875280'); // teléfono
    expect(json).not.toContain('cedula');
  });

  it('del IMEI sólo deja los últimos cuatro', () => {
    const r = armarResumenPortal(contrato(), null, HOY);
    expect(r.imei).toBe('•••• •••• 1481');
  });

  it('cuenta pagadas, pendientes, vencidas y saldo', () => {
    const r = armarResumenPortal(contrato(), null, HOY);
    expect(r.pagadas).toBe(2);
    expect(r.pendientes).toBe(4);
    expect(r.vencidas).toBe(0); // la #3 vence hoy, todavía no está vencida
    expect(r.saldo).toBe(800_000);
    expect(r.liquidado).toBe(false);
  });

  it('suma las cuotas que ya venían pagadas de antes del sistema', () => {
    const r = armarResumenPortal(contrato({ cuotasPrevias: 2 }), null, HOY);
    expect(r.pagadas).toBe(4);
    expect(r.totalCuotas).toBe(8);
  });

  it('la que vence hoy se marca "vence-hoy", no "vencida"', () => {
    // Decirle "estás vencido" a alguien que tiene hasta las 8 de esta noche es
    // una llamada garantizada.
    const r = armarResumenPortal(contrato(), null, HOY);
    expect(r.proxima?.numero).toBe(3);
    expect(r.proxima?.estado).toBe('vence-hoy');
    expect(r.proxima?.diasDeMora).toBe(0);
  });

  it('cuenta los días de mora desde la fecha límite', () => {
    const moroso = contrato({ cuotas: [cuota(3, '2026-10-07'), cuota(4, '2026-11-10')] });
    const r = armarResumenPortal(moroso, null, HOY);
    expect(r.proxima?.estado).toBe('vencida');
    expect(r.proxima?.diasDeMora).toBe(3);
    expect(r.diasDeMora).toBe(3);
  });

  it('no inventa mora mientras el plazo está abierto', () => {
    const conPlazo = contrato({
      cuotas: [
        cuota(3, '2026-10-05', {
          prorroga: { hasta: '2026-10-20', otorgadaEn: '2026-10-04T10:00:00.000Z', otorgadaPor: 'admin' },
        }),
      ],
    });
    const r = armarResumenPortal(conPlazo, null, HOY);
    expect(r.proxima?.estado).toBe('con-plazo');
    expect(r.vencidas).toBe(0);
    expect(r.diasDeMora).toBe(0);
    expect(r.plazo?.hasta).toBe('2026-10-20');
  });

  it('con el plazo ya pasado vuelve a estar vencida', () => {
    const plazoVencido = contrato({
      cuotas: [
        cuota(3, '2026-09-20', {
          prorroga: { hasta: '2026-10-05', otorgadaEn: '2026-09-19T10:00:00.000Z', otorgadaPor: 'admin' },
        }),
      ],
    });
    const r = armarResumenPortal(plazoVencido, null, HOY);
    expect(r.proxima?.estado).toBe('vencida');
    expect(r.plazo).toBeNull();
    expect(r.proxima?.diasDeMora).toBe(5); // desde el 5, no desde el 20 de septiembre
  });

  it('las fechas no se corren un día', () => {
    // Las fechas se guardan a medianoche UTC. Leerlas en America/Bogota (UTC-5)
    // las devuelve al día anterior, y entonces el portal le dice al cliente que
    // su cuota venció ayer el mismo día que vence.
    const r = armarResumenPortal(contrato(), null, HOY);
    expect(r.proxima?.vence).toBe('2026-10-10');
    expect(r.cuotas.find((c) => c.numero === 6)?.vence).toBe('2027-01-10');
    // Y la de enero no se va a diciembre, que es el caso que delata el error.
    expect(r.cuotas.find((c) => c.numero === 6)?.vence.startsWith('2027-01')).toBe(true);
  });

  it('con prórroga muestra también la fecha pactada', () => {
    const conPlazo = contrato({
      cuotas: [
        cuota(3, '2026-10-10', {
          prorroga: { hasta: '2026-10-20', otorgadaEn: '2026-10-09T10:00:00.000Z', otorgadaPor: 'admin' },
        }),
      ],
    });
    const c = armarResumenPortal(conPlazo, null, HOY).cuotas[0];
    expect(c.vence).toBe('2026-10-20');
    expect(c.vencePactada).toBe('2026-10-10');
  });

  it('sin equipo emparejado no afirma que el teléfono esté libre', () => {
    // Hay registros sin equipo: IMEI mal teclado, equipos que nunca se
    // enrolaron. Decirle "tu equipo está activo" a alguien que lo tiene
    // bloqueado desde Nuovo es peor que no decir nada.
    const r = armarResumenPortal(contrato(), null, HOY);
    expect(r.equipo.bloqueado).toBe(false);
    expect(r.equipo.automatico).toBe(false);
  });

  it('reporta el equipo bloqueado tanto por estado como por intención', () => {
    expect(armarResumenPortal(contrato(), { status: 'blocked' }, HOY).equipo.bloqueado).toBe(true);
    expect(armarResumenPortal(contrato(), { intencion: 'blocked' }, HOY).equipo.bloqueado).toBe(true);
    expect(armarResumenPortal(contrato(), { status: 'active' }, HOY).equipo.bloqueado).toBe(false);
  });

  describe('opciones de pago', () => {
    it('con una sola cuota al día ofrece un único botón', () => {
      // Dos botones que cobran lo mismo hacen dudar de los dos.
      const una = contrato({ cuotas: [cuota(6, '2027-01-10')] });
      const r = armarResumenPortal(una, null, HOY);
      expect(r.opcionesPago).toHaveLength(1);
      expect(r.opcionesPago[0].alcance).toBe('proxima');
    });

    it('no ofrece "lo vencido" cuando sólo hay una vencida', () => {
      const r = armarResumenPortal(contrato(), null, HOY);
      expect(r.opcionesPago.map((o) => o.alcance)).not.toContain('vencidas');
    });

    it('ofrece "lo vencido" cuando de verdad son varias', () => {
      const moroso = contrato({
        cuotas: [cuota(1, '2026-08-10'), cuota(2, '2026-09-10'), cuota(3, '2026-10-10'), cuota(4, '2026-11-10')],
      });
      const r = armarResumenPortal(moroso, null, HOY);
      const vencidas = r.opcionesPago.find((o) => o.alcance === 'vencidas');
      expect(vencidas?.monto).toBe(600_000);
    });

    it('los montos de los botones coinciden con lo que cobra el servidor', () => {
      // Si la etiqueta dice una cifra y Bold cobra otra, el cliente reclama y
      // tiene razón. Se comprueba contra la MISMA función que firma el cobro.
      const moroso = contrato({
        cuotas: [cuota(1, '2026-08-10'), cuota(2, '2026-09-10'), cuota(3, '2026-10-10'), cuota(4, '2026-11-10')],
      });
      const r = armarResumenPortal(moroso, null, HOY);
      expect(r.opcionesPago.length).toBeGreaterThan(1);
      for (const opcion of r.opcionesPago) {
        expect(opcion.monto).toBe(pagoOk(elegirCuotasAPagar(moroso, opcion.alcance, HOY)).monto);
      }
    });

    it('sin cuotas pendientes no ofrece pagar nada', () => {
      const liquidado = contrato({ cuotas: [cuota(1, '2026-08-10', { status: 'paid' })] });
      const r = armarResumenPortal(liquidado, null, HOY);
      expect(r.opcionesPago).toHaveLength(0);
      expect(r.liquidado).toBe(true);
      expect(r.puedePedirPlazo).toBe(false);
    });
  });

  describe('puedePedirPlazo', () => {
    it('se puede con una cuota pendiente y sin nada en curso', () => {
      expect(armarResumenPortal(contrato(), null, HOY).puedePedirPlazo).toBe(true);
    });

    it('no se puede si ya hay una solicitud esperando', () => {
      // Si no, el dueño recibe el mismo aviso cinco veces mientras decide.
      const pidiendo = contrato({
        solicitudesPlazo: [
          { id: 's1', cuotaNumber: 3, hasta: '2026-10-14', motivo: 'me pagan el 15', pedidaEn: '2026-10-10T12:00:00.000Z', estado: 'pendiente' },
        ],
      });
      const r = armarResumenPortal(pidiendo, null, HOY);
      expect(r.puedePedirPlazo).toBe(false);
      expect(r.solicitudPendiente?.hasta).toBe('2026-10-14');
    });

    it('no se puede si ya tiene plazo abierto', () => {
      const conPlazo = contrato({
        cuotas: [
          cuota(3, '2026-10-10', {
            prorroga: { hasta: '2026-10-20', otorgadaEn: '2026-10-09T10:00:00.000Z', otorgadaPor: 'admin' },
          }),
        ],
      });
      expect(armarResumenPortal(conPlazo, null, HOY).puedePedirPlazo).toBe(false);
    });
  });

  it('un pago en línea cuenta como respaldo de la cuota', () => {
    // Es la regla que permite no pedirle la foto a quien ya pagó por el link:
    // la pasarela confirmó la plata, que es más que una captura de pantalla.
    const pagada = contrato({
      cuotas: [
        cuota(3, '2026-10-10', {
          status: 'paid',
          paidDate: '2026-10-10T16:00:00.000Z',
          pagoEnLinea: { referencia: 'CL-A1B2C3D4E5F6', monto: 200_000, metodo: 'NEQUI', aprobadoEn: '2026-10-10T16:00:00.000Z' },
        }),
      ],
    });
    const c = armarResumenPortal(pagada, null, HOY).cuotas[0];
    expect(c.conRespaldo).toBe(true);
    expect(c.enLinea).toBe(true);
  });

  it('una captura también cuenta como respaldo, pero no es un pago en línea', () => {
    const conFoto = contrato({
      cuotas: [cuota(3, '2026-10-10', { comprobante: { mediaId: 'm1', mime: 'image/jpeg', bytes: 1000, nombreArchivo: 'a.jpg', subidoEn: '2026-10-10T10:00:00.000Z', subidoPor: 'cliente (portal)' } })],
    });
    const c = armarResumenPortal(conFoto, null, HOY).cuotas[0];
    expect(c.conRespaldo).toBe(true);
    expect(c.enLinea).toBe(false);
  });

  it('aguanta un registro roto sin reventar', () => {
    // El portal es público: un registro a medias tiene que dar una página pobre,
    // nunca un 500 que el cliente lee como "me borraron el crédito".
    expect(() => armarResumenPortal({}, null, HOY)).not.toThrow();
    expect(() => armarResumenPortal({ cuotas: [{}] }, null, HOY)).not.toThrow();
    expect(() => armarResumenPortal({ cuotas: null }, null, HOY)).not.toThrow();
    expect(armarResumenPortal({}, null, HOY).liquidado).toBe(false);
  });
});

describe('imeiCorto', () => {
  it('tapa todo menos los últimos cuatro', () => {
    expect(imeiCorto('352099001761481')).toBe('•••• •••• 1481');
  });

  it('aguanta basura sin filtrar el dato', () => {
    expect(imeiCorto('')).toBe('—');
    expect(imeiCorto(null)).toBe('—');
    expect(imeiCorto(undefined)).toBe('—');
    expect(imeiCorto('1')).toBe('••••1');
    // Hay un equipo en producción con imei "1". No puede tumbar la página.
    expect(imeiCorto('abc')).toBe('—');
  });

  it('nunca devuelve el IMEI completo', () => {
    const imei = '352099001761481';
    expect(imeiCorto(imei)).not.toContain('35209900');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Solicitudes de plazo
   ══════════════════════════════════════════════════════════════════════════ */

describe('solicitudes de plazo', () => {
  const pendiente: SolicitudPlazo = {
    id: 's1', cuotaNumber: 3, hasta: '2026-10-14', motivo: 'me pagan el 15',
    pedidaEn: '2026-10-10T12:00:00.000Z', estado: 'pendiente',
  };
  const resuelta: SolicitudPlazo = { ...pendiente, id: 's0', estado: 'concedida' };

  it('devuelve lista vacía cuando no hay nada', () => {
    expect(solicitudesDe(contrato())).toEqual([]);
    expect(solicitudesDe({})).toEqual([]);
    expect(solicitudesDe(null)).toEqual([]);
    expect(solicitudesDe({ solicitudesPlazo: 'no-es-array' })).toEqual([]);
  });

  it('encuentra la pendiente entre las ya resueltas', () => {
    const r = contrato({ solicitudesPlazo: [resuelta, pendiente] });
    expect(solicitudPendienteDe(r)?.id).toBe('s1');
  });

  it('no devuelve nada cuando todas están resueltas', () => {
    expect(solicitudPendienteDe(contrato({ solicitudesPlazo: [resuelta] }))).toBeNull();
  });

  it('cada id de solicitud es único', () => {
    const ids = new Set(Array.from({ length: 300 }, () => nuevaSolicitudId()));
    expect(ids.size).toBe(300);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Plazo automático
   ══════════════════════════════════════════════════════════════════════════ */

describe('decidirPlazoAutomatico', () => {
  const activo = { ...REGLAS_PLAZO_AUTO_POR_DEFECTO, activo: true };

  it('viene apagado de fábrica', () => {
    // Dar plazos es una decisión de negocio. El programa no la toma por su
    // cuenta el día que se despliega.
    expect(REGLAS_PLAZO_AUTO_POR_DEFECTO.activo).toBe(false);
    const d = decidirPlazoAutomatico(REGLAS_PLAZO_AUTO_POR_DEFECTO, contrato(), '2026-10-12', HOY);
    expect(d.auto).toBe(false);
  });

  it('concede un plazo corto a un cliente limpio', () => {
    expect(decidirPlazoAutomatico(activo, contrato(), '2026-10-13', HOY).auto).toBe(true);
  });

  it('no concede más días que el tope, y dice cuántos pidió', () => {
    // El motivo va literal al WhatsApp del dueño: con "requiere revisión" a
    // secas tendría que abrir el panel para reconstruir qué pasó.
    const d = decidirPlazoAutomatico(activo, contrato(), '2026-10-20', HOY);
    expect(d.auto).toBe(false);
    if (!d.auto) {
      expect(d.motivo).toContain('10');
      expect(d.motivo).toContain('4');
    }
  });

  it('el tope exacto sí entra', () => {
    expect(decidirPlazoAutomatico(activo, contrato(), '2026-10-14', HOY).auto).toBe(true);
  });

  it('corta al que ya pidió su cupo de plazos', () => {
    const d = decidirPlazoAutomatico(activo, contrato({ prorrogasOtorgadas: 1 }), '2026-10-12', HOY);
    expect(d.auto).toBe(false);
    if (!d.auto) expect(d.motivo).toContain('tope');
  });

  it('corta al que ya dejó pasar un plazo sin pagar', () => {
    // Su palabra deja de valer para el automatismo. Para el dueño, no: él puede
    // seguir concediéndolo a mano.
    const incumplidor = contrato({
      cuotas: [
        cuota(3, '2026-09-10', {
          prorroga: { hasta: '2026-09-20', otorgadaEn: '2026-09-09T10:00:00.000Z', otorgadaPor: 'admin' },
        }),
      ],
    });
    const d = decidirPlazoAutomatico(activo, incumplidor, '2026-10-12', HOY);
    expect(d.auto).toBe(false);
    if (!d.auto) expect(d.motivo).toContain('plazo anterior');
  });

  it('un plazo anterior que SÍ se pagó no estorba', () => {
    const cumplidor = contrato({
      cuotas: [
        cuota(2, '2026-09-10', {
          status: 'paid',
          paidDate: '2026-09-19T10:00:00.000Z',
          prorroga: { hasta: '2026-09-20', otorgadaEn: '2026-09-09T10:00:00.000Z', otorgadaPor: 'admin' },
        }),
        cuota(3, '2026-10-10'),
      ],
    });
    expect(decidirPlazoAutomatico(cumplidor, cumplidor, '2026-10-12', HOY)).toBeTruthy();
    expect(decidirPlazoAutomatico(activo, cumplidor, '2026-10-12', HOY).auto).toBe(true);
  });

  it('con la regla apagada, el que incumplió vuelve a entrar', () => {
    const incumplidor = contrato({
      cuotas: [
        cuota(3, '2026-09-10', {
          prorroga: { hasta: '2026-09-20', otorgadaEn: '2026-09-09T10:00:00.000Z', otorgadaPor: 'admin' },
        }),
      ],
    });
    const laxas = { ...activo, nadaSiIncumplio: false };
    expect(decidirPlazoAutomatico(laxas, incumplidor, '2026-10-12', HOY).auto).toBe(true);
  });

  it('no se cuelga con una fecha ilegible', () => {
    const d = decidirPlazoAutomatico(activo, contrato(), 'no-es-fecha', HOY);
    expect(d.auto).toBe(false);
  });
});

describe('normalizarReglasPlazo', () => {
  it('sin nada guardado devuelve lo de fábrica', () => {
    expect(normalizarReglasPlazo(null)).toEqual(REGLAS_PLAZO_AUTO_POR_DEFECTO);
    expect(normalizarReglasPlazo({})).toEqual(REGLAS_PLAZO_AUTO_POR_DEFECTO);
    expect(normalizarReglasPlazo(undefined)).toEqual(REGLAS_PLAZO_AUTO_POR_DEFECTO);
  });

  it('sólo se enciende con un true de verdad', () => {
    // 'false', 0 o '' llegando del formulario no pueden encender algo que
    // reparte plazos sin que nadie mire.
    expect(normalizarReglasPlazo({ activo: true }).activo).toBe(true);
    for (const valor of ['true', 1, 'si', {}, [], 'false', 0, '']) {
      expect(normalizarReglasPlazo({ activo: valor }).activo).toBe(false);
    }
  });

  it('recorta maxDias al tope duro de las prórrogas', () => {
    // Si no, el dueño podría escribir 365 en el formulario y nadie volvería a
    // mirar esa cuota en un año. Se compara contra MAX_DIAS_PRORROGA y no
    // contra un número escrito aquí: el tope lo manda `prorroga.ts`, y si algún
    // día se mueve, esta prueba tiene que seguir diciendo la verdad.
    expect(normalizarReglasPlazo({ maxDias: 9999 }).maxDias).toBe(MAX_DIAS_PRORROGA);
    expect(normalizarReglasPlazo({ maxDias: 3 }).maxDias).toBe(3);
  });

  it('ignora números imposibles en vez de guardarlos', () => {
    expect(normalizarReglasPlazo({ maxDias: -5 }).maxDias).toBe(REGLAS_PLAZO_AUTO_POR_DEFECTO.maxDias);
    expect(normalizarReglasPlazo({ maxDias: 'abc' }).maxDias).toBe(REGLAS_PLAZO_AUTO_POR_DEFECTO.maxDias);
    expect(normalizarReglasPlazo({ maxDias: NaN }).maxDias).toBe(REGLAS_PLAZO_AUTO_POR_DEFECTO.maxDias);
    expect(normalizarReglasPlazo({ maxPorContrato: -1 }).maxPorContrato).toBe(1);
    expect(normalizarReglasPlazo({ maxDias: 2.7 }).maxDias).toBe(2);
  });

  it('nadaSiIncumplio sólo se apaga con un false explícito', () => {
    expect(normalizarReglasPlazo({}).nadaSiIncumplio).toBe(true);
    expect(normalizarReglasPlazo({ nadaSiIncumplio: false }).nadaSiIncumplio).toBe(false);
    expect(normalizarReglasPlazo({ nadaSiIncumplio: 'no' }).nadaSiIncumplio).toBe(true);
  });
});
