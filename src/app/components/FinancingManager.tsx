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
  X, RotateCcw, Phone, CreditCard
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Installment {
  number: number;
  dueDate: string;
  paidDate?: string;
  status: 'pending' | 'paid' | 'overdue';
}

interface FinancingRecord {
  id: string;
  nombre: string;
  cedula: string;
  telefono: string;
  imei: string;
  producto: string;
  costoTotal: number;
  cuotaInicial: number;
  numeroCuotas: number;
  valorCuota: number;
  fechaInicio: string;
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

  const [form, setForm] = useState({
    nombre: '',
    cedula: '',
    telefono: '',
    imei: '',
    producto: '',
    costoTotal: '',
    cuotaInicial: '',
    numeroCuotas: '',
    fechaInicio: new Date().toISOString().slice(0, 10),
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

  useEffect(() => { loadRecords(); }, [loadRecords]);

  const handleSave = async () => {
    if (!form.nombre || !form.cedula || !form.telefono || !form.imei || !form.costoTotal || !form.numeroCuotas || !form.fechaInicio) {
      toast.error('Completa todos los campos obligatorios');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        nombre: form.nombre,
        cedula: form.cedula,
        telefono: form.telefono,
        imei: form.imei,
        producto: form.producto,
        costoTotal: Number(form.costoTotal),
        cuotaInicial: Number(form.cuotaInicial || 0),
        numeroCuotas: Number(form.numeroCuotas),
        fechaInicio: new Date(form.fechaInicio).toISOString(),
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
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/financing/${recordId}/pay/${cuotaNumber}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        toast.success(`Cuota #${cuotaNumber} marcada como pagada ✅`);
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

  // ─── Helpers ──────────────────────────────────────────────────────────────

  const resetForm = () => {
    setEditing(null);
    setForm({
      nombre: '', cedula: '', telefono: '', imei: '', producto: '',
      costoTotal: '', cuotaInicial: '', numeroCuotas: '',
      fechaInicio: new Date().toISOString().slice(0, 10),
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
      costoTotal: record.costoTotal.toString(),
      cuotaInicial: record.cuotaInicial.toString(),
      numeroCuotas: record.numeroCuotas.toString(),
      fechaInicio: record.fechaInicio.slice(0, 10),
    });
    setDialogOpen(true);
  };

  const openCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleDateString('es-CO', {
      day: '2-digit', month: 'short', year: 'numeric'
    });
  };

  const formatCurrency = (n: number) => `$${n.toLocaleString('es-CO')}`;

  const saldoFinanciar = Number(form.costoTotal || 0) - Number(form.cuotaInicial || 0);
  const valorCuotaPreview = form.numeroCuotas && saldoFinanciar > 0
    ? Math.round(saldoFinanciar / Number(form.numeroCuotas))
    : 0;

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
    const totalPorCobrar = active.reduce((sum, r) => {
      const cuotasPendientes = r.cuotas.filter(c => c.status !== 'paid').length;
      return sum + cuotasPendientes * r.valorCuota;
    }, 0);
    const totalRecaudado = records.reduce((sum, r) => {
      const cuotasPagadas = r.cuotas.filter(c => c.status === 'paid').length;
      return sum + cuotasPagadas * r.valorCuota + r.cuotaInicial;
    }, 0);

    return {
      total: records.length,
      active: active.length,
      overdue: overdue.length,
      completed: records.filter(r => r.status === 'completed').length,
      totalPorCobrar,
      totalRecaudado,
    };
  }, [records]);

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
            Sistema de Financiamiento
          </h2>
          <p className="text-sm text-gray-500 mt-1">Cuotas quincenales con recordatorios automáticos por WhatsApp</p>
        </div>
        <Button onClick={openCreate} className="bg-orange-500 hover:bg-orange-600 text-white gap-2">
          <Plus className="w-4 h-4" /> Nuevo Financiamiento
        </Button>
      </div>

      {/* ── KPI Cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <KpiCard icon={<Users className="w-5 h-5" />} label="Total" value={kpis.total} color="blue" />
        <KpiCard icon={<Clock className="w-5 h-5" />} label="Activos" value={kpis.active} color="orange" />
        <KpiCard icon={<AlertTriangle className="w-5 h-5" />} label="Vencidos" value={kpis.overdue} color="red" />
        <KpiCard icon={<CheckCircle className="w-5 h-5" />} label="Completados" value={kpis.completed} color="green" />
        <KpiCard icon={<DollarSign className="w-5 h-5" />} label="Por cobrar" value={formatCurrency(kpis.totalPorCobrar)} color="amber" />
        <KpiCard icon={<DollarSign className="w-5 h-5" />} label="Recaudado" value={formatCurrency(kpis.totalRecaudado)} color="emerald" />
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
          <div className="hidden lg:grid lg:grid-cols-[1fr_100px_110px_150px_100px_100px_90px_110px_70px] gap-2 px-4 py-3 bg-gray-50 border-b text-xs font-bold text-gray-500 uppercase tracking-wider">
            <span>Nombre</span>
            <span>Cédula</span>
            <span>Teléfono</span>
            <span>IMEI</span>
            <span>C. Inicial</span>
            <span>Costo</span>
            <span>Cuotas</span>
            <span>Próx. Pago</span>
            <span></span>
          </div>

          {filteredRecords.map(record => {
            const isExpanded = expandedId === record.id;
            const nextPending = record.cuotas.find(c => c.status !== 'paid');
            const paidCount = record.cuotas.filter(c => c.status === 'paid').length;
            const hasOverdue = record.cuotas.some(c => c.status === 'overdue');
            const totalPagado = paidCount * record.valorCuota + record.cuotaInicial;
            const totalRestante = record.costoTotal - totalPagado;

            return (
              <div key={record.id} className={`border-b last:border-b-0 transition-colors ${hasOverdue ? 'bg-red-50/50' : ''}`}>
                {/* Row principal */}
                <div
                  className="grid grid-cols-1 lg:grid-cols-[1fr_100px_110px_150px_100px_100px_90px_110px_70px] gap-2 px-4 py-3 cursor-pointer hover:bg-gray-50/80 items-center"
                  onClick={() => setExpandedId(isExpanded ? null : record.id)}
                >
                  {/* Nombre + producto — mobile friendly */}
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      record.status === 'completed' ? 'bg-green-500' : hasOverdue ? 'bg-red-500' : 'bg-orange-500'
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
                  <span className="hidden lg:block text-sm font-bold text-gray-900">{formatCurrency(record.costoTotal)}</span>
                  <span className="hidden lg:block text-sm text-gray-700">
                    <span className="font-bold text-orange-600">{paidCount}</span>
                    <span className="text-gray-400">/{record.numeroCuotas}</span>
                  </span>
                  <span className="hidden lg:block text-xs">
                    {nextPending ? (
                      <span className={`px-2 py-1 rounded-full font-semibold ${
                        nextPending.status === 'overdue'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-blue-100 text-blue-700'
                      }`}>
                        {formatDate(nextPending.dueDate)}
                      </span>
                    ) : (
                      <span className="px-2 py-1 rounded-full bg-green-100 text-green-700 font-semibold">Pagado</span>
                    )}
                  </span>
                  <span className="hidden lg:flex items-center justify-end">
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                  </span>
                </div>

                {/* Mobile summary row */}
                <div className="lg:hidden px-4 pb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                  <span>CC: {record.cedula}</span>
                  <span>Tel: {record.telefono}</span>
                  <span>IMEI: {record.imei.slice(0, 10)}...</span>
                  <span className="font-bold text-gray-700">{formatCurrency(record.costoTotal)}</span>
                  <span>Cuotas: <span className="text-orange-600 font-bold">{paidCount}/{record.numeroCuotas}</span></span>
                </div>

                {/* ── Panel expandido con cuotas ──────────────────────────── */}
                {isExpanded && (
                  <div className="px-4 pb-4 bg-gray-50/70 border-t border-gray-100 animate-in fade-in slide-in-from-top-1 duration-200">
                    {/* Resumen */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 py-4">
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
                      <div className="grid grid-cols-[50px_1fr_100px_120px] md:grid-cols-[60px_1fr_120px_120px_140px] gap-2 px-3 py-2 bg-gray-100 text-xs font-bold text-gray-500 uppercase">
                        <span>#</span>
                        <span>Fecha de Pago</span>
                        <span>Estado</span>
                        <span className="hidden md:block">Pagado el</span>
                        <span>Acción</span>
                      </div>
                      {record.cuotas.map(cuota => (
                        <div
                          key={cuota.number}
                          className={`grid grid-cols-[50px_1fr_100px_120px] md:grid-cols-[60px_1fr_120px_120px_140px] gap-2 px-3 py-2.5 border-t items-center text-sm ${
                            cuota.status === 'paid' ? 'bg-green-50/50' :
                            cuota.status === 'overdue' ? 'bg-red-50/50' : ''
                          }`}
                        >
                          <span className="font-mono font-bold text-gray-500">{cuota.number}</span>
                          <span className={`font-medium ${cuota.status === 'overdue' ? 'text-red-700' : 'text-gray-700'}`}>
                            {formatDate(cuota.dueDate)}
                          </span>
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
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-bold">
                                <AlertTriangle className="w-3 h-3" /> Vencida
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
              {editing ? 'Editar Financiamiento' : 'Nuevo Financiamiento'}
            </DialogTitle>
            <DialogDescription>
              {editing ? 'Modifica los datos del financiamiento' : 'Registra un nuevo cliente con plan de cuotas quincenales'}
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

            <div>
              <Label>Producto</Label>
              <Input value={form.producto} onChange={e => setForm({ ...form, producto: e.target.value })} placeholder="Ej: Xiaomi Redmi Note 13" />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Costo Total *</Label>
                <Input type="number" value={form.costoTotal} onChange={e => setForm({ ...form, costoTotal: e.target.value })} placeholder="800000" />
              </div>
              <div>
                <Label>Cuota Inicial</Label>
                <Input type="number" value={form.cuotaInicial} onChange={e => setForm({ ...form, cuotaInicial: e.target.value })} placeholder="200000" />
              </div>
              <div>
                <Label># Cuotas *</Label>
                <Input type="number" value={form.numeroCuotas} onChange={e => setForm({ ...form, numeroCuotas: e.target.value })} placeholder="6" min="1" max="24" />
              </div>
            </div>

            <div>
              <Label>Fecha primer pago *</Label>
              <Input type="date" value={form.fechaInicio} onChange={e => setForm({ ...form, fechaInicio: e.target.value })} />
            </div>

            {/* Preview cálculo */}
            {valorCuotaPreview > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                <p className="text-sm text-orange-800 font-medium mb-2">📊 Resumen del plan</p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <span className="text-gray-600">Saldo a financiar:</span>
                  <span className="font-bold text-gray-900">{formatCurrency(saldoFinanciar)}</span>
                  <span className="text-gray-600">Valor cada cuota:</span>
                  <span className="font-bold text-orange-600">{formatCurrency(valorCuotaPreview)}</span>
                  <span className="text-gray-600">Frecuencia:</span>
                  <span className="font-bold text-gray-900">Cada 15 días</span>
                  <span className="text-gray-600">Total a pagar:</span>
                  <span className="font-bold text-gray-900">{formatCurrency(Number(form.costoTotal))}</span>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-3 mt-6">
            <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }} className="flex-1">
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving} className="flex-1 bg-orange-500 hover:bg-orange-600 text-white">
              {saving ? 'Guardando...' : editing ? 'Actualizar' : 'Crear Financiamiento'}
            </Button>
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
