import { useState } from 'react';
import { Link } from 'react-router';
import { Card, CardContent, CardFooter, CardHeader } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { 
  Smartphone, 
  User, 
  Phone, 
  Shield, 
  ShieldAlert,
  MoreVertical,
  Eye,
  Trash2
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Device } from '../lib/blocking/types';
import { useDeviceStore } from '../lib/blocking/store';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface DeviceCardProps {
  device: Device;
}

export function DeviceCard({ device }: DeviceCardProps) {
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [unblockDialogOpen, setUnblockDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [kioskDialogOpen, setKioskDialogOpen] = useState(false);
  const [allowedApps, setAllowedApps] = useState('com.payment.app');
  
  const { blockDevice, unblockDevice, deleteDevice, enableKioskMode, disableKioskMode } = useDeviceStore();

  const handleBlock = () => {
    if (!reason.trim()) {
      toast.error('Por favor, ingresa un motivo de bloqueo');
      return;
    }
    blockDevice(device.id, reason);
    toast.success(`Dispositivo ${device.model} bloqueado`);
    setBlockDialogOpen(false);
    setReason('');
  };

  const handleUnblock = () => {
    unblockDevice(device.id);
    toast.success(`Dispositivo ${device.model} desbloqueado`);
    setUnblockDialogOpen(false);
  };

  const handleDelete = () => {
    deleteDevice(device.id);
    toast.success(`Dispositivo eliminado`);
    setDeleteDialogOpen(false);
  };

  const handleEnableKiosk = () => {
    if (!allowedApps.trim()) {
      toast.error('Por favor, ingresa al menos una aplicación');
      return;
    }
    const apps = allowedApps.split(',').map((app) => app.trim());
    enableKioskMode(device.id, apps);
    toast.success(`Modo Kiosk activado en ${device.model}`);
    setKioskDialogOpen(false);
    setAllowedApps('com.payment.app');
  };

  const handleDisableKiosk = () => {
    disableKioskMode(device.id);
    toast.success(`Modo Kiosk desactivado en ${device.model}`);
  };

  return (
    <>
      <Card className="hover:shadow-lg transition-shadow">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${
                device.status === 'blocked' 
                  ? 'bg-red-100' 
                  : device.status === 'kiosk'
                  ? 'bg-purple-100'
                  : 'bg-green-100'
              }`}>
                {device.status === 'blocked' ? (
                  <ShieldAlert className="h-5 w-5 text-red-600" />
                ) : device.status === 'kiosk' ? (
                  <Smartphone className="h-5 w-5 text-purple-600" />
                ) : (
                  <Smartphone className="h-5 w-5 text-green-600" />
                )}
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">
                  {device.brand} {device.model}
                </h3>
                <p className="text-sm text-gray-500">IMEI: {device.imei}</p>
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link to={`/admin/blocking/devices/${device.id}`} className="flex items-center gap-2">
                    <Eye className="h-4 w-4" />
                    Ver detalles
                  </Link>
                </DropdownMenuItem>
                {device.status === 'active' ? (
                  <DropdownMenuItem 
                    onClick={() => setBlockDialogOpen(true)}
                    className="text-red-600"
                  >
                    <ShieldAlert className="h-4 w-4" />
                    Bloquear dispositivo
                  </DropdownMenuItem>
                ) : device.status === 'kiosk' ? (
                  <>
                    <DropdownMenuItem 
                      onClick={handleDisableKiosk}
                      className="text-green-600"
                    >
                      <Shield className="h-4 w-4" />
                      Desactivar modo kiosk
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      onClick={() => setBlockDialogOpen(true)}
                      className="text-red-600"
                    >
                      <ShieldAlert className="h-4 w-4" />
                      Bloquear dispositivo
                    </DropdownMenuItem>
                  </>
                ) : (
                  <DropdownMenuItem 
                    onClick={() => setUnblockDialogOpen(true)}
                    className="text-green-600"
                  >
                    <Shield className="h-4 w-4" />
                    Desbloquear dispositivo
                  </DropdownMenuItem>
                )}
                {device.status === 'active' && (
                  <DropdownMenuItem 
                    onClick={() => setKioskDialogOpen(true)}
                  >
                    <Smartphone className="h-4 w-4" />
                    Activar modo kiosk
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem 
                  onClick={() => setDeleteDialogOpen(true)}
                  className="text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                  Eliminar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <User className="h-4 w-4" />
            <span>{device.owner}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Phone className="h-4 w-4" />
            <span>{device.phoneNumber}</span>
          </div>
          {device.reason && (
            <div className="mt-3 p-2 bg-red-50 rounded-md">
              <p className="text-xs font-medium text-red-900">Motivo de bloqueo:</p>
              <p className="text-xs text-red-700 mt-1">{device.reason}</p>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex items-center justify-between border-t pt-3">
          <Badge variant={device.status === 'blocked' ? 'destructive' : device.status === 'kiosk' ? 'secondary' : 'default'}>
            {device.status === 'blocked' ? 'Bloqueado' : device.status === 'kiosk' ? 'Modo Kiosk' : 'Activo'}
          </Badge>
          <span className="text-xs text-gray-500">
            {device.blockedAt 
              ? `Bloqueado ${format(new Date(device.blockedAt), "d 'de' MMM", { locale: es })}`
              : `Registrado ${format(new Date(device.createdAt), "d 'de' MMM", { locale: es })}`
            }
          </span>
        </CardFooter>
      </Card>

      <Dialog open={blockDialogOpen} onOpenChange={setBlockDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bloquear Dispositivo</DialogTitle>
            <DialogDescription>
              Estás a punto de bloquear el dispositivo {device.brand} {device.model}.
              Por favor, ingresa el motivo del bloqueo.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            <Label htmlFor="reason">Motivo del bloqueo *</Label>
            <Textarea
              id="reason"
              placeholder="Ej: Dispositivo reportado como robado, incumplimiento de contrato..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlockDialogOpen(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleBlock}>
              Bloquear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={unblockDialogOpen} onOpenChange={setUnblockDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desbloquear Dispositivo</DialogTitle>
            <DialogDescription>
              ¿Estás seguro de que deseas desbloquear el dispositivo {device.brand} {device.model}?
              Esta acción permitirá que el dispositivo vuelva a estar activo.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnblockDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleUnblock}>
              Desbloquear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar Dispositivo</DialogTitle>
            <DialogDescription>
              ¿Estás seguro de que deseas eliminar este dispositivo? Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={kioskDialogOpen} onOpenChange={setKioskDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Activar Modo Kiosk</DialogTitle>
            <DialogDescription>
              El dispositivo solo podrá acceder a las aplicaciones especificadas y realizar llamadas de emergencia.
              Este modo utiliza Android Device Policy API de Google.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            <Label htmlFor="apps">Aplicaciones Permitidas *</Label>
            <Textarea
              id="apps"
              placeholder="com.payment.app, com.company.app"
              value={allowedApps}
              onChange={(e) => setAllowedApps(e.target.value)}
              rows={3}
            />
            <p className="text-xs text-gray-500">
              Ingresa los nombres de paquete separados por comas. Ejemplo: com.payment.app
            </p>
          </div>
          <div className="p-3 bg-yellow-50 rounded-lg border border-yellow-200">
            <p className="text-xs text-yellow-800">
              <strong>Nota:</strong> Si el usuario cambia el software (ROM) del dispositivo, se perderá el control remoto.
              Asegúrate de que el usuario firme el contrato legal correspondiente.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setKioskDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleEnableKiosk}>
              Activar Modo Kiosk
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
