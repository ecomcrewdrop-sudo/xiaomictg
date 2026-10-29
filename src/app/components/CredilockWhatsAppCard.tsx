/**
 * Tarjeta de conexión del WhatsApp de CREDILOCK.
 *
 * POR QUÉ EXISTE: los recordatorios de cuotas y los avisos de mora salen por un
 * número DISTINTO al de la tienda (decisión del dueño: aislar la cobranza del
 * número comercial). Ese segundo número necesita su propio emparejamiento, así que
 * aquí va su propio QR.
 *
 * Es un componente aparte y no un trozo de WhatsAppPanel porque vive en la pestaña
 * de Financiamiento: quien gestiona los cobros es quien tiene que ver si el canal
 * está vivo, sin pasar por la pestaña de la tienda.
 *
 * NOTA DE DISEÑO — por qué grita cuando está caído: la sesión de CREDILOCK se cayó
 * el 2026-07-26 y nadie se enteró en DOS MESES, porque un WhatsApp de cobranza
 * desconectado no da ninguna señal visible (a diferencia del de la tienda, donde
 * enseguida se nota que no salen las confirmaciones de pedido). Por eso:
 *   - conectado  → tira compacta, discreta, no molesta.
 *   - cualquier otro estado → bloque rojo grande avisando de que los avisos están
 *     PAUSADOS, imposible de pasar por alto al abrir la pestaña.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import {
  MessageCircle,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Unplug,
} from 'lucide-react';
import { Button } from './ui/button';
import { io as socketIO } from 'socket.io-client';
import { API_BASE_URL, API_ORIGIN, getAdminToken } from '../lib/api-base';

type WAStatus = 'loading' | 'disconnected' | 'qr_ready' | 'connected';

/** '573022875280' → '+57 302 287 5280', para que se lea de un vistazo. */
function formatearNumero(numero: string | null): string {
  if (!numero) return '';
  const m = /^57(\d{3})(\d{3})(\d{4})$/.exec(numero);
  return m ? `+57 ${m[1]} ${m[2]} ${m[3]}` : `+${numero}`;
}

export function CredilockWhatsAppCard() {
  const [status, setStatus] = useState<WAStatus>('loading');
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [numero, setNumero] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  /** Explicación de por qué se cortó el intento (QR caducado, rechazo de WhatsApp...). */
  const [aviso, setAviso] = useState<string | null>(null);

  /**
   * El sondeo HTTP necesita saber el estado actual, pero si lo metemos como
   * dependencia del useEffect el socket se destruye y se recrea en CADA cambio de
   * estado. Con una ref el efecto se monta UNA vez y el intervalo lee el valor
   * fresco. (El WhatsAppPanel de la tienda sí tiene ese problema.)
   */
  const estadoRef = useRef<{ status: WAStatus; connecting: boolean }>({ status: 'loading', connecting: false });
  estadoRef.current = { status, connecting: isConnecting };

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/credilock/status`);
      const data = await res.json();
      setStatus(data.status || 'disconnected');
      setNumero(data.numero || null);
      if (data.qr) setQrImage(data.qr);
    } catch {
      setStatus('disconnected');
    }
  }, []);

  useEffect(() => {
    fetchStatus();

    // El token va en el handshake: por este socket viaja el QR de WhatsApp y
    // quien lo escanee se queda con la sesión del número de CREDILOCK.
    const socket = socketIO(API_ORIGIN || '/', {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      auth: { token: getAdminToken() || '' },
    });

    // Eventos propios de CREDILOCK: si compartiera 'whatsapp-qr' con la tienda,
    // escanear aquí emparejaría el número equivocado.
    socket.on('credilock-qr', (data: { qr: string }) => {
      setQrImage(data.qr);
      setStatus('qr_ready');
      setIsConnecting(false);
    });

    socket.on('credilock-status', (data: { status: string; numero?: string | null; error?: string }) => {
      const s = data.status as WAStatus;
      setStatus(s);
      if (s === 'connected') {
        setQrImage(null);
        setIsConnecting(false);
        setNumero(data.numero || null);
        setAviso(null);
        toast.success('✅ WhatsApp de CREDILOCK conectado');
      }
      if (s === 'disconnected') {
        setQrImage(null);
        setIsConnecting(false);
        setNumero(null);
        // Sin esto el QR simplemente desaparecería y parecería una avería.
        if (data.error === 'qr_sin_escanear') {
          setAviso('El QR caducó porque no se escaneó a tiempo. Pulsa Conectar para generar uno nuevo.');
          toast.warning('El QR de CREDILOCK caducó sin escanearse');
        } else if (data.error?.startsWith('blocked_')) {
          setAviso(`WhatsApp rechazó la conexión (${data.error.replace('blocked_', 'código ')}). ` +
            'Vuelve a intentarlo en unos minutos; si sigue igual, avisa al desarrollador.');
        }
      }
    });

    // Respaldo por HTTP, por si los WebSockets están bloqueados por red/proxy.
    const interval = setInterval(() => {
      const { status: s, connecting } = estadoRef.current;
      if (s === 'loading' || s === 'qr_ready' || connecting) fetchStatus();
    }, 3500);

    return () => {
      socket.disconnect();
      clearInterval(interval);
    };
  }, [fetchStatus]);

  const handleConnect = async () => {
    setIsConnecting(true);
    setQrImage(null);
    setAviso(null);
    try {
      const res = await fetch(`${API_BASE_URL}/credilock/connect`, { method: 'POST' });
      const data = await res.json();
      setStatus(data.status || 'loading');
      if (data.numero) setNumero(data.numero);
      if (data.status === 'connected') {
        setIsConnecting(false);
      } else {
        if (data.qr) setQrImage(data.qr);
        setTimeout(fetchStatus, 1500);
      }
    } catch {
      toast.error('Error al iniciar el WhatsApp de CREDILOCK. Verifica que el servidor esté activo.');
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm(
      '¿Desconectar el WhatsApp de CREDILOCK?\n\n' +
      'Los recordatorios de cuotas y los avisos de mora DEJARÁN de enviarse hasta ' +
      'que vuelvas a escanear el QR.'
    )) return;
    setIsDisconnecting(true);
    try {
      await fetch(`${API_BASE_URL}/credilock/disconnect`, { method: 'POST' });
      setStatus('disconnected');
      setQrImage(null);
      setNumero(null);
      toast.success('WhatsApp de CREDILOCK desconectado');
    } catch {
      toast.error('Error al desconectar');
    } finally {
      setIsDisconnecting(false);
    }
  };

  // ── CONECTADO: tira compacta y discreta ──────────────────────────────
  if (status === 'connected') {
    return (
      <div className="flex items-center gap-3 mb-4 px-3 sm:px-4 py-3 bg-green-50 border border-green-200 rounded-xl">
        <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-bold text-green-900 break-words">
            Recordatorios activos
            {numero && <span className="font-mono font-normal"> · {formatearNumero(numero)}</span>}
          </p>
          <p className="text-xs text-green-700">
            Los avisos de cuotas salen por este número, no por el de la tienda.
          </p>
        </div>
        <Button
          onClick={handleDisconnect}
          disabled={isDisconnecting}
          variant="outline"
          size="sm"
          aria-label="Desconectar el WhatsApp de CREDILOCK"
          className="ml-auto shrink-0 text-red-600 border-red-200 hover:bg-red-50 hover:border-red-400"
        >
          {isDisconnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unplug className="w-4 h-4" />}
          <span className="ml-2 hidden sm:inline">Desconectar</span>
        </Button>
      </div>
    );
  }

  // ── CARGANDO ─────────────────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <div className="flex items-center gap-3 mb-4 px-3 sm:px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-500">
        <Loader2 className="w-5 h-5 animate-spin shrink-0" />
        <p className="text-sm font-medium min-w-0">Verificando el WhatsApp de CREDILOCK...</p>
      </div>
    );
  }

  // ── DESCONECTADO o ESPERANDO QR: bloque de alerta imposible de ignorar ──
  return (
    <div className="mb-4 bg-white border-2 border-red-300 rounded-2xl overflow-hidden shadow-sm">
      <div className="px-4 sm:px-5 py-3 bg-red-50 border-b border-red-200 flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
        <div className="min-w-0">
          <h3 className="font-bold text-red-900 text-sm">Recordatorios PAUSADOS</h3>
          <p className="text-xs text-red-700">
            El WhatsApp de CREDILOCK no está conectado. No se está enviando ningún aviso de cuota ni de mora.
          </p>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        {status === 'disconnected' && (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            {aviso && (
              <p className="w-full max-w-md text-sm font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
                {aviso}
              </p>
            )}
            <p className="w-full max-w-md text-sm text-gray-600">
              CREDILOCK usa un número de WhatsApp <strong>distinto al de la tienda</strong>. Pulsa
              el botón y escanea el QR <strong>con el teléfono de cobranza</strong>.
            </p>
            {/* El Button base trae `whitespace-nowrap`: con esta etiqueta tan larga se
                salía de la tarjeta a 360px. A ancho completo y permitiendo salto cabe. */}
            <Button
              onClick={handleConnect}
              disabled={isConnecting}
              className="w-full sm:w-auto whitespace-normal bg-[#25D366] hover:bg-[#1ebe5d] text-white px-4 sm:px-6 py-3 h-auto font-bold rounded-xl shadow-lg shadow-green-200"
            >
              {isConnecting ? (
                <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Generando QR...</>
              ) : (
                <><MessageCircle className="w-5 h-5 mr-2" /> Conectar WhatsApp de CREDILOCK</>
              )}
            </Button>
          </div>
        )}

        {status === 'qr_ready' && (
          <div className="flex flex-col items-center gap-4">
            <div className="w-full text-center">
              <p className="font-bold text-gray-800 mb-1">Escanea con el teléfono de cobranza</p>
              <p className="text-xs text-gray-500 max-w-md mx-auto">
                WhatsApp → tres puntos (⋮) → <strong>Dispositivos vinculados</strong> → <strong>Vincular un dispositivo</strong>
              </p>
              {/* El error más fácil de cometer aquí es escanear con el teléfono de la
                  tienda y acabar con los dos canales en el mismo número. */}
              <p className="text-xs font-semibold text-red-600 mt-2">
                ⚠️ No uses el teléfono de la tienda: este QR es para el número de cobranza.
              </p>
            </div>

            {qrImage ? (
              <div className="max-w-full p-2 sm:p-3 bg-white border-4 border-[#25D366] rounded-2xl shadow-xl shadow-green-100">
                {/* max-w-full + h-auto: el QR viene a tamaño fijo y con el marco y el
                    relleno de la tarjeta no cabía en 360px, así que desplazaba la
                    página entera de lado. Aquí se encoge y mantiene el cuadrado. */}
                <img
                  src={qrImage}
                  alt="QR de WhatsApp para CREDILOCK"
                  className="w-56 max-w-full h-auto rounded-xl"
                />
              </div>
            ) : (
              <div className="w-64 max-w-full aspect-square bg-gray-100 rounded-2xl border-2 border-dashed border-gray-300 flex items-center justify-center">
                <Loader2 className="w-10 h-10 text-gray-400 animate-spin" />
              </div>
            )}

            <div className="flex flex-wrap justify-center gap-3">
              <button
                onClick={handleConnect}
                disabled={isConnecting}
                className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg px-4 py-2 transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${isConnecting ? 'animate-spin' : ''}`} />
                Regenerar QR
              </button>
              <button
                onClick={() => { setStatus('disconnected'); setQrImage(null); }}
                className="flex items-center gap-2 text-sm text-red-500 hover:text-red-700 border border-red-100 rounded-lg px-4 py-2 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default CredilockWhatsAppCard;
