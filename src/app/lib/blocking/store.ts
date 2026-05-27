import { create } from 'zustand';
import { Device, HistoryEntry, Alert, Payment, PaymentPlan, PaymentMethod } from './types';
import { useAuthStore } from './auth-store';
import { blockingApi } from './api';
import { mockDevices, mockHistory, mockAlerts, mockPayments } from './mock-data';

interface DeviceStore {
  devices: Device[];
  history: HistoryEntry[];
  alerts: Alert[];
  payments: Payment[];
  isUsingMockData: boolean;
  isLoading: boolean;
  error: string | null;
  addDevice: (device: any, callback?: (result: any) => void) => Promise<void>;
  blockDevice: (id: string, reason: string) => void;
  unblockDevice: (id: string) => void;
  deleteDevice: (id: string) => void;
  getDeviceById: (id: string) => Device | undefined;
  enableKioskMode: (id: string, allowedApps: string[]) => void;
  disableKioskMode: (id: string) => void;
  locateDevice: (id: string) => void;
  wipeDevice: (id: string, reason: string) => void;
  updateDeviceLocation: (id: string, latitude: number, longitude: number) => void;
  acknowledgeAlert: (id: string) => void;
  registerPayment: (deviceId: string, amount: number, method: PaymentMethod) => void;
  getPaymentsByDevice: (deviceId: string) => Payment[];
}

export const useDeviceStore = create<DeviceStore>((set, get) => ({
  devices: mockDevices,
  history: mockHistory,
  alerts: mockAlerts,
  payments: mockPayments,
  isUsingMockData: true,
  isLoading: false,
  error: null,

  loadFromApi: async () => {
    set({ isLoading: true });
    try {
      const [devices, history, alerts, payments] = await Promise.all([
        blockingApi.getDevices(),
        blockingApi.getHistory(),
        blockingApi.getAlerts(),
        blockingApi.getPayments()
      ]);
      
      if (devices !== null) {
        set({ 
          devices: devices.map((d: any) => ({ ...d, id: d._id?.toString() || d.id })),
          isUsingMockData: false 
        });
      }
      
      if (history) {
        set({ history: history.map((h: any) => ({ ...h, id: h._id?.toString() || h.id })) });
      }
      
      if (alerts) {
        set({ alerts: alerts.map((a: any) => ({ ...a, id: a._id?.toString() || a.id })) });
      }
      
      if (payments) {
        set({ payments: payments.map((p: any) => ({ ...p, id: p._id?.toString() || p.id })) });
      }
      
      set({ isLoading: false, error: null });
    } catch (error) {
      console.error('Error loading from API:', error);
      set({ isLoading: false, error: 'Error connecting to API' });
    }
  },

  addDevice: async (deviceData, callback?: (result: any) => void) => {
    const user = useAuthStore.getState().user;
    const newDevice: Device = {
      ...deviceData,
      id: Date.now().toString(),
      status: 'active',
      enrolledInMDM: true,
      createdAt: new Date().toISOString(),
      lastSync: new Date().toISOString(),
    };

    const historyEntry: HistoryEntry = {
      id: `h${Date.now()}`,
      deviceId: newDevice.id,
      action: 'add',
      timestamp: new Date().toISOString(),
      user: user?.name || 'Admin',
      deviceInfo: `${newDevice.brand} ${newDevice.model} - ${newDevice.imei}`,
    };

    if (!get().isUsingMockData) {
      const apiDevice = await blockingApi.addDevice(deviceData);
      if (apiDevice) {
        await blockingApi.addHistoryEntry({
          deviceId: apiDevice._id?.toString() || apiDevice.id,
          action: 'add',
          user: user?.name || 'Admin',
          deviceInfo: `${newDevice.brand} ${newDevice.model} - ${newDevice.imei}`,
        });
        if (callback) {
          callback(apiDevice);
        }
        await get().loadFromApi();
        return;
      }
    }

    set((state) => ({
      devices: [...state.devices, newDevice],
      history: [historyEntry, ...state.history],
    }));
    if (callback) {
      callback(null);
    }
  },

  blockDevice: async (id, reason) => {
    const user = useAuthStore.getState().user;
    const device = get().devices.find((d) => d.id === id);
    if (!device) return;

    const historyEntry: HistoryEntry = {
      id: `h${Date.now()}`,
      deviceId: id,
      action: 'block',
      timestamp: new Date().toISOString(),
      user: user?.name || 'Admin',
      reason,
      deviceInfo: `${device.brand} ${device.model} - ${device.imei}`,
    };

    if (!get().isUsingMockData) {
      await blockingApi.blockDevice(id, reason);
      await blockingApi.addHistoryEntry({
        deviceId: id,
        action: 'block',
        user: user?.name || 'Admin',
        reason,
        deviceInfo: `${device.brand} ${device.model} - ${device.imei}`,
      });
      await get().loadFromApi();
      return;
    }

    set((state) => ({
      devices: state.devices.map((d) =>
        d.id === id
          ? {
              ...d,
              status: 'blocked' as const,
              blockedAt: new Date().toISOString(),
              reason,
            }
          : d
      ),
      history: [historyEntry, ...state.history],
    }));
  },

  unblockDevice: async (id) => {
    const user = useAuthStore.getState().user;
    const device = get().devices.find((d) => d.id === id);
    if (!device) return;

    const historyEntry: HistoryEntry = {
      id: `h${Date.now()}`,
      deviceId: id,
      action: 'unblock',
      timestamp: new Date().toISOString(),
      user: user?.name || 'Admin',
      deviceInfo: `${device.brand} ${device.model} - ${device.imei}`,
    };

    if (!get().isUsingMockData) {
      await blockingApi.unblockDevice(id);
      await blockingApi.addHistoryEntry({
        deviceId: id,
        action: 'unblock',
        user: user?.name || 'Admin',
        deviceInfo: `${device.brand} ${device.model} - ${device.imei}`,
      });
      await get().loadFromApi();
      return;
    }

    set((state) => ({
      devices: state.devices.map((d) =>
        d.id === id
          ? {
              ...d,
              status: 'active' as const,
              blockedAt: undefined,
              reason: undefined,
            }
          : d
      ),
      history: [historyEntry, ...state.history],
    }));
  },

  enableKioskMode: async (id, allowedApps) => {
    const user = useAuthStore.getState().user;
    const device = get().devices.find((d) => d.id === id);
    if (!device) return;

    const historyEntry: HistoryEntry = {
      id: `h${Date.now()}`,
      deviceId: id,
      action: 'kiosk_enable',
      timestamp: new Date().toISOString(),
      user: user?.name || 'Admin',
      deviceInfo: `${device.brand} ${device.model} - ${device.imei}`,
      metadata: { allowedApps },
    };

    if (!get().isUsingMockData) {
      await blockingApi.enableKioskMode(id, allowedApps);
      await blockingApi.addHistoryEntry({
        deviceId: id,
        action: 'kiosk_enable',
        user: user?.name || 'Admin',
        deviceInfo: `${device.brand} ${device.model} - ${device.imei}`,
        metadata: { allowedApps },
      });
      await get().loadFromApi();
      return;
    }

    set((state) => ({
      devices: state.devices.map((d) =>
        d.id === id
          ? {
              ...d,
              status: 'kiosk' as const,
              kioskMode: {
                enabled: true,
                allowedApps,
                allowEmergencyCalls: true,
                exitPin: '1234',
              },
            }
          : d
      ),
      history: [historyEntry, ...state.history],
    }));
  },

  disableKioskMode: async (id) => {
    const user = useAuthStore.getState().user;
    const device = get().devices.find((d) => d.id === id);
    if (!device) return;

    const historyEntry: HistoryEntry = {
      id: `h${Date.now()}`,
      deviceId: id,
      action: 'kiosk_disable',
      timestamp: new Date().toISOString(),
      user: user?.name || 'Admin',
      deviceInfo: `${device.brand} ${device.model} - ${device.imei}`,
    };

    if (get().isUsingMockData) {
      set((state) => ({
        devices: state.devices.map((d) =>
          d.id === id
            ? {
                ...d,
                status: 'active' as const,
                kioskMode: {
                  enabled: false,
                  allowedApps: [],
                  allowEmergencyCalls: true,
                },
              }
            : d
        ),
        history: [historyEntry, ...state.history],
      }));
    }
  },

  locateDevice: async (id) => {
    const user = useAuthStore.getState().user;
    const device = get().devices.find((d) => d.id === id);
    if (!device) return;

    const historyEntry: HistoryEntry = {
      id: `h${Date.now()}`,
      deviceId: id,
      action: 'locate',
      timestamp: new Date().toISOString(),
      user: user?.name || 'Admin',
      deviceInfo: `${device.brand} ${device.model} - ${device.imei}`,
      metadata: device.location,
    };

    if (!get().isUsingMockData) {
      await blockingApi.addHistoryEntry({
        deviceId: id,
        action: 'locate',
        user: user?.name || 'Admin',
        deviceInfo: `${device.brand} ${device.model} - ${device.imei}`,
        metadata: device.location,
      });
      await get().loadFromApi();
      return;
    }

    set((state) => ({
      history: [historyEntry, ...state.history],
    }));
  },

  wipeDevice: (id, reason) => {
    const user = useAuthStore.getState().user;
    const device = get().devices.find((d) => d.id === id);
    if (!device) return;

    const historyEntry: HistoryEntry = {
      id: `h${Date.now()}`,
      deviceId: id,
      action: 'wipe',
      timestamp: new Date().toISOString(),
      user: user?.name || 'Admin',
      reason,
      deviceInfo: `${device.brand} ${device.model} - ${device.imei}`,
    };

    if (get().isUsingMockData) {
      set((state) => ({
        history: [historyEntry, ...state.history],
      }));
    }
  },

  updateDeviceLocation: (id, latitude, longitude) => {
    set((state) => ({
      devices: state.devices.map((d) =>
        d.id === id
          ? {
              ...d,
              location: {
                latitude,
                longitude,
                timestamp: new Date().toISOString(),
                accuracy: 10,
              },
              lastSync: new Date().toISOString(),
            }
          : d
      ),
    }));
  },

  deleteDevice: async (id) => {
    if (!get().isUsingMockData) {
      await blockingApi.deleteDevice(id);
      await get().loadFromApi();
      return;
    }

    set((state) => ({
      devices: state.devices.filter((d) => d.id !== id),
      history: state.history.filter((h) => h.deviceId !== id),
      alerts: state.alerts.filter((a) => a.deviceId !== id),
      payments: state.payments.filter((p) => p.deviceId !== id),
    }));
  },

  acknowledgeAlert: async (id) => {
    if (!get().isUsingMockData) {
      await blockingApi.acknowledgeAlert(id);
      await get().loadFromApi();
      return;
    }

    set((state) => ({
      alerts: state.alerts.map((a) =>
        a.id === id ? { ...a, acknowledged: true } : a
      ),
    }));
  },

  getDeviceById: (id) => {
    return get().devices.find((d) => d.id === id);
  },

  registerPayment: async (deviceId, amount, method) => {
    const user = useAuthStore.getState().user;
    const device = get().devices.find((d) => d.id === deviceId);
    if (!device || !device.paymentPlan) return;

    const newPayment: Payment = {
      id: `pay${Date.now()}`,
      paymentPlanId: device.paymentPlan.id,
      deviceId,
      amount,
      date: new Date().toISOString(),
      method,
      status: 'completed',
      receiptNumber: `REC-${Date.now()}`,
      notes: `Pago registrado por ${user?.name || 'Admin'}`
    };

    const updatedPaidAmount = device.paymentPlan.paidAmount + amount;
    const updatedRemainingAmount = device.paymentPlan.totalAmount - updatedPaidAmount;
    const updatedCompletedPayments = device.paymentPlan.completedPayments + 1;
    const isCompleted = updatedRemainingAmount <= 0;

    if (!get().isUsingMockData) {
      await blockingApi.registerPayment(deviceId, amount, method);
      await get().loadFromApi();
      return;
    }

    set((state) => ({
      payments: [...state.payments, newPayment],
      devices: state.devices.map((d) =>
        d.id === deviceId && d.paymentPlan
          ? {
              ...d,
              paymentPlan: {
                ...d.paymentPlan,
                paidAmount: updatedPaidAmount,
                remainingAmount: Math.max(0, updatedRemainingAmount),
                completedPayments: updatedCompletedPayments,
                status: isCompleted ? 'completed' : d.paymentPlan.status,
              },
            }
          : d
      ),
      alerts: isCompleted
        ? [
            {
              id: `a${Date.now()}`,
              deviceId,
              type: 'payment_completed',
              message: `¡Plan de pagos completado! ${device.brand} ${device.model} - ${device.owner}`,
              timestamp: new Date().toISOString(),
              acknowledged: false,
            },
            ...state.alerts,
          ]
        : state.alerts,
    }));
  },

  getPaymentsByDevice: (deviceId) => {
    return get().payments.filter((p) => p.deviceId === deviceId);
  },
}));
