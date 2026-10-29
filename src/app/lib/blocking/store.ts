import { create } from 'zustand';
import { blockingApi } from './api';
import type {
  Alert,
  ConfigBloqueo,
  Decision,
  Device,
  HistoryEntry,
  Payment,
  PaymentMethod,
  ResultadoAccion,
  Stats,
} from './types';

/**
 * Estado del panel de CrediLock.
 *
 * AQUÍ NO HAY DATOS DE PRUEBA, y es una decisión deliberada. Antes el store
 * arrancaba con `mockDevices` y un flag `isUsingMockData`: si la API fallaba,
 * el panel mostraba equipos inventados con botones de bloqueo que parecían
 * funcionar y respondían "Dispositivo bloqueado". En una herramienta que deja a
 * gente sin teléfono, eso es peor que una pantalla vacía — el dueño podía creer
 * que había bloqueado a un cliente moroso cuando no había pasado nada, o peor,
 * creer que lo había desbloqueado tras un pago.
 *
 * Así que si la API no responde, la lista queda vacía y `error` explica por qué.
 *
 * Tampoco se escribe el historial desde aquí. Lo escribe el servidor cuando una
 * acción ocurre de verdad (la ruta POST /history responde 405 a propósito).
 * Antes el navegador añadía la entrada "block" él mismo, así que la bitácora
 * registraba la intención del administrador, no lo que el proveedor hizo.
 */
interface DeviceStore {
  devices: Device[];
  history: HistoryEntry[];
  alerts: Alert[];
  payments: Payment[];
  stats: Stats | null;
  config: ConfigBloqueo | null;
  decisiones: Decision[];
  isLoading: boolean;
  /** true mientras una acción sobre un equipo está en vuelo. */
  accionEnCurso: string | null;
  error: string | null;

  loadFromApi: () => Promise<void>;
  cargarPrevisualizacion: () => Promise<void>;
  guardarConfig: (cambios: Partial<ConfigBloqueo>) => Promise<boolean>;

  addDevice: (device: any) => Promise<ResultadoAccion>;
  blockDevice: (id: string, reason: string) => Promise<ResultadoAccion>;
  unblockDevice: (id: string) => Promise<ResultadoAccion>;
  notifyDevice: (id: string, titulo: string, contenido: string) => Promise<ResultadoAccion>;
  pinUnlock: (id: string, challenge: string) => Promise<ResultadoAccion>;
  hardenDevice: (id: string) => Promise<ResultadoAccion>;
  releaseDevice: (id: string, reason: string) => Promise<ResultadoAccion>;
  setAutoBloqueo: (id: string, activo: boolean) => Promise<ResultadoAccion>;
  refreshDevice: (id: string) => Promise<void>;
  deleteDevice: (id: string) => Promise<ResultadoAccion>;

  sincronizarCartera: () => Promise<ResultadoAccion>;
  reconciliarTodo: () => Promise<ResultadoAccion>;

  acknowledgeAlert: (id: string) => Promise<void>;
  registerPayment: (deviceId: string, amount: number, method: PaymentMethod) => Promise<void>;
  getDeviceById: (id: string) => Device | undefined;
  getPaymentsByDevice: (deviceId: string) => Payment[];
}

export const useDeviceStore = create<DeviceStore>((set, get) => ({
  devices: [],
  history: [],
  alerts: [],
  payments: [],
  stats: null,
  config: null,
  decisiones: [],
  isLoading: false,
  accionEnCurso: null,
  error: null,

  loadFromApi: async () => {
    set({ isLoading: true });
    const [devices, history, alerts, payments, stats, config] = await Promise.all([
      blockingApi.getDevices(),
      blockingApi.getHistory(100),
      blockingApi.getAlerts(),
      blockingApi.getPayments(),
      blockingApi.getStats(),
      blockingApi.getConfig(),
    ]);

    // Los equipos son lo único sin lo cual el panel no sirve de nada; que falle
    // el historial o las alertas no debería dejarlo en blanco.
    if (devices === null) {
      set({
        isLoading: false,
        error:
          'No se pudo cargar la lista de equipos. Revisa la conexión con el servidor; ' +
          'el panel no muestra nada antes que mostrar datos que no son reales.',
      });
      return;
    }

    set({
      devices,
      history: history ?? [],
      alerts: alerts ?? [],
      payments: payments ?? [],
      stats: stats ?? null,
      config: config ?? null,
      isLoading: false,
      error: null,
    });
  },

  cargarPrevisualizacion: async () => {
    const previa = await blockingApi.getPreview();
    if (previa) set({ decisiones: previa.decisiones, config: previa.config });
  },

  guardarConfig: async (cambios) => {
    const nueva = await blockingApi.saveConfig(cambios);
    if (!nueva) return false;
    set({ config: nueva });
    await get().cargarPrevisualizacion();
    return true;
  },

  // Las acciones recargan al terminar, y no es cosmético: el servidor sólo
  // guarda la INTENCIÓN al pedir un bloqueo, y el estado confirmado llega
  // después, cuando la reconciliación pregunta al proveedor. Recargar deja la
  // tarjeta mostrando lo real, incluido el aviso de divergencia si la orden
  // todavía no entró porque el equipo está apagado.

  blockDevice: async (id, reason) => {
    set({ accionEnCurso: id });
    const r = await blockingApi.blockDevice(id, reason);
    await get().loadFromApi();
    set({ accionEnCurso: null });
    return r;
  },

  unblockDevice: async (id) => {
    set({ accionEnCurso: id });
    const r = await blockingApi.unblockDevice(id);
    await get().loadFromApi();
    set({ accionEnCurso: null });
    return r;
  },

  notifyDevice: async (id, titulo, contenido) => {
    set({ accionEnCurso: id });
    const r = await blockingApi.notifyDevice(id, titulo, contenido);
    set({ accionEnCurso: null });
    return r;
  },

  pinUnlock: async (id, challenge) => {
    set({ accionEnCurso: id });
    const r = await blockingApi.pinUnlock(id, challenge);
    set({ accionEnCurso: null });
    return r;
  },

  hardenDevice: async (id) => {
    set({ accionEnCurso: id });
    const r = await blockingApi.hardenDevice(id);
    set({ accionEnCurso: null });
    return r;
  },

  releaseDevice: async (id, reason) => {
    set({ accionEnCurso: id });
    const r = await blockingApi.releaseDevice(id, reason);
    await get().loadFromApi();
    set({ accionEnCurso: null });
    return r;
  },

  setAutoBloqueo: async (id, activo) => {
    set({ accionEnCurso: id });
    const r = await blockingApi.setAutoBloqueo(id, activo);
    await get().loadFromApi();
    set({ accionEnCurso: null });
    return r;
  },

  refreshDevice: async (id) => {
    set({ accionEnCurso: id });
    const fresco = await blockingApi.refreshDevice(id);
    if (fresco) {
      set((state) => ({ devices: state.devices.map((d) => (d.id === id ? fresco : d)) }));
    }
    set({ accionEnCurso: null });
  },

  addDevice: async (deviceData) => {
    const r = await blockingApi.addDevice(deviceData);
    if (!r.ok) return r;
    await get().loadFromApi();
    return { ok: true, mensaje: 'Equipo registrado y verificado con el proveedor.' };
  },

  deleteDevice: async (id) => {
    const ok = await blockingApi.deleteDevice(id);
    if (ok) await get().loadFromApi();
    return {
      ok,
      mensaje: ok
        ? 'Equipo quitado del panel. Sigue enrolado en el proveedor.'
        : 'No se pudo quitar. Si está bloqueado, desbloquéalo primero.',
    };
  },

  sincronizarCartera: async () => {
    set({ isLoading: true });
    const r = await blockingApi.sync();
    await get().loadFromApi();
    return r;
  },

  reconciliarTodo: async () => {
    set({ isLoading: true });
    const r = await blockingApi.reconcile();
    await get().loadFromApi();
    return r;
  },

  acknowledgeAlert: async (id) => {
    const ok = await blockingApi.acknowledgeAlert(id);
    if (ok) {
      set((state) => ({
        alerts: state.alerts.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)),
      }));
    }
  },

  registerPayment: async (deviceId, amount, method) => {
    await blockingApi.registerPayment(deviceId, amount, method);
    await get().loadFromApi();
  },

  getDeviceById: (id) => get().devices.find((d) => d.id === id),

  getPaymentsByDevice: (deviceId) => get().payments.filter((p) => p.deviceId === deviceId),
}));
