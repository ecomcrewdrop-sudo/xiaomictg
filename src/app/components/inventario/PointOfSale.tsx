import { useState, useEffect, useCallback, useMemo } from 'react';
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
  cedula: string;
  telefono: string;
  producto: string;
  precioOriginal: number;
  descuento: number;
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

// ─── Print invoice helper — formato igual al ticket de email ────────
function printInvoice(sale: LastSale) {
  const now = new Date();
  const fecha = now.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
  const hora = now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

  const pagosHtml = sale.pagos.map(p => `
    <div style="display:flex;justify-content:space-between;margin-bottom:2px;">
      <span style="text-transform:uppercase;">${p.cuenta}</span>
      <span>$${p.monto.toLocaleString('es-CO')}</span>
    </div>
  `).join('');

  const descuentoHtml = sale.descuento > 0 ? `
    <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
      <span>Precio original:</span>
      <span style="text-decoration:line-through;">$${sale.precioOriginal.toLocaleString('es-CO')}</span>
    </div>
    <div style="display:flex;justify-content:space-between;margin-bottom:4px;color:#dc2626;">
      <span>Descuento:</span>
      <span>-$${sale.descuento.toLocaleString('es-CO')}</span>
    </div>
  ` : '';

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Factura - Xiaomi Store</title>
  <style>
    @media print { @page { margin: 5mm; size: 80mm auto; } }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Courier New', Courier, monospace; font-size: 12px; color: #000; max-width: 320px; margin: 0 auto; padding: 10px; background: #fff; }
    .dashed { border-top: 2px dashed #000; margin: 10px 0; }
    .dashed-thin { border-top: 1px dashed #000; margin: 8px 0; }
    .row { display: flex; justify-content: space-between; margin-bottom: 3px; }
    .print-btn { display: block; margin: 20px auto; padding: 12px 30px; background: #333; color: white; border: none; border-radius: 6px; font-weight: bold; font-size: 14px; cursor: pointer; font-family: Arial, sans-serif; }
    .print-btn:hover { background: #111; }
    @media print { .no-print { display: none !important; } }
  </style>
</head>
<body>
  <!-- HEADER -->
  <div style="text-align:center;padding-bottom:12px;">
    <h2 style="font-size:22px;text-transform:uppercase;margin-bottom:4px;">XIAOMI STORE</h2>
    <p style="font-size:11px;">Tecnolog&iacute;a Premium</p>
    <p style="font-weight:bold;font-size:12px;margin-top:6px;">NIT: 1043345642-7</p>
    <p style="font-size:10px;margin-top:8px;">Cl. 31 #61-64, Los &Aacute;ngeles</p>
    <p style="font-size:10px;">Cartagena de Indias</p>
    <p style="font-size:10px;font-weight:bold;margin-top:4px;">Tel: 302 287 5280</p>
    <p style="font-size:10px;">www.xiaomicartagena.com</p>
  </div>

  <div class="dashed"></div>

  <!-- DATOS VENTA -->
  <div style="font-size:11px;margin-bottom:6px;">
    <div class="row"><strong>FECHA:</strong><span>${fecha}</span></div>
    <div class="row"><strong>HORA:</strong><span>${hora}</span></div>
  </div>

  <div class="dashed-thin"></div>

  <!-- CLIENTE -->
  <div style="font-size:11px;margin-bottom:6px;">
    <div style="font-weight:bold;margin-bottom:4px;">CLIENTE</div>
    <div>Nombre: <span style="text-transform:uppercase;">${sale.cliente}</span></div>
    ${sale.cedula ? `<div>C&eacute;dula/NIT: ${sale.cedula}</div>` : ''}
    ${sale.telefono ? `<div>Tel: ${sale.telefono}</div>` : ''}
  </div>

  <div style="border-top:2px solid #000;margin:10px 0;"></div>

  <!-- PRODUCTO -->
  <div style="margin-bottom:8px;">
    <div style="font-size:12px;font-weight:bold;margin-bottom:8px;">PRODUCTOS</div>
    <div style="font-size:11px;">
      <div style="font-weight:bold;text-transform:uppercase;">${sale.producto}</div>
      ${sale.imei ? `<div style="margin-top:2px;font-size:10px;color:#555;">IMEI: ${sale.imei}</div>` : ''}
      <div style="display:flex;justify-content:space-between;margin-top:4px;">
        <span>1 x $${sale.precioVenta.toLocaleString('es-CO')}</span>
        <strong>$${sale.precioVenta.toLocaleString('es-CO')}</strong>
      </div>
    </div>
  </div>

  <div class="dashed-thin"></div>

  <!-- TOTALES -->
  <div style="font-size:11px;">
    ${descuentoHtml}
    <div style="border-top:2px solid #000;margin:8px 0;"></div>
    <div style="display:flex;justify-content:space-between;font-size:16px;font-weight:bold;margin-bottom:8px;">
      <span>TOTAL:</span>
      <span>$${sale.precioVenta.toLocaleString('es-CO')} COP</span>
    </div>
  </div>

  <!-- FORMA DE PAGO -->
  <div style="font-size:11px;border-top:1px dashed #000;padding-top:8px;margin-bottom:8px;">
    <strong>M&Eacute;TODO DE PAGO:</strong>
    <div style="margin-top:4px;">${pagosHtml}</div>
  </div>

  ${sale.notas ? `<div class="dashed-thin"></div><div style="font-size:10px;">Notas: ${sale.notas}</div>` : ''}

  <div class="dashed"></div>

  <!-- GARANTÍA Y FOOTER -->
  <div style="text-align:center;font-size:10px;margin-top:8px;">
    <div style="font-weight:bold;font-size:14px;text-transform:uppercase;margin-bottom:10px;">Gracias por tu compra!</div>
    <div style="line-height:1.5;text-align:justify;margin-bottom:12px;">
      Conserva este ticket para tu garant&iacute;a. La garant&iacute;a cubre defectos de f&aacute;brica por 6 meses a partir de la fecha de compra. No cubre da&ntilde;os por mal uso, golpes, humedad o manipulaci&oacute;n por terceros. Para hacer efectiva la garant&iacute;a, presenta este ticket junto con el equipo en nuestra tienda.
    </div>
    <div style="font-weight:bold;margin-bottom:2px;">Horario de atenci&oacute;n:</div>
    <div>Lun - Vie: 9:00 AM - 7:00 PM | Dom: 10:30 AM - 3:00 PM</div>
  </div>

  <button class="print-btn no-print" onclick="window.print()">Imprimir Factura</button>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=380,height=700');
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
    cedula: '',
    telefono: '',
    producto: '',
    precioVenta: '',
    precioCompra: '',
    descuento: '',
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

  // ─── Open sale dialog for a product ──────────────────────────────
  const openSale = (p: CatalogProduct | null) => {
    setSelectedProduct(p);
    setSaleForm({
      cliente: '',
      cedula: '',
      telefono: '',
      producto: p?.name || '',
      precioVenta: p ? Math.round(p.price).toString() : '',
      precioCompra: '',
      descuento: '',
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
    const precioOriginal = Number(saleForm.precioVenta);
    const descuento = Number(saleForm.descuento) || 0;
    const precioFinal = precioOriginal - descuento;

    if (precioFinal <= 0) {
      toast.error('El descuento no puede ser mayor al precio'); return;
    }

    // Calculate total pagos
    const pagoEntries = Object.entries(pagos)
      .map(([cuenta, val]) => ({ cuenta, monto: Number(val) || 0 }))
      .filter(e => e.monto > 0);

    const totalPagos = pagoEntries.reduce((s, e) => s + e.monto, 0);
    if (pagoEntries.length === 0) {
      toast.error('Selecciona al menos una forma de pago'); return;
    }
    if (totalPagos !== precioFinal) {
      toast.error(`Los pagos (${fmt(totalPagos)}) no coinciden con el total (${fmt(precioFinal)})`);
      return;
    }

    setSaving(true);
    try {
      const metodoPago = pagoEntries.length === 1
        ? pagoEntries[0].cuenta
        : pagoEntries.map(e => `${e.cuenta}:${e.monto}`).join('+');

      const notasConDescuento = descuento > 0
        ? `${saleForm.notas ? saleForm.notas + ' | ' : ''}Descuento: -${fmt(descuento)} (precio original: ${fmt(precioOriginal)})`
        : saleForm.notas;

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
          precioVenta: precioFinal,
          metodoPago,
          estadoPago: 'recibido',
          notas: notasConDescuento,
        }),
      });

      if (!saleRes.ok) throw new Error('Error creando venta');

      // Build sale data for print
      const saleData: LastSale = {
        cliente: saleForm.cliente || 'Cliente',
        cedula: saleForm.cedula,
        telefono: saleForm.telefono,
        producto: saleForm.producto,
        precioOriginal,
        descuento,
        precioVenta: precioFinal,
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
            <DialogDescription>Llena los datos, elige el pago y listo</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-2">

            {/* ── PASO 1: Producto ─────────────────────────────── */}
            {/* ── PASO 1: Producto ─────────────────────────────── */}
            <div className="bg-violet-50 rounded-lg p-3 space-y-2">
              <p className="text-xs font-bold text-violet-600 uppercase">Producto</p>
              {selectedProduct && (
                <div className="flex items-center gap-3">
                  <img src={selectedProduct.image} className="w-14 h-14 object-contain rounded-lg bg-white p-1" />
                  <div className="flex-1">
                    <p className="font-bold text-sm text-violet-900">{selectedProduct.name}</p>
                    <p className="text-lg font-black text-violet-600">{fmt(Math.round(selectedProduct.price))}</p>
                  </div>
                </div>
              )}
              {!selectedProduct && (
                <Input value={saleForm.producto} onChange={e => setSaleForm(f => ({ ...f, producto: e.target.value }))} placeholder="Nombre del producto *" />
              )}
              <Input value={saleForm.imei} onChange={e => setSaleForm(f => ({ ...f, imei: e.target.value }))} placeholder="IMEI (opcional)" />
            </div>

            {/* ── PASO 2: Datos del cliente ────────────────────── */}
            <div className="bg-gray-50 rounded-lg p-3 space-y-2">
              <p className="text-xs font-bold text-gray-500 uppercase">Datos del cliente</p>
              <div className="grid grid-cols-2 gap-2">
                <Input value={saleForm.cliente} onChange={e => setSaleForm(f => ({ ...f, cliente: e.target.value }))} placeholder="Nombre *" />
                <Input value={saleForm.cedula} onChange={e => setSaleForm(f => ({ ...f, cedula: e.target.value }))} placeholder="Cédula / NIT" />
              </div>
              <Input value={saleForm.telefono} onChange={e => setSaleForm(f => ({ ...f, telefono: e.target.value }))} placeholder="Teléfono" className="w-full" />
            </div>

            {/* ── PASO 3: Precio y rebaja ──────────────────────── */}
            <div className="bg-gray-50 rounded-lg p-3 space-y-2">
              <p className="text-xs font-bold text-gray-500 uppercase">Precio</p>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <Input type="number" value={saleForm.precioVenta} onChange={e => setSaleForm(f => ({ ...f, precioVenta: e.target.value }))} placeholder="Precio venta *" className="text-lg font-bold h-11" />
                </div>
                <div className="w-28">
                  <Input type="number" value={saleForm.descuento} onChange={e => setSaleForm(f => ({ ...f, descuento: e.target.value }))} placeholder="Rebaja" className="border-orange-200 focus:border-orange-400 h-11" />
                </div>
              </div>
              {Number(saleForm.descuento) > 0 && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg px-3 py-1.5 text-xs">
                  <span className="text-orange-700 font-semibold">
                    Rebaja {fmt(Number(saleForm.descuento))} → Cobra: <strong>{fmt((Number(saleForm.precioVenta) || 0) - Number(saleForm.descuento))}</strong>
                  </span>
                </div>
              )}
            </div>

            {/* ── PASO 4: Forma de pago ────────────────────────── */}
            <div className="bg-gray-50 rounded-lg p-3 space-y-2">
              <p className="text-xs font-bold text-gray-500 uppercase">Forma de pago</p>

              {cuentas.map(c => {
                const Icon = ICONS[c.id] || CreditCard;
                const isDatafono = c.id === 'datafono';
                const isAddi = c.id === 'addi';
                const val = Number(pagos[c.id] || 0);
                return (
                  <div key={c.id}>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5 w-28 flex-shrink-0">
                        <Icon className="w-4 h-4 text-gray-500" />
                        <span className="text-sm font-semibold text-gray-700">{c.nombre}</span>
                        {isDatafono && <span className="text-[9px] font-bold text-orange-600 bg-orange-100 px-1 rounded">+5%</span>}
                        {(isDatafono || isAddi) && <Clock className="w-3 h-3 text-amber-500" />}
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
                    {isDatafono && val > 0 && (
                      <p className="ml-28 pl-2 mt-0.5 text-[10px] text-orange-600 font-semibold">
                        Cliente paga: {fmt(val + Math.round(val * DATAFONO_SURCHARGE))} · Cae al siguiente día hábil
                      </p>
                    )}
                    {isAddi && val > 0 && (
                      <p className="ml-28 pl-2 mt-0.5 text-[10px] text-purple-600 font-semibold">
                        Pendiente · Addi paga en ~7 días
                      </p>
                    )}
                  </div>
                );
              })}

              {/* Pago total indicator */}
              {(() => {
                const total = Object.values(pagos).reduce((s, v) => s + (Number(v) || 0), 0);
                const precio = (Number(saleForm.precioVenta) || 0) - (Number(saleForm.descuento) || 0);
                const diff = precio - total;
                const ok = total > 0 && diff === 0;
                return total > 0 ? (
                  <div className={`text-sm font-bold text-right pt-1 ${ok ? 'text-green-600' : 'text-red-600'}`}>
                    {ok ? '✅ Pago completo' : diff > 0 ? `Faltan ${fmt(diff)}` : `Excede ${fmt(Math.abs(diff))}`}
                  </div>
                ) : null;
              })()}
            </div>

            {/* Notas */}
            <Input value={saleForm.notas} onChange={e => setSaleForm(f => ({ ...f, notas: e.target.value }))} placeholder="Notas (opcional)" />

            <Button onClick={handleSale} disabled={saving} className="w-full bg-violet-600 hover:bg-violet-700 text-white gap-2 h-12 text-base font-bold">
              <Printer className="w-5 h-5" /> {saving ? 'Registrando...' : 'Facturar e imprimir'}
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
