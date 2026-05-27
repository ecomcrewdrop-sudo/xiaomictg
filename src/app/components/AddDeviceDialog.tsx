import { useState } from 'react';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Plus, User, Mail, DollarSign, CreditCard } from 'lucide-react';
import { useDeviceStore } from '../lib/blocking/store';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

export function AddDeviceDialog() {
  const [open, setOpen] = useState(false);
  const [openPayment, setOpenPayment] = useState(false);
  const addDevice = useDeviceStore((state) => state.addDevice);
  const [clienteInfo, setClienteInfo] = useState<{email: string; password: string} | null>(null);
  
  const [formData, setFormData] = useState({
    imei: '',
    brand: '',
    model: '',
    phoneNumber: '',
    owner: '',
    email: '',
    telefono: '',
  });

  const [paymentPlan, setPaymentPlan] = useState({
    hasPlan: false,
    totalAmount: '',
    totalPayments: '4',
    paymentFrequency: 'monthly',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.imei || !formData.brand || !formData.model || !formData.phoneNumber || !formData.owner) {
      toast.error('Por favor, completa todos los campos');
      return;
    }

    const deviceData: any = { ...formData };
    
    if (paymentPlan.hasPlan && paymentPlan.totalAmount) {
      deviceData.paymentPlan = {
        totalAmount: parseInt(paymentPlan.totalAmount),
        totalPayments: parseInt(paymentPlan.totalPayments),
        paymentFrequency: paymentPlan.paymentFrequency,
        paymentAmount: Math.round(parseInt(paymentPlan.totalAmount) / parseInt(paymentPlan.totalPayments)),
      };
    }

    addDevice(deviceData, (result: any) => {
      if (result?.clientCreated) {
        setClienteInfo({
          email: result.email,
          password: result.clientPassword
        });
        toast.success('Dispositivo y cuenta de cliente creados');
      } else {
        toast.success('Dispositivo agregado exitosamente');
      }
    });
    
    if (!formData.email) {
      setOpen(false);
    }
    setFormData({
      imei: '',
      brand: '',
      model: '',
      phoneNumber: '',
      owner: '',
      email: '',
      telefono: '',
    });
    setPaymentPlan({
      hasPlan: false,
      totalAmount: '',
      totalPayments: '4',
      paymentFrequency: 'monthly',
    });
  };

  const handleClose = () => {
    setOpen(false);
    setClienteInfo(null);
    setFormData({
      imei: '',
      brand: '',
      model: '',
      phoneNumber: '',
      owner: '',
      email: '',
      telefono: '',
    });
    setPaymentPlan({
      hasPlan: false,
      totalAmount: '',
      totalPayments: '4',
      paymentFrequency: 'monthly',
    });
  };

  return (
    <>
      <Button onClick={() => setOpenPayment(true)} className="gap-2 bg-green-600 hover:bg-green-700">
        <Plus className="h-4 w-4" />
        Agregar Dispositivo
      </Button>

      <Dialog open={openPayment} onOpenChange={setOpenPayment}>
        <DialogTrigger asChild>
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            Agregar Dispositivo
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          {clienteInfo ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-green-600 flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Cuenta de Cliente Creada
                </DialogTitle>
              </DialogHeader>
              <div className="py-4 space-y-4">
                <p className="text-gray-600">Se ha creado automáticamente la cuenta del cliente:</p>
                <div className="bg-gray-50 p-4 rounded-lg space-y-2">
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-gray-500" />
                    <span className="font-medium">Email:</span>
                    <span>{clienteInfo.email}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-gray-500" />
                    <span className="font-medium">Password:</span>
                    <span className="font-mono bg-gray-200 px-2 py-0.5 rounded">{clienteInfo.password}</span>
                  </div>
                </div>
                <p className="text-sm text-orange-600">
                  ⚠️ Comparte estas credenciales con el cliente para que pueda acceder a "Mi Cuenta"
                </p>
              </div>
              <DialogFooter>
                <Button onClick={handleClose}>Cerrar</Button>
              </DialogFooter>
            </>
          ) : (
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle>Agregar Nuevo Dispositivo</DialogTitle>
                <DialogDescription>
                  Ingresa la información del teléfono o tableta a registrar.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="imei">IMEI *</Label>
                  <Input
                    id="imei"
                    placeholder="356789012345678"
                    value={formData.imei}
                    onChange={(e) => setFormData({ ...formData, imei: e.target.value })}
                    maxLength={15}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="brand">Marca *</Label>
                    <Input
                      id="brand"
                      placeholder="Xiaomi"
                      value={formData.brand}
                      onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="model">Modelo *</Label>
                    <Input
                      id="model"
                      placeholder="Redmi Note 13"
                      value={formData.model}
                      onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="phoneNumber">Número de Teléfono *</Label>
                  <Input
                    id="phoneNumber"
                    type="tel"
                    placeholder="+573001234567"
                    value={formData.phoneNumber}
                    onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="owner">Propietario *</Label>
                  <Input
                    id="owner"
                    placeholder="Nombre completo"
                    value={formData.owner}
                    onChange={(e) => setFormData({ ...formData, owner: e.target.value })}
                  />
                </div>
                
                <div className="border-t pt-4 mt-2">
                  <div className="flex items-center gap-2 mb-4">
                    <CreditCard className="h-5 w-5 text-[#ff6700]" />
                    <span className="font-semibold">Datos del Cliente (opcional)</span>
                  </div>
                  
                  <div className="grid gap-2">
                    <Label htmlFor="email">Email del Cliente</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="cliente@email.com"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    />
                    <p className="text-xs text-gray-500">Si ingresas email, se creará automáticamente la cuenta del cliente</p>
                  </div>
                  <div className="grid gap-2 mt-2">
                    <Label htmlFor="telefono">Teléfono del Cliente</Label>
                    <Input
                      id="telefono"
                      type="tel"
                      placeholder="+573001234567"
                      value={formData.telefono}
                      onChange={(e) => setFormData({ ...formData, telefono: e.target.value })}
                    />
                  </div>
                </div>

                <div className="border-t pt-4 mt-2">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-5 w-5 text-green-600" />
                      <span className="font-semibold">Plan de Pagos</span>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={paymentPlan.hasPlan}
                        onChange={(e) => setPaymentPlan({ ...paymentPlan, hasPlan: e.target.checked })}
                        className="w-4 h-4"
                      />
                      <span>Agregar plan de pagos</span>
                    </label>
                  </div>
                  
                  {paymentPlan.hasPlan && (
                    <div className="grid gap-3">
                      <div className="grid gap-2">
                        <Label htmlFor="totalAmount">Total del Plan ($)</Label>
                        <Input
                          id="totalAmount"
                          type="number"
                          placeholder="800000"
                          value={paymentPlan.totalAmount}
                          onChange={(e) => setPaymentPlan({ ...paymentPlan, totalAmount: e.target.value })}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label htmlFor="totalPayments">Número de Pagos</Label>
                          <Select 
                            value={paymentPlan.totalPayments} 
                            onValueChange={(value) => setPaymentPlan({ ...paymentPlan, totalPayments: value })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="2">2 pagos</SelectItem>
                              <SelectItem value="4">4 pagos</SelectItem>
                              <SelectItem value="6">6 pagos</SelectItem>
                              <SelectItem value="8">8 pagos</SelectItem>
                              <SelectItem value="12">12 pagos</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="paymentFrequency">Frecuencia</Label>
                          <Select 
                            value={paymentPlan.paymentFrequency} 
                            onValueChange={(value) => setPaymentPlan({ ...paymentPlan, paymentFrequency: value })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="weekly">Semanal</SelectItem>
                              <SelectItem value="biweekly">Quincenal</SelectItem>
                              <SelectItem value="monthly">Mensual</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      {paymentPlan.totalAmount && paymentPlan.totalPayments && (
                        <div className="bg-green-50 p-3 rounded-lg">
                          <p className="text-sm text-green-700">
                            <strong>Monto por pago:</strong> ${Math.round(parseInt(paymentPlan.totalAmount) / parseInt(paymentPlan.totalPayments)).toLocaleString('es-CO')}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={handleClose}>
                  Cancelar
                </Button>
                <Button type="submit">Agregar</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
