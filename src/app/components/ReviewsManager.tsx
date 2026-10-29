import { useState, useEffect } from 'react';
import { Star, CheckCircle, XCircle, Trash2, ShieldCheck, PenSquare, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { API_ORIGIN } from '../lib/api-base';
import { useProducts } from './ProductContext';

interface Review {
  _id: string;
  productId: string;
  author: string;
  rating: number;
  comment: string;
  date: string;
  status: 'pending' | 'approved' | 'rejected';
  verifiedPurchase: boolean;
}

export function ReviewsManager() {
  const { products } = useProducts();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualForm, setManualForm] = useState({ productId: '', author: '', rating: 5, comment: '', verifiedPurchase: true });

  const fetchReviews = async () => {
    try {
      const res = await fetch(`${API_ORIGIN}/api/admin/reviews`);
      if (res.ok) {
        const data = await res.json();
        setReviews(data);
      }
    } catch (err) {
      toast.error('Error al cargar reseñas');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReviews();
  }, []);

  const updateReviewStatus = async (id: string, status: 'approved' | 'rejected') => {
    try {
      const res = await fetch(`${API_ORIGIN}/api/admin/reviews/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (res.ok) {
        toast.success(`Reseña ${status === 'approved' ? 'aprobada' : 'rechazada'}`);
        fetchReviews();
      }
    } catch (err) {
      toast.error('Error al actualizar reseña');
    }
  };

  const deleteReview = async (id: string) => {
    toast('¿Eliminar esta reseña permanentemente?', {
      action: {
        label: 'Sí, eliminar',
        onClick: async () => {
          try {
            const res = await fetch(`${API_ORIGIN}/api/admin/reviews/${id}`, { method: 'DELETE' });
            if (res.ok) {
              toast.success('Reseña eliminada');
              fetchReviews();
            }
          } catch (err) {
            toast.error('Error al eliminar');
          }
        }
      },
      cancel: { label: 'Cancelar', onClick: () => {} },
    });
  };

  const submitManualReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualForm.productId) {
      toast.error('Por favor, selecciona un producto');
      return;
    }
    try {
      const res = await fetch(`${API_ORIGIN}/api/admin/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manualForm)
      });
      if (res.ok) {
        toast.success('Reseña inyectada con éxito');
        setShowManualForm(false);
        setManualForm({ productId: '', author: '', rating: 5, comment: '', verifiedPurchase: true });
        fetchReviews();
      }
    } catch (err) {
      toast.error('Error al inyectar reseña');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 bg-white p-4 sm:p-6 rounded-[1.5rem] sm:rounded-[2rem] border border-slate-100 shadow-[0_10px_30px_rgba(0,0,0,0.02)] sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h2 className="text-lg sm:text-xl font-black text-slate-900">Gestor de Reseñas</h2>
          <p className="text-sm text-slate-500">Aprueba reseñas de clientes o inyecta "Social Proof"</p>
        </div>
        <button
          onClick={() => setShowManualForm(!showManualForm)}
          className="w-full sm:w-auto shrink-0 min-h-11 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-black text-sm transition-all shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2 sm:min-h-0"
        >
          <PenSquare className="w-4 h-4 shrink-0" />
          Añadir Reseña Manual
        </button>
      </div>

      {showManualForm && (
        <div className="bg-indigo-50 border border-indigo-100 p-4 sm:p-6 rounded-[1.5rem] sm:rounded-[2rem] animate-in fade-in slide-in-from-top-4 duration-300">
          <h3 className="font-black text-indigo-900 mb-4 flex items-center gap-2">
            <Star className="w-5 h-5 text-amber-500 fill-amber-500" />
            Inyectar Social Proof
          </h3>
          <form onSubmit={submitManualReview} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-indigo-800 mb-1">Producto</label>
              <select required value={manualForm.productId} onChange={e => setManualForm({...manualForm, productId: e.target.value})} className="w-full p-2.5 rounded-xl border border-indigo-200 bg-white">
                <option value="" disabled>Selecciona el producto...</option>
                {products.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-indigo-800 mb-1">Nombre del Autor</label>
              <input required type="text" value={manualForm.author} onChange={e => setManualForm({...manualForm, author: e.target.value})} className="w-full p-2.5 rounded-xl border border-indigo-200" placeholder="Ej. Carlos Martínez" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-indigo-800 mb-1">Estrellas</label>
              <select value={manualForm.rating} onChange={e => setManualForm({...manualForm, rating: Number(e.target.value)})} className="w-full p-2.5 rounded-xl border border-indigo-200 bg-white">
                <option value="5">⭐⭐⭐⭐⭐ (5)</option>
                <option value="4">⭐⭐⭐⭐ (4)</option>
                <option value="3">⭐⭐⭐ (3)</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-indigo-800 mb-1">Comentario</label>
              <textarea required value={manualForm.comment} onChange={e => setManualForm({...manualForm, comment: e.target.value})} className="w-full p-2.5 rounded-xl border border-indigo-200" rows={3} placeholder="¡Excelente producto! Me llegó súper rápido..." />
            </div>
            <div className="md:col-span-2 flex md:justify-end">
              <button type="submit" className="w-full md:w-auto min-h-11 px-6 py-2.5 bg-indigo-600 text-white font-bold rounded-xl shadow-md md:min-h-0">Guardar Reseña</button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 text-slate-300 animate-spin" /></div>
      ) : (
        <div className="grid gap-4">
          {reviews.length === 0 ? (
            <p className="text-center text-slate-500 py-8">No hay reseñas registradas en la base de datos.</p>
          ) : (
            reviews.map(review => (
              <div key={review._id} className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-100 flex flex-col md:flex-row gap-3 md:gap-4 items-start md:items-center justify-between">
                <div className="min-w-0 w-full md:w-auto">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="font-black text-slate-900 break-words">{review.author}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      review.status === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                      review.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {review.status === 'approved' ? 'Aprobada' : review.status === 'pending' ? 'Pendiente' : 'Rechazada'}
                    </span>
                    {review.verifiedPurchase && <ShieldCheck className="w-3 h-3 text-emerald-500 shrink-0" />}
                  </div>
                  {/* El productId es un slug sin espacios ("redmi-note-15-pro-5g"):
                      junto a las cinco estrellas se salía de la tarjeta. */}
                  <div className="flex flex-wrap items-center gap-1 mb-1">
                    {[1,2,3,4,5].map(s => <Star key={s} className={`w-3 h-3 shrink-0 ${s <= review.rating ? 'fill-amber-400 text-amber-400' : 'text-slate-200'}`} />)}
                    <span className="min-w-0 text-xs text-slate-400 ml-2 break-all">Prod: <b className="text-slate-700">{review.productId}</b></span>
                  </div>
                  <p className="text-sm text-slate-600 italic break-words">"{review.comment}"</p>
                </div>
                {/* Aprobar / rechazar / eliminar: con `p-2` y un icono de 20px
                    medían 36px. Son las tres acciones del módulo y están una al
                    lado de la otra, así que fallar el toque cuesta una reseña
                    aprobada por error. 44px en móvil, 36px de sm hacia arriba. */}
                <div className="flex shrink-0 gap-2">
                  {review.status === 'pending' && (
                    <>
                      <button onClick={() => updateReviewStatus(review._id, 'approved')} className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 sm:h-auto sm:w-auto sm:p-2" aria-label={`Aprobar reseña de ${review.author}`} title="Aprobar"><CheckCircle className="w-5 h-5"/></button>
                      <button onClick={() => updateReviewStatus(review._id, 'rejected')} className="flex h-11 w-11 items-center justify-center rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 sm:h-auto sm:w-auto sm:p-2" aria-label={`Rechazar reseña de ${review.author}`} title="Rechazar"><XCircle className="w-5 h-5"/></button>
                    </>
                  )}
                  {review.status === 'rejected' && (
                    <button onClick={() => updateReviewStatus(review._id, 'approved')} className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 sm:h-auto sm:w-auto sm:p-2" aria-label={`Aprobar reseña de ${review.author}`} title="Aprobar"><CheckCircle className="w-5 h-5"/></button>
                  )}
                  <button onClick={() => deleteReview(review._id)} className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-50 text-slate-400 hover:bg-red-50 hover:text-red-500 sm:h-auto sm:w-auto sm:p-2" aria-label={`Eliminar reseña de ${review.author}`} title="Eliminar"><Trash2 className="w-5 h-5"/></button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
