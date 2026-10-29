// @vitest-environment node
/**
 * La política de mora: qué se decide hacer con cada equipo.
 *
 * Esto es lo que deja a una persona sin teléfono, y se ejecuta solo cada 30
 * minutos sin que nadie lo mire. No hay sandbox del proveedor: la única forma
 * de probar la lógica sin arriesgar el equipo de un cliente es que `decidir` y
 * `resumirCartera` sean funciones puras y se verifiquen aquí.
 *
 * Los casos que más importan no son los felices, son estos tres:
 *   - que a quien pagó no se le bloquee (y si está bloqueado, se le suelte);
 *   - que no se bloquee antes de la hora que se le prometió por WhatsApp;
 *   - que los equipos de Nuovo se queden fuera, porque esta API no los alcanza
 *     y un bloqueo sobre ellos es un botón que no hace nada.
 */
import { describe, expect, it } from 'vitest';
import {
  decidir,
  resumirCartera,
  type ConfigBloqueo,
  type EstadoCartera,
} from '../../server/blocking';

const CONFIG: ConfigBloqueo = {
  autoBloqueoActivo: true,
  simulacion: false,
  diasDeGracia: 1,
  maxBloqueosPorVuelta: 5,
  avisoEnPantallaActivo: true,
  secretoWebhook: '',
};

const AHORA = { fecha: '2026-10-06', hora: 10, minuto: 0 };

/** Las cuotas se guardan como medianoche UTC; la fecha real es la de la cadena. */
const cuota = (number: number, dia: string, status = 'pending') => ({
  number,
  dueDate: `${dia}T00:00:00.000Z`,
  status,
});

/** La misma cuota con un plazo encima. `dueDate` no se toca: eso es el punto. */
const conProrroga = (
  base: ReturnType<typeof cuota>,
  hasta: string,
  motivo = 'Le pagan el viernes'
) => ({
  ...base,
  prorroga: {
    hasta,
    otorgadaEn: '2026-10-06T15:00:00.000Z',
    otorgadaPor: 'admin',
    fechaOriginal: base.dueDate.slice(0, 10),
    motivo,
  },
});

const equipo = (extra: Record<string, unknown> = {}) => ({
  imei: '867754085007981',
  owner: 'Cliente de prueba',
  plataforma: 'trustonic',
  status: 'active',
  intencion: 'active',
  autoBloqueo: true,
  horaBloqueo: '08:00',
  ...extra,
});

const cartera = (extra: Partial<EstadoCartera> = {}): EstadoCartera => ({
  totalCuotas: 12,
  pagadas: 4,
  pendientes: 8,
  vencidas: 0,
  proxima: null,
  diasDeMora: 0,
  saldo: 800000,
  liquidado: false,
  prorroga: null,
  conProrrogaVigente: 0,
  ...extra,
});

describe('resumirCartera', () => {
  it('no cuenta como vencida la cuota que vence hoy', () => {
    const r = resumirCartera(
      { cuotas: [cuota(1, '2026-10-06')], valorCuota: 100000 },
      '2026-10-06'
    );
    expect(r.vencidas).toBe(0);
    expect(r.diasDeMora).toBe(0);
  });

  it('cuenta un día de mora al día siguiente del vencimiento', () => {
    const r = resumirCartera(
      { cuotas: [cuota(1, '2026-10-05')], valorCuota: 100000 },
      '2026-10-06'
    );
    expect(r.vencidas).toBe(1);
    expect(r.diasDeMora).toBe(1);
  });

  it('toma la mora de la cuota vencida más antigua, no de la última', () => {
    const r = resumirCartera(
      {
        cuotas: [cuota(1, '2026-09-20'), cuota(2, '2026-10-05')],
        valorCuota: 100000,
      },
      '2026-10-06'
    );
    expect(r.vencidas).toBe(2);
    expect(r.diasDeMora).toBe(16);
  });

  it('suma cuotasPrevias para no decirle al cliente que pagó menos de lo que pagó', () => {
    const r = resumirCartera(
      {
        cuotas: [cuota(9, '2026-10-20'), cuota(10, '2026-11-04')],
        cuotasPrevias: 8,
        valorCuota: 100000,
      },
      '2026-10-06'
    );
    expect(r.totalCuotas).toBe(10);
    expect(r.pagadas).toBe(8);
    expect(r.pendientes).toBe(2);
  });

  it('da por liquidado sólo cuando hay cuotas y ninguna queda pendiente', () => {
    expect(
      resumirCartera(
        { cuotas: [cuota(1, '2026-09-01', 'paid'), cuota(2, '2026-09-15', 'paid')] },
        '2026-10-06'
      ).liquidado
    ).toBe(true);

    // Un financiamiento sin cuotas cargadas no está pagado, está sin datos. Si
    // devolviera true, la política propondría liberar equipos por error.
    expect(resumirCartera({ cuotas: [] }, '2026-10-06').liquidado).toBe(false);
  });

  it('señala como próxima la cuota pendiente más antigua', () => {
    const r = resumirCartera(
      { cuotas: [cuota(3, '2026-11-04'), cuota(2, '2026-10-20')] },
      '2026-10-06'
    );
    expect(r.proxima?.number).toBe(2);
  });
});

describe('decidir — a quién NO se toca', () => {
  it('deja en paz los equipos de Nuovo: esta API no los alcanza', () => {
    const d = decidir(
      equipo({ plataforma: 'nuovo' }),
      cartera({ vencidas: 5, diasDeMora: 40 }),
      CONFIG,
      AHORA
    );
    expect(d.accion).toBe('nada');
    expect(d.motivo).toMatch(/Trustonic/);
  });

  it('deja en paz los equipos sin verificar todavía', () => {
    const d = decidir(
      equipo({ plataforma: 'desconocida' }),
      cartera({ vencidas: 3, diasDeMora: 20 }),
      CONFIG,
      AHORA
    );
    expect(d.accion).toBe('nada');
  });

  it('respeta el interruptor por equipo aunque haya mora', () => {
    const d = decidir(
      equipo({ autoBloqueo: false }),
      cartera({ vencidas: 2, diasDeMora: 15 }),
      CONFIG,
      AHORA
    );
    expect(d.accion).toBe('nada');
    expect(d.motivo).toMatch(/desactivado/);
  });

  it('no repite el bloqueo de un equipo ya bloqueado y confirmado', () => {
    const d = decidir(
      equipo({ status: 'blocked', intencion: 'blocked' }),
      cartera({ vencidas: 1, diasDeMora: 5 }),
      CONFIG,
      AHORA
    );
    expect(d.accion).toBe('nada');
  });
});

describe('decidir — quien pagó', () => {
  it('desbloquea a quien ya no tiene cuotas vencidas', () => {
    const d = decidir(
      equipo({ status: 'blocked', intencion: 'blocked' }),
      cartera({ vencidas: 0, diasDeMora: 0 }),
      CONFIG,
      AHORA
    );
    expect(d.accion).toBe('desbloquear');
  });

  it('desbloquea también cuando el bloqueo sólo era intención sin confirmar', () => {
    // El equipo estaba apagado: la orden nunca llegó. Si no se desbloqueara la
    // intención, el reconciliador la reintentaría y bloquearía a alguien que ya
    // pagó en cuanto encendiera el teléfono.
    const d = decidir(
      equipo({ status: 'active', intencion: 'blocked' }),
      cartera({ vencidas: 0 }),
      CONFIG,
      AHORA
    );
    expect(d.accion).toBe('desbloquear');
  });

  it('propone liberar a quien terminó de pagar', () => {
    const d = decidir(equipo(), cartera({ liquidado: true, vencidas: 0 }), CONFIG, AHORA);
    expect(d.accion).toBe('liberar');
  });

  it('a quien terminó de pagar y sigue bloqueado lo desbloquea antes de liberarlo', () => {
    const d = decidir(
      equipo({ status: 'blocked' }),
      cartera({ liquidado: true, vencidas: 0 }),
      CONFIG,
      AHORA
    );
    expect(d.accion).toBe('desbloquear');
  });

  it('el desbloqueo pesa más que la mora reportada por otra vía', () => {
    // Cartera sin vencidas pero con días de mora residuales de un cálculo
    // anterior: manda "no debe nada", no "debe".
    const d = decidir(
      equipo({ status: 'blocked' }),
      cartera({ vencidas: 0, diasDeMora: 12 }),
      CONFIG,
      AHORA
    );
    expect(d.accion).toBe('desbloquear');
  });
});

describe('decidir — días de gracia y hora pactada', () => {
  it('no bloquea dentro de los días de gracia configurados', () => {
    const d = decidir(
      equipo(),
      cartera({ vencidas: 1, diasDeMora: 2 }),
      { ...CONFIG, diasDeGracia: 5 },
      AHORA
    );
    expect(d.accion).toBe('nada');
    expect(d.motivo).toMatch(/gracia/);
  });

  it('bloquea el día en que se agota la gracia, pasada la hora pactada', () => {
    const d = decidir(
      equipo({ horaBloqueo: '08:00' }),
      cartera({ vencidas: 1, diasDeMora: 5 }),
      { ...CONFIG, diasDeGracia: 5 },
      { fecha: '2026-10-06', hora: 9, minuto: 0 }
    );
    expect(d.accion).toBe('bloquear');
  });

  it('no bloquea antes de la hora pactada el primer día que ya podría', () => {
    const d = decidir(
      equipo({ horaBloqueo: '14:30' }),
      cartera({ vencidas: 1, diasDeMora: 1 }),
      CONFIG,
      { fecha: '2026-10-06', hora: 14, minuto: 15 }
    );
    expect(d.accion).toBe('nada');
    expect(d.motivo).toMatch(/14:30/);
  });

  it('bloquea en el minuto pactado, no uno después', () => {
    const d = decidir(
      equipo({ horaBloqueo: '14:30' }),
      cartera({ vencidas: 1, diasDeMora: 1 }),
      CONFIG,
      { fecha: '2026-10-06', hora: 14, minuto: 30 }
    );
    expect(d.accion).toBe('bloquear');
  });

  it('con gracia 0 sigue esperando la hora pactada, no bloquea a medianoche', () => {
    const d = decidir(
      equipo({ horaBloqueo: '08:00' }),
      cartera({ vencidas: 1, diasDeMora: 1 }),
      { ...CONFIG, diasDeGracia: 0 },
      { fecha: '2026-10-06', hora: 0, minuto: 5 }
    );
    expect(d.accion).toBe('nada');
  });

  it('pasada la gracia ya no mira la hora: la promesa era del primer día', () => {
    const d = decidir(
      equipo({ horaBloqueo: '14:30' }),
      cartera({ vencidas: 2, diasDeMora: 9 }),
      CONFIG,
      { fecha: '2026-10-06', hora: 1, minuto: 0 }
    );
    expect(d.accion).toBe('bloquear');
  });

  it('usa 08:00 cuando el equipo no tiene hora pactada', () => {
    const temprano = decidir(
      equipo({ horaBloqueo: undefined }),
      cartera({ vencidas: 1, diasDeMora: 1 }),
      CONFIG,
      { fecha: '2026-10-06', hora: 7, minuto: 0 }
    );
    expect(temprano.accion).toBe('nada');

    const tarde = decidir(
      equipo({ horaBloqueo: undefined }),
      cartera({ vencidas: 1, diasDeMora: 1 }),
      CONFIG,
      { fecha: '2026-10-06', hora: 8, minuto: 0 }
    );
    expect(tarde.accion).toBe('bloquear');
  });

  it('el motivo del bloqueo lleva cuotas, días y saldo para la bitácora', () => {
    const d = decidir(
      equipo(),
      cartera({ vencidas: 2, diasDeMora: 9, saldo: 450000 }),
      CONFIG,
      AHORA
    );
    expect(d.accion).toBe('bloquear');
    expect(d.motivo).toMatch(/2 cuota/);
    expect(d.motivo).toMatch(/9 día/);
    expect(d.motivo).toMatch(/450\.000/);
  });
});

describe('decidir — aviso en pantalla el día antes', () => {
  it('avisa cuando la cuota vence mañana', () => {
    const d = decidir(
      equipo(),
      cartera({ vencidas: 0, proxima: cuota(5, '2026-10-07') }),
      CONFIG,
      AHORA
    );
    expect(d.accion).toBe('avisar_pantalla');
  });

  it('no avisa dos veces por la misma cuota', () => {
    const d = decidir(
      equipo({ avisoPantallaEnviado: '2026-10-07' }),
      cartera({ vencidas: 0, proxima: cuota(5, '2026-10-07') }),
      CONFIG,
      AHORA
    );
    expect(d.accion).toBe('nada');
  });

  it('no avisa con tres días de antelación: ahí el aviso es ruido', () => {
    const d = decidir(
      equipo(),
      cartera({ vencidas: 0, proxima: cuota(5, '2026-10-09') }),
      CONFIG,
      AHORA
    );
    expect(d.accion).toBe('nada');
  });

  it('no avisa si el aviso en pantalla está apagado', () => {
    const d = decidir(
      equipo(),
      cartera({ vencidas: 0, proxima: cuota(5, '2026-10-07') }),
      { ...CONFIG, avisoEnPantallaActivo: false },
      AHORA
    );
    expect(d.accion).toBe('nada');
  });
});

describe('la cuota que vence hoy no se bloquea hoy', () => {
  /**
   * Esta es la regresión que motivó separar `fechaDeVencimiento` de la
   * conversión a hora de Colombia. Las cuotas se guardan como medianoche UTC;
   * al pasarlas por America/Bogota (UTC-5) se corrían un día hacia atrás, así
   * que una cuota que vencía hoy aparecía con un día de mora y el equipo se
   * bloqueaba el mismo día del vencimiento, antes de que el cliente alcanzara
   * a pagar.
   */
  it('de punta a punta: cuota de hoy, equipo intacto', () => {
    const resumen = resumirCartera(
      { cuotas: [cuota(7, '2026-10-06')], valorCuota: 150000 },
      '2026-10-06'
    );
    const d = decidir(equipo(), resumen, CONFIG, { fecha: '2026-10-06', hora: 23, minuto: 50 });
    expect(resumen.vencidas).toBe(0);
    expect(d.accion).toBe('nada');
  });

  it('de punta a punta: la misma cuota al día siguiente sí bloquea', () => {
    const resumen = resumirCartera(
      { cuotas: [cuota(7, '2026-10-06')], valorCuota: 150000 },
      '2026-10-07'
    );
    const d = decidir(equipo(), resumen, CONFIG, { fecha: '2026-10-07', hora: 9, minuto: 0 });
    expect(resumen.diasDeMora).toBe(1);
    expect(d.accion).toBe('bloquear');
  });
});

/**
 * PRÓRROGAS — el dueño le da unos días y el automatismo tiene que enterarse.
 *
 * Es la parte que no se puede comprobar mirando la pantalla: el panel puede
 * decir "PRÓRROGA hasta el 20" y el cron, media hora después, bloquear el
 * teléfono igual porque él lee `dueDate`. Si estas pruebas pasan, la etiqueta y
 * el teléfono dicen lo mismo.
 */
describe('resumirCartera — con prórroga', () => {
  it('una cuota vencida con prórroga abierta no cuenta como vencida', () => {
    // Vencía el 1, hoy es 6, se le dio hasta el 20: no debe nada todavía.
    const r = resumirCartera(
      { cuotas: [conProrroga(cuota(1, '2026-10-01'), '2026-10-20')], valorCuota: 100000 },
      '2026-10-06'
    );
    expect(r.vencidas).toBe(0);
    expect(r.diasDeMora).toBe(0);
    expect(r.conProrrogaVigente).toBe(1);
    expect(r.prorroga?.hasta).toBe('2026-10-20');
  });

  it('el último día del plazo todavía no es mora', () => {
    const r = resumirCartera(
      { cuotas: [conProrroga(cuota(1, '2026-10-01'), '2026-10-06')], valorCuota: 100000 },
      '2026-10-06'
    );
    expect(r.vencidas).toBe(0);
    expect(r.diasDeMora).toBe(0);
  });

  it('al día siguiente del plazo hay UN día de mora, no los del contrato', () => {
    /*
     * Lo que esta prueba protege es la diferencia entre 1 y 6. Contando desde
     * `dueDate` el cliente saldría con 6 días de mora el primer día tras el
     * plazo, superaría de golpe cualquier gracia configurada y el equipo se
     * bloquearía en la misma vuelta del cron: la prórroga habría sido una
     * trampa en vez de un favor.
     */
    const r = resumirCartera(
      { cuotas: [conProrroga(cuota(1, '2026-10-01'), '2026-10-06')], valorCuota: 100000 },
      '2026-10-07'
    );
    expect(r.vencidas).toBe(1);
    expect(r.diasDeMora).toBe(1);
    // Ya no está vigente, así que no se le anuncia ningún plazo al cliente.
    expect(r.prorroga).toBe(null);
    expect(r.conProrrogaVigente).toBe(0);
  });

  it('la prórroga no toca la fecha pactada: queda registrada al lado', () => {
    const r = resumirCartera(
      { cuotas: [conProrroga(cuota(1, '2026-10-01'), '2026-10-20')], valorCuota: 100000 },
      '2026-10-06'
    );
    expect(r.proxima?.dueDate).toBe('2026-10-01T00:00:00.000Z');
    expect(r.proxima?.prorroga?.fechaOriginal).toBe('2026-10-01');
  });

  it('ordena por la fecha efectiva, no por la pactada', () => {
    // La #1 vence antes en el contrato pero tiene plazo hasta el 25; la que de
    // verdad toca cobrar antes es la #2.
    const r = resumirCartera(
      {
        cuotas: [
          conProrroga(cuota(1, '2026-10-01'), '2026-10-25'),
          cuota(2, '2026-10-10'),
        ],
        valorCuota: 100000,
      },
      '2026-10-06'
    );
    expect(r.proxima?.number).toBe(2);
  });

  it('con dos cuotas vencidas y plazo en una, sólo cuenta la otra', () => {
    const r = resumirCartera(
      {
        cuotas: [
          conProrroga(cuota(1, '2026-09-20'), '2026-10-20'),
          cuota(2, '2026-10-05'),
        ],
        valorCuota: 100000,
      },
      '2026-10-06'
    );
    expect(r.vencidas).toBe(1);
    expect(r.diasDeMora).toBe(1);
  });

  it('una prórroga sobre una cuota pagada no cambia nada', () => {
    const r = resumirCartera(
      {
        cuotas: [conProrroga(cuota(1, '2026-09-20', 'paid'), '2026-10-30')],
        valorCuota: 100000,
      },
      '2026-10-06'
    );
    expect(r.liquidado).toBe(true);
    expect(r.conProrrogaVigente).toBe(0);
  });
});

describe('decidir — con prórroga', () => {
  it('no bloquea a quien tiene plazo abierto', () => {
    const resumen = resumirCartera(
      { cuotas: [conProrroga(cuota(1, '2026-09-20'), '2026-10-20')], valorCuota: 100000 },
      '2026-10-06'
    );
    // 16 días de mora por contrato, de sobra para bloquear sin la prórroga.
    const d = decidir(equipo(), resumen, CONFIG, AHORA);
    expect(d.accion).toBe('nada');
  });

  it('suelta el equipo que estaba bloqueado por esa cuota', () => {
    const resumen = resumirCartera(
      { cuotas: [conProrroga(cuota(1, '2026-09-20'), '2026-10-20')], valorCuota: 100000 },
      '2026-10-06'
    );
    const d = decidir(
      equipo({ status: 'blocked', intencion: 'blocked' }),
      resumen,
      CONFIG,
      AHORA
    );
    expect(d.accion).toBe('desbloquear');
    // El motivo va a la bitácora: "no tiene cuotas vencidas" sobre alguien que
    // no ha pagado se lee como un fallo del sistema.
    expect(d.motivo).toMatch(/prórroga hasta el 2026-10-20/);
  });

  it('vuelve a bloquear en cuanto el plazo se cumple', () => {
    const resumen = resumirCartera(
      { cuotas: [conProrroga(cuota(1, '2026-09-20'), '2026-10-05')], valorCuota: 100000 },
      '2026-10-07'
    );
    // 2 días desde el plazo: pasa la gracia de 1 día y toca bloquear.
    expect(resumen.diasDeMora).toBe(2);
    const d = decidir(equipo(), resumen, CONFIG, { fecha: '2026-10-07', hora: 9, minuto: 0 });
    expect(d.accion).toBe('bloquear');
  });

  it('el día después del plazo respeta los días de gracia', () => {
    const resumen = resumirCartera(
      { cuotas: [conProrroga(cuota(1, '2026-09-20'), '2026-10-05')], valorCuota: 100000 },
      '2026-10-06'
    );
    expect(resumen.diasDeMora).toBe(1);
    // Gracia de 2: al cliente le queda un día más de aire tras el plazo, igual
    // que a cualquier otro. Sin `fechaLimite` llevaría 16 días y ya estaría
    // bloqueado.
    const d = decidir(equipo(), resumen, { ...CONFIG, diasDeGracia: 2 }, AHORA);
    expect(d.accion).toBe('nada');
    expect(d.motivo).toMatch(/gracia/);
  });

  it('avisa en pantalla el día antes de que venza el plazo, no el de la cuota', () => {
    const resumen = resumirCartera(
      { cuotas: [conProrroga(cuota(5, '2026-09-30'), '2026-10-07')], valorCuota: 100000 },
      '2026-10-06'
    );
    const d = decidir(equipo(), resumen, CONFIG, AHORA);
    expect(d.accion).toBe('avisar_pantalla');
    expect(d.motivo).toMatch(/prórroga vence mañana/);
  });

  it('un equipo bloqueado a mano NO se suelta por una prórroga', () => {
    /*
     * Se bloquea a mano por cosas que la cartera no sabe —equipo reportado como
     * robado, cliente desaparecido con el teléfono, acuerdo roto— y ahí el plazo
     * de una cuota es irrelevante.
     *
     * El freno está puesto en dos sitios, y es a propósito: aquí, para el cron
     * que recorre los 115 equipos cada 30 minutos, y en
     * `liberarPorqueYaNoDebe` (`respetarBloqueoManual: true`) para el botón de
     * prórroga, que no pasa por `decidir`. Son dos caminos distintos hasta el
     * mismo desbloqueo y tapar sólo uno dejaba el otro abierto.
     *
     * El pago sí pisa el bloqueo manual: ahí el dueño está afirmando que el
     * dinero entró, que es exactamente la decisión que había tomado a mano.
     */
    const resumen = resumirCartera(
      { cuotas: [conProrroga(cuota(1, '2026-09-20'), '2026-10-20')], valorCuota: 100000 },
      '2026-10-06'
    );
    const d = decidir(
      equipo({ status: 'blocked', intencion: 'blocked', bloqueoManual: true }),
      resumen,
      CONFIG,
      AHORA
    );
    expect(d.accion).toBe('nada');
    expect(d.motivo).toMatch(/a mano/);
  });

  it('de punta a punta: el día que vence la prórroga no se bloquea', () => {
    const resumen = resumirCartera(
      { cuotas: [conProrroga(cuota(3, '2026-09-25'), '2026-10-06')], valorCuota: 150000 },
      '2026-10-06'
    );
    const d = decidir(equipo(), resumen, CONFIG, { fecha: '2026-10-06', hora: 23, minuto: 50 });
    expect(resumen.vencidas).toBe(0);
    expect(d.accion).toBe('nada');
    expect(d.motivo).toMatch(/prórroga hasta el 2026-10-06/);
  });
});
