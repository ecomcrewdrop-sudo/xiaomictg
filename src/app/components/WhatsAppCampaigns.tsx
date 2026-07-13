import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { API_BASE_URL, fetchWithTimeout } from '../lib/api-base';
import {
  Plus, Search, Image as ImageIcon, Play, Pause, Trash2,
  Calendar, Check, AlertCircle, RefreshCw, BarChart2, Users,
  Clock, Eye, FileText, ChevronRight, X, Sparkles, Filter
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';

interface Customer {
  name: string;
  phone: string;
  email: string;
  cedula: string;
  lastPurchaseDate: string;
  lastPurchaseProduct: string;
  purchaseCount: number;
}

interface Recipient {
  name: string;
  phone: string;
  status: 'pending' | 'sent' | 'failed';
  error?: string;
  processedAt?: string;
}

interface Campaign {
  id: string;
  name: string;
  message: string;
  imageUrl: string;
  status: 'draft' | 'scheduled' | 'active' | 'processing' | 'paused' | 'sent';
  delaySeconds: number;
  scheduledAt: string | null;
  recipients: Recipient[];
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  createdAt: string;
}

export default function WhatsAppCampaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [openCreate, setOpenCreate] = useState(false);
  const [openDetails, setOpenDetails] = useState<Campaign | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [delaySeconds, setDelaySeconds] = useState(10);
  const [scheduledAt, setScheduledAt] = useState('');
  const [selectedPhones, setSelectedPhones] = useState<Set<string>>(new Set());
  const [imageUploading, setImageUploading] = useState(false);

  // Search/Filters in Creation Dialog
  const [clientSearch, setClientSearch] = useState('');
  const [activeSegment, setActiveSegment] = useState<'all' | 'recent' | 'inactive3m' | 'inactive6m'>('all');

  const fetchCampaigns = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/whatsapp/campaigns`);
      if (res.ok) setCampaigns(await res.json());
    } catch {
      toast.error('Error cargando campañas');
    }
  }, []);

  const fetchCustomers = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/whatsapp/customers`);
      if (res.ok) setCustomers(await res.json());
    } catch {
      toast.error('Error cargando base de clientes');
    }
  }, []);

  useEffect(() => {
    fetchCampaigns();
    fetchCustomers();
    // Auto-actualizar cada 7 segundos para ver progreso de campañas activas
    const interval = setInterval(fetchCampaigns, 7000);
    return () => clearInterval(interval);
  }, [fetchCampaigns, fetchCustomers]);

  // Image base64 Upload helper
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 3 * 1024 * 1024) {
      toast.error('La imagen no debe superar los 3MB');
      return;
    }

    setImageUploading(true);
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async () => {
      try {
        const base64 = reader.result as string;
        const res = await fetchWithTimeout(`${API_BASE_URL}/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image: base64,
            filename: file.name,
            folder: 'banners',
          }),
        });
        const data = await res.json();
        if (data.url) {
          setImageUrl(data.url);
          toast.success('Imagen promocional cargada');
        } else {
          throw new Error();
        }
      } catch {
        toast.error('Error al subir la imagen');
      } finally {
        setImageUploading(false);
      }
    };
  };

  // Filter customers based on search and segment
  const getFilteredCustomers = useCallback(() => {
    const q = clientSearch.toLowerCase().trim();
    let list = customers;

    // Filter by segment
    const now = new Date();
    if (activeSegment === 'recent') {
      // Compras en los últimos 30 días
      const limit = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      list = list.filter(c => c.lastPurchaseDate && new Date(c.lastPurchaseDate) >= limit);
    } else if (activeSegment === 'inactive3m') {
      // Inactivos > 3 meses
      const limit = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      list = list.filter(c => c.lastPurchaseDate && new Date(c.lastPurchaseDate) < limit);
    } else if (activeSegment === 'inactive6m') {
      // Inactivos > 6 meses
      const limit = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
      list = list.filter(c => c.lastPurchaseDate && new Date(c.lastPurchaseDate) < limit);
    }

    // Filter by search query
    if (q) {
      list = list.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        c.lastPurchaseProduct.toLowerCase().includes(q)
      );
    }

    return list;
  }, [customers, clientSearch, activeSegment]);

  // Handle segment quick selection
  const applySegmentSelection = (segment: 'all' | 'recent' | 'inactive3m' | 'inactive6m') => {
    setActiveSegment(segment);
    // Temporal filtered list to select all matching
    const q = clientSearch.toLowerCase().trim();
    let list = customers;
    const now = new Date();
    if (segment === 'recent') {
      const limit = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      list = list.filter(c => c.lastPurchaseDate && new Date(c.lastPurchaseDate) >= limit);
    } else if (segment === 'inactive3m') {
      const limit = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      list = list.filter(c => c.lastPurchaseDate && new Date(c.lastPurchaseDate) < limit);
    } else if (segment === 'inactive6m') {
      const limit = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
      list = list.filter(c => c.lastPurchaseDate && new Date(c.lastPurchaseDate) < limit);
    }
    if (q) {
      list = list.filter(c =>
        c.name.toLowerCase().includes(q) || c.phone.includes(q) || c.lastPurchaseProduct.toLowerCase().includes(q)
      );
    }

    const newSet = new Set<string>();
    list.forEach(c => newSet.add(c.phone));
    setSelectedPhones(newSet);
  };

  const handleToggleSelectAll = () => {
    const visible = getFilteredCustomers();
    const allSelected = visible.every(c => selectedPhones.has(c.phone));
    const next = new Set(selectedPhones);
    if (allSelected) {
      visible.forEach(c => next.delete(c.phone));
    } else {
      visible.forEach(c => next.add(c.phone));
    }
    setSelectedPhones(next);
  };

  const handleTogglePhone = (phone: string) => {
    const next = new Set(selectedPhones);
    if (next.has(phone)) {
      next.delete(phone);
    } else {
      next.add(phone);
    }
    setSelectedPhones(next);
  };

  const handleCreateCampaign = async () => {
    if (!name.trim()) return toast.error('Ingresa un nombre para la campaña');
    if (!message.trim()) return toast.error('Escribe el mensaje de la campaña');
    if (selectedPhones.size === 0) return toast.error('Selecciona al menos un destinatario');

    const selectedCustomers = customers
      .filter(c => selectedPhones.has(c.phone))
      .map(c => ({ name: c.name, phone: c.phone }));

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/whatsapp/campaigns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          message,
          imageUrl,
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
          delaySeconds,
          recipients: selectedCustomers,
        }),
      });

      if (!res.ok) throw new Error();
      toast.success('Campaña creada con éxito');
      setOpenCreate(false);
      // Reset form
      setName('');
      setMessage('');
      setImageUrl('');
      setScheduledAt('');
      setDelaySeconds(10);
      setSelectedPhones(new Set());
      fetchCampaigns();
    } catch {
      toast.error('Error al crear campaña');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (campaignId: string, status: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/whatsapp/campaigns/${campaignId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        toast.success(`Campaña actualizada a: ${status}`);
        fetchCampaigns();
      } else {
        throw new Error();
      }
    } catch {
      toast.error('Error al actualizar estado');
    }
  };

  const handleDeleteCampaign = async (campaignId: string) => {
    if (!window.confirm('¿Seguro que deseas eliminar esta campaña permanentemente?')) return;
    try {
      const res = await fetch(`${API_BASE_URL}/whatsapp/campaigns/${campaignId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        toast.success('Campaña eliminada');
        fetchCampaigns();
      } else {
        throw new Error();
      }
    } catch {
      toast.error('Error al eliminar campaña');
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mt-8">
      {/* HEADER SECTION */}
      <div className="px-6 py-5 border-b border-gray-100 bg-gray-50/50 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="font-bold text-gray-800 flex items-center gap-2 text-lg">
            <Sparkles className="w-5 h-5 text-[#25D366]" />
            Campañas de WhatsApp (Modo Elite)
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            Envía mensajes masivos y promociones con imágenes personalizadas a tus clientes de manera programada y segura.
          </p>
        </div>
        <Button
          onClick={() => { applySegmentSelection('all'); setOpenCreate(true); }}
          className="bg-[#25D366] hover:bg-[#128C7E] text-white font-bold rounded-xl px-5 py-2.5 h-auto transition-all shadow-md active:scale-95 duration-200"
        >
          <Plus className="w-4 h-4 mr-2" /> Crear Campaña
        </Button>
      </div>

      {/* CAMPAIGNS DASHBOARD GRID */}
      <div className="p-6">
        {campaigns.length === 0 ? (
          <div className="text-center py-16 bg-gray-50/40 rounded-xl border border-dashed border-gray-200">
            <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-bold text-sm">No has creado campañas todavía</p>
            <p className="text-xs text-gray-400 mt-1">Haz clic en "Crear Campaña" para fidelizar a tus clientes presenciales y online.</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {campaigns.map(c => {
              const total = c.totalRecipients || 1;
              const progress = Math.min(100, Math.round(((c.sentCount + c.failedCount) / total) * 100));
              
              const statusBadges = {
                draft: 'bg-gray-100 text-gray-700 border-gray-200',
                scheduled: 'bg-blue-50 text-blue-700 border-blue-200',
                active: 'bg-amber-50 text-amber-700 border-amber-200 animate-pulse',
                processing: 'bg-green-50 text-green-700 border-green-200 animate-pulse',
                paused: 'bg-purple-50 text-purple-700 border-purple-200',
                sent: 'bg-emerald-50 text-emerald-850 border-emerald-250',
              };

              const badgeClass = statusBadges[c.status] || 'bg-gray-100 text-gray-700 border-gray-200';

              return (
                <div key={c.id} className="bg-white border border-gray-100 hover:border-gray-200 rounded-2xl p-5 shadow-sm transition-all hover:shadow-md flex flex-col justify-between">
                  <div>
                    {/* Header Card */}
                    <div className="flex justify-between items-start gap-2 mb-3.5">
                      <span className={`text-[10px] uppercase font-extrabold px-2.5 py-1 rounded-full border ${badgeClass}`}>
                        {c.status === 'processing' ? 'Enviando...' : c.status === 'sent' ? 'Completado' : c.status}
                      </span>
                      <span className="text-[10px] text-gray-400 font-mono">
                        {new Date(c.createdAt).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}
                      </span>
                    </div>

                    <h4 className="font-bold text-gray-800 text-base mb-1.5 truncate">{c.name}</h4>
                    <p className="text-xs text-gray-500 line-clamp-3 mb-4 leading-relaxed whitespace-pre-wrap">{c.message}</p>
                    
                    {/* Image Thumbnail */}
                    {c.imageUrl && (
                      <div className="mb-4 relative rounded-lg overflow-hidden border border-gray-100 aspect-[16/9] bg-gray-50 flex items-center justify-center">
                        <img src={c.imageUrl} alt="Promo Attachment" className="object-cover w-full h-full" />
                      </div>
                    )}
                  </div>

                  {/* Progress Section */}
                  <div className="mt-4 pt-4 border-t border-gray-50 space-y-2">
                    <div className="flex justify-between text-[11px] font-bold text-gray-600">
                      <span>Progreso: {progress}%</span>
                      <span>{c.sentCount + c.failedCount} / {c.totalRecipients}</span>
                    </div>
                    {/* Progress Bar */}
                    <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden flex">
                      <div className="bg-emerald-500 h-full transition-all duration-500" style={{ width: `${(c.sentCount / total) * 100}%` }} />
                      <div className="bg-red-500 h-full transition-all duration-500" style={{ width: `${(c.failedCount / total) * 100}%` }} />
                    </div>

                    {/* Stats Counts */}
                    <div className="flex justify-between text-[10px] text-gray-400 font-medium">
                      <span className="text-emerald-600">✓ {c.sentCount} enviados</span>
                      <span className="text-red-500">✗ {c.failedCount} fallidos</span>
                      <span>⏱ {c.delaySeconds}s delay</span>
                    </div>

                    {c.scheduledAt && c.status === 'scheduled' && (
                      <div className="bg-blue-50/50 rounded-lg p-2 flex items-center gap-1.5 border border-blue-100 text-[10px] text-blue-700 font-bold mt-2">
                        <Clock className="w-3.5 h-3.5" />
                        Programado: {new Date(c.scheduledAt).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}
                      </div>
                    )}

                    {/* Action Panel */}
                    <div className="flex gap-2 mt-4 pt-2">
                      <Button
                        onClick={() => setOpenDetails(c)}
                        variant="outline"
                        title="Ver destinatarios"
                        className="flex-1 py-1.5 h-auto text-xs font-bold text-gray-600 rounded-xl hover:bg-gray-50 border-gray-200"
                      >
                        <Eye className="w-3.5 h-3.5 mr-1.5" /> Detalles
                      </Button>

                      {/* Control states */}
                      {c.status === 'processing' && (
                        <Button
                          onClick={() => handleUpdateStatus(c.id, 'paused')}
                          className="bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 py-1.5 h-auto text-xs font-bold rounded-xl"
                        >
                          <Pause className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {c.status === 'paused' && (
                        <Button
                          onClick={() => handleUpdateStatus(c.id, 'active')}
                          className="bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 py-1.5 h-auto text-xs font-bold rounded-xl"
                        >
                          <Play className="w-3.5 h-3.5" />
                        </Button>
                      )}

                      <Button
                        onClick={() => handleDeleteCampaign(c.id)}
                        className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-100 py-1.5 h-auto text-xs font-bold rounded-xl"
                        title="Eliminar campaña"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* DIALOG 1: CREATE CAMPAIGN */}
      <Dialog open={openCreate} onOpenChange={setOpenCreate}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl p-6 bg-white">
          <DialogHeader>
            <DialogTitle className="font-extrabold text-gray-800 text-xl flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-emerald-500 animate-pulse" />
              Nueva Campaña de Fidelización
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              Diseña una promoción, selecciona tus clientes a partir del historial y agrégale una imagen de impacto.
            </DialogDescription>
          </DialogHeader>

          <div className="grid lg:grid-cols-12 gap-6 mt-4">
            {/* Form Left (6 cols) */}
            <div className="lg:col-span-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Nombre de la Campaña</label>
                <Input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Ej: Promo Flash - Audífonos 2x1"
                  className="rounded-xl border-gray-200 focus:border-green-500 py-2.5"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1 flex justify-between">
                  <span>Mensaje de WhatsApp</span>
                  <span className="text-[10px] text-emerald-600 font-semibold">Inserta {"{{nombre}}"} para personalizar</span>
                </label>
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder="Hola {{nombre}}, tenemos una promoción exclusiva para ti..."
                  rows={8}
                  className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-green-500 transition-all font-mono leading-relaxed"
                />
              </div>

              {/* Image promotional attachment */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Imagen de Campaña (Opcional)</label>
                <div className="flex items-center gap-3">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    id="campaign-img-file"
                    className="hidden"
                  />
                  <label
                    htmlFor="campaign-img-file"
                    className="flex items-center justify-center gap-2 border border-gray-200 hover:border-green-500 border-dashed rounded-xl px-4 py-3 cursor-pointer text-xs font-bold text-gray-600 hover:text-green-700 transition-all bg-gray-50/50 w-full"
                  >
                    {imageUploading ? (
                      <>Cargando...</>
                    ) : (
                      <><ImageIcon className="w-4 h-4" /> Seleccionar Imagen promocional</>
                    )}
                  </label>
                </div>
                {imageUrl && (
                  <div className="mt-3 flex items-center gap-2 bg-green-50 border border-green-200 p-2 rounded-xl text-xs font-semibold text-green-800">
                    <Check className="w-4 h-4 shrink-0" />
                    <span className="truncate flex-1">{imageUrl}</span>
                    <button onClick={() => setImageUrl('')} className="text-red-500 hover:text-red-700">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* Delivery and delay config */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Delay entre envíos (segundos)</label>
                  <Input
                    type="number"
                    value={delaySeconds}
                    min={5}
                    max={60}
                    onChange={e => setDelaySeconds(Math.max(5, Number(e.target.value) || 5))}
                    className="rounded-xl border-gray-200 focus:border-green-500"
                  />
                  <span className="text-[10px] text-gray-400 mt-1 block">Recomendado: 10s o más para seguridad.</span>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Programar fecha (Opcional)</label>
                  <Input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={e => setScheduledAt(e.target.value)}
                    className="rounded-xl border-gray-200 focus:border-green-500"
                  />
                </div>
              </div>
            </div>

            {/* Customers selection Right (6 cols) */}
            <div className="lg:col-span-6 flex flex-col h-[520px] border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
              <div className="p-4 bg-gray-50 border-b border-gray-100 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-emerald-600" />
                    Destinatarios ({selectedPhones.size} seleccionados)
                  </span>
                  <button
                    onClick={handleToggleSelectAll}
                    className="text-xs text-emerald-600 hover:text-emerald-800 font-bold"
                  >
                    {getFilteredCustomers().every(c => selectedPhones.has(c.phone)) ? 'Deseleccionar todos' : 'Seleccionar filtrados'}
                  </button>
                </div>

                {/* Filter segments tabs */}
                <div className="flex flex-wrap gap-1 bg-white p-1 rounded-lg border border-gray-200 text-[10px] font-bold">
                  <button
                    onClick={() => applySegmentSelection('all')}
                    className={`flex-1 py-1 px-1.5 rounded transition-all ${activeSegment === 'all' ? 'bg-[#25D366] text-white' : 'text-gray-500 hover:bg-gray-100'}`}
                  >
                    Todos
                  </button>
                  <button
                    onClick={() => applySegmentSelection('recent')}
                    className={`flex-1 py-1 px-1.5 rounded transition-all ${activeSegment === 'recent' ? 'bg-[#25D366] text-white' : 'text-gray-500 hover:bg-gray-100'}`}
                  >
                    Último mes
                  </button>
                  <button
                    onClick={() => applySegmentSelection('inactive3m')}
                    className={`flex-1 py-1 px-1.5 rounded transition-all ${activeSegment === 'inactive3m' ? 'bg-[#25D366] text-white' : 'text-gray-500 hover:bg-gray-100'}`}
                    title="Inactivos > 3 meses"
                  >
                    Inactivos +3m
                  </button>
                  <button
                    onClick={() => applySegmentSelection('inactive6m')}
                    className={`flex-1 py-1 px-1.5 rounded transition-all ${activeSegment === 'inactive6m' ? 'bg-[#25D366] text-white' : 'text-gray-500 hover:bg-gray-100'}`}
                    title="Inactivos > 6 meses"
                  >
                    Inactivos +6m
                  </button>
                </div>

                {/* Search box */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <Input
                    value={clientSearch}
                    onChange={e => setClientSearch(e.target.value)}
                    placeholder="Buscar cliente, teléfono o producto..."
                    className="pl-9 rounded-lg border-gray-200 h-8 text-xs"
                  />
                </div>
              </div>

              {/* Customers list content */}
              <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
                {getFilteredCustomers().map(c => {
                  const isChecked = selectedPhones.has(c.phone);
                  return (
                    <div
                      key={c.phone}
                      onClick={() => handleTogglePhone(c.phone)}
                      className={`flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer select-none ${
                        isChecked ? 'bg-emerald-50/50 border-emerald-300' : 'bg-white border-gray-100 hover:bg-gray-50/60'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        readOnly
                        className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 mt-1 h-3.5 w-3.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-baseline">
                          <h5 className="text-xs font-bold text-gray-800 truncate">{c.name}</h5>
                          <span className="text-[9px] text-gray-400 shrink-0 font-mono">
                            Compra: {new Date(c.lastPurchaseDate).toLocaleDateString('es-CO')}
                          </span>
                        </div>
                        <p className="text-[10px] text-gray-500 font-mono mt-0.5">+{c.phone}</p>
                        <p className="text-[10px] text-gray-400 mt-1 truncate">
                          🛍️ {c.lastPurchaseProduct || 'Ninguno'}
                        </p>
                      </div>
                    </div>
                  );
                })}
                {getFilteredCustomers().length === 0 && (
                  <div className="text-center py-10 text-gray-400 text-xs">
                    Ningún cliente coincide con los filtros
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Submits buttons */}
          <div className="mt-6 pt-4 border-t border-gray-100 flex justify-end gap-3">
            <Button
              onClick={() => setOpenCreate(false)}
              variant="outline"
              className="rounded-xl px-5 border-gray-200"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleCreateCampaign}
              disabled={loading}
              className="bg-[#25D366] hover:bg-[#128C7E] text-white font-bold rounded-xl px-6"
            >
              {loading ? 'Creando...' : scheduledAt ? 'Programar Campaña' : 'Iniciar Campaña'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* DIALOG 2: DETAILS CAMPAIGN PROGRESS */}
      <Dialog open={openDetails !== null} onOpenChange={open => !open && setOpenDetails(null)}>
        {openDetails && (
          <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto rounded-2xl p-6 bg-white">
            <DialogHeader>
              <DialogTitle className="font-extrabold text-gray-800 text-lg flex items-center justify-between">
                <span>Campaña: {openDetails.name}</span>
                <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded border bg-gray-50">
                  {openDetails.status}
                </span>
              </DialogTitle>
              <DialogDescription className="text-xs text-gray-500">
                Lista de destinatarios programados y estado de entrega individual.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 mt-4">
              {/* Resumen */}
              <div className="grid grid-cols-3 gap-3 bg-gray-50 p-4 rounded-xl text-center border border-gray-100">
                <div>
                  <div className="text-[10px] text-gray-400 font-bold uppercase">Destinatarios</div>
                  <div className="text-xl font-extrabold text-gray-700">{openDetails.totalRecipients}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-400 font-bold uppercase text-emerald-600">Enviados</div>
                  <div className="text-xl font-extrabold text-emerald-600">{openDetails.sentCount}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-400 font-bold uppercase text-red-500">Fallidos</div>
                  <div className="text-xl font-extrabold text-red-500">{openDetails.failedCount}</div>
                </div>
              </div>

              {/* List */}
              <div className="border border-gray-100 rounded-xl overflow-hidden">
                <div className="max-h-[300px] overflow-y-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-gray-50 text-gray-600 font-bold sticky top-0 border-b border-gray-100">
                      <tr>
                        <th className="p-3">Destinatario</th>
                        <th className="p-3">Teléfono</th>
                        <th className="p-3 text-center">Estado</th>
                        <th className="p-3">Error / Procesado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openDetails.recipients.map((r, idx) => {
                        const statusColor = {
                          pending: 'text-gray-500 bg-gray-100',
                          sent: 'text-green-700 bg-green-50 border-green-200',
                          failed: 'text-red-700 bg-red-50 border-red-200',
                        };
                        const colorClass = statusColor[r.status] || 'text-gray-500 bg-gray-100';

                        return (
                          <tr key={idx} className="border-b border-gray-50 hover:bg-gray-50/50">
                            <td className="p-3 font-bold text-gray-800">{r.name}</td>
                            <td className="p-3 text-gray-500 font-mono">+{r.phone}</td>
                            <td className="p-3 text-center">
                              <span className={`px-2 py-0.5 rounded text-[9px] uppercase font-bold border ${colorClass}`}>
                                {r.status}
                              </span>
                            </td>
                            <td className="p-3 text-gray-400 text-[10px] truncate max-w-[200px]">
                              {r.status === 'failed' ? (
                                <span className="text-red-500 flex items-center gap-1">
                                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                  {r.error || 'Fallo'}
                                </span>
                              ) : r.processedAt ? (
                                new Date(r.processedAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                              ) : (
                                'Esperando...'
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-gray-100 flex justify-end">
              <Button onClick={() => setOpenDetails(null)} className="rounded-xl px-5">
                Cerrar
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
