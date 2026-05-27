import { Device, HistoryEntry, Alert, Payment } from './types';

export const mockDevices: Device[] = [
  {
    id: '1',
    imei: '861234567890123',
    brand: 'Xiaomi',
    model: 'Redmi Note 13 Pro',
    phoneNumber: '+573001234567',
    owner: 'Juan Pérez',
    status: 'active',
    createdAt: '2024-01-15T10:00:00Z',
    osVersion: 'Android 14',
    androidVersion: '14',
    securityPatchLevel: '2024-02-01',
    lastSync: '2024-02-20T08:30:00Z',
    batteryLevel: 85,
    location: { latitude: 10.3932, longitude: -75.4832, timestamp: '2024-02-20T08:30:00Z', accuracy: 10 },
    enrolledInMDM: true,
    email: 'juan@example.com',
    paymentPlan: {
      id: 'pp1',
      deviceId: '1',
      totalAmount: 800000,
      paidAmount: 400000,
      remainingAmount: 400000,
      totalPayments: 4,
      completedPayments: 2,
      paymentFrequency: 'monthly',
      paymentAmount: 200000,
      startDate: '2024-01-15',
      nextPaymentDate: '2024-03-15',
      status: 'active',
      paymentMethods: ['efectivo', 'transferencia']
    }
  },
  {
    id: '2',
    imei: '861234567890124',
    brand: 'Xiaomi',
    model: 'Xiaomi 14 Ultra',
    phoneNumber: '+573009876543',
    owner: 'María García',
    status: 'blocked',
    blockedAt: '2024-02-10T14:00:00Z',
    createdAt: '2024-01-10T09:00:00Z',
    reason: 'Pago vencido',
    osVersion: 'Android 14',
    androidVersion: '14',
    securityPatchLevel: '2024-02-01',
    lastSync: '2024-02-10T14:00:00Z',
    batteryLevel: 20,
    enrolledInMDM: true,
    email: 'maria@example.com'
  },
  {
    id: '3',
    imei: '861234567890125',
    brand: 'Xiaomi',
    model: 'Redmi Note 12',
    phoneNumber: '+573005554444',
    owner: 'Carlos López',
    status: 'kiosk',
    createdAt: '2024-02-01T11:00:00Z',
    osVersion: 'Android 13',
    androidVersion: '13',
    lastSync: '2024-02-18T16:00:00Z',
    batteryLevel: 92,
    enrolledInMDM: true,
    kioskMode: {
      enabled: true,
      allowedApps: ['whatsapp', 'telegram', 'spotify'],
      allowEmergencyCalls: true,
      exitPin: '1234'
    }
  }
];

export const mockHistory: HistoryEntry[] = [
  {
    id: 'h1',
    deviceId: '1',
    action: 'add',
    timestamp: '2024-01-15T10:00:00Z',
    user: 'Admin',
    deviceInfo: 'Xiaomi Redmi Note 13 Pro - 861234567890123'
  },
  {
    id: 'h2',
    deviceId: '2',
    action: 'block',
    timestamp: '2024-02-10T14:00:00Z',
    user: 'Admin',
    reason: 'Pago vencido',
    deviceInfo: 'Xiaomi Xiaomi 14 Ultra - 861234567890124'
  },
  {
    id: 'h3',
    deviceId: '3',
    action: 'kiosk_enable',
    timestamp: '2024-02-15T09:00:00Z',
    user: 'Admin',
    deviceInfo: 'Xiaomi Redmi Note 12 - 861234567890125',
    metadata: { allowedApps: ['whatsapp', 'telegram', 'spotify'] }
  }
];

export const mockAlerts: Alert[] = [
  {
    id: 'a1',
    deviceId: '2',
    type: 'payment_overdue',
    message: 'Pago vencido para Xiaomi 14 Ultra - María García',
    timestamp: '2024-02-10T14:00:00Z',
    acknowledged: false
  },
  {
    id: 'a2',
    deviceId: '1',
    type: 'low_battery',
    message: 'Batería baja en Xiaomi Redmi Note 13 Pro - Juan Pérez',
    timestamp: '2024-02-20T08:30:00Z',
    acknowledged: true
  }
];

export const mockPayments: Payment[] = [
  {
    id: 'pay1',
    paymentPlanId: 'pp1',
    deviceId: '1',
    amount: 200000,
    date: '2024-01-15T10:00:00Z',
    method: 'efectivo',
    status: 'completed',
    receiptNumber: 'REC-001',
    notes: 'Pago registrado por Admin'
  },
  {
    id: 'pay2',
    paymentPlanId: 'pp1',
    deviceId: '1',
    amount: 200000,
    date: '2024-02-15T10:00:00Z',
    method: 'transferencia',
    status: 'completed',
    receiptNumber: 'REC-002',
    notes: 'Pago registrado por Admin'
  }
];
