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

export function Devices() {
  const devices = useDeviceStore((state) => state.devices);
  const loadFromApi = useDeviceStore((state) => state.loadFromApi);
  const isUsingMockData = useDeviceStore((state) => state.isUsingMockData);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'blocked'>('all');

  useEffect(() => {
    if (isUsingMockData) {
      loadFromApi();
    }
  }, []);

  const filteredDevices = useMemo(() => {
    return devices.filter((device) => {
      const matchesSearch =
        device.brand.toLowerCase().includes(search.toLowerCase()) ||
        device.model.toLowerCase().includes(search.toLowerCase()) ||
        device.imei.includes(search) ||
        device.owner.toLowerCase().includes(search.toLowerCase()) ||
        device.phoneNumber.includes(search);

      const matchesStatus =
        statusFilter === 'all' || device.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [devices, search, statusFilter]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Dispositivos</h2>
          <p className="text-gray-600 mt-1">
            Gestiona todos los teléfonos y tabletas registrados
          </p>
        </div>
        <AddDeviceDialog />
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Buscar por marca, modelo, IMEI, propietario o número..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={(value: any) => setStatusFilter(value)}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="active">Activos</SelectItem>
            <SelectItem value="blocked">Bloqueados</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <p className="text-sm text-gray-600 mb-4">
          {filteredDevices.length === devices.length
            ? `${devices.length} dispositivos en total`
            : `${filteredDevices.length} de ${devices.length} dispositivos`}
        </p>
        {filteredDevices.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">No se encontraron dispositivos</p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filteredDevices.map((device) => (
              <DeviceCard key={device.id} device={device} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
