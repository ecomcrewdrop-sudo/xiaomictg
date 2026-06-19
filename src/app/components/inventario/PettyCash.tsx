import { useState, useEffect, useCallback } from 'react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { toast } from 'sonner';
import { API_BASE_URL, fetchWithTimeout } from '../../lib/api-base';
import { Plus, Trash2, Wallet, ArrowDownCircle, ShoppingBag, Send, ChevronLeft, ChevronRight } from 'lucide-react';

interface PettyCashEntry {
  id: string;
  fecha: string;
  monto: number;
  concepto: string;
  tipo: 'retiro' | 'gasto' | 'transferencia';
  createdAt: string;
}

const fmt = (n: number) => `$${n.toLocaleString('es-CO')}`;

const QUICK_AMOUNTS = [10000, 20000, 50000, 100000];

const TIPO_CONFIG = {
  retiro: { label: 'Retiro', icon: ArrowDownCircle, color: 'bg-red-100 text-red-700' },
  gasto: { label: 'Gasto', icon: ShoppingBag, color: 'bg-amber-100 text-amber-700' },
  transferencia: { label: 'Transferencia', icon: Send, color: 'bg-blue-100 text-blue-700' },
};

export function PettyCash() {
  const [gastos, setGastos] = useState<PettyCashEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));

  const [monto, setMonto] = useState('');
  const [concepto, setConcepto] = useState('');
  const [tipo, setTipo] = useState<'retiro' | 'gasto' | 'transferencia'>('gasto');
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/inventario/caja-menor?fecha=${fecha}`);
      if (res.ok) setGastos(await res.json());
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [fecha]);

  useEffect(() => { setLoading(true); loadData(); }, [loadData]);

  const handleAdd = async () => {
    if (!monto || !concepto) { toast.error('Monto y concepto requeridos'); return; }
    setSaving(true);
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/inventario/caja-menor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monto: Number(monto), concepto, tipo }),
      });
      if (res.ok) {
        toast.success('Gasto registrado');
        setMonto('');
        setConcepto('');
        await loadData();
      }
    } catch { toast.error('Error'); }
    setSaving(false);
  };

  const handleQuickAdd = async (amount: number) => {
    const concepto_prompt = prompt(`Concepto para retiro de ${fmt(amount)}:`);
    if (!concepto_prompt) return;
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/inventario/caja-menor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monto: amount, concepto: concepto_prompt, tipo: 'retiro' }),
      });
      if (res.ok) { toast.success(`Retiro de ${fmt(amount)} registrado`); await loadData(); }
    } catch { toast.error('Error'); }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/inventario/caja-menor/${id}`, { method: 'DELETE' });
      if (res.ok) { toast.success('Eliminado'); await loadData(); }
    } catch { toast.error('Error'); }
  };

  const changeDate = (days: number) => {
    const d = new Date(fecha);
    d.setDate(d.getDate() + days);
    setFecha(d.toISOString().slice(0, 10));
  };

  const total = gastos.reduce((s, g) => s + g.monto, 0);
  const isToday = fecha === new Date().toISOString().slice(0, 10);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Date selector */}
      <div className="flex items-center justify-between bg-white rounded-xl border p-3">
        <button onClick={() => changeDate(-1)} className="p-2 hover:bg-gray-100 rounded-lg"><ChevronLeft className="w-5 h-5" /></button>
        <div className="text-center">
          <p className="text-sm font-bold text-gray-900 capitalize">
            {new Date(fecha + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          {isToday && <span className="text-xs text-violet-600 font-semibold">HOY</span>}
        </div>
        <button onClick={() => changeDate(1)} className="p-2 hover:bg-gray-100 rounded-lg"><ChevronRight className="w-5 h-5" /></button>
      </div>

      {/* Total */}
      <div className="bg-gradient-to-br from-red-500 to-rose-600 rounded-2xl p-4 text-white shadow-lg">
        <div className="flex items-center gap-2 mb-1">
          <Wallet className="w-5 h-5 opacity-80" />
          <span className="text-sm font-bold uppercase tracking-wider opacity-80">Total gastos del dia</span>
        </div>
        <p className="text-3xl font-black">{fmt(total)}</p>
        <p className="text-xs opacity-70">{gastos.length} movimientos</p>
      </div>

      {/* Quick amounts */}
      {isToday && (
        <div>
          <p className="text-xs text-gray-500 font-semibold mb-2">RETIRO RAPIDO</p>
          <div className="grid grid-cols-4 gap-2">
            {QUICK_AMOUNTS.map(amount => (
              <button
                key={amount}
                onClick={() => handleQuickAdd(amount)}
                className="bg-white border-2 border-dashed border-gray-300 hover:border-violet-400 hover:bg-violet-50 rounded-xl py-3 text-center transition-colors"
              >
                <p className="font-bold text-gray-700">{fmt(amount)}</p>
                <p className="text-[10px] text-gray-400">Retiro</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Add form */}
      {isToday && (
        <div className="bg-white rounded-xl border p-4 space-y-3">
          <p className="font-bold text-sm text-gray-700">Registrar gasto</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Monto *</Label>
              <Input type="number" value={monto} onChange={e => setMonto(e.target.value)} placeholder="0" />
            </div>
            <div>
              <Label>Tipo</Label>
              <select value={tipo} onChange={e => setTipo(e.target.value as typeof tipo)} className="w-full h-10 rounded-md border border-gray-200 px-3 text-sm">
                <option value="gasto">Gasto</option>
                <option value="retiro">Retiro</option>
                <option value="transferencia">Transferencia</option>
              </select>
            </div>
          </div>
          <div>
            <Label>Concepto *</Label>
            <Input value={concepto} onChange={e => setConcepto(e.target.value)} placeholder="Ej: Almuerzo, taxi, papeleria..." />
          </div>
          <Button onClick={handleAdd} disabled={saving} className="w-full bg-violet-600 hover:bg-violet-700 text-white gap-1">
            <Plus className="w-4 h-4" /> {saving ? 'Guardando...' : 'Registrar'}
          </Button>
        </div>
      )}

      {/* List */}
      <div className="bg-white rounded-xl border overflow-hidden">
        {gastos.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <Wallet className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-semibold">No hay gastos registrados</p>
          </div>
        ) : (
          <div className="divide-y">
            {gastos.map(g => {
              const config = TIPO_CONFIG[g.tipo] || TIPO_CONFIG.gasto;
              const Icon = config.icon;
              return (
                <div key={g.id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50/50">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${config.color}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900 text-sm">{g.concepto}</p>
                      <p className="text-xs text-gray-400">
                        {new Date(g.createdAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                        <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold ${config.color}`}>{config.label}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-red-600">-{fmt(g.monto)}</span>
                    <button onClick={() => handleDelete(g.id)} className="text-gray-300 hover:text-red-500">
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
