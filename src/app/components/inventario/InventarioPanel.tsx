import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { StockManager } from './StockManager';
import { DailySales } from './DailySales';
import { PettyCash } from './PettyCash';
import { Package, Receipt, Wallet, TrendingUp } from 'lucide-react';
import { SupplierDebts } from './SupplierDebts';

export function InventarioPanel() {
  const [activeTab, setActiveTab] = useState('ventas');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <Package className="w-7 h-7 text-violet-600" />
        <div>
          <h2 className="text-xl font-black text-gray-900">Sistema de Inventario</h2>
          <p className="text-xs text-gray-400">Inventario, facturaci&oacute;n, caja y proveedores</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full justify-start bg-gray-100 rounded-xl p-1 gap-1">
          <TabsTrigger value="ventas" className="flex items-center gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-lg text-sm font-semibold">
            <Receipt className="w-4 h-4" /> Ventas del D&iacute;a
          </TabsTrigger>
          <TabsTrigger value="inventario" className="flex items-center gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-lg text-sm font-semibold">
            <Package className="w-4 h-4" /> Inventario
          </TabsTrigger>
          <TabsTrigger value="caja" className="flex items-center gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-lg text-sm font-semibold">
            <Wallet className="w-4 h-4" /> Caja Menor
          </TabsTrigger>
          <TabsTrigger value="proveedores" className="flex items-center gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-lg text-sm font-semibold">
            <TrendingUp className="w-4 h-4" /> Proveedores
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ventas">
          <DailySales />
        </TabsContent>
        <TabsContent value="inventario">
          <StockManager />
        </TabsContent>
        <TabsContent value="caja">
          <PettyCash />
        </TabsContent>
        <TabsContent value="proveedores">
          <SupplierDebts />
        </TabsContent>
      </Tabs>
    </div>
  );
}
