import { useState } from 'react';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Plus } from 'lucide-react';
import { useDeviceStore } from '../lib/blocking/store';
import { toast } from 'sonner';

const VACIO = { imei: '', brand: '', model: '', phoneNumber: '', owner: '', financingId: '' };

/**
 * Este alta es la excepción, no el camino normal: los equipos entran por
 * "Sincronizar cartera" desde el financiamiento, que es donde viven las cuotas.
 *
 * Por eso aquí ya no hay formulario de plan de pagos ni creación de cuenta de
 * cliente: el servidor no acepta esos campos y lo que se escribiera se perdía
 * en silencio. Un alta manual con "4 pagos mensuales" tecleados a mano, además,
 * habría dejado al automatismo decidiendo bloqueos sobre cuotas que no existen
 * en la cartera real.
 */
export function AddDeviceDialog() {
  const [open, setOpen] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [datos, setDatos] = useState(VACIO);
  const addDevice = useDeviceStore((s) => s.addDevice);

  const cerrar = () => {
    setOpen(false);
    setDatos(VACIO);
  };

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const imei = datos.imei.trim();

    // Se valida aquí además del servidor porque el error más común es teclear
    // 14 o 16 dígitos, y vale más atraparlo antes de ir a la API.
    if (!/^\d{15}$/.test(imei)) {
      toast.error('El IMEI debe tener exactamente 15 dígitos.');
      return;
    }
    if (!datos.owner.trim()) {
      toast.error('El nombre del propietario es obligatorio.');
      return;
    }

    setGuardando(true);
    const r = await addDevice({
      imei,
      owner: datos.owner.trim(),
      phoneNumber: datos.phoneNumber.trim(),
      brand: datos.brand.trim(),
      model: datos.model.trim(),
      financingId: datos.financingId.trim() || null,
    });
    setGuardando(false);

    if (!r.ok) {
      toast.error(r.mensaje, { duration: 8000 });
      return;
    }
    toast.success(r.mensaje);
    cerrar();
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} className="gap-2">
        <Plus className="h-4 w-4" />
        Agregar equipo
      </Button>

      <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : cerrar())}>
        <DialogContent className="max-h-[90vh] max-w-full overflow-y-auto sm:max-w-[560px]">
          <form onSubmit={enviar}>
            <DialogHeader>
              <DialogTitle>Agregar equipo</DialogTitle>
              <DialogDescription>
                Al guardar se le pregunta al proveedor si el IMEI está enrolado, para saber si
                se puede operar desde aquí o hay que gestionarlo a mano.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="imei">IMEI *</Label>
                <Input
                  id="imei"
                  inputMode="numeric"
                  placeholder="356789012345678"
                  value={datos.imei}
                  onChange={(e) =>
                    setDatos({ ...datos, imei: e.target.value.replace(/\D/g, '') })
                  }
                  maxLength={15}
                />
                <p className="text-xs text-gray-500">15 dígitos, tal como salen en *#06#.</p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="owner">Propietario *</Label>
                <Input
                  id="owner"
                  placeholder="Nombre completo"
                  value={datos.owner}
                  onChange={(e) => setDatos({ ...datos, owner: e.target.value })}
                />
              </div>

              {/* En el móvil, a dos columnas estos campos se quedaban en ~140px:
                  ni el modelo completo ni la etiqueta cabían en una línea. */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="brand">Marca</Label>
                  <Input
                    id="brand"
                    placeholder="Xiaomi"
                    value={datos.brand}
                    onChange={(e) => setDatos({ ...datos, brand: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="model">Modelo</Label>
                  <Input
                    id="model"
                    placeholder="Redmi Note 13"
                    value={datos.model}
                    onChange={(e) => setDatos({ ...datos, model: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="phoneNumber">Número de contacto</Label>
                <Input
                  id="phoneNumber"
                  type="tel"
                  placeholder="3001234567"
                  value={datos.phoneNumber}
                  onChange={(e) => setDatos({ ...datos, phoneNumber: e.target.value })}
                />
                <p className="text-xs text-gray-500">
                  A este número llegan los avisos de bloqueo y desbloqueo por WhatsApp.
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="financingId">ID del financiamiento (opcional)</Label>
                <Input
                  id="financingId"
                  placeholder="Déjalo vacío si no hay crédito asociado"
                  value={datos.financingId}
                  onChange={(e) => setDatos({ ...datos, financingId: e.target.value })}
                />
                <p className="text-xs text-gray-500">
                  Sin él, el equipo no tiene cuotas y el automatismo de mora lo ignora.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={cerrar}>
                Cancelar
              </Button>
              <Button type="submit" disabled={guardando}>
                {guardando ? 'Verificando...' : 'Agregar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
