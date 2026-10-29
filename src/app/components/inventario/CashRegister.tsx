import { useState, useEffect, useCallback } from 'react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { toast } from 'sonner';
import { API_BASE_URL, fetchWithTimeout } from '../../lib/api-base';
import {
  Plus, Trash2, Wallet, Landmark, ArrowDownCircle, ArrowUpCircle,
  Settings2, RefreshCw, X, CreditCard, User,
} from 'lucide-react';

interface Cuenta {
  id: string;
  nombre: string;
  color: string;
  orden: number;
}

interface Movimiento {
  id: string;
  tipo: 'ingreso' | 'egreso' | 'ajuste';
  cuenta: string;
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

const CARD_COLORS: Record<string, string> = {
  green: 'from-green-500 to-emerald-600',
  blue: 'from-blue-500 to-indigo-600',
  purple: 'from-purple-500 to-violet-600',
  orange: 'from-orange-500 to-amber-600',
  pink: 'from-pink-500 to-rose-600',
  teal: 'from-teal-500 to-cyan-600',
  red: 'from-red-500 to-rose-600',
  yellow: 'from-yellow-500 to-amber-600',
};

const CARD_ICONS: Record<string, any> = {
  efectivo: Wallet,
  banco: Landmark,
};

const BADGE_COLORS: Record<string, string> = {
  green: 'bg-green-100 text-green-700',
  blue: 'bg-blue-100 text-blue-700',
  purple: 'bg-purple-100 text-purple-700',
  orange: 'bg-orange-100 text-orange-700',
  pink: 'bg-pink-100 text-pink-700',
  teal: 'bg-teal-100 text-teal-700',
  red: 'bg-red-100 text-red-700',
  yellow: 'bg-yellow-100 text-yellow-700',
};

export function CashRegister() {
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [saldos, setSaldos] = useState<Record<string, number>>({});
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [tipo, setTipo] = useState<'ingreso' | 'egreso'>('ingreso');
  const [cuenta, setCuenta] = useState('efectivo');
  const [monto, setMonto] = useState('');
  const [concepto, setConcepto] = useState('');
  const [saving, setSaving] = useState(false);

  // Ajuste state
  const [showAjuste, setShowAjuste] = useState(false);
  const [ajusteCuenta, setAjusteCuenta] = useState('efectivo');
  const [ajusteMonto, setAjusteMonto] = useState('');

  // New account state
  const [showNewCuenta, setShowNewCuenta] = useState(false);
  const [newCuentaNombre, setNewCuentaNombre] = useState('');
  const [newCuentaColor, setNewCuentaColor] = useState('purple');

  // Filter
  const [filterCuenta, setFilterCuenta] = useState('todas');

  const loadData = useCallback(async () => {
    try {
      const [cuentasRes, saldosRes, movsRes] = await Promise.all([
        fetchWithTimeout(`${API_BASE_URL}/caja/cuentas`),
        fetchWithTimeout(`${API_BASE_URL}/caja/saldos`),
        fetchWithTimeout(`${API_BASE_URL}/caja/movimientos?limit=100${filterCuenta !== 'todas' ? `&cuenta=${filterCuenta}` : ''}`),
      ]);
      if (cuentasRes.ok) setCuentas(await cuentasRes.json());
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
        setMonto(''); setConcepto(''); setShowForm(false);
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
        const cuentaName = cuentas.find(c => c.id === ajusteCuenta)?.nombre || ajusteCuenta;
        toast.success(`Saldo de ${cuentaName} ajustado`);
        setAjusteMonto(''); setShowAjuste(false);
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

  const handleNewCuenta = async () => {
    if (!newCuentaNombre.trim()) { toast.error('Nombre requerido'); return; }
    setSaving(true);
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/caja/cuentas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: newCuentaNombre.trim(), color: newCuentaColor }),
      });
      if (res.ok) {
        toast.success(`Cuenta "${newCuentaNombre}" creada`);
        setNewCuentaNombre(''); setShowNewCuenta(false);
        await loadData();
      }
    } catch { toast.error('Error al crear'); }
    setSaving(false);
  };

  const handleDeleteCuenta = async (id: string) => {
    const c = cuentas.find(x => x.id === id);
    if (!confirm(`Eliminar cuenta "${c?.nombre}"? Se borrarán todos sus movimientos.`)) return;
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/caja/cuentas/${id}`, { method: 'DELETE' });
      if (res.ok) { toast.success('Cuenta eliminada'); await loadData(); }
      else {
        const data = await res.json();
        toast.error(data.error || 'Error');
      }
    } catch { toast.error('Error'); }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>;
  }

  const getCuentaName = (id: string) => cuentas.find(c => c.id === id)?.nombre || id;
  const getCuentaColor = (id: string) => cuentas.find(c => c.id === id)?.color || 'purple';

  return (
    <div className="space-y-4">
      {/* Balance cards — dynamic grid */}
      {/* Con tres cuentas el grid-cols-3 dejaba tarjetas de 105px y un saldo
          como "$207.039.894" las partía: en móvil siempre dos columnas. */}
      <div className={`grid gap-3 grid-cols-2 ${cuentas.length === 3 ? 'sm:grid-cols-3' : ''}`}>
        {cuentas.map(c => {
          const Icon = CARD_ICONS[c.id] || CreditCard;
          const gradient = CARD_COLORS[c.color] || CARD_COLORS.purple;
          const saldo = saldos[c.id] || 0;
          return (
            <div key={c.id} className={`min-w-0 bg-gradient-to-br ${gradient} rounded-2xl p-3 text-white shadow-lg relative group sm:p-4`}>
              {c.id !== 'efectivo' && c.id !== 'banco' && (
                /* En táctil no hay :hover, así que la X nunca llegaría a aparecer.
                 *
                 * 36px a propósito, por debajo del mínimo táctil de 44px que se
                 * aplica en el resto del panel: la tarjeta mide unos 160px de
                 * ancho y una diana de 44px en la esquina se comería el nombre de
                 * la cuenta y volvería fácil borrarla sin querer. Pasa de 20px a
                 * 36px, que ya se acierta, y la acción pide confirmación antes de
                 * borrar nada. */
                <button
                  onClick={() => handleDeleteCuenta(c.id)}
                  aria-label={`Eliminar cuenta ${c.nombre}`}
                  className="absolute right-1 top-1 flex h-9 w-9 items-center justify-center rounded-full bg-black/20 transition-opacity hover:bg-black/40 md:right-2 md:top-2 md:h-auto md:w-auto md:p-1 md:opacity-0 md:group-hover:opacity-100"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
              <div className="flex items-center gap-2 mb-1 pr-5">
                <Icon className="w-5 h-5 shrink-0 opacity-80" />
                <span className="min-w-0 truncate text-xs font-bold uppercase tracking-wider opacity-80">{c.nombre}</span>
              </div>
              <p className="text-lg font-black leading-tight break-all sm:text-xl">{fmt(saldo)}</p>
            </div>
          );
        })}
        {/* Add account button */}
        <button
          onClick={() => setShowNewCuenta(!showNewCuenta)}
          className="min-w-0 border-2 border-dashed border-gray-300 hover:border-violet-400 hover:bg-violet-50 rounded-2xl p-3 flex flex-col items-center justify-center gap-1 transition-colors sm:p-4"
        >
          <Plus className="w-5 h-5 shrink-0 text-gray-400" />
          <span className="text-xs font-semibold text-gray-400">Nueva cuenta</span>
        </button>
      </div>

      {/* New account form */}
      {showNewCuenta && (
        <div className="bg-white rounded-xl border p-4 space-y-3 animate-in slide-in-from-top-2">
          <p className="font-bold text-sm text-gray-700">Crear nueva cuenta</p>
          <div>
            <Label>Nombre *</Label>
            <Input
              value={newCuentaNombre}
              onChange={e => setNewCuentaNombre(e.target.value)}
              placeholder="Ej: Bold, Deuda Pedro, Nequi..."
            />
          </div>
          <div>
            <Label>Color</Label>
            {/* Mismo criterio que en el punto de venta: los círculos de 32px
                quedaban por debajo del mínimo táctil y pegados entre sí. */}
            <div className="flex gap-2 mt-1 flex-wrap">
              {Object.keys(CARD_COLORS).map(color => (
                <button
                  key={color}
                  onClick={() => setNewCuentaColor(color)}
                  aria-label={`Color ${color}`}
                  className={`h-11 w-11 shrink-0 rounded-full bg-gradient-to-br sm:h-8 sm:w-8 ${CARD_COLORS[color]} ${
                    newCuentaColor === color ? 'ring-2 ring-offset-2 ring-violet-500' : ''
                  }`}
                />
              ))}
            </div>
          </div>
          <Button onClick={handleNewCuenta} disabled={saving} className="w-full bg-violet-600 hover:bg-violet-700 text-white gap-1">
            <Plus className="w-4 h-4" /> {saving ? 'Creando...' : 'Crear cuenta'}
          </Button>
        </div>
      )}

      {/* Action buttons */}
      {/* Los tres botones suman ~330px y no caben en los 328px útiles de un
          móvil de 360: "Registrar movimiento" se queda con la fila completa. */}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => { setShowForm(!showForm); setShowAjuste(false); setShowNewCuenta(false); }}
          className="w-full bg-violet-600 hover:bg-violet-700 text-white gap-1 sm:w-auto sm:flex-1"
        >
          <Plus className="w-4 h-4 shrink-0" /> Registrar movimiento
        </Button>
        <Button
          onClick={() => { setShowAjuste(!showAjuste); setShowForm(false); setShowNewCuenta(false); }}
          variant="outline"
          className="flex-1 gap-1 sm:flex-none"
        >
          <Settings2 className="w-4 h-4 shrink-0" /> Ajustar
        </Button>
        <Button onClick={() => loadData()} variant="outline" size="icon" aria-label="Recargar movimientos" className="shrink-0">
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      {/* Register movement form */}
      {showForm && (
        <div className="bg-white rounded-xl border p-4 space-y-3 animate-in slide-in-from-top-2">
          <p className="font-bold text-sm text-gray-700">Nuevo movimiento</p>

          {/* Tipo. `py-2.5` sobre una línea de 20px daba 40px: por debajo del
              mínimo táctil, y elegir mal aquí invierte el signo del movimiento. */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setTipo('ingreso')}
              className={`min-h-11 py-2.5 rounded-lg text-sm font-bold transition-all sm:min-h-0 ${
                tipo === 'ingreso' ? 'bg-green-100 text-green-700 ring-2 ring-green-400' : 'bg-gray-100 text-gray-500'
              }`}
            >
              <ArrowDownCircle className="w-4 h-4 inline mr-1" /> Ingreso
            </button>
            <button
              onClick={() => setTipo('egreso')}
              className={`min-h-11 py-2.5 rounded-lg text-sm font-bold transition-all sm:min-h-0 ${
                tipo === 'egreso' ? 'bg-red-100 text-red-700 ring-2 ring-red-400' : 'bg-gray-100 text-gray-500'
              }`}
            >
              <ArrowUpCircle className="w-4 h-4 inline mr-1" /> Egreso
            </button>
          </div>

          {/* Cuenta — dynamic */}
          <div>
            <Label>Cuenta</Label>
            <div className="flex gap-2 mt-1 flex-wrap">
              {cuentas.map(c => {
                const badge = BADGE_COLORS[c.color] || BADGE_COLORS.purple;
                return (
                  <button
                    key={c.id}
                    onClick={() => setCuenta(c.id)}
                    className={`max-w-full min-h-11 px-3 py-2 rounded-lg text-sm font-semibold break-words transition-all sm:min-h-0 ${
                      cuenta === c.id ? `${badge} ring-2 ring-offset-1 ring-current` : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {c.nombre}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Monto + Concepto */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>Monto *</Label>
              <Input type="number" value={monto} onChange={e => setMonto(e.target.value)} placeholder="0" />
            </div>
            <div>
              <Label>Concepto *</Label>
              <Input value={concepto} onChange={e => setConcepto(e.target.value)} placeholder="Ej: Venta, pago..." />
            </div>
          </div>

          <Button
            onClick={handleAdd}
            disabled={saving}
            className={`w-full gap-1 text-white ${tipo === 'ingreso' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
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

          <div className="flex gap-2 flex-wrap">
            {cuentas.map(c => {
              const badge = BADGE_COLORS[c.color] || BADGE_COLORS.purple;
              return (
                <button
                  key={c.id}
                  onClick={() => setAjusteCuenta(c.id)}
                  /* El chip incluye el saldo ("Nequi ($1.250.000)") y se salía
                     del ancho del formulario: max-w-full + break-all lo contiene. */
                  className={`max-w-full min-h-11 px-3 py-2 rounded-lg text-sm font-semibold break-all transition-all sm:min-h-0 ${
                    ajusteCuenta === c.id ? `${badge} ring-2 ring-offset-1 ring-current` : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {c.nombre} ({fmt(saldos[c.id] || 0)})
                </button>
              );
            })}
          </div>

          <div>
            <Label>Saldo real actual *</Label>
            <Input type="number" value={ajusteMonto} onChange={e => setAjusteMonto(e.target.value)} placeholder="Ej: 500000" />
          </div>

          <Button onClick={handleAjuste} disabled={saving} className="w-full bg-blue-600 hover:bg-blue-700 text-white gap-1">
            <Settings2 className="w-4 h-4" /> {saving ? 'Ajustando...' : 'Ajustar saldo'}
          </Button>
        </div>
      )}

      {/* Filter tabs */}
      {/* La barra de scroll horizontal nativa tapaba media fila de botones. */}
      <div className="flex snap-x gap-1 bg-gray-100 rounded-lg p-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          onClick={() => setFilterCuenta('todas')}
          className={`flex h-11 flex-none shrink-0 snap-start items-center whitespace-nowrap rounded-md px-3 text-xs font-semibold transition-all sm:h-auto sm:py-1.5 ${
            filterCuenta === 'todas' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Todos
        </button>
        {cuentas.map(c => (
          <button
            key={c.id}
            onClick={() => setFilterCuenta(c.id)}
            className={`flex h-11 flex-none shrink-0 snap-start items-center whitespace-nowrap rounded-md px-3 text-xs font-semibold transition-all sm:h-auto sm:py-1.5 ${
              filterCuenta === c.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {c.nombre}
          </button>
        ))}
      </div>

      {/* Movement list */}
      <div className="bg-white rounded-xl border overflow-hidden">
        {movimientos.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <Wallet className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-semibold">No hay movimientos registrados</p>
            <p className="text-xs mt-1">Usa "Ajustar" para registrar tus saldos actuales</p>
          </div>
        ) : (
          <div className="divide-y">
            {movimientos.map(m => {
              const config = TIPO_CONFIG[m.tipo] || TIPO_CONFIG.ingreso;
              const Icon = config.icon;
              const isPositive = m.tipo !== 'egreso';
              const cColor = getCuentaColor(m.cuenta);
              const badge = BADGE_COLORS[cColor] || BADGE_COLORS.purple;
              return (
                <div key={m.id} className="flex items-center justify-between gap-2 px-3 py-3 hover:bg-gray-50/50 sm:px-4">
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
                        <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold ${badge}`}>
                          {getCuentaName(m.cuenta)}
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`font-bold break-all ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                      {isPositive ? '+' : '-'}{fmt(m.monto)}
                    </span>
                    <button onClick={() => handleDelete(m.id)} aria-label={`Eliminar movimiento ${m.concepto || config.label}`} className="shrink-0 text-gray-300 hover:text-red-500">
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
