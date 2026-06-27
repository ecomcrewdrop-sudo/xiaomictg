import { useState } from 'react';
import { StockManager } from './StockManager';
import { DailySales } from './DailySales';
import { CashRegister } from './CashRegister';
import { PettyCash } from './PettyCash';
import { SupplierDebts } from './SupplierDebts';
import { Package, CreditCard, Wallet, Landmark, TrendingUp, Receipt } from 'lucide-react';

const TABS = [
  { key: 'ventas', label: 'Ventas', icon: CreditCard },
  { key: 'inventario', label: 'Inventario', icon: Package },
  { key: 'caja', label: 'Caja', icon: Landmark },
  { key: 'gastos', label: 'Gastos', icon: Receipt },
  { key: 'proveedores', label: 'Proveedores', icon: TrendingUp },
] as const;

export function InventarioPanel() {
  const [activeTab, setActiveTab] = useState('ventas');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <Package className="w-7 h-7 text-violet-600" />
        <div>
          <h2 className="text-xl font-black text-gray-900">Sistema de Inventario</h2>
          <p className="text-xs text-gray-400">Inventario, facturacion, caja y proveedores</p>
        </div>
      </div>

      {/* Sub-tabs (sin Radix para evitar conflicto con tabs padre) */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 overflow-x-auto">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all ${
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
      {activeTab === 'ventas' && <DailySales />}
      {activeTab === 'inventario' && <StockManager />}
      {activeTab === 'caja' && <CashRegister />}
      {activeTab === 'gastos' && <PettyCash />}
      {activeTab === 'proveedores' && <SupplierDebts />}
    </div>
  );
}
