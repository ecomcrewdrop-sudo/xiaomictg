import { Database, Wifi, WifiOff } from 'lucide-react';
import { Alert, AlertDescription } from './ui/alert';
import { Badge } from './ui/badge';
import { useDeviceStore } from '../lib/blocking/store';

/**
 * Antes este aviso leía un flag `isUsingMockData` del store, y decía "Conectado
 * a MongoDB Atlas" simplemente porque el flag estaba en false — sin haber
 * comprobado nada. Ahora se apoya en lo único verificable desde el navegador:
 * si la última carga de equipos trajo datos o falló.
 */
export function MongoDBStatus() {
  const error = useDeviceStore((s) => s.error);
  const isLoading = useDeviceStore((s) => s.isLoading);
  const devices = useDeviceStore((s) => s.devices);

  if (error) {
    return (
      <Alert className="border border-red-200 bg-red-50">
        <WifiOff className="h-5 w-5 text-red-600" />
        <AlertDescription className="text-red-800">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="font-medium">Sin conexión con el servidor</span>
              <p className="mt-1 text-xs text-red-700">{error}</p>
            </div>
            <Badge variant="secondary" className="shrink-0 border-0 bg-red-600 text-white">
              <Database className="mr-1 h-3 w-3" />
              Offline
            </Badge>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  if (isLoading && devices.length === 0) {
    return (
      <Alert className="border border-gray-200 bg-gray-50">
        <Wifi className="h-5 w-5 text-gray-500" />
        <AlertDescription className="text-gray-700">
          <span className="font-medium">Consultando el servidor...</span>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert className="border border-green-200 bg-green-50">
      <Wifi className="h-5 w-5 text-green-600" />
      <AlertDescription className="text-green-800">
        {/* min-w-0 + shrink-0: el texto explicativo y la insignia comparten
            fila, y en el móvil el texto —que es largo— empujaba la insignia
            fuera del aviso en vez de partirse en varias líneas. */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="font-medium">Datos en vivo</span>
            <p className="mt-1 text-xs text-green-700">
              {devices.length} equipos leídos de la base de datos. El estado de bloqueo lo
              confirma el proveedor, no este panel.
            </p>
          </div>
          <Badge variant="default" className="shrink-0 border-0 bg-green-600">
            <Database className="mr-1 h-3 w-3" />
            Online
          </Badge>
        </div>
      </AlertDescription>
    </Alert>
  );
}
