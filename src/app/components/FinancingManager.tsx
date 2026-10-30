import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { toast } from 'sonner';
import { API_BASE_URL, fetchWithTimeout } from '../lib/api-base';
import { compressImageFile } from '../lib/product-image';
import { CredilockWhatsAppCard } from './CredilockWhatsAppCard';
import { blockingApi } from '../lib/blocking/api';
import type { Device, ConfigBloqueo } from '../lib/blocking/types';
import {
  Plus, Search, Trash2, Pencil, Send, CheckCircle, Clock, AlertTriangle,
  DollarSign, Users, Smartphone, CalendarDays, ChevronDown, ChevronUp,
  X, RotateCcw, Phone, CreditCard, Lock, LockOpen, Loader2, Minus, WifiOff,
  Activity, ShieldOff, Upload, Eye, ImageOff, CalendarClock, Hourglass, Bell
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Captura del pago. Es lo que respalda que la cuota se marque como pagada. */
interface ComprobantePago {
  mediaId: string;
  mime: string;
  bytes: number;
  nombreArchivo: string;
  subidoEn: string;
  subidoPor: string;
}

/**
 * Plazo extra concedido sobre una cuota. El contrato no cambia: `dueDate` sigue
 * siendo la fecha pactada y esto va encima. Ver `server/prorroga.ts`.
 */
interface Prorroga {
  hasta: string; // YYYY-MM-DD
  otorgadaEn: string;
  otorgadaPor: string;
  motivo?: string;
  fechaOriginal: string;
}

interface Installment {
  number: number;
  dueDate: string;
  paidDate?: string;
  status: 'pending' | 'paid' | 'overdue';
  comprobante?: ComprobantePago | null;
  prorroga?: Prorroga | null;
}

interface XiaomiPayment {
  id: string;
  amount: number;
  note: string;
  date: string;
}

interface FinancingRecord {
  id: string;
  nombre: string;
  cedula: string;
  telefono: string;
  imei: string;
  producto: string;
  costoTotal: number;
  costoEquipo: number; // Costo real del teléfono (lo que se le paga a Xiaomi)
  cuotaInicial: number;
  numeroCuotas: number;
  valorCuota: number;
  fechaInicio: string;
  horaBloqueo: string; // HH:mm
  cuotasPrevias: number; // Cuotas pagadas antes de registrar
  cuotas: Installment[];
  status: 'active' | 'completed' | 'defaulted';
  createdAt: string;
  lastReminderSent?: string;
  /**
   * Cuántas prórrogas se le han dado en total. Sólo sube, incluso al anular:
   * es lo que delata al cliente que pide plazo cada quincena, y contando las
   * vivas siempre parecería la primera vez.
   */
  prorrogasOtorgadas?: number;
}

/** Una orden de bloqueo/desbloqueo que salió y todavía no confirma el proveedor. */
interface OrdenEnVuelo {
  deviceId: string;
  nombre: string;
  accion: 'block' | 'unblock';
  /** Cuándo salió la orden, en ms. */
  desde: number;
  /** Última vez que le preguntamos al proveedor, en ms. */
  ultimoSondeo: number;
  sondeos: number;
}

/** Línea del registro de actividad que se ve en el panel. */
interface EventoPanel {
  id: string;
  cuando: number;
  nivel: 'info' | 'ok' | 'aviso' | 'error';
  texto: string;
}

/**
 * Cada cuánto repreguntar al proveedor por una orden en vuelo, según lo que
 * lleve esperando.
 *
 * No es un intervalo fijo porque cada sondeo es una llamada real al API de
 * Trustonic: en el primer minuto interesa ver la confirmación casi al instante,
 * pero a los dos minutos ya está claro que el teléfono no está conectado y
 * seguir preguntando cada 10 s sólo gasta cuota. `null` = dejar de sondear.
 */
function cadenciaDeSondeo(msEsperando: number): number | null {
  if (msEsperando < 60_000) return 10_000;
  if (msEsperando < 240_000) return 30_000;
  return null;
}

/** "1m 20s" — para contadores que el dueño mira mientras espera. */
function duracionCorta(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

/**
 * A nivel de módulo, no dentro del componente: los sub-componentes de abajo
 * (comprobantes) también los necesitan, y declararlos en el cuerpo de
 * `FinancingManager` los dejaba fuera de su alcance.
 */
const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

const formatCurrency = (n: number) => `$${n.toLocaleString('es-CO')}`;

/**
 * El tramo de bytes no es decorativo: una captura que pesa 400 B no es una
 * captura, es un archivo roto o recortado a nada. Redondeando a KB salía
 * "0 KB", que parece un fallo del panel y no del archivo.
 */
function tamañoCorto(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/* ─── Prórrogas: sólo presentación ───────────────────────────────────────────
 *
 * Quien DECIDE si una cuota está vencida es el servidor (`server/prorroga.ts` +
 * `refreshOverdueStatus`), y lo hace en cada GET. Este panel no vuelve a
 * calcular la mora: pinta el `status` que ya viene resuelto. Lo de aquí abajo
 * es sólo para mostrar fechas y elegir la etiqueta.
 *
 * Importante que siga siendo así: si el panel se pusiera a decidir por su
 * cuenta, habría dos respuestas posibles a "¿este cliente debe?" y la del
 * teléfono bloqueado sería la que el dueño no está viendo.
 */

/** Hoy en Colombia, como YYYY-MM-DD. */
function hoyEnColombia(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

/** YYYY-MM-DD de una fecha ISO o ya corta, leyendo la parte UTC. */
function soloFecha(valor: string | undefined | null): string {
  const texto = String(valor ?? '');
  if (/^\d{4}-\d{2}-\d{2}/.test(texto)) return texto.slice(0, 10);
  const d = new Date(texto);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/** La fecha que manda: la de la prórroga si hay, la pactada si no. */
function fechaLimite(cuota: Installment): string {
  return soloFecha(cuota.prorroga?.hasta) || soloFecha(cuota.dueDate);
}

/**
 * La prórroga sólo mientras el plazo siga abierto. Pasada la fecha deja de ser
 * vigente y la cuota vuelve a verse en mora, aunque el servidor siga contando
 * los días desde el plazo y no desde la fecha original.
 */
function prorrogaVigente(cuota: Installment, hoy = hoyEnColombia()): Prorroga | null {
  const hasta = soloFecha(cuota.prorroga?.hasta);
  if (!hasta || cuota.status === 'paid') return null;
  return hasta >= hoy ? cuota.prorroga! : null;
}

/** "en 3 días", "mañana", "hoy" — para que el dueño no tenga que contar. */
function cuantoFalta(hasta: string, hoy = hoyEnColombia()): string {
  const dias = Math.round(
    (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86400000
  );
  if (Number.isNaN(dias)) return '';
  if (dias === 0) return 'vence hoy';
  if (dias === 1) return 'vence mañana';
  if (dias < 0) return dias === -1 ? 'se venció ayer' : `se venció hace ${Math.abs(dias)} días`;
  return `faltan ${dias} días`;
}

/**
 * "miércoles, 21 de octubre" — la fecha como se la decimos al cliente.
 *
 * `timeZone: 'UTC'` igual que en el servidor: `new Date('2026-10-21')` es
 * medianoche UTC y pintarla en UTC-5 la corre al día anterior, así que el panel
 * mostraría un día menos de plazo del que respeta el automatismo.
 */
function fechaLarga(fecha: string): string {
  const d = new Date(`${soloFecha(fecha)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(fecha);
  return d.toLocaleDateString('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

/** Fecha por defecto que propone el diálogo: una semana desde hoy. */
function fechaSugerida(): string {
  const d = new Date(`${hoyEnColombia()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

/* ─── Carga de comprobantes ───────────────────────────────────────────────────
 *
 * Las capturas NO se pintan con `<img src="/api/...">`. Esa ruta exige sesión de
 * administrador y el navegador no manda la cabecera Authorization en las
 * peticiones de imagen, así que saldrían todas rotas. Se bajan con fetch —que sí
 * pasa por el interceptor que pone el Bearer— y se pintan desde un blob local.
 *
 * El caché es por `mediaId`, no por cuota: la miniatura de la fila y la vista
 * ampliada son la misma imagen, y sin esto cada clic en "Ver" volvía a
 * descargarla. La clave incluye el mediaId, así que al reemplazar la captura la
 * entrada vieja deja de usarse sola y la nueva se baja una vez.
 */
const comprobantesEnMemoria = new Map<string, Promise<string>>();

function urlDeComprobante(recordId: string, cuota: number, mediaId: string): Promise<string> {
  const cacheado = comprobantesEnMemoria.get(mediaId);
  if (cacheado) return cacheado;

  const promesa = (async () => {
    const res = await fetchWithTimeout(
      `${API_BASE_URL}/financing/${recordId}/comprobante/${cuota}/imagen`,
      {},
      30000
    );
    if (!res.ok) throw new Error(`No se pudo cargar el comprobante (${res.status})`);
    return URL.createObjectURL(await res.blob());
  })();

  // Un fallo no se queda cacheado: si la red falla una vez, reintentar debe
  // volver a pedirla en vez de repetir el mismo error para siempre.
  promesa.catch(() => comprobantesEnMemoria.delete(mediaId));
  comprobantesEnMemoria.set(mediaId, promesa);
  return promesa;
}

/** Al reemplazar o borrar, suelta el blob para no dejar memoria colgada. */
function olvidarComprobante(mediaId?: string | null) {
  if (!mediaId) return;
  const pendiente = comprobantesEnMemoria.get(mediaId);
  comprobantesEnMemoria.delete(mediaId);
  pendiente?.then(url => URL.revokeObjectURL(url)).catch(() => {});
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FinancingManager() {
  const [records, setRecords] = useState<FinancingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'completed' | 'overdue' | 'prorroga'>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FinancingRecord | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sendingReminder, setSendingReminder] = useState<string | null>(null);
  const [runningReminders, setRunningReminders] = useState(false);

  /**
   * Estado real de cada equipo, indexado por IMEI.
   *
   * No se deriva de la mora. El badge que había aquí decía "🔒 BLOQUEADO" en
   * cuanto una cuota estaba vencida, y eso es falso: estar en mora no bloquea
   * nada por sí solo. En producción había 32 filas marcadas como bloqueadas y
   * sólo 5 equipos bloqueados de verdad. Quien mira esta pantalla para decidir
   * a quién llamar necesita el estado que confirma el proveedor, no el que
   * deduce el panel.
   */
  const [equiposPorImei, setEquiposPorImei] = useState<Map<string, Device>>(new Map());
  const [accionEnCurso, setAccionEnCurso] = useState<string | null>(null);
  const [ordenesEnVuelo, setOrdenesEnVuelo] = useState<Record<string, OrdenEnVuelo>>({});
  const [eventos, setEventos] = useState<EventoPanel[]>([]);
  const [configBloqueo, setConfigBloqueo] = useState<ConfigBloqueo | null>(null);
  /** Reloj que avanza sólo cuando hay algo que contar; ver el efecto de abajo. */
  const [ahora, setAhora] = useState(() => Date.now());
  const [porConfirmar, setPorConfirmar] = useState<{ record: FinancingRecord; device: Device } | null>(null);

  /** Cuota cuyo comprobante se está subiendo o borrando: `${recordId}:${nº}`. */
  const [comprobanteOcupado, setComprobanteOcupado] = useState<string | null>(null);
  /**
   * Captura abierta a tamaño completo. Se guardan los identificadores, no el
   * objeto: al subir una imagen nueva `loadRecords` reemplaza el array entero, y
   * una copia congelada de la cuota seguiría apuntando al mediaId anterior —el
   * diálogo mostraría la captura vieja justo después de cambiarla.
   */
  const [comprobanteAbierto, setComprobanteAbierto] = useState<
    { recordId: string; cuotaNumber: number } | null
  >(null);

  /** Cuota cuya prórroga se está guardando o anulando: `${recordId}:${nº}`. */
  const [prorrogaOcupada, setProrrogaOcupada] = useState<string | null>(null);
  /** Igual que el comprobante: se guardan los ids, no la cuota congelada. */
  const [prorrogaAbierta, setProrrogaAbierta] = useState<
    { recordId: string; cuotaNumber: number } | null
  >(null);

  const [xiaomiPayments, setXiaomiPayments] = useState<XiaomiPayment[]>([]);
  const [showPayXiaomiDialog, setShowPayXiaomiDialog] = useState(false);
  const [payXiaomiAmount, setPayXiaomiAmount] = useState('');
  const [payXiaomiNote, setPayXiaomiNote] = useState('');
  const [savingPayment, setSavingPayment] = useState(false);
  const [showDeudaDesglose, setShowDeudaDesglose] = useState(false);

  const [form, setForm] = useState({
    nombre: '',
    cedula: '',
    telefono: '',
    imei: '',
    producto: '',
    costoEquipo: '',
    valorCuota: '',
    cuotaInicial: '',
    numeroCuotas: '',
    fechaInicio: new Date().toISOString().slice(0, 10),
    horaBloqueo: '08:00',
    cuotasPagadas: '0',
  });

  // ─── API ──────────────────────────────────────────────────────────────────

  const loadRecords = useCallback(async () => {
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/financing`);
      if (res.ok) {
        const data = await res.json();
        setRecords(data);
      }
    } catch (err) {
      console.error('[financing] Error loading:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadXiaomiPayments = useCallback(async () => {
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/xiaomi-payments`);
      if (res.ok) setXiaomiPayments(await res.json());
    } catch (err) {
      console.error('[xiaomi-payments] Error loading:', err);
    }
  }, []);

  const loadEquipos = useCallback(async () => {
    const equipos = await blockingApi.getDevices();
    if (!equipos) return;
    const mapa = new Map<string, Device>();
    for (const e of equipos) {
      if (e.imei) mapa.set(e.imei.trim(), e);
    }
    setEquiposPorImei(mapa);
  }, []);

  /** Añade una línea al registro de actividad del panel. */
  const registrarEvento = useCallback((nivel: EventoPanel['nivel'], texto: string) => {
    setEventos(prev => [
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, cuando: Date.now(), nivel, texto },
      ...prev,
    ].slice(0, 25));
  }, []);

  /**
   * Mete un solo equipo en el mapa sin volver a pedir los 115.
   *
   * Es lo que hace que la fila cambie en el acto al pulsar el botón: el
   * servidor ya devuelve el equipo recién actualizado en la misma respuesta.
   */
  const fusionarEquipo = useCallback((device: Device) => {
    const clave = (device.imei || '').trim();
    if (!clave) return;
    setEquiposPorImei(prev => new Map(prev).set(clave, device));
  }, []);

  /**
   * Empieza a seguir una orden hasta que el proveedor la confirme.
   *
   * El bloqueo es de entrega diferida: Trustonic acepta la orden y el teléfono
   * la aplica en su siguiente reporte. Sin esto, la fila se quedaba en "sin
   * confirmar" para siempre hasta que alguien recargaba la página, y el dueño
   * no tenía forma de saber si había funcionado.
   */
  const vigilarOrden = useCallback((device: Device, nombre: string, accion: 'block' | 'unblock') => {
    const t = Date.now();
    setOrdenesEnVuelo(prev => ({
      ...prev,
      [device.id]: { deviceId: device.id, nombre, accion, desde: t, ultimoSondeo: t, sondeos: 0 },
    }));
  }, []);

  useEffect(() => { loadRecords(); loadXiaomiPayments(); loadEquipos(); }, [loadRecords, loadXiaomiPayments, loadEquipos]);

  useEffect(() => {
    blockingApi.getConfig().then(c => { if (c) setConfigBloqueo(c); });
  }, []);

  // Se lee dentro del intervalo. En estado provocaría recrear el intervalo en
  // cada sondeo y el temporizador no llegaría nunca a cumplirse.
  const ordenesRef = useRef(ordenesEnVuelo);
  ordenesRef.current = ordenesEnVuelo;

  /** Identidad estable del conjunto vigilado, para no recrear el intervalo. */
  const idsEnVuelo = Object.keys(ordenesEnVuelo).sort().join(',');

  /**
   * Sondea las órdenes en vuelo y confirma, o avisa de que siguen en cola.
   *
   * Un solo intervalo para todas: cada vuelta decide a quién le toca según
   * `cadenciaDeSondeo`, así que varias órdenes simultáneas no multiplican las
   * llamadas al proveedor.
   */
  useEffect(() => {
    if (!idsEnVuelo) return;
    let vivo = true;

    const vuelta = async () => {
      const t = Date.now();
      for (const orden of Object.values(ordenesRef.current)) {
        const cadencia = cadenciaDeSondeo(t - orden.desde);

        if (cadencia === null) {
          setOrdenesEnVuelo(prev => {
            const siguiente = { ...prev };
            delete siguiente[orden.deviceId];
            return siguiente;
          });
          registrarEvento(
            'aviso',
            `${orden.nombre}: la orden sigue en cola tras ${duracionCorta(t - orden.desde)}. ` +
              'El equipo no se ha conectado; entrará cuando lo haga.'
          );
          continue;
        }

        if (t - orden.ultimoSondeo < cadencia) continue;

        setOrdenesEnVuelo(prev =>
          prev[orden.deviceId]
            ? { ...prev, [orden.deviceId]: { ...prev[orden.deviceId], ultimoSondeo: t, sondeos: prev[orden.deviceId].sondeos + 1 } }
            : prev
        );

        const fresco = await blockingApi.refreshDevice(orden.deviceId);
        if (!vivo || !fresco) continue;
        fusionarEquipo(fresco);

        if (fresco.divergente) continue;

        setOrdenesEnVuelo(prev => {
          const siguiente = { ...prev };
          delete siguiente[orden.deviceId];
          return siguiente;
        });

        const bloqueado = fresco.status === 'blocked';
        const esperado = orden.accion === 'block' ? bloqueado : !bloqueado;
        if (esperado) {
          registrarEvento('ok', `${orden.nombre}: el equipo quedó ${bloqueado ? 'BLOQUEADO' : 'ACTIVO'} (confirmado por el proveedor).`);
          toast.success(`${orden.nombre}: ${bloqueado ? 'bloqueo' : 'desbloqueo'} confirmado por el proveedor.`, { duration: 8000 });
        } else {
          // Convergió al revés de lo pedido: alguien actuó por otro lado.
          registrarEvento('error', `${orden.nombre}: el proveedor dice ${bloqueado ? 'BLOQUEADO' : 'ACTIVO'}, que no es lo que se pidió. Revísalo.`);
          toast.error(`${orden.nombre}: el estado final no coincide con la orden. Revísalo.`, { duration: 12000 });
        }
      }
    };

    const temporizador = setInterval(vuelta, 5000);
    return () => { vivo = false; clearInterval(temporizador); };
  }, [idsEnVuelo, fusionarEquipo, registrarEvento]);

  /** La cuota del diálogo, releída del estado vivo en cada render. */
  const comprobanteEnVista = useMemo(() => {
    if (!comprobanteAbierto) return null;
    const record = records.find(r => r.id === comprobanteAbierto.recordId);
    const cuota = record?.cuotas.find(c => c.number === comprobanteAbierto.cuotaNumber);
    return record && cuota ? { record, cuota } : null;
  }, [comprobanteAbierto, records]);

  /**
   * Igual que `comprobanteEnVista`: el diálogo de prórroga lee la cuota viva.
   *
   * Importa más aquí que en el comprobante. Al conceder un plazo el servidor
   * puede soltar el teléfono, y `loadRecords` reemplaza el array entero: una
   * copia congelada seguiría ofreciendo "Dar prórroga" sobre una cuota que ya
   * la tiene, y el dueño la concedería dos veces sin enterarse.
   */
  const prorrogaEnVista = useMemo(() => {
    if (!prorrogaAbierta) return null;
    const record = records.find(r => r.id === prorrogaAbierta.recordId);
    const cuota = record?.cuotas.find(c => c.number === prorrogaAbierta.cuotaNumber);
    return record && cuota ? { record, cuota } : null;
  }, [prorrogaAbierta, records]);

  /**
   * Reloj de los contadores. Cada segundo mientras haya una orden en vuelo y
   * cada medio minuto si sólo quedan órdenes viejas sin confirmar: un contador
   * congelado hace dudar de si el panel sigue vivo.
   */
  const hayDivergentes = useMemo(
    () => Array.from(equiposPorImei.values()).some(d => d.divergente && d.ordenEnviadaEn),
    [equiposPorImei]
  );

  useEffect(() => {
    const cada = idsEnVuelo ? 1000 : hayDivergentes ? 30_000 : 0;
    if (!cada) return;
    const t = setInterval(() => setAhora(Date.now()), cada);
    return () => clearInterval(t);
  }, [idsEnVuelo, hayDivergentes]);

  /**
   * Relectura de fondo de la lista de equipos.
   *
   * No llama al proveedor, sólo lee Mongo, así que es barato. Sirve para que un
   * cambio hecho desde la pestaña de Bloqueo, desde otro navegador o por la
   * reconciliación automática del servidor (cada 2 min) aparezca aquí sin que
   * nadie recargue.
   */
  useEffect(() => {
    const t = setInterval(() => { loadEquipos(); }, 45_000);
    return () => clearInterval(t);
  }, [loadEquipos]);

  /**
   * Qué se puede hacer con el equipo de esta financiación y por qué.
   *
   * Devuelve `operable: false` con un motivo legible en los casos en los que el
   * botón no debe funcionar, en vez de dejar pulsar y fallar contra el API: un
   * equipo en Nuovo o sin enrolar no se alcanza desde aquí, y descubrirlo
   * después de pulsar "Bloquear" sobre el teléfono de un cliente real es tarde.
   */
  const estadoEquipo = useCallback((record: FinancingRecord) => {
    const device = equiposPorImei.get((record.imei || '').trim());
    if (!device) {
      return { device: null, operable: false, bloqueado: false, motivo: 'Este IMEI todavía no está en CrediLock. Pulsa Verificar para darlo de alta.' };
    }
    // Por plataforma y no por `gestionManual`: el servidor lo calcula como
    // `plataforma !== 'trustonic'`, así que vale 1 también para los que nunca se
    // han consultado. Darlos por "Nuovo" haría que el dueño se fuera al portal
    // equivocado a buscar un equipo que quizá sí se puede operar desde aquí.
    if (device.plataforma === 'nuovo') {
      return { device, operable: false, bloqueado: device.status === 'blocked', motivo: 'El proveedor no lo encontró en Trustonic, así que se opera desde el portal de Nuovo. Si acabas de enrolarlo, pulsa Verificar.' };
    }
    if (device.plataforma !== 'trustonic' || device.gestionManual) {
      return { device, operable: false, bloqueado: device.status === 'blocked', motivo: 'Todavía no se ha consultado al proveedor por este equipo. Pulsa Verificar.' };
    }
    return { device, operable: true, bloqueado: device.status === 'blocked', motivo: '' };
  }, [equiposPorImei]);

  const ejecutarAccion = useCallback(async (record: FinancingRecord, device: Device, accion: 'block' | 'unblock') => {
    setAccionEnCurso(device.id);
    registrarEvento('info', `${record.nombre}: enviando orden de ${accion === 'block' ? 'bloqueo' : 'desbloqueo'}…`);

    const r = accion === 'block'
      ? await blockingApi.blockDevice(device.id, `Manual desde CrediLock — ${record.nombre}`)
      : await blockingApi.unblockDevice(device.id);

    setAccionEnCurso(null);

    if (!r.ok) {
      registrarEvento('error', `${record.nombre}: ${r.mensaje}`);
      toast.error(r.mensaje, { duration: 12000 });
      // Puede haber quedado un error del proveedor guardado en el equipo.
      await loadEquipos();
      return;
    }

    // El servidor devuelve el equipo ya actualizado, así que la fila cambia
    // ahora y no al terminar una recarga de la lista completa.
    if (r.equipo) fusionarEquipo(r.equipo);
    else await loadEquipos();

    // El mensaje lo redacta el servidor y dice cosas que el panel no sabe
    // ("el equipo no reporta desde hace 72 h, entrará cuando se conecte").
    toast[r.pendienteDeEntrega ? 'warning' : 'success'](r.mensaje, { duration: 9000 });
    registrarEvento('info', `${record.nombre}: el proveedor aceptó la orden. Esperando que el equipo la aplique.`);

    // Si no vino equipo en la respuesta no sabemos si convergió, así que se
    // vigila igual: el primer sondeo lo resuelve en segundos.
    if (r.equipo?.divergente ?? true) vigilarOrden(r.equipo ?? device, record.nombre, accion);
  }, [loadEquipos, fusionarEquipo, registrarEvento, vigilarOrden]);

  /**
   * Deja la fila operable sin salir de aquí.
   *
   * Un equipo recién dado de alta en la cartera no existe todavía en CrediLock,
   * y uno que ya existe puede estar sin plataforma resuelta o marcado como Nuovo
   * porque cuando se consultó aún no estaba en Trustonic. Los tres casos se
   * arreglan igual: rehacer la lista desde la cartera y volver a preguntarle al
   * proveedor por ese IMEI. Antes había que ir a otra pestaña a sincronizar y
   * luego a verificar los 115 equipos (un minuto) para desatascar uno.
   */
  const verificarEquipo = useCallback(async (record: FinancingRecord, device: Device | null) => {
    const clave = device?.id ?? `financiacion:${record.id}`;
    setAccionEnCurso(clave);

    let objetivo = device;
    if (!objetivo) {
      const r = await blockingApi.sync();
      if (!r.ok) {
        toast.error(r.mensaje, { duration: 9000 });
        setAccionEnCurso(null);
        return;
      }
      const equipos = await blockingApi.getDevices();
      objetivo = equipos?.find(e => (e.imei || '').trim() === (record.imei || '').trim()) ?? null;
    }

    if (!objetivo) {
      toast.error('El equipo no se creó. Revisa que el IMEI de esta financiación sea correcto.', { duration: 9000 });
      await loadEquipos();
      setAccionEnCurso(null);
      return;
    }

    const fresco = await blockingApi.refreshDevice(objetivo.id);
    await loadEquipos();
    setAccionEnCurso(null);

    if (!fresco) {
      registrarEvento('error', `${record.nombre}: no se pudo consultar al proveedor.`);
      toast.error('No se pudo consultar al proveedor. Inténtalo de nuevo.', { duration: 9000 });
    } else if (fresco.plataforma === 'trustonic') {
      registrarEvento('ok', `${record.nombre}: enrolado en Trustonic, ya se puede operar desde aquí.`);
      toast.success(`${record.nombre}: equipo listo, ya se puede bloquear desde aquí.`, { duration: 9000 });
    } else {
      registrarEvento('aviso', `${record.nombre}: el proveedor no lo encuentra en Trustonic; queda como Nuovo (manual).`);
      toast.warning(`${record.nombre}: el proveedor no encuentra este IMEI en Trustonic. Queda como Nuovo (manual).`, { duration: 12000 });
    }
  }, [loadEquipos, registrarEvento]);

  const handleSave = async () => {
    if (!form.nombre || !form.cedula || !form.telefono || !form.imei || !form.valorCuota || !form.numeroCuotas || !form.fechaInicio) {
      toast.error('Completa todos los campos obligatorios');
      return;
    }
    setSaving(true);
    try {
      const valorCuota = Number(form.valorCuota);
      const numeroCuotas = Number(form.numeroCuotas);
      const cuotaInicial = Number(form.cuotaInicial || 0);
      const costoTotal = (valorCuota * numeroCuotas) + cuotaInicial;

      const payload = {
        nombre: form.nombre,
        cedula: form.cedula,
        telefono: form.telefono,
        imei: form.imei,
        producto: form.producto,
        costoEquipo: Number(form.costoEquipo || 0),
        costoTotal,
        cuotaInicial,
        valorCuota,
        numeroCuotas,
        fechaInicio: new Date(form.fechaInicio).toISOString(),
        horaBloqueo: form.horaBloqueo,
        ...((!editing && Number(form.cuotasPagadas) > 0) ? { cuotasPagadas: Number(form.cuotasPagadas) } : {}),
      };

      const url = editing
        ? `${API_BASE_URL}/financing/${editing.id}`
        : `${API_BASE_URL}/financing`;
      const method = editing ? 'PUT' : 'POST';

      const res = await fetchWithTimeout(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        toast.success(editing ? 'Financiamiento actualizado' : 'Financiamiento creado');
        setDialogOpen(false);
        resetForm();
        await loadRecords();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Error al guardar');
      }
    } catch (err) {
      toast.error('Error de conexión');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este financiamiento?')) return;
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/financing/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Eliminado');
        await loadRecords();
      }
    } catch (err) {
      toast.error('Error al eliminar');
    }
  };

  /**
   * Sube la captura del pago. Reemplazar es la misma llamada: el servidor borra
   * el binario anterior, así que no hay que acordarse de limpiar antes.
   */
  const subirComprobante = async (record: FinancingRecord, cuota: Installment, file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Sube una imagen (captura de pantalla o foto del comprobante).');
      return;
    }
    // Tope generoso en origen: lo que de verdad manda es el tamaño comprimido.
    if (file.size > 12 * 1024 * 1024) {
      toast.error('La imagen es muy grande (máximo 12MB).');
      return;
    }

    const clave = `${record.id}:${cuota.number}`;
    setComprobanteOcupado(clave);
    try {
      /**
       * Comprimido más suave que las fotos del catálogo (0.35MB / 1000px): un
       * comprobante se guarda para LEERLO —valor, fecha, referencia— y a esa
       * calidad los números de una captura de Nequi quedaban borrosos.
       */
      const comprimida = await compressImageFile(file, { maxSizeMB: 0.6, maxWidthOrHeight: 1600 });

      const res = await fetchWithTimeout(
        `${API_BASE_URL}/financing/${record.id}/comprobante/${cuota.number}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: comprimida, filename: file.name }),
        },
        90000
      );

      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        toast.error(data?.error || `No se pudo subir el comprobante (${res.status})`);
        return;
      }

      // La captura anterior ya no existe en el servidor; soltar su blob.
      olvidarComprobante(cuota.comprobante?.mediaId);
      toast.success(`Comprobante de la cuota #${cuota.number} guardado.`);
      await loadRecords();
    } catch {
      toast.error('No se pudo procesar la imagen. Prueba con otro archivo.');
    } finally {
      setComprobanteOcupado(null);
    }
  };

  const eliminarComprobante = async (record: FinancingRecord, cuota: Installment) => {
    if (!confirm(`¿Eliminar el comprobante de la cuota #${cuota.number}?`)) return;

    const clave = `${record.id}:${cuota.number}`;
    setComprobanteOcupado(clave);
    try {
      const res = await fetchWithTimeout(
        `${API_BASE_URL}/financing/${record.id}/comprobante/${cuota.number}`,
        { method: 'DELETE' }
      );
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        // El 409 de "la cuota está pagada" trae una explicación útil; mostrarla
        // entera en vez de un "error al eliminar" que no dice qué hacer.
        toast.error(data?.error || `No se pudo eliminar (${res.status})`, { duration: 9000 });
        return;
      }
      olvidarComprobante(cuota.comprobante?.mediaId);
      setComprobanteAbierto(null);
      toast.success('Comprobante eliminado.');
      await loadRecords();
    } catch {
      toast.error('No se pudo eliminar el comprobante.');
    } finally {
      setComprobanteOcupado(null);
    }
  };

  /**
   * Concede el plazo. También sirve para ampliar uno ya dado: es la misma
   * llamada, el servidor sobreescribe la prórroga anterior y deja constancia de
   * ambas en el log.
   *
   * Lo que se recarga después no es sólo la cartera: una prórroga puede soltar
   * el teléfono, así que `loadEquipos` es obligatorio o la fila seguiría
   * diciendo "BLOQUEADO" sobre un equipo que el proveedor ya liberó.
   */
  const otorgarProrroga = async (
    record: FinancingRecord,
    cuota: Installment,
    hasta: string,
    motivo: string
  ) => {
    const clave = `${record.id}:${cuota.number}`;
    setProrrogaOcupada(clave);
    try {
      const res = await fetchWithTimeout(
        `${API_BASE_URL}/financing/${record.id}/prorroga/${cuota.number}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hasta, motivo: motivo.trim() }),
        },
        // Generoso a propósito: detrás de esto puede haber una orden de
        // desbloqueo a Trustonic, que no siempre responde rápido.
        60000
      );
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        // Los 400 de `validarProrroga` traen el texto exacto que el dueño
        // necesita leer ("revisa el año en la fecha"); no taparlo.
        toast.error(data?.error || `No se pudo dar la prórroga (${res.status})`, { duration: 9000 });
        return;
      }

      const cuando = fechaLarga(hasta);
      registrarEvento(
        'ok',
        `${record.nombre}: prórroga de la cuota #${cuota.number} hasta el ${hasta}` +
          `${data.equipoLiberado ? '. Equipo desbloqueado.' : ''}`
      );
      toast.success(`Plazo hasta el ${cuando}. Se le avisó por WhatsApp.`, { duration: 9000 });

      // Tres avisos distintos y ninguno sustituye al otro: si el equipo no se
      // soltó el cliente sigue con el teléfono muerto pese al plazo, y eso el
      // dueño tiene que saberlo ahora, no cuando el cliente vuelva a llamar.
      if (data.equipoLiberado) {
        toast.success('El equipo quedó desbloqueado mientras dure el plazo.', { duration: 9000 });
      } else if (data.detalleEquipo) {
        toast.warning(`Equipo: ${data.detalleEquipo}`, { duration: 12000 });
      }
      if (data.pisaCuotaSiguiente) {
        toast.warning(
          'Ojo: el plazo se pasa de la fecha de la cuota siguiente. Van a vencer las dos juntas.',
          { duration: 12000 }
        );
      }
      if (Number(data.vecesPedidas) >= 3) {
        toast.warning(
          `Es la prórroga nº ${data.vecesPedidas} de este cliente.`,
          { duration: 12000 }
        );
      }

      setProrrogaAbierta(null);
      await loadRecords();
      await loadEquipos();
    } catch {
      toast.error('No se pudo registrar la prórroga. Revisa la conexión.', { duration: 9000 });
    } finally {
      setProrrogaOcupada(null);
    }
  };

  /**
   * Quita el plazo y devuelve la cuota a su fecha pactada.
   *
   * Se avisa de la consecuencia ANTES de preguntar: si la fecha original ya
   * pasó, anular deja al cliente en mora en el acto y el automatismo puede
   * bloquearle el equipo en su siguiente vuelta. El servidor no bloquea desde
   * aquí, pero el efecto llega igual unos minutos después.
   */
  const anularProrroga = async (record: FinancingRecord, cuota: Installment) => {
    const original = soloFecha(cuota.dueDate);
    const yaVencida = original !== '' && original < hoyEnColombia();
    const advertencia = yaVencida
      ? `\n\n⚠️ La cuota vencía el ${original}, que ya pasó: al anular el plazo el cliente queda en mora y el sistema puede bloquearle el equipo.`
      : '';
    if (!confirm(`¿Anular la prórroga de la cuota #${cuota.number}?${advertencia}`)) return;

    const clave = `${record.id}:${cuota.number}`;
    setProrrogaOcupada(clave);
    try {
      const res = await fetchWithTimeout(
        `${API_BASE_URL}/financing/${record.id}/prorroga/${cuota.number}`,
        { method: 'DELETE' }
      );
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        toast.error(data?.error || `No se pudo anular (${res.status})`, { duration: 9000 });
        return;
      }

      registrarEvento('aviso', `${record.nombre}: anulada la prórroga de la cuota #${cuota.number}.`);
      if (data.volveriaAMora) {
        toast.warning(
          `Prórroga anulada. La cuota vuelve al ${original} y el cliente queda en mora.`,
          { duration: 12000 }
        );
      } else {
        toast.success(`Prórroga anulada. La cuota vuelve a vencer el ${original}.`, { duration: 9000 });
      }

      setProrrogaAbierta(null);
      await loadRecords();
    } catch {
      toast.error('No se pudo anular la prórroga. Revisa la conexión.', { duration: 9000 });
    } finally {
      setProrrogaOcupada(null);
    }
  };

  const handlePayInstallment = async (recordId: string, cuotaNumber: number) => {
    // Preguntar fecha del próximo pago
    const record = records.find(r => r.id === recordId);
    const nextCuota = record?.cuotas.find(c => c.number > cuotaNumber && c.status !== 'paid');

    // Sugerir fecha por defecto: +15 días desde hoy
    const defaultNext = new Date();
    defaultNext.setDate(defaultNext.getDate() + 15);
    const defaultStr = defaultNext.toISOString().slice(0, 10);

    const nextDate = prompt(
      `✅ Cuota #${cuotaNumber} pagada.\n\n📅 ¿Fecha del PRÓXIMO pago?\n(dejar vacío = ${nextCuota ? new Date(nextCuota.dueDate).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', timeZone: 'UTC' }) : defaultStr})`,
      nextCuota ? new Date(nextCuota.dueDate).toISOString().slice(0, 10) : defaultStr
    );

    // Si cancela el prompt, no hacer nada
    if (nextDate === null) return;

    try {
      const body: Record<string, unknown> = {};
      if (nextDate && nextDate.trim()) {
        body.nextDate = new Date(nextDate).toISOString();
      }

      const res = await fetchWithTimeout(`${API_BASE_URL}/financing/${recordId}/pay/${cuotaNumber}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      // Antes un fallo no decía nada: el botón se apagaba y la cuota seguía
      // pendiente. Con el comprobante obligatorio el servidor puede responder
      // 409, y callárselo dejaría al dueño pulsando "Pagar" sin entender nada.
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as any));
        toast.error(data?.error || `No se pudo registrar el pago (${res.status})`, { duration: 9000 });
        return;
      }

      const msg = nextDate && nextDate.trim()
        ? `Cuota #${cuotaNumber} pagada ✅ Próximo pago: ${new Date(nextDate).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', timeZone: 'UTC' })}`
        : `Cuota #${cuotaNumber} marcada como pagada ✅`;
      toast.success(msg);
      await loadRecords();
    } catch (err) {
      toast.error('Error al registrar pago');
    }
  };

  const handleUnpayInstallment = async (recordId: string, cuotaNumber: number) => {
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/financing/${recordId}/unpay/${cuotaNumber}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        toast.success(`Cuota #${cuotaNumber} desmarcada`);
        await loadRecords();
      }
    } catch (err) {
      toast.error('Error al desmarcar');
    }
  };

  const handleSendReminder = async (recordId: string) => {
    setSendingReminder(recordId);
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/financing/${recordId}/remind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success('Recordatorio enviado por WhatsApp ✅');
        await loadRecords();
      } else {
        toast.error(data.error || 'No se pudo enviar');
      }
    } catch (err) {
      toast.error('Error de conexión');
    } finally {
      setSendingReminder(null);
    }
  };

  const handleRunAllReminders = async () => {
    if (!confirm('¿Deseas enviar los recordatorios de cuotas de hoy por WhatsApp a todos los clientes que les corresponde pagar?')) return;
    setRunningReminders(true);
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/financing/reminders/run`, {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success('Envío de recordatorios iniciado por WhatsApp 🚀');
        await loadRecords();
      } else {
        toast.error(data.error || 'Error al iniciar recordatorios');
      }
    } catch {
      toast.error('Error de conexión');
    } finally {
      setRunningReminders(false);
    }
  };

  const handlePayXiaomi = async () => {
    const amount = Number(payXiaomiAmount);
    if (!amount || amount <= 0) { toast.error('Monto inválido'); return; }
    setSavingPayment(true);
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/xiaomi-payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, note: payXiaomiNote }),
      });
      if (res.ok) {
        toast.success('Pago a Xiaomi registrado');
        setShowPayXiaomiDialog(false);
        setPayXiaomiAmount('');
        setPayXiaomiNote('');
        await loadXiaomiPayments();
      }
    } catch { toast.error('Error de conexión'); }
    setSavingPayment(false);
  };

  const handleDeleteXiaomiPayment = async (id: string) => {
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/xiaomi-payments/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Pago eliminado');
        await loadXiaomiPayments();
      }
    } catch { toast.error('Error de conexión'); }
  };


  // ─── Helpers ──────────────────────────────────────────────────────────────

  const resetForm = () => {
    setEditing(null);
    setForm({
      nombre: '', cedula: '', telefono: '', imei: '', producto: '',
      costoEquipo: '', valorCuota: '', cuotaInicial: '', numeroCuotas: '',
      fechaInicio: new Date().toISOString().slice(0, 10),
      horaBloqueo: '08:00',
      cuotasPagadas: '0',
    });
  };

  const openEdit = (record: FinancingRecord) => {
    setEditing(record);
    setForm({
      nombre: record.nombre,
      cedula: record.cedula,
      telefono: record.telefono,
      imei: record.imei,
      producto: record.producto,
      costoEquipo: (record.costoEquipo || 0).toString(),
      valorCuota: record.valorCuota.toString(),
      cuotaInicial: record.cuotaInicial.toString(),
      numeroCuotas: record.numeroCuotas.toString(),
      fechaInicio: record.fechaInicio.slice(0, 10),
      horaBloqueo: record.horaBloqueo || '08:00',
      cuotasPagadas: '0',
    });
    setDialogOpen(true);
  };

  const openCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const valorCuotaNum = Number(form.valorCuota || 0);
  const numeroCuotasNum = Number(form.numeroCuotas || 0);
  const cuotaInicialNum = Number(form.cuotaInicial || 0);
  const cuotasPagadasNum = Number(form.cuotasPagadas || 0);
  const totalPreview = (valorCuotaNum * numeroCuotasNum) + cuotaInicialNum;
  const cuotasRestantes = Math.max(0, numeroCuotasNum - cuotasPagadasNum);
  const restantePorPagar = cuotasRestantes * valorCuotaNum;

  // ─── Filtered & sorted data ──────────────────────────────────────────────

  const filteredRecords = useMemo(() => {
    let filtered = records;

    // Filtro por estado
    if (filterStatus === 'active') {
      filtered = filtered.filter(r => r.status === 'active');
    } else if (filterStatus === 'completed') {
      filtered = filtered.filter(r => r.status === 'completed');
    } else if (filterStatus === 'overdue') {
      filtered = filtered.filter(r =>
        r.status === 'active' && r.cuotas.some(c => c.status === 'overdue')
      );
    } else if (filterStatus === 'prorroga') {
      // Los que no salen ni en "Activos al día" ni en "Vencidos": se les dio
      // plazo y hay que volver a mirarlos el día que se cumpla.
      filtered = filtered.filter(r =>
        r.status === 'active' && r.cuotas.some(c => prorrogaVigente(c))
      );
    }

    // Filtro por búsqueda
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(r =>
        r.nombre.toLowerCase().includes(q) ||
        r.cedula.includes(q) ||
        r.telefono.includes(q) ||
        r.imei.includes(q) ||
        r.producto.toLowerCase().includes(q)
      );
    }

    // Ordenar: los que tienen cuotas más próximas a vencer primero
    return filtered.sort((a, b) => {
      const nextA = a.cuotas.find(c => c.status !== 'paid');
      const nextB = b.cuotas.find(c => c.status !== 'paid');
      if (!nextA && !nextB) return 0;
      if (!nextA) return 1; // a completado, va al final
      if (!nextB) return -1;
      // Por la fecha efectiva: a quien se le dio plazo hasta el 25 no tiene que
      // seguir apareciendo arriba de la lista como si venciera el 10.
      return fechaLimite(nextA).localeCompare(fechaLimite(nextB));
    });
  }, [records, search, filterStatus]);

  // ─── KPIs ──────────────────────────────────────────────────────────────────

  const kpis = useMemo(() => {
    const active = records.filter(r => r.status === 'active');
    const overdue = records.filter(r =>
      r.status === 'active' && r.cuotas.some(c => c.status === 'overdue')
    );

    // 💰 DINERO EN LA CALLE — todo lo que falta por cobrar de TODOS los clientes
    const dineroEnLaCalle = records.reduce((sum, r) => {
      const cuotasPendientes = r.cuotas.filter(c => c.status !== 'paid').length;
      return sum + cuotasPendientes * r.valorCuota;
    }, 0);

    // 💵 TOTAL RECAUDADO — todo lo que ya se cobró (incluye cuotas previas + pagadas en sistema)
    const totalRecaudado = records.reduce((sum, r) => {
      const previas = r.cuotasPrevias || 0;
      const cuotasPagadas = r.cuotas.filter(c => c.status === 'paid').length;
      return sum + (previas + cuotasPagadas) * r.valorCuota + r.cuotaInicial;
    }, 0);

    /*
     * 📅 COBRO HOY — cuotas que vencen hoy (pendientes)
     *
     * Dos arreglos sobre lo que había. `hoyEnColombia` y no
     * `new Date().toISOString()`: en UTC-5, entre medianoche y las 5 de la
     * mañana el UTC ya es el día siguiente, así que la tarjeta mostraba el
     * cobro de mañana a quien abría el panel temprano. Y `fechaLimite` en vez
     * de `dueDate`: lo que se cobra hoy es lo que vence hoy de verdad, así que
     * una cuota con prórroga sale de aquí y entra el día del plazo.
     */
    const todayStr = hoyEnColombia();
    const cobroHoy = records.reduce((sum, r) => {
      const cuotasHoy = r.cuotas.filter(c => c.status !== 'paid' && fechaLimite(c) === todayStr);
      return sum + cuotasHoy.length * r.valorCuota;
    }, 0);

    /**
     * Clientes con plazo abierto ahora mismo. No es decorativo: son los que no
     * salen en "En mora" porque se les dio tiempo, y si nadie los mira se
     * convierten en 113 clientes menos los que el dueño recuerda de memoria.
     */
    const conProrroga = records.filter(
      r => r.status === 'active' && r.cuotas.some(c => prorrogaVigente(c, todayStr))
    );

    // 🔴 CUOTAS VENCIDAS — total en dinero de cuotas vencidas sin pagar
    const totalVencido = records.reduce((sum, r) => {
      const cuotasVencidas = r.cuotas.filter(c => c.status === 'overdue').length;
      return sum + cuotasVencidas * r.valorCuota;
    }, 0);

    // 🏪 DEUDA CON XIAOMI
    // Fórmula: sum(costoEquipo) - sum(cuotaInicial) - sum(abonos a Xiaomi)
    // La cuota inicial la agarra Xiaomi de una vez (auto-restada).
    // Abonos = pagos ADICIONALES hechos a Xiaomi (NO incluir cuotas iniciales).
    const costoTotalEquipos = records.reduce((sum, r) => sum + (r.costoEquipo || 0), 0);
    const totalCuotasIniciales = records.reduce((sum, r) => sum + (r.cuotaInicial || 0), 0);
    const totalPagadoXiaomi = xiaomiPayments.reduce((sum, p) => sum + p.amount, 0);
    const deudaXiaomi = Math.max(0, costoTotalEquipos - totalCuotasIniciales - totalPagadoXiaomi);
    const desgloseDeuda = records.map(r => {
      const costoEquipo = r.costoEquipo || 0;
      const cuotaInicial = r.cuotaInicial || 0;
      const pendiente = Math.max(0, costoEquipo - cuotaInicial);
      return { nombre: r.nombre, costoEquipo, cuotaInicial, pendiente, totalCuotas: r.numeroCuotas };
    }).filter(d => d.costoEquipo > 0).sort((a, b) => b.pendiente - a.pendiente);

    // 💚 GANANCIA — lo recaudado que ya NO le pertenece a Xiaomi (es ganancia pura)
    const ganancia = records.reduce((sum, r) => {
      const costoEquipo = r.costoEquipo || 0;
      const previas = r.cuotasPrevias || 0;
      const cuotasPagadas = r.cuotas.filter(c => c.status === 'paid').length;
      const pagado = r.cuotaInicial + ((previas + cuotasPagadas) * r.valorCuota);
      const profit = Math.max(0, pagado - costoEquipo);
      return sum + profit;
    }, 0);

    return {
      total: records.length,
      active: active.length,
      overdue: overdue.length,
      conProrroga: conProrroga.length,
      completed: records.filter(r => r.status === 'completed').length,
      dineroEnLaCalle,
      totalRecaudado,
      cobroHoy,
      totalVencido,
      deudaXiaomi,
      totalPagadoXiaomi,
      desgloseDeuda,
      ganancia,
    };
  }, [records, xiaomiPayments]);

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <CreditCard className="w-6 h-6 sm:w-7 sm:h-7 text-orange-500 shrink-0" />
            CrediLock
          </h2>
          <p className="text-sm text-gray-500 mt-1">Control de cuotas quincenales con recordatorios automáticos por WhatsApp</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <Button
            onClick={handleRunAllReminders}
            disabled={runningReminders}
            className="w-full sm:w-auto bg-green-600 hover:bg-green-700 text-white gap-2 font-semibold shadow-sm"
          >
            <Bell className="w-4 h-4" />
            {runningReminders ? 'Iniciando...' : 'Enviar Recordatorios de Hoy'}
          </Button>
          <Button onClick={openCreate} className="w-full sm:w-auto bg-orange-500 hover:bg-orange-600 text-white gap-2">
            <Plus className="w-4 h-4" /> Nuevo Financiamiento
          </Button>
        </div>
      </div>

      {/* ── 📱 Estado del WhatsApp de cobranza ──────────────────────────
          Va ARRIBA de los KPIs a propósito: si el canal está caído no se envía
          ningún recordatorio, y eso importa más que cualquier cifra de la pantalla. */}
      <CredilockWhatsAppCard />

      {/* ── 💰 DINERO EN LA CALLE — Card grande y prominente ──────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div className="bg-gradient-to-br from-orange-500 to-red-500 rounded-2xl p-4 sm:p-5 text-white shadow-lg md:col-span-1">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="w-6 h-6 opacity-80 shrink-0" />
            <span className="text-sm font-bold uppercase tracking-wider opacity-80">Cuotas Pendientes por Cobrar</span>
          </div>
          {/* break-words: un importe como $12.345.678 no tiene espacios donde partir
              y a text-3xl se salía de la tarjeta en pantallas de 360px. */}
          <p className="text-2xl sm:text-3xl font-black break-words">{formatCurrency(kpis.dineroEnLaCalle)}</p>
          <p className="text-xs opacity-70 mt-1">Total de cuotas pendientes de todos los clientes</p>
        </div>
        <div className="bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl p-4 sm:p-5 text-white shadow-lg md:col-span-1">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle className="w-6 h-6 opacity-80 shrink-0" />
            <span className="text-sm font-bold uppercase tracking-wider opacity-80">Total Recaudado</span>
          </div>
          <p className="text-2xl sm:text-3xl font-black break-words">{formatCurrency(kpis.totalRecaudado)}</p>
          <p className="text-xs opacity-70 mt-1">Dinero cobrado hasta hoy</p>
        </div>
        <div className="bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl p-4 sm:p-5 text-white shadow-lg md:col-span-1">
          <div className="flex items-center gap-2 mb-1">
            <CalendarDays className="w-6 h-6 opacity-80 shrink-0" />
            <span className="text-sm font-bold uppercase tracking-wider opacity-80">Cobro del Día</span>
          </div>
          <p className="text-2xl sm:text-3xl font-black break-words">{formatCurrency(kpis.cobroHoy)}</p>
          <p className="text-xs opacity-70 mt-1">Dinero que se debe recoger hoy</p>
        </div>
      </div>

      {/* ── 🏪 Deuda Xiaomi vs Ganancia ──────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <div className="bg-gradient-to-br from-yellow-500 to-amber-600 rounded-2xl p-4 text-white shadow-lg">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-2 min-w-0">
              <Smartphone className="w-5 h-5 opacity-80 shrink-0" />
              <span className="text-sm font-bold uppercase tracking-wider opacity-80">Por pagar a Xiaomi</span>
            </div>
            <button
              onClick={() => setShowPayXiaomiDialog(true)}
              className="flex h-11 shrink-0 items-center gap-1 rounded-full bg-white/20 px-3 text-xs font-bold text-white backdrop-blur-sm transition-colors hover:bg-white/30 sm:h-auto sm:py-1"
            >
              <Minus className="w-3 h-3" /> Pagos
            </button>
          </div>
          <p className="text-2xl font-black break-words">{formatCurrency(kpis.deudaXiaomi)}</p>
          {kpis.totalPagadoXiaomi > 0 && (
            <p className="text-xs opacity-70 mt-0.5 break-words">Abonado: {formatCurrency(kpis.totalPagadoXiaomi)}</p>
          )}
          {/* py-2 en el móvil: el enlace medía 16px de alto, imposible de
              acertar con el dedo. No usa el Button de ui/, así que las reglas
              táctiles de styles/admin.css no lo alcanzan. */}
          <button
            onClick={() => setShowDeudaDesglose(!showDeudaDesglose)}
            className="mt-0.5 inline-flex min-h-11 items-center text-left text-xs underline opacity-70 transition-opacity hover:opacity-100 sm:min-h-0"
          >
            {showDeudaDesglose ? '▲ Ocultar desglose' : '▼ Ver desglose por cliente'}
          </button>
        </div>
        <div className="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl p-4 text-white shadow-lg">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="w-5 h-5 opacity-80 shrink-0" />
            <span className="text-sm font-bold uppercase tracking-wider opacity-80">Ganancia CrediLock</span>
          </div>
          <p className="text-2xl font-black break-words">{formatCurrency(kpis.ganancia)}</p>
          <p className="text-xs opacity-70 mt-1">Dinero recaudado que ya es ganancia tuya</p>
        </div>
      </div>

      {/* ── Desglose deuda Xiaomi ─────────────────────────────────────────── */}
      {showDeudaDesglose && (
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden mb-4">
          <div className="bg-amber-50 px-4 py-2 border-b">
            <p className="text-sm font-bold text-amber-800">Desglose: Deuda por cliente</p>
            <p className="text-[10px] text-amber-600">Costo equipo − Cuota inicial (Xiaomi la toma de una vez) = Pendiente</p>
          </div>
          {/*
            MÓVIL: tarjetas. Las cuatro columnas sumaban 1fr + 300px fijos, así que a
            360px los tres importes quedaban fuera de la pantalla — y son justo el
            dato que se viene a consultar aquí. La rejilla sigue viva de md arriba.
          */}
          <ul className="divide-y divide-gray-200 max-h-80 overflow-y-auto md:hidden">
            {kpis.desgloseDeuda.map((d, i) => (
              <li key={i} className={`px-4 py-3 ${d.pendiente === 0 ? 'bg-green-50/50' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 flex-1 text-sm font-medium text-gray-900 capitalize break-words">{d.nombre.toLowerCase()}</span>
                  <span className={`shrink-0 text-sm font-bold ${d.pendiente > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {d.pendiente > 0 ? formatCurrency(d.pendiente) : '✅ $0'}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
                  <span>Equipo: <span className="text-gray-700">{formatCurrency(d.costoEquipo)}</span></span>
                  <span>Inicial: <span className="font-medium text-green-600">{formatCurrency(d.cuotaInicial)}</span></span>
                </div>
              </li>
            ))}
            <li className="bg-amber-50 px-4 py-3 text-sm font-bold border-t-2 border-amber-200">
              <div className="flex items-center justify-between gap-2">
                <span className="text-amber-800">SUBTOTAL PENDIENTE</span>
                <span className="shrink-0 text-red-700">{formatCurrency(kpis.desgloseDeuda.reduce((s, d) => s + d.pendiente, 0))}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs font-normal text-gray-500">
                <span>Equipos: <span className="text-gray-700">{formatCurrency(kpis.desgloseDeuda.reduce((s, d) => s + d.costoEquipo, 0))}</span></span>
                <span>Iniciales: <span className="font-medium text-green-700">{formatCurrency(kpis.desgloseDeuda.reduce((s, d) => s + d.cuotaInicial, 0))}</span></span>
              </div>
            </li>
            {kpis.totalPagadoXiaomi > 0 && (
              <li className="flex items-center justify-between gap-2 bg-green-50 px-4 py-3 text-sm font-bold">
                <span className="text-green-800">− Abonos a Xiaomi</span>
                <span className="shrink-0 text-green-700">−{formatCurrency(kpis.totalPagadoXiaomi)}</span>
              </li>
            )}
            <li className="flex items-center justify-between gap-2 bg-red-50 px-4 py-3 text-base font-black border-t-2 border-red-300">
              <span className="text-red-800">DEUDA TOTAL</span>
              <span className="shrink-0 text-red-700">{formatCurrency(kpis.deudaXiaomi)}</span>
            </li>
          </ul>

          <div className="hidden divide-y max-h-80 overflow-y-auto md:block">
            <div className="grid grid-cols-[1fr_100px_100px_100px] gap-1 px-4 py-2 bg-gray-50 text-[10px] font-bold text-gray-500 uppercase">
              <span>Cliente</span>
              <span className="text-right">Costo Equipo</span>
              <span className="text-right">Cuota Inicial</span>
              <span className="text-right">Pendiente</span>
            </div>
            {kpis.desgloseDeuda.map((d, i) => (
              <div key={i} className={`grid grid-cols-[1fr_100px_100px_100px] gap-1 px-4 py-2 text-sm ${d.pendiente === 0 ? 'bg-green-50/50' : ''}`}>
                <span className="font-medium text-gray-900 truncate capitalize">{d.nombre.toLowerCase()}</span>
                <span className="text-right text-gray-600">{formatCurrency(d.costoEquipo)}</span>
                <span className="text-right text-green-600 font-medium">{formatCurrency(d.cuotaInicial)}</span>
                <span className={`text-right font-bold ${d.pendiente > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {d.pendiente > 0 ? formatCurrency(d.pendiente) : '✅ $0'}
                </span>
              </div>
            ))}
            <div className="grid grid-cols-[1fr_100px_100px_100px] gap-1 px-4 py-2 bg-amber-50 font-bold text-sm border-t-2 border-amber-200">
              <span className="text-amber-800">SUBTOTAL</span>
              <span className="text-right text-gray-700">{formatCurrency(kpis.desgloseDeuda.reduce((s, d) => s + d.costoEquipo, 0))}</span>
              <span className="text-right text-green-700">{formatCurrency(kpis.desgloseDeuda.reduce((s, d) => s + d.cuotaInicial, 0))}</span>
              <span className="text-right text-red-700">{formatCurrency(kpis.desgloseDeuda.reduce((s, d) => s + d.pendiente, 0))}</span>
            </div>
            {kpis.totalPagadoXiaomi > 0 && (
              <div className="grid grid-cols-[1fr_100px_100px_100px] gap-1 px-4 py-2 bg-green-50 font-bold text-sm">
                <span className="text-green-800">− Abonos a Xiaomi</span>
                <span></span>
                <span></span>
                <span className="text-right text-green-700">−{formatCurrency(kpis.totalPagadoXiaomi)}</span>
              </div>
            )}
            <div className="grid grid-cols-[1fr_100px_100px_100px] gap-1 px-4 py-3 bg-red-50 font-black text-base border-t-2 border-red-300">
              <span className="text-red-800">DEUDA TOTAL</span>
              <span></span>
              <span></span>
              <span className="text-right text-red-700">{formatCurrency(kpis.deudaXiaomi)}</span>
            </div>
          </div>
        </div>
      )}

      {/* ── KPI Cards secundarios ────────────────────────────────────────── */}
      {/* La quinta columna sólo existe si hay prórrogas vivas; el resto de los
          días el panel se queda igual que estaba. */}
      <div className={`grid grid-cols-2 gap-3 mb-6 ${kpis.conProrroga > 0 ? 'md:grid-cols-5' : 'md:grid-cols-4'}`}>
        <KpiCard icon={<Users className="w-5 h-5" />} label="Clientes" value={kpis.total} color="blue" />
        <KpiCard icon={<Clock className="w-5 h-5" />} label="Activos" value={kpis.active} color="orange" />
        <KpiCard icon={<AlertTriangle className="w-5 h-5" />} label="En mora" value={`${kpis.overdue} (${formatCurrency(kpis.totalVencido)})`} color="red" />
        {kpis.conProrroga > 0 && (
          <KpiCard icon={<Hourglass className="w-5 h-5" />} label="Con prórroga" value={kpis.conProrroga} color="amber" />
        )}
        <KpiCard icon={<CheckCircle className="w-5 h-5" />} label="Completados" value={kpis.completed} color="green" />
      </div>

      {/* ── Filters ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Buscar por nombre, cédula, IMEI, teléfono..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        {/* flex-wrap + flex-1: los cuatro filtros no caben en una línea de 360px y
            sin envoltura el último se salía del contenedor. */}
        {/* "Con prórroga" sólo aparece cuando hay alguna: un filtro que siempre
            devuelve cero ocupa sitio y enseña a ignorarlo. */}
        <div className="flex flex-wrap gap-2">
          {(['all', 'active', 'overdue', 'prorroga', 'completed'] as const)
            .filter(s => s !== 'prorroga' || kpis.conProrroga > 0 || filterStatus === 'prorroga')
            .map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`h-11 flex-1 whitespace-nowrap rounded-lg px-3 text-xs font-semibold transition-all sm:h-auto sm:flex-none sm:py-2 ${
                filterStatus === s
                  ? s === 'prorroga' ? 'bg-amber-500 text-white' : 'bg-orange-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {s === 'all' ? 'Todos'
                : s === 'active' ? 'Activos'
                : s === 'overdue' ? 'Vencidos'
                : s === 'prorroga' ? `⏳ Con prórroga (${kpis.conProrroga})`
                : 'Completados'}
            </button>
          ))}
        </div>
      </div>

      <PanelActividad
        ordenes={Object.values(ordenesEnVuelo)}
        eventos={eventos}
        config={configBloqueo}
        equipos={equiposPorImei}
        ahora={ahora}
        onRefrescar={loadEquipos}
      />

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      {filteredRecords.length === 0 ? (
        <div className="text-center py-16 bg-gray-50 rounded-xl">
          <Smartphone className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500 font-medium">
            {records.length === 0 ? 'No hay financiamientos registrados' : 'Sin resultados para esta búsqueda'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
          {/* Header de tabla — solo desktop */}
          <div className="hidden lg:grid lg:grid-cols-[minmax(130px,1fr)_90px_105px_135px_85px_85px_95px_80px_100px_140px_36px] gap-2 px-4 py-3 bg-gray-50 border-b text-xs font-bold text-gray-500 uppercase tracking-wider">
            <span>Nombre</span>
            <span>Cédula</span>
            <span>Teléfono</span>
            <span>IMEI</span>
            <span>C. Inicial</span>
            <span>Cuota</span>
            <span>Total</span>
            <span>Pagadas</span>
            <span>Próx. Pago</span>
            <span>Equipo</span>
            <span></span>
          </div>

          {filteredRecords.map(record => {
            const isExpanded = expandedId === record.id;
            const nextPending = record.cuotas.find(c => c.status !== 'paid');
            const paidInSystem = record.cuotas.filter(c => c.status === 'paid').length;
            const previas = record.cuotasPrevias || 0;
            const paidCount = previas + paidInSystem; // Total pagadas (previas + en sistema)
            const hasOverdue = record.cuotas.some(c => c.status === 'overdue');
            const totalPagado = paidCount * record.valorCuota + record.cuotaInicial;
            const totalRestante = record.costoTotal - totalPagado;

            /**
             * El plazo que tiene abierto ahora mismo, si tiene alguno.
             *
             * Se mira sobre la próxima cuota pendiente porque es la única que
             * decide si este cliente aparece en mora: las de más adelante aún no
             * vencen y las pagadas ya no cuentan.
             */
            const prorrogaActiva = nextPending ? prorrogaVigente(nextPending) : null;

            /**
             * `fechaLimite` y no `dueDate`: una cuota con el plazo abierto hasta
             * hoy vence HOY, no el día que decía el contrato. Leyendo `dueDate`
             * la fila se pintaba con la fecha pactada y el dueño llamaba a un
             * cliente al que él mismo le había dado tiempo.
             */
            const isDueToday = Boolean(
              nextPending && nextPending.status !== 'paid' && fechaLimite(nextPending) === hoyEnColombia()
            );
            const equipo = estadoEquipo(record);

            return (
              <div key={record.id} className={`border-b last:border-b-0 transition-colors ${hasOverdue ? 'bg-red-50/50' : (isDueToday || prorrogaActiva) ? 'bg-amber-50/50' : ''}`}>
                {/* Row principal */}
                <div
                  className="grid grid-cols-1 lg:grid-cols-[minmax(130px,1fr)_90px_105px_135px_85px_85px_95px_80px_100px_140px_36px] gap-2 px-4 py-3 cursor-pointer hover:bg-gray-50/80 items-center"
                  onClick={() => setExpandedId(isExpanded ? null : record.id)}
                >
                  {/* Nombre + producto — mobile friendly */}
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      record.status === 'completed' ? 'bg-green-500' : hasOverdue ? 'bg-red-500' : isDueToday ? 'bg-amber-500 animate-pulse' : 'bg-orange-500'
                    }`} />
                    <div className="min-w-0">
                      <span className="font-semibold text-gray-900 text-sm block truncate">{record.nombre}</span>
                      <span className="text-xs text-gray-400 truncate block lg:hidden">{record.producto}</span>
                    </div>
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400 ml-auto lg:hidden" /> : <ChevronDown className="w-4 h-4 text-gray-400 ml-auto lg:hidden" />}
                  </div>

                  {/* Datos en desktop */}
                  <span className="hidden lg:block text-sm text-gray-600 truncate">{record.cedula}</span>
                  <span className="hidden lg:block text-sm text-gray-600">{record.telefono}</span>
                  <span className="hidden lg:block text-xs text-gray-500 font-mono truncate">{record.imei}</span>
                  <span className="hidden lg:block text-sm font-medium text-gray-700">{formatCurrency(record.cuotaInicial)}</span>
                  <span className="hidden lg:block text-sm font-bold text-orange-600">{formatCurrency(record.valorCuota)}</span>
                  <span className="hidden lg:block text-sm font-bold text-gray-900">{formatCurrency(record.costoTotal)}</span>
                  <span className="hidden lg:block text-sm text-gray-700">
                    <span className="font-bold text-orange-600">{paidCount}</span>
                    <span className="text-gray-400">/{record.numeroCuotas}</span>
                  </span>
                  {/*
                    Orden de prioridad: la prórroga va ANTES que la mora a
                    propósito. Es lo que pidió el dueño —"que en vez de
                    bloqueado salga prórroga y la fecha"— y además es lo cierto:
                    mientras el plazo siga abierto el servidor no marca la cuota
                    como vencida y el automatismo no bloquea nada.
                  */}
                  <span className="hidden lg:block text-xs">
                    {!nextPending ? (
                      <span className="px-2 py-1 rounded-full bg-green-100 text-green-700 font-semibold">Pagado</span>
                    ) : prorrogaActiva ? (
                      <span
                        className="inline-flex flex-col items-start px-2 py-1 rounded-lg bg-amber-500 text-white font-bold leading-tight"
                        title={`Prórroga hasta el ${fechaLarga(prorrogaActiva.hasta)} (${cuantoFalta(soloFecha(prorrogaActiva.hasta))}). La cuota vencía el ${soloFecha(nextPending.dueDate)}.`}
                      >
                        <span>⏳ PRÓRROGA</span>
                        <span className="text-[10px] font-semibold">
                          hasta {formatDate(prorrogaActiva.hasta)}
                        </span>
                      </span>
                    ) : nextPending.status === 'overdue' ? (
                      <span className="px-2 py-1 rounded-full bg-red-600 text-white font-bold">
                        ⚠️ EN MORA
                      </span>
                    ) : isDueToday ? (
                      <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-700 font-bold animate-pulse">
                        📅 CUOTA HOY
                      </span>
                    ) : (
                      <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-700 font-semibold">
                        {formatDate(fechaLimite(nextPending))}
                      </span>
                    )}
                  </span>
                  <span className="hidden lg:block" onClick={e => e.stopPropagation()}>
                    <ControlEquipo
                      estado={equipo}
                      trabajando={accionEnCurso === (equipo.device?.id ?? `financiacion:${record.id}`)}
                      enVuelo={Boolean(equipo.device && ordenesEnVuelo[equipo.device.id])}
                      ahora={ahora}
                      onBloquear={() => setPorConfirmar({ record, device: equipo.device! })}
                      onDesbloquear={() => ejecutarAccion(record, equipo.device!, 'unblock')}
                      onVerificar={() => verificarEquipo(record, equipo.device)}
                    />
                  </span>
                  <span className="hidden lg:flex items-center justify-end">
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                  </span>
                </div>

                {/* Mobile summary row */}
                <div className="lg:hidden px-4 pb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 items-center">
                  <span>CC: {record.cedula}</span>
                  <span>Tel: {record.telefono}</span>
                  <span>IMEI: {record.imei.slice(0, 10)}...</span>
                  <span className="font-bold text-gray-700">{formatCurrency(record.costoTotal)}</span>
                  <span>Cuotas: <span className="text-orange-600 font-bold">{paidCount}/{record.numeroCuotas}</span></span>
                  {/* Misma prioridad que en desktop: el plazo manda sobre la mora. */}
                  {prorrogaActiva ? (
                    <span className="px-2 py-0.5 rounded-full bg-amber-500 text-white font-bold">
                      ⏳ PRÓRROGA hasta {formatDate(prorrogaActiva.hasta)}
                    </span>
                  ) : hasOverdue ? (
                    <span className="px-2 py-0.5 rounded-full bg-red-600 text-white font-bold">⚠️ EN MORA</span>
                  ) : isDueToday ? (
                    <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold animate-pulse">📅 CUOTA HOY</span>
                  ) : null}
                  <span className="w-full" onClick={e => e.stopPropagation()}>
                    <ControlEquipo
                      estado={equipo}
                      trabajando={accionEnCurso === (equipo.device?.id ?? `financiacion:${record.id}`)}
                      enVuelo={Boolean(equipo.device && ordenesEnVuelo[equipo.device.id])}
                      ahora={ahora}
                      onBloquear={() => setPorConfirmar({ record, device: equipo.device! })}
                      onDesbloquear={() => ejecutarAccion(record, equipo.device!, 'unblock')}
                      onVerificar={() => verificarEquipo(record, equipo.device)}
                    />
                  </span>
                </div>

                {/* ── Panel expandido con cuotas ──────────────────────────── */}
                {isExpanded && (
                  <div className="px-4 pb-4 bg-gray-50/70 border-t border-gray-100 animate-in fade-in slide-in-from-top-1 duration-200">
                    {/* Resumen */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 py-4">
                      <div className="bg-white rounded-lg p-3 border">
                        <p className="text-xs text-gray-400">Producto</p>
                        <p className="font-semibold text-sm text-gray-900 truncate">{record.producto || '—'}</p>
                      </div>
                      <div className="bg-white rounded-lg p-3 border">
                        <p className="text-xs text-gray-400">Valor cuota</p>
                        <p className="font-bold text-sm text-orange-600">{formatCurrency(record.valorCuota)}</p>
                      </div>
                      <div className="bg-white rounded-lg p-3 border">
                        <p className="text-xs text-gray-400">Total pagado</p>
                        <p className="font-bold text-sm text-green-600">{formatCurrency(totalPagado)}</p>
                      </div>
                      <div className="bg-white rounded-lg p-3 border border-red-200">
                        <p className="text-xs text-gray-400">🔒 Hora bloqueo</p>
                        <p className="font-bold text-sm text-red-600">{record.horaBloqueo || '08:00'}</p>
                      </div>
                      <div className="bg-white rounded-lg p-3 border">
                        <p className="text-xs text-gray-400">Restante</p>
                        <p className="font-bold text-sm text-red-600">{formatCurrency(totalRestante > 0 ? totalRestante : 0)}</p>
                      </div>
                    </div>

                    {/* Barra de progreso */}
                    <div className="mb-4">
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>Progreso</span>
                        <span className="font-bold">{Math.round((paidCount / record.numeroCuotas) * 100)}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2.5">
                        <div
                          className="bg-gradient-to-r from-orange-500 to-green-500 h-2.5 rounded-full transition-all duration-500"
                          style={{ width: `${(paidCount / record.numeroCuotas) * 100}%` }}
                        />
                      </div>
                    </div>

                    {/* Tabla de cuotas */}
                    <div className="bg-white rounded-lg border overflow-hidden mb-4">
                      {/*
                        MÓVIL: una tarjeta por cuota. Las cinco columnas de la rejilla
                        sumaban unos 440px y el botón "Pagar" —la acción más repetida
                        del módulo— caía fuera de la pantalla: había que arrastrar de
                        lado en cada cuota para llegar a él.
                      */}
                      <ul className="divide-y md:hidden">
                        {record.cuotas.map(cuota => (
                          <li
                            key={cuota.number}
                            className={`flex items-center gap-3 px-3 py-3 ${
                              cuota.status === 'paid' ? 'bg-green-50/50' :
                              prorrogaVigente(cuota) ? 'bg-amber-50/60' :
                              cuota.status === 'overdue' ? 'bg-red-50/50' : ''
                            }`}
                          >
                            <span className="w-6 shrink-0 font-mono font-bold text-gray-500">{cuota.number}</span>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm"><FechaCuota cuota={cuota} /></p>
                              <p className="text-xs font-bold text-orange-600">{formatCurrency(record.valorCuota)}</p>
                              <div className="mt-1 flex items-center gap-1.5">
                                <EstadoCuotaBadge cuota={cuota} />
                                {cuota.status !== 'paid' && (
                                  <ProrrogaCuota
                                    cuota={cuota}
                                    ocupado={prorrogaOcupada === `${record.id}:${cuota.number}`}
                                    onAbrir={() => setProrrogaAbierta({ recordId: record.id, cuotaNumber: cuota.number })}
                                  />
                                )}
                              </div>
                              {/* El comprobante va aquí, bajo el estado: en una
                                  fila de 360px no cabe como cuarta columna sin
                                  empujar "Pagar" fuera de la pantalla, que es
                                  justo lo que esta lista vino a arreglar. */}
                              <div className="mt-2">
                                <ComprobanteCuota
                                  record={record}
                                  cuota={cuota}
                                  ocupado={comprobanteOcupado === `${record.id}:${cuota.number}`}
                                  onSubir={file => subirComprobante(record, cuota, file)}
                                  onVer={() => setComprobanteAbierto({ recordId: record.id, cuotaNumber: cuota.number })}
                                />
                              </div>
                            </div>
                            {cuota.status === 'paid' ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleUnpayInstallment(record.id, cuota.number); }}
                                aria-label={`Desmarcar cuota ${cuota.number}`}
                                className="flex min-h-11 shrink-0 items-center gap-1 px-2 text-xs text-gray-400 transition-colors hover:text-red-500"
                              >
                                <RotateCcw className="w-4 h-4" /> Desmarcar
                              </button>
                            ) : (
                              <button
                                disabled={!cuota.comprobante?.mediaId}
                                title={cuota.comprobante?.mediaId ? undefined : 'Sube primero la captura del pago'}
                                onClick={(e) => { e.stopPropagation(); handlePayInstallment(record.id, cuota.number); }}
                                aria-label={`Pagar cuota ${cuota.number}`}
                                className="flex min-h-11 shrink-0 items-center gap-1 rounded-lg bg-green-500 px-3 text-xs font-bold text-white transition-colors hover:bg-green-600 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500 disabled:hover:bg-gray-300"
                              >
                                <CheckCircle className="w-4 h-4" /> Pagar
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>

                      <div className="hidden md:block">
                        <div className="grid grid-cols-[48px_1fr_100px_112px_104px_132px_140px] gap-2 px-3 py-2 bg-gray-100 text-xs font-bold text-gray-500 uppercase">
                          <span>#</span>
                          <span>Fecha de Pago</span>
                          <span>Valor</span>
                          <span>Estado</span>
                          <span>Pagado el</span>
                          <span>Comprobante</span>
                          <span>Acción</span>
                        </div>
                        {record.cuotas.map(cuota => (
                          <div
                            key={cuota.number}
                            className={`grid grid-cols-[48px_1fr_100px_112px_104px_132px_140px] gap-2 px-3 py-2.5 border-t items-center text-sm ${
                              cuota.status === 'paid' ? 'bg-green-50/50' :
                              prorrogaVigente(cuota) ? 'bg-amber-50/60' :
                              cuota.status === 'overdue' ? 'bg-red-50/50' : ''
                            }`}
                          >
                            <span className="font-mono font-bold text-gray-500">{cuota.number}</span>
                            <FechaCuota cuota={cuota} />
                            <span className="font-bold text-orange-600">{formatCurrency(record.valorCuota)}</span>
                            <span><EstadoCuotaBadge cuota={cuota} /></span>
                            <span className="text-xs text-gray-400">
                              {cuota.paidDate ? formatDate(cuota.paidDate) : '—'}
                            </span>
                            <ComprobanteCuota
                              record={record}
                              cuota={cuota}
                              ocupado={comprobanteOcupado === `${record.id}:${cuota.number}`}
                              onSubir={file => subirComprobante(record, cuota, file)}
                              onVer={() => setComprobanteAbierto({ recordId: record.id, cuotaNumber: cuota.number })}
                            />
                            {/* flex y no un único hijo: en esta celda caben las dos
                                respuestas del cliente —pagar o pedir plazo— y 140px
                                dan para el botón de 78px más el icono de 28px. */}
                            <span className="flex items-center gap-1.5">
                              {cuota.status === 'paid' ? (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleUnpayInstallment(record.id, cuota.number); }}
                                  className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-1 transition-colors"
                                >
                                  <RotateCcw className="w-3 h-3" /> Desmarcar
                                </button>
                              ) : (
                                /*
                                  Gris y bloqueado mientras no haya captura. El
                                  servidor lo rechaza igual, pero dejar el botón
                                  verde y contestar con un error convertiría la
                                  regla en una trampa: aquí se ve antes de
                                  pulsar, y el `title` dice por qué.
                                */
                                <>
                                  <button
                                    disabled={!cuota.comprobante?.mediaId}
                                    title={
                                      cuota.comprobante?.mediaId
                                        ? `Marcar la cuota #${cuota.number} como pagada`
                                        : 'Sube primero la captura del pago'
                                    }
                                    onClick={(e) => { e.stopPropagation(); handlePayInstallment(record.id, cuota.number); }}
                                    className="text-xs bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg font-bold flex items-center gap-1 transition-colors disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500 disabled:hover:bg-gray-300"
                                  >
                                    <CheckCircle className="w-3 h-3" /> Pagar
                                  </button>
                                  <ProrrogaCuota
                                    cuota={cuota}
                                    ocupado={prorrogaOcupada === `${record.id}:${cuota.number}`}
                                    onAbrir={() => setProrrogaAbierta({ recordId: record.id, cuotaNumber: cuota.number })}
                                  />
                                </>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Acciones. Las cuatro iban a `py-2` sobre una línea de 20px
                        = 36px de alto, y en el móvil se reparten en dos filas con
                        "Eliminar" pegado a "Editar": el mínimo táctil aquí evita
                        borrar una financiación por fallar el toque. */}
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleSendReminder(record.id); }}
                        disabled={sendingReminder === record.id || record.status === 'completed'}
                        className="flex min-h-11 items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed sm:min-h-0"
                      >
                        <Send className="w-4 h-4" />
                        {sendingReminder === record.id ? 'Enviando...' : 'Enviar recordatorio WhatsApp'}
                      </button>
                      <a
                        href={`https://wa.me/57${record.telefono.replace(/\D/g, '').replace(/^57/, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex min-h-11 items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-semibold transition-colors sm:min-h-0"
                        onClick={e => e.stopPropagation()}
                      >
                        <Phone className="w-4 h-4" /> Contactar
                      </a>
                      <button
                        onClick={(e) => { e.stopPropagation(); openEdit(record); }}
                        className="flex min-h-11 items-center gap-2 px-4 py-2 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-lg text-sm font-semibold transition-colors sm:min-h-0"
                      >
                        <Pencil className="w-4 h-4" /> Editar
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(record.id); }}
                        className="flex min-h-11 items-center gap-2 px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-sm font-semibold transition-colors sm:min-h-0"
                      >
                        <Trash2 className="w-4 h-4" /> Eliminar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Dialog Crear / Editar ──────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) { setDialogOpen(false); resetForm(); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-orange-500" />
              {editing ? 'Editar CrediLock' : 'Nuevo CrediLock'}
            </DialogTitle>
            <DialogDescription>
              {editing ? 'Modifica los datos del crédito' : 'Registra un nuevo cliente con plan de cuotas quincenales'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            {/* Una sola columna en el móvil: a dos columnas cada campo se quedaba en
                unos 140px y etiquetas como "💲 Costo del equipo" se partían en tres
                líneas sobre un input donde no cabía ni el importe. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Nombre *</Label>
                <Input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Nombre completo" />
              </div>
              <div>
                <Label>Cédula *</Label>
                <Input value={form.cedula} onChange={e => setForm({ ...form, cedula: e.target.value })} placeholder="1234567890" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Teléfono *</Label>
                <Input value={form.telefono} onChange={e => setForm({ ...form, telefono: e.target.value })} placeholder="3001234567" />
              </div>
              <div>
                <Label>IMEI *</Label>
                <Input value={form.imei} onChange={e => setForm({ ...form, imei: e.target.value })} placeholder="123456789012345" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Producto</Label>
                <Input value={form.producto} onChange={e => setForm({ ...form, producto: e.target.value })} placeholder="Ej: Xiaomi Redmi Note 13" />
              </div>
              <div>
                <Label>💲 Costo del equipo</Label>
                <Input type="number" value={form.costoEquipo} onChange={e => setForm({ ...form, costoEquipo: e.target.value })} placeholder="600000" />
                <p className="text-[10px] text-gray-400 mt-0.5">Precio que se le paga a Xiaomi</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <Label>Valor Cuota *</Label>
                <Input type="number" value={form.valorCuota} onChange={e => setForm({ ...form, valorCuota: e.target.value })} placeholder="98000" />
              </div>
              <div>
                <Label># Cuotas *</Label>
                <Input type="number" value={form.numeroCuotas} onChange={e => setForm({ ...form, numeroCuotas: e.target.value })} placeholder="12" min="1" max="24" />
              </div>
              <div>
                <Label>Cuota Inicial</Label>
                <Input type="number" value={form.cuotaInicial} onChange={e => setForm({ ...form, cuotaInicial: e.target.value })} placeholder="200000" />
              </div>
            </div>

            {/* Solo al crear — para clientes antiguos que ya pagaron cuotas */}
            {!editing && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <Label className="text-blue-800 flex items-center gap-1.5 mb-1">
                  <CreditCard className="w-3.5 h-3.5" />
                  Cuotas ya pagadas <span className="text-[10px] text-blue-500 font-normal">(clientes antiguos)</span>
                </Label>
                <Input
                  type="number"
                  value={form.cuotasPagadas}
                  onChange={e => setForm({ ...form, cuotasPagadas: e.target.value })}
                  placeholder="0"
                  min="0"
                  max={form.numeroCuotas || '24'}
                  className="w-24 max-w-full"
                />
                <p className="text-[10px] text-blue-500 mt-1">Si el cliente ya pagó 4 cuotas, pon 4. Se marcan como pagadas automáticamente.</p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Fecha próximo pago *</Label>
                <Input type="date" value={form.fechaInicio} onChange={e => setForm({ ...form, fechaInicio: e.target.value })} />
              </div>
              <div>
                <Label>🔒 Hora de bloqueo</Label>
                <Input type="time" value={form.horaBloqueo} onChange={e => setForm({ ...form, horaBloqueo: e.target.value })} />
                <p className="text-[10px] text-gray-400 mt-1">Si no paga, se bloquea a esta hora</p>
              </div>
            </div>

            {/* Preview cálculo */}
            {valorCuotaNum > 0 && numeroCuotasNum > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                <p className="text-sm text-orange-800 font-medium mb-2">📊 Resumen del plan</p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <span className="text-gray-600">Valor cada cuota:</span>
                  <span className="font-bold text-orange-600">{formatCurrency(valorCuotaNum)}</span>
                  <span className="text-gray-600">Número de cuotas:</span>
                  <span className="font-bold text-gray-900">{numeroCuotasNum}</span>
                  <span className="text-gray-600">Frecuencia:</span>
                  <span className="font-bold text-gray-900">Cada 15 días</span>
                  <span className="text-gray-600">🔒 Hora de bloqueo:</span>
                  <span className="font-bold text-red-600">{form.horaBloqueo || '08:00'}</span>
                  {cuotaInicialNum > 0 && (
                    <>
                      <span className="text-gray-600">Cuota inicial:</span>
                      <span className="font-bold text-gray-900">{formatCurrency(cuotaInicialNum)}</span>
                    </>
                  )}
                  {!editing && cuotasPagadasNum > 0 && (
                    <>
                      <span className="text-gray-600">✅ Cuotas ya pagadas:</span>
                      <span className="font-bold text-green-600">{cuotasPagadasNum} de {numeroCuotasNum}</span>
                      <span className="text-gray-600">Restante por cobrar:</span>
                      <span className="font-bold text-red-600">{formatCurrency(restantePorPagar)}</span>
                    </>
                  )}
                  <span className="text-gray-600 font-bold text-base pt-2 border-t border-orange-200">TOTAL A PAGAR:</span>
                  <span className="font-black text-gray-900 text-base pt-2 border-t border-orange-200">{formatCurrency(totalPreview)}</span>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-3 mt-6">
            <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }} className="flex-1">
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving} className="flex-1 bg-orange-500 hover:bg-orange-600 text-white">
              {saving ? 'Guardando...' : editing ? 'Actualizar' : 'Crear CrediLock'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Pago a Xiaomi ──────────────────────────────────────────── */}
      <Dialog open={showPayXiaomiDialog} onOpenChange={setShowPayXiaomiDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar pago a Xiaomi</DialogTitle>
            <DialogDescription>Registra un abono al costo de equipos</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Monto *</Label>
              <Input
                type="number"
                value={payXiaomiAmount}
                onChange={e => setPayXiaomiAmount(e.target.value)}
                placeholder="1000000"
              />
            </div>
            <div>
              <Label>Nota (opcional)</Label>
              <Input
                value={payXiaomiNote}
                onChange={e => setPayXiaomiNote(e.target.value)}
                placeholder="Ej: Pago quincenal equipos"
              />
            </div>

            {xiaomiPayments.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Historial de pagos</p>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {xiaomiPayments.map(p => (
                    <div key={p.id} className="flex items-center justify-between gap-2 bg-gray-50 rounded-lg px-3 py-2 text-sm">
                      {/* min-w-0: sin esto una nota larga empuja el botón de borrar
                          fuera de la tarjeta en vez de partirse. */}
                      <div className="min-w-0 break-words">
                        <span className="font-bold text-gray-800">{formatCurrency(p.amount)}</span>
                        <span className="text-gray-400 text-xs ml-2">
                          {new Date(p.date).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}
                        </span>
                        {p.note && <span className="text-gray-400 text-xs ml-1">— {p.note}</span>}
                      </div>
                      <button
                        onClick={() => handleDeleteXiaomiPayment(p.id)}
                        aria-label="Eliminar pago"
                        className="flex h-11 w-11 shrink-0 items-center justify-center text-red-400 hover:text-red-600 sm:h-auto sm:w-auto sm:p-2"
                        title="Eliminar"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setShowPayXiaomiDialog(false)} className="flex-1">
                Cerrar
              </Button>
              <Button onClick={handlePayXiaomi} disabled={savingPayment || !payXiaomiAmount} className="flex-1 bg-amber-500 hover:bg-amber-600 text-white">
                {savingPayment ? 'Guardando...' : 'Registrar Pago'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmación de bloqueo. Sólo al bloquear: desbloquear devuelve el
          teléfono a su dueño y no necesita freno, pero bloquear deja a una
          persona real sin teléfono y varios lo usan para trabajar. */}
      <Dialog open={Boolean(porConfirmar)} onOpenChange={(open) => { if (!open) setPorConfirmar(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <Lock className="h-5 w-5" /> Bloquear el equipo
            </DialogTitle>
            <DialogDescription>
              El teléfono queda inutilizable hasta que lo desbloquees.
            </DialogDescription>
          </DialogHeader>

          {porConfirmar && (
            <div className="space-y-3 text-sm">
              <div className="rounded-lg border bg-gray-50 p-3">
                <p className="font-semibold text-gray-900">{porConfirmar.record.nombre}</p>
                <p className="text-xs text-gray-500">{porConfirmar.record.producto}</p>
                <p className="mt-1 font-mono text-xs text-gray-500">IMEI {porConfirmar.record.imei}</p>
              </div>

              {porConfirmar.device.incomunicado && (
                <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
                  Este equipo lleva {Math.round(porConfirmar.device.horasSinReportar || 0)} h sin reportar.
                  La orden se envía igual, pero no se aplicará hasta que el teléfono se encienda y tenga internet.
                </p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" onClick={() => setPorConfirmar(null)}>
                  Cancelar
                </Button>
                <Button
                  className="bg-red-600 text-white hover:bg-red-700"
                  onClick={() => {
                    const { record, device } = porConfirmar;
                    setPorConfirmar(null);
                    ejecutarAccion(record, device, 'block');
                  }}
                >
                  <Lock className="mr-2 h-4 w-4" /> Sí, bloquear
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {comprobanteEnVista && (
        <DialogoComprobante
          record={comprobanteEnVista.record}
          cuota={comprobanteEnVista.cuota}
          ocupado={
            comprobanteOcupado ===
            `${comprobanteEnVista.record.id}:${comprobanteEnVista.cuota.number}`
          }
          onCerrar={() => setComprobanteAbierto(null)}
          onSubir={file => subirComprobante(comprobanteEnVista.record, comprobanteEnVista.cuota, file)}
          onEliminar={() => eliminarComprobante(comprobanteEnVista.record, comprobanteEnVista.cuota)}
        />
      )}

      {/*
        `key` con la cuota: al pasar de una cuota a otra sin cerrar el diálogo,
        React reutilizaría la instancia y el campo de fecha se quedaría con el
        valor que tecleó para la cuota anterior.
      */}
      {prorrogaEnVista && (
        <DialogoProrroga
          key={`${prorrogaEnVista.record.id}:${prorrogaEnVista.cuota.number}`}
          record={prorrogaEnVista.record}
          cuota={prorrogaEnVista.cuota}
          ocupado={
            prorrogaOcupada ===
            `${prorrogaEnVista.record.id}:${prorrogaEnVista.cuota.number}`
          }
          onCerrar={() => setProrrogaAbierta(null)}
          onGuardar={(hasta, motivo) =>
            otorgarProrroga(prorrogaEnVista.record, prorrogaEnVista.cuota, hasta, motivo)
          }
          onAnular={() => anularProrroga(prorrogaEnVista.record, prorrogaEnVista.cuota)}
        />
      )}
    </div>
  );
}

// ─── Sub-component: Badge de estado de cuota ────────────────────────────────
// Extraído porque la misma etiqueta se pinta dos veces: en las tarjetas del móvil
// y en la rejilla de escritorio.

/**
 * Recibe la cuota entera y no sólo el `status` porque la prórroga es un estado
 * que el servidor no puede codificar ahí: mientras el plazo sigue abierto la
 * cuota es `pending` a todos los efectos, y pintarla como "Pendiente" a secas
 * esconde justo el dato por el que el dueño abre esta tabla.
 */
function EstadoCuotaBadge({ cuota }: { cuota: Installment }) {
  if (cuota.status === 'paid') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-bold">
        <CheckCircle className="w-3 h-3" /> Pagada
      </span>
    );
  }

  const plazo = prorrogaVigente(cuota);
  if (plazo) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500 text-white text-xs font-bold"
        title={`Plazo hasta el ${fechaLarga(plazo.hasta)} — ${cuantoFalta(soloFecha(plazo.hasta))}`}
      >
        <Clock className="w-3 h-3" /> Prórroga
      </span>
    );
  }

  if (cuota.status === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-xs font-bold">
        <Clock className="w-3 h-3" /> Pendiente
      </span>
    );
  }

  /*
   * "Plazo vencido" y no "Vencida" cuando hubo prórroga: son dos situaciones
   * distintas delante del cliente. A uno se le pasó la fecha; al otro se le dio
   * tiempo extra y también se le pasó, y eso cambia la llamada que toca hacer.
   */
  const plazoIncumplido = Boolean(cuota.prorroga?.hasta);
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-600 text-white text-xs font-bold"
      title={
        plazoIncumplido
          ? `Se le dio plazo hasta el ${fechaLarga(cuota.prorroga!.hasta)} y tampoco pagó.`
          : undefined
      }
    >
      <AlertTriangle className="w-3 h-3" /> {plazoIncumplido ? 'Plazo vencido' : 'Vencida'}
    </span>
  );
}

/**
 * La fecha de la cuota, con el plazo encima si lo hay.
 *
 * Se muestran las DOS: arriba la que manda, debajo tachada la pactada. Enseñar
 * sólo la nueva borraría de la pantalla el calendario original del crédito, y
 * enseñar sólo la pactada es lo que hacía antes el panel —el dueño miraba una
 * fecha que ni el automatismo ni el cliente estaban usando.
 */
function FechaCuota({ cuota }: { cuota: Installment }) {
  const plazo = cuota.prorroga?.hasta ? soloFecha(cuota.prorroga.hasta) : '';
  const original = soloFecha(cuota.dueDate);

  if (!plazo || plazo === original) {
    return (
      <span className={`font-medium ${cuota.status === 'overdue' ? 'text-red-700' : 'text-gray-700'}`}>
        {formatDate(cuota.dueDate)}
      </span>
    );
  }

  const vigente = Boolean(prorrogaVigente(cuota));
  return (
    <span
      className="block leading-tight"
      title={
        `Prórroga${vigente ? '' : ' (ya vencida)'} hasta el ${fechaLarga(plazo)}. ` +
        `La fecha pactada era el ${fechaLarga(original)}.`
      }
    >
      <span className={`block font-semibold ${vigente ? 'text-amber-700' : 'text-red-700'}`}>
        ⏳ {formatDate(plazo)}
      </span>
      <span className="block text-[10px] text-gray-400 line-through">{formatDate(original)}</span>
    </span>
  );
}

/**
 * El botón de prórroga. Convive con "Pagar" en la misma celda a propósito: son
 * las dos únicas respuestas posibles cuando el cliente llama el día que le toca
 * —o paga, o pide tiempo— y tenerlas juntas evita buscar la segunda en otro
 * sitio con el cliente al teléfono.
 */
function ProrrogaCuota({
  cuota,
  ocupado,
  onAbrir,
}: {
  cuota: Installment;
  ocupado: boolean;
  onAbrir: () => void;
}) {
  const tiene = Boolean(cuota.prorroga?.hasta);
  const vigente = Boolean(prorrogaVigente(cuota));

  return (
    <button
      type="button"
      disabled={ocupado}
      onClick={(e) => { e.stopPropagation(); onAbrir(); }}
      aria-label={tiene ? `Ver la prórroga de la cuota ${cuota.number}` : `Dar prórroga a la cuota ${cuota.number}`}
      title={
        tiene
          ? `Prórroga hasta el ${fechaLarga(cuota.prorroga!.hasta)}${vigente ? '' : ' (ya vencida)'} — pulsa para ampliarla o anularla`
          : 'Dar plazo extra a esta cuota sin mover la fecha pactada'
      }
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors disabled:cursor-wait disabled:opacity-50 ${
        vigente
          ? 'border-amber-500 bg-amber-500 text-white hover:bg-amber-600'
          : tiene
            ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
            : 'border-gray-200 bg-white text-gray-400 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-600'
      }`}
    >
      {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />}
    </button>
  );
}

// ─── Sub-components: comprobante de pago ────────────────────────────────────

/**
 * Baja la captura y devuelve una URL pintable. Ver `urlDeComprobante`: no se
 * puede usar la ruta directamente en un `<img>` porque exige sesión.
 */
function useComprobanteUrl(recordId: string, cuota: Installment) {
  const mediaId = cuota.comprobante?.mediaId;
  const [url, setUrl] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    if (!mediaId) {
      setUrl(null);
      return;
    }
    let vivo = true;
    setFallo(false);
    setUrl(null);
    urlDeComprobante(recordId, cuota.number, mediaId)
      .then(u => { if (vivo) setUrl(u); })
      .catch(() => { if (vivo) setFallo(true); });
    // El blob lo gestiona el caché del módulo, no este efecto: la miniatura y la
    // vista ampliada comparten la misma URL y revocarla al desmontar una
    // rompería la otra.
    return () => { vivo = false; };
  }, [recordId, cuota.number, mediaId]);

  return { url, fallo };
}

/**
 * Celda de comprobante de una cuota.
 *
 * Es también el portero del botón "Pagar": mientras no haya captura, pagar está
 * bloqueado. Por eso el estado vacío no es un hueco sino una llamada a la
 * acción — quien mira la fila tiene que entender de inmediato qué falta.
 */
function ComprobanteCuota({
  record,
  cuota,
  ocupado,
  onSubir,
  onVer,
}: {
  record: FinancingRecord;
  cuota: Installment;
  ocupado: boolean;
  onSubir: (file: File) => void;
  onVer: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { url, fallo } = useComprobanteUrl(record.id, cuota);
  const tiene = Boolean(cuota.comprobante?.mediaId);

  const elegir = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Se limpia el input para que volver a elegir el MISMO archivo —tras un
    // fallo de red, por ejemplo— vuelva a disparar el evento change.
    e.target.value = '';
    if (file) onSubir(file);
  };

  return (
    <span className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={elegir}
        aria-label={`Comprobante de la cuota ${cuota.number}`}
      />

      {ocupado ? (
        <span className="flex items-center gap-1.5 text-xs text-gray-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Subiendo…
        </span>
      ) : tiene ? (
        <>
          <button
            type="button"
            onClick={onVer}
            title="Ver el comprobante"
            className="group relative h-9 w-9 shrink-0 overflow-hidden rounded border border-gray-300 bg-gray-100 transition-colors hover:border-green-500"
          >
            {url ? (
              <img src={url} alt={`Comprobante cuota ${cuota.number}`} className="h-full w-full object-cover" />
            ) : fallo ? (
              <ImageOff className="m-auto h-4 w-4 text-red-400" />
            ) : (
              <Loader2 className="m-auto h-4 w-4 animate-spin text-gray-400" />
            )}
          </button>
          <button
            type="button"
            onClick={onVer}
            className="text-xs font-semibold text-green-700 underline-offset-2 hover:underline"
          >
            Ver
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex min-h-9 items-center gap-1.5 rounded-lg border border-dashed border-gray-400 px-2.5 py-1.5 text-xs font-semibold text-gray-600 transition-colors hover:border-green-500 hover:bg-green-50 hover:text-green-700"
        >
          <Upload className="h-3.5 w-3.5" /> Subir
        </button>
      )}
    </span>
  );
}

/** Vista ampliada, con los datos de la captura y las acciones de corrección. */
function DialogoComprobante({
  record,
  cuota,
  ocupado,
  onCerrar,
  onSubir,
  onEliminar,
}: {
  record: FinancingRecord;
  cuota: Installment;
  ocupado: boolean;
  onCerrar: () => void;
  onSubir: (file: File) => void;
  onEliminar: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { url, fallo } = useComprobanteUrl(record.id, cuota);
  const comprobante = cuota.comprobante;
  const pagada = cuota.status === 'paid';

  return (
    <Dialog open onOpenChange={abierto => { if (!abierto) onCerrar(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Comprobante · Cuota #{cuota.number}</DialogTitle>
          <DialogDescription>
            {record.nombre} — {formatCurrency(record.valorCuota)}
            {comprobante && (
              <>
                {' · '}subido el {formatDate(comprobante.subidoEn)} por {comprobante.subidoPor}
                {' · '}{tamañoCorto(comprobante.bytes)}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onSubir(file);
          }}
        />

        <div className="flex max-h-[60vh] items-center justify-center overflow-auto rounded-lg bg-gray-100 p-2">
          {url ? (
            <img src={url} alt={`Comprobante de la cuota ${cuota.number}`} className="max-h-[56vh] w-auto rounded" />
          ) : fallo ? (
            <p className="flex items-center gap-2 py-12 text-sm text-red-600">
              <ImageOff className="h-5 w-5" /> No se pudo cargar la imagen.
            </p>
          ) : (
            <p className="flex items-center gap-2 py-12 text-sm text-gray-500">
              <Loader2 className="h-5 w-5 animate-spin" /> Cargando…
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={ocupado}
            onClick={() => inputRef.current?.click()}
            className="flex min-h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
          >
            {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {ocupado ? 'Subiendo…' : 'Cambiar imagen'}
          </button>

          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-10 items-center gap-2 rounded-lg bg-gray-100 px-4 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-200"
            >
              <Eye className="h-4 w-4" /> Abrir aparte
            </a>
          )}

          <span className="flex-1" />

          {/*
            Con la cuota pagada, el servidor rechaza el borrado: la captura es lo
            que respalda ese pago. Se muestra el motivo en vez de un botón que
            sólo serviría para producir un error.
          */}
          {pagada ? (
            <span className="text-xs text-gray-500">
              Para eliminarlo, desmarca antes la cuota.
            </span>
          ) : (
            <button
              type="button"
              disabled={ocupado}
              onClick={onEliminar}
              className="flex min-h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" /> Eliminar
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Sub-component: diálogo de prórroga ─────────────────────────────────────

/**
 * Dar, ampliar o anular el plazo de una cuota.
 *
 * Se abre con el cliente al teléfono, así que todo lo que hay que saber para
 * decidir está a la vista sin tener que buscarlo: la fecha pactada, cuántos días
 * de plazo salen, si ese plazo se pasa de la cuota siguiente y cuántas prórrogas
 * lleva pedidas este cliente. Lo último es lo que distingue "se le atrasó el
 * sueldo" de "lleva cuatro meses sin pagar una cuota a tiempo".
 */
function DialogoProrroga({
  record,
  cuota,
  ocupado,
  onCerrar,
  onGuardar,
  onAnular,
}: {
  record: FinancingRecord;
  cuota: Installment;
  ocupado: boolean;
  onCerrar: () => void;
  onGuardar: (hasta: string, motivo: string) => void;
  onAnular: () => void;
}) {
  const yaTiene = Boolean(cuota.prorroga?.hasta);
  const hoy = hoyEnColombia();
  const original = soloFecha(cuota.dueDate);

  /**
   * Al ampliar se parte de la fecha que ya tiene, no de "hoy + 7": quien abre
   * esto sobre una prórroga existente suele querer corregirla o estirarla unos
   * días, y empezar con otra fecha cualquiera invita a sobreescribirla sin
   * mirar.
   */
  const [hasta, setHasta] = useState(() =>
    yaTiene ? soloFecha(cuota.prorroga!.hasta) : fechaSugerida()
  );
  const [motivo, setMotivo] = useState('');

  const dias = hasta
    ? Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86400000)
    : NaN;

  /**
   * Las mismas tres reglas que `validarProrroga` en el servidor, repetidas aquí
   * a propósito: el servidor es el que manda, pero descubrir el error después de
   * pulsar —con el cliente esperando— obliga a reabrir el diálogo y teclear todo
   * otra vez. Si alguna cambia allí, hay que tocarla aquí.
   */
  const problema =
    !hasta ? 'Elige una fecha.'
    : hasta < hoy ? 'La prórroga tiene que ser para hoy o más adelante.'
    : original && hasta < original ? `La cuota vence el ${formatDate(original)}. Una prórroga sólo da más plazo, no lo adelanta.`
    : dias > 60 ? `Son ${dias} días de plazo. El máximo es 60; revisa el año.`
    : '';

  /** La siguiente cuota sin pagar, para avisar si el plazo se le monta encima. */
  const siguiente = record.cuotas.find(c => c.number > cuota.number && c.status !== 'paid');
  const pisaSiguiente = Boolean(siguiente && hasta && fechaLimite(siguiente) < hasta);

  return (
    <Dialog open onOpenChange={abierto => { if (!abierto) onCerrar(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Hourglass className="h-5 w-5 text-amber-500" />
            {yaTiene ? 'Prórroga de la cuota' : 'Dar prórroga'} #{cuota.number}
          </DialogTitle>
          <DialogDescription>
            {record.nombre} — {formatCurrency(record.valorCuota)} · vence el {formatDate(original)}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-4">
          {/*
            La fecha pactada se repite aquí arriba porque es la que NO cambia, y
            es la primera duda de quien da el plazo: "¿sobre qué fecha se lo
            estoy dando?".
          */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
            <p className="text-gray-600">
              La fecha pactada sigue siendo el{' '}
              <span className="font-semibold text-gray-900">{fechaLarga(original)}</span>. La prórroga
              no la cambia: sólo evita el bloqueo y la mora mientras dure.
            </p>
            {yaTiene && (
              <p className="mt-2 text-amber-800">
                Ya tiene plazo hasta el{' '}
                <span className="font-bold">{fechaLarga(cuota.prorroga!.hasta)}</span>{' '}
                ({cuantoFalta(soloFecha(cuota.prorroga!.hasta))}), dado por {cuota.prorroga!.otorgadaPor}.
                {cuota.prorroga!.motivo && <> Motivo: «{cuota.prorroga!.motivo}».</>}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="prorroga-hasta">Dar plazo hasta</Label>
            <Input
              id="prorroga-hasta"
              type="date"
              value={hasta}
              min={original > hoy ? original : hoy}
              onChange={e => setHasta(e.target.value)}
              className="mt-1"
            />
            {!problema && hasta && (
              <p className="mt-1.5 text-xs text-gray-500">
                {fechaLarga(hasta)} — {dias === 0 ? 'hoy mismo' : dias === 1 ? '1 día de plazo' : `${dias} días de plazo`}
              </p>
            )}
            {problema && <p className="mt-1.5 text-xs font-semibold text-red-600">{problema}</p>}
          </div>

          <div>
            <Label htmlFor="prorroga-motivo">Motivo (opcional)</Label>
            <Input
              id="prorroga-motivo"
              value={motivo}
              maxLength={300}
              placeholder="Le pagan el viernes, está de viaje…"
              onChange={e => setMotivo(e.target.value)}
              className="mt-1"
            />
            {/* El historial sin motivo no sirve para decidir nada dentro de tres
                meses: queda la fecha, pero no por qué se dio. */}
            <p className="mt-1.5 text-xs text-gray-400">
              Queda guardado en el historial. Es lo que explica el plazo cuando se revise más adelante.
            </p>
          </div>

          {pisaSiguiente && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
              ⚠️ Este plazo se pasa de la fecha de la cuota #{siguiente!.number}
              {' '}({formatDate(fechaLimite(siguiente!))}): le van a vencer las dos juntas.
            </p>
          )}

          {Number(record.prorrogasOtorgadas || 0) >= 2 && (
            <p className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-xs font-semibold text-orange-800">
              Este cliente ya lleva {record.prorrogasOtorgadas} prórroga
              {record.prorrogasOtorgadas === 1 ? '' : 's'} en este crédito.
            </p>
          )}

          <p className="text-xs text-gray-500">
            Al guardar se le avisa por WhatsApp y, si tenía el equipo bloqueado por esta cuota, se
            desbloquea mientras dure el plazo. Un equipo bloqueado a mano no se suelta: eso se hace
            con el botón Desbloquear.
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={ocupado || Boolean(problema)}
            onClick={() => onGuardar(hasta, motivo)}
            className="flex min-h-10 items-center gap-2 rounded-lg bg-amber-500 px-4 text-sm font-bold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500"
          >
            {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
            {ocupado ? 'Guardando…' : yaTiene ? 'Cambiar el plazo' : 'Dar la prórroga'}
          </button>

          <button
            type="button"
            onClick={onCerrar}
            className="flex min-h-10 items-center gap-2 rounded-lg bg-gray-100 px-4 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-200"
          >
            Cancelar
          </button>

          <span className="flex-1" />

          {yaTiene && (
            <button
              type="button"
              disabled={ocupado}
              onClick={onAnular}
              className="flex min-h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" /> Anular prórroga
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Sub-component: control de bloqueo del equipo ───────────────────────────

interface EstadoEquipo {
  device: Device | null;
  operable: boolean;
  bloqueado: boolean;
  motivo: string;
}

/**
 * Qué está pasando ahora mismo con los bloqueos.
 *
 * Existe porque este módulo es asíncrono por naturaleza y eso desconcierta: se
 * pulsa "Bloquear", el proveedor acepta la orden, y el teléfono puede tardar
 * horas en aplicarla porque está apagado. Sin un sitio donde ver "la orden está
 * en camino desde hace 3 min", la única lectura posible era que el botón no
 * había hecho nada.
 */
function PanelActividad({
  ordenes,
  eventos,
  config,
  equipos,
  ahora,
  onRefrescar,
}: {
  ordenes: OrdenEnVuelo[];
  eventos: EventoPanel[];
  config: ConfigBloqueo | null;
  equipos: Map<string, Device>;
  ahora: number;
  onRefrescar: () => void | Promise<void>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [refrescando, setRefrescando] = useState(false);

  // Mismo criterio que `ControlEquipo`: sin orden no hay nada que confirmar.
  const sinConfirmar = useMemo(
    () => Array.from(equipos.values()).filter(d => d.divergente && d.ordenEnviadaEn),
    [equipos]
  );

  const hayOrdenes = ordenes.length > 0;

  // Se abre solo en cuanto sale una orden: es justo el momento en el que el
  // dueño está mirando la pantalla a ver si pasó algo.
  useEffect(() => { if (hayOrdenes) setAbierto(true); }, [hayOrdenes]);

  const modo = !config
    ? null
    : !config.autoBloqueoActivo
    ? { texto: 'Automatismo apagado', clase: 'bg-gray-100 text-gray-600', ayuda: 'Nada se bloquea ni se desbloquea solo. Las órdenes salen únicamente cuando las pides desde aquí.' }
    : config.simulacion
    ? { texto: 'Automatismo en simulación', clase: 'bg-blue-100 text-blue-700', ayuda: 'Decide y lo anota en el historial, pero no manda nada al proveedor.' }
    : { texto: 'Automatismo ACTIVO', clase: 'bg-red-100 text-red-700', ayuda: 'Bloquea y desbloquea por mora sin intervención.' };

  const refrescar = async () => {
    setRefrescando(true);
    await onRefrescar();
    setRefrescando(false);
  };

  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-700">
          <Activity className="h-3.5 w-3.5 text-gray-400" />
          {hayOrdenes ? (
            <>
              <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
              {ordenes.length} {ordenes.length === 1 ? 'orden en camino' : 'órdenes en camino'}
            </>
          ) : sinConfirmar.length ? (
            <>
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              {sinConfirmar.length} {sinConfirmar.length === 1 ? 'equipo sin confirmar' : 'equipos sin confirmar'}
            </>
          ) : (
            <>
              <span className="h-2 w-2 rounded-full bg-green-500" />
              Todo sincronizado
            </>
          )}
        </span>

        {modo && (
          <span title={modo.ayuda} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${modo.clase}`}>
            <ShieldOff className="h-3 w-3" />
            {modo.texto}
          </span>
        )}

        <span className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={refrescar}
            disabled={refrescando}
            title="Vuelve a leer el estado de todos los equipos."
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-50"
          >
            {refrescando ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
            Actualizar
          </button>
          <button
            type="button"
            onClick={() => setAbierto(v => !v)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-100"
          >
            {abierto ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Detalle
          </button>
        </span>
      </div>

      {abierto && (
        <div className="space-y-3 border-t border-gray-100 px-3 py-3">
          {sinConfirmar.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">Órdenes esperando al equipo</p>
              <ul className="space-y-1">
                {sinConfirmar.map(d => {
                  const enviada = d.ordenEnviadaEn ? Date.parse(d.ordenEnviadaEn) : NaN;
                  const sondeando = ordenes.some(o => o.deviceId === d.id);
                  return (
                    <li key={d.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                      <span className="font-semibold capitalize text-gray-800">{(d.owner || d.imei).toLowerCase()}</span>
                      <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                        {d.intencion === 'blocked' ? 'bloqueo' : 'desbloqueo'}
                      </span>
                      {Number.isFinite(enviada) && (
                        <span className="text-gray-500">hace {duracionCorta(ahora - enviada)}</span>
                      )}
                      {sondeando && <Loader2 className="h-3 w-3 animate-spin text-amber-600" />}
                      {d.incomunicado && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600">
                          <WifiOff className="h-3 w-3" />
                          sin reportar {Math.round(d.horasSinReportar || 0)} h
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">Actividad de esta sesión</p>
            {eventos.length === 0 ? (
              <p className="text-xs text-gray-400">Todavía no has hecho nada desde que abriste el panel.</p>
            ) : (
              <ul className="max-h-48 space-y-1 overflow-y-auto">
                {eventos.map(ev => (
                  <li key={ev.id} className="flex gap-2 text-xs">
                    <span className="shrink-0 font-mono text-[10px] text-gray-400">
                      {new Date(ev.cuando).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <span
                      className={
                        ev.nivel === 'ok'
                          ? 'text-green-700'
                          : ev.nivel === 'error'
                          ? 'font-semibold text-red-700'
                          : ev.nivel === 'aviso'
                          ? 'text-amber-700'
                          : 'text-gray-600'
                      }
                    >
                      {ev.texto}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Estado real del equipo y el botón para cambiarlo.
 *
 * Muestra "sin confirmar" cuando la intención y el estado del proveedor no
 * coinciden. Eso pasa de verdad: si el teléfono está apagado, la orden se queda
 * encolada y el equipo sigue funcionando. Decir "Bloqueado" ahí haría que el
 * dueño dejara de llamar a un cliente que todavía tiene el teléfono operativo.
 */
function ControlEquipo({
  estado,
  trabajando,
  enVuelo,
  ahora,
  onBloquear,
  onDesbloquear,
  onVerificar,
}: {
  estado: EstadoEquipo;
  trabajando: boolean;
  /** true si el panel está sondeando al proveedor por este equipo. */
  enVuelo: boolean;
  ahora: number;
  onBloquear: () => void;
  onDesbloquear: () => void;
  onVerificar: () => void;
}) {
  const { device, operable, bloqueado, motivo } = estado;

  if (!operable) {
    return (
      <span className="flex flex-col items-start gap-1">
        <span
          title={motivo}
          className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500"
        >
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {!device ? 'Sin enrolar' : device.plataforma === 'nuovo' ? 'Nuovo (manual)' : 'Sin verificar'}
        </span>

        <button
          type="button"
          disabled={trabajando}
          onClick={onVerificar}
          title="Da de alta el equipo si falta y le pregunta al proveedor en qué plataforma está."
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-blue-600 px-2 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {trabajando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          {trabajando ? 'Buscando…' : 'Verificar'}
        </button>
      </span>
    );
  }

  /**
   * "En cola" exige que exista una orden. El servidor ya lo garantiza en
   * `divergente`, pero se vuelve a pedir aquí porque el navegador puede estar
   * sirviendo una respuesta cacheada de la versión anterior del backend, y el
   * precio de equivocarse es anunciarle al dueño una orden que nadie mandó.
   */
  const enCola = device!.divergente && Boolean(device!.ordenEnviadaEn);
  const quiereBloqueado = device!.intencion === 'blocked';

  const enviadaEn = device!.ordenEnviadaEn ? Date.parse(device!.ordenEnviadaEn) : NaN;
  const espera = enCola && Number.isFinite(enviadaEn) ? duracionCorta(ahora - enviadaEn) : null;

  /**
   * Con una orden en cola hay dos cosas que el dueño puede querer y son
   * opuestas, así que no caben en un solo botón: reenviar la misma orden
   * (porque el cliente sigue esperando) o anularla (porque ya no aplica).
   *
   * Antes, con la orden en cola, el botón se leía del estado confirmado por el
   * proveedor, así que un cliente que había pagado y tenía el desbloqueo en
   * cola mostraba "Desbloquear" como si no se hubiera pedido nada, y uno con el
   * bloqueo en cola mostraba "Bloquear" otra vez. En ninguno de los dos casos
   * se podía anular la orden sin provocar lo contrario de lo que se quería.
   */
  if (enCola) {
    const reintentar = quiereBloqueado ? onBloquear : onDesbloquear;
    const anular = quiereBloqueado ? onDesbloquear : onBloquear;

    return (
      <span className="flex flex-col items-start gap-1">
        <span
          className="inline-flex max-w-full items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800"
          title={`El proveedor aceptó la orden de ${quiereBloqueado ? 'bloqueo' : 'desbloqueo'}, pero el equipo todavía no la ha aplicado. Entra en su próximo reporte.`}
        >
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-500" />
          <span className="truncate">{quiereBloqueado ? 'Bloqueo en cola' : 'Desbloqueo en cola'}</span>
        </span>

        <span className="text-[10px] font-medium text-amber-700" title="Tiempo que lleva la orden esperando a que el equipo se conecte.">
          {enVuelo && <Loader2 className="mr-1 inline h-2.5 w-2.5 animate-spin" />}
          {espera ? `esperando ${espera}` : 'esperando al equipo'}
        </span>

        <button
          type="button"
          disabled={trabajando}
          onClick={reintentar}
          title={`Vuelve a mandar la orden de ${quiereBloqueado ? 'bloqueo' : 'desbloqueo'} al equipo.`}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-amber-600 px-2 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {trabajando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          {trabajando ? 'Enviando…' : 'Reintentar'}
        </button>

        <button
          type="button"
          disabled={trabajando}
          onClick={anular}
          title={`Anula la orden: deja el equipo como ${quiereBloqueado ? 'activo' : 'bloqueado'}.`}
          className="text-[10px] font-semibold text-gray-500 underline-offset-2 hover:text-gray-800 hover:underline disabled:opacity-60"
        >
          Anular orden
        </button>

        {device!.incomunicado && (
          <span
            className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600"
            title={`Sin reportar desde hace ${Math.round(device!.horasSinReportar || 0)} h. Una orden no le llega hasta que se conecte.`}
          >
            <WifiOff className="h-3 w-3 shrink-0" />
            No reporta
          </span>
        )}

        {device!.ultimoErrorApi && (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-red-600" title={device!.ultimoErrorApi}>
            <AlertTriangle className="h-3 w-3 shrink-0" />
            Error del proveedor
          </span>
        )}
      </span>
    );
  }

  // Sin nada en cola, intención y estado coinciden, así que el botón vuelve a
  // ser uno solo y dice exactamente lo que va a pasar.
  return (
    <span className="flex flex-col items-start gap-1">
      <span
        className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
          bloqueado ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
        }`}
        title={bloqueado ? 'Bloqueado y confirmado por el proveedor.' : 'Funcionando con normalidad.'}
      >
        <span className="truncate">{bloqueado ? 'Bloqueado' : 'Activo'}</span>
      </span>

      <button
        type="button"
        disabled={trabajando}
        onClick={bloqueado ? onDesbloquear : onBloquear}
        className={`inline-flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          bloqueado
            ? 'bg-green-600 text-white hover:bg-green-700'
            : 'bg-red-600 text-white hover:bg-red-700'
        }`}
      >
        {trabajando ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : bloqueado ? (
          <LockOpen className="h-3.5 w-3.5" />
        ) : (
          <Lock className="h-3.5 w-3.5" />
        )}
        {trabajando ? 'Enviando…' : bloqueado ? 'Desbloquear' : 'Bloquear'}
      </button>

      {device!.incomunicado && (
        <span
          className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600"
          title={`Sin reportar desde hace ${Math.round(device!.horasSinReportar || 0)} h. Una orden no le llega hasta que se conecte.`}
        >
          <WifiOff className="h-3 w-3 shrink-0" />
          No reporta
        </span>
      )}

      {device!.ultimoErrorApi && (
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-red-600" title={device!.ultimoErrorApi}>
          <AlertTriangle className="h-3 w-3 shrink-0" />
          Error del proveedor
        </span>
      )}
    </span>
  );
}

// ─── Sub-component: KPI Card ────────────────────────────────────────────────

function KpiCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string | number; color: string }) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600 border-blue-100',
    orange: 'bg-orange-50 text-orange-600 border-orange-100',
    red: 'bg-red-50 text-red-600 border-red-100',
    green: 'bg-green-50 text-green-600 border-green-100',
    amber: 'bg-amber-50 text-amber-600 border-amber-100',
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  };

  return (
    <div className={`rounded-xl border p-3 ${colorMap[color] || colorMap.blue}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="shrink-0">{icon}</span>
        <span className="text-xs font-semibold uppercase tracking-wider opacity-70">{label}</span>
      </div>
      {/* "En mora" trae el importe vencido pegado al número ("3 ($1.470.000)") y
          en media pantalla de 360px desbordaba la tarjeta. */}
      <p className="text-lg font-bold break-words">{value}</p>
    </div>
  );
}
