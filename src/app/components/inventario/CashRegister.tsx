import { useState, useEffect, useCallback } from 'react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { toast } from 'sonner';
import { API_BASE_URL, fetchWithTimeout } from '../../lib/api-base';
import {
  Plus, Trash2, Wallet, Landmark, ArrowDownCircle, ArrowUpCircle,
  Settings2, RefreshCw,
} from 'lucide-react';

interface Movimiento {
  id: string;
  tipo: 'ingreso' | 'egreso' | 'ajuste';
  cuenta: 'efectivo' | 'banco';
  monto: number;
  concepto: string;
  createdAt: string;
}

const fmt = (n: number) => `$${n.toLocaleString('es-CO')}`;

const TIPO_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
  ingreso: { label: 'Ingreso', icon: ArrowDownCircle, color: 'bg-green-100 text-green-700' },
  egreso: { label: 'Egreso', icon: ArrowUpCircle, color: 'bg-red-100 text-red-700' },
  ajuste: { label: 'Ajuste', icon: Settings2, color: 'bg-blue-100 text-blue-700' },
};

export function CashRegister() {
  const [saldos, setSaldos] = useState({ efectivo: 0, banco: 0 });
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [tipo, setTipo] = useState<'ingreso' | 'egreso'>('ingreso');
  const [cuenta, setCuenta] = useState<'efectivo' | 'banco'>('efectivo');
  const [monto, setMonto] = useState('');
  const [concepto, setConcepto] = useState('');
  const [saving, setSaving] = useState(false);

  // Ajuste state
  const [showAjuste, setShowAjuste] = useState(false);
  const [ajusteCuenta, setAjusteCuenta] = useState<'efectivo' | 'banco'>('efectivo');
  const [ajusteMonto, setAjusteMonto] = useState('');

  // Filter
  const [filterCuenta, setFilterCuenta] = useState<'todas' | 'efectivo' | 'banco'>('todas');

  const loadData = useCallback(async () => {
    try {
      const [saldosRes, movsRes] = await Promise.all([
        fetchWithTimeout(`${API_BASE_URL}/caja/saldos`),
        fetchWithTimeout(`${API_BASE_URL}/caja/movimientos?limit=100${filterCuenta !== 'todas' ? `&cuenta=${filterCuenta}` : ''}`),
      ]);
      if (saldosRes.ok) setSaldos(await saldosRes.json());
      if (movsRes.ok) setMovimientos(await movsRes.json());
    } catch (err) {
      console.error('[caja] Error:', err);
    } finally {
      setLoading(false);
    }
  }, [filterCuenta]);

  useEffect(() => { setLoading(true); loadData(); }, [loadData]);

  const handleAdd = async () => {
    if (!monto || Number(monto) <= 0) { toast.error('Ingresa un monto valido'); return; }
    if (!concepto.trim()) { toast.error('Ingresa un concepto'); return; }
    setSaving(true);
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/caja/movimiento`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo, cuenta, monto: Number(monto), concepto: concepto.trim() }),
      });
      if (res.ok) {
        toast.success(tipo === 'ingreso' ? 'Ingreso registrado' : 'Egreso registrado');
        setMonto('');
        setConcepto('');
        setShowForm(false);
        await loadData();
      }
    } catch { toast.error('Error al guardar'); }
    setSaving(false);
  };

  const handleAjuste = async () => {
    if (ajusteMonto === '' || Number(ajusteMonto) < 0) { toast.error('Ingresa un saldo valido'); return; }
    setSaving(true);
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/caja/ajuste`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cuenta: ajusteCuenta, nuevoSaldo: Number(ajusteMonto) }),
      });
      if (res.ok) {
        toast.success(`Saldo de ${ajusteCuenta === 'efectivo' ? 'Efectivo' : 'Banco'} ajustado`);
        setAjusteMonto('');
        setShowAjuste(false);
        await loadData();
      }
    } catch { toast.error('Error al ajustar'); }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Eliminar este movimiento?')) return;
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/caja/movimiento/${id}`, { method: 'DELETE' });
      if (res.ok) { toast.success('Eliminado'); await loadData(); }
    } catch { toast.error('Error'); }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Balance cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl p-4 text-white shadow-lg">
          <div className="flex items-center gap-2 mb-1">
            <Wallet className="w-5 h-5 opacity-80" />
            <span className="text-xs font-bold uppercase tracking-wider opacity-80">Efectivo</span>
          </div>
          <p className="text-2xl font-black">{fmt(saldos.efectivo)}</p>
          <p className="text-[10px] opacity-60 mt-1">Dinero en caja</p>
        </div>
        <div className="bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl p-4 text-white shadow-lg">
          <div className="flex items-center gap-2 mb-1">
            <Landmark className="w-5 h-5 opacity-80" />
            <span className="text-xs font-bold uppercase tracking-wider opacity-80">Banco</span>
          </div>
          <p className="text-2xl font-black">{fmt(saldos.banco)}</p>
          <p className="text-[10px] opacity-60 mt-1">Datáfono / Transferencias</p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button
          onClick={() => { setShowForm(!showForm); setShowAjuste(false); }}
          className="flex-1 bg-violet-600 hover:bg-violet-700 text-white gap-1"
        >
          <Plus className="w-4 h-4" /> Registrar movimiento
        </Button>
        <Button
          onClick={() => { setShowAjuste(!showAjuste); setShowForm(false); }}
          variant="outline"
          className="gap-1"
        >
          <Settings2 className="w-4 h-4" /> Ajustar saldo
        </Button>
        <Button onClick={() => loadData()} variant="outline" size="icon">
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      {/* Register movement form */}
      {showForm && (
        <div className="bg-white rounded-xl border p-4 space-y-3 animate-in slide-in-from-top-2">
          <p className="font-bold text-sm text-gray-700">Nuevo movimiento</p>

          {/* Tipo */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setTipo('ingreso')}
              className={`py-2.5 rounded-lg text-sm font-bold transition-all ${
                tipo === 'ingreso'
                  ? 'bg-green-100 text-green-700 ring-2 ring-green-400'
                  : 'bg-gray-100 text-gray-500'
              }`}
            >
              <ArrowDownCircle className="w-4 h-4 inline mr-1" /> Ingreso
            </button>
            <button
              onClick={() => setTipo('egreso')}
              className={`py-2.5 rounded-lg text-sm font-bold transition-all ${
                tipo === 'egreso'
                  ? 'bg-red-100 text-red-700 ring-2 ring-red-400'
                  : 'bg-gray-100 text-gray-500'
              }`}
            >
              <ArrowUpCircle className="w-4 h-4 inline mr-1" /> Egreso
            </button>
          </div>

          {/* Cuenta */}
          <div>
            <Label>Destino</Label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <button
                onClick={() => setCuenta('efectivo')}
                className={`py-2.5 rounded-lg text-sm font-semibold transition-all ${
                  cuenta === 'efectivo'
                    ? 'bg-green-50 text-green-700 ring-2 ring-green-300'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                <Wallet className="w-4 h-4 inline mr-1" /> Efectivo
              </button>
              <button
                onClick={() => setCuenta('banco')}
                className={`py-2.5 rounded-lg text-sm font-semibold transition-all ${
                  cuenta === 'banco'
                    ? 'bg-blue-50 text-blue-700 ring-2 ring-blue-300'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                <Landmark className="w-4 h-4 inline mr-1" /> Banco
              </button>
            </div>
          </div>

          {/* Monto + Concepto */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Monto *</Label>
              <Input
                type="number"
                value={monto}
                onChange={e => setMonto(e.target.value)}
                placeholder="0"
              />
            </div>
            <div>
              <Label>Concepto *</Label>
              <Input
                value={concepto}
                onChange={e => setConcepto(e.target.value)}
                placeholder="Ej: Venta, pago proveedor..."
              />
            </div>
          </div>

          <Button
            onClick={handleAdd}
            disabled={saving}
            className={`w-full gap-1 text-white ${
              tipo === 'ingreso' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
            }`}
          >
            <Plus className="w-4 h-4" /> {saving ? 'Guardando...' : `Registrar ${tipo}`}
          </Button>
        </div>
      )}

      {/* Ajuste saldo form */}
      {showAjuste && (
        <div className="bg-white rounded-xl border p-4 space-y-3 animate-in slide-in-from-top-2">
          <p className="font-bold text-sm text-gray-700">Ajustar saldo actual</p>
          <p className="text-xs text-gray-400">Coloca el monto real que tienes. El sistema calculará la diferencia.</p>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setAjusteCuenta('efectivo')}
              className={`py-2.5 rounded-lg text-sm font-semibold transition-all ${
                ajusteCuenta === 'efectivo'
                  ? 'bg-green-50 text-green-700 ring-2 ring-green-300'
                  : 'bg-gray-100 text-gray-500'
              }`}
            >
              <Wallet className="w-4 h-4 inline mr-1" /> Efectivo ({fmt(saldos.efectivo)})
            </button>
            <button
              onClick={() => setAjusteCuenta('banco')}
              className={`py-2.5 rounded-lg text-sm font-semibold transition-all ${
                ajusteCuenta === 'banco'
                  ? 'bg-blue-50 text-blue-700 ring-2 ring-blue-300'
                  : 'bg-gray-100 text-gray-500'
              }`}
            >
              <Landmark className="w-4 h-4 inline mr-1" /> Banco ({fmt(saldos.banco)})
            </button>
          </div>

          <div>
            <Label>Saldo real actual *</Label>
            <Input
              type="number"
              value={ajusteMonto}
              onChange={e => setAjusteMonto(e.target.value)}
              placeholder="Ej: 500000"
            />
          </div>

          <Button
            onClick={handleAjuste}
            disabled={saving}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white gap-1"
          >
            <Settings2 className="w-4 h-4" /> {saving ? 'Ajustando...' : 'Ajustar saldo'}
          </Button>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        {(['todas', 'efectivo', 'banco'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilterCuenta(f)}
            className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-all ${
              filterCuenta === f
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {f === 'todas' ? 'Todos' : f === 'efectivo' ? 'Efectivo' : 'Banco'}
          </button>
        ))}
      </div>

      {/* Movement list */}
      <div className="bg-white rounded-xl border overflow-hidden">
        {movimientos.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <Wallet className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-semibold">No hay movimientos registrados</p>
            <p className="text-xs mt-1">Usa "Ajustar saldo" para registrar tu efectivo y banco actual</p>
          </div>
        ) : (
          <div className="divide-y">
            {movimientos.map(m => {
              const config = TIPO_CONFIG[m.tipo] || TIPO_CONFIG.ingreso;
              const Icon = config.icon;
              const isPositive = m.tipo !== 'egreso';
              return (
                <div key={m.id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50/50">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${config.color}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 text-sm truncate">{m.concepto || config.label}</p>
                      <p className="text-xs text-gray-400">
                        {new Date(m.createdAt).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}
                        {' '}
                        {new Date(m.createdAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                        <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          m.cuenta === 'efectivo' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {m.cuenta === 'efectivo' ? 'Efectivo' : 'Banco'}
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`font-bold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                      {isPositive ? '+' : '-'}{fmt(m.monto)}
                    </span>
                    <button onClick={() => handleDelete(m.id)} className="text-gray-300 hover:text-red-500">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
