export interface Device {
  id: string;
  imei: string;
  brand: string;
  model: string;
  phoneNumber: string;
  owner: string;
  status: 'active' | 'blocked' | 'kiosk';
  blockedAt?: string;
  createdAt: string;
  reason?: string;
  osVersion?: string;
  androidVersion?: string;
  securityPatchLevel?: string;
  lastSync?: string;
  batteryLevel?: number;
  location?: DeviceLocation;
  enrolledInMDM: boolean;
  kioskMode?: KioskConfig;
  contract?: Contract;
  paymentPlan?: PaymentPlan;
  email?: string;
}

export interface DeviceLocation {
  latitude: number;
  longitude: number;
  timestamp: string;
  accuracy?: number;
}

export interface KioskConfig {
  enabled: boolean;
  allowedApps: string[];
  allowEmergencyCalls: boolean;
  exitPin?: string;
}

export interface Contract {
  id: string;
  signedDate: string;
  signedBy: string;
  documentUrl?: string;
  terms: string;
  accepted: boolean;
}

export interface HistoryEntry {
  id: string;
  deviceId: string;
  action: 'block' | 'unblock' | 'add' | 'locate' | 'wipe' | 'kiosk_enable' | 'kiosk_disable';
  timestamp: string;
  user: string;
  reason?: string;
  deviceInfo: string;
  metadata?: any;
}

export interface Stats {
  total: number;
  active: number;
  blocked: number;
  recentBlocks: number;
  kioskMode: number;
  enrolled: number;
}

export interface Alert {
  id: string;
  deviceId: string;
  type: 'low_battery' | 'location_change' | 'unauthorized_access' | 'tamper_detected' | 'payment_completed' | 'payment_overdue';
  message: string;
  timestamp: string;
  acknowledged: boolean;
}

export interface PaymentPlan {
  id: string;
  deviceId: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  totalPayments: number;
  completedPayments: number;
  paymentFrequency: 'weekly' | 'biweekly' | 'monthly';
  paymentAmount: number;
  startDate: string;
  nextPaymentDate: string;
  status: 'active' | 'completed' | 'overdue' | 'suspended';
  paymentMethods: PaymentMethod[];
}

export interface Payment {
  id: string;
  paymentPlanId: string;
  deviceId: string;
  amount: number;
  date: string;
  method: PaymentMethod;
  status: 'completed' | 'pending' | 'failed';
  receiptNumber: string;
  notes?: string;
}

export type PaymentMethod = 'efectivo' | 'transferencia' | 'tarjeta' | 'deposito' | 'pago_movil';

export interface PaymentStats {
  totalRevenue: number;
  completedPlans: number;
  activePlans: number;
  overduePlans: number;
  paymentsThisMonth: number;
  revenueThisMonth: number;
}
