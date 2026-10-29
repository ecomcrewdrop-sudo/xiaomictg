// @vitest-environment node
/**
 * El WhatsApp que confirma el plazo.
 *
 * Existe porque este aviso estuvo colgado del desbloqueo del equipo, y así el
 * cliente corriente no recibía nada: lo normal es que llame el día que le toca
 * la cuota —cuando el teléfono todavía funciona, porque el automatismo no
 * bloquea hasta la mañana siguiente— y en ese caso no había teléfono que
 * mover, luego no había mensaje. El acuerdo quedaba sólo en la memoria de quien
 * atendió la llamada, mientras el panel decía "se le avisó por WhatsApp".
 *
 * Lo que se verifica aquí es sobre todo lo que el mensaje NO puede decir. Es un
 * texto que el cliente guarda en el celular y que va a enseñar si hay
 * discusión: si dice que pagó, la cuota está regalada por un error de
 * redacción.
 */
import { describe, expect, it } from 'vitest';
import { avisarDeProrroga, type DepsBloqueo } from '../../server/blocking';

const REGISTRO = {
  id: 'fin-1',
  nombre: 'maria lopez',
  telefono: '3001234567',
  valorCuota: 250000,
};

/** Deps de mentira: lo único real que hace falta es capturar el envío. */
function mockDeps(over: { registro?: any; listo?: boolean } = {}) {
  const enviados: { telefono: string; texto: string }[] = [];
  const registro = 'registro' in over ? over.registro : REGISTRO;
  const deps: DepsBloqueo = {
    getDb: () => ({
      collection: () => ({ findOne: async () => registro }),
    }),
    enviarWhatsApp: async (telefono, texto) => {
      enviados.push({ telefono, texto });
      return true;
    },
    whatsappListo: () => over.listo !== false,
    nombreBonito: (v: string) => v.replace(/\b\w/g, (c) => c.toUpperCase()),
  };
  return { deps, enviados };
}

describe('avisarDeProrroga', () => {
  it('avisa aunque el equipo no se haya movido', async () => {
    // El caso corriente, y el que no funcionaba: cuota de hoy, teléfono sin
    // bloquear todavía, plazo concedido por teléfono.
    const { deps, enviados } = mockDeps();
    await avisarDeProrroga(deps, 'fin-1', '2026-10-20', 3, false);

    expect(enviados).toHaveLength(1);
    expect(enviados[0].telefono).toBe('3001234567');
    expect(enviados[0].texto).toContain('Tienes plazo');
  });

  it('nunca le dice al cliente que pagó', async () => {
    /*
     * La razón de ser de este archivo. El aviso de desbloqueo por pago y el de
     * prórroga salían por la misma función, y al quitar la rama de la prórroga
     * su llamada caía en el `else` del pago: "ya registramos tu pago", en un
     * mensaje enviado a alguien que justamente no ha pagado.
     */
    const { deps, enviados } = mockDeps();
    await avisarDeProrroga(deps, 'fin-1', '2026-10-20', 3, true);
    await avisarDeProrroga(deps, 'fin-1', '2026-10-20', 3, false);

    for (const { texto } of enviados) {
      expect(texto).not.toMatch(/registramos tu pago/i);
      expect(texto).not.toMatch(/gracias por estar al día/i);
      // Y tiene que decir lo contrario, con esas palabras.
      expect(texto).toMatch(/cuota sigue pendiente/i);
    }
  });

  it('dice la fecha del plazo tal cual, sin corrimiento de zona', async () => {
    // En UTC-5 un formateo descuidado anuncia el 19 y le quita un día de plazo
    // al cliente respecto al que respeta el automatismo.
    const { deps, enviados } = mockDeps();
    await avisarDeProrroga(deps, 'fin-1', '2026-10-20', 3, false);

    expect(enviados[0].texto).toContain('20');
    expect(enviados[0].texto).toContain('octubre');
  });

  it('nombra la cuota que recibió por parámetro, no la próxima', async () => {
    // El número llega de la ruta a propósito: si se leyera de la cartera, una
    // prórroga sobre una cuota posterior anunciaría la cuota equivocada.
    const { deps, enviados } = mockDeps();
    await avisarDeProrroga(deps, 'fin-1', '2026-11-05', 7, false);

    expect(enviados[0].texto).toContain('#7');
  });

  it('cuando sí se desbloqueó, lo dice y avisa de que puede volver a pasar', async () => {
    const { deps, enviados } = mockDeps();
    await avisarDeProrroga(deps, 'fin-1', '2026-10-20', 3, true);

    expect(enviados[0].texto).toContain('desbloqueado');
    expect(enviados[0].texto).toMatch(/se vuelve a bloquear/i);
  });

  it('con WhatsApp caído no manda nada y no revienta', async () => {
    const { deps, enviados } = mockDeps({ listo: false });
    await expect(avisarDeProrroga(deps, 'fin-1', '2026-10-20', 3, false)).resolves.toBeUndefined();
    expect(enviados).toHaveLength(0);
  });

  it('sin el financiamiento en la base se calla, no manda un mensaje a medias', async () => {
    const { deps, enviados } = mockDeps({ registro: null });
    await avisarDeProrroga(deps, 'fin-1', '2026-10-20', 3, false);
    expect(enviados).toHaveLength(0);
  });

  it('si el envío falla, la prórroga no se cae con él', async () => {
    /*
     * El plazo ya está guardado cuando esto corre, y es el dato que respeta el
     * automatismo. Propagar el error haría que la ruta devolviera 500 sobre una
     * prórroga que de hecho quedó concedida, y el dueño volvería a intentarlo.
     */
    const deps: DepsBloqueo = {
      getDb: () => {
        throw new Error('mongo caído');
      },
      enviarWhatsApp: async () => true,
      whatsappListo: () => true,
      nombreBonito: (v: string) => v,
    };
    await expect(avisarDeProrroga(deps, 'fin-1', '2026-10-20', 3, false)).resolves.toBeUndefined();
  });
});
