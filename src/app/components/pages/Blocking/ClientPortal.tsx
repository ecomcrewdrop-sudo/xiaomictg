import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useClientAuthStore } from '../../../lib/blocking/client-store';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Progress } from '../../ui/progress';
import {
  Smartphone,
  Battery,
  Clock,
  DollarSign,
  Calendar,
  CreditCard,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  LogOut,
  User,
  Shield,
  ShieldAlert,
  Info,
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

export function ClientPortal() {
  const navigate = useNavigate();
  const { cliente, devices, isLoading, logout, fetchDevices } = useClientAuthStore();
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    if (!cliente) {
      navigate('/mi-cuenta/login');
    } else if (devices.length === 0) {
      fetchDevices();
    }
  }, [cliente, devices.length]);

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/mi-cuenta/login');
  };

  if (!cliente) {
    return null;
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const isPaymentOverdue = (nextPaymentDate: string) => {
    const paymentDate = new Date(nextPaymentDate);
    const now = new Date();
    return paymentDate < now;
  };

  const getDaysUntilPayment = (nextPaymentDate: string) => {
    const paymentDate = new Date(nextPaymentDate);
    const now = new Date();
    const diffTime = paymentDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-gradient-to-r from-[#ff6700] to-orange-600 text-white">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-white rounded-full flex items-center justify-center">
                <Smartphone className="w-8 h-8 text-[#ff6700]" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Xiaomi Cartagena</h1>
                <p className="text-orange-100">Portal del Cliente</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="font-medium">{cliente.nombre}</p>
                <p className="text-sm text-orange-100">{cliente.email}</p>
              </div>
              <Button variant="outline" className="text-white border-white hover:bg-white/20" onClick={handleLogout}>
                <LogOut className="w-4 h-4 mr-2" />
                Salir
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        {isLoading && devices.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-gray-500">Cargando dispositivos...</p>
            </CardContent>
          </Card>
        ) : devices.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Smartphone className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-xl font-medium text-gray-700">No tienes dispositivos registrados</p>
              <p className="text-gray-500 mt-2">
                Contacta con Xiaomi Cartagena para registrar tu dispositivo
              </p>
            </CardContent>
          </Card>
        ) : (
          devices.map((device) => {
            const plan = device.paymentPlan;
            const progress = plan ? (plan.paidAmount / plan.totalAmount) * 100 : 0;
            const daysUntilPayment = plan ? getDaysUntilPayment(plan.nextPaymentDate) : 0;
            const overdue = plan ? isPaymentOverdue(plan.nextPaymentDate) : false;
            const isBlocked = device.status === 'blocked';

            return (
              <div key={device._id || device.id} className="space-y-6">
                {isBlocked && (
                  <Card className="border-red-500 border-2 bg-red-50">
                    <CardContent className="py-4">
                      <div className="flex items-center gap-3 text-red-700">
                        <ShieldAlert className="w-6 h-6" />
                        <div>
                          <p className="font-bold">¡Dispositivo Bloqueado!</p>
                          <p className="text-sm">{device.reason || 'Tu dispositivo ha sido bloqueado. Contacta con Xiaomi Cartagena para más información.'}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {plan && overdue && !isBlocked && (
                  <Card className="border-orange-500 border-2 bg-orange-50">
                    <CardContent className="py-4">
                      <div className="flex items-center gap-3 text-orange-700">
                        <AlertTriangle className="w-6 h-6" />
                        <div>
                          <p className="font-bold">¡Pago Atrasado!</p>
                          <p className="text-sm">Tu pago vence hace {Math.abs(daysUntilPayment)} días. Regulariza tu situación para evitar el bloqueo del dispositivo.</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {plan && !overdue && !isBlocked && daysUntilPayment <= 3 && (
                  <Card className="border-yellow-500 border-2 bg-yellow-50">
                    <CardContent className="py-4">
                      <div className="flex items-center gap-3 text-yellow-700">
                        <Clock className="w-6 h-6" />
                        <div>
                          <p className="font-bold">¡Pago Próximo!</p>
                          <p className="text-sm">Tu próximo pago vence en {daysUntilPayment} días ({format(new Date(plan.nextPaymentDate), "d 'de' MMMM", { locale: es })}).</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                <Card className={isBlocked ? "border-red-500 border-2" : "border-[#ff6700] border-2"}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2">
                        <Smartphone className="h-5 w-5 text-[#ff6700]" />
                        {device.brand} {device.model}
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        {isBlocked ? (
                          <Badge variant="destructive" className="flex items-center gap-1">
                            <ShieldAlert className="w-3 h-3" />
                            Bloqueado
                          </Badge>
                        ) : (
                          <Badge className="bg-green-500 flex items-center gap-1">
                            <Shield className="w-3 h-3" />
                            Activo
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
                      <div className="p-4 bg-gray-50 rounded-lg">
                        <p className="text-sm text-gray-600 flex items-center gap-2">
                          <Info className="w-4 h-4" /> IMEI
                        </p>
                        <p className="font-mono font-medium">{device.imei}</p>
                      </div>
                      <div className="p-4 bg-gray-50 rounded-lg">
                        <p className="text-sm text-gray-600 flex items-center gap-2">
                          <Smartphone className="w-4 h-4" /> Teléfono
                        </p>
                        <p className="font-medium">{device.phoneNumber}</p>
                      </div>
                      {device.batteryLevel !== null && (
                        <div className="p-4 bg-gray-50 rounded-lg">
                          <p className="text-sm text-gray-600 flex items-center gap-2">
                            <Battery className="w-4 h-4" /> Batería
                          </p>
                          <p className={`font-medium ${device.batteryLevel < 20 ? 'text-red-600' : ''}`}>
                            {device.batteryLevel}%
                          </p>
                        </div>
                      )}
                      <div className="p-4 bg-gray-50 rounded-lg">
                        <p className="text-sm text-gray-600 flex items-center gap-2">
                          <Clock className="w-4 h-4" /> Última Sincronización
                        </p>
                        <p className="font-medium text-sm">
                          {device.lastSync ? format(new Date(device.lastSync), "d MMM, HH:mm", { locale: es }) : 'N/A'}
                        </p>
                      </div>
                    </div>

                    {plan && (
                      <div className="border-t pt-6">
                        <div className="flex items-center gap-2 mb-4">
                          <DollarSign className="h-5 w-5 text-[#ff6700]" />
                          <h3 className="text-lg font-semibold">Estado del Plan de Pagos</h3>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                          <div className="text-center p-4 bg-gray-50 rounded-lg">
                            <p className="text-sm text-gray-600 mb-1">Total</p>
                            <p className="text-xl font-bold">{formatCurrency(plan.totalAmount)}</p>
                          </div>
                          <div className="text-center p-4 bg-green-50 rounded-lg">
                            <p className="text-sm text-gray-600 mb-1">Pagado</p>
                            <p className="text-xl font-bold text-green-600">{formatCurrency(plan.paidAmount)}</p>
                          </div>
                          <div className="text-center p-4 bg-orange-50 rounded-lg">
                            <p className="text-sm text-gray-600 mb-1">Restante</p>
                            <p className="text-xl font-bold text-[#ff6700]">{formatCurrency(plan.remainingAmount)}</p>
                          </div>
                          <div className="text-center p-4 bg-blue-50 rounded-lg">
                            <p className="text-sm text-gray-600 mb-1">Progreso</p>
                            <p className="text-xl font-bold text-blue-600">{progress.toFixed(0)}%</p>
                          </div>
                        </div>

                        <div className="mb-6">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm text-gray-600">Progreso del Plan</span>
                            <span className="text-sm font-medium">
                              {plan.completedPayments} de {plan.totalPayments} pagos ({formatCurrency(plan.paymentAmount)} c/u)
                            </span>
                          </div>
                          <Progress value={progress} className="h-4 bg-gray-200" />
                        </div>

                        <div className="grid md:grid-cols-3 gap-4">
                          <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg">
                            <Calendar className="h-5 w-5 text-[#ff6700] mt-0.5" />
                            <div>
                              <p className="text-sm text-gray-600 mb-1">Próximo Pago</p>
                              <p className="font-medium">
                                {plan.status === 'completed'
                                  ? '✅ Plan Completado'
                                  : format(new Date(plan.nextPaymentDate), "d 'de' MMMM", { locale: es })}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg">
                            <Clock className="h-5 w-5 text-blue-600 mt-0.5" />
                            <div>
                              <p className="text-sm text-gray-600 mb-1">Frecuencia</p>
                              <p className="font-medium">
                                {plan.paymentFrequency === 'monthly' ? 'Mensual' :
                                 plan.paymentFrequency === 'biweekly' ? 'Quincenal' : 'Semanal'}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg">
                            <DollarSign className="h-5 w-5 text-green-600 mt-0.5" />
                            <div>
                              <p className="text-sm text-gray-600 mb-1">Monto por Pago</p>
                              <p className="font-medium">{formatCurrency(plan.paymentAmount)}</p>
                            </div>
                          </div>
                        </div>

                        <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
                          <div className="flex items-start gap-3">
                            <CreditCard className="h-5 w-5 text-blue-600 mt-0.5" />
                            <div>
                              <p className="font-medium text-blue-900">Métodos de Pago Disponibles</p>
                              <p className="text-sm text-blue-700 mt-1">
                                Efectivo • Transferencia • Pago Móvil
                              </p>
                              <p className="text-sm text-blue-700 mt-2">
                                Contacta con Xiaomi Cartagena para realizar tu pago. WhatsApp: +57 302 287 5280
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {!plan && !isBlocked && (
                      <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                        <div className="flex items-center gap-2 text-gray-600">
                          <Info className="w-5 h-5" />
                          <p>No hay plan de pagos asociado a este dispositivo. Contáctanos para más información.</p>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {device.history && device.history.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Clock className="h-5 w-5" />
                        Historial Reciente
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {device.history.slice(0, 5).map((entry: any, index: number) => (
                          <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                            <div>
                              <p className="font-medium capitalize">{entry.action.replace('_', ' ')}</p>
                              <p className="text-sm text-gray-500">{entry.deviceInfo}</p>
                            </div>
                            <p className="text-sm text-gray-500">
                              {format(new Date(entry.timestamp), "d MMM, HH:mm", { locale: es })}
                            </p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            );
          })
        )}

        <Card className="mt-8">
          <CardContent className="py-6">
            <div className="text-center">
              <p className="text-gray-600 mb-2">¿Necesitas ayuda?</p>
              <div className="flex justify-center gap-4">
                <Button variant="outline" asChild>
                  <a href="https://wa.me/573022875280" target="_blank" rel="noopener noreferrer">
                    WhatsApp: +57 302 287 5280
                  </a>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
