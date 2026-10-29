import { describe, expect, it } from 'vitest';
import { DIAS_DE_ANTICIPO, diasQueFaltan, tipoDeAviso } from '../../server/recordatorios';

describe('tipoDeAviso', () => {
  it('avisa con anticipación en los días configurados', () => {
    for (const d of DIAS_DE_ANTICIPO) {
      expect(tipoDeAviso(-d)).toBe('anticipo');
    }
  });

  it('la víspera y el día del vencimiento conservan su propio aviso', () => {
    expect(tipoDeAviso(-1)).toBe('previo');
    expect(tipoDeAviso(0)).toBe('hoy');
  });

  it('a partir del día siguiente es mora', () => {
    expect(tipoDeAviso(1)).toBe('mora');
    expect(tipoDeAviso(45)).toBe('mora');
  });

  /**
   * Éste es el que de verdad importa: 112 clientes activos pasan por aquí cada
   * hora. Si un día que no toca devolviera algo distinto de null, esa gente
   * recibiría un mensaje de cobro sin deberlo.
   */
  it('callado en todos los demás días previos', () => {
    const avisan = new Set<number>([1, ...DIAS_DE_ANTICIPO]);
    for (let d = 1; d <= 60; d++) {
      if (avisan.has(d)) continue;
      expect(tipoDeAviso(-d), `no debería avisar a ${d} días del vencimiento`).toBeNull();
    }
  });

  it('no se cae con una fecha ilegible', () => {
    expect(tipoDeAviso(NaN)).toBeNull();
    expect(tipoDeAviso(Infinity)).toBeNull();
  });

  /**
   * El candado de "un mensaje por cliente por día" (lastReminderSent) sólo
   * funciona si cada día cae en un único tipo de aviso. Si dos reglas se
   * solaparan, una de las dos quedaría muda para siempre y nadie lo notaría.
   */
  it('cada día cae en un único tipo de aviso', () => {
    for (let d = -60; d <= 60; d++) {
      const tipos = [
        d >= 1 ? 'mora' : null,
        d === 0 ? 'hoy' : null,
        d === -1 ? 'previo' : null,
        DIAS_DE_ANTICIPO.includes(-d) ? 'anticipo' : null,
      ].filter(Boolean);
      expect(tipos.length, `el día ${d} encaja en ${tipos.length} reglas`).toBeLessThanOrEqual(1);
      expect(tipoDeAviso(d)).toBe(tipos[0] ?? null);
    }
  });

  it('los días de anticipo no pisan la víspera ni el día del vencimiento', () => {
    expect(DIAS_DE_ANTICIPO).not.toContain(0);
    expect(DIAS_DE_ANTICIPO).not.toContain(1);
  });
});

describe('diasQueFaltan', () => {
  it('convierte la distancia en algo que se puede leer en el mensaje', () => {
    expect(diasQueFaltan(-7)).toBe(7);
    expect(diasQueFaltan(-3)).toBe(3);
  });

  it('no promete días que ya pasaron', () => {
    expect(diasQueFaltan(0)).toBe(0);
    expect(diasQueFaltan(5)).toBe(0);
  });
});
