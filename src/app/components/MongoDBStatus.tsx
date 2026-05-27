import { Database, Wifi, WifiOff } from 'lucide-react';
import { Alert, AlertDescription } from './ui/alert';
import { Badge } from './ui/badge';
import { useDeviceStore } from '../lib/blocking/store';
import { useAuthStore } from '../lib/blocking/auth-store';

export function MongoDBStatus() {
  const isUsingMockData = useDeviceStore((state) => state.isUsingMockData);
  const isUsingMockAuth = useAuthStore((state) => state.isUsingMockAuth);
  
  const isFullyConnected = !isUsingMockData && !isUsingMockAuth;
  const isPartiallyConnected = isUsingMockAuth !== isUsingMockData;
  const isDisconnected = isUsingMockData && isUsingMockAuth;

  if (isFullyConnected) {
    return (
      <Alert className="border border-green-200 bg-green-50">
        <Wifi className="h-5 w-5 text-green-600" />
        <AlertDescription className="text-green-800">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-medium">Conectado a MongoDB Atlas</span>
              <p className="text-xs mt-1 text-green-700">Todos los datos se están sincronizando con la base de datos</p>
            </div>
            <Badge variant="default" className="bg-green-600 border-0">
              <Database className="h-3 w-3 mr-1" />
              Online
            </Badge>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  if (isPartiallyConnected) {
    return (
      <Alert className="border border-yellow-200 bg-yellow-50">
        <Wifi className="h-5 w-5 text-yellow-600" />
        <AlertDescription className="text-yellow-800">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-medium">Conexión parcial</span>
              <p className="text-xs mt-1 text-yellow-700">
                {isUsingMockAuth ? 'Auth: Local' : 'Auth: MongoDB'} • 
                {isUsingMockData ? ' Data: Local' : ' Data: MongoDB'}
              </p>
            </div>
            <Badge variant="secondary" className="bg-yellow-600 text-white border-0">
              <Database className="h-3 w-3 mr-1" />
              Híbrido
            </Badge>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert className="border border-gray-300 bg-gray-50">
      <WifiOff className="h-5 w-5 text-gray-600" />
      <AlertDescription className="text-gray-800">
        <div className="flex items-center justify-between">
          <div>
            <span className="font-medium">Modo local (Mock Data)</span>
            <p className="text-xs mt-1 text-gray-600">
              Backend no disponible. Usando datos de demostración. Los cambios no se persistirán.
            </p>
          </div>
          <Badge variant="secondary" className="bg-gray-600 text-white border-0">
            <Database className="h-3 w-3 mr-1" />
            Local
          </Badge>
        </div>
      </AlertDescription>
    </Alert>
  );
}
