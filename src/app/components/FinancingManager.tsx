import { useState, useEffect, useMemo, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { toast } from 'sonner';
import { API_BASE_URL, fetchWithTimeout } from '../lib/api-base';
import {
  Plus, Search, Trash2, Pencil, Send, CheckCircle, Clock, AlertTriangle,
  DollarSign, Users, Smartphone, CalendarDays, ChevronDown, ChevronUp,
  X, RotateCcw, Phone, CreditCard, Lock, Minus
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Installment {
  number: number;
  dueDate: string;
  paidDate?: string;
  status: 'pending' | 'paid' | 'overdue';
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
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FinancingManager() {
  const [records, setRecords] = useState<FinancingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'completed' | 'overdue'>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FinancingRecord | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sendingReminder, setSendingReminder] = useState<string | null>(null);

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

  useEffect(() => { loadRecords(); loadXiaomiPayments(); }, [loadRecords, loadXiaomiPayments]);

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
      if (res.ok) {
        const msg = nextDate && nextDate.trim()
          ? `Cuota #${cuotaNumber} pagada ✅ Próximo pago: ${new Date(nextDate).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', timeZone: 'UTC' })}`
          : `Cuota #${cuotaNumber} marcada como pagada ✅`;
        toast.success(msg);
        await loadRecords();
      }
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

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleDateString('es-CO', {
      day: '2-digit', month: 'short', year: 'numeric',
      timeZone: 'UTC',
    });
  };

  const formatCurrency = (n: number) => `$${n.toLocaleString('es-CO')}`;

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
      return new Date(nextA.dueDate).getTime() - new Date(nextB.dueDate).getTime();
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

    // 📅 COBRO HOY — cuotas que vencen hoy (pendientes)
    const todayStr = new Date().toISOString().slice(0, 10);
    const cobroHoy = records.reduce((sum, r) => {
      const cuotasHoy = r.cuotas.filter(c =>
        c.status !== 'paid' && c.dueDate.slice(0, 10) === todayStr
      );
      return sum + cuotasHoy.length * r.valorCuota;
    }, 0);

    // 🔴 CUOTAS VENCIDAS — total en dinero de cuotas vencidas sin pagar
    const totalVencido = records.reduce((sum, r) => {
      const cuotasVencidas = r.cuotas.filter(c => c.status === 'overdue').length;
      return sum + cuotasVencidas * r.valorCuota;
    }, 0);

    // 🏪 DEUDA CON XIAOMI — automático: para cada cliente, cuánto del costo del equipo
    // aún no se ha cubierto con los pagos recibidos del cliente
    const costoTotalEquipos = records.reduce((sum, r) => sum + (r.costoEquipo || 0), 0);
    const totalPagadoXiaomi = xiaomiPayments.reduce((sum, p) => sum + p.amount, 0);
    const desgloseDeuda = records.map(r => {
      const costoEquipo = r.costoEquipo || 0;
      const previas = r.cuotasPrevias || 0;
      const cuotasPagadas = r.cuotas.filter(c => c.status === 'paid').length;
      const recaudado = r.cuotaInicial + ((previas + cuotasPagadas) * r.valorCuota);
      const deudaCliente = Math.max(0, costoEquipo - recaudado);
      return { nombre: r.nombre, costoEquipo, recaudado, deudaCliente, cuotaInicial: r.cuotaInicial, cuotasPagadas: previas + cuotasPagadas, totalCuotas: r.numeroCuotas };
    }).filter(d => d.costoEquipo > 0).sort((a, b) => b.deudaCliente - a.deudaCliente);
    const deudaXiaomi = desgloseDeuda.reduce((sum, d) => sum + d.deudaCliente, 0);

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
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <CreditCard className="w-7 h-7 text-orange-500" />
            CrediLock
          </h2>
          <p className="text-sm text-gray-500 mt-1">Control de cuotas quincenales con recordatorios automáticos por WhatsApp</p>
        </div>
        <Button onClick={openCreate} className="bg-orange-500 hover:bg-orange-600 text-white gap-2">
          <Plus className="w-4 h-4" /> Nuevo Financiamiento
        </Button>
      </div>

      {/* ── 💰 DINERO EN LA CALLE — Card grande y prominente ──────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div className="bg-gradient-to-br from-orange-500 to-red-500 rounded-2xl p-5 text-white shadow-lg md:col-span-1">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="w-6 h-6 opacity-80" />
            <span className="text-sm font-bold uppercase tracking-wider opacity-80">Cuotas Pendientes por Cobrar</span>
          </div>
          <p className="text-3xl font-black">{formatCurrency(kpis.dineroEnLaCalle)}</p>
          <p className="text-xs opacity-70 mt-1">Total de cuotas pendientes de todos los clientes</p>
        </div>
        <div className="bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl p-5 text-white shadow-lg md:col-span-1">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle className="w-6 h-6 opacity-80" />
            <span className="text-sm font-bold uppercase tracking-wider opacity-80">Total Recaudado</span>
          </div>
          <p className="text-3xl font-black">{formatCurrency(kpis.totalRecaudado)}</p>
          <p className="text-xs opacity-70 mt-1">Dinero cobrado hasta hoy</p>
        </div>
        <div className="bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl p-5 text-white shadow-lg md:col-span-1">
          <div className="flex items-center gap-2 mb-1">
            <CalendarDays className="w-6 h-6 opacity-80" />
            <span className="text-sm font-bold uppercase tracking-wider opacity-80">Cobro del Día</span>
          </div>
          <p className="text-3xl font-black">{formatCurrency(kpis.cobroHoy)}</p>
          <p className="text-xs opacity-70 mt-1">Dinero que se debe recoger hoy</p>
        </div>
      </div>

      {/* ── 🏪 Deuda Xiaomi vs Ganancia ──────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <div className="bg-gradient-to-br from-yellow-500 to-amber-600 rounded-2xl p-4 text-white shadow-lg">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Smartphone className="w-5 h-5 opacity-80" />
              <span className="text-sm font-bold uppercase tracking-wider opacity-80">Por pagar a Xiaomi</span>
            </div>
            <button
              onClick={() => setShowPayXiaomiDialog(true)}
              className="bg-white/20 hover:bg-white/30 backdrop-blur-sm text-white text-xs font-bold px-3 py-1 rounded-full transition-colors flex items-center gap-1"
            >
              <Minus className="w-3 h-3" /> Pagos
            </button>
          </div>
          <p className="text-2xl font-black">{formatCurrency(kpis.deudaXiaomi)}</p>
          <button
            onClick={() => setShowDeudaDesglose(!showDeudaDesglose)}
            className="text-xs opacity-70 mt-0.5 underline hover:opacity-100 transition-opacity"
          >
            {showDeudaDesglose ? '▲ Ocultar desglose' : '▼ Ver desglose por cliente'}
          </button>
        </div>
        <div className="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl p-4 text-white shadow-lg">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="w-5 h-5 opacity-80" />
            <span className="text-sm font-bold uppercase tracking-wider opacity-80">Ganancia CrediLock</span>
          </div>
          <p className="text-2xl font-black">{formatCurrency(kpis.ganancia)}</p>
          <p className="text-xs opacity-70 mt-1">Dinero recaudado que ya es ganancia tuya</p>
        </div>
      </div>

      {/* ── Desglose deuda Xiaomi ─────────────────────────────────────────── */}
      {showDeudaDesglose && (
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden mb-4">
          <div className="bg-amber-50 px-4 py-2 border-b">
            <p className="text-sm font-bold text-amber-800">Desglose: Deuda por cliente</p>
            <p className="text-[10px] text-amber-600">Costo equipo − Dinero recaudado del cliente = Lo que falta por cubrir</p>
          </div>
          <div className="divide-y max-h-80 overflow-y-auto">
            <div className="grid grid-cols-[1fr_90px_90px_90px_60px] gap-1 px-4 py-2 bg-gray-50 text-[10px] font-bold text-gray-500 uppercase">
              <span>Cliente</span>
              <span className="text-right">Costo Equipo</span>
              <span className="text-right">Recaudado</span>
              <span className="text-right">Deuda</span>
              <span className="text-center">Cuotas</span>
            </div>
            {kpis.desgloseDeuda.map((d, i) => (
              <div key={i} className={`grid grid-cols-[1fr_90px_90px_90px_60px] gap-1 px-4 py-2 text-sm ${d.deudaCliente === 0 ? 'bg-green-50/50' : ''}`}>
                <span className="font-medium text-gray-900 truncate capitalize">{d.nombre.toLowerCase()}</span>
                <span className="text-right text-gray-600">{formatCurrency(d.costoEquipo)}</span>
                <span className="text-right text-green-600 font-medium">{formatCurrency(d.recaudado)}</span>
                <span className={`text-right font-bold ${d.deudaCliente > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {d.deudaCliente > 0 ? formatCurrency(d.deudaCliente) : '✅ $0'}
                </span>
                <span className="text-center text-gray-500 text-xs">{d.cuotasPagadas}/{d.totalCuotas}</span>
              </div>
            ))}
            <div className="grid grid-cols-[1fr_90px_90px_90px_60px] gap-1 px-4 py-2 bg-amber-50 font-bold text-sm border-t-2 border-amber-200">
              <span className="text-amber-800">TOTAL</span>
              <span className="text-right text-gray-700">{formatCurrency(kpis.desgloseDeuda.reduce((s, d) => s + d.costoEquipo, 0))}</span>
              <span className="text-right text-green-700">{formatCurrency(kpis.desgloseDeuda.reduce((s, d) => s + d.recaudado, 0))}</span>
              <span className="text-right text-red-700">{formatCurrency(kpis.deudaXiaomi)}</span>
              <span></span>
            </div>
          </div>
        </div>
      )}

      {/* ── KPI Cards secundarios ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiCard icon={<Users className="w-5 h-5" />} label="Clientes" value={kpis.total} color="blue" />
        <KpiCard icon={<Clock className="w-5 h-5" />} label="Activos" value={kpis.active} color="orange" />
        <KpiCard icon={<Lock className="w-5 h-5" />} label="Bloqueados" value={`${kpis.overdue} (${formatCurrency(kpis.totalVencido)})`} color="red" />
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
        <div className="flex gap-2">
          {(['all', 'active', 'overdue', 'completed'] as const).map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                filterStatus === s
                  ? 'bg-orange-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {s === 'all' ? 'Todos' : s === 'active' ? 'Activos' : s === 'overdue' ? 'Vencidos' : 'Completados'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      {filteredRecords.length === 0 ? (
        <div className="text-center py-16 bg-gray-50 rounded-xl">
          <Smartphone className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500 font-medium">
            {records.length === 0 ? 'No hay financiamientos registrados' : 'Sin resultados para esta búsqueda'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {/* Header de tabla — solo desktop */}
          <div className="hidden lg:grid lg:grid-cols-[1fr_100px_110px_150px_90px_90px_100px_90px_110px_70px] gap-2 px-4 py-3 bg-gray-50 border-b text-xs font-bold text-gray-500 uppercase tracking-wider">
            <span>Nombre</span>
            <span>Cédula</span>
            <span>Teléfono</span>
            <span>IMEI</span>
            <span>C. Inicial</span>
            <span>Cuota</span>
            <span>Total</span>
            <span>Pagadas</span>
            <span>Próx. Pago</span>
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

            const isDueToday = nextPending && nextPending.status === 'pending' && nextPending.dueDate.slice(0, 10) === new Date().toISOString().slice(0, 10);

            return (
              <div key={record.id} className={`border-b last:border-b-0 transition-colors ${hasOverdue ? 'bg-red-50/50' : isDueToday ? 'bg-amber-50/50' : ''}`}>
                {/* Row principal */}
                <div
                  className="grid grid-cols-1 lg:grid-cols-[1fr_100px_110px_150px_90px_90px_100px_90px_110px_70px] gap-2 px-4 py-3 cursor-pointer hover:bg-gray-50/80 items-center"
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
                  <span className="hidden lg:block text-xs">
                    {nextPending ? (
                      nextPending.status === 'overdue' ? (
                        <span className="px-2 py-1 rounded-full bg-red-600 text-white font-bold animate-pulse">
                          🔒 BLOQUEADO
                        </span>
                      ) : nextPending.dueDate.slice(0, 10) === new Date().toISOString().slice(0, 10) ? (
                        <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-700 font-bold animate-pulse">
                          📅 CUOTA HOY
                        </span>
                      ) : (
                        <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-700 font-semibold">
                          {formatDate(nextPending.dueDate)}
                        </span>
                      )
                    ) : (
                      <span className="px-2 py-1 rounded-full bg-green-100 text-green-700 font-semibold">Pagado</span>
                    )}
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
                  {hasOverdue && (
                    <span className="px-2 py-0.5 rounded-full bg-red-600 text-white font-bold animate-pulse">🔒 BLOQUEADO</span>
                  )}
                  {isDueToday && !hasOverdue && (
                    <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold animate-pulse">📅 CUOTA HOY</span>
                  )}
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
                      <div className="grid grid-cols-[50px_1fr_90px_100px_120px] md:grid-cols-[60px_1fr_110px_120px_120px_140px] gap-2 px-3 py-2 bg-gray-100 text-xs font-bold text-gray-500 uppercase">
                        <span>#</span>
                        <span>Fecha de Pago</span>
                        <span>Valor</span>
                        <span>Estado</span>
                        <span className="hidden md:block">Pagado el</span>
                        <span>Acción</span>
                      </div>
                      {record.cuotas.map(cuota => (
                        <div
                          key={cuota.number}
                          className={`grid grid-cols-[50px_1fr_90px_100px_120px] md:grid-cols-[60px_1fr_110px_120px_120px_140px] gap-2 px-3 py-2.5 border-t items-center text-sm ${
                            cuota.status === 'paid' ? 'bg-green-50/50' :
                            cuota.status === 'overdue' ? 'bg-red-50/50' : ''
                          }`}
                        >
                          <span className="font-mono font-bold text-gray-500">{cuota.number}</span>
                          <span className={`font-medium ${cuota.status === 'overdue' ? 'text-red-700' : 'text-gray-700'}`}>
                            {formatDate(cuota.dueDate)}
                          </span>
                          <span className="font-bold text-orange-600">{formatCurrency(record.valorCuota)}</span>
                          <span>
                            {cuota.status === 'paid' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-bold">
                                <CheckCircle className="w-3 h-3" /> Pagada
                              </span>
                            )}
                            {cuota.status === 'pending' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-xs font-bold">
                                <Clock className="w-3 h-3" /> Pendiente
                              </span>
                            )}
                            {cuota.status === 'overdue' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-600 text-white text-xs font-bold animate-pulse">
                                🔒 BLOQUEADO
                              </span>
                            )}
                          </span>
                          <span className="hidden md:block text-xs text-gray-400">
                            {cuota.paidDate ? formatDate(cuota.paidDate) : '—'}
                          </span>
                          <span>
                            {cuota.status === 'paid' ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleUnpayInstallment(record.id, cuota.number); }}
                                className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-1 transition-colors"
                              >
                                <RotateCcw className="w-3 h-3" /> Desmarcar
                              </button>
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); handlePayInstallment(record.id, cuota.number); }}
                                className="text-xs bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg font-bold flex items-center gap-1 transition-colors"
                              >
                                <CheckCircle className="w-3 h-3" /> Pagar
                              </button>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Acciones */}
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleSendReminder(record.id); }}
                        disabled={sendingReminder === record.id || record.status === 'completed'}
                        className="flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Send className="w-4 h-4" />
                        {sendingReminder === record.id ? 'Enviando...' : 'Enviar recordatorio WhatsApp'}
                      </button>
                      <a
                        href={`https://wa.me/57${record.telefono.replace(/\D/g, '').replace(/^57/, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-semibold transition-colors"
                        onClick={e => e.stopPropagation()}
                      >
                        <Phone className="w-4 h-4" /> Contactar
                      </a>
                      <button
                        onClick={(e) => { e.stopPropagation(); openEdit(record); }}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-lg text-sm font-semibold transition-colors"
                      >
                        <Pencil className="w-4 h-4" /> Editar
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(record.id); }}
                        className="flex items-center gap-2 px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-sm font-semibold transition-colors"
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
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Nombre *</Label>
                <Input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Nombre completo" />
              </div>
              <div>
                <Label>Cédula *</Label>
                <Input value={form.cedula} onChange={e => setForm({ ...form, cedula: e.target.value })} placeholder="1234567890" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Teléfono *</Label>
                <Input value={form.telefono} onChange={e => setForm({ ...form, telefono: e.target.value })} placeholder="3001234567" />
              </div>
              <div>
                <Label>IMEI *</Label>
                <Input value={form.imei} onChange={e => setForm({ ...form, imei: e.target.value })} placeholder="123456789012345" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
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

            <div className="grid grid-cols-3 gap-4">
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
                  className="w-24"
                />
                <p className="text-[10px] text-blue-500 mt-1">Si el cliente ya pagó 4 cuotas, pon 4. Se marcan como pagadas automáticamente.</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
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
                    <div key={p.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-sm">
                      <div>
                        <span className="font-bold text-gray-800">{formatCurrency(p.amount)}</span>
                        <span className="text-gray-400 text-xs ml-2">
                          {new Date(p.date).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}
                        </span>
                        {p.note && <span className="text-gray-400 text-xs ml-1">— {p.note}</span>}
                      </div>
                      <button
                        onClick={() => handleDeleteXiaomiPayment(p.id)}
                        className="text-red-400 hover:text-red-600 ml-2"
                        title="Eliminar"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
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
    </div>
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
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wider opacity-70">{label}</span>
      </div>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}
