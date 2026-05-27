import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { useDeviceStore } from '../../../lib/blocking/store';
import { useUserStore } from '../../../lib/blocking/user-store';
import { MongoDBStatus } from '../../../components/MongoDBStatus';
import { 
  Smartphone, 
  ShieldCheck, 
  ShieldAlert, 
  TrendingUp,
  Activity,
  Users,
  DollarSign
} from 'lucide-react';
import { Stats } from '../../../lib/blocking/types';
import { useMemo, useEffect } from 'react';

export function Dashboard() {
  const devices = useDeviceStore((state) => state.devices);
  const history = useDeviceStore((state) => state.history);
  const payments = useDeviceStore((state) => state.payments);
  const users = useUserStore((state) => state.users);
  const loadFromApi = useDeviceStore((state) => state.loadFromApi);
  const isLoading = useDeviceStore((state) => state.isLoading);
  const isUsingMockData = useDeviceStore((state) => state.isUsingMockData);

  useEffect(() => {
    if (isUsingMockData) {
      loadFromApi();
    }
  }, []);

  const stats: Stats = useMemo(() => {
    const total = devices.length;
    const blocked = devices.filter((d) => d.status === 'blocked').length;
    const active = devices.filter((d) => d.status === 'active').length;
    const kioskMode = devices.filter((d) => d.status === 'kiosk').length;
    const enrolled = devices.filter((d) => d.enrolledInMDM).length;
    
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentBlocks = history.filter(
      (h) => h.action === 'block' && new Date(h.timestamp) > sevenDaysAgo
    ).length;

    return {
      total,
      active,
      blocked,
      recentBlocks,
      kioskMode,
      enrolled,
    };
  }, [devices, history]);

  const paymentStats = useMemo(() => {
    const totalCollected = payments.reduce((sum, p) => sum + p.amount, 0);
    const devicesWithPlans = devices.filter(d => d.paymentPlan);
    const totalPending = devicesWithPlans.reduce(
      (sum, d) => sum + (d.paymentPlan?.remainingAmount || 0),
      0
    );
    const overduePlans = devicesWithPlans.filter(d => d.paymentPlan?.status === 'overdue').length;
    
    return { totalCollected, totalPending, overduePlans };
  }, [payments, devices]);

  const recentActivity = history.slice(0, 5);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-medium text-gray-900">Dashboard</h2>
        <p className="text-gray-600 mt-1">
          Panel de control del sistema de gestión de bloqueo de celulares
        </p>
      </div>

      <MongoDBStatus />

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border border-gray-200 bg-white shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-normal text-gray-600">
              Total Dispositivos
            </CardTitle>
            <div className="bg-[#ff6700] p-2 rounded-md">
              <Smartphone className="h-5 w-5 text-white" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-normal text-gray-900">{stats.total}</div>
            <p className="text-xs text-gray-500 mt-1">
              {stats.enrolled} inscritos en MDM
            </p>
          </CardContent>
        </Card>

        <Card className="border border-gray-200 bg-white shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-normal text-gray-600">
              Dispositivos Activos
            </CardTitle>
            <div className="bg-green-600 p-2 rounded-md">
              <ShieldCheck className="h-5 w-5 text-white" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-normal text-green-600">{stats.active}</div>
            <p className="text-xs text-gray-500 mt-1">
              {((stats.active / stats.total) * 100).toFixed(0)}% del total
            </p>
          </CardContent>
        </Card>

        <Card className="border border-gray-200 bg-white shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-normal text-gray-600">
              Dispositivos Bloqueados
            </CardTitle>
            <div className="bg-red-600 p-2 rounded-md">
              <ShieldAlert className="h-5 w-5 text-white" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-normal text-red-600">{stats.blocked}</div>
            <p className="text-xs text-gray-500 mt-1">
              {((stats.blocked / stats.total) * 100).toFixed(0)}% del total
            </p>
          </CardContent>
        </Card>

        <Card className="border border-gray-200 bg-white shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-normal text-gray-600">
              Modo Kiosk
            </CardTitle>
            <div className="bg-blue-600 p-2 rounded-md">
              <TrendingUp className="h-5 w-5 text-white" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-normal text-blue-600">{stats.kioskMode}</div>
            <p className="text-xs text-gray-500 mt-1">Dispositivos restringidos</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        <Card className="border border-gray-200 bg-white shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-normal text-gray-600">
              Total Usuarios
            </CardTitle>
            <div className="bg-purple-600 p-2 rounded-md">
              <Users className="h-5 w-5 text-white" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-normal text-purple-600">{users.length}</div>
            <p className="text-xs text-gray-500 mt-1">Clientes registrados</p>
          </CardContent>
        </Card>

        <Card className="border border-gray-200 bg-white shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-normal text-gray-600">
              Total Recaudado
            </CardTitle>
            <div className="bg-green-600 p-2 rounded-md">
              <DollarSign className="h-5 w-5 text-white" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-normal text-green-600">
              ${paymentStats.totalCollected.toFixed(0)}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {payments.length} pagos registrados
            </p>
          </CardContent>
        </Card>

        <Card className="border border-gray-200 bg-white shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-normal text-gray-600">
              Pagos Pendientes
            </CardTitle>
            <div className="bg-[#ff6700] p-2 rounded-md">
              <DollarSign className="h-5 w-5 text-white" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-normal text-[#ff6700]">
              ${paymentStats.totalPending.toFixed(0)}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {paymentStats.overduePlans} planes atrasados
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border border-gray-200 bg-white shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="bg-[#ff6700] p-2 rounded-md">
              <Activity className="h-5 w-5 text-white" />
            </div>
            <CardTitle className="text-xl font-medium text-gray-900">Actividad Reciente</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {recentActivity.length === 0 ? (
            <p className="text-center text-gray-500 py-8">No hay actividad reciente</p>
          ) : (
            <div className="space-y-4">
              {recentActivity.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-4 pb-4 border-b last:border-0 last:pb-0"
                >
                  <div
                    className={`p-2 rounded-lg ${
                      entry.action === 'block'
                        ? 'bg-red-100'
                        : entry.action === 'unblock'
                        ? 'bg-green-100'
                        : 'bg-blue-100'
                    }`}
                  >
                    {entry.action === 'block' ? (
                      <ShieldAlert className="h-5 w-5 text-red-600" />
                    ) : entry.action === 'unblock' ? (
                      <ShieldCheck className="h-5 w-5 text-green-600" />
                    ) : (
                      <Smartphone className="h-5 w-5 text-blue-600" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900">
                      {entry.action === 'block'
                        ? 'Dispositivo Bloqueado'
                        : entry.action === 'unblock'
                        ? 'Dispositivo Desbloqueado'
                        : entry.action === 'kiosk_enable'
                        ? 'Modo Kiosk Activado'
                        : entry.action === 'kiosk_disable'
                        ? 'Modo Kiosk Desactivado'
                        : entry.action === 'locate'
                        ? 'Ubicación Solicitada'
                        : entry.action === 'wipe'
                        ? 'Borrado Remoto'
                        : 'Dispositivo Agregado'}
                    </p>
                    <p className="text-sm text-gray-600 mt-1">{entry.deviceInfo}</p>
                    {entry.reason && (
                      <p className="text-xs text-gray-500 mt-1">Motivo: {entry.reason}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs text-gray-500">Por {entry.user}</span>
                      <span className="text-xs text-gray-400">•</span>
                      <span className="text-xs text-gray-500">
                        {new Date(entry.timestamp).toLocaleString('es', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
