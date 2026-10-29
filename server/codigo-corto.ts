/**
 * Códigos cortos para la pantalla de bloqueo.
 *
 * El problema que resuelven: cuando bloqueamos un equipo, lo único que el
 * cliente puede leer es un texto plano en la pantalla (el API del proveedor sólo
 * acepta `lockMsgTitle` y `lockMsgContent`; no hay botones ni enlaces). El link
 * normal del portal mide ~95 caracteres y termina en una firma de 24, así que
 * pedirle a alguien que lo copie a otro teléfono es pedirle que no pague.
 *
 * El trato que hacemos: el código corto IDENTIFICA, la cédula AUTENTICA. Seis
 * caracteres son adivinables —ese es justamente el punto, para que se puedan
 * teclear—, así que por sí solos no abren nada. Sin los cuatro últimos dígitos
 * de la cédula no se ve ni el nombre del titular.
 */

import { randomBytes, timingSafeEqual } from 'crypto';

/**
 * Crockford base32: los dígitos y las letras menos I, L, O y U.
 *
 * No es decoración. Quien teclea esto lo está leyendo de la pantalla rajada de
 * un teléfono bloqueado y lo escribe en otro aparato: I contra 1 y O contra 0 es
 * exactamente el error que iba a cometer. Al quedar fuera del alfabeto, podemos
 * ACEPTARLOS como sinónimos al normalizar en vez de rechazar al cliente. La U se
 * excluye además porque es la que convierte un código aleatorio en una grosería.
 */
export const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 32^6 ≈ 1.073 millones de combinaciones. */
export const LARGO_CODIGO = 6;

/**
 * Secuencias que no queremos ver impresas en el teléfono de un cliente al que
 * acabamos de bloquear. Son pocas y cortas a propósito: esto no pretende ser un
 * filtro de groserías completo, sólo evitar el accidente evidente en español.
 */
const FEAS = ['PUT', 'KUL', 'CAG', 'MRD', 'TET', 'ANO', 'CUL', 'PEN', 'ZRR'];

function esFea(codigo: string): boolean {
  return FEAS.some((f) => codigo.includes(f));
}

/** Un código nuevo. Reintenta si sale algo impresentable. */
export function generarCodigo(bytes: (n: number) => Buffer = randomBytes): string {
  for (let intento = 0; intento < 20; intento++) {
    const crudo = bytes(LARGO_CODIGO);
    let codigo = '';
    for (let i = 0; i < LARGO_CODIGO; i++) {
      codigo += ALFABETO[crudo[i] % ALFABETO.length];
    }
    if (!esFea(codigo)) return codigo;
  }
  // 20 intentos fallidos es estadísticamente imposible; si pasa, preferimos un
  // código feo a quedarnos sin código y dejar al cliente sin forma de pagar.
  return ALFABETO[0].repeat(LARGO_CODIGO);
}

/**
 * Deja lo que tecleó el cliente en forma canónica, o `null` si no puede serlo.
 *
 * Perdona lo que un humano hace de verdad: minúsculas, espacios, guiones, y las
 * confusiones I/1, L/1, O/0. No perdona una longitud distinta, porque eso ya no
 * es un error de lectura sino otro dato.
 */
export function normalizarCodigo(entrada: unknown): string | null {
  const limpio = String(entrada ?? '')
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  if (limpio.length !== LARGO_CODIGO) return null;
  for (const c of limpio) if (!ALFABETO.includes(c)) return null;
  return limpio;
}

/**
 * ¿Esto que viene en la URL parece un código corto y no un token largo?
 *
 * Los tokens largos son `id.firma` y siempre llevan un punto; los códigos nunca.
 * Esa es toda la diferencia que necesita la ruta para saber a cuál de las dos
 * puertas mandar a quien llega.
 */
export function pareceCodigoCorto(valor: unknown): boolean {
  const s = String(valor ?? '');
  return !s.includes('.') && normalizarCodigo(s) !== null;
}

/** Los cuatro últimos dígitos de una cédula, ignorando puntos y espacios. */
export function ultimos4(cedula: unknown): string | null {
  const digitos = String(cedula ?? '').replace(/\D/g, '');
  return digitos.length >= 4 ? digitos.slice(-4) : null;
}

/**
 * ¿Los cuatro dígitos que tecleó coinciden con los de su cédula?
 *
 * Comparación en tiempo constante. Con sólo 10.000 combinaciones el ataque real
 * es la fuerza bruta, no el cronómetro —de eso se encarga `controlDeIntentos`—,
 * pero comparar con `===` aquí sería dejar escrito el hábito equivocado en el
 * único sitio del portal donde se verifica un secreto del cliente.
 */
export function cedulaCoincide(cedula: unknown, intento: unknown): boolean {
  const real = ultimos4(cedula);
  const dado = String(intento ?? '').replace(/\D/g, '');
  if (!real || dado.length !== 4) return false;
  return timingSafeEqual(Buffer.from(real), Buffer.from(dado));
}

/* ═══════════════════════  Freno a la fuerza bruta  ═══════════════════════ */

export interface ControlDeIntentos {
  /** Llamar ANTES de verificar. `false` = ya no se le acepta nada por ahora. */
  permite(codigo: string): boolean;
  /** Llamar cuando la cédula no coincide. */
  fallo(codigo: string): void;
  /** Llamar cuando entra bien, para que el contador no lo persiga después. */
  exito(codigo: string): void;
  /** Minutos que le faltan para volver a intentar. 0 si puede ahora. */
  esperaMinutos(codigo: string): number;
}

/**
 * Cuenta por CÓDIGO, no por IP.
 *
 * Esto es deliberado y es la pieza que sostiene todo el diseño. Un atacante con
 * muchas IPs recorre las 10.000 combinaciones de cuatro dígitos sin despeinarse
 * si el freno fuera por IP; contando por código, el objetivo se cierra a los
 * cinco intentos venga de donde venga. El límite por IP sigue puesto encima,
 * para el que prefiera probar muchos códigos en vez de muchas cédulas.
 *
 * El coste es que alguien podría dejar fuera a un cliente concreto a propósito.
 * Por eso el bloqueo dura 15 minutos y no es permanente, y por eso el mensaje
 * que ve el cliente le ofrece el teléfono de la tienda: el camino humano nunca
 * se cierra.
 */
export function controlDeIntentos(
  maximo = 5,
  ventanaMs = 15 * 60_000,
  ahora: () => number = Date.now
): ControlDeIntentos {
  const registro = new Map<string, { fallos: number; desde: number }>();

  function vigente(codigo: string) {
    const d = registro.get(codigo);
    if (!d) return null;
    if (ahora() - d.desde > ventanaMs) {
      registro.delete(codigo);
      return null;
    }
    return d;
  }

  return {
    permite(codigo) {
      const d = vigente(codigo);
      return !d || d.fallos < maximo;
    },
    fallo(codigo) {
      const d = vigente(codigo);
      if (d) d.fallos += 1;
      else registro.set(codigo, { fallos: 1, desde: ahora() });
    },
    exito(codigo) {
      registro.delete(codigo);
    },
    esperaMinutos(codigo) {
      const d = vigente(codigo);
      if (!d || d.fallos < maximo) return 0;
      return Math.max(1, Math.ceil((ventanaMs - (ahora() - d.desde)) / 60_000));
    },
  };
}

/* ═══════════════════  Dónde vive el código de cada cliente  ═══════════════ */

/**
 * El código se guarda en el propio documento de `financing`, no en una colección
 * aparte.
 *
 * Una colección de "códigos → financiamiento" haría falta si un financiamiento
 * pudiera tener varios códigos o si caducaran. No es el caso: es uno por
 * contrato y vive lo que vive el contrato. Con el campo dentro del documento, el
 * código viaja con el registro en cualquier backup o exportación y no puede
 * quedar huérfano de su contrato ni al contrario.
 *
 * `db` entra por parámetro en vez de importarse para que todo esto se pueda
 * probar con un objeto falso, igual que el resto del módulo.
 */
const COL_FINANCING = 'financing';

/**
 * El índice único que hace de árbitro.
 *
 * `partialFilterExpression` con `$type: 'string'` es la parte importante: sin
 * ella, el índice único trataría a los 112 documentos todavía sin código como
 * 112 repeticiones del valor `null` y rechazaría todos menos el primero.
 *
 * Y es ÚNICO porque la unicidad no se puede sostener leyendo antes de escribir:
 * dos bloqueos simultáneos pueden generar el mismo código y los dos ver la
 * colección limpia. El índice es el único sitio donde esa carrera se decide, y
 * el `E11000` que devuelve es la señal de reintentar.
 */
export async function asegurarIndiceCodigo(db: any): Promise<void> {
  if (!db) return;
  try {
    await db.collection(COL_FINANCING).createIndex(
      { codigoCorto: 1 },
      { unique: true, partialFilterExpression: { codigoCorto: { $type: 'string' } }, name: 'codigoCorto_unico' }
    );
  } catch (error) {
    // No es fatal: sin índice el sistema sigue funcionando y la probabilidad de
    // choque es ~1 en 1.07 millones. Pero hay que verlo en los logs, porque es
    // la diferencia entre "improbable" y "imposible".
    console.error('[codigo-corto] No se pudo crear el índice único de codigoCorto:', error);
  }
}

/**
 * El código de este financiamiento, creándolo la primera vez que se pide.
 *
 * Perezoso a propósito: no hay migración que recorra los 112 contratos. El
 * código aparece cuando hace falta —al bloquear o al mandar un recordatorio— y
 * a partir de ahí es estable. Un contrato que nunca se bloquea nunca gasta un
 * código, y no hay un paso de despliegue que pueda quedarse a medias.
 *
 * Devuelve `null` si no se pudo: quien llama tiene que poder seguir sin código
 * (el bloqueo debe ocurrir igual, con el teléfono de la tienda como salida).
 */
export async function asegurarCodigoCorto(
  db: any,
  financingId: string,
  generar: () => string = generarCodigo
): Promise<string | null> {
  if (!db || !financingId) return null;
  const col = db.collection(COL_FINANCING);

  try {
    const doc = await col.findOne({ id: financingId }, { projection: { codigoCorto: 1 } });
    if (!doc) return null;
    const ya = normalizarCodigo(doc.codigoCorto);
    if (ya) return ya;

    // Sólo escribe si SIGUE sin código. Si otra petición se adelantó, el
    // `modifiedCount` sale 0 y nos quedamos con el que ganó: el código de un
    // cliente no puede cambiar porque dos procesos lo pidieran a la vez.
    const sinCodigo = {
      id: financingId,
      $or: [{ codigoCorto: { $exists: false } }, { codigoCorto: null }, { codigoCorto: '' }],
    };

    for (let intento = 0; intento < 8; intento++) {
      const codigo = generar();
      try {
        const r = await col.updateOne(sinCodigo, {
          $set: { codigoCorto: codigo, codigoCortoDesde: new Date().toISOString() },
        });
        if (r?.modifiedCount) return codigo;
        // El filtro no encajó: otra petición le puso código en el intervalo.
        // Gana el suyo.
        const otro = await col.findOne({ id: financingId }, { projection: { codigoCorto: 1 } });
        return normalizarCodigo(otro?.codigoCorto);
      } catch (error: any) {
        // 11000 = el código ya es de otro contrato. Se tira otro y se repite.
        if (error?.code === 11000 || /E11000/.test(String(error?.message || ''))) continue;
        throw error;
      }
    }

    console.error(`[codigo-corto] Ocho choques seguidos asignando código a ${financingId}.`);
    return null;
  } catch (error) {
    console.error('[codigo-corto] Error asegurando el código corto:', error);
    return null;
  }
}

/**
 * El financiamiento dueño de un código, o `null`.
 *
 * Normaliza antes de buscar para que lo que se consulta sea exactamente lo que
 * se guardó: si el cliente escribió "k7m2qo" leyendo un cero como O, aquí ya
 * llega convertido en `K7M2Q0`.
 */
export async function buscarPorCodigo(db: any, codigoCrudo: unknown): Promise<any | null> {
  const codigo = normalizarCodigo(codigoCrudo);
  if (!db || !codigo) return null;
  try {
    return await db.collection(COL_FINANCING).findOne({ codigoCorto: codigo });
  } catch (error) {
    console.error('[codigo-corto] Error buscando por código:', error);
    return null;
  }
}
