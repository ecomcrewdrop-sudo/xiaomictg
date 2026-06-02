import { useState, useEffect } from 'react';
import { Star, ShieldCheck, PenSquare, Loader2 } from 'lucide-react';
import { ReviewModal } from './ReviewModal';
import { API_ORIGIN } from '../lib/api-base';

interface ProductReviewsProps {
  productId: string;
  productName: string;
}

interface Review {
  _id: string;
  author: string;
  rating: number;
  comment: string;
  date: string;
  verifiedPurchase: boolean;
}

export function ProductReviews({ productId, productName }: ProductReviewsProps) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    const fetchReviews = async () => {
      try {
        const res = await fetch(`${API_ORIGIN}/api/products/${productId}/reviews`);
        if (res.ok) {
          const data = await res.json();
          setReviews(data);
        }
      } catch (err) {
        console.error('Error fetching reviews:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchReviews();
  }, [productId]);

  const averageRating = reviews.length > 0
    ? (reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length).toFixed(1)
    : '0.0';

  return (
    <div className="py-8">
      {/* Resumen Superior */}
      <div className="flex flex-col md:flex-row gap-8 items-center md:items-start bg-white rounded-3xl p-6 md:p-8 shadow-[0_10px_40px_-15px_rgba(0,0,0,0.05)] border border-slate-100 mb-8">
        <div className="text-center md:text-left flex-shrink-0">
          <h3 className="text-5xl font-black text-slate-900 tracking-tighter mb-2">
            {reviews.length > 0 ? averageRating : '5.0'}
            <span className="text-2xl text-slate-400 font-bold">/5</span>
          </h3>
          <div className="flex items-center justify-center md:justify-start gap-1 mb-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <Star
                key={star}
                className={`w-5 h-5 ${
                  star <= Math.round(Number(averageRating) || 5)
                    ? 'fill-amber-400 text-amber-400'
                    : 'text-slate-200 fill-slate-100'
                }`}
              />
            ))}
          </div>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">
            {reviews.length} Opiniones
          </p>
        </div>

        <div className="flex-1 w-full flex flex-col justify-center">
          <button
            onClick={() => setIsModalOpen(true)}
            className="md:ml-auto w-full md:w-auto px-6 py-3.5 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl font-black text-sm transition-all shadow-lg shadow-slate-900/20 flex items-center justify-center gap-2"
          >
            <PenSquare className="w-4 h-4" />
            Escribir una opinión
          </button>
        </div>
      </div>

      {/* Lista de Reseñas */}
      <div className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
          </div>
        ) : reviews.length > 0 ? (
          reviews.map((review) => (
            <div key={review._id} className="bg-white rounded-[2rem] p-6 border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-black text-slate-900">{review.author}</span>
                    {review.verifiedPurchase && (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                        <ShieldCheck className="w-3 h-3" />
                        Compra Verificada
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star
                        key={star}
                        className={`w-3.5 h-3.5 ${
                          star <= review.rating
                            ? 'fill-amber-400 text-amber-400'
                            : 'text-slate-200 fill-slate-100'
                        }`}
                      />
                    ))}
                  </div>
                </div>
                <span className="text-xs font-bold text-slate-400">
                  {new Date(review.date).toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' })}
                </span>
              </div>
              <p className="text-slate-600 text-sm leading-relaxed">
                {review.comment}
              </p>
            </div>
          ))
        ) : (
          <div className="text-center py-12 bg-slate-50 rounded-[2rem] border border-slate-100 border-dashed">
            <Star className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h4 className="font-black text-slate-700 text-lg mb-1">Aún no hay opiniones</h4>
            <p className="text-slate-500 text-sm">Sé el primero en compartir tu experiencia.</p>
          </div>
        )}
      </div>

      <ReviewModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        productId={productId}
        productName={productName}
      />
    </div>
  );
}
