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
        <ShoppingBag className="w-7 h-7 text-violet-600" />
        <div>
          <h2 className="text-xl font-black text-gray-900">Punto de Venta</h2>
          <p className="text-xs text-gray-400">Ventas, caja, inventario y control</p>
        </div>
      </div>

      {/* Tabs — only 3, clean */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                isActive
                  ? 'bg-white text-violet-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Icon className="w-4 h-4" />
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
                  <Icon className="w-5 h-5 text-violet-600" />
                  <span className="flex-1 font-bold text-sm text-gray-900">{sec.label}</span>
                  <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 border-t border-gray-100">
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
