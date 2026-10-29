import { API_ORIGIN } from '../api-base';
import type {
  Alert,
  ConfigBloqueo,
  Decision,
  Device,
  HistoryEntry,
  Payment,
  ResultadoAccion,
  Stats,
} from './types';

/**
 * Cliente de las rutas /api/blocking/* del panel.
 *
 * POR QUÉ FETCH Y NO AXIOS: el interceptor de autenticación de api-base.ts
 * parchea window.fetch para añadir el Bearer del administrador. Axios en el
 * navegador usa XMLHttpRequest, NO fetch, así que las llamadas con axios se
 * saltaban el interceptor, salían sin cabecera Authorization y el servidor las
 * rechazaba con 401 — y como abajo los errores devuelven null, el panel se
 * quedaba vacío sin decir por qué.
 */

const API_URL = `${API_ORIGIN}/api/blocking`;

/**
 * Base común. Separa "salió bien" de "trajo datos", porque no es lo mismo: un
 * DELETE correcto responde 204 sin cuerpo, y un 401 también llega sin cuerpo.
 * Si se mezclaran, borrar un equipo sin sesión parecería haber funcionado.
 */
async function ejecutar<T>(
  ruta: string,
  init: RequestInit = {}
): Promise<{ ok: boolean; datos: T | null }> {
  const metodo = init.method || 'GET';
  try {
    const cabeceras = new Headers(init.headers);
    if (init.body && !cabeceras.has('Content-Type')) {
      cabeceras.set('Content-Type', 'application/json');
    }

    const res = await fetch(`${API_URL}${ruta}`, { ...init, headers: cabeceras });

    if (!res.ok) {
      console.error(`[blocking] ${metodo} ${ruta} -> HTTP ${res.status}`);
      return { ok: false, datos: null };
    }

    const texto = await res.text();
    return { ok: true, datos: texto ? (JSON.parse(texto) as T) : null };
  } catch (error) {
    console.error(`[blocking] ${metodo} ${ruta} falló:`, error);
    return { ok: false, datos: null };
  }
}

/**
 * Devuelve null cuando algo falla, que es el contrato que esperan store.ts y
 * las pantallas. A diferencia de antes, el motivo real (401, 404, red) sí queda
 * en la consola: en un sistema que bloquea teléfonos, un fallo invisible es
 * peor que un error ruidoso.
 */
async function pedir<T>(ruta: string, init: RequestInit = {}): Promise<T | null> {
  const { datos } = await ejecutar<T>(ruta, init);
  return datos;
}

/** Para las operaciones en las que sólo interesa si se completó. */
async function pedirOk(ruta: string, init: RequestInit = {}): Promise<boolean> {
  const { ok } = await ejecutar(ruta, init);
  return ok;
}

/**
 * Igual que `ejecutar`, pero devuelve el mensaje que manda el servidor en vez
 * de un booleano.
 *
 * Es imprescindible aquí: el servidor no responde sólo "sí/no", responde cosas
 * como "orden aceptada, pero el equipo no reporta desde hace 72 h, entrará
 * cuando se conecte", o "este equipo está en Nuovo y esta API no lo alcanza".
 * Si el panel tradujera todo eso a un toast de "Dispositivo bloqueado", le
 * estaría mintiendo al dueño justo en lo que más importa.
 */
async function ejecutarConMensaje(
  ruta: string,
  init: RequestInit = {}
): Promise<ResultadoAccion> {
  const metodo = init.method || 'GET';
  try {
    const cabeceras = new Headers(init.headers);
    if (init.body && !cabeceras.has('Content-Type')) {
      cabeceras.set('Content-Type', 'application/json');
    }
    const res = await fetch(`${API_URL}${ruta}`, { ...init, headers: cabeceras });
    const texto = await res.text();
    let cuerpo: any = null;
    try {
      cuerpo = texto ? JSON.parse(texto) : null;
    } catch {
      cuerpo = null;
    }

    if (!res.ok) {
      console.error(`[blocking] ${metodo} ${ruta} -> HTTP ${res.status}`);
      return {
        ok: false,
        mensaje:
          cuerpo?.error ||
          (res.status === 401
            ? 'Tu sesión caducó. Vuelve a iniciar sesión.'
            : `El servidor respondió ${res.status}.`),
      };
    }

    return {
      ok: true,
      mensaje: cuerpo?.mensaje || 'Hecho.',
      pendienteDeEntrega: Boolean(cuerpo?.pendienteDeEntrega),
      equipo: cuerpo?.equipo ?? null,
    };
  } catch (error) {
    console.error(`[blocking] ${metodo} ${ruta} falló:`, error);
    return { ok: false, mensaje: 'No se pudo contactar con el servidor.' };
  }
}

/** PUT /devices con una acción concreta; es el patrón que usa todo el módulo. */
function accionDispositivo(body: Record<string, unknown>): Promise<ResultadoAccion> {
  return ejecutarConMensaje('/devices', { method: 'PUT', body: JSON.stringify(body) });
}

export const blockingApi = {
  getDevices() {
    return pedir<Device[]>('/devices');
  },

  /**
   * Con mensaje y no con `pedir`: el servidor distingue "IMEI no válido" de
   * "ese IMEI ya está registrado", y con un null el panel sólo podía decir
   * "revisa el IMEI" en los dos casos.
   */
  addDevice(device: any) {
    return ejecutarConMensaje('/devices', { method: 'POST', body: JSON.stringify(device) });
  },

  blockDevice(id: string, reason: string) {
    return accionDispositivo({ id, action: 'block', reason });
  },

  unblockDevice(id: string) {
    return accionDispositivo({ id, action: 'unblock' });
  },

  /** Aviso en la pantalla del equipo, sin bloquearlo. */
  notifyDevice(id: string, titulo: string, contenido: string) {
    return accionDispositivo({ id, action: 'notify', titulo, contenido });
  },

  /** Cambia el texto que se ve en un equipo YA bloqueado. */
  setLockMessage(id: string, titulo: string, contenido: string) {
    return accionDispositivo({ id, action: 'lock_message', titulo, contenido });
  },

  /**
   * Desbloqueo por PIN: el cliente paga pero el equipo no tiene datos, así que
   * lee un código en pantalla, llama a la tienda y se le devuelve el PIN.
   */
  pinUnlock(id: string, challenge: string) {
    return accionDispositivo({ id, action: 'pin_unlock', challenge });
  },

  /** Bloquea reseteo de fábrica, ADB y re-aprovisionamiento. */
  hardenDevice(id: string) {
    return accionDispositivo({ id, action: 'harden' });
  },

  /** Irreversible: saca el equipo del financiamiento para siempre. */
  releaseDevice(id: string, reason: string) {
    return accionDispositivo({ id, action: 'release', reason, confirmar: true });
  },

  setAutoBloqueo(id: string, autoBloqueo: boolean) {
    return accionDispositivo({ id, action: 'set_auto', autoBloqueo });
  },

  /** Vuelve a preguntarle al proveedor por un equipo concreto. */
  refreshDevice(id: string) {
    return pedir<Device>('/devices', {
      method: 'PUT',
      body: JSON.stringify({ id, action: 'refresh' }),
    });
  },

  deleteDevice(id: string): Promise<boolean> {
    return pedirOk(`/devices?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  getHistory(limit: number = 50) {
    return pedir<HistoryEntry[]>(`/history?limit=${encodeURIComponent(String(limit))}`);
  },

  getAlerts() {
    return pedir<Alert[]>('/data?type=alerts');
  },

  getStats() {
    return pedir<Stats>('/data?type=stats');
  },

  getConfig() {
    return pedir<ConfigBloqueo>('/data?type=config');
  },

  saveConfig(config: Partial<ConfigBloqueo>) {
    return pedir<ConfigBloqueo>('/data', {
      method: 'POST',
      body: JSON.stringify({ type: 'config', data: config }),
    });
  },

  acknowledgeAlert(id: string): Promise<boolean> {
    return pedirOk('/data', {
      method: 'POST',
      body: JSON.stringify({ type: 'acknowledge_alert', data: { id } }),
    });
  },

  registerPayment(deviceId: string, amount: number, method: string) {
    return pedir('/data', {
      method: 'POST',
      body: JSON.stringify({ type: 'payment', data: { deviceId, amount, method } }),
    });
  },

  getPayments(deviceId?: string) {
    const ruta = deviceId
      ? `/data?type=payments&deviceId=${encodeURIComponent(deviceId)}`
      : '/data?type=payments';
    return pedir<Payment[]>(ruta);
  },

  /** Rehace la lista de equipos a partir de la cartera de financiamiento. */
  sync() {
    return ejecutarConMensaje('/sync', { method: 'POST' });
  },

  /** Repregunta el estado real de TODOS los equipos. Tarda ~1 min. */
  reconcile() {
    return ejecutarConMensaje('/reconcile', { method: 'POST' });
  },

  /** Qué haría el automatismo ahora mismo, sin ejecutar nada. */
  getPreview() {
    return pedir<{ config: ConfigBloqueo; decisiones: Decision[] }>('/preview');
  },

  getWebhooks() {
    return pedir<any>('/webhooks');
  },

  createWebhook(url: string) {
    return ejecutarConMensaje('/webhooks', { method: 'POST', body: JSON.stringify({ url }) });
  },
};
