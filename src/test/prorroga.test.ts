// @vitest-environment node
/**
 * Las piezas sueltas del plazo extra.
 *
 * `blocking-politica.test.ts` ya comprueba que el automatismo respeta la
 * prórroga. Aquí se prueba lo de antes: que la fecha se lea bien y que no se
 * pueda guardar una que haga daño.
 *
 * Lo que más importa de este archivo es `validarProrroga`. Es lo único que hay
 * entre un dedo gordo y un cliente al que nadie le mira la cuota durante un
 * año: teclear 2027 en vez de 2026 en el calendario pasa, y pasa justo cuando
 * se está atendiendo a alguien por teléfono.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_DIAS_PRORROGA,
  diasEntreFechas,
  fechaLarga,
  fechaLimite,
  prorrogaVigente,
  soloFecha,
  tieneProrroga,
  validarProrroga,
  type Prorroga,
} from '../../server/prorroga';

const plazo = (hasta: string): Prorroga => ({
  hasta,
  otorgadaEn: '2026-10-06T15:00:00.000Z',
  otorgadaPor: 'admin',
  fechaOriginal: '2026-10-01',
});

describe('soloFecha', () => {
  it('se queda con el día de la cadena y no lo mueve de zona', () => {
    // La regresión original: con America/Bogota (UTC-5) esto devolvía el día 5,
    // así que una cuota que vencía hoy aparecía con un día de mora.
    expect(soloFecha('2026-10-06T00:00:00.000Z')).toBe('2026-10-06');
  });

  it('acepta una fecha ya corta sin tocarla', () => {
    expect(soloFecha('2026-10-06')).toBe('2026-10-06');
  });

  it('devuelve cadena vacía con lo que no es fecha, en vez de inventar una', () => {
    // Importa que sea '' y no la fecha de hoy: un '' se propaga como "no sé
    // cuándo vence" y no bloquea a nadie; un "hoy" inventado sí.
    expect(soloFecha(undefined)).toBe('');
    expect(soloFecha(null)).toBe('');
    expect(soloFecha('mañana')).toBe('');
  });
});

describe('fechaLimite', () => {
  it('sin prórroga manda la fecha pactada', () => {
    expect(fechaLimite({ dueDate: '2026-10-06T00:00:00.000Z' })).toBe('2026-10-06');
  });

  it('con prórroga manda el plazo', () => {
    expect(
      fechaLimite({ dueDate: '2026-10-01T00:00:00.000Z', prorroga: plazo('2026-10-20') })
    ).toBe('2026-10-20');
  });

  it('sigue mandando el plazo aunque ya se haya cumplido', () => {
    /*
     * Deliberado y es el detalle del que depende todo: la mora se cuenta desde
     * el plazo, no desde el contrato. Si volviera a `dueDate` al vencerse, el
     * cliente saldría de golpe con semanas de mora el primer día tras el plazo
     * y el cron le bloquearía el teléfono sin el aviso que recibe cualquier
     * otro. `prorrogaVigente` es la función para la otra pregunta.
     */
    expect(
      fechaLimite({ dueDate: '2026-09-01T00:00:00.000Z', prorroga: plazo('2026-09-15') })
    ).toBe('2026-09-15');
  });

  it('una prórroga sin fecha no tapa la fecha pactada', () => {
    expect(
      fechaLimite({ dueDate: '2026-10-06T00:00:00.000Z', prorroga: { ...plazo(''), hasta: '' } })
    ).toBe('2026-10-06');
  });

  it('sin cuota devuelve vacío en vez de romper', () => {
    expect(fechaLimite(null)).toBe('');
    expect(fechaLimite(undefined)).toBe('');
  });
});

describe('prorrogaVigente', () => {
  const cuota = { dueDate: '2026-10-01T00:00:00.000Z', prorroga: plazo('2026-10-20') };

  it('está vigente el último día del plazo', () => {
    expect(prorrogaVigente(cuota, '2026-10-20')?.hasta).toBe('2026-10-20');
  });

  it('deja de estarlo al día siguiente', () => {
    expect(prorrogaVigente(cuota, '2026-10-21')).toBe(null);
  });

  it('sin prórroga no hay nada que mostrar', () => {
    expect(prorrogaVigente({ dueDate: '2026-10-01' }, '2026-10-06')).toBe(null);
  });
});

describe('tieneProrroga', () => {
  it('distingue tenerla de que siga abierta', () => {
    // Ya vencida pero registrada: `tieneProrroga` sí, `prorrogaVigente` no.
    const c = { dueDate: '2026-09-01', prorroga: plazo('2026-09-15') };
    expect(tieneProrroga(c)).toBe(true);
    expect(prorrogaVigente(c, '2026-10-06')).toBe(null);
  });

  it('no se traga una prórroga sin fecha', () => {
    expect(tieneProrroga({ dueDate: '2026-10-01', prorroga: { ...plazo(''), hasta: '' } })).toBe(false);
  });
});

describe('fechaLarga', () => {
  it('escribe el día que se le promete al cliente, sin corrimiento de zona', () => {
    // En UTC-5 esto saldría como el 20, y por WhatsApp le prometeríamos un día
    // menos de plazo del que respeta el automatismo.
    expect(fechaLarga('2026-10-21')).toContain('21');
    expect(fechaLarga('2026-10-21')).toContain('octubre');
  });

  it('con una fecha ilegible devuelve lo que recibió en vez de "Invalid Date"', () => {
    expect(fechaLarga('cualquier cosa')).toBe('cualquier cosa');
  });
});

describe('diasEntreFechas', () => {
  it('cuenta días completos', () => {
    expect(diasEntreFechas('2026-10-06', '2026-10-20')).toBe(14);
    expect(diasEntreFechas('2026-10-06', '2026-10-06')).toBe(0);
  });

  it('cruza el cambio de mes y de año', () => {
    expect(diasEntreFechas('2026-10-25', '2026-11-04')).toBe(10);
    expect(diasEntreFechas('2026-12-28', '2027-01-04')).toBe(7);
  });

  it('da negativo si la segunda fecha es anterior', () => {
    expect(diasEntreFechas('2026-10-20', '2026-10-06')).toBe(-14);
  });
});

describe('validarProrroga', () => {
  const HOY = '2026-10-06';
  const cuotaPendiente = { dueDate: '2026-10-06T00:00:00.000Z', status: 'pending' };

  it('acepta el plazo normal y devuelve la fecha normalizada', () => {
    expect(validarProrroga('2026-10-20', cuotaPendiente, HOY)).toEqual({ hasta: '2026-10-20' });
  });

  it('acepta "hasta hoy": sirve para no bloquearlo mientras va a pagar', () => {
    expect(validarProrroga(HOY, cuotaPendiente, HOY)).toEqual({ hasta: HOY });
  });

  it('rechaza una fecha de ayer', () => {
    // No daría plazo a nada: el cron lo bloquearía igual, pero el panel diría
    // que tiene prórroga. Peor que no tenerla.
    const r = validarProrroga('2026-10-05', cuotaPendiente, HOY);
    expect(r).toHaveProperty('error');
    expect((r as { error: string }).error).toMatch(/hoy o más adelante/);
  });

  it('rechaza adelantar el cobro', () => {
    const r = validarProrroga('2026-10-10', { dueDate: '2026-10-15', status: 'pending' }, HOY);
    expect((r as { error: string }).error).toMatch(/más plazo, no adelantarlo/);
  });

  it('rechaza una cuota ya pagada', () => {
    const r = validarProrroga('2026-10-20', { dueDate: '2026-10-06', status: 'paid' }, HOY);
    expect((r as { error: string }).error).toMatch(/ya está pagada/);
  });

  it('rechaza el año mal tecleado y lo dice en esos términos', () => {
    /*
     * Éste es el caso por el que existe el tope. Un 2027 en el calendario deja
     * al cliente 365 días fuera del automatismo y nadie se enteraría hasta que
     * la cuota se hubiera perdido del todo, así que el mensaje apunta
     * directamente a lo que hay que mirar.
     */
    const r = validarProrroga('2027-10-20', cuotaPendiente, HOY);
    expect((r as { error: string }).error).toMatch(/revisa el año/);
  });

  it('deja pasar el tope exacto y corta un día después', () => {
    const tope = new Date(`${HOY}T00:00:00Z`);
    tope.setUTCDate(tope.getUTCDate() + MAX_DIAS_PRORROGA);
    const enElTope = tope.toISOString().slice(0, 10);
    expect(validarProrroga(enElTope, cuotaPendiente, HOY)).toEqual({ hasta: enElTope });

    tope.setUTCDate(tope.getUTCDate() + 1);
    expect(validarProrroga(tope.toISOString().slice(0, 10), cuotaPendiente, HOY)).toHaveProperty('error');
  });

  it('rechaza lo que no es una fecha', () => {
    expect(validarProrroga('', cuotaPendiente, HOY)).toHaveProperty('error');
    expect(validarProrroga(undefined, cuotaPendiente, HOY)).toHaveProperty('error');
    expect(validarProrroga('el viernes', cuotaPendiente, HOY)).toHaveProperty('error');
  });

  it('el orden de los rechazos no deja pasar nada por el hueco', () => {
    // Pagada Y con fecha de ayer: tiene que rechazar, no importa por cuál.
    expect(
      validarProrroga('2026-10-05', { dueDate: '2026-10-01', status: 'paid' }, HOY)
    ).toHaveProperty('error');
  });
});
