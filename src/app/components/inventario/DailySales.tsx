import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { toast } from 'sonner';
import { API_BASE_URL, fetchWithTimeout } from '../../lib/api-base';
import {
  Plus, Trash2, DollarSign, TrendingUp, CreditCard, Wallet,
  Clock, ChevronLeft, ChevronRight, CheckCircle, AlertTriangle, Smartphone, Search, X, Pencil
} from 'lucide-react';

interface CatalogProduct {
  id: string;
  name: string;
  price: number;
  image: string;
  stock: number;
  storageVariants?: { storage: string; price: number }[];
}

interface PaymentMethod {
  id: string;
  nombre: string;
  clave: string;
  diasPendiente: number;
  activo: boolean;
}

interface Sale {
  id: string;
  fecha: string;
  orderId?: string;
  inventarioId?: string;
  cliente: string;
  producto: string;
  imei: string;
  esPropio: boolean;
  proveedor: string;
  precioCompra: number;
  precioVenta: number;
  ganancia: number;
  metodoPago: string;
  estadoPago: 'recibido' | 'pendiente';
  fechaEsperada?: string;
  notas: string;
  creadoPor: 'web' | 'manual';
  createdAt: string;
}

interface DaySummary {
  fecha: string;
  totalVentas: number;
  totalGanancia: number;
  totalGastos: number;
  cajaDisponible: number;
  cantidadVentas: number;
  porMetodo: Record<string, { total: number; pendiente: number; recibido: number }>;
  deudasHoy: Record<string, number>;
}

const fmt = (n: number) => `$${n.toLocaleString('es-CO')}`;

interface Supplier {
  id: string;
  nombre: string;
}

export function DailySales() {
  const [ventas, setVentas] = useState<Sale[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Sale | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // Product catalog search
  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<CatalogProduct | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<string>('');
  const productSearchRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState({
    cliente: '',
    producto: '',
    imei: '',
    esPropio: true,
    proveedor: '',
    precioCompra: '',
    precioVenta: '',
    metodoPago: 'efectivo',
    estadoPago: 'recibido' as 'recibido' | 'pendiente',
    notas: '',
  });

  const loadData = useCallback(async () => {
    try {
      const [ventasRes, methodsRes, summaryRes, suppliersRes] = await Promise.all([
        fetchWithTimeout(`${API_BASE_URL}/inventario/ventas?fecha=${fecha}`),
        fetchWithTimeout(`${API_BASE_URL}/inventario/metodos-pago`),
        fetchWithTimeout(`${API_BASE_URL}/inventario/resumen-dia?fecha=${fecha}`),
        fetchWithTimeout(`${API_BASE_URL}/inventario/proveedores`),
      ]);
      if (ventasRes.ok) setVentas(await ventasRes.json());
      if (methodsRes.ok) setMethods(await methodsRes.json());
      if (summaryRes.ok) setSummary(await summaryRes.json());
      if (suppliersRes.ok) setSuppliers(await suppliersRes.json());
    } catch (err) {
      console.error('[ventas] Error loading:', err);
    } finally {
      setLoading(false);
    }
  }, [fecha]);

  useEffect(() => { setLoading(true); loadData(); }, [loadData]);

  // Load product catalog when dialog opens
  useEffect(() => {
    if (!dialogOpen) return;
    (async () => {
      try {
        const res = await fetchWithTimeout(`${API_BASE_URL}/products`);
        if (res.ok) {
          const products = await res.json();
          setCatalogProducts(products);
        }
      } catch (err) { console.error('[catalog] Error loading products:', err); }
    })();
  }, [dialogOpen]);

  // Close dropdown on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (productSearchRef.current && !productSearchRef.current.contains(e.target as Node)) {
        setShowProductDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Filter catalog products based on search
  const filteredCatalog = useMemo(() => {
    if (!productSearch.trim()) return catalogProducts.slice(0, 8);
    const q = productSearch.toLowerCase();
    return catalogProducts.filter(p =>
      p.name.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [productSearch, catalogProducts]);

  const handleSelectProduct = (product: CatalogProduct, variantStorage?: string) => {
    setSelectedProduct(product);
    let price = product.price;
    let nombre = product.name;
    if (variantStorage && product.storageVariants) {
      const variant = product.storageVariants.find(v => v.storage === variantStorage);
      if (variant) {
        price = variant.price;
        nombre = `${product.name} ${variantStorage}`;
        setSelectedVariant(variantStorage);
      }
    }
    setForm(prev => ({
      ...prev,
      producto: nombre,
      precioVenta: price.toString(),
    }));
    setProductSearch(nombre);
    setShowProductDropdown(false);
  };

  const handleClearProduct = () => {
    setSelectedProduct(null);
    setSelectedVariant('');
    setProductSearch('');
    setForm(prev => ({ ...prev, producto: '', precioVenta: '' }));
  };

  const resetForm = () => {
    setEditing(null);
    setForm({
      cliente: '', producto: '', imei: '', esPropio: true, proveedor: '',
      precioCompra: '', precioVenta: '', metodoPago: 'efectivo', estadoPago: 'recibido', notas: '',
    });
    setSelectedProduct(null);
    setSelectedVariant('');
    setProductSearch('');
  };

  const openEdit = (sale: Sale) => {
    setEditing(sale);
    setForm({
      cliente: sale.cliente,
      producto: sale.producto,
      imei: sale.imei,
      esPropio: sale.esPropio,
      proveedor: sale.proveedor,
      precioCompra: sale.precioCompra.toString(),
      precioVenta: sale.precioVenta.toString(),
      metodoPago: sale.metodoPago,
      estadoPago: sale.estadoPago,
      notas: sale.notas || '',
    });
    setProductSearch(sale.producto);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.cliente || !form.producto || !form.precioVenta) {
      toast.error('Cliente, producto y precio de venta son requeridos');
      return;
    }
    setSaving(true);
    try {
      const method = methods.find(m => m.clave === form.metodoPago);
      const estadoPago = method && method.diasPendiente > 0 ? 'pendiente' : form.estadoPago;
      const payload = { ...form, precioCompra: Number(form.precioCompra || 0), precioVenta: Number(form.precioVenta), estadoPago };

      const url = editing
        ? `${API_BASE_URL}/inventario/ventas/${editing.id}`
        : `${API_BASE_URL}/inventario/ventas`;
      const res = await fetchWithTimeout(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        toast.success(editing ? 'Venta actualizada' : 'Venta registrada');
        setDialogOpen(false);
        resetForm();
        await loadData();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Error al guardar');
      }
    } catch { toast.error('Error de conexion'); }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/inventario/ventas/${id}`, { method: 'DELETE' });
      if (res.ok) { toast.success('Venta eliminada'); await loadData(); }
    } catch { toast.error('Error'); }
  };

  const handleMarkReceived = async (id: string) => {
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/inventario/ventas/${id}/recibido`, { method: 'POST' });
      if (res.ok) { toast.success('Marcado como recibido'); await loadData(); }
    } catch { toast.error('Error'); }
  };

  const changeDate = (days: number) => {
    const d = new Date(fecha);
    d.setDate(d.getDate() + days);
    setFecha(d.toISOString().slice(0, 10));
  };

  const isToday = fecha === new Date().toISOString().slice(0, 10);

  const fechaDisplay = useMemo(() => {
    const d = new Date(fecha + 'T12:00:00');
    return d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }, [fecha]);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Date selector */}
      <div className="flex items-center justify-between bg-white rounded-xl border p-3">
        <button onClick={() => changeDate(-1)} className="p-2 hover:bg-gray-100 rounded-lg"><ChevronLeft className="w-5 h-5" /></button>
        <div className="text-center">
          <p className="text-sm font-bold text-gray-900 capitalize">{fechaDisplay}</p>
          {isToday && <span className="text-xs text-violet-600 font-semibold">HOY</span>}
        </div>
        <button onClick={() => changeDate(1)} className="p-2 hover:bg-gray-100 rounded-lg"><ChevronRight className="w-5 h-5" /></button>
      </div>

      {/* KPI Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-gradient-to-br from-violet-500 to-purple-600 rounded-2xl p-4 text-white shadow-lg">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="w-5 h-5 opacity-80" />
              <span className="text-xs font-bold uppercase tracking-wider opacity-80">Total Ventas</span>
            </div>
            <p className="text-2xl font-black">{fmt(summary.totalVentas)}</p>
            <p className="text-xs opacity-70">{summary.cantidadVentas} ventas</p>
          </div>
          <div className="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl p-4 text-white shadow-lg">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-5 h-5 opacity-80" />
              <span className="text-xs font-bold uppercase tracking-wider opacity-80">Ganancia</span>
            </div>
            <p className="text-2xl font-black">{fmt(summary.totalGanancia)}</p>
            <p className="text-xs opacity-70">Utilidad del dia</p>
          </div>
          <div className="bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl p-4 text-white shadow-lg">
            <div className="flex items-center gap-2 mb-1">
              <Wallet className="w-5 h-5 opacity-80" />
              <span className="text-xs font-bold uppercase tracking-wider opacity-80">Caja Efectivo</span>
            </div>
            <p className="text-2xl font-black">{fmt(summary.cajaDisponible)}</p>
            <p className="text-xs opacity-70">Efectivo - gastos</p>
          </div>
          <div className="bg-gradient-to-br from-amber-500 to-orange-600 rounded-2xl p-4 text-white shadow-lg">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-5 h-5 opacity-80" />
              <span className="text-xs font-bold uppercase tracking-wider opacity-80">Gastos</span>
            </div>
            <p className="text-2xl font-black">{fmt(summary.totalGastos)}</p>
            <p className="text-xs opacity-70">Retiros y gastos</p>
          </div>
        </div>
      )}

      {/* Payment method breakdown */}
      {summary && Object.keys(summary.porMetodo).length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {Object.entries(summary.porMetodo).map(([clave, data]) => {
            const method = methods.find(m => m.clave === clave);
            return (
              <div key={clave} className="bg-white rounded-xl border p-3">
                <p className="text-xs text-gray-400 font-semibold uppercase">{method?.nombre || clave}</p>
                <p className="text-lg font-bold text-gray-900">{fmt(data.total)}</p>
                {data.pendiente > 0 && (
                  <p className="text-xs text-amber-600 font-semibold flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {fmt(data.pendiente)} pendiente
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add sale button */}
      <div className="flex justify-between items-center">
        <h3 className="font-bold text-gray-700 text-sm">Ventas registradas</h3>
        <Button onClick={() => setDialogOpen(true)} size="sm" className="bg-violet-600 hover:bg-violet-700 text-white gap-1">
          <Plus className="w-4 h-4" /> Agregar Venta
        </Button>
      </div>

      {/* Sales table */}
      <div className="bg-white rounded-xl border overflow-hidden">
        {ventas.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <CreditCard className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-semibold">No hay ventas registradas</p>
            <p className="text-xs">Agrega una venta o espera ordenes de la web</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <th className="text-left px-4 py-3">Cliente</th>
                  <th className="text-left px-4 py-3">Producto</th>
                  <th className="text-left px-4 py-3">Origen</th>
                  <th className="text-right px-4 py-3">Costo</th>
                  <th className="text-right px-4 py-3">Venta</th>
                  <th className="text-right px-4 py-3">Ganancia</th>
                  <th className="text-center px-4 py-3">Metodo</th>
                  <th className="text-center px-4 py-3">Estado</th>
                  <th className="text-center px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {ventas.map(v => {
                  const method = methods.find(m => m.clave === v.metodoPago);
                  return (
                    <tr key={v.id} className="border-t hover:bg-gray-50/50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {v.creadoPor === 'web' && <Smartphone className="w-3.5 h-3.5 text-violet-500" title="Orden web" />}
                          <span className="font-medium text-gray-900">{v.cliente}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-gray-700">{v.producto}</span>
                        {v.imei && <span className="text-xs text-gray-400 block font-mono">{v.imei}</span>}
                      </td>
                      <td className="px-4 py-3">
                        {v.esPropio ? (
                          <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold">Propio</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 text-xs font-semibold">{v.proveedor}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-500">{fmt(v.precioCompra)}</td>
                      <td className="px-4 py-3 text-right font-bold text-gray-900">{fmt(v.precioVenta)}</td>
                      <td className="px-4 py-3 text-right font-bold text-emerald-600">{fmt(v.ganancia)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-semibold">
                          {method?.nombre || v.metodoPago}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {v.estadoPago === 'pendiente' ? (
                          <button
                            onClick={() => handleMarkReceived(v.id)}
                            className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold hover:bg-amber-200 transition-colors cursor-pointer flex items-center gap-1 mx-auto"
                          >
                            <Clock className="w-3 h-3" /> Pendiente
                          </button>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-semibold flex items-center gap-1 mx-auto w-fit">
                            <CheckCircle className="w-3 h-3" /> Recibido
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => openEdit(v)} className="p-1 rounded hover:bg-violet-50 text-gray-400 hover:text-violet-600 transition-colors" title="Editar">
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleDelete(v.id)} className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors" title="Eliminar">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold">
                  <td className="px-4 py-3" colSpan={3}>TOTALES</td>
                  <td className="px-4 py-3 text-right text-gray-500">{fmt(ventas.reduce((s, v) => s + v.precioCompra, 0))}</td>
                  <td className="px-4 py-3 text-right text-gray-900">{fmt(ventas.reduce((s, v) => s + v.precioVenta, 0))}</td>
                  <td className="px-4 py-3 text-right text-emerald-600">{fmt(ventas.reduce((s, v) => s + v.ganancia, 0))}</td>
                  <td colSpan={3}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Supplier debts for today */}
      {summary && Object.keys(summary.deudasHoy).length > 0 && (
        <div className="bg-orange-50 rounded-xl border border-orange-200 p-4">
          <h4 className="text-sm font-bold text-orange-800 flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4" /> Deudas a proveedores hoy
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {Object.entries(summary.deudasHoy).map(([prov, monto]) => (
              <div key={prov} className="bg-white rounded-lg p-2 border border-orange-100">
                <p className="text-xs text-gray-500 font-semibold">{prov}</p>
                <p className="text-lg font-bold text-orange-700">{fmt(monto)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* New sale dialog */}
      <Dialog open={dialogOpen} onOpenChange={(v) => { setDialogOpen(v); if (!v) resetForm(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar Venta' : 'Registrar Venta'}</DialogTitle>
            <DialogDescription>Agrega una venta manual al registro del dia</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Cliente *</Label>
                <Input value={form.cliente} onChange={e => setForm({ ...form, cliente: e.target.value })} placeholder="Nombre del cliente" />
              </div>
              <div className="col-span-2" ref={productSearchRef}>
                <Label>Producto *</Label>
                {selectedProduct ? (
                  <div className="flex items-center gap-2 bg-violet-50 border border-violet-200 rounded-lg p-2">
                    {selectedProduct.image && (
                      <img
                        src={selectedProduct.image}
                        alt={selectedProduct.name}
                        className="w-10 h-10 rounded-lg object-cover bg-white border"
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-gray-900 truncate">{form.producto}</p>
                      <p className="text-xs text-violet-600 font-bold">{fmt(Number(form.precioVenta))}</p>
                    </div>
                    <button
                      onClick={handleClearProduct}
                      className="p-1 hover:bg-violet-100 rounded-full text-violet-500"
                      type="button"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                      value={productSearch}
                      onChange={e => {
                        setProductSearch(e.target.value);
                        setForm(prev => ({ ...prev, producto: e.target.value }));
                        setShowProductDropdown(true);
                      }}
                      onFocus={() => setShowProductDropdown(true)}
                      placeholder="Buscar producto del catalogo..."
                      className="pl-10"
                    />
                    {showProductDropdown && (
                      <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-64 overflow-y-auto">
                        {filteredCatalog.length === 0 ? (
                          <div className="p-4 text-center text-gray-400 text-sm">
                            <p className="font-semibold">No se encontraron productos</p>
                            <p className="text-xs mt-1">Puedes escribir el nombre manualmente</p>
                          </div>
                        ) : (
                          filteredCatalog.map(product => (
                            <div key={product.id}>
                              <button
                                type="button"
                                onClick={() => handleSelectProduct(product)}
                                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-violet-50 transition-colors text-left border-b border-gray-50 last:border-0"
                              >
                                {product.image ? (
                                  <img
                                    src={product.image}
                                    alt={product.name}
                                    className="w-10 h-10 rounded-lg object-cover bg-gray-100 border flex-shrink-0"
                                    onError={e => { (e.target as HTMLImageElement).src = ''; (e.target as HTMLImageElement).className = 'w-10 h-10 rounded-lg bg-gray-100 border flex-shrink-0'; }}
                                  />
                                ) : (
                                  <div className="w-10 h-10 rounded-lg bg-gray-100 border flex-shrink-0 flex items-center justify-center">
                                    <Smartphone className="w-5 h-5 text-gray-300" />
                                  </div>
                                )}
                                <div className="flex-1 min-w-0">
                                  <p className="font-semibold text-sm text-gray-900 truncate">{product.name}</p>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold text-violet-600">{fmt(product.price)}</span>
                                    {product.stock > 0 && (
                                      <span className="text-[10px] text-green-600 font-semibold">Stock: {product.stock}</span>
                                    )}
                                  </div>
                                </div>
                                {product.storageVariants && product.storageVariants.length > 0 && (
                                  <span className="text-[10px] text-gray-400 flex-shrink-0">{product.storageVariants.length} variantes</span>
                                )}
                              </button>
                              {/* Show storage variants inline */}
                              {product.storageVariants && product.storageVariants.length > 0 && (
                                <div className="flex gap-1 px-3 pb-2 ml-13">
                                  {product.storageVariants.map(v => (
                                    <button
                                      key={v.storage}
                                      type="button"
                                      onClick={() => handleSelectProduct(product, v.storage)}
                                      className="px-2 py-1 rounded-md bg-gray-100 hover:bg-violet-100 text-[11px] font-semibold text-gray-600 hover:text-violet-700 transition-colors"
                                    >
                                      {v.storage} - {fmt(v.price)}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div>
                <Label>IMEI</Label>
                <Input value={form.imei} onChange={e => setForm({ ...form, imei: e.target.value })} placeholder="Opcional" />
              </div>
              <div>
                <Label>Origen</Label>
                <select
                  value={form.esPropio ? 'propio' : 'proveedor'}
                  onChange={e => setForm({ ...form, esPropio: e.target.value === 'propio' })}
                  className="w-full h-10 rounded-md border border-gray-200 px-3 text-sm"
                >
                  <option value="propio">Nuestro</option>
                  <option value="proveedor">Proveedor</option>
                </select>
              </div>
            </div>

            {!form.esPropio && (
              <div className="bg-orange-50 rounded-lg p-3 border border-orange-200">
                <Label className="text-orange-700">Proveedor *</Label>
                <select value={form.proveedor} onChange={e => setForm({ ...form, proveedor: e.target.value })} className="w-full h-10 rounded-md border border-orange-200 px-3 text-sm mt-1 bg-white">
                  <option value="">Seleccionar proveedor...</option>
                  {suppliers.map(s => (
                    <option key={s.id} value={s.nombre}>{s.nombre}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Costo del equipo</Label>
                <Input type="number" value={form.precioCompra} onChange={e => setForm({ ...form, precioCompra: e.target.value })} placeholder="0" />
                <p className="text-[10px] text-gray-400 mt-0.5">Lo que costo el telefono</p>
              </div>
              <div>
                <Label>Precio de venta *</Label>
                <Input type="number" value={form.precioVenta} onChange={e => setForm({ ...form, precioVenta: e.target.value })} placeholder="0" />
                <p className="text-[10px] text-gray-400 mt-0.5">Lo que pago el cliente</p>
              </div>
            </div>

            {form.precioCompra && form.precioVenta && (
              <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-200 text-center">
                <p className="text-xs text-emerald-600 font-semibold">GANANCIA</p>
                <p className="text-2xl font-black text-emerald-700">{fmt(Number(form.precioVenta) - Number(form.precioCompra))}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Metodo de pago</Label>
                <select
                  value={form.metodoPago}
                  onChange={e => setForm({ ...form, metodoPago: e.target.value })}
                  className="w-full h-10 rounded-md border border-gray-200 px-3 text-sm"
                >
                  {methods.filter(m => m.activo).map(m => (
                    <option key={m.clave} value={m.clave}>{m.nombre}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Estado del pago</Label>
                <select
                  value={form.estadoPago}
                  onChange={e => setForm({ ...form, estadoPago: e.target.value as 'recibido' | 'pendiente' })}
                  className="w-full h-10 rounded-md border border-gray-200 px-3 text-sm"
                >
                  <option value="recibido">Recibido</option>
                  <option value="pendiente">Pendiente (en el aire)</option>
                </select>
              </div>
            </div>

            <div>
              <Label>Notas</Label>
              <Input value={form.notas} onChange={e => setForm({ ...form, notas: e.target.value })} placeholder="Opcional" />
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }} className="flex-1">Cancelar</Button>
              <Button onClick={handleSave} disabled={saving} className="flex-1 bg-violet-600 hover:bg-violet-700 text-white">
                {saving ? 'Guardando...' : editing ? 'Guardar Cambios' : 'Registrar Venta'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
