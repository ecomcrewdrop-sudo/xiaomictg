import { useState, useRef, useEffect } from 'react';
import { Send, Minus, ChevronRight, ShoppingCart } from 'lucide-react';
import { useLocation, Link } from 'react-router';
import { useProducts } from './ProductContext';
import type { Product } from './ProductContext';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

// ─── Utilidad: encontrar un producto por ID o nombre (fuzzy) ──────────────────
function findProduct(products: Product[], rawId: string): Product | undefined {
  const id = rawId.trim();

  // 1. Match exacto por p.id
  let found = products.find(p => p.id === id);
  if (found) return found;

  // 2. Match por _id string
  found = products.find(p => p._id && p._id.toString() === id);
  if (found) return found;

  // 3. Match por _id.$oid (cuando viene como objeto MongoDB)
  found = products.find(p =>
    typeof p._id === 'object' && p._id !== null && (p._id as any).$oid === id
  );
  if (found) return found;

  // 4. Fallback fuzzy: el ID puede ser algo como "redmi-note-15" o "note15"
  //    Normalizar: lowercase, sin guiones, sin espacios
  const normalize = (s: string) => s.toLowerCase().replace(/[\s\-_]/g, '');
  const normalizedId = normalize(id);

  found = products.find(p => normalize(p.id) === normalizedId);
  if (found) return found;

  // 5. Fallback por nombre normalizado del producto
  found = products.find(p => normalize(p.name) === normalizedId);
  if (found) return found;

  // 6. Contiene parcial: el ID normalizado está contenido en el nombre del producto o viceversa
  found = products.find(p =>
    normalize(p.name).includes(normalizedId) || normalizedId.includes(normalize(p.name))
  );
  if (found) return found;

  return undefined;
}

export function AiAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: '¡Hola! Qué gusto saludarte, soy Karol Garcia de Xiaomi Cartagena. ¿Qué equipo estás buscando hoy? ¡Estoy aquí para ayudarte a elegir el mejor!' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const { products } = useProducts();

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  // Ocultar en rutas de admin
  if (
    location.pathname.startsWith('/panel-gestion-xiaomi') ||
    location.pathname.startsWith('/admin')
  ) {
    return null;
  }

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { role: 'user', content: input.trim() };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updatedMessages.map(m => ({ role: m.role, content: m.content }))
        })
      });

      if (!response.ok) throw new Error('Error de conexión');
      const data = await response.json();
      setMessages(prev => [...prev, data.reply]);
    } catch (error) {
      console.error(error);
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: 'Uy, tuve un pequeño inconveniente de conexión. ¿Me repites tu consulta, por favor?'
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  // ─── Render de contenido de mensajes ───────────────────────────────────────
  // Regex que captura todos los tokens especiales:
  // [PRODUCT:id:precio] — precio puede tener puntos (ej: 470.000) o no
  // [WHATSAPP_BUTTON] o [WHATSAPP_BUTTON:mensaje]
  // [BOLD_BUTTON:monto]
  // [ORDER_SUMMARY:datos]
  const TOKEN_REGEX = /(\[PRODUCT:[^\]]+\]|\[WHATSAPP_BUTTON(?::[^\]]+)?\]|\[BOLD_BUTTON:[^\]]+\]|\[ORDER_SUMMARY:[^\]]+\])/g;

  // Detecta si el contenido del mensaje indica un método de pago NO Bold
  // Usado como capa de seguridad para redirigir un [BOLD_BUTTON] incorrecto a WhatsApp
  const isNonBoldPayment = (fullContent: string): boolean => {
    const lower = fullContent.toLowerCase();
    return (
      lower.includes('efectivo') ||
      lower.includes('nequi') ||
      lower.includes('transferencia') ||
      // Tarjeta datáfono contra entrega (no pago en línea)
      (lower.includes('tarjeta') &&
        !lower.includes('bold') &&
        !lower.includes('pago en línea') &&
        !lower.includes('en linea') &&
        !lower.includes('en línea'))
    );
  };

  const renderMessageContent = (content: string) => {
    const parts = content.split(TOKEN_REGEX);

    return parts.map((part, index) => {
      // Pasar el contenido completo del mensaje para análisis de contexto

      // ── WHATSAPP BUTTON ──
      if (part.startsWith('[WHATSAPP_BUTTON')) {
        const customMatch = part.match(/\[WHATSAPP_BUTTON:(.+?)\]/);
        let msgText = customMatch
          ? customMatch[1]
          : 'Hola Karol, ya elegí mi equipo y quiero coordinar mi pedido 🚀';

        // Extraer los datos del pedido para enviarlos a WhatsApp
        // Intentar buscar en el mensaje actual, y si no, en el historial
        let summaryMatch = content.match(/\[ORDER_SUMMARY:(.+?)\]/);
        
        if (!summaryMatch) {
          // Buscar hacia atrás en los mensajes del asistente
          for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i];
            if (m.role === 'assistant') {
              const match = m.content.match(/\[ORDER_SUMMARY:(.+?)\]/);
              if (match) {
                summaryMatch = match;
                break;
              }
            }
          }
        }

        if (summaryMatch) {
          const dataStr = summaryMatch[1];
          const fields = dataStr.split('|');
          const [name, cedula, phone, delivery, address, payment, total, product] = fields;
          const totalNum = parseInt((total || '0').replace(/\D/g, '')) || 0;
          const totalStr = totalNum > 0 ? `$${totalNum.toLocaleString('es-CO')} COP` : total;

          msgText += `\n\n*🛒 MI PEDIDO:*\n📦 Producto: ${product || '—'}\n👤 Nombre: ${name || '—'}\n🪪 CC: ${cedula || '—'}\n📱 Tel: ${phone || '—'}\n🚚 Entrega: ${delivery || '—'}${address ? `\n📍 Dirección: ${address}` : ''}\n💳 Pago: ${payment || '—'}\n💰 Total a pagar: ${totalStr}`;
        }

        const encoded = encodeURIComponent(msgText);
        return (
          <a
            key={index}
            href={`https://wa.me/573022875280?text=${encoded}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setIsOpen(false)}
            className="flex items-center justify-center gap-2 w-full mt-3 mb-2 py-3 bg-[#25D366] hover:bg-[#20bd5a] text-white rounded-xl font-bold shadow-md hover:shadow-lg transition-all active:scale-95 no-underline"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
              <path d="M13.601 2.326A7.854 7.854 0 0 0 7.994 0C3.627 0 .068 3.558.064 7.926c0 1.399.366 2.76 1.057 3.965L0 16l4.204-1.102a7.933 7.933 0 0 0 3.79.965h.004c4.368 0 7.926-3.558 7.93-7.93A7.898 7.898 0 0 0 13.6 2.326zM7.994 14.521a6.573 6.573 0 0 1-3.356-.92l-.24-.144-2.494.654.666-2.433-.156-.251a6.56 6.56 0 0 1-1.007-3.505c0-3.626 2.957-6.584 6.591-6.584a6.56 6.56 0 0 1 4.66 1.931 6.557 6.557 0 0 1 1.928 4.66c-.004 3.639-2.961 6.592-6.592 6.592zm3.615-4.934c-.197-.099-1.17-.578-1.353-.646-.182-.065-.315-.099-.445.099-.133.197-.513.646-.627.775-.114.133-.232.148-.43.05-.197-.1-.836-.308-1.592-.985-.59-.525-.985-1.175-1.103-1.372-.114-.198-.011-.304.088-.403.087-.088.197-.232.296-.346.1-.114.133-.198.198-.33.065-.134.034-.248-.015-.347-.05-.099-.445-1.076-.612-1.47-.16-.389-.323-.335-.445-.34-.114-.007-.247-.007-.38-.007a.729.729 0 0 0-.529.247c-.182.198-.691.677-.691 1.654 0 .977.71 1.916.81 2.049.098.133 1.394 2.132 3.383 2.992.47.205.84.326 1.129.418.475.152.904.129 1.246.08.38-.058 1.171-.48 1.338-.943.164-.464.164-.86.114-.943-.049-.084-.182-.133-.38-.232z"/>
            </svg>
            Finalizar en WhatsApp
          </a>
        );
      }

      // ── BOLD BUTTON ──
      if (part.startsWith('[BOLD_BUTTON:')) {
        const rawAmount = part.replace('[BOLD_BUTTON:', '').replace(']', '').replace(/\./g, '').trim();
        const amount = rawAmount.replace(/\D/g, '');

        // ⚠️ CAPA DE SEGURIDAD FRONTEND:
        // Si el mensaje completo menciona efectivo/nequi/transferencia,
        // el AI cometió un error de lógica → redirigir a WhatsApp en vez de Bold
        if (isNonBoldPayment(content)) {
          let safeMsg = 'Hola Karol, hice mi pedido y quiero confirmar el despacho';

          // Extraer los datos del pedido en el fallback de seguridad
          let summaryMatch = content.match(/\[ORDER_SUMMARY:(.+?)\]/);
          
          if (!summaryMatch) {
            for (let i = messages.length - 1; i >= 0; i--) {
              const m = messages[i];
              if (m.role === 'assistant') {
                const match = m.content.match(/\[ORDER_SUMMARY:(.+?)\]/);
                if (match) {
                  summaryMatch = match;
                  break;
                }
              }
            }
          }

          if (summaryMatch) {
            const dataStr = summaryMatch[1];
            const fields = dataStr.split('|');
            const [name, cedula, phone, delivery, address, payment, total, product] = fields;
            const totalNum = parseInt((total || '0').replace(/\D/g, '')) || 0;
            const totalStr = totalNum > 0 ? `$${totalNum.toLocaleString('es-CO')} COP` : total;

            safeMsg += `\n\n*🛒 MI PEDIDO:*\n📦 Producto: ${product || '—'}\n👤 Nombre: ${name || '—'}\n🪪 CC: ${cedula || '—'}\n📱 Tel: ${phone || '—'}\n🚚 Entrega: ${delivery || '—'}${address ? `\n📍 Dirección: ${address}` : ''}\n💳 Pago: ${payment || '—'}\n💰 Total a pagar: ${totalStr}`;
          }

          const encodedSafeMsg = encodeURIComponent(safeMsg);
          return (
            <a
              key={index}
              href={`https://wa.me/573022875280?text=${encodedSafeMsg}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setIsOpen(false)}
              className="flex items-center justify-center gap-2 w-full mt-3 mb-2 py-3 bg-[#25D366] hover:bg-[#20bd5a] text-white rounded-xl font-bold shadow-md hover:shadow-lg transition-all active:scale-95 no-underline"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
                <path d="M13.601 2.326A7.854 7.854 0 0 0 7.994 0C3.627 0 .068 3.558.064 7.926c0 1.399.366 2.76 1.057 3.965L0 16l4.204-1.102a7.933 7.933 0 0 0 3.79.965h.004c4.368 0 7.926-3.558 7.93-7.93A7.898 7.898 0 0 0 13.6 2.326zM7.994 14.521a6.573 6.573 0 0 1-3.356-.92l-.24-.144-2.494.654.666-2.433-.156-.251a6.56 6.56 0 0 1-1.007-3.505c0-3.626 2.957-6.584 6.591-6.584a6.56 6.56 0 0 1 4.66 1.931 6.557 6.557 0 0 1 1.928 4.66c-.004 3.639-2.961 6.592-6.592 6.592zm3.615-4.934c-.197-.099-1.17-.578-1.353-.646-.182-.065-.315-.099-.445.099-.133.197-.513.646-.627.775-.114.133-.232.148-.43.05-.197-.1-.836-.308-1.592-.985-.59-.525-.985-1.175-1.103-1.372-.114-.198-.011-.304.088-.403.087-.088.197-.232.296-.346.1-.114.133-.198.198-.33.065-.134.034-.248-.015-.347-.05-.099-.445-1.076-.612-1.47-.16-.389-.323-.335-.445-.34-.114-.007-.247-.007-.38-.007a.729.729 0 0 0-.529.247c-.182.198-.691.677-.691 1.654 0 .977.71 1.916.81 2.049.098.133 1.394 2.132 3.383 2.992.47.205.84.326 1.129.418.475.152.904.129 1.246.08.38-.058 1.171-.48 1.338-.943.164-.464.164-.86.114-.943-.049-.084-.182-.133-.38-.232z"/>
              </svg>
              Confirmar Pedido en WhatsApp
            </a>
          );
        }

        const orderId = `AI-${Date.now().toString().slice(-6)}`;
        return (
          <a
            key={index}
            href={`/api/bold-checkout?orderId=${orderId}&amount=${amount}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full mt-3 mb-2 py-3 bg-[#FF4F00] hover:bg-[#e64600] text-white rounded-xl font-bold shadow-md hover:shadow-lg transition-all active:scale-95 no-underline"
          >
            💳 Pagar con Tarjeta (Bold)
          </a>
        );
      }

      // ── ORDER SUMMARY ──
      if (part.startsWith('[ORDER_SUMMARY:')) {
        const dataStr = part.replace('[ORDER_SUMMARY:', '').replace(']', '');
        const fields = dataStr.split('|');
        const [name, cedula, phone, delivery, address, payment, total, product] = fields;
        const rawTotal = (total || '0').replace(/\./g, '').replace(/[^\d]/g, '');
        const totalNum = parseInt(rawTotal) || 0;

        const deliveryIsHome = delivery?.toLowerCase().includes('domicilio') ||
          delivery?.toLowerCase().includes('socorro') ||
          delivery?.toLowerCase().includes('barrio') ||
          delivery?.toLowerCase().includes('calle') ||
          delivery?.toLowerCase().includes('cl.') ||
          (delivery && !delivery?.toLowerCase().includes('tienda') && !delivery?.toLowerCase().includes('retiro'));

        return (
          <div key={index} className="my-4 p-4 bg-orange-50 border border-orange-200 rounded-2xl shadow-sm">
            <h4 className="font-bold text-orange-700 text-sm mb-3 flex items-center gap-2">
              <span className="w-2 h-2 bg-orange-500 rounded-full inline-block"></span>
              ✅ Resumen de tu Pedido
            </h4>
            <div className="space-y-2.5 text-[13px]">
              <div className="flex justify-between gap-2">
                <span className="text-gray-500 shrink-0">📦 Equipo:</span>
                <span className="font-semibold text-gray-900 text-right">{product || '—'}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-gray-500 shrink-0">👤 Cliente:</span>
                <span className="font-semibold text-gray-900 text-right">{name || '—'}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-gray-500 shrink-0">🪪 Cédula:</span>
                <span className="font-semibold text-gray-900 text-right">{cedula || '—'}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-gray-500 shrink-0">📱 Teléfono:</span>
                <span className="font-semibold text-gray-900 text-right">{phone || '—'}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-gray-500 shrink-0">{deliveryIsHome ? '🛵' : '🏪'} Entrega:</span>
                <span className="font-semibold text-gray-900 text-right">{delivery || '—'}</span>
              </div>
              {address && (
                <div className="flex justify-between gap-2">
                  <span className="text-gray-500 shrink-0">📍 Dirección:</span>
                  <span className="font-semibold text-gray-900 text-right">{address}</span>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <span className="text-gray-500 shrink-0">💳 Pago:</span>
                <span className="font-semibold text-gray-900 text-right">{payment || '—'}</span>
              </div>
              <div className="mt-3 pt-3 border-t-2 border-orange-300 flex justify-between items-center">
                <span className="font-bold text-gray-900">TOTAL A PAGAR:</span>
                <span className="font-black text-orange-600 text-xl">
                  ${totalNum > 0 ? totalNum.toLocaleString('es-CO') : (total || '0')} COP
                </span>
              </div>
            </div>
          </div>
        );
      }

      // ── PRODUCT BADGE ──
      if (part.startsWith('[PRODUCT:')) {
        // Parsear: [PRODUCT:id:precio] — precio puede tener puntos o no
        const inner = part.replace('[PRODUCT:', '').replace(']', '');
        const colonIdx = inner.lastIndexOf(':');
        let productId = inner;
        let rawPrice = '';

        if (colonIdx > 0) {
          productId = inner.slice(0, colonIdx).trim();
          rawPrice  = inner.slice(colonIdx + 1).trim();
        }

        // Limpiar el precio: quitar puntos de miles, dejar solo dígitos
        const priceNum = parseInt(rawPrice.replace(/\./g, '').replace(/\D/g, '')) || 0;

        // Buscar el producto con matching robusto
        const product = findProduct(products, productId);

        if (product) {
          const displayPrice = priceNum > 0 ? priceNum : product.price;
          const productLink = product.id || product._id?.toString() || '';
          return (
            <Link
              key={index}
              to={`/product/${productLink}`}
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-3 my-3 p-3 bg-white border border-gray-100 hover:border-orange-400 rounded-xl shadow-sm hover:shadow-md transition-all group no-underline w-full cursor-pointer"
            >
              <div className="w-14 h-14 shrink-0 bg-gray-50 rounded-lg overflow-hidden flex items-center justify-center border border-gray-100">
                <img
                  src={product.image}
                  alt={product.name}
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-bold text-gray-900 text-[13px] leading-tight line-clamp-2">{product.name}</h4>
                <div className="flex items-center gap-1 mt-1">
                  <span className="text-orange-600 font-bold text-sm">
                    ${displayPrice.toLocaleString('es-CO')}
                  </span>
                  <span className="text-gray-400 text-xs">COP</span>
                </div>
              </div>
              <div className="w-7 h-7 rounded-full bg-orange-50 flex items-center justify-center shrink-0 text-orange-500 group-hover:bg-orange-500 group-hover:text-white transition-colors">
                <ChevronRight className="w-4 h-4" />
              </div>
            </Link>
          );
        }

        // Producto no encontrado — ocultar el tag roto silenciosamente
        // (no mostrar nada en lugar de basura)
        return <span key={index}></span>;
      }

      // ── TEXTO NORMAL — renderizar con saltos de línea ──
      if (!part) return null;
      return (
        <span key={index}>
          {part.split('\n').map((line, j, arr) => (
            <span key={j}>
              {line}
              {j < arr.length - 1 && <br />}
            </span>
          ))}
        </span>
      );
    });
  };

  return (
    <>
      {/* ── Botón flotante y callout ── */}
      <div
        className={`fixed bottom-[90px] right-6 z-[60] flex flex-col items-end gap-3 transition-all duration-500 origin-bottom ${
          isOpen ? 'scale-0 opacity-0 pointer-events-none' : 'scale-100 opacity-100'
        }`}
      >
        {/* Botón WhatsApp — solo ícono, encima del KG alineado a la derecha */}
        <div className="flex justify-end">
          <a
            href="https://wa.me/573022875280"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Contactar por WhatsApp"
            className="flex items-center justify-center w-[52px] h-[52px] bg-[#25D366] hover:bg-[#1ebe5d] text-white rounded-full shadow-xl hover:scale-110 transition-all duration-300"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
          </a>
        </div>

        {/* Fila KG: burbuja a la izquierda + botón KG a la derecha */}
        <div className="flex items-center gap-3">
          {/* Burbuja de texto — a la izquierda del KG */}
          <div
            onClick={() => setIsOpen(true)}
            className="bg-white px-4 py-2.5 rounded-2xl rounded-br-sm shadow-[0_4px_20px_rgba(0,0,0,0.15)] border border-orange-100 cursor-pointer hover:scale-105 transition-transform flex items-center gap-2.5"
          >
            <div className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
            <span className="text-[13px] font-bold text-gray-800 tracking-tight whitespace-nowrap">
              ¡Hola! 👋 ¿Te ayudo a elegir tu <span className="text-orange-600">Xiaomi</span>?
            </span>
          </div>

          {/* Botón KG */}
          <button
            onClick={() => setIsOpen(true)}
            className="relative flex items-center justify-center w-[60px] h-[60px] shrink-0"
            aria-label="Atención al cliente"
          >
            <div className="absolute inset-0 bg-orange-500 rounded-full animate-ping opacity-25 duration-[3000ms]"></div>
            <div className="w-[60px] h-[60px] bg-gradient-to-tr from-orange-500 to-orange-400 rounded-full flex items-center justify-center text-white font-bold text-xl shadow-2xl z-10 border-2 border-gray-900">
              KG
            </div>
          </button>
        </div>
      </div>

      {/* ── Ventana del chat ── */}
      <div
        className={`fixed bottom-6 right-4 sm:right-6 w-[calc(100vw-2rem)] sm:w-[390px] bg-[#fdfdfd] rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.2)] border border-gray-100 z-[70] flex flex-col overflow-hidden transition-all duration-300 origin-bottom-right ${
          isOpen ? 'scale-100 opacity-100' : 'scale-0 opacity-0 pointer-events-none'
        }`}
        style={{ height: 'min(650px, calc(100vh - 4rem))' }}
      >
        {/* Header */}
        <div className="bg-white p-4 flex items-center justify-between shrink-0 border-b border-gray-100 shadow-sm z-10">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-11 h-11 bg-gradient-to-tr from-orange-500 to-orange-400 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-sm border border-orange-200">
                KG
              </div>
              <div className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-green-500 border-2 border-white rounded-full"></div>
            </div>
            <div>
              <h3 className="font-bold text-gray-900 text-sm tracking-wide">Karol Garcia</h3>
              <p className="text-[11px] text-gray-500 font-medium">Ventas • Xiaomi Cartagena</p>
            </div>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-400 hover:text-gray-700"
            aria-label="Minimizar"
          >
            <Minus className="w-5 h-5" />
          </button>
        </div>

        {/* Mensajes */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5 bg-[#fafafa]">
          <div className="text-center mb-4">
            <span className="text-[11px] text-gray-400 font-medium tracking-wide bg-gray-100 px-3 py-1 rounded-full">
              Hoy, en línea
            </span>
          </div>

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[88%] rounded-2xl px-4 py-3 text-[14px] leading-relaxed shadow-sm ${
                  msg.role === 'user'
                    ? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-br-sm shadow-orange-500/20'
                    : 'bg-white border border-gray-100 text-gray-800 rounded-bl-sm shadow-gray-200/50'
                }`}
              >
                {renderMessageContent(msg.content)}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-white border border-gray-100 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                <div className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-3 bg-white border-t border-gray-100 shrink-0">
          <div className="flex items-end gap-2 bg-gray-50 p-1.5 rounded-[1.25rem] border border-gray-200 focus-within:border-orange-500 focus-within:ring-2 focus-within:ring-orange-500/20 transition-all shadow-inner">
            <textarea
              value={input}
              onChange={e => {
                setInput(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
              }}
              onKeyDown={e => {
                // Si es Enter sin Shift
                if (e.key === 'Enter' && !e.shiftKey) {
                  // Detectar si es un dispositivo táctil (móvil)
                  const isMobile = window.matchMedia('(pointer: coarse)').matches;
                  
                  // En PC: Enter envía el mensaje
                  if (!isMobile) {
                    e.preventDefault();
                    if (input.trim() && !isLoading) {
                      handleSend();
                      // Resetear la altura del textarea
                      e.currentTarget.style.height = 'auto';
                    }
                  }
                  // En móvil: dejar que Enter haga salto de línea natural
                }
              }}
              placeholder="Escribe tu mensaje aquí..."
              className="flex-1 bg-transparent px-3 py-2 text-[14px] focus:outline-none text-gray-800 placeholder:text-gray-400 font-medium resize-none min-h-[40px] max-h-[120px]"
              disabled={isLoading}
              rows={1}
            />
            <button
              onClick={() => {
                handleSend();
                // Resetear la altura buscando el textarea hermano
                const textarea = document.querySelector('textarea');
                if (textarea) textarea.style.height = 'auto';
              }}
              disabled={!input.trim() || isLoading}
              className="w-9 h-9 mb-0.5 bg-black hover:bg-orange-500 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-full transition-colors flex items-center justify-center shrink-0"
            >
              <Send className="w-4 h-4 ml-0.5" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
