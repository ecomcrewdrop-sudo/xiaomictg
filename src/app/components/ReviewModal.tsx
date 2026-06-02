import { useState } from 'react';
import { Star, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { API_ORIGIN } from '../lib/api-base';

interface ReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  productId: string;
  productName: string;
}

export function ReviewModal({ isOpen, onClose, productId, productName }: ReviewModalProps) {
  const [rating, setRating] = useState(5);
  const [hoverRating, setHoverRating] = useState(0);
  const [author, setAuthor] = useState('');
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!author.trim() || !comment.trim()) {
      toast.error('Por favor completa todos los campos.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`${API_ORIGIN}/api/products/${productId}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author, rating, comment }),
      });

      if (res.ok) {
        toast.success('¡Gracias por tu opinión! Será publicada pronto.');
        onClose();
        setAuthor('');
        setComment('');
        setRating(5);
      } else {
        throw new Error('Error al enviar la reseña');
      }
    } catch (err) {
      toast.error('Hubo un problema. Inténtalo más tarde.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h3 className="font-black text-slate-900 text-lg">Escribe tu Opinión</h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div className="text-center">
            <p className="text-sm font-bold text-slate-500 mb-2 uppercase tracking-wide">¿Qué te pareció el {productName}?</p>
            <div className="flex justify-center gap-1.5">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  onClick={() => setRating(star)}
                  className="focus:outline-none transition-transform hover:scale-110"
                >
                  <Star
                    className={`w-10 h-10 transition-colors ${
                      star <= (hoverRating || rating)
                        ? 'fill-amber-400 text-amber-400 drop-shadow-sm'
                        : 'text-slate-200'
                    }`}
                  />
                </button>
              ))}
            </div>
            <p className="text-xs font-bold text-amber-500 mt-2">
              {rating === 5 ? '¡Excelente!' : rating === 4 ? 'Muy Bueno' : rating === 3 ? 'Bueno' : rating === 2 ? 'Regular' : 'Malo'}
            </p>
          </div>

          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">Tu Nombre</label>
            <input
              type="text"
              required
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="Ej. María Gómez"
              className="w-full px-4.5 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:bg-white focus:border-amber-500 focus:ring-4 focus:ring-amber-500/10 transition-all font-semibold text-slate-800 placeholder:text-slate-400 shadow-inner text-sm"
            />
          </div>

          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">Tu Experiencia</label>
            <textarea
              required
              rows={4}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="¿Qué fue lo que más te gustó?"
              className="w-full px-4.5 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:bg-white focus:border-amber-500 focus:ring-4 focus:ring-amber-500/10 transition-all font-semibold text-slate-800 placeholder:text-slate-400 shadow-inner text-sm resize-none"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white rounded-2xl font-black text-base shadow-lg shadow-orange-500/20 transition-all flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              'Enviar Opinión'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
