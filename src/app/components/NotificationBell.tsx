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
      <button
        onClick={() => setShowNotifications(!showNotifications)}
        className="relative p-2 text-gray-700 hover:text-black transition-colors"
      >
        <Bell className="w-5 h-5" />
        {notifications.length > 0 && (
          <span className="absolute top-0 right-0 bg-red-500 text-white text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center animate-pulse">
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
          <div className="absolute right-0 top-12 w-80 bg-white rounded-lg shadow-2xl border border-gray-200 z-50 overflow-hidden">
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
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeNotification(notification.id);
                          }}
                          className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-gray-200 rounded"
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
