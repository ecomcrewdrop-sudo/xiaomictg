import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { toast } from 'sonner';
import { API_BASE_URL, fetchWithTimeout } from '../../lib/api-base';
import {
  Plus, Search, Wallet, Landmark, CreditCard, ShoppingBag,
  ArrowDownCircle, ArrowUpCircle, Settings2, X, Package,
  Printer, Smartphone, Clock,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────
interface Cuenta {
  id: string;
  nombre: string;
  color: string;
}

interface CatalogProduct {
  id: string;
  name: string;
  price: number;
  image: string;
  stock: number;
  storageVariants?: { storage: string; price: number; stock: number }[];
}

interface LastSale {
  cliente: string;
  producto: string;
  precioVenta: number;
  imei: string;
  metodoPago: string;
  notas: string;
  fecha: string;
  pagos: { cuenta: string; monto: number }[];
}

// ─── Helpers ─────────────────────────────────────────────────────────
const fmt = (n: number) => `$${n.toLocaleString('es-CO')}`;

const GRADIENTS: Record<string, string> = {
  green: 'from-green-500 to-emerald-600',
  blue: 'from-blue-500 to-indigo-600',
  purple: 'from-purple-500 to-violet-600',
  orange: 'from-orange-500 to-amber-600',
  pink: 'from-pink-500 to-rose-600',
  teal: 'from-teal-500 to-cyan-600',
  red: 'from-red-500 to-rose-600',
  yellow: 'from-yellow-500 to-amber-500',
};

const ICONS: Record<string, any> = {
  efectivo: Wallet,
  banco: Landmark,
  datafono: CreditCard,
  addi: Smartphone,
};

const PROTECTED_ACCOUNTS = ['efectivo', 'banco', 'datafono', 'addi'];

// Datáfono cobra 5% extra al cliente
const DATAFONO_SURCHARGE = 0.05;

// ─── Print invoice helper ────────────────────────────────────────────
function printInvoice(sale: LastSale) {
  const now = new Date();
  const fecha = now.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
  const hora = now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

  const pagosHtml = sale.pagos.map(p => `
    <tr>
      <td style="padding:2px 8px;text-transform:capitalize;">${p.cuenta}</td>
      <td style="padding:2px 8px;text-align:right;font-weight:bold;">$${p.monto.toLocaleString('es-CO')}</td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Factura - Xiaomi Cartagena</title>
  <style>
    @media print { @page { margin: 10mm; size: 80mm auto; } }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #333; max-width: 300px; margin: 0 auto; padding: 10px; }
    .header { text-align: center; border-bottom: 2px dashed #ccc; padding-bottom: 10px; margin-bottom: 10px; }
    .header h1 { font-size: 18px; font-weight: 900; color: #7c3aed; }
    .header p { font-size: 10px; color: #888; }
    .row { display: flex; justify-content: space-between; padding: 3px 0; }
    .row .label { color: #666; }
    .row .value { font-weight: 700; }
    .product { background: #f5f3ff; border-radius: 8px; padding: 10px; margin: 10px 0; }
    .product .name { font-weight: 800; font-size: 14px; color: #5b21b6; }
    .product .price { font-size: 18px; font-weight: 900; color: #7c3aed; }
    .divider { border-top: 1px dashed #ddd; margin: 8px 0; }
    table { width: 100%; }
    .footer { text-align: center; margin-top: 15px; font-size: 10px; color: #aaa; border-top: 2px dashed #ccc; padding-top: 10px; }
    .print-btn { display: block; margin: 15px auto; padding: 10px 30px; background: #7c3aed; color: white; border: none; border-radius: 8px; font-weight: bold; font-size: 14px; cursor: pointer; }
    .print-btn:hover { background: #6d28d9; }
    @media print { .no-print { display: none !important; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>XIAOMI CARTAGENA</h1>
    <p>NIT: 901.XXX.XXX-X</p>
    <p>Cartagena de Indias, Colombia</p>
  </div>

  <div class="row"><span class="label">Fecha:</span><span class="value">${fecha}</span></div>
  <div class="row"><span class="label">Hora:</span><span class="value">${hora}</span></div>
  <div class="row"><span class="label">Cliente:</span><span class="value">${sale.cliente}</span></div>
  ${sale.imei ? `<div class="row"><span class="label">IMEI:</span><span class="value">${sale.imei}</span></div>` : ''}

  <div class="product">
    <div class="name">${sale.producto}</div>
    <div class="price">${fmt(sale.precioVenta)}</div>
  </div>

  <div class="divider"></div>
  <p style="font-weight:700;font-size:11px;margin-bottom:4px;">FORMA DE PAGO:</p>
  <table>${pagosHtml}</table>

  <div class="divider"></div>
  <div class="row" style="font-size:14px;">
    <span class="label" style="font-weight:800;">TOTAL:</span>
    <span class="value" style="color:#7c3aed;font-size:16px;">${fmt(sale.precioVenta)}</span>
  </div>

  ${sale.notas ? `<div class="divider"></div><p style="font-size:10px;color:#888;">Notas: ${sale.notas}</p>` : ''}

  <div class="footer">
    <p>Gracias por su compra</p>
    <p>www.xiaomicartagena.com</p>
  </div>

  <button class="print-btn no-print" onclick="window.print()">Imprimir</button>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=350,height=600');
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}

// ─── Component ───────────────────────────────────────────────────────
export function PointOfSale() {
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [saldos, setSaldos] = useState<Record<string, number>>({});
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Sale dialog
  const [saleOpen, setSaleOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<CatalogProduct | null>(null);
  const [saleForm, setSaleForm] = useState({
    cliente: '',
    producto: '',
    precioVenta: '',
    precioCompra: '',
    imei: '',
    notas: '',
  });
  const [pagos, setPagos] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Manual movement dialog
  const [movOpen, setMovOpen] = useState(false);
  const [movTipo, setMovTipo] = useState<'ingreso' | 'egreso'>('ingreso');
  const [movCuenta, setMovCuenta] = useState('efectivo');
  const [movMonto, setMovMonto] = useState('');
  const [movConcepto, setMovConcepto] = useState('');

  // Ajuste dialog
  const [ajusteOpen, setAjusteOpen] = useState(false);
  const [ajusteCuenta, setAjusteCuenta] = useState('efectivo');
  const [ajusteMonto, setAjusteMonto] = useState('');

  // New account
  const [newCuentaOpen, setNewCuentaOpen] = useState(false);
  const [newCuentaNombre, setNewCuentaNombre] = useState('');
  const [newCuentaColor, setNewCuentaColor] = useState('purple');

  // ─── Load ────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      const [cRes, sRes, pRes] = await Promise.all([
        fetchWithTimeout(`${API_BASE_URL}/caja/cuentas`),
        fetchWithTimeout(`${API_BASE_URL}/caja/saldos`),
        fetchWithTimeout(`${API_BASE_URL}/products`),
      ]);
      if (cRes.ok) setCuentas(await cRes.json());
      if (sRes.ok) setSaldos(await sRes.json());
      if (pRes.ok) setProducts(await pRes.json());
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ─── Filtered products ───────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!search.trim()) return products;
    const q = search.toLowerCase();
    return products.filter(p => p.name.toLowerCase().includes(q));
  }, [products, search]);

  // ─── Datáfono surcharge calculation ──────────────────────────────
  const datafonoBase = Number(pagos['datafono'] || 0);
  const datafonoSurcharge = Math.round(datafonoBase * DATAFONO_SURCHARGE);
  const datafonoTotal = datafonoBase + datafonoSurcharge;

  // ─── Open sale dialog for a product ──────────────────────────────
  const openSale = (p: CatalogProduct | null) => {
    setSelectedProduct(p);
    setSaleForm({
      cliente: '',
      producto: p?.name || '',
      precioVenta: p ? Math.round(p.price).toString() : '',
      precioCompra: '',
      imei: '',
      notas: '',
    });
    setPagos({});
    setSaleOpen(true);
  };

  // ─── Submit sale ─────────────────────────────────────────────────
  const handleSale = async () => {
    if (!saleForm.producto || !saleForm.precioVenta) {
      toast.error('Producto y precio requeridos'); return;
    }
    const precioVenta = Number(saleForm.precioVenta);

    // Calculate total pagos
    const pagoEntries = Object.entries(pagos)
      .map(([cuenta, val]) => ({ cuenta, monto: Number(val) || 0 }))
      .filter(e => e.monto > 0);

    const totalPagos = pagoEntries.reduce((s, e) => s + e.monto, 0);
    if (pagoEntries.length === 0) {
      toast.error('Selecciona al menos una forma de pago'); return;
    }
    if (totalPagos !== precioVenta) {
      toast.error(`Los pagos (${fmt(totalPagos)}) no coinciden con el precio (${fmt(precioVenta)})`);
      return;
    }

    // Determine if any part is pending (datáfono or addi)
    const hasPending = pagoEntries.some(e => e.cuenta === 'datafono' || e.cuenta === 'addi');

    setSaving(true);
    try {
      const metodoPago = pagoEntries.length === 1
        ? pagoEntries[0].cuenta
        : pagoEntries.map(e => `${e.cuenta}:${e.monto}`).join('+');

      const saleRes = await fetchWithTimeout(`${API_BASE_URL}/inventario/ventas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliente: saleForm.cliente || 'Cliente',
          producto: saleForm.producto,
          imei: saleForm.imei,
          esPropio: true,
          proveedor: '',
          precioCompra: Number(saleForm.precioCompra) || 0,
          precioVenta,
          metodoPago,
          estadoPago: 'recibido',
          notas: saleForm.notas,
        }),
      });

      if (!saleRes.ok) throw new Error('Error creando venta');

      // Build sale data for print
      const saleData: LastSale = {
        cliente: saleForm.cliente || 'Cliente',
        producto: saleForm.producto,
        precioVenta,
        imei: saleForm.imei,
        metodoPago,
        notas: saleForm.notas,
        fecha: new Date().toISOString(),
        pagos: pagoEntries.map(e => ({
          cuenta: cuentas.find(c => c.id === e.cuenta)?.nombre || e.cuenta,
          monto: e.monto,
        })),
      };

      toast.success('Venta registrada');
      setSaleOpen(false);
      await loadData();

      // Open print invoice
      printInvoice(saleData);

    } catch { toast.error('Error al registrar venta'); }
    setSaving(false);
  };

  // ─── Submit manual movement ──────────────────────────────────────
  const handleMov = async () => {
    if (!movMonto || Number(movMonto) <= 0) { toast.error('Monto requerido'); return; }
    if (!movConcepto.trim()) { toast.error('Concepto requerido'); return; }
    setSaving(true);
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/caja/movimiento`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo: movTipo, cuenta: movCuenta, monto: Number(movMonto), concepto: movConcepto.trim() }),
      });
      if (res.ok) {
        toast.success(movTipo === 'ingreso' ? 'Ingreso registrado' : 'Egreso registrado');
        setMovOpen(false); setMovMonto(''); setMovConcepto('');
        await loadData();
      }
    } catch { toast.error('Error'); }
    setSaving(false);
  };

  // ─── Submit ajuste ───────────────────────────────────────────────
  const handleAjuste = async () => {
    if (ajusteMonto === '') { toast.error('Monto requerido'); return; }
    setSaving(true);
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/caja/ajuste`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cuenta: ajusteCuenta, nuevoSaldo: Number(ajusteMonto) }),
      });
      if (res.ok) {
        const name = cuentas.find(c => c.id === ajusteCuenta)?.nombre || ajusteCuenta;
        toast.success(`Saldo de ${name} ajustado`);
        setAjusteOpen(false); setAjusteMonto('');
        await loadData();
      }
    } catch { toast.error('Error'); }
    setSaving(false);
  };

  // ─── New account ─────────────────────────────────────────────────
  const handleNewCuenta = async () => {
    if (!newCuentaNombre.trim()) { toast.error('Nombre requerido'); return; }
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/caja/cuentas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: newCuentaNombre.trim(), color: newCuentaColor }),
      });
      if (res.ok) {
        toast.success(`Cuenta "${newCuentaNombre}" creada`);
        setNewCuentaOpen(false); setNewCuentaNombre('');
        await loadData();
      }
    } catch { toast.error('Error'); }
  };

  const handleDeleteCuenta = async (id: string) => {
    if (PROTECTED_ACCOUNTS.includes(id)) return;
    if (!confirm('Eliminar esta cuenta y todos sus movimientos?')) return;
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/caja/cuentas/${id}`, { method: 'DELETE' });
      if (res.ok) { toast.success('Eliminada'); await loadData(); }
    } catch { toast.error('Error'); }
  };

  // ─── Render ──────────────────────────────────────────────────────
  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* ── Balance cards ─────────────────────────────────────────── */}
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
        {cuentas.map(c => {
          const Icon = ICONS[c.id] || CreditCard;
          const grad = GRADIENTS[c.color] || GRADIENTS.purple;
          return (
            <div key={c.id} className={`bg-gradient-to-br ${grad} rounded-xl p-3 text-white shadow-md relative group`}>
              {!PROTECTED_ACCOUNTS.includes(c.id) && (
                <button onClick={() => handleDeleteCuenta(c.id)} className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 bg-black/20 hover:bg-black/40 rounded-full p-0.5 transition-opacity">
                  <X className="w-3 h-3" />
                </button>
              )}
              <div className="flex items-center gap-1.5 mb-0.5">
                <Icon className="w-4 h-4 opacity-80" />
                <span className="text-[10px] font-bold uppercase tracking-wider opacity-80">{c.nombre}</span>
              </div>
              <p className="text-lg font-black leading-tight">{fmt(saldos[c.id] || 0)}</p>
            </div>
          );
        })}
        <button
          onClick={() => setNewCuentaOpen(true)}
          className="border-2 border-dashed border-gray-300 hover:border-violet-400 hover:bg-violet-50 rounded-xl p-3 flex flex-col items-center justify-center gap-0.5 transition-colors"
        >
          <Plus className="w-4 h-4 text-gray-400" />
          <span className="text-[10px] font-semibold text-gray-400">Nueva</span>
        </button>
      </div>

      {/* ── Quick actions ─────────────────────────────────────────── */}
      <div className="flex gap-2">
        <Button onClick={() => setMovOpen(true)} variant="outline" className="flex-1 gap-1 text-xs h-9">
          <ArrowDownCircle className="w-3.5 h-3.5" /> Ingreso / Egreso
        </Button>
        <Button onClick={() => setAjusteOpen(true)} variant="outline" className="flex-1 gap-1 text-xs h-9">
          <Settings2 className="w-3.5 h-3.5" /> Ajustar saldo
        </Button>
      </div>

      {/* ── Product grid ──────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar producto..."
              className="pl-9 h-9"
            />
          </div>
          <Button onClick={() => openSale(null)} className="bg-violet-600 hover:bg-violet-700 text-white gap-1 h-9 text-xs">
            <Plus className="w-3.5 h-3.5" /> Venta manual
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {filtered.map(p => {
            const outOfStock = p.stock === 0;
            return (
              <button
                key={p.id}
                onClick={() => !outOfStock && openSale(p)}
                disabled={outOfStock}
                className={`bg-white border rounded-xl p-3 text-left transition-all hover:shadow-md hover:border-violet-300 ${
                  outOfStock ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                }`}
              >
                <div className="relative w-full aspect-square rounded-lg overflow-hidden bg-gray-50 mb-2">
                  <img src={p.image} alt={p.name} className="w-full h-full object-contain p-2" />
                  {outOfStock && (
                    <div className="absolute inset-0 bg-gray-900/60 flex items-center justify-center">
                      <span className="text-[10px] font-black text-white uppercase">Agotado</span>
                    </div>
                  )}
                </div>
                <h3 className="font-bold text-xs text-gray-900 truncate">{p.name}</h3>
                <p className="font-black text-sm text-violet-600">{fmt(Math.round(p.price))}</p>
                <div className="flex items-center gap-1 mt-1 text-[10px] text-gray-400">
                  <Package className="w-3 h-3" /> Stock: {p.stock}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          SALE DIALOG — with split payment + datáfono +5%
         ══════════════════════════════════════════════════════════════ */}
      <Dialog open={saleOpen} onOpenChange={setSaleOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingBag className="w-5 h-5 text-violet-600" />
              Facturar venta
            </DialogTitle>
            <DialogDescription>Registra la venta, actualiza caja y genera factura para imprimir</DialogDescription>
          </DialogHeader>

          <div className="space-y-3 mt-2">
            {selectedProduct && (
              <div className="flex items-center gap-3 bg-violet-50 rounded-lg p-3">
                <img src={selectedProduct.image} className="w-12 h-12 object-contain rounded-lg bg-white" />
                <div>
                  <p className="font-bold text-sm text-violet-900">{selectedProduct.name}</p>
                  <p className="text-xs text-violet-600">{fmt(Math.round(selectedProduct.price))}</p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Cliente</Label>
                <Input value={saleForm.cliente} onChange={e => setSaleForm(f => ({ ...f, cliente: e.target.value }))} placeholder="Nombre" />
              </div>
              <div>
                <Label>IMEI (opcional)</Label>
                <Input value={saleForm.imei} onChange={e => setSaleForm(f => ({ ...f, imei: e.target.value }))} placeholder="IMEI" />
              </div>
            </div>

            {!selectedProduct && (
              <div>
                <Label>Producto *</Label>
                <Input value={saleForm.producto} onChange={e => setSaleForm(f => ({ ...f, producto: e.target.value }))} placeholder="Nombre del producto" />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Precio venta *</Label>
                <Input type="number" value={saleForm.precioVenta} onChange={e => setSaleForm(f => ({ ...f, precioVenta: e.target.value }))} placeholder="0" />
              </div>
              <div>
                <Label>Costo compra</Label>
                <Input type="number" value={saleForm.precioCompra} onChange={e => setSaleForm(f => ({ ...f, precioCompra: e.target.value }))} placeholder="0" />
              </div>
            </div>

            {/* ── Split Payment ─────────────────────────────────── */}
            <div className="bg-gray-50 rounded-lg p-3 space-y-2">
              <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Forma de pago</p>
              <p className="text-[10px] text-gray-400">Divide el pago entre las cuentas que necesites</p>

              {cuentas.map(c => {
                const Icon = ICONS[c.id] || CreditCard;
                const isDatafono = c.id === 'datafono';
                const isAddi = c.id === 'addi';
                const isPending = isDatafono || isAddi;
                const val = Number(pagos[c.id] || 0);
                return (
                  <div key={c.id}>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5 w-28 flex-shrink-0">
                        <Icon className="w-4 h-4 text-gray-500" />
                        <span className="text-sm font-semibold text-gray-700">{c.nombre}</span>
                        {isDatafono && <span className="text-[9px] font-bold text-orange-600 bg-orange-100 px-1 rounded">+5%</span>}
                        {isPending && <Clock className="w-3 h-3 text-amber-500" />}
                      </div>
                      <div className="relative flex-1">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                        <Input
                          type="number"
                          value={pagos[c.id] || ''}
                          onChange={e => setPagos(prev => ({ ...prev, [c.id]: e.target.value }))}
                          placeholder="0"
                          className="pl-7 h-9"
                        />
                      </div>
                    </div>
                    {/* Datáfono surcharge info */}
                    {isDatafono && val > 0 && (
                      <div className="ml-28 pl-2 mt-0.5">
                        <p className="text-[10px] text-orange-600 font-semibold">
                          Cliente paga: {fmt(val + Math.round(val * DATAFONO_SURCHARGE))} (incluye 5% datáfono)
                        </p>
                      </div>
                    )}
                    {/* Addi/datáfono pending info */}
                    {isAddi && val > 0 && (
                      <div className="ml-28 pl-2 mt-0.5">
                        <p className="text-[10px] text-purple-600 font-semibold">
                          Pendiente — Addi paga en ~7 días
                        </p>
                      </div>
                    )}
                    {isDatafono && val > 0 && (
                      <div className="ml-28 pl-2">
                        <p className="text-[10px] text-amber-600">
                          Pendiente — cae al siguiente día hábil
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Pago total indicator */}
              {(() => {
                const total = Object.values(pagos).reduce((s, v) => s + (Number(v) || 0), 0);
                const precio = Number(saleForm.precioVenta) || 0;
                const diff = precio - total;
                const ok = total > 0 && diff === 0;
                return total > 0 ? (
                  <div className={`text-xs font-bold text-right pt-1 ${ok ? 'text-green-600' : 'text-red-600'}`}>
                    {ok ? '✅ Pago completo' : diff > 0 ? `Faltan ${fmt(diff)}` : `Excede ${fmt(Math.abs(diff))}`}
                  </div>
                ) : null;
              })()}
            </div>

            <div>
              <Label>Notas</Label>
              <Input value={saleForm.notas} onChange={e => setSaleForm(f => ({ ...f, notas: e.target.value }))} placeholder="Opcional..." />
            </div>

            <Button onClick={handleSale} disabled={saving} className="w-full bg-violet-600 hover:bg-violet-700 text-white gap-2">
              <Printer className="w-4 h-4" /> {saving ? 'Registrando...' : 'Facturar e imprimir'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ══════════════════════════════════════════════════════════════
          MOVEMENT DIALOG — ingreso/egreso manual
         ══════════════════════════════════════════════════════════════ */}
      <Dialog open={movOpen} onOpenChange={setMovOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Registrar movimiento</DialogTitle>
            <DialogDescription>Ingreso o egreso manual a una cuenta</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setMovTipo('ingreso')} className={`py-2 rounded-lg text-sm font-bold ${movTipo === 'ingreso' ? 'bg-green-100 text-green-700 ring-2 ring-green-400' : 'bg-gray-100 text-gray-500'}`}>
                <ArrowDownCircle className="w-4 h-4 inline mr-1" /> Ingreso
              </button>
              <button onClick={() => setMovTipo('egreso')} className={`py-2 rounded-lg text-sm font-bold ${movTipo === 'egreso' ? 'bg-red-100 text-red-700 ring-2 ring-red-400' : 'bg-gray-100 text-gray-500'}`}>
                <ArrowUpCircle className="w-4 h-4 inline mr-1" /> Egreso
              </button>
            </div>
            <div>
              <Label>Cuenta</Label>
              <div className="flex gap-2 mt-1 flex-wrap">
                {cuentas.map(c => (
                  <button key={c.id} onClick={() => setMovCuenta(c.id)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${movCuenta === c.id ? 'bg-violet-100 text-violet-700 ring-2 ring-violet-400' : 'bg-gray-100 text-gray-500'}`}>
                    {c.nombre}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Monto *</Label><Input type="number" value={movMonto} onChange={e => setMovMonto(e.target.value)} placeholder="0" /></div>
              <div><Label>Concepto *</Label><Input value={movConcepto} onChange={e => setMovConcepto(e.target.value)} placeholder="Ej: Pago..." /></div>
            </div>
            <Button onClick={handleMov} disabled={saving} className={`w-full text-white ${movTipo === 'ingreso' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}>
              {saving ? 'Guardando...' : `Registrar ${movTipo}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ══════════════════════════════════════════════════════════════
          AJUSTE DIALOG
         ══════════════════════════════════════════════════════════════ */}
      <Dialog open={ajusteOpen} onOpenChange={setAjusteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Ajustar saldo</DialogTitle>
            <DialogDescription>Coloca el monto real. El sistema calcula la diferencia.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="flex gap-2 flex-wrap">
              {cuentas.map(c => (
                <button key={c.id} onClick={() => setAjusteCuenta(c.id)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${ajusteCuenta === c.id ? 'bg-violet-100 text-violet-700 ring-2 ring-violet-400' : 'bg-gray-100 text-gray-500'}`}>
                  {c.nombre} ({fmt(saldos[c.id] || 0)})
                </button>
              ))}
            </div>
            <div><Label>Saldo real *</Label><Input type="number" value={ajusteMonto} onChange={e => setAjusteMonto(e.target.value)} placeholder="Ej: 500000" /></div>
            <Button onClick={handleAjuste} disabled={saving} className="w-full bg-blue-600 hover:bg-blue-700 text-white">
              {saving ? 'Ajustando...' : 'Ajustar saldo'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ══════════════════════════════════════════════════════════════
          NEW ACCOUNT DIALOG
         ══════════════════════════════════════════════════════════════ */}
      <Dialog open={newCuentaOpen} onOpenChange={setNewCuentaOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Nueva cuenta</DialogTitle>
            <DialogDescription>Crea una cuenta para rastrear dinero (Bold, Nequi, deudas...)</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div><Label>Nombre *</Label><Input value={newCuentaNombre} onChange={e => setNewCuentaNombre(e.target.value)} placeholder="Ej: Bold, Deuda Pedro, Nequi..." /></div>
            <div>
              <Label>Color</Label>
              <div className="flex gap-2 mt-1 flex-wrap">
                {Object.keys(GRADIENTS).map(color => (
                  <button key={color} onClick={() => setNewCuentaColor(color)} className={`w-7 h-7 rounded-full bg-gradient-to-br ${GRADIENTS[color]} ${newCuentaColor === color ? 'ring-2 ring-offset-2 ring-violet-500' : ''}`} />
                ))}
              </div>
            </div>
            <Button onClick={handleNewCuenta} className="w-full bg-violet-600 hover:bg-violet-700 text-white">Crear cuenta</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
