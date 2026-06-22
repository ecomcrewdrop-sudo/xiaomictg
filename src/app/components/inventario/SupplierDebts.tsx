import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { toast } from 'sonner';
import { API_BASE_URL, fetchWithTimeout } from '../../lib/api-base';
import { TrendingUp, Clock, DollarSign, AlertTriangle, CheckCircle, Plus, Trash2, Pencil, Users, Phone, FileText } from 'lucide-react';

interface Supplier {
  id: string;
  nombre: string;
  telefono: string;
  notas: string;
  createdAt: string;
}

interface PendingItem {
  id: string;
  cliente: string;
  monto: number;
  fecha: string;
  fechaEsperada?: string;
}

const fmt = (n: number) => `$${n.toLocaleString('es-CO')}`;

export function SupplierDebts() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [deudas, setDeudas] = useState<Record<string, { total: number; ventas: number }>>({});
  const [pendiente, setPendiente] = useState<Record<string, { total: number; items: PendingItem[] }>>({});
  const [methods, setMethods] = useState<{ nombre: string; clave: string }[]>([]);
  const [loading, setLoading] = useState(true);

  // Supplier form
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ nombre: '', telefono: '', notas: '' });

  const loadData = useCallback(async () => {
    try {
      const [suppliersRes, deudasRes, pendienteRes, methodsRes] = await Promise.all([
        fetchWithTimeout(`${API_BASE_URL}/inventario/proveedores`),
        fetchWithTimeout(`${API_BASE_URL}/inventario/deudas-proveedores`),
        fetchWithTimeout(`${API_BASE_URL}/inventario/dinero-pendiente`),
        fetchWithTimeout(`${API_BASE_URL}/inventario/metodos-pago`),
      ]);
      if (suppliersRes.ok) setSuppliers(await suppliersRes.json());
      if (deudasRes.ok) setDeudas(await deudasRes.json());
      if (pendienteRes.ok) setPendiente(await pendienteRes.json());
      if (methodsRes.ok) setMethods(await methodsRes.json());
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const resetForm = () => {
    setEditing(null);
    setForm({ nombre: '', telefono: '', notas: '' });
  };

  const openEdit = (s: Supplier) => {
    setEditing(s);
    setForm({ nombre: s.nombre, telefono: s.telefono, notas: s.notas });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.nombre.trim()) return toast.error('El nombre es requerido');
    setSaving(true);
    try {
      const url = editing
        ? `${API_BASE_URL}/inventario/proveedores/${editing.id}`
        : `${API_BASE_URL}/inventario/proveedores`;
      const res = await fetchWithTimeout(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        toast.success(editing ? 'Proveedor actualizado' : 'Proveedor agregado');
        setDialogOpen(false);
        resetForm();
        await loadData();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Error');
      }
    } catch { toast.error('Error de conexion'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string, nombre: string) => {
    if (!confirm(`¿Eliminar a ${nombre}?`)) return;
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/inventario/proveedores/${id}`, { method: 'DELETE' });
      if (res.ok) { toast.success('Proveedor eliminado'); await loadData(); }
    } catch { toast.error('Error'); }
  };

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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-violet-500 to-indigo-600 rounded-2xl p-5 text-white shadow-lg">
          <div className="flex items-center gap-2 mb-1">
            <Users className="w-5 h-5 opacity-80" />
            <span className="text-sm font-bold uppercase tracking-wider opacity-80">Proveedores</span>
          </div>
          <p className="text-3xl font-black">{suppliers.length}</p>
          <p className="text-xs opacity-70">Registrados</p>
        </div>
        <div className="bg-gradient-to-br from-orange-500 to-red-500 rounded-2xl p-5 text-white shadow-lg">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-5 h-5 opacity-80" />
            <span className="text-sm font-bold uppercase tracking-wider opacity-80">Deuda proveedores</span>
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

      {/* Supplier management */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-gray-700 text-sm flex items-center gap-2">
            <Users className="w-4 h-4" /> Gestión de proveedores
          </h3>
          <Button size="sm" onClick={() => { resetForm(); setDialogOpen(true); }} className="bg-violet-600 hover:bg-violet-700 text-white gap-1">
            <Plus className="w-4 h-4" /> Agregar
          </Button>
        </div>
        {suppliers.length === 0 ? (
          <div className="bg-white rounded-xl border text-center py-8 text-gray-400">
            <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="font-semibold">No hay proveedores registrados</p>
            <p className="text-xs mt-1">Agrega proveedores para controlar de quién es cada teléfono</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {suppliers.map(s => {
              const deuda = deudas[s.nombre];
              return (
                <div key={s.id} className="bg-white rounded-xl border p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-bold text-gray-900">{s.nombre}</p>
                      {s.telefono && (
                        <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                          <Phone className="w-3 h-3" /> {s.telefono}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(s)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-violet-600 transition-colors">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDelete(s.id, s.nombre)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  {s.notas && <p className="text-xs text-gray-400 mb-2 flex items-center gap-1"><FileText className="w-3 h-3" /> {s.notas}</p>}
                  {deuda ? (
                    <div className="bg-orange-50 rounded-lg px-3 py-2">
                      <p className="text-lg font-black text-orange-600">{fmt(deuda.total)}</p>
                      <p className="text-xs text-orange-400">{deuda.ventas} ventas pendientes</p>
                    </div>
                  ) : (
                    <div className="bg-green-50 rounded-lg px-3 py-2">
                      <p className="text-xs font-semibold text-green-600 flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" /> Sin deuda
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Supplier debts */}
      {Object.keys(deudas).length > 0 && (
        <div>
          <h3 className="font-bold text-gray-700 text-sm mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4" /> Deudas por proveedor
          </h3>
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
        </div>
      )}

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

      {/* Add/Edit Supplier Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(v) => { setDialogOpen(v); if (!v) resetForm(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar proveedor' : 'Nuevo proveedor'}</DialogTitle>
            <DialogDescription>
              {editing ? 'Actualiza los datos del proveedor' : 'Registra un nuevo proveedor para asignar productos'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label>Nombre *</Label>
              <Input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Ej: Distribuidora XYZ" className="mt-1" />
            </div>
            <div>
              <Label>Teléfono</Label>
              <Input value={form.telefono} onChange={e => setForm({ ...form, telefono: e.target.value })} placeholder="300 123 4567" className="mt-1" />
            </div>
            <div>
              <Label>Notas</Label>
              <Input value={form.notas} onChange={e => setForm({ ...form, notas: e.target.value })} placeholder="Información adicional..." className="mt-1" />
            </div>
            <Button onClick={handleSave} disabled={saving} className="w-full bg-violet-600 hover:bg-violet-700 text-white">
              {saving ? 'Guardando...' : editing ? 'Actualizar' : 'Agregar proveedor'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
