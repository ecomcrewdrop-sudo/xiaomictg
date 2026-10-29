/** Plataforma de bloqueo en la que está enrolado el equipo. */
export type Plataforma = 'trustonic' | 'nuovo' | 'desconocida';

export interface Device {
  id: string;
  imei: string;
  brand: string;
  model: string;
  phoneNumber: string;
  owner: string;

  /**
   * Estado CONFIRMADO por el proveedor. Lo escribe la reconciliación a partir
   * de QUERY_DEVICES, nunca la respuesta de un bloqueo.
   */
  status: 'active' | 'blocked';
  /**
   * Lo que queremos que pase. Si difiere de `status`, la orden está en camino
   * (o el equipo está apagado y no le ha llegado).
   */
  intencion: 'active' | 'blocked';
  divergente: boolean;
  /** true si el bloqueo lo pidió una persona: el automatismo no lo deshace. */
  bloqueoManual?: boolean;
  /** Cuándo salió la última orden, para contar el tiempo que lleva en cola. */
  ordenEnviadaEn?: string | null;

  plataforma: Plataforma;
  /** true si está en Nuovo: esta API no lo alcanza y hay que operarlo a mano. */
  gestionManual: boolean;
  enrolledInMDM: boolean;
  trustonicState?: string | null;

  /**
   * Último contacto real del equipo con el proveedor. Es el único dato honesto
   * de conectividad: `status` dice "active" indefinidamente aunque el teléfono
   * lleve semanas apagado, y a un equipo apagado el bloqueo no le llega.
   */
  lastCheckIn?: string | null;
  horasSinReportar?: number | null;
  incomunicado: boolean;
  lastSync?: string;

  blockedAt?: string;
  createdAt: string;
  reason?: string;

  cuotasVencidas: number;
  cuotasPagadas: number;
  totalCuotas: number;
  saldo: number;
  diasDeMora: number;
  liquidado: boolean;
  /**
   * Plazo extra que sigue abierto sobre la próxima cuota (`YYYY-MM-DD`), o null.
   *
   * Explica por qué un equipo con cuotas atrasadas aparece sin mora y sin
   * bloquear: se le dio tiempo. Sin este dato, la pestaña de Bloqueo mostraba
   * ese caso como una incoherencia del sistema.
   */
  prorrogaHasta?: string | null;

  autoBloqueo: boolean;
  financingId?: string | null;
  ultimoErrorApi?: string | null;
  /** Entidad que el equipo muestra en pantalla; en los enrolados antes dice "Tu Financiera". */
  organizacionEnEquipo?: string | null;

  email?: string;
  contract?: Contract;
  paymentPlan?: PaymentPlan;
}

/** Configuración del automatismo de bloqueo por mora. */
export interface ConfigBloqueo {
  autoBloqueoActivo: boolean;
  simulacion: boolean;
  diasDeGracia: number;
  maxBloqueosPorVuelta: number;
  avisoEnPantallaActivo: boolean;
  secretoWebhook: string;
}

/** Lo que la política haría ahora mismo, sin ejecutarlo. */
export interface Decision {
  imei: string;
  owner: string;
  accion: 'bloquear' | 'desbloquear' | 'liberar' | 'avisar_pantalla' | 'nada';
  motivo: string;
}

export interface ResultadoAccion {
  ok: boolean;
  mensaje: string;
  pendienteDeEntrega?: boolean;
  /** Estado del equipo justo después de actuar, para pintar la fila ya. */
  equipo?: Device | null;
}

export interface DeviceLocation {
  latitude: number;
  longitude: number;
  timestamp: string;
  accuracy?: number;
}

export interface Contract {
  id: string;
  signedDate: string;
  signedBy: string;
  documentUrl?: string;
  terms: string;
  accepted: boolean;
}

/**
 * Entrada del historial. Lo escribe SÓLO el servidor; el panel no puede añadir
 * entradas (la ruta POST responde 405 a propósito). Si el navegador pudiera
 * escribir aquí, la bitácora dejaría de servir como prueba el día que un
 * cliente reclame un bloqueo.
 *
 * `action` llega como string libre porque el servidor emite también variantes
 * como `simulado:bloquear`, y acotarlo aquí haría que el panel se rompiera cada
 * vez que el backend registre un tipo nuevo.
 */
export interface HistoryEntry {
  id: string;
  deviceId: string;
  imei?: string;
  action: string;
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
  /** Enrolados en Trustonic, es decir, los que se pueden operar desde aquí. */
  enrolled: number;
  enNuovo: number;
  sinResolver: number;
  /** Sin reportar desde hace más de 48 h: un bloqueo no les llegaría. */
  incomunicados: number;
  /** Equipos donde lo que pedimos y lo que confirma el proveedor no coinciden. */
  divergentes: number;
  enMora: number;
  liquidados: number;
  saldoTotal: number;
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
