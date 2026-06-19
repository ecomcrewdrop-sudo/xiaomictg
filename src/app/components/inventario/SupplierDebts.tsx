import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { API_BASE_URL, fetchWithTimeout } from '../../lib/api-base';
import { TrendingUp, Clock, DollarSign, AlertTriangle, CheckCircle } from 'lucide-react';

interface PendingItem {
  id: string;
  cliente: string;
  monto: number;
  fecha: string;
  fechaEsperada?: string;
}

const fmt = (n: number) => `$${n.toLocaleString('es-CO')}`;

export function SupplierDebts() {
  const [deudas, setDeudas] = useState<Record<string, { total: number; ventas: number }>>({});
  const [pendiente, setPendiente] = useState<Record<string, { total: number; items: PendingItem[] }>>({});
  const [methods, setMethods] = useState<{ nombre: string; clave: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [deudasRes, pendienteRes, methodsRes] = await Promise.all([
        fetchWithTimeout(`${API_BASE_URL}/inventario/deudas-proveedores`),
        fetchWithTimeout(`${API_BASE_URL}/inventario/dinero-pendiente`),
        fetchWithTimeout(`${API_BASE_URL}/inventario/metodos-pago`),
      ]);
      if (deudasRes.ok) setDeudas(await deudasRes.json());
      if (pendienteRes.ok) setPendiente(await pendienteRes.json());
      if (methodsRes.ok) setMethods(await methodsRes.json());
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleMarkReceived = async (id: string) => {
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/inventario/ventas/${id}/recibido`, { method: 'POST' });
      if (res.ok) { toast.success('Marcado como recibido'); await loadData(); }
    } catch { toast.error('Error'); }
  };

  const totalDeudas = Object.values(deudas).reduce((s, d) => s + d.total, 0);
  const totalPendiente = Object.values(pendiente).reduce((s, p) => s + p.total, 0);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-gradient-to-br from-orange-500 to-red-500 rounded-2xl p-5 text-white shadow-lg">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-5 h-5 opacity-80" />
            <span className="text-sm font-bold uppercase tracking-wider opacity-80">Deuda total proveedores</span>
          </div>
          <p className="text-3xl font-black">{fmt(totalDeudas)}</p>
          <p className="text-xs opacity-70">{Object.keys(deudas).length} proveedores</p>
        </div>
        <div className="bg-gradient-to-br from-amber-500 to-yellow-600 rounded-2xl p-5 text-white shadow-lg">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-5 h-5 opacity-80" />
            <span className="text-sm font-bold uppercase tracking-wider opacity-80">Dinero en el aire</span>
          </div>
          <p className="text-3xl font-black">{fmt(totalPendiente)}</p>
          <p className="text-xs opacity-70">Pagos por recibir</p>
        </div>
      </div>

      {/* Supplier debts */}
      <div>
        <h3 className="font-bold text-gray-700 text-sm mb-3 flex items-center gap-2">
          <TrendingUp className="w-4 h-4" /> Deudas por proveedor
        </h3>
        {Object.keys(deudas).length === 0 ? (
          <div className="bg-white rounded-xl border text-center py-8 text-gray-400">
            <CheckCircle className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="font-semibold">No hay deudas con proveedores</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.entries(deudas).sort((a, b) => b[1].total - a[1].total).map(([prov, data]) => (
              <div key={prov} className="bg-white rounded-xl border p-4 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-bold text-gray-900">{prov}</p>
                  <span className="text-xs text-gray-400">{data.ventas} ventas</span>
                </div>
                <p className="text-2xl font-black text-orange-600">{fmt(data.total)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pending money */}
      <div>
        <h3 className="font-bold text-gray-700 text-sm mb-3 flex items-center gap-2">
          <Clock className="w-4 h-4" /> Dinero pendiente por metodo
        </h3>
        {Object.keys(pendiente).length === 0 ? (
          <div className="bg-white rounded-xl border text-center py-8 text-gray-400">
            <DollarSign className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="font-semibold">No hay dinero pendiente</p>
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(pendiente).map(([clave, data]) => {
              const method = methods.find(m => m.clave === clave);
              return (
                <div key={clave} className="bg-white rounded-xl border overflow-hidden">
                  <div className="bg-amber-50 px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="font-bold text-amber-800">{method?.nombre || clave}</p>
                      <p className="text-xs text-amber-600">{data.items.length} pagos pendientes</p>
                    </div>
                    <p className="text-xl font-black text-amber-700">{fmt(data.total)}</p>
                  </div>
                  <div className="divide-y">
                    {data.items.map(item => (
                      <div key={item.id} className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-gray-50/50">
                        <div>
                          <p className="font-medium text-gray-900">{item.cliente}</p>
                          <p className="text-xs text-gray-400">
                            Venta: {item.fecha}
                            {item.fechaEsperada && ` — Espera: ${new Date(item.fechaEsperada).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-gray-900">{fmt(item.monto)}</span>
                          <button
                            onClick={() => handleMarkReceived(item.id)}
                            className="px-2 py-1 rounded-lg bg-green-100 text-green-700 text-xs font-semibold hover:bg-green-200 transition-colors"
                          >
                            Recibido
                          </button>
                        </div>
                      </div>
                    ))}
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
