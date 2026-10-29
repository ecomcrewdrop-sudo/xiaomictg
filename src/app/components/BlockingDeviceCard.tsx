import { useState } from 'react';
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
import { Input } from './ui/input';
import {
  Smartphone,
  User,
  Phone,
  Shield,
  ShieldAlert,
  MoreVertical,
  Trash2,
  BellRing,
  KeyRound,
  Lock,
  RefreshCw,
  WifiOff,
  AlertTriangle,
  HandCoins,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import type { Device } from '../lib/blocking/types';
import { useDeviceStore } from '../lib/blocking/store';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface DeviceCardProps {
  device: Device;
}

/**
 * Traduce la respuesta del servidor a un toast.
 *
 * Siempre muestra el mensaje DEL SERVIDOR, nunca uno inventado aquí. Antes esta
 * tarjeta hacía `blockDevice(...)` sin esperar y acto seguido mostraba
 * "Dispositivo bloqueado" — un toast verde aunque la API hubiera respondido 502
 * o aunque el equipo estuviera en Nuovo y nada hubiera pasado.
 *
 * Las órdenes aceptadas pero sin confirmar se muestran en un tono intermedio:
 * el proveedor aceptó, pero hasta que la reconciliación lo confirme no se puede
 * afirmar que el teléfono esté bloqueado.
 */
function avisar(r: { ok: boolean; mensaje: string; pendienteDeEntrega?: boolean }) {
  if (!r.ok) {
    toast.error(r.mensaje, { duration: 8000 });
    return;
  }
  if (r.pendienteDeEntrega) {
    toast.info(r.mensaje, { duration: 8000 });
    return;
  }
  toast.success(r.mensaje);
}

function horasLegibles(horas: number | null | undefined): string {
  if (horas === null || horas === undefined) return 'nunca ha reportado';
  if (horas < 1) return 'hace minutos';
  if (horas < 24) return `hace ${Math.round(horas)} h`;
  return `hace ${Math.round(horas / 24)} día(s)`;
}

export function DeviceCard({ device }: DeviceCardProps) {
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [unblockDialogOpen, setUnblockDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [notifyDialogOpen, setNotifyDialogOpen] = useState(false);
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [aviso, setAviso] = useState('');
  const [challenge, setChallenge] = useState('');

  const {
    blockDevice,
    unblockDevice,
    deleteDevice,
    notifyDevice,
    pinUnlock,
    hardenDevice,
    releaseDevice,
    refreshDevice,
    accionEnCurso,
  } = useDeviceStore();

  const ocupado = accionEnCurso === device.id;
  const manual = device.gestionManual;

  const handleBlock = async () => {
    if (!reason.trim()) {
      toast.error('El motivo es obligatorio: queda en la bitácora por si el cliente reclama.');
      return;
    }
    const r = await blockDevice(device.id, reason.trim());
    avisar(r);
    if (r.ok) {
      setBlockDialogOpen(false);
      setReason('');
    }
  };

  const handleUnblock = async () => {
    const r = await unblockDevice(device.id);
    avisar(r);
    if (r.ok) setUnblockDialogOpen(false);
  };

  const handleDelete = async () => {
    const r = await deleteDevice(device.id);
    avisar(r);
    if (r.ok) setDeleteDialogOpen(false);
  };

  const handleNotify = async () => {
    if (!aviso.trim()) {
      toast.error('Escribe el texto que verá el cliente en la pantalla.');
      return;
    }
    const r = await notifyDevice(device.id, 'Aviso de CrediLock', aviso.trim());
    avisar(r);
    if (r.ok) {
      setNotifyDialogOpen(false);
      setAviso('');
    }
  };

  const handlePin = async () => {
    if (!challenge.trim()) {
      toast.error('Pídele al cliente el código que le muestra la pantalla del equipo.');
      return;
    }
    const r = await pinUnlock(device.id, challenge.trim());
    avisar(r);
    if (r.ok) setChallenge('');
  };

  const handleHarden = async () => {
    const r = await hardenDevice(device.id);
    avisar(r);
  };

  const handleRelease = async () => {
    const r = await releaseDevice(device.id, 'Financiamiento liquidado');
    avisar(r);
    if (r.ok) setReleaseDialogOpen(false);
  };

  const bloqueado = device.status === 'blocked';

  return (
    <>
      <Card className="hover:shadow-lg transition-shadow">
        {/* Card trae px-6 de serie: en 360px se comía 48px de los 328 disponibles. */}
        <CardHeader className="px-4 pb-3 sm:px-6">
          <div className="flex items-start justify-between gap-2">
            {/* min-w-0 en la cadena flex: sin él el IMEI (15 dígitos seguidos) empuja
                el menú de acciones fuera de la tarjeta en vez de partirse. */}
            <div className="flex min-w-0 items-center gap-3">
              <div
                className={`shrink-0 p-2 rounded-lg ${
                  bloqueado ? 'bg-red-100' : manual ? 'bg-amber-100' : 'bg-green-100'
                }`}
              >
                {bloqueado ? (
                  <ShieldAlert className="h-5 w-5 text-red-600" />
                ) : (
                  <Smartphone className={`h-5 w-5 ${manual ? 'text-amber-600' : 'text-green-600'}`} />
                )}
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-gray-900 break-words">
                  {device.brand || 'Equipo'} {device.model}
                </h3>
                <p className="text-sm text-gray-500 break-all">IMEI: {device.imei}</p>
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Acciones del dispositivo"
                  className="shrink-0"
                  disabled={ocupado}
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => refreshDevice(device.id)}>
                  <RefreshCw className="h-4 w-4" />
                  Consultar estado real
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {bloqueado ? (
                  <>
                    <DropdownMenuItem
                      onClick={() => setUnblockDialogOpen(true)}
                      disabled={manual}
                      className="text-green-600"
                    >
                      <Shield className="h-4 w-4" />
                      Desbloquear
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setPinDialogOpen(true)} disabled={manual}>
                      <KeyRound className="h-4 w-4" />
                      Desbloquear por PIN (sin datos)
                    </DropdownMenuItem>
                  </>
                ) : (
                  <DropdownMenuItem
                    onClick={() => setBlockDialogOpen(true)}
                    disabled={manual}
                    className="text-red-600"
                  >
                    <ShieldAlert className="h-4 w-4" />
                    Bloquear equipo
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => setNotifyDialogOpen(true)} disabled={manual}>
                  <BellRing className="h-4 w-4" />
                  Enviar aviso a la pantalla
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleHarden} disabled={manual}>
                  <Lock className="h-4 w-4" />
                  Blindar (anti reseteo de fábrica)
                </DropdownMenuItem>
                {device.liquidado && (
                  <DropdownMenuItem
                    onClick={() => setReleaseDialogOpen(true)}
                    disabled={manual}
                    className="text-blue-600"
                  >
                    <HandCoins className="h-4 w-4" />
                    Liberar (terminó de pagar)
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setDeleteDialogOpen(true)} className="text-red-600">
                  <Trash2 className="h-4 w-4" />
                  Quitar del panel
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>

        <CardContent className="space-y-2 px-4 sm:px-6">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <User className="h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words">{device.owner}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Phone className="h-4 w-4 shrink-0" />
            <span className="min-w-0 break-all">{device.phoneNumber || 'sin teléfono'}</span>
          </div>

          {device.totalCuotas > 0 && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <HandCoins className="h-4 w-4 shrink-0" />
              <span>
                {device.cuotasPagadas}/{device.totalCuotas} cuotas
                {device.saldo > 0 && ` · saldo $${device.saldo.toLocaleString('es-CO')}`}
              </span>
            </div>
          )}

          {/* Un equipo en Nuovo tiene todos los botones en gris, así que hay que
              decir por qué. Si no, parecería que el panel está roto. */}
          {manual && (
            <div className="mt-3 flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
              <p className="text-xs text-amber-900">
                {device.plataforma === 'nuovo'
                  ? 'Enrolado en Nuovo: esta API no lo alcanza. Hay que bloquearlo a mano desde el portal de Nuovo.'
                  : 'Todavía no sabemos en qué plataforma está. Usa "Consultar estado real".'}
              </p>
            </div>
          )}

          {/* El dato que evita la conversación "pero yo lo bloqueé". */}
          {!manual && device.incomunicado && (
            <div className="mt-3 flex gap-2 rounded-md border border-orange-200 bg-orange-50 p-2">
              <WifiOff className="h-4 w-4 shrink-0 text-orange-600" />
              <p className="text-xs text-orange-900">
                Sin reportar {horasLegibles(device.horasSinReportar)}. Si está apagado o sin datos,
                un bloqueo no le llegará hasta que se conecte.
              </p>
            </div>
          )}

          {device.divergente && (
            <div className="mt-3 flex gap-2 rounded-md border border-blue-200 bg-blue-50 p-2">
              <RefreshCw className="h-4 w-4 shrink-0 text-blue-600" />
              <p className="text-xs text-blue-900">
                Orden de {device.intencion === 'blocked' ? 'bloqueo' : 'desbloqueo'} enviada pero aún
                no confirmada por el proveedor. El panel lo actualizará solo.
              </p>
            </div>
          )}

          {device.ultimoErrorApi && (
            <div className="mt-3 rounded-md bg-red-50 p-2">
              <p className="text-xs font-medium text-red-900">Error del proveedor:</p>
              <p className="mt-1 text-xs text-red-700 break-words">{device.ultimoErrorApi}</p>
            </div>
          )}

          {device.reason && bloqueado && (
            <div className="mt-3 rounded-md bg-red-50 p-2">
              <p className="text-xs font-medium text-red-900">Motivo del bloqueo:</p>
              <p className="mt-1 text-xs text-red-700 break-words">{device.reason}</p>
            </div>
          )}
        </CardContent>

        <CardFooter className="flex flex-wrap items-center justify-between gap-2 border-t px-4 pt-3 sm:px-6">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={bloqueado ? 'destructive' : 'default'}>
              {bloqueado ? 'Bloqueado' : 'Activo'}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {device.plataforma === 'trustonic'
                ? 'Trustonic'
                : device.plataforma === 'nuovo'
                  ? 'Nuovo (manual)'
                  : 'sin resolver'}
            </Badge>
            {device.cuotasVencidas > 0 && (
              <Badge variant="destructive" className="text-xs">
                {device.cuotasVencidas} vencida(s) · {device.diasDeMora}d
              </Badge>
            )}
            {!device.autoBloqueo && (
              <Badge variant="secondary" className="text-xs">
                automatismo off
              </Badge>
            )}
          </div>
          <span className="text-xs text-gray-500">
            {device.lastCheckIn
              ? `Reportó ${horasLegibles(device.horasSinReportar)}`
              : device.blockedAt
                ? `Bloqueado ${format(new Date(device.blockedAt), "d 'de' MMM", { locale: es })}`
                : `Registrado ${format(new Date(device.createdAt), "d 'de' MMM", { locale: es })}`}
          </span>
        </CardFooter>
      </Card>

      <Dialog open={blockDialogOpen} onOpenChange={setBlockDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bloquear equipo</DialogTitle>
            <DialogDescription>
              Vas a bloquear el {device.brand} {device.model} de {device.owner}. El cliente verá en
              pantalla cuánto debe y el teléfono de la tienda.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            <Label htmlFor="reason">Motivo del bloqueo *</Label>
            <Textarea
              id="reason"
              placeholder="Ej: 2 cuotas vencidas, 12 días de mora, no responde a los recordatorios"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
            <p className="text-xs text-gray-500">
              Queda en la bitácora con tu usuario, la fecha y la respuesta del proveedor. Es lo que
              permite responder si el cliente reclama.
            </p>
          </div>
          {device.incomunicado && (
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
              <p className="text-xs text-orange-900">
                Este equipo no reporta {horasLegibles(device.horasSinReportar)}. La orden se aceptará,
                pero el bloqueo sólo entrará cuando el teléfono tenga internet.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlockDialogOpen(false)} disabled={ocupado}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleBlock} disabled={ocupado}>
              {ocupado ? 'Enviando…' : 'Bloquear'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={unblockDialogOpen} onOpenChange={setUnblockDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desbloquear equipo</DialogTitle>
            <DialogDescription>
              Se desbloqueará el {device.brand} {device.model} de {device.owner}.
              {device.cuotasVencidas > 0 &&
                ` Ojo: sigue con ${device.cuotasVencidas} cuota(s) vencida(s), así que el automatismo lo volverá a bloquear si está activo.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnblockDialogOpen(false)} disabled={ocupado}>
              Cancelar
            </Button>
            <Button onClick={handleUnblock} disabled={ocupado}>
              {ocupado ? 'Enviando…' : 'Desbloquear'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={notifyDialogOpen} onOpenChange={setNotifyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aviso en la pantalla del equipo</DialogTitle>
            <DialogDescription>
              Aparece como notificación en el teléfono del cliente, sin bloquearlo. Requiere que el
              equipo tenga internet.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            <Label htmlFor="aviso">Texto del aviso *</Label>
            <Textarea
              id="aviso"
              placeholder="Ej: Tu cuota vence mañana. Paga a tiempo para evitar el bloqueo."
              value={aviso}
              onChange={(e) => setAviso(e.target.value)}
              rows={3}
              maxLength={300}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNotifyDialogOpen(false)} disabled={ocupado}>
              Cancelar
            </Button>
            <Button onClick={handleNotify} disabled={ocupado}>
              {ocupado ? 'Enviando…' : 'Enviar aviso'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pinDialogOpen} onOpenChange={setPinDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desbloqueo por PIN</DialogTitle>
            <DialogDescription>
              Para cuando el cliente pagó pero su equipo no tiene datos y el desbloqueo normal no le
              llega. Pídele el código que le muestra la pantalla del teléfono.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            <Label htmlFor="challenge">Código que muestra el equipo *</Label>
            <Input
              id="challenge"
              placeholder="Ej: 482913"
              value={challenge}
              onChange={(e) => setChallenge(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPinDialogOpen(false)} disabled={ocupado}>
              Cerrar
            </Button>
            <Button onClick={handlePin} disabled={ocupado}>
              {ocupado ? 'Generando…' : 'Generar PIN'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={releaseDialogOpen} onOpenChange={setReleaseDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Liberar equipo del financiamiento</DialogTitle>
            <DialogDescription>
              {device.owner} terminó de pagar. Al liberar, el equipo sale del financiamiento en
              Trustonic.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-xs text-red-900">
              <strong>Esto es irreversible.</strong> Después de liberar, este equipo no se podrá
              volver a bloquear nunca, ni aunque se le financie algo más adelante.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReleaseDialogOpen(false)} disabled={ocupado}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleRelease} disabled={ocupado}>
              {ocupado ? 'Liberando…' : 'Sí, liberar definitivamente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Quitar del panel</DialogTitle>
            <DialogDescription>
              Deja de mostrarse aquí, pero el equipo SIGUE enrolado en el proveedor. No es lo mismo
              que liberarlo.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={ocupado}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={ocupado}>
              Quitar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
