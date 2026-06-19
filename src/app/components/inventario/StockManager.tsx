import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { toast } from 'sonner';
import { API_BASE_URL, fetchWithTimeout } from '../../lib/api-base';
import { Plus, Trash2, Pencil, Search, Package } from 'lucide-react';

interface InventoryItem {
  id: string;
  producto: string;
  imei: string;
  categoria: string;
  precioCompra: number;
  precioVenta: number;
  proveedor: string;
  esPropio: boolean;
  estado: 'disponible' | 'vendido' | 'reservado' | 'devuelto';
  notas: string;
  fechaIngreso: string;
}

const fmt = (n: number) => `$${n.toLocaleString('es-CO')}`;

export function StockManager() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterEstado, setFilterEstado] = useState<string>('todos');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    producto: '', imei: '', categoria: 'moviles', precioCompra: '', precioVenta: '',
    proveedor: '', esPropio: true, notas: '',
  });

  const loadItems = useCallback(async () => {
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/inventario/items`);
      if (res.ok) setItems(await res.json());
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadItems(); }, [loadItems]);

  const resetForm = () => {
    setEditing(null);
    setForm({ producto: '', imei: '', categoria: 'moviles', precioCompra: '', precioVenta: '', proveedor: '', esPropio: true, notas: '' });
  };

  const openEdit = (item: InventoryItem) => {
    setEditing(item);
    setForm({
      producto: item.producto, imei: item.imei, categoria: item.categoria,
      precioCompra: item.precioCompra.toString(), precioVenta: item.precioVenta.toString(),
      proveedor: item.proveedor, esPropio: item.esPropio, notas: item.notas,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.producto) { toast.error('Producto requerido'); return; }
    setSaving(true);
    try {
      const url = editing ? `${API_BASE_URL}/inventario/items/${editing.id}` : `${API_BASE_URL}/inventario/items`;
      const res = await fetchWithTimeout(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          precioCompra: Number(form.precioCompra || 0),
          precioVenta: Number(form.precioVenta || 0),
        }),
      });
      if (res.ok) {
        toast.success(editing ? 'Item actualizado' : 'Item agregado');
        setDialogOpen(false);
        resetForm();
        await loadItems();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Error');
      }
    } catch { toast.error('Error de conexion'); }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/inventario/items/${id}`, { method: 'DELETE' });
      if (res.ok) { toast.success('Eliminado'); await loadItems(); }
    } catch { toast.error('Error'); }
  };

  const filtered = items.filter(item => {
    const matchSearch = !search || item.producto.toLowerCase().includes(search.toLowerCase()) ||
      item.imei.includes(search) || item.proveedor.toLowerCase().includes(search.toLowerCase());
    const matchEstado = filterEstado === 'todos' || item.estado === filterEstado;
    return matchSearch && matchEstado;
  });

  const disponibles = items.filter(i => i.estado === 'disponible').length;
  const vendidos = items.filter(i => i.estado === 'vendido').length;
  const valorInventario = items.filter(i => i.estado === 'disponible').reduce((s, i) => s + i.precioVenta, 0);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border p-3">
          <p className="text-xs text-gray-400 font-semibold uppercase">Disponibles</p>
          <p className="text-2xl font-bold text-violet-700">{disponibles}</p>
        </div>
        <div className="bg-white rounded-xl border p-3">
          <p className="text-xs text-gray-400 font-semibold uppercase">Vendidos</p>
          <p className="text-2xl font-bold text-emerald-600">{vendidos}</p>
        </div>
        <div className="bg-white rounded-xl border p-3">
          <p className="text-xs text-gray-400 font-semibold uppercase">Valor inventario</p>
          <p className="text-2xl font-bold text-gray-900">{fmt(valorInventario)}</p>
        </div>
      </div>

      {/* Search & filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por producto, IMEI, proveedor..." className="pl-10" />
        </div>
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4 text-gray-400" />
          <select value={filterEstado} onChange={e => setFilterEstado(e.target.value)} className="h-10 rounded-md border border-gray-200 px-3 text-sm">
            <option value="todos">Todos</option>
            <option value="disponible">Disponible</option>
            <option value="vendido">Vendido</option>
            <option value="reservado">Reservado</option>
          </select>
        </div>
        <Button onClick={() => { resetForm(); setDialogOpen(true); }} className="bg-violet-600 hover:bg-violet-700 text-white gap-1">
          <Plus className="w-4 h-4" /> Agregar
        </Button>
      </div>

      {/* Items table */}
      <div className="bg-white rounded-xl border overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-semibold">No hay items en inventario</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <th className="text-left px-4 py-3">Producto</th>
                  <th className="text-left px-4 py-3">IMEI</th>
                  <th className="text-left px-4 py-3">Proveedor</th>
                  <th className="text-right px-4 py-3">Costo</th>
                  <th className="text-right px-4 py-3">Venta</th>
                  <th className="text-center px-4 py-3">Estado</th>
                  <th className="text-center px-4 py-3">Fecha</th>
                  <th className="text-center px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(item => (
                  <tr key={item.id} className="border-t hover:bg-gray-50/50">
                    <td className="px-4 py-3 font-medium text-gray-900">{item.producto}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{item.imei || '—'}</td>
                    <td className="px-4 py-3">
                      {item.esPropio ? (
                        <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold">Propio</span>
                      ) : (
                        <span className="text-gray-700 text-xs">{item.proveedor}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500">{fmt(item.precioCompra)}</td>
                    <td className="px-4 py-3 text-right font-bold text-gray-900">{fmt(item.precioVenta)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        item.estado === 'disponible' ? 'bg-green-100 text-green-700' :
                        item.estado === 'vendido' ? 'bg-gray-100 text-gray-500' :
                        item.estado === 'reservado' ? 'bg-amber-100 text-amber-700' :
                        'bg-red-100 text-red-700'
                      }`}>{item.estado}</span>
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-gray-400">
                      {new Date(item.fechaIngreso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', timeZone: 'UTC' })}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex gap-1 justify-center">
                        <button onClick={() => openEdit(item)} className="text-gray-400 hover:text-violet-600"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => handleDelete(item.id)} className="text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add/Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar Item' : 'Agregar al Inventario'}</DialogTitle>
            <DialogDescription>Registra un equipo en el inventario fisico</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Producto *</Label>
              <Input value={form.producto} onChange={e => setForm({ ...form, producto: e.target.value })} placeholder="Xiaomi 14 Ultra 512GB" />
            </div>
            <div>
              <Label>IMEI</Label>
              <Input value={form.imei} onChange={e => setForm({ ...form, imei: e.target.value })} placeholder="860012345678901" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Categoria</Label>
                <select value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value })} className="w-full h-10 rounded-md border border-gray-200 px-3 text-sm">
                  <option value="moviles">Moviles</option>
                  <option value="accesorios">Accesorios</option>
                  <option value="tablets">Tablets</option>
                  <option value="wearables">Wearables</option>
                  <option value="otros">Otros</option>
                </select>
              </div>
              <div>
                <Label>Origen</Label>
                <select value={form.esPropio ? 'propio' : 'proveedor'} onChange={e => setForm({ ...form, esPropio: e.target.value === 'propio' })} className="w-full h-10 rounded-md border border-gray-200 px-3 text-sm">
                  <option value="propio">Nuestro</option>
                  <option value="proveedor">Proveedor</option>
                </select>
              </div>
            </div>
            {!form.esPropio && (
              <div>
                <Label>Proveedor</Label>
                <Input value={form.proveedor} onChange={e => setForm({ ...form, proveedor: e.target.value })} placeholder="Nombre del proveedor" />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Precio compra</Label>
                <Input type="number" value={form.precioCompra} onChange={e => setForm({ ...form, precioCompra: e.target.value })} placeholder="0" />
              </div>
              <div>
                <Label>Precio venta</Label>
                <Input type="number" value={form.precioVenta} onChange={e => setForm({ ...form, precioVenta: e.target.value })} placeholder="0" />
              </div>
            </div>
            <div>
              <Label>Notas</Label>
              <Input value={form.notas} onChange={e => setForm({ ...form, notas: e.target.value })} placeholder="Opcional" />
            </div>
            <div className="flex gap-3 mt-4">
              <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }} className="flex-1">Cancelar</Button>
              <Button onClick={handleSave} disabled={saving} className="flex-1 bg-violet-600 hover:bg-violet-700 text-white">
                {saving ? 'Guardando...' : editing ? 'Actualizar' : 'Agregar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
