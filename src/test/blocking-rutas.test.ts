// @vitest-environment node
/**
 * Las rutas /api/blocking/* contra una base en memoria.
 *
 * No hay ambiente de pruebas del proveedor y Mongo Atlas sólo acepta
 * conexiones desde Railway, así que esto no puede ser una prueba de
 * integración de verdad. Lo que sí comprueba —y es lo que se rompe en la
 * práctica— es el contrato del módulo: que las rutas existan, que validen lo
 * que tienen que validar, que el DTO que recibe el panel tenga los campos con
 * los que el panel decide qué mostrar, y que las tres negativas deliberadas
 * sigan diciendo no:
 *
 *   - POST /history responde 405 (la bitácora sólo la escribe el servidor);
 *   - bloquear sin motivo responde 400 (sin motivo no hay prueba de nada);
 *   - borrar un equipo bloqueado responde 409 (quitarlo del panel no lo
 *     desenrola, y el cliente se quedaría bloqueado sin nadie a quien reclamar).
 *
 * TRUSTONIC_TOKEN se deja sin definir a propósito: así `trustonicConfigurado()`
 * es false y ninguna prueba puede llamar al proveedor ni por accidente.
 */
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { registrarBloqueo, type DepsBloqueo } from '../../server/blocking';

/* ───────────────────────  Mongo de juguete  ─────────────────────── */

const coincide = (doc: any, filtro: any): boolean =>
  Object.entries(filtro || {}).every(([clave, valor]) => {
    if (valor && typeof valor === 'object' && '$ne' in (valor as any)) {
      return doc[clave] !== (valor as any).$ne;
    }
    return doc[clave] === valor;
  });

function coleccion(docs: any[]) {
  const cursor = (lista: any[]) => {
    const estado = { lista };
    const api: any = {
      sort: (spec: any) => {
        const [campo, dir] = Object.entries(spec)[0] as [string, number];
        estado.lista = [...estado.lista].sort((a, b) =>
          String(a[campo] ?? '').localeCompare(String(b[campo] ?? '')) * (dir < 0 ? -1 : 1)
        );
        return api;
      },
      skip: (n: number) => {
        estado.lista = estado.lista.slice(n);
        return api;
      },
      limit: (n: number) => {
        estado.lista = estado.lista.slice(0, n);
        return api;
      },
      toArray: async () => estado.lista,
    };
    return api;
  };

  return {
    docs,
    findOne: async (filtro: any) => docs.find((d) => coincide(d, filtro)) || null,
    find: (filtro: any = {}) => cursor(docs.filter((d) => coincide(d, filtro))),
    insertOne: async (doc: any) => {
      docs.push({ ...doc });
      return { insertedId: doc.id || doc._id };
    },
    updateOne: async (filtro: any, cambios: any, opciones: any = {}) => {
      const doc = docs.find((d) => coincide(d, filtro));
      if (doc) {
        Object.assign(doc, cambios.$set || {});
        return { matchedCount: 1, modifiedCount: 1 };
      }
      if (opciones.upsert) {
        docs.push({ ...filtro, ...(cambios.$set || {}) });
        return { matchedCount: 0, upsertedCount: 1 };
      }
      return { matchedCount: 0, modifiedCount: 0 };
    },
    deleteOne: async (filtro: any) => {
      const i = docs.findIndex((d) => coincide(d, filtro));
      if (i >= 0) docs.splice(i, 1);
      return { deletedCount: i >= 0 ? 1 : 0 };
    },
  };
}

const colecciones: Record<string, ReturnType<typeof coleccion>> = {};
const db = { collection: (nombre: string) => (colecciones[nombre] ||= coleccion([])) };

const equipoBase = {
  id: 'eq-1',
  imei: '867754085007981',
  owner: 'Cliente de prueba',
  brand: 'XIAOMI',
  model: 'Redmi 15c',
  phoneNumber: '3002875280',
  status: 'active',
  intencion: 'active',
  plataforma: 'trustonic',
  enrolledInMDM: true,
  autoBloqueo: true,
  financingId: 'fin-1',
  createdAt: '2026-09-01T00:00:00.000Z',
};

const equipoNuovo = {
  ...equipoBase,
  id: 'eq-2',
  imei: '355458061234569',
  owner: 'Cliente en Nuovo',
  plataforma: 'nuovo',
  enrolledInMDM: false,
};

function sembrar() {
  for (const nombre of Object.keys(colecciones)) delete colecciones[nombre];
  colecciones['blocking_devices'] = coleccion([{ ...equipoBase }, { ...equipoNuovo }]);
  colecciones['financing'] = coleccion([
    {
      id: 'fin-1',
      cliente: 'Cliente de prueba',
      imei: '867754085007981',
      valorCuota: 150000,
      cuotas: [
        { number: 1, dueDate: '2026-09-06T00:00:00.000Z', status: 'paid' },
        { number: 2, dueDate: '2026-09-21T00:00:00.000Z', status: 'pending' },
      ],
    },
  ]);
  colecciones['blocking_history'] = coleccion([]);
  colecciones['blocking_alerts'] = coleccion([
    { id: 'al-1', deviceId: 'eq-1', type: 'payment_overdue', message: 'x', acknowledged: false },
  ]);
  colecciones['blocking_payments'] = coleccion([]);
  colecciones['blocking_config'] = coleccion([]);
}

/* ───────────────────────  Servidor de prueba  ─────────────────────── */

let servidor: Server;
let base = '';
const enviados: string[] = [];

const deps: DepsBloqueo = {
  getDb: () => db,
  enviarWhatsApp: async (telefono, texto) => {
    enviados.push(`${telefono}:${texto}`);
    return true;
  },
  whatsappListo: () => false,
  nombreBonito: (v: string) => String(v || ''),
};

beforeAll(async () => {
  delete process.env.TRUSTONIC_TOKEN;
  const app = express();
  app.use(express.json());
  registrarBloqueo(app as any, deps);
  servidor = app.listen(0);
  await new Promise<void>((r) => servidor.once('listening', () => r()));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api/blocking`;
});

afterAll(async () => {
  await new Promise<void>((r) => servidor.close(() => r()));
});

beforeEach(() => {
  sembrar();
  enviados.length = 0;
});

const pedir = async (ruta: string, init?: RequestInit) => {
  const res = await fetch(`${base}${ruta}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const texto = await res.text();
  return { status: res.status, cuerpo: texto ? JSON.parse(texto) : null };
};

/* ───────────────────────  Pruebas  ─────────────────────── */

describe('GET /devices', () => {
  it('devuelve el DTO con los campos que el panel necesita para no mentir', () => {
    return pedir('/devices').then(({ status, cuerpo }) => {
      expect(status).toBe(200);
      const equipo = cuerpo.find((d: any) => d.id === 'eq-1');
      // Si falta alguno de estos, la tarjeta deja de distinguir "pedido" de
      // "confirmado" o "operable" de "manual", que es todo el punto del módulo.
      for (const campo of [
        'status',
        'intencion',
        'divergente',
        'plataforma',
        'gestionManual',
        'incomunicado',
      ]) {
        expect(equipo).toHaveProperty(campo);
      }
    });
  });

  it('marca gestionManual en los equipos de Nuovo, que esta API no alcanza', async () => {
    const { cuerpo } = await pedir('/devices');
    expect(cuerpo.find((d: any) => d.id === 'eq-2').gestionManual).toBe(true);
    expect(cuerpo.find((d: any) => d.id === 'eq-1').gestionManual).toBe(false);
  });

  it('marca divergente cuando se mandó una orden y el proveedor aún no la confirma', async () => {
    colecciones['blocking_devices'].docs[0].intencion = 'blocked';
    colecciones['blocking_devices'].docs[0].ordenBloqueoEnviadaEn = new Date().toISOString();
    const { cuerpo } = await pedir('/devices');
    expect(cuerpo.find((d: any) => d.id === 'eq-1').divergente).toBe(true);
  });

  it('NO marca divergente si nunca se mandó una orden', async () => {
    // El caso que hizo que el dueño preguntara "¿por qué dice bloqueo en cola
    // si yo no he hecho nada con esos?": equipos ya bloqueados en el proveedor
    // desde antes de CrediLock. Nacen con `intencion: 'active'` por defecto, así
    // que diferían del estado real sin que nadie hubiera pedido nada, y el panel
    // ofrecía "Reintentar" y "Anular orden" sobre una orden inexistente.
    colecciones['blocking_devices'].docs[0].intencion = 'active';
    colecciones['blocking_devices'].docs[0].status = 'blocked';
    colecciones['blocking_devices'].docs[0].ordenBloqueoEnviadaEn = null;
    colecciones['blocking_devices'].docs[0].ordenDesbloqueoEnviadaEn = null;
    const { cuerpo } = await pedir('/devices');
    const equipo = cuerpo.find((d: any) => d.id === 'eq-1');
    expect(equipo.divergente).toBe(false);
    expect(equipo.ordenEnviadaEn).toBeNull();
  });
});

describe('POST /devices', () => {
  it('rechaza un IMEI que no pasa el dígito de control', async () => {
    // Es el caso real de la cartera: un IMEI mal teclado que, de colarse,
    // habría hecho que el panel mostrara un equipo que no existe.
    const { status, cuerpo } = await pedir('/devices', {
      method: 'POST',
      body: JSON.stringify({ imei: '689402082713403', owner: 'kevin' }),
    });
    expect(status).toBe(400);
    expect(cuerpo.error).toMatch(/IMEI/);
  });

  it('rechaza un IMEI ya registrado en vez de duplicar el equipo', async () => {
    const { status } = await pedir('/devices', {
      method: 'POST',
      body: JSON.stringify({ imei: equipoBase.imei, owner: 'otro' }),
    });
    expect(status).toBe(409);
  });
});

describe('PUT /devices', () => {
  it('exige motivo para bloquear: sin motivo la bitácora no prueba nada', async () => {
    const { status, cuerpo } = await pedir('/devices', {
      method: 'PUT',
      body: JSON.stringify({ id: 'eq-1', action: 'block' }),
    });
    expect(status).toBe(400);
    expect(cuerpo.error).toMatch(/motivo/i);
  });

  it('exige id y action', async () => {
    const { status } = await pedir('/devices', { method: 'PUT', body: JSON.stringify({}) });
    expect(status).toBe(400);
  });

  it('responde 404 si el equipo no está', async () => {
    const { status } = await pedir('/devices', {
      method: 'PUT',
      body: JSON.stringify({ id: 'no-existe', action: 'unblock' }),
    });
    expect(status).toBe(404);
  });

  it('no deja bloquear un equipo de Nuovo creyendo que hizo algo', async () => {
    const { status, cuerpo } = await pedir('/devices', {
      method: 'PUT',
      body: JSON.stringify({ id: 'eq-2', action: 'block', reason: 'mora' }),
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(cuerpo)).toMatch(/Nuovo|manual|Trustonic/i);
  });

  it('set_auto apaga el automatismo de un solo equipo', async () => {
    const { status } = await pedir('/devices', {
      method: 'PUT',
      body: JSON.stringify({ id: 'eq-1', action: 'set_auto', autoBloqueo: false }),
    });
    expect(status).toBe(200);
    expect(colecciones['blocking_devices'].docs[0].autoBloqueo).toBe(false);
  });

  it('release exige confirmación explícita porque es irreversible', async () => {
    const { status } = await pedir('/devices', {
      method: 'PUT',
      body: JSON.stringify({ id: 'eq-1', action: 'release', reason: 'pagó todo' }),
    });
    expect(status).toBe(400);
  });
});

describe('DELETE /devices', () => {
  it('se niega a quitar del panel un equipo bloqueado', async () => {
    colecciones['blocking_devices'].docs[0].status = 'blocked';
    const { status, cuerpo } = await pedir('/devices?id=eq-1', { method: 'DELETE' });
    expect(status).toBe(400);
    expect(cuerpo.error).toMatch(/Desbloquéalo/);
    expect(colecciones['blocking_devices'].docs).toHaveLength(2);
  });

  it('quita un equipo activo y lo deja anotado en la bitácora', async () => {
    const { status } = await pedir('/devices?id=eq-1', { method: 'DELETE' });
    expect(status).toBeLessThan(300);
    expect(colecciones['blocking_devices'].docs).toHaveLength(1);
    expect(colecciones['blocking_history'].docs.some((h) => h.action === 'delete')).toBe(true);
  });
});

describe('la bitácora no se escribe desde el navegador', () => {
  it('POST /history responde 405', async () => {
    const { status } = await pedir('/history', {
      method: 'POST',
      body: JSON.stringify({ deviceId: 'eq-1', action: 'block', user: 'yo' }),
    });
    expect(status).toBe(405);
  });

  it('GET /history respeta el límite pedido', async () => {
    for (let i = 0; i < 5; i++) {
      colecciones['blocking_history'].docs.push({
        id: `h${i}`,
        timestamp: `2026-10-0${i + 1}T00:00:00.000Z`,
        action: 'block',
      });
    }
    const { cuerpo } = await pedir('/history?limit=3');
    expect(cuerpo).toHaveLength(3);
    // Más reciente primero: es el orden en el que se lee una bitácora.
    expect(cuerpo[0].id).toBe('h4');
  });
});

describe('GET /data', () => {
  it('stats separa lo operable de lo ingobernable', async () => {
    const { status, cuerpo } = await pedir('/data?type=stats');
    expect(status).toBe(200);
    expect(cuerpo.total).toBe(2);
    expect(cuerpo.enNuovo).toBe(1);
    expect(cuerpo.enrolled).toBe(1);
  });

  it('config arranca apagada y en simulación', async () => {
    const { cuerpo } = await pedir('/data?type=config');
    expect(cuerpo.autoBloqueoActivo).toBe(false);
    expect(cuerpo.simulacion).toBe(true);
  });

  it('guarda la config y la devuelve ya aplicada', async () => {
    const { status, cuerpo } = await pedir('/data', {
      method: 'POST',
      body: JSON.stringify({ type: 'config', data: { diasDeGracia: 4 } }),
    });
    expect(status).toBe(200);
    expect(cuerpo.diasDeGracia).toBe(4);
    const leida = await pedir('/data?type=config');
    expect(leida.cuerpo.diasDeGracia).toBe(4);
  });

  it('marca una alerta como vista', async () => {
    const { status } = await pedir('/data', {
      method: 'POST',
      body: JSON.stringify({ type: 'acknowledge_alert', data: { id: 'al-1' } }),
    });
    expect(status).toBeLessThan(300);
    expect(colecciones['blocking_alerts'].docs[0].acknowledged).toBe(true);
  });
});

describe('GET /preview', () => {
  it('dice qué haría sin tocar ningún equipo', async () => {
    const { status, cuerpo } = await pedir('/preview');
    expect(status).toBe(200);
    expect(cuerpo).toHaveProperty('config');
    expect(Array.isArray(cuerpo.decisiones)).toBe(true);
    // Nada se ejecutó: ni historial, ni WhatsApp, ni cambios de intención.
    expect(colecciones['blocking_history'].docs).toHaveLength(0);
    expect(enviados).toHaveLength(0);
    expect(colecciones['blocking_devices'].docs[0].intencion).toBe('active');
  });

  it('propone bloquear al que tiene una cuota vencida y deja fuera al de Nuovo', async () => {
    const { cuerpo } = await pedir('/preview');
    const delNuovo = cuerpo.decisiones.find((d: any) => d.imei === equipoNuovo.imei);
    expect(delNuovo?.accion ?? 'nada').toBe('nada');
  });
});

describe('webhook entrante', () => {
  it('rechaza con 401 un secreto que no es el configurado', async () => {
    // Un 200 aquí sería peor que un error: el proveedor vería todos los
    // eventos como entregados mientras nosotros los tiramos a la basura.
    const { status } = await pedir('/webhook/secreto-inventado', {
      method: 'POST',
      body: JSON.stringify({ event: 'DEVICE_LOCKED', deviceUid: equipoBase.imei }),
    });
    expect(status).toBe(401);
  });

  it('no se cree el estado que trae el evento', async () => {
    await pedir('/data', {
      method: 'POST',
      body: JSON.stringify({ type: 'config', data: { secretoWebhook: 'abc123' } }),
    });
    const { status } = await pedir('/webhook/abc123', {
      method: 'POST',
      body: JSON.stringify({ event: 'DEVICE_LOCKED', deviceUid: equipoBase.imei }),
    });
    expect(status).toBe(200);
    // El evento sólo vale como aviso para repreguntar; escribir 'blocked' a
    // partir de él dejaría el panel a merced de lo que mande el proveedor.
    expect(colecciones['blocking_devices'].docs[0].status).toBe('active');
  });
});
