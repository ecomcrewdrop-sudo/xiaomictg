// @vitest-environment node
/**
 * Contrato de petición contra la API HBM de Trustonic.
 *
 * Todavía no tenemos credenciales del proveedor, así que no se puede probar
 * contra su servidor. Lo que sí se puede garantizar es que el día que lleguen,
 * la integración saldrá correcta: se levanta un servidor local, se apunta
 * TRUSTONIC_BASE_URL a él y se compara lo que emite el adaptador con los
 * cuerpos EXACTOS de la colección de Postman que entregó el proveedor
 * ("Implementación ZT.postman_collection").
 *
 * Si alguien renombra un campo o cambia un valor por defecto, esto falla aquí
 * en lugar de fallar con un teléfono de un cliente real.
 *
 * El entorno es node y no jsdom (el de vitest.config.ts) porque esto prueba
 * código de servidor: necesita http.createServer y el fetch de Node.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

interface PeticionCapturada {
  url?: string;
  auth?: string;
  contentType?: string;
  cuerpo: any;
}

/** El adaptador se importa de forma dinámica: lee process.env al cargarse. */
type Adaptador = typeof import('../../server/trustonic');

const capturadas: PeticionCapturada[] = [];
let servidor: http.Server;
let t: Adaptador;

beforeAll(async () => {
  servidor = http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (c) => (cuerpo += c));
    req.on('end', () => {
      capturadas.push({
        url: req.url,
        auth: req.headers.authorization,
        contentType: req.headers['content-type'],
        cuerpo: cuerpo ? JSON.parse(cuerpo) : null,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ resultado: 'ok' }));
    });
  });

  await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo));
  const { port } = servidor.address() as AddressInfo;

  process.env.TRUSTONIC_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.TRUSTONIC_TOKEN = 'token-de-prueba';
  t = await import('../../server/trustonic');
});

afterAll(async () => {
  await new Promise<void>((listo) => servidor.close(() => listo()));
});

/** Ejecuta una operación y devuelve la única petición que debió salir. */
async function capturar(operacion: () => Promise<any>) {
  capturadas.length = 0;
  const respuesta = await operacion();
  expect(capturadas).toHaveLength(1);
  return { respuesta, peticion: capturadas[0] };
}

describe('adaptador Trustonic HBM', () => {
  it('toda la API va a POST /v1/hbm con el Bearer del servidor', async () => {
    const { respuesta, peticion } = await capturar(() =>
      t.consultarDispositivos(['354712521531030'])
    );

    expect(respuesta.ok).toBe(true);
    expect(peticion.url).toBe('/v1/hbm');
    expect(peticion.auth).toBe('Bearer token-de-prueba');
    expect(peticion.contentType).toContain('application/json');
  });

  // Cada caso es el cuerpo literal de la colección del proveedor.
  const casos: Array<{ nombre: string; ejecutar: () => Promise<any>; esperado: unknown }> = [
    {
      nombre: 'Paso 1/4 - QUERY_DEVICES',
      ejecutar: () => t.consultarDispositivos(['354712521531030']),
      esperado: {
        service: { code: 'QUERY_DEVICES', variant: 'A' },
        data: { deviceList: [{ deviceUid: '354712521531030' }] },
      },
    },
    {
      nombre: 'Paso 2 - INVENTORY_UPLOAD',
      ejecutar: () => t.cargarInventario(['351947257924263']),
      esperado: {
        service: { code: 'INVENTORY_UPLOAD', variant: 'A' },
        data: {
          deviceList: [
            { deviceType: 'smartphone', idType: 'imei', deviceUid: '351947257924263' },
          ],
        },
      },
    },
    {
      nombre: 'Paso 3 - SERVICE_ACTIVATE',
      ejecutar: () => t.activarFinanciamiento(['351847821412185']),
      esperado: {
        service: { code: 'SERVICE_ACTIVATE', variant: 'A' },
        data: {
          deviceList: [
            {
              deviceUid: '351847821412185',
              serviceList: [{ serviceName: 'deviceFinancing', paymentMethod: 'postpaid' }],
            },
          ],
        },
      },
    },
    {
      nombre: 'DEVICE_LOCK',
      ejecutar: () =>
        t.bloquear('3500000000000001', 'Telefono bloqueado', 'Equipo bloqueado por falta de pago.'),
      esperado: {
        service: { code: 'DEVICE_LOCK', variant: 'A' },
        data: {
          lockList: [
            {
              deviceUid: '3500000000000001',
              lockType: 'lock',
              lockMsgTitle: 'Telefono bloqueado',
              lockMsgContent: 'Equipo bloqueado por falta de pago.',
            },
          ],
        },
      },
    },
    {
      nombre: 'DEVICE_UNLOCK',
      ejecutar: () => t.desbloquear('1234567890098765'),
      esperado: {
        service: { code: 'DEVICE_UNLOCK', variant: 'A' },
        data: { unLockList: [{ deviceUid: '1234567890098765' }] },
      },
    },
    {
      nombre: 'DEVICE_PIN_UNLOCK',
      ejecutar: () => t.desbloquearConPin('350000000000001', '12345678'),
      esperado: {
        service: { code: 'DEVICE_PIN_UNLOCK', variant: 'A' },
        data: { pinUnlockList: [{ deviceUid: '350000000000001', challenge: '12345678' }] },
      },
    },
    {
      nombre: 'DEVICE_NOTIFY',
      ejecutar: () =>
        t.notificar('350000000000001', 'Proximo pago', 'Se aproxima tu fecha de pago'),
      esperado: {
        service: { code: 'DEVICE_NOTIFY', variant: 'A' },
        data: {
          messageList: [
            {
              deviceUid: '350000000000001',
              notificationTitle: 'Proximo pago',
              notificationType: 'headsup',
              notificationContent: 'Se aproxima tu fecha de pago',
            },
          ],
        },
      },
    },
    {
      nombre: 'DEVICE_LOCK_MESSAGE',
      ejecutar: () =>
        t.mensajeEnBloqueo(
          '350000000000001',
          'Tienes un pago vencido',
          'Desbloquea tu equipo haz tu pago.'
        ),
      esperado: {
        service: { code: 'DEVICE_LOCK_MESSAGE', variant: 'A' },
        data: {
          lockMessageList: [
            {
              deviceUid: '350000000000001',
              messageTitle: 'Tienes un pago vencido',
              messageContent: 'Desbloquea tu equipo haz tu pago.',
            },
          ],
        },
      },
    },
    {
      nombre: 'DEVICE_RELEASE',
      ejecutar: () => t.liberar('350000000000001', 'End of contract'),
      esperado: {
        service: { code: 'DEVICE_RELEASE', variant: 'A' },
        data: {
          deviceReleaseList: [{ deviceUid: '350000000000001', reason: 'End of contract' }],
        },
      },
    },
  ];

  it.each(casos)('$nombre emite el cuerpo de la colección', async ({ ejecutar, esperado }) => {
    const { respuesta, peticion } = await capturar(ejecutar);
    expect(respuesta.ok).toBe(true);
    // toEqual compara por estructura, así que el orden de las claves no importa.
    expect(peticion.cuerpo).toEqual(esperado);
  });
});

describe('validación de IMEI', () => {
  // Los cuatro IMEI reales de enrolamiento que venían en la colección.
  it.each(['354712521531030', '351947257924263', '351847821412185', '350182150759191'])(
    'acepta el IMEI real %s',
    (imei) => expect(t.imeiValido(imei)).toBe(true)
  );

  it('rechaza un IMEI con un dígito mal tecleado', () => {
    // 354712521531030 es válido; cambiar un dígito rompe el Luhn. Esto importa:
    // un IMEI mal escrito no da error, da el equipo EQUIVOCADO.
    expect(t.imeiValido('354712521531031')).toBe(false);
  });

  it('rechaza lo que no sea 14-17 dígitos', () => {
    for (const malo of ['', '123', 'abcdefghijklmno', '3547125215310301234', null, undefined]) {
      expect(t.imeiValido(malo)).toBe(false);
    }
  });

  it('acepta deviceUid de 16 dígitos sin exigir Luhn', () => {
    // La colección usa deviceUid de 16 dígitos en varios ejemplos y no sabemos
    // si el proveedor admite números de serie además de IMEI.
    expect(t.imeiValido('1234567890098765')).toBe(true);
  });
});

describe('enmascarado de IMEI para los logs', () => {
  it('oculta el centro del número', () => {
    expect(t.enmascararImei('351947257924263')).toBe('35194725****263');
  });

  it('no filtra nada cuando el valor es demasiado corto', () => {
    expect(t.enmascararImei('123')).toBe('***');
    expect(t.enmascararImei(null)).toBe('***');
  });
});

describe('sin credenciales configuradas', () => {
  /**
   * Se importa el módulo en un registro limpio y con el entorno vacío, porque
   * BASE_URL y TOKEN se leen una sola vez al cargar. Lo que se comprueba es que
   * degrade con un error legible en lugar de lanzar: quien llama es una ruta del
   * panel, y un throw se convertiría en un 500 sin explicación para el admin.
   */
  it('devuelve un error claro y no lanza', async () => {
    const base = process.env.TRUSTONIC_BASE_URL;
    const token = process.env.TRUSTONIC_TOKEN;
    process.env.TRUSTONIC_BASE_URL = '';
    process.env.TRUSTONIC_TOKEN = '';

    try {
      capturadas.length = 0;
      vi.resetModules();
      const sinConfig: Adaptador = await import('../../server/trustonic');

      expect(sinConfig.trustonicConfigurado()).toBe(false);

      const r = await sinConfig.consultarDispositivos(['354712521531030']);
      expect(r.ok).toBe(false);
      expect(r.status).toBe(0);
      expect(r.error).toMatch(/no está configurado/);
      // Y sobre todo: no salió ninguna petición a ningún sitio.
      expect(capturadas).toHaveLength(0);
    } finally {
      process.env.TRUSTONIC_BASE_URL = base;
      process.env.TRUSTONIC_TOKEN = token;
      vi.resetModules();
    }
  });
});
