import { useProducts, Order, CartItem, Product } from './ProductContext';
import { sanitizeProductImage } from '../lib/catalog-cache';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { Package, Clock, CheckCircle2, XCircle, Search, Filter, Download, Receipt, Edit, Trash2, Mail, Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { ThermalTicket } from './ThermalTicket';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { toast } from 'sonner';

function resolveOrderItemImage(item: CartItem, products: Product[]): string {
  const stored = sanitizeProductImage(item.product?.image);
  if (stored) return stored;
  const fromCatalog = products.find((p) => p.id === item.product?.id);
  return fromCatalog?.image || '';
}

export function OrdersManager() {
  const { orders, products, updateOrderStatus, updateOrderDetails, deleteOrder, unreadOrdersCount, markOrdersAsRead, ticketConfig } = useProducts();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<Order['status'] | 'all'>('all');
  const [showWelcome, setShowWelcome] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [showTicketDialog, setShowTicketDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingItems, setEditingItems] = useState<CartItem[]>([]);
  const [editingCustomer, setEditingCustomer] = useState<Order['customerInfo']>({});
  const [editingTotal, setEditingTotal] = useState<number>(0);
  const [isSendingEmail, setIsSendingEmail] = useState<string | null>(null);

  // Marcar órdenes como leídas al montar el componente
  useState(() => {
    setTimeout(() => {
      markOrdersAsRead();
      setShowWelcome(false);
    }, 3000);
  });

  const filteredOrders = orders.filter(order => {
    const orderNum = order.orderNumber || '';
    const matchesSearch = 
      orderNum.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (order.customerInfo?.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (order.customerInfo?.email || '').toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || order.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const getStatusIcon = (status: Order['status']) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'pending_bold':
        return <Clock className="w-4 h-4 text-orange-600" />;
      case 'processing':
        return <Package className="w-4 h-4 text-blue-500" />;
      case 'completed':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'cancelled':
        return <XCircle className="w-4 h-4 text-red-500" />;
    }
  };

  const getStatusLabel = (status: Order['status']) => {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      pending_bold: 'Pendiente (Pago Bold)',
      processing: 'Procesando',
      completed: 'Completada',
      cancelled: 'Cancelada'
    };
    return labels[status] || status;
  };

  const getStatusColor = (status: Order['status']) => {
    const colors: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      pending_bold: 'bg-orange-100 text-orange-800 border-orange-200',
      processing: 'bg-blue-100 text-blue-800 border-blue-200',
      completed: 'bg-green-100 text-green-800 border-green-200',
      cancelled: 'bg-red-100 text-red-800 border-red-200'
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const totalRevenue = orders
    .filter(order => order.status === 'completed')
    .reduce((sum, order) => sum + calculateOrderTotals(order).finalTotal, 0);
  
  const totalRevenueCOP = totalRevenue;

  const pendingOrders = orders.filter(order => order.status === 'pending').length;
  const processingOrders = orders.filter(order => order.status === 'processing').length;

  const handleViewTicket = (order: Order) => {
    setSelectedOrder(order);
    setShowTicketDialog(true);
  };

  const handleEditTicket = (order: Order) => {
    setSelectedOrder(order);
    setEditingItems([...(order.items || [])]);
    setEditingCustomer({ ...(order.customerInfo || {}) });
    setEditingTotal(order.total || 0);
    setShowEditDialog(true);
  };

  const handleSaveTicketChanges = () => {
    if (!selectedOrder) return;
    
    // Si cambia el valor de deliveryFee, actualizamos el total? 
    // Depende de si se quiere sumar, pero el admin puede editar el "Total" manualmente para mayor control.
    updateOrderDetails(selectedOrder.id, {
      items: editingItems,
      customerInfo: editingCustomer,
      total: editingTotal
    });
    setShowEditDialog(false);
    toast.success('Ticket actualizado exitosamente');
  };

  const handleDeleteOrder = async (order: Order) => {
    toast(`¿Eliminar la orden #${order.orderNumber}?`, {
      action: {
        label: 'Sí, eliminar',
        onClick: async () => {
          try {
            await deleteOrder(order.id);
          } catch (error) {
            toast.error('Error al eliminar la orden.');
          }
        }
      },
      cancel: { label: 'Cancelar', onClick: () => {} },
      duration: 5000,
    });
  };

  const updateItemField = (index: number, field: 'serialNumber' | 'invoiceNumber', value: string) => {
    setEditingItems(prev => prev.map((item, i) => 
      i === index ? { ...item, [field]: value } : item
    ));
  };

  const updateItemSerialByUnit = (itemIndex: number, unitIndex: number, value: string) => {
    setEditingItems(prev => prev.map((item, i) => {
      if (i !== itemIndex) return item;
      // Construir array de seriales según cantidad de unidades
      const currentSerials: string[] = item.serialNumbers
        ? [...item.serialNumbers]
        : (item.serialNumber ? [item.serialNumber] : []);
      // Rellenar hasta tener suficientes slots
      while (currentSerials.length < (item.quantity || 1)) currentSerials.push('');
      currentSerials[unitIndex] = value;
      return { ...item, serialNumbers: currentSerials, serialNumber: currentSerials.join(', ') };
    }));
  };

  const getItemSerials = (item: CartItem): string[] => {
    if (item.serialNumbers && item.serialNumbers.length > 0) return item.serialNumbers;
    if (item.serialNumber) return [item.serialNumber];
    return [];
  };

  const handleDownloadTicket = async (order: Order) => {
    setSelectedOrder(order);
    
    // Pequeño delay para que React actualice el estado del ticket
    await new Promise(resolve => setTimeout(resolve, 80));
    
    const ticketElement = document.getElementById('admin-thermal-ticket');
    if (!ticketElement) {
      console.error('Elemento del ticket no encontrado');
      return;
    }

    // Abrir ventana de impresión nativa — instantáneo, sin html2canvas
    const printWindow = window.open('', '_blank', 'width=400,height=700');
    if (!printWindow) {
      toast.error('Permite ventanas emergentes para imprimir el ticket.');
      return;
    }

    const totals = calculateOrderTotals(order);

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Ticket #${order.orderNumber}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Courier New', Courier, monospace;
            font-size: 12px;
            background: white;
            color: black;
            width: 302px;
            padding: 16px;
          }
          @media print {
            body { width: 100%; padding: 8px; }
            .no-print { display: none !important; }
            @page { margin: 4mm; size: 80mm auto; }
          }
          .center { text-align: center; }
          .bold { font-weight: bold; }
          .divider-dashed { border-top: 2px dashed #000; margin: 10px 0; }
          .divider-solid { border-top: 2px solid #000; margin: 10px 0; }
          .divider-thin { border-top: 1px dashed #000; margin: 10px 0; }
          .row { display: flex; justify-content: space-between; margin-bottom: 3px; }
          .header { text-align: center; padding-bottom: 12px; border-bottom: 2px dashed #000; margin-bottom: 12px; }
          .header .store-name { font-size: 20px; font-weight: bold; text-transform: uppercase; }
          .section-title { font-weight: bold; margin-bottom: 6px; }
          .total-row { display: flex; justify-content: space-between; font-size: 15px; font-weight: bold; }
          .order-num { display: inline-block; border: 2px solid #000; padding: 8px 14px; font-size: 15px; font-weight: bold; letter-spacing: 3px; }
          .btn-print { display: block; margin: 16px auto 0; padding: 10px 24px; background: #ff5a00; color: white; border: none; border-radius: 6px; font-size: 14px; font-weight: bold; cursor: pointer; }
        </style>
      </head>
      <body>
        ${ticketElement.innerHTML}
        <div class="no-print" style="margin-top:16px;text-align:center;">
          <button class="btn-print" onclick="window.print()">🖨️ Imprimir / Guardar PDF</button>
        </div>
        <script>
          // Auto-print después de cargar
          window.onload = function() {
            setTimeout(function() { window.print(); }, 200);
          };
        <\/script>
      </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleSendInvoiceEmail = async (order: Order) => {
    if (!order.customerInfo?.email) {
      toast.error('El cliente no tiene un correo electrónico registrado.');
      return;
    }

    toast(`¿Enviar factura a ${order.customerInfo.email}?`, {
      action: {
        label: 'Enviar',
        onClick: async () => {
          setIsSendingEmail(order.id);
          try {
            const res = await fetch('/api/orders', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'send-invoice', order })
            });
            if (res.ok) {
              toast.success('Factura enviada al correo del cliente.');
            } else {
              throw new Error('Error en el servidor');
            }
          } catch (error) {
            toast.error('Error al enviar la factura. Inténtalo de nuevo.');
          } finally {
            setIsSendingEmail(null);
          }
        }
      },
      cancel: { label: 'Cancelar', onClick: () => {} },
      duration: 5000,
    });
  };

  // Calcular los totales para el ticket
  const calculateOrderTotals = (order: Order) => {
    const deliveryFee = order.customerInfo?.deliveryFee || 0;
    const hasCardFee = (order.paymentMethod || '').toLowerCase().includes('tarjeta') || (order.paymentMethod || '').toLowerCase().includes('bold');
    const isAddi = (order.paymentMethod || '').toLowerCase().includes('addi');
    const totalItems = order.total;
    const cardFee = hasCardFee ? Math.round(totalItems * 0.05) : 0;
    const addiFee = isAddi ? Math.round(totalItems * 0.25) : 0;
    const finalTotal = totalItems + cardFee + addiFee + deliveryFee;
    return { finalTotal, cardFee, addiFee, totalCOP: totalItems, finalTotalCOP: finalTotal };
  };

  return (
    <div className="space-y-6">
      {/* Mensaje de bienvenida con nuevas órdenes */}
      {showWelcome && unreadOrdersCount > 0 && (
        <div className="bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg p-6 shadow-lg animate-in fade-in slide-in-from-top duration-500">
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0 w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
              <Package className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-bold mb-1">
                ¡Tienes {unreadOrdersCount} nueva{unreadOrdersCount > 1 ? 's' : ''} orden{unreadOrdersCount > 1 ? 'es' : ''}!
              </h3>
              <p className="text-green-100 text-sm">
                Revisa los detalles y procesa los pedidos lo antes posible.
              </p>
            </div>
            <button
              onClick={() => setShowWelcome(false)}
              className="flex-shrink-0 text-white hover:bg-white/10 rounded-lg p-2 transition-colors"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Estadísticas */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Órdenes</p>
              <p className="text-2xl font-bold text-gray-800">{orders.length}</p>
            </div>
            <Package className="w-8 h-8 text-orange-500" />
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Pendientes</p>
              <p className="text-2xl font-bold text-yellow-600">{pendingOrders}</p>
            </div>
            <Clock className="w-8 h-8 text-yellow-500" />
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Procesando</p>
              <p className="text-2xl font-bold text-blue-600">{processingOrders}</p>
            </div>
            <Package className="w-8 h-8 text-blue-500" />
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Ingresos Totales</p>
              <p className="text-2xl font-bold text-green-600">${totalRevenueCOP.toLocaleString('es-CO')} COP</p>
            </div>
            <CheckCircle2 className="w-8 h-8 text-green-500" />
          </div>
        </div>
      </div>

      {/* Filtros y búsqueda */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Búsqueda */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar por número de orden, nombre o email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>

          {/* Filtro por estado */}
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as Order['status'] | 'all')}
              className="pl-10 pr-8 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
            >
              <option value="all">Todos los estados</option>
              <option value="pending">Pendiente</option>
              <option value="processing">Procesando</option>
              <option value="completed">Completada</option>
              <option value="cancelled">Cancelada</option>
            </select>
          </div>
        </div>
      </div>

      {/* Lista de órdenes */}
      {filteredOrders.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <Package className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500 text-lg">No se encontraron órdenes</p>
          <p className="text-gray-400 text-sm mt-2">
            {searchTerm || statusFilter !== 'all' 
              ? 'Intenta cambiar los filtros de búsqueda'
              : 'Las órdenes aparecerán aquí cuando los clientes realicen compras'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredOrders.map((order) => (
            <div
              key={order.id}
              className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-md transition-shadow"
            >
              {/* Header de la orden */}
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-bold text-gray-800">
                      {order.orderNumber}
                    </h3>
                    <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-medium ${getStatusColor(order.status)}`}>
                      {getStatusIcon(order.status)}
                      {getStatusLabel(order.status)}
                    </div>
                  </div>
                  <p className="text-sm text-gray-600">
                    {new Date(order.date).toLocaleDateString('es-ES', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-600 mb-1">Total</p>
                  <p className="text-2xl font-bold text-orange-500">
                    ${calculateOrderTotals(order).finalTotal.toLocaleString('es-CO')} COP
                  </p>
                </div>
              </div>

              {/* Información del cliente */}
              {order.customerInfo && (
                <div className="bg-gray-50 rounded-lg p-4 mb-4">
                <h4 className="text-sm font-semibold text-gray-700 mb-2">Información del Cliente</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-gray-600">Nombre:</span>{' '}
                    <span className="font-medium text-gray-800">{order.customerInfo.name || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Cédula:</span>{' '}
                    <span className="font-medium text-gray-800">{order.customerInfo.idNumber || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Email:</span>{' '}
                    <span className="font-medium text-gray-800">{order.customerInfo.email || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Teléfono:</span>{' '}
                    <span className="font-medium text-gray-800">{order.customerInfo.phone || 'N/A'}</span>
                  </div>
                  {order.customerInfo.deliveryMethod && (
                    <div>
                      <span className="text-gray-600">Método de entrega:</span>{' '}
                      <span className="font-medium text-gray-800">
                        {order.customerInfo.deliveryMethod === 'delivery' ? '🚚 Envío a domicilio' : '📦 Retiro en tienda'}
                      </span>
                    </div>
                  )}
                  {order.customerInfo.address && (
                    <div className="md:col-span-2">
                      <span className="text-gray-600">Dirección:</span>{' '}
                      <span className="font-medium text-gray-800">{order.customerInfo.address}</span>
                    </div>
                  )}
                  <div>
                    <span className="text-gray-600">Método de pago:</span>{' '}
                    <span className="font-medium text-gray-800">{order.paymentMethod}</span>
                  </div>
                  {order.customerInfo.cardType && (
                    <div>
                      <span className="text-gray-600">Tipo de tarjeta:</span>{' '}
                      <span className="font-medium text-gray-800 capitalize">{order.customerInfo.cardType}</span>
                    </div>
                  )}
                  {order.customerInfo.paypalId && (
                    <div>
                      <span className="text-gray-600">ID de PayPal:</span>{' '}
                      <span className="font-medium text-gray-800 text-xs">{order.customerInfo.paypalId}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Productos de la orden */}
              <div className="mb-4">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">Productos</h4>
                <div className="space-y-2">
                  {(order.items || []).map((item, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0"
                    >
                      <div className="flex items-center gap-3 flex-1">
                        <ImageWithFallback
                          src={resolveOrderItemImage(item, products)}
                          alt={item.product.name}
                          className="w-12 h-12 object-cover rounded bg-gray-100"
                        />
                        <div>
                          <p className="font-medium text-gray-800">
                            {item.product.name}
                            {item.selectedStorage && <span className="text-xs text-blue-600 ml-1">{item.selectedStorage}</span>}
                            {item.selectedColor && <span className="text-xs text-gray-500 ml-1">({item.selectedColor})</span>}
                          </p>
                          <p className="text-sm text-gray-600">
                            ${(item.product.price * item.quantity).toLocaleString('es-CO')} COP × {item.quantity}
                          </p>
                          {item.serialNumbers && item.serialNumbers.length > 0
                            ? item.serialNumbers.map((sn, snIdx) => sn ? (
                                <p key={snIdx} className="text-xs text-gray-500">
                                  IMEI {item.serialNumbers!.length > 1 ? `#${snIdx + 1}` : ''}: {sn}
                                </p>
                              ) : null)
                            : item.serialNumber && (
                                <p className="text-xs text-gray-500">Serial: {item.serialNumber}</p>
                              )
                          }
                          {item.invoiceNumber && (
                            <p className="text-xs text-gray-500">Factura: {item.invoiceNumber}</p>
                          )}
                        </div>
                      </div>
                      <p className="font-semibold text-gray-800">
                        ${(item.product.price * item.quantity).toLocaleString('es-CO')} COP
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Acciones */}
              <div className="flex gap-2 pt-4 border-t border-gray-200 flex-wrap">
                {/* Botones de estado */}
                {order.status === 'pending' && (
                  <>
                    <Button
                      onClick={() => updateOrderStatus(order.id, 'processing')}
                      className="bg-blue-500 hover:bg-blue-600 text-white"
                      size="sm"
                    >
                      Marcar como Procesando
                    </Button>
                    <Button
                      onClick={() => {
                        toast('¿Cancelar esta orden?', {
                          action: {
                            label: 'Sí, cancelar',
                            onClick: () => updateOrderStatus(order.id, 'cancelled')
                          },
                          cancel: { label: 'No', onClick: () => {} },
                          duration: 5000,
                        });
                      }}
                      variant="outline"
                      className="text-red-600 border-red-300 hover:bg-red-50"
                      size="sm"
                    >
                      Cancelar Orden
                    </Button>
                  </>
                )}
                {order.status === 'processing' && (
                  <>
                    <Button
                      onClick={() => updateOrderStatus(order.id, 'completed')}
                      className="bg-green-500 hover:bg-green-600 text-white"
                      size="sm"
                    >
                      Marcar como Completada
                    </Button>
                    <Button
                      onClick={() => {
                        toast('¿Cancelar esta orden?', {
                          action: {
                            label: 'Sí, cancelar',
                            onClick: () => updateOrderStatus(order.id, 'cancelled')
                          },
                          cancel: { label: 'No', onClick: () => {} },
                          duration: 5000,
                        });
                      }}
                      variant="outline"
                      className="text-red-600 border-red-300 hover:bg-red-50"
                      size="sm"
                    >
                      Cancelar Orden
                    </Button>
                  </>
                )}
                {order.status === 'completed' && (
                  <div className="flex items-center gap-2 text-green-600 text-sm">
                    <CheckCircle2 className="w-4 h-4" />
                    Orden completada
                  </div>
                )}
                {order.status === 'cancelled' && (
                  <div className="flex items-center gap-2 text-red-600 text-sm">
                    <XCircle className="w-4 h-4" />
                    Orden cancelada
                  </div>
                )}
                
                {/* Botones de ticket - siempre visibles */}
                <div className="ml-auto flex gap-2">
                  <Button
                    onClick={() => handleEditTicket(order)}
                    variant="outline"
                    size="sm"
                    className="border-purple-300 text-purple-600 hover:bg-purple-50"
                  >
                    <Edit className="w-4 h-4 mr-1" />
                    Editar Ticket
                  </Button>
                  <Button
                    onClick={() => handleViewTicket(order)}
                    variant="outline"
                    size="sm"
                    className="border-orange-300 text-orange-600 hover:bg-orange-50"
                  >
                    <Receipt className="w-4 h-4 mr-1" />
                    Ver Ticket
                  </Button>
                  <Button
                    onClick={() => handleDownloadTicket(order)}
                    variant="outline"
                    size="sm"
                    className="border-blue-300 text-blue-600 hover:bg-blue-50"
                  >
                    <Download className="w-4 h-4 mr-1" />
                    Descargar
                  </Button>
                  <Button
                    onClick={() => handleSendInvoiceEmail(order)}
                    variant="outline"
                    size="sm"
                    disabled={isSendingEmail === order.id}
                    className="border-teal-300 text-teal-600 hover:bg-teal-50"
                  >
                    {isSendingEmail === order.id ? (
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                      <Mail className="w-4 h-4 mr-1" />
                    )}
                    Enviar Email
                  </Button>
                  <Button
                    onClick={() => handleDeleteOrder(order)}
                    variant="outline"
                    size="sm"
                    className="border-red-300 text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    Eliminar
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      
      {/* Diálogo para ver el ticket */}
      <Dialog open={showTicketDialog} onOpenChange={setShowTicketDialog}>
        <DialogContent className="max-w-[450px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="w-5 h-5 text-orange-500" />
              Ticket de Orden
            </DialogTitle>
            <DialogDescription>
              {selectedOrder && `Orden #${selectedOrder.orderNumber}`}
            </DialogDescription>
          </DialogHeader>
          
          {selectedOrder && (
            <div className="overflow-y-auto max-h-[65vh] bg-gray-50 rounded-lg p-4">
              <div className="bg-white rounded-lg shadow-lg border border-gray-200 p-4 mx-auto" style={{ maxWidth: '320px' }}>
                <ThermalTicketPreview order={selectedOrder} />
              </div>
            </div>
          )}
          
          <div className="flex gap-2 pt-4 border-t">
            <Button
              onClick={() => setShowTicketDialog(false)}
              variant="outline"
              className="flex-1"
            >
              Cerrar
            </Button>
            {selectedOrder && (
              <Button
                onClick={() => {
                  handleDownloadTicket(selectedOrder);
                }}
                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
              >
                <Download className="w-4 h-4 mr-2" />
                Descargar
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Diálogo para editar el ticket */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit className="w-5 h-5 text-purple-500" />
              Editar Información del Ticket
            </DialogTitle>
            <DialogDescription>
              {selectedOrder && `Orden #${selectedOrder.orderNumber}`}
            </DialogDescription>
          </DialogHeader>
          
          {selectedOrder && (
            <div className="overflow-y-auto flex-1 pr-2">
              <div className="space-y-6">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm text-blue-800">
                    <strong>💡 Instrucción:</strong> Edita la información del cliente, valor del domicilio, total, y números de serie/factura para imprimir el ticket térmico correctamente.
                  </p>
                </div>

                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 space-y-4">
                  <h4 className="font-semibold text-gray-800 border-b pb-2">Información del Cliente y Totales</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="edit-name" className="text-sm font-medium text-gray-700 mb-1 block">
                        Nombre o Razón Social
                      </Label>
                      <Input
                        id="edit-name"
                        type="text"
                        value={editingCustomer.name || ''}
                        onChange={(e) => setEditingCustomer({ ...editingCustomer, name: e.target.value })}
                        placeholder="Ej: Empresa S.A.S"
                        className="w-full bg-white"
                      />
                    </div>
                    <div>
                      <Label htmlFor="edit-id" className="text-sm font-medium text-gray-700 mb-1 block">
                        Cédula o NIT
                      </Label>
                      <Input
                        id="edit-id"
                        type="text"
                        value={editingCustomer.idNumber || ''}
                        onChange={(e) => setEditingCustomer({ ...editingCustomer, idNumber: e.target.value })}
                        placeholder="Ej: 900.123.456-7"
                        className="w-full bg-white"
                      />
                    </div>
                    <div>
                      <Label htmlFor="edit-delivery" className="text-sm font-medium text-gray-700 mb-1 block">
                        Costo de Domicilio (COP)
                      </Label>
                      <Input
                        id="edit-delivery"
                        type="number"
                        value={editingCustomer.deliveryFee || 0}
                        onChange={(e) => setEditingCustomer({ ...editingCustomer, deliveryFee: Number(e.target.value) })}
                        className="w-full bg-white"
                      />
                    </div>
                    <div>
                      <Label htmlFor="edit-total" className="text-sm font-medium text-gray-700 mb-1 block">
                        Total Final (COP)
                      </Label>
                      <Input
                        id="edit-total"
                        type="number"
                        value={editingTotal}
                        onChange={(e) => setEditingTotal(Number(e.target.value))}
                        className="w-full bg-white border-orange-300 focus:ring-orange-500"
                      />
                    </div>
                  </div>
                </div>

                {editingItems.map((item, index) => (
                  <div key={index} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                    <div className="flex items-start gap-4 mb-4">
                      <ImageWithFallback
                        src={resolveOrderItemImage(item, products)}
                        alt={item.product.name}
                        className="w-16 h-16 object-cover rounded bg-gray-100"
                      />
                      <div className="flex-1">
                        <h4 className="font-semibold text-gray-800">{item.product.name}</h4>
                        <p className="text-sm text-gray-600">
                          Cantidad: {item.quantity}
                          {item.selectedColor && ` • Color: ${item.selectedColor}`}
                        </p>
                        <p className="text-sm text-gray-600">
                          ${item.product.price.toLocaleString('es-CO')} COP c/u
                        </p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {/* Seriales: un campo por cada unidad del producto */}
                      <div>
                        <Label className="text-sm font-medium text-gray-700 mb-2 block">
                          {item.quantity > 1
                            ? `📱 IMEI / Serial — ${item.quantity} unidades`
                            : 'Número de Serial / IMEI'}
                        </Label>
                        {Array.from({ length: item.quantity || 1 }).map((_, unitIdx) => {
                          const serials = getItemSerials(item);
                          return (
                            <div key={unitIdx} className="flex items-center gap-2 mb-2">
                              {item.quantity > 1 && (
                                <span className="text-xs text-gray-500 font-medium w-20 flex-shrink-0">
                                  Unidad {unitIdx + 1}:
                                </span>
                              )}
                              <Input
                                id={`serial-${index}-${unitIdx}`}
                                type="text"
                                value={serials[unitIdx] || ''}
                                onChange={(e) => updateItemSerialByUnit(index, unitIdx, e.target.value)}
                                placeholder={`IMEI / Serial ${item.quantity > 1 ? `#${unitIdx + 1}` : ''}`}
                                className="w-full"
                              />
                            </div>
                          );
                        })}
                      </div>
                      {/* Número de factura: uno por producto */}
                      <div>
                        <Label htmlFor={`invoice-${index}`} className="text-sm font-medium text-gray-700 mb-1 block">
                          Número de Factura
                        </Label>
                        <Input
                          id={`invoice-${index}`}
                          type="text"
                          value={item.invoiceNumber || ''}
                          onChange={(e) => updateItemField(index, 'invoiceNumber', e.target.value)}
                          placeholder="Ej: FAC-2025-001"
                          className="w-full"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          <div className="flex gap-2 pt-4 border-t mt-4">
            <Button
              onClick={() => setShowEditDialog(false)}
              variant="outline"
              className="flex-1"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSaveTicketChanges}
              className="flex-1 bg-purple-500 hover:bg-purple-600 text-white"
            >
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Guardar Cambios
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Ticket oculto para descargar */}
      {selectedOrder && (() => {
        const totals = calculateOrderTotals(selectedOrder);
        return (
          <div style={{ position: 'absolute', left: '-9999px', top: '-9999px' }}>
            <ThermalTicket 
              order={selectedOrder}
              {...totals}
              ticketId="admin-thermal-ticket"
              config={ticketConfig}
            />
          </div>
        );
      })()}
    </div>
  );
}

function ThermalTicketPreview({ order }: { order: Order }) {
  const { ticketConfig } = useProducts();
  
  // Mismo cálculo que en OrdersManager para consistencia
  const EXCHANGE_RATE = 1;
  const deliveryFee = order.customerInfo?.deliveryFee || 0;
  const hasCardFee = (order.paymentMethod || '').toLowerCase().includes('tarjeta') || (order.paymentMethod || '').toLowerCase().includes('bold');
  const isAddi = (order.paymentMethod || '').toLowerCase().includes('addi');
  
  const totalItems = order.total;
  const cardFee = hasCardFee ? Math.round(totalItems * 0.05) : 0;
  const addiFee = isAddi ? Math.round(totalItems * 0.25) : 0;
  
  const totalCOP = totalItems * EXCHANGE_RATE;
  const finalTotalCOP = (totalItems + cardFee + addiFee + deliveryFee) * EXCHANGE_RATE;

  return (
    <div className="flex justify-center scale-90 sm:scale-100 origin-top">
      <ThermalTicket 
        order={order}
        finalTotal={totalItems + cardFee + addiFee + deliveryFee}
        cardFee={cardFee}
        addiFee={addiFee}
        totalCOP={totalCOP}
        finalTotalCOP={finalTotalCOP}
        ticketId="preview-thermal-ticket"
        config={ticketConfig}
        preview={true}
      />
    </div>
  );
}
