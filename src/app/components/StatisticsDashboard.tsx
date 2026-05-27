import { useMemo, useState, type ReactNode } from 'react';
import {
  format,
  subDays,
  startOfDay,
  endOfDay,
  eachDayOfInterval,
  parseISO,
  isValid,
  differenceInCalendarDays,
  min,
  max,
} from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from 'recharts';
import {
  BarChart3,
  TrendingUp,
  DollarSign,
  ShoppingCart,
  Package,
  Calendar,
  Percent,
  Truck,
} from 'lucide-react';
import { useProducts, Order, Product } from './ProductContext';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from './ui/chart';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Input } from './ui/input';
import { Label } from './ui/label';

type PeriodKey = '7d' | '30d' | '90d' | '365d' | 'all' | 'custom';

const PERIOD_LABELS: Record<PeriodKey, string> = {
  '7d': 'Últimos 7 días',
  '30d': 'Últimos 30 días',
  '90d': 'Últimos 90 días',
  '365d': 'Último año',
  all: 'Todo el historial',
  custom: 'Rango personalizado',
};

type PeriodBounds = {
  start: Date;
  end: Date;
  prevStart: Date;
  prevEnd: Date;
  days: number;
  label: string;
  comparePrevious: boolean;
};

function resolvePeriodBounds(
  period: PeriodKey,
  customFrom: string,
  customTo: string,
  now: Date,
  orders: Order[],
): PeriodBounds {
  if (period === 'custom') {
    let from = parseISO(customFrom);
    let to = parseISO(customTo);
    if (!isValid(from)) from = startOfDay(subDays(now, 29));
    if (!isValid(to)) to = endOfDay(now);
    const start = startOfDay(min([from, to]));
    const end = endOfDay(max([from, to]));
    const days = Math.max(1, differenceInCalendarDays(end, start) + 1);
    const prevEnd = endOfDay(subDays(start, 1));
    const prevStart = startOfDay(subDays(prevEnd, days - 1));
    return {
      start,
      end,
      prevStart,
      prevEnd,
      days,
      label: `${format(start, "d MMM yyyy", { locale: es })} – ${format(end, "d MMM yyyy", { locale: es })}`,
      comparePrevious: true,
    };
  }

  if (period === 'all') {
    const earliest =
      orders.length > 0
        ? orders.reduce((a, b) => (parseOrderDate(a) < parseOrderDate(b) ? a : b))
        : null;
    const start = earliest ? startOfDay(parseOrderDate(earliest)) : startOfDay(now);
    const end = endOfDay(now);
    const days = Math.max(1, differenceInCalendarDays(end, start) + 1);
    return {
      start,
      end,
      prevStart: new Date(0),
      prevEnd: new Date(0),
      days,
      label: PERIOD_LABELS.all,
      comparePrevious: false,
    };
  }

  const dayCount =
    period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 365;
  const end = endOfDay(now);
  const start = startOfDay(subDays(now, dayCount - 1));
  const prevEnd = endOfDay(subDays(start, 1));
  const prevStart = startOfDay(subDays(prevEnd, dayCount - 1));

  return {
    start,
    end,
    prevStart,
    prevEnd,
    days: dayCount,
    label: PERIOD_LABELS[period],
    comparePrevious: true,
  };
}

function isDateInRange(d: Date, start: Date, end: Date): boolean {
  const t = d.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

const STATUS_LABELS: Record<Order['status'], string> = {
  pending: 'Pendiente',
  pending_bold: 'Pendiente Bold',
  processing: 'Procesando',
  completed: 'Completada',
  cancelled: 'Cancelada',
};

const STATUS_COLORS: Record<Order['status'], string> = {
  pending: '#eab308',
  pending_bold: '#f97316',
  processing: '#3b82f6',
  completed: '#22c55e',
  cancelled: '#ef4444',
};

const CATEGORY_LABELS: Record<string, string> = {
  moviles: 'Móviles',
  smartwatch: 'Smartwatch',
  audifonos: 'Audífonos',
  tablet: 'Tablets',
  accesorios: 'Estilo de Vida',
  scooter: 'Scooter',
  poco: 'POCO',
};

function parseOrderDate(order: Order): Date {
  const raw = order.createdAt || order.date;
  const d = typeof raw === 'string' ? parseISO(raw) : new Date(raw);
  return isValid(d) ? d : new Date();
}

function orderRevenue(order: Order): number {
  const delivery = order.customerInfo?.deliveryFee || 0;
  const base = Number(order.total) || 0;
  const isCard =
    order.paymentMethod?.toLowerCase().includes('tarjeta') ||
    order.paymentMethod?.toLowerCase().includes('bold');
  const cardFee = isCard ? Math.round(base * 0.05) : 0;
  return base + delivery + cardFee;
}

function formatCOP(value: number): string {
  return `$${Math.round(value).toLocaleString('es-CO')} COP`;
}

const salesChartConfig = {
  revenue: { label: 'Ingresos', color: '#f97316' },
  orders: { label: 'Pedidos', color: '#3b82f6' },
} satisfies ChartConfig;

const statusChartConfig = {
  pending: { label: 'Pendiente', color: STATUS_COLORS.pending },
  pending_bold: { label: 'Pendiente Bold', color: STATUS_COLORS.pending_bold },
  processing: { label: 'Procesando', color: STATUS_COLORS.processing },
  completed: { label: 'Completada', color: STATUS_COLORS.completed },
  cancelled: { label: 'Cancelada', color: STATUS_COLORS.cancelled },
} satisfies ChartConfig;

export function StatisticsDashboard() {
  const { orders, products } = useProducts();
  const [period, setPeriod] = useState<PeriodKey>('30d');
  const [customFrom, setCustomFrom] = useState(() => format(subDays(new Date(), 29), 'yyyy-MM-dd'));
  const [customTo, setCustomTo] = useState(() => format(new Date(), 'yyyy-MM-dd'));

  const stats = useMemo(() => {
    const now = new Date();
    const bounds = resolvePeriodBounds(period, customFrom, customTo, now, orders);

    const currentOrders = orders.filter((o) =>
      isDateInRange(parseOrderDate(o), bounds.start, bounds.end),
    );
    const previousOrders = bounds.comparePrevious
      ? orders.filter((o) => isDateInRange(parseOrderDate(o), bounds.prevStart, bounds.prevEnd))
      : [];

    const completed = currentOrders.filter((o) => o.status === 'completed');
    const prevCompleted = previousOrders.filter((o) => o.status === 'completed');

    const revenue = completed.reduce((s, o) => s + orderRevenue(o), 0);
    const prevRevenue = prevCompleted.reduce((s, o) => s + orderRevenue(o), 0);

    const nonCancelled = currentOrders.filter((o) => o.status !== 'cancelled');
    const avgTicket = completed.length > 0 ? revenue / completed.length : 0;

    const daysInPeriod = bounds.days;

    const dailyAvgRevenue = revenue / Math.max(1, daysInPeriod);
    const dailyAvgOrders = nonCancelled.length / Math.max(1, daysInPeriod);

    const daySeries = eachDayOfInterval({ start: bounds.start, end: bounds.end });

    const dailyMap = new Map<string, { date: string; label: string; revenue: number; orders: number }>();
    for (const day of daySeries) {
      const key = format(day, 'yyyy-MM-dd');
      dailyMap.set(key, {
        date: key,
        label: format(day, 'd MMM', { locale: es }),
        revenue: 0,
        orders: 0,
      });
    }

    for (const order of currentOrders) {
      const key = format(startOfDay(parseOrderDate(order)), 'yyyy-MM-dd');
      const row = dailyMap.get(key);
      if (!row) continue;
      if (order.status !== 'cancelled') row.orders += 1;
      if (order.status === 'completed') row.revenue += orderRevenue(order);
    }

    const dailyData = Array.from(dailyMap.values());

    const statusCounts = currentOrders.reduce(
      (acc, o) => {
        acc[o.status] = (acc[o.status] || 0) + 1;
        return acc;
      },
      {} as Record<Order['status'], number>,
    );

    const statusData = (Object.keys(STATUS_LABELS) as Order['status'][])
      .map((status) => ({
        status,
        name: STATUS_LABELS[status],
        value: statusCounts[status] || 0,
        fill: STATUS_COLORS[status],
      }))
      .filter((d) => d.value > 0);

    const productSales = new Map<string, { name: string; units: number; revenue: number }>();
    for (const order of completed) {
      for (const item of order.items) {
        const name = item.product?.name || 'Producto';
        const key = item.product?.id || name;
        const existing = productSales.get(key) || { name, units: 0, revenue: 0 };
        existing.units += item.quantity;
        existing.revenue += (item.product?.price || 0) * item.quantity;
        productSales.set(key, existing);
      }
    }

    const topProducts = Array.from(productSales.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)
      .map((p) => ({ ...p, name: p.name.length > 28 ? `${p.name.slice(0, 28)}…` : p.name }));

    const categorySales = new Map<string, number>();
    for (const order of completed) {
      for (const item of order.items) {
        const cat = item.product?.category || 'otros';
        categorySales.set(cat, (categorySales.get(cat) || 0) + item.quantity);
      }
    }

    const categoryData = Array.from(categorySales.entries())
      .map(([category, units]) => ({
        category,
        name: CATEGORY_LABELS[category] || category,
        units,
      }))
      .sort((a, b) => b.units - a.units);

    const paymentMethods = currentOrders.reduce(
      (acc, o) => {
        const method = o.paymentMethod || 'No especificado';
        acc[method] = (acc[method] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const paymentData = Object.entries(paymentMethods)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    const deliveryStats = currentOrders.reduce(
      (acc, o) => {
        const method = o.customerInfo?.deliveryMethod;
        if (method === 'delivery') acc.delivery += 1;
        else if (method === 'pickup') acc.pickup += 1;
        else acc.other += 1;
        return acc;
      },
      { delivery: 0, pickup: 0, other: 0 },
    );

    const inventoryValue = products.reduce((s, p) => s + p.price * p.stock, 0);
    const lowStock = products.filter((p) => p.stock < 10).length;

    const pctChange = (current: number, previous: number) =>
      previous === 0 ? (current > 0 ? 100 : 0) : Math.round(((current - previous) / previous) * 100);

    return {
      currentOrders,
      completed,
      revenue,
      prevRevenue,
      revenueChange: pctChange(revenue, prevRevenue),
      orderCount: nonCancelled.length,
      orderChange: pctChange(nonCancelled.length, previousOrders.filter((o) => o.status !== 'cancelled').length),
      avgTicket,
      dailyAvgRevenue,
      dailyAvgOrders,
      dailyData,
      statusData,
      topProducts,
      categoryData,
      paymentData,
      deliveryStats,
      inventoryValue,
      lowStock,
      pendingCount: currentOrders.filter((o) => o.status === 'pending' || o.status === 'pending_bold').length,
      processingCount: currentOrders.filter((o) => o.status === 'processing').length,
      periodLabel: bounds.label,
      comparePrevious: bounds.comparePrevious,
    };
  }, [orders, products, period, customFrom, customTo]);

  const productChartConfig = useMemo(() => {
    const cfg: ChartConfig = { revenue: { label: 'Ingresos', color: '#f97316' } };
    stats.topProducts.forEach((p, i) => {
      cfg[`p${i}`] = { label: p.name, color: `hsl(${24 + i * 18}, 85%, 50%)` };
    });
    return cfg;
  }, [stats.topProducts]);

  if (orders.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <BarChart3 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <p className="text-gray-600 text-lg">Aún no hay datos para estadísticas</p>
        <p className="text-gray-400 text-sm mt-2">Las métricas aparecerán cuando existan pedidos en el sistema.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-gray-800 flex items-center gap-2">
            <BarChart3 className="w-7 h-7 text-orange-500" />
            Estadísticas y reportes
          </h2>
          <p className="text-gray-500 text-sm mt-1">
            Ventas, ingresos, productos e inventario — período: {stats.periodLabel}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <Select value={period} onValueChange={(v) => setPeriod(v as PeriodKey)}>
            <SelectTrigger className="w-[220px] bg-white">
              <Calendar className="w-4 h-4 mr-2 text-gray-400" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PERIOD_LABELS) as PeriodKey[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {PERIOD_LABELS[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {period === 'custom' && (
            <div className="flex flex-wrap items-end gap-3 bg-white border border-gray-200 rounded-lg px-4 py-3">
              <div>
                <Label htmlFor="stats-from" className="text-xs text-gray-500">
                  Desde
                </Label>
                <Input
                  id="stats-from"
                  type="date"
                  value={customFrom}
                  max={customTo}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="w-[160px] mt-1"
                />
              </div>
              <div>
                <Label htmlFor="stats-to" className="text-xs text-gray-500">
                  Hasta
                </Label>
                <Input
                  id="stats-to"
                  type="date"
                  value={customTo}
                  min={customFrom}
                  max={format(new Date(), 'yyyy-MM-dd')}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="w-[160px] mt-1"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* KPIs principales */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={<DollarSign className="w-8 h-8 text-green-500" />}
          label="Ingresos (completadas)"
          value={formatCOP(stats.revenue)}
          sub={stats.comparePrevious ? `${stats.revenueChange >= 0 ? '+' : ''}${stats.revenueChange}% vs período anterior` : undefined}
          positive={stats.revenueChange >= 0}
        />
        <KpiCard
          icon={<ShoppingCart className="w-8 h-8 text-orange-500" />}
          label="Pedidos (sin canceladas)"
          value={String(stats.orderCount)}
          sub={stats.comparePrevious ? `${stats.orderChange >= 0 ? '+' : ''}${stats.orderChange}% vs período anterior` : undefined}
          positive={stats.orderChange >= 0}
        />
        <KpiCard
          icon={<TrendingUp className="w-8 h-8 text-blue-500" />}
          label="Ticket promedio"
          value={formatCOP(stats.avgTicket)}
          sub={`Promedio diario: ${formatCOP(stats.dailyAvgRevenue)}`}
        />
        <KpiCard
          icon={<Percent className="w-8 h-8 text-purple-500" />}
          label="Promedio pedidos / día"
          value={stats.dailyAvgOrders.toFixed(1)}
          sub={`${stats.completed.length} completadas en el período`}
        />
      </div>

      {/* KPIs secundarios */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <MiniKpi label="Pendientes" value={stats.pendingCount} color="text-yellow-600" />
        <MiniKpi label="Procesando" value={stats.processingCount} color="text-blue-600" />
        <MiniKpi label="Completadas" value={stats.completed.length} color="text-green-600" />
        <MiniKpi label="Envío domicilio" value={stats.deliveryStats.delivery} color="text-orange-600" />
        <MiniKpi label="Retiro tienda" value={stats.deliveryStats.pickup} color="text-gray-700" />
        <MiniKpi label="Stock bajo (&lt;10)" value={stats.lowStock} color="text-red-600" />
      </div>

      {/* Gráfica ventas diarias */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <ChartCard title="Ingresos diarios (COP)" description="Solo órdenes completadas">
          <ChartContainer config={salesChartConfig} className="h-[300px] w-full">
            <AreaChart data={stats.dailyData} margin={{ left: 8, right: 8, top: 8 }}>
              <defs>
                <linearGradient id="fillRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f97316" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} interval="preserveStartEnd" />
              <YAxis
                tickLine={false}
                axisLine={false}
                fontSize={11}
                tickFormatter={(v) => `${(v / 1000000).toFixed(1)}M`}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value) => formatCOP(Number(value))}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="#f97316"
                fill="url(#fillRevenue)"
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        </ChartCard>

        <ChartCard title="Pedidos por día" description="Todas excepto canceladas">
          <ChartContainer config={salesChartConfig} className="h-[300px] w-full">
            <BarChart data={stats.dailyData} margin={{ left: 8, right: 8, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} interval="preserveStartEnd" />
              <YAxis tickLine={false} axisLine={false} fontSize={11} allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="orders" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <ChartCard title="Estado de órdenes" className="lg:col-span-1">
          <ChartContainer config={statusChartConfig} className="h-[280px] w-full">
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent hideLabel />} />
              <Pie
                data={stats.statusData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={90}
                paddingAngle={2}
              >
                {stats.statusData.map((entry) => (
                  <Cell key={entry.status} fill={entry.fill} />
                ))}
              </Pie>
              <ChartLegend content={<ChartLegendContent />} />
            </PieChart>
          </ChartContainer>
        </ChartCard>

        <ChartCard title="Métodos de pago" className="lg:col-span-1">
          <ChartContainer config={{ count: { label: 'Pedidos', color: '#8b5cf6' } }} className="h-[280px] w-full">
            <BarChart data={stats.paymentData} layout="vertical" margin={{ left: 4, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" allowDecimals={false} fontSize={11} />
              <YAxis type="category" dataKey="name" width={100} fontSize={10} tickLine={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="value" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ChartContainer>
        </ChartCard>

        <ChartCard title="Ventas por categoría (unidades)" className="lg:col-span-1">
          <ChartContainer config={{ units: { label: 'Unidades', color: '#22c55e' } }} className="h-[280px] w-full">
            <BarChart data={stats.categoryData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" fontSize={10} tickLine={false} interval={0} angle={-25} textAnchor="end" height={60} />
              <YAxis allowDecimals={false} fontSize={11} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="units" fill="#22c55e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </ChartCard>
      </div>

      {/* Top productos */}
      <ChartCard title="Top 10 productos por ingresos" description="Órdenes completadas en el período">
        <ChartContainer config={productChartConfig} className="h-[320px] w-full">
          <BarChart data={stats.topProducts} layout="vertical" margin={{ left: 8, right: 24 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} fontSize={11} />
            <YAxis type="category" dataKey="name" width={140} fontSize={11} tickLine={false} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value, _name, item) => {
                    const payload = item?.payload as { units?: number; revenue?: number };
                    return [
                      `${formatCOP(Number(value))} · ${payload?.units ?? 0} uds`,
                      'Ingresos',
                    ];
                  }}
                />
              }
            />
            <Bar dataKey="revenue" fill="#f97316" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ChartContainer>
      </ChartCard>

      {/* Inventario + tabla resumen diario */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6 xl:col-span-1">
          <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Package className="w-5 h-5 text-orange-500" />
            Inventario
          </h3>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">Productos activos</dt>
              <dd className="font-semibold">{products.length}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Valor inventario</dt>
              <dd className="font-semibold text-green-600">{formatCOP(stats.inventoryValue)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Stock total (uds)</dt>
              <dd className="font-semibold">{products.reduce((s, p) => s + p.stock, 0)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Productos stock bajo</dt>
              <dd className="font-semibold text-red-600">{stats.lowStock}</dd>
            </div>
          </dl>
          <div className="mt-4 pt-4 border-t">
            <p className="text-xs text-gray-500 mb-2">Por categoría</p>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {(['moviles', 'poco', 'smartwatch', 'audifonos', 'tablet', 'accesorios', 'scooter'] as const).map(
                (cat) => {
                  const count = products.filter((p: Product) => p.category === cat).length;
                  if (count === 0) return null;
                  return (
                    <div key={cat} className="flex justify-between text-xs">
                      <span>{CATEGORY_LABELS[cat]}</span>
                      <span className="font-medium">{count}</span>
                    </div>
                  );
                },
              )}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 xl:col-span-2 overflow-hidden">
          <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Truck className="w-5 h-5 text-blue-500" />
            Detalle diario (últimos registros del período)
          </h3>
          <div className="overflow-x-auto max-h-[320px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="text-left py-2 px-3 font-medium text-gray-600">Fecha</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-600">Pedidos</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-600">Ingresos</th>
                </tr>
              </thead>
              <tbody>
                {[...stats.dailyData].reverse().slice(0, 31).map((row) => (
                  <tr key={row.date} className="border-t border-gray-100 hover:bg-orange-50/50">
                    <td className="py-2 px-3">{row.label}</td>
                    <td className="py-2 px-3 text-right font-medium">{row.orders}</td>
                    <td className="py-2 px-3 text-right text-green-700 font-medium">
                      {formatCOP(row.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Tendencia combinada */}
      <ChartCard title="Tendencia: ingresos vs volumen de pedidos">
        <ChartContainer config={salesChartConfig} className="h-[300px] w-full">
          <LineChart data={stats.dailyData} margin={{ left: 8, right: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" fontSize={11} interval="preserveStartEnd" />
            <YAxis yAxisId="left" tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} fontSize={11} />
            <YAxis yAxisId="right" orientation="right" allowDecimals={false} fontSize={11} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value, name) =>
                    name === 'revenue' ? formatCOP(Number(value)) : `${value} pedidos`
                  }
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Line yAxisId="left" type="monotone" dataKey="revenue" stroke="#f97316" strokeWidth={2} dot={false} />
            <Line yAxisId="right" type="monotone" dataKey="orders" stroke="#3b82f6" strokeWidth={2} dot={false} />
          </LineChart>
        </ChartContainer>
      </ChartCard>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  sub,
  positive,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500 mb-1">{label}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          {sub && (
            <p
              className={`text-xs mt-2 ${
                positive === undefined ? 'text-gray-500' : positive ? 'text-green-600' : 'text-red-600'
              }`}
            >
              {sub}
            </p>
          )}
        </div>
        {icon}
      </div>
    </div>
  );
}

function MiniKpi({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 px-4 py-3 text-center">
      <p className="text-xs text-gray-500 truncate">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function ChartCard({
  title,
  description,
  children,
  className = '',
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-white rounded-xl border border-gray-200 p-6 shadow-sm ${className}`}>
      <h3 className="font-semibold text-gray-800">{title}</h3>
      {description && <p className="text-xs text-gray-500 mt-1 mb-4">{description}</p>}
      {!description && <div className="mb-4" />}
      {children}
    </div>
  );
}
