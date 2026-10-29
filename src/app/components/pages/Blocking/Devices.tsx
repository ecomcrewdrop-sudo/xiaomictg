import { useState, useMemo, useEffect } from 'react';
import { useDeviceStore } from '../../../lib/blocking/store';
import { DeviceCard } from '../../BlockingDeviceCard';
import { AddDeviceDialog } from '../../AddDeviceDialog';
import { Input } from '../../ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/select';
import { Search } from 'lucide-react';

type FiltroEstado = 'all' | 'active' | 'blocked' | 'divergentes' | 'incomunicados' | 'mora';
type FiltroPlataforma = 'all' | 'trustonic' | 'nuovo' | 'desconocida';

export function Devices() {
  const devices = useDeviceStore((s) => s.devices);
  const isLoading = useDeviceStore((s) => s.isLoading);
  const error = useDeviceStore((s) => s.error);
  const loadFromApi = useDeviceStore((s) => s.loadFromApi);
  const [search, setSearch] = useState('');
  const [estado, setEstado] = useState<FiltroEstado>('all');
  const [plataforma, setPlataforma] = useState<FiltroPlataforma>('all');

  useEffect(() => {
    loadFromApi();
  }, []);

  const filtrados = useMemo(() => {
    const q = search.trim().toLowerCase();
    return devices.filter((d) => {
      const coincideBusqueda =
        !q ||
        d.brand.toLowerCase().includes(q) ||
        d.model.toLowerCase().includes(q) ||
        d.imei.includes(q) ||
        d.owner.toLowerCase().includes(q) ||
        d.phoneNumber.includes(q);

      const coincideEstado =
        estado === 'all'
          ? true
          : estado === 'divergentes'
          ? d.divergente
          : estado === 'incomunicados'
          ? d.incomunicado
          : estado === 'mora'
          ? d.cuotasVencidas > 0
          : d.status === estado;

      const coincidePlataforma = plataforma === 'all' || d.plataforma === plataforma;

      return coincideBusqueda && coincideEstado && coincidePlataforma;
    });
  }, [devices, search, estado, plataforma]);

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:space-y-6 sm:px-6 sm:py-8">
      {/* Apilado en el móvil: el botón de "Agregar Dispositivo" compartiendo
          fila con el título dejaba a los dos en ~170px y el título se partía
          en tres líneas. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold text-gray-900 sm:text-3xl">Equipos</h2>
          <p className="mt-1 text-gray-600">Equipos financiados con bloqueo remoto</p>
        </div>
        <div className="shrink-0">
          <AddDeviceDialog />
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Buscar por marca, modelo, IMEI, propietario o número..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={estado} onValueChange={(v: FiltroEstado) => setEstado(v)}>
          <SelectTrigger className="w-full sm:w-[210px]">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            <SelectItem value="active">Activos</SelectItem>
            <SelectItem value="blocked">Bloqueados</SelectItem>
            <SelectItem value="divergentes">Orden sin confirmar</SelectItem>
            <SelectItem value="incomunicados">Sin reportar (+48 h)</SelectItem>
            <SelectItem value="mora">En mora</SelectItem>
          </SelectContent>
        </Select>
        <Select value={plataforma} onValueChange={(v: FiltroPlataforma) => setPlataforma(v)}>
          <SelectTrigger className="w-full sm:w-[190px]">
            <SelectValue placeholder="Plataforma" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las plataformas</SelectItem>
            <SelectItem value="trustonic">Trustonic (operable)</SelectItem>
            <SelectItem value="nuovo">Nuovo (manual)</SelectItem>
            <SelectItem value="desconocida">Sin verificar</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <p className="mb-4 text-sm text-gray-600">
          {filtrados.length === devices.length
            ? `${devices.length} equipos en total`
            : `${filtrados.length} de ${devices.length} equipos`}
        </p>
        {filtrados.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-gray-500">
              {isLoading
                ? 'Cargando equipos...'
                : devices.length === 0 && !error
                ? 'Todavía no hay equipos. Usa "Sincronizar cartera" en el Dashboard para traerlos del financiamiento.'
                : 'Ningún equipo coincide con los filtros'}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filtrados.map((device) => (
              <DeviceCard key={device.id} device={device} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
