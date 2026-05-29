import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import {
  MessageCircle,
  Wifi,
  WifiOff,
  Phone,
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Unplug,
  Copy,
  Eye,
} from 'lucide-react';
import { Button } from './ui/button';
import { io as socketIO, Socket } from 'socket.io-client';
import { API_BASE_URL, API_ORIGIN } from '../lib/api-base';


// --------------- VARIABLES DISPONIBLES ---------------
const VARIABLES = [
  { var: '{{nombre}}', desc: 'Nombre del cliente' },
  { var: '{{ordenNumero}}', desc: 'Número de orden (#XM-...)' },
  { var: '{{productos}}', desc: 'Lista de productos comprados' },
  { var: '{{total}}', desc: 'Total en COP' },
  { var: '{{metodoPago}}', desc: 'Método de pago' },
  { var: '{{metodoEntrega}}', desc: 'Domicilio / Retiro en tienda' },
  { var: '{{linea_direccion}}', desc: 'Dirección de entrega (si aplica)' },
  { var: '{{telefono}}', desc: 'Teléfono del cliente' },
  { var: '{{email}}', desc: 'Email del cliente' },
  { var: '{{cedula}}', desc: 'Cédula del cliente' },
  { var: '{{fecha}}', desc: 'Fecha y hora del pedido' },
];

type WAStatus = 'loading' | 'disconnected' | 'qr_ready' | 'connected';

export function WhatsAppPanel() {
  const [status, setStatus] = useState<WAStatus>('loading');
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [ownerPhone, setOwnerPhone] = useState('');
  const [customerTemplate, setCustomerTemplate] = useState('');
  const [ownerTemplate, setOwnerTemplate] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<'customer' | 'owner'>('customer');
  const [focusedArea, setFocusedArea] = useState<'customer' | 'owner'>('customer');
  const [showPreview, setShowPreview] = useState(false);

  const customerRef = useRef<HTMLTextAreaElement>(null);
  const ownerRef = useRef<HTMLTextAreaElement>(null);
  const socketRef = useRef<Socket | null>(null);

  // --------------- FETCH INICIAL ---------------
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/whatsapp/status`);
      const data = await res.json();
      setStatus(data.status || 'disconnected');
      if (data.qr) setQrImage(data.qr);
    } catch {
      setStatus('disconnected');
    }
  }, []);

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/whatsapp/templates`);
      const data = await res.json();
      setOwnerPhone(data.ownerPhone || '');
      setCustomerTemplate(data.customerTemplate || '');
      setOwnerTemplate(data.ownerTemplate || '');
    } catch {
      toast.error('Error cargando configuración de WhatsApp');
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchTemplates();

    // Conectar Socket.io para actualizaciones en tiempo real
    const socket = socketIO(API_ORIGIN || '/', {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
    });
    socketRef.current = socket;

    socket.on('whatsapp-qr', (data: { qr: string }) => {
      setQrImage(data.qr);
      setStatus('qr_ready');
      setIsConnecting(false);
    });

    socket.on('whatsapp-status', (data: { status: string }) => {
      const s = data.status as WAStatus;
      setStatus(s);
      if (s === 'connected') {
        setQrImage(null);
        setIsConnecting(false);
        toast.success('✅ ¡WhatsApp conectado exitosamente!');
      }
      if (s === 'disconnected') {
        setQrImage(null);
        setIsConnecting(false);
      }
    });

    // POLLING FALLBACK: Sondeo regular por HTTP cada 3.5 segundos si estamos conectando o esperando QR
    // Esto asegura el funcionamiento incluso si Socket.io/WebSockets estan bloqueados por politicas de red.
    const interval = setInterval(() => {
      if (status === 'loading' || status === 'qr_ready' || isConnecting) {
        fetchStatus();
      }
    }, 3500);

    return () => {
      socket.disconnect();
      clearInterval(interval);
    };
  }, [fetchStatus, fetchTemplates, status, isConnecting]);

  // --------------- ACCIONES ---------------
  const handleConnect = async () => {
    setIsConnecting(true);
    setQrImage(null);
    try {
      const res = await fetch(`${API_BASE_URL}/whatsapp/connect`, { method: 'POST' });
      const data = await res.json();
      if (data.status) {
        setStatus(data.status);
      } else {
        setStatus('loading');
      }
      
      if (data.status === 'connected') {
        setIsConnecting(false);
      } else {
        if (data.qr) setQrImage(data.qr);
        // Intentar fetch continuo mientras esta conectando
        setTimeout(fetchStatus, 1500);
      }
    } catch {
      toast.error('Error al iniciar WhatsApp. Verifica que el servidor esté activo.');
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('¿Seguro que quieres desconectar WhatsApp? Tendrás que escanear el QR de nuevo.')) return;
    setIsDisconnecting(true);
    try {
      await fetch(`${API_BASE_URL}/whatsapp/disconnect`, { method: 'POST' });
      setStatus('disconnected');
      setQrImage(null);
      toast.success('WhatsApp desconectado');
    } catch {
      toast.error('Error al desconectar');
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleSave = async () => {
    if (!ownerPhone.trim()) {
      toast.error('Ingresa el número de WhatsApp donde recibirás las notificaciones');
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/whatsapp/templates`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerTemplate, ownerTemplate, ownerPhone }),
      });
      if (!res.ok) throw new Error();
      toast.success('✅ Configuración de WhatsApp guardada');
    } catch {
      toast.error('Error al guardar la configuración');
    } finally {
      setIsSaving(false);
    }
  };

  // Insertar variable en la posición del cursor
  const insertVariable = (variable: string) => {
    const isOwner = focusedArea === 'owner';
    const ref = isOwner ? ownerRef.current : customerRef.current;
    const currentVal = isOwner ? ownerTemplate : customerTemplate;
    const setter = isOwner ? setOwnerTemplate : setCustomerTemplate;

    if (ref) {
      const start = ref.selectionStart ?? currentVal.length;
      const end = ref.selectionEnd ?? currentVal.length;
      const newVal = currentVal.substring(0, start) + variable + currentVal.substring(end);
      setter(newVal);
      setTimeout(() => {
        ref.focus();
        const pos = start + variable.length;
        ref.setSelectionRange(pos, pos);
      }, 10);
    } else {
      setter(prev => prev + variable);
    }
    setActiveTemplate(focusedArea);
  };

  // Previsualización con datos de ejemplo
  const getPreview = (template: string) => {
    const sample: Record<string, string> = {
      '{{nombre}}': 'Carlos Gómez',
      '{{ordenNumero}}': 'XM-20260529-0042',
      '{{productos}}': '  • Xiaomi 13 Pro x1 — $899.000 COP\n  • Xiaomi Buds 4 Pro x1 — $149.000 COP',
      '{{total}}': '1.048.000',
      '{{metodoPago}}': 'Nequi',
      '{{metodoEntrega}}': 'Domicilio 🛵',
      '{{linea_direccion}}': '📍 *Dirección:* Barrio Manga, Cra 24 #17-50\n',
      '{{telefono}}': '302 287 5280',
      '{{email}}': 'carlos@gmail.com',
      '{{cedula}}': '1.043.345.642',
      '{{fecha}}': 'jueves, 29 de mayo de 2026, 2:22 p. m.',
    };
    let result = template;
    for (const [key, val] of Object.entries(sample)) {
      result = result.split(key).join(val);
    }
    return result;
  };

  // --------------- RENDER ESTADOS ---------------
  const statusConfig = {
    loading:      { color: 'bg-gray-400',  label: 'Cargando...',    icon: Loader2 },
    disconnected: { color: 'bg-red-500',   label: 'Desconectado',   icon: WifiOff },
    qr_ready:     { color: 'bg-yellow-400',label: 'Esperando QR',   icon: MessageCircle },
    connected:    { color: 'bg-green-500', label: 'Conectado',      icon: Wifi },
  };
  const sc = statusConfig[status];
  const StatusIcon = sc.icon;

  return (
    <div className="space-y-8 max-w-5xl mx-auto">

      {/* ======== HEADER ======== */}
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-[#25D366] flex items-center justify-center shadow-lg shadow-green-200">
          <MessageCircle className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Notificaciones WhatsApp</h2>
          <p className="text-sm text-gray-500">
            Conecta tu WhatsApp para enviar confirmaciones automáticas a clientes y alertas de venta.
          </p>
        </div>
        {/* Badge de estado */}
        <div className={`ml-auto flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold ${
          status === 'connected' ? 'bg-green-50 text-green-700 border border-green-200' :
          status === 'qr_ready' ? 'bg-yellow-50 text-yellow-700 border border-yellow-200' :
          status === 'loading' ? 'bg-gray-50 text-gray-600 border border-gray-200' :
          'bg-red-50 text-red-700 border border-red-200'
        }`}>
          <span className={`w-2 h-2 rounded-full ${sc.color} ${status === 'loading' ? 'animate-pulse' : ''}`} />
          {sc.label}
        </div>
      </div>

      {/* ======== SECCIÓN CONEXIÓN ======== */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <Wifi className="w-4 h-4 text-[#25D366]" />
            Conexión con WhatsApp
          </h3>
        </div>

        <div className="p-6">
          {/* Estado: Cargando */}
          {status === 'loading' && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500">
              <Loader2 className="w-10 h-10 animate-spin mb-4 text-gray-400" />
              <p className="font-medium">Verificando estado de conexión...</p>
            </div>
          )}

          {/* Estado: Desconectado */}
          {status === 'disconnected' && (
            <div className="flex flex-col items-center justify-center py-10 gap-6">
              <div className="w-24 h-24 rounded-full bg-red-50 border-2 border-red-100 flex items-center justify-center">
                <WifiOff className="w-10 h-10 text-red-400" />
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-gray-800 mb-1">WhatsApp no conectado</p>
                <p className="text-sm text-gray-500 max-w-sm">
                  Haz clic en el botón para iniciar el proceso. Se generará un código QR que debes escanear con tu teléfono.
                </p>
              </div>
              <Button
                onClick={handleConnect}
                disabled={isConnecting}
                className="bg-[#25D366] hover:bg-[#1ebe5d] text-white px-8 py-3 h-auto text-base font-bold rounded-xl shadow-lg shadow-green-200 transition-all"
              >
                {isConnecting ? (
                  <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Iniciando...</>
                ) : (
                  <><MessageCircle className="w-5 h-5 mr-2" /> Conectar WhatsApp</>
                )}
              </Button>
            </div>
          )}

          {/* Estado: Esperando QR */}
          {status === 'qr_ready' && (
            <div className="flex flex-col items-center gap-6 py-4">
              <div className="text-center">
                <p className="text-lg font-bold text-gray-800 mb-1">Escanea el código QR</p>
                <p className="text-sm text-gray-500">
                  Abre WhatsApp → toca los tres puntos (⋮) → <strong>Dispositivos vinculados</strong> → <strong>Vincular un dispositivo</strong>
                </p>
              </div>

              <div className="relative">
                {qrImage ? (
                  <div className="p-3 bg-white border-4 border-[#25D366] rounded-2xl shadow-xl shadow-green-100">
                    <img src={qrImage} alt="WhatsApp QR Code" className="w-64 h-64 rounded-xl" />
                  </div>
                ) : (
                  <div className="w-72 h-72 bg-gray-100 rounded-2xl border-2 border-dashed border-gray-300 flex items-center justify-center">
                    <Loader2 className="w-12 h-12 text-gray-400 animate-spin" />
                  </div>
                )}
                <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-[#25D366] text-white text-xs font-bold px-4 py-1 rounded-full shadow">
                  QR se actualiza automáticamente
                </div>
              </div>

              <div className="flex gap-3 mt-4">
                <button
                  onClick={handleConnect}
                  disabled={isConnecting}
                  className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg px-4 py-2 transition-colors"
                >
                  <RefreshCw className={`w-4 h-4 ${isConnecting ? 'animate-spin' : ''}`} />
                  Regenerar QR
                </button>
                <button
                  onClick={() => setStatus('disconnected')}
                  className="flex items-center gap-2 text-sm text-red-500 hover:text-red-700 border border-red-100 rounded-lg px-4 py-2 transition-colors"
                >
                  <AlertCircle className="w-4 h-4" />
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Estado: Conectado */}
          {status === 'connected' && (
            <div className="flex items-center gap-4 p-4 bg-green-50 border border-green-200 rounded-xl">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-7 h-7 text-green-600" />
              </div>
              <div>
                <p className="font-bold text-green-900">¡WhatsApp conectado y listo!</p>
                <p className="text-sm text-green-700">
                  Las notificaciones automáticas se enviarán a clientes y administradores al procesar pedidos.
                </p>
              </div>
              <Button
                onClick={handleDisconnect}
                disabled={isDisconnecting}
                variant="outline"
                className="ml-auto shrink-0 text-red-600 border-red-200 hover:bg-red-50 hover:border-red-400"
              >
                {isDisconnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unplug className="w-4 h-4" />}
                <span className="ml-2">Desconectar</span>
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* ======== SECCIÓN CONFIGURACIÓN DESTINATARIO ======== */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden transition-all duration-300 hover:shadow-md">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
            <Phone className="w-4 h-4 text-green-600" />
          </div>
          <h3 className="font-bold text-gray-850">
            Receptor de Alertas de Ventas
          </h3>
        </div>
        <div className="p-6">
          <div className="max-w-2xl">
            <label className="block text-sm font-bold text-gray-700 mb-2">
              Número de WhatsApp del Administrador/Dueño
            </label>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-bold border-r border-gray-200 pr-3">+57</span>
                <input
                  type="tel"
                  value={ownerPhone}
                  onChange={e => {
                    const val = e.target.value.replace(/[^0-9\s]/g, '').substring(0, 15);
                    setOwnerPhone(val);
                  }}
                  placeholder="300 123 4567"
                  className="w-full pl-16 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:bg-white focus:border-green-500 focus:ring-4 focus:ring-green-500/10 transition-all font-mono font-bold text-base tracking-wide text-gray-800"
                />
              </div>
              <Button
                onClick={handleSave}
                disabled={isSaving}
                className="bg-gray-900 hover:bg-black text-white px-6 py-3.5 h-auto font-bold rounded-xl transition-all shadow-md active:scale-95 duration-200"
              >
                {isSaving ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Guardando...</>
                ) : (
                  <><Save className="w-4 h-4 mr-2" /> Guardar Receptor</>
                )}
              </Button>
            </div>
            
            {/* Validación visual del número celular */}
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-gray-500 font-medium">
                Ingresa los 10 dígitos del celular sin el código de país. Ej: 3001234567.
              </p>
              {ownerPhone.replace(/\s/g, '').length === 10 ? (
                <span className="flex items-center gap-1.5 text-xs text-green-600 font-bold bg-green-50 px-2.5 py-1 rounded-lg border border-green-200 animate-fade-in">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Número Válido (10 dígitos)
                </span>
              ) : ownerPhone.replace(/\s/g, '').length > 0 ? (
                <span className="flex items-center gap-1.5 text-xs text-amber-600 font-bold bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200">
                  <AlertCircle className="w-3.5 h-3.5" /> Dígitos incompletos ({ownerPhone.replace(/\s/g, '').length}/10)
                </span>
              ) : (
                <span className="text-xs text-red-500 font-bold bg-red-50 px-2.5 py-1 rounded-lg border border-red-200">
                  Requerido para alertas de ventas
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ======== PLANTILLAS DE MENSAJES ======== */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-[#25D366]" />
            Plantillas de Mensajes
          </h3>
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg px-3 py-1.5 transition-colors"
          >
            <Eye className="w-3.5 h-3.5" />
            {showPreview ? 'Ocultar preview' : 'Ver preview'}
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Tabs para las plantillas */}
          <div className="flex rounded-xl overflow-hidden border border-gray-200">
            <button
              onClick={() => setActiveTemplate('customer')}
              className={`flex-1 py-3 text-sm font-bold transition-colors ${
                activeTemplate === 'customer'
                  ? 'bg-[#25D366] text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              📩 Mensaje al Cliente (Confirmación de pedido)
            </button>
            <button
              onClick={() => setActiveTemplate('owner')}
              className={`flex-1 py-3 text-sm font-bold transition-colors border-l border-gray-200 ${
                activeTemplate === 'owner'
                  ? 'bg-[#25D366] text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              🔔 Mensaje al Dueño (Nueva venta)
            </button>
          </div>

          {/* Variables disponibles */}
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
              Variables disponibles — haz clic para insertar en la plantilla activa
            </p>
            <div className="flex flex-wrap gap-2">
              {VARIABLES.map(v => (
                <button
                  key={v.var}
                  onClick={() => { setFocusedArea(activeTemplate); insertVariable(v.var); }}
                  title={v.desc}
                  className="group relative flex items-center gap-1.5 bg-gray-100 hover:bg-green-50 hover:border-green-400 border border-transparent text-gray-700 hover:text-green-800 text-xs font-mono font-bold px-2.5 py-1.5 rounded-lg transition-all"
                >
                  <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                  {v.var}
                  <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                    {v.desc}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Editor de plantilla del cliente */}
          {activeTemplate === 'customer' && (
            <div className="grid lg:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">
                  📩 Plantilla — Confirmación al Cliente
                </label>
                <textarea
                  ref={customerRef}
                  value={customerTemplate}
                  onChange={e => setCustomerTemplate(e.target.value)}
                  onFocus={() => setFocusedArea('customer')}
                  rows={18}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-mono text-sm text-gray-800 focus:outline-none focus:bg-white focus:border-green-400 focus:ring-4 focus:ring-green-400/10 transition-all resize-none leading-relaxed"
                  placeholder="Escribe el mensaje que recibirá el cliente..."
                />
                <p className="text-xs text-gray-400 mt-1">
                  Usa <strong>*texto*</strong> para negrilla y <em>_texto_</em> para cursiva en WhatsApp.
                </p>
              </div>
              {showPreview && (
                <div>
                  <label className="block text-sm font-bold text-gray-500 mb-2">
                    👁 Preview (con datos de ejemplo)
                  </label>
                  <div className="bg-[#e8f5e9] rounded-xl p-4 font-mono text-sm text-gray-800 whitespace-pre-wrap leading-relaxed border border-green-200 min-h-[340px] max-h-[400px] overflow-y-auto">
                    {getPreview(customerTemplate)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Editor de plantilla del dueño */}
          {activeTemplate === 'owner' && (
            <div className="grid lg:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">
                  🔔 Plantilla — Notificación al Dueño
                </label>
                <textarea
                  ref={ownerRef}
                  value={ownerTemplate}
                  onChange={e => setOwnerTemplate(e.target.value)}
                  onFocus={() => setFocusedArea('owner')}
                  rows={18}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-mono text-sm text-gray-800 focus:outline-none focus:bg-white focus:border-green-400 focus:ring-4 focus:ring-green-400/10 transition-all resize-none leading-relaxed"
                  placeholder="Escribe el mensaje que recibirás como dueño..."
                />
                <p className="text-xs text-gray-400 mt-1">
                  Usa <strong>*texto*</strong> para negrilla y <em>_texto_</em> para cursiva en WhatsApp.
                </p>
              </div>
              {showPreview && (
                <div>
                  <label className="block text-sm font-bold text-gray-500 mb-2">
                    👁 Preview (con datos de ejemplo)
                  </label>
                  <div className="bg-[#fff3e0] rounded-xl p-4 font-mono text-sm text-gray-800 whitespace-pre-wrap leading-relaxed border border-orange-200 min-h-[340px] max-h-[400px] overflow-y-auto">
                    {getPreview(ownerTemplate)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Botón guardar */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
            <p className="text-xs text-gray-500">
              {status !== 'connected' && (
                <span className="text-amber-600 font-medium flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Conecta WhatsApp para que las notificaciones funcionen.
                </span>
              )}
            </p>
            <Button
              onClick={handleSave}
              disabled={isSaving}
              className="bg-gray-900 hover:bg-black text-white px-8 py-2.5 h-auto font-bold rounded-xl"
            >
              {isSaving ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando...</>
              ) : (
                <><Save className="w-4 h-4 mr-2" />Guardar Configuración</>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* ======== INFO BOX ======== */}
      <div className="bg-blue-50 border border-blue-100 rounded-2xl p-5 flex gap-4">
        <AlertCircle className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
        <div className="text-sm text-blue-800 space-y-1">
          <p className="font-bold">¿Cómo funciona?</p>
          <ol className="list-decimal list-inside space-y-1 text-blue-700">
            <li>Conectas tu WhatsApp escaneando el QR con tu celular.</li>
            <li>Guardas el número donde quieres recibir notificaciones de ventas.</li>
            <li>Cada vez que un cliente haga un pedido, recibes una alerta automática.</li>
            <li>El cliente recibe su confirmación de compra por WhatsApp al instante.</li>
            <li>La sesión se guarda automáticamente — solo escaneas el QR <strong>una vez</strong>.</li>
          </ol>
        </div>
      </div>

    </div>
  );
}
