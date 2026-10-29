import { useState } from 'react';
import { PointOfSale } from './PointOfSale';
import { DailySales } from './DailySales';
import { StockManager } from './StockManager';
import { PettyCash } from './PettyCash';
import { SupplierDebts } from './SupplierDebts';
import {
  ShoppingBag, BookOpen, Settings2,
  Package, Receipt, TrendingUp, ChevronDown,
} from 'lucide-react';

const TABS = [
  { key: 'ventas', label: 'Ventas', icon: ShoppingBag },
  { key: 'libro', label: 'Libro Diario', icon: BookOpen },
  { key: 'admin', label: 'Admin', icon: Settings2 },
] as const;

// Collapsible sections for Admin tab
const ADMIN_SECTIONS = [
  { key: 'inventario', label: 'Inventario / Stock', icon: Package },
  { key: 'gastos', label: 'Gastos', icon: Receipt },
  { key: 'proveedores', label: 'Proveedores', icon: TrendingUp },
] as const;

export function InventarioPanel() {
  const [activeTab, setActiveTab] = useState('ventas');
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    inventario: true,
    gastos: false,
    proveedores: false,
  });

  const toggleSection = (key: string) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <ShoppingBag className="w-7 h-7 shrink-0 text-violet-600" />
        <div className="min-w-0">
          <h2 className="text-xl font-black text-gray-900 sm:text-2xl">Punto de Venta</h2>
          <p className="text-xs text-gray-400">Ventas, caja, inventario y control</p>
        </div>
      </div>

      {/*
        Tabs. "Libro Diario" + icono no cabe en tres columnas a 360px: el texto se
        partía en dos líneas y descuadraba la tira. En móvil se desliza en
        horizontal (sin barra visible) y a partir de lg vuelve a ser rejilla.
      */}
      <div className="flex snap-x gap-1 overflow-x-auto rounded-xl bg-gray-100 p-1 [-ms-overflow-style:none] [scrollbar-width:none] lg:grid lg:grid-cols-3 lg:overflow-visible [&::-webkit-scrollbar]:hidden">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`h-11 flex-none shrink-0 snap-start flex items-center justify-center gap-1.5 whitespace-nowrap px-4 rounded-lg text-sm font-semibold transition-all lg:h-10 lg:flex-1 lg:shrink ${
                isActive
                  ? 'bg-white text-violet-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {activeTab === 'ventas' && <PointOfSale />}
      {activeTab === 'libro' && <DailySales />}
      {activeTab === 'admin' && (
        <div className="space-y-3">
          {ADMIN_SECTIONS.map(sec => {
            const Icon = sec.icon;
            const isOpen = openSections[sec.key] ?? false;
            return (
              <div key={sec.key} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <button
                  onClick={() => toggleSection(sec.key)}
                  className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                >
                  <Icon className="w-5 h-5 shrink-0 text-violet-600" />
                  <span className="min-w-0 flex-1 font-bold text-sm text-gray-900">{sec.label}</span>
                  <ChevronDown className={`w-4 h-4 shrink-0 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>
                {isOpen && (
                  <div className="px-3 pb-4 border-t border-gray-100 sm:px-4">
                    {sec.key === 'inventario' && <StockManager />}
                    {sec.key === 'gastos' && <PettyCash />}
                    {sec.key === 'proveedores' && <SupplierDebts />}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
