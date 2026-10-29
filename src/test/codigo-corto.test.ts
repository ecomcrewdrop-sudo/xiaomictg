import { describe, expect, it, vi } from 'vitest';
import {
  ALFABETO,
  LARGO_CODIGO,
  asegurarCodigoCorto,
  buscarPorCodigo,
  cedulaCoincide,
  controlDeIntentos,
  generarCodigo,
  normalizarCodigo,
  pareceCodigoCorto,
  ultimos4,
} from '../../server/codigo-corto';

/**
 * Un Mongo de juguete con lo justo: `findOne`, `updateOne` y el índice único.
 *
 * Lo del índice es lo que importa. La unicidad del código no se puede sostener
 * leyendo antes de escribir, así que el código de verdad depende de que Mongo
 * lance `E11000`. Si este falso no lo lanzara, los tests pasarían y el
 * reintento —la única defensa contra el choque— no estaría probado.
 */
function mongoFalso(docs: any[]) {
  const col = {
    findOne: vi.fn(async (filtro: any) => {
      if (filtro.codigoCorto !== undefined) {
        return docs.find((d) => d.codigoCorto === filtro.codigoCorto) || null;
      }
      return docs.find((d) => d.id === filtro.id) || null;
    }),
    updateOne: vi.fn(async (filtro: any, cambio: any) => {
      const doc = docs.find((d) => d.id === filtro.id);
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      // El `$or` del filtro: sólo escribe si sigue sin código.
      if (filtro.$or && doc.codigoCorto) return { matchedCount: 0, modifiedCount: 0 };
      const nuevo = cambio.$set.codigoCorto;
      if (docs.some((d) => d !== doc && d.codigoCorto === nuevo)) {
        const err: any = new Error(`E11000 duplicate key error: codigoCorto "${nuevo}"`);
        err.code = 11000;
        throw err;
      }
      Object.assign(doc, cambio.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    }),
  };
  return { db: { collection: () => col }, col, docs };
}

describe('alfabeto', () => {
  it('no contiene los caracteres que se confunden al teclear', () => {
    for (const c of ['I', 'L', 'O', 'U']) expect(ALFABETO).not.toContain(c);
  });

  it('no repite caracteres', () => {
    expect(new Set(ALFABETO).size).toBe(ALFABETO.length);
  });
});

describe('generarCodigo', () => {
  it('sale con el largo pactado y sólo con el alfabeto', () => {
    for (let i = 0; i < 200; i++) {
      const c = generarCodigo();
      expect(c).toHaveLength(LARGO_CODIGO);
      for (const ch of c) expect(ALFABETO).toContain(ch);
    }
  });

  it('lo que genera siempre se puede volver a leer', () => {
    for (let i = 0; i < 200; i++) {
      const c = generarCodigo();
      expect(normalizarCodigo(c)).toBe(c);
    }
  });

  it('no se repite en la práctica', () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 2000; i++) vistos.add(generarCodigo());
    // Con 32^6 combinaciones, 2000 tiradas casi nunca chocan. Si esto baja
    // mucho, el generador perdió entropía.
    expect(vistos.size).toBeGreaterThan(1990);
  });
});

describe('normalizarCodigo', () => {
  it('acepta minúsculas, espacios y guiones', () => {
    expect(normalizarCodigo('k7m2qx')).toBe('K7M2QX');
    expect(normalizarCodigo(' K7M2QX ')).toBe('K7M2QX');
    expect(normalizarCodigo('K7M-2QX')).toBe('K7M2QX');
  });

  /**
   * El caso de verdad: el cliente lee la pantalla de un teléfono bloqueado y
   * escribe lo que cree ver. Si le rechazamos "O" cuando quisimos decir cero,
   * el código corto no sirvió para nada.
   */
  it('perdona las confusiones clásicas de lectura', () => {
    expect(normalizarCodigo('K7M2QO')).toBe('K7M2Q0');
    expect(normalizarCodigo('IK7M2Q')).toBe('1K7M2Q');
    expect(normalizarCodigo('LK7M2Q')).toBe('1K7M2Q');
  });

  it('rechaza largos distintos y basura', () => {
    expect(normalizarCodigo('K7M2Q')).toBeNull();
    expect(normalizarCodigo('K7M2QXZ')).toBeNull();
    expect(normalizarCodigo('')).toBeNull();
    expect(normalizarCodigo(null)).toBeNull();
    expect(normalizarCodigo('K7M2Q@')).toBeNull();
  });
});

describe('pareceCodigoCorto', () => {
  it('distingue un código de un token largo', () => {
    expect(pareceCodigoCorto('K7M2QX')).toBe(true);
    expect(pareceCodigoCorto('1781821344969.EtjT0JnF0b6NvnCdfKSjVhPz')).toBe(false);
  });

  it('un token largo nunca se confunde con un código', () => {
    expect(pareceCodigoCorto('fin-001.AbCdEfGhIjKlMnOpQrStUvWx')).toBe(false);
  });
});

describe('ultimos4 y cedulaCoincide', () => {
  it('saca los cuatro últimos dígitos ignorando el formato', () => {
    expect(ultimos4('1047123456')).toBe('3456');
    expect(ultimos4('1.047.123.456')).toBe('3456');
    expect(ultimos4('123')).toBeNull();
  });

  it('acepta los dígitos correctos', () => {
    expect(cedulaCoincide('1047123456', '3456')).toBe(true);
    expect(cedulaCoincide('1.047.123.456', '3456')).toBe(true);
  });

  it('rechaza los incorrectos y los mal formados', () => {
    expect(cedulaCoincide('1047123456', '3457')).toBe(false);
    expect(cedulaCoincide('1047123456', '456')).toBe(false);
    expect(cedulaCoincide('1047123456', '')).toBe(false);
    expect(cedulaCoincide('1047123456', null)).toBe(false);
    expect(cedulaCoincide(null, '3456')).toBe(false);
  });

  it('no se cae con una cédula corta', () => {
    expect(() => cedulaCoincide('12', '1234')).not.toThrow();
    expect(cedulaCoincide('12', '1234')).toBe(false);
  });
});

describe('controlDeIntentos', () => {
  it('deja pasar hasta el máximo y luego cierra', () => {
    const c = controlDeIntentos(5, 60_000);
    for (let i = 0; i < 5; i++) {
      expect(c.permite('K7M2QX')).toBe(true);
      c.fallo('K7M2QX');
    }
    expect(c.permite('K7M2QX')).toBe(false);
    expect(c.esperaMinutos('K7M2QX')).toBeGreaterThan(0);
  });

  /**
   * La razón de ser de todo esto: cuatro dígitos son 10.000 combinaciones y un
   * atacante con IPs de sobra las recorre en minutos. Contando por código, el
   * objetivo se cierra aunque cada intento llegue desde una IP distinta.
   */
  it('cierra el código aunque los intentos vengan de todas partes', () => {
    const c = controlDeIntentos(5, 60_000);
    for (let i = 0; i < 50; i++) c.fallo('K7M2QX');
    expect(c.permite('K7M2QX')).toBe(false);
  });

  it('cerrar un código no cierra los de los demás clientes', () => {
    const c = controlDeIntentos(5, 60_000);
    for (let i = 0; i < 10; i++) c.fallo('K7M2QX');
    expect(c.permite('K7M2QX')).toBe(false);
    expect(c.permite('ZZ9988')).toBe(true);
  });

  it('se abre solo al pasar la ventana', () => {
    let t = 1_000_000;
    const c = controlDeIntentos(5, 60_000, () => t);
    for (let i = 0; i < 5; i++) c.fallo('K7M2QX');
    expect(c.permite('K7M2QX')).toBe(false);
    t += 60_001;
    expect(c.permite('K7M2QX')).toBe(true);
    expect(c.esperaMinutos('K7M2QX')).toBe(0);
  });

  it('entrar bien borra los fallos anteriores', () => {
    const c = controlDeIntentos(5, 60_000);
    for (let i = 0; i < 4; i++) c.fallo('K7M2QX');
    c.exito('K7M2QX');
    for (let i = 0; i < 4; i++) {
      expect(c.permite('K7M2QX')).toBe(true);
      c.fallo('K7M2QX');
    }
    expect(c.permite('K7M2QX')).toBe(true);
  });
});

describe('asegurarCodigoCorto', () => {
  it('asigna uno al contrato que no tiene y lo guarda', async () => {
    const { db, docs } = mongoFalso([{ id: 'fin-1' }]);
    const codigo = await asegurarCodigoCorto(db, 'fin-1');
    expect(codigo).toBe(docs[0].codigoCorto);
    expect(normalizarCodigo(codigo)).toBe(codigo);
    expect(docs[0].codigoCortoDesde).toBeTruthy();
  });

  /**
   * El código se imprime en la pantalla de un equipo bloqueado. El cliente lo
   * apunta en un papel. Si en el siguiente bloqueo saliera otro, ese papel
   * dejaría de servir y nadie se lo habría avisado.
   */
  it('devuelve siempre el mismo y no lo vuelve a escribir', async () => {
    const { db, col, docs } = mongoFalso([{ id: 'fin-1' }]);
    const primero = await asegurarCodigoCorto(db, 'fin-1');
    const escrituras = col.updateOne.mock.calls.length;
    for (let i = 0; i < 5; i++) {
      expect(await asegurarCodigoCorto(db, 'fin-1')).toBe(primero);
    }
    expect(col.updateOne.mock.calls.length).toBe(escrituras);
    expect(docs[0].codigoCorto).toBe(primero);
  });

  it('lee el que ya estaba aunque venga en minúsculas', async () => {
    const { db } = mongoFalso([{ id: 'fin-1', codigoCorto: 'k7m2qx' }]);
    expect(await asegurarCodigoCorto(db, 'fin-1')).toBe('K7M2QX');
  });

  /**
   * La razón de ser del índice único y del reintento: dos bloqueos a la vez
   * pueden sacar el mismo código. Aquí se fuerza ese choque tres veces seguidas
   * y se exige que acabe asignando uno distinto, no que falle.
   */
  it('reintenta cuando el código ya es de otro cliente', async () => {
    const { db, docs } = mongoFalso([{ id: 'fin-1', codigoCorto: 'AAAAAA' }, { id: 'fin-2' }]);
    let n = 0;
    const generar = () => (++n <= 3 ? 'AAAAAA' : 'BBBBBB');
    const codigo = await asegurarCodigoCorto(db, 'fin-2', generar);
    expect(codigo).toBe('BBBBBB');
    expect(docs[1].codigoCorto).toBe('BBBBBB');
    // Y el del otro cliente quedó intacto.
    expect(docs[0].codigoCorto).toBe('AAAAAA');
  });

  it('se rinde en vez de colgarse si todo choca', async () => {
    const { db, docs } = mongoFalso([{ id: 'fin-1', codigoCorto: 'AAAAAA' }, { id: 'fin-2' }]);
    // Un generador averiado que devuelve siempre un código ya tomado. No puede
    // acabar en bucle infinito: el bloqueo del equipo espera esta respuesta.
    expect(await asegurarCodigoCorto(db, 'fin-2', () => 'AAAAAA')).toBeNull();
    expect(docs[1].codigoCorto).toBeUndefined();
  });

  it('no inventa nada si el contrato no existe o no hay base', async () => {
    const { db } = mongoFalso([{ id: 'fin-1' }]);
    expect(await asegurarCodigoCorto(db, 'fin-9')).toBeNull();
    expect(await asegurarCodigoCorto(null, 'fin-1')).toBeNull();
    expect(await asegurarCodigoCorto(db, '')).toBeNull();
  });
});

describe('buscarPorCodigo', () => {
  it('encuentra al dueño del código', async () => {
    const { db } = mongoFalso([{ id: 'fin-1', codigoCorto: 'K7M2QX', nombre: 'Ana' }]);
    expect((await buscarPorCodigo(db, 'K7M2QX'))?.nombre).toBe('Ana');
  });

  /**
   * El caso real: el cliente lee un cero en la pantalla y teclea la letra O.
   * Si la búsqueda no normalizara, ese cliente no encontraría su cuenta nunca.
   */
  it('encuentra igual con las confusiones de lectura', async () => {
    const { db } = mongoFalso([{ id: 'fin-1', codigoCorto: 'K7M2Q0', nombre: 'Ana' }]);
    expect((await buscarPorCodigo(db, 'k7m2qo'))?.nombre).toBe('Ana');
    expect((await buscarPorCodigo(db, 'K7M-2QO'))?.nombre).toBe('Ana');
  });

  it('no devuelve nada con basura ni sin base', async () => {
    const { db } = mongoFalso([{ id: 'fin-1', codigoCorto: 'K7M2QX' }]);
    expect(await buscarPorCodigo(db, 'ZZZZZZ')).toBeNull();
    expect(await buscarPorCodigo(db, 'corto')).toBeNull();
    expect(await buscarPorCodigo(db, '')).toBeNull();
    expect(await buscarPorCodigo(db, null)).toBeNull();
    expect(await buscarPorCodigo(null, 'K7M2QX')).toBeNull();
  });
});
