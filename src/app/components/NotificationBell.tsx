import { useEffect, useState } from 'react';
import { Bell, CheckCircle2, X } from 'lucide-react';
import { useProducts } from './ProductContext';

interface Notification {
  id: string;
  message: string;
  total: number;
  timestamp: number;
}

export function NotificationBell() {
  const { unreadOrdersCount } = useProducts();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);

  useEffect(() => {
    // Verificar nuevas notificaciones cada 2 segundos
    const interval = setInterval(() => {
      const stored = localStorage.getItem('xiaomi-notifications');
      if (stored) {
        const parsed = JSON.parse(stored);
        setNotifications(parsed);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const clearNotifications = () => {
    localStorage.setItem('xiaomi-notifications', JSON.stringify([]));
    setNotifications([]);
    setShowNotifications(false);
  };

  const removeNotification = (id: string) => {
    const updated = notifications.filter(n => n.id !== id);
    localStorage.setItem('xiaomi-notifications', JSON.stringify(updated));
    setNotifications(updated);
  };

  return (
    <div className="relative">
      {/* 44px de área táctil (antes 36px) y el globo algo más grande: con 16px
          se recortaba el número en cuanto había diez notificaciones o más. */}
      <button
        onClick={() => setShowNotifications(!showNotifications)}
        aria-label={`Notificaciones${notifications.length > 0 ? ` (${notifications.length} sin leer)` : ''}`}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-lg text-gray-700 transition-colors hover:text-black"
      >
        <Bell className="w-5 h-5" />
        {notifications.length > 0 && (
          <span className="absolute right-1 top-1 flex h-5 min-w-5 animate-pulse items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white">
            {notifications.length}
          </span>
        )}
      </button>

      {showNotifications && (
        <>
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setShowNotifications(false)}
          />
          {/* El ancho fijo de 320px no deja margen en una pantalla de 360px:
              el panel quedaba pegado a los dos bordes. Con `min()` se encoge
              solo en el móvil y conserva los 320px en pantallas grandes. */}
          <div className="absolute right-0 top-12 z-50 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-2xl">
            <div className="bg-orange-500 text-white px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4" />
                <span className="font-semibold">Notificaciones</span>
              </div>
              {notifications.length > 0 && (
                <button
                  onClick={clearNotifications}
                  className="text-xs hover:underline"
                >
                  Limpiar todo
                </button>
              )}
            </div>

            <div className="max-h-96 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="p-8 text-center">
                  <Bell className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500">No hay notificaciones</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {notifications.map((notification) => (
                    <div
                      key={notification.id}
                      className="p-4 hover:bg-gray-50 transition-colors relative group"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                          <CheckCircle2 className="w-4 h-4 text-green-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800 font-medium">
                            {notification.message}
                          </p>
                          <p className="text-sm text-gray-600 mt-1">
                            Total: ${notification.total.toLocaleString('es-CO')} COP
                          </p>
                          <p className="text-xs text-gray-400 mt-1">
                            {new Date(notification.timestamp).toLocaleString('es-ES')}
                          </p>
                        </div>
                        {/* Estaba en `opacity-0 group-hover:opacity-100`: en una
                            pantalla táctil no hay hover, así que el botón de
                            descartar era invisible y no había forma de quitar una
                            notificación de una en una. En el móvil se ve siempre
                            (y con 44px de área); de sm hacia arriba se mantiene el
                            comportamiento de aparecer al pasar el ratón. */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeNotification(notification.id);
                          }}
                          aria-label="Descartar notificación"
                          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded transition-opacity hover:bg-gray-200 sm:h-auto sm:w-auto sm:p-1 sm:opacity-0 sm:group-hover:opacity-100"
                        >
                          <X className="w-4 h-4 text-gray-500" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
