import { useProducts } from '../ProductContext';
import { ProductCard } from '../ProductCard';
import { useState } from 'react';
import { Package } from 'lucide-react';

interface CategoryPageProps {
  category: string;
}

const categoryTitles: Record<string, string> = {
  moviles: 'Teléfonos',
  smartwatch: 'Smartwatch',
  audifonos: 'Audífonos',
  tablet: 'Tablets',
  accesorios: 'Estilo de Vida',
  scooter: 'Scooter Eléctrico',
  poco: 'POCO'
};

const categoryDescriptions: Record<string, string> = {
  moviles: 'Tecnología de vanguardia en tus manos',
  smartwatch: 'El compañero perfecto para tu día a día',
  audifonos: 'Sonido de alta calidad',
  tablet: 'Productividad y entretenimiento en formato grande',
  accesorios: 'Complementa tu experiencia Xiaomi',
  scooter: 'Movilidad inteligente y sostenible',
  poco: 'Potencia sin compromisos'
};

export function CategoryPage({ category }: CategoryPageProps) {
  const { products, loading } = useProducts();
  const [sortBy, setSortBy] = useState<'price-asc' | 'price-desc' | 'name'>('price-asc');

  // Normalize category slugs so 'tablet' matches products saved as 'tablet' or 'tablets'
  const categoryAliases: Record<string, string[]> = {
    tablet: ['tablet', 'tablets', 'Tablet', 'Tablets'],
    moviles: ['moviles', 'móviles', 'telefono', 'teléfono', 'telefonos', 'teléfonos'],
  };
  const aliases = categoryAliases[category] ?? [category];
  let categoryProducts = products.filter(p => aliases.some(a => p.category?.toLowerCase() === a.toLowerCase()));

  categoryProducts = [...categoryProducts].sort((a, b) => {
    if (sortBy === 'price-asc') return a.price - b.price;
    if (sortBy === 'price-desc') return b.price - a.price;
    return a.name.localeCompare(b.name);
  });

  const isPoco = category === 'poco';

  return (
    <div className="bg-white min-h-screen">
      {/* Header — compacto en móvil */}
      <div className={`py-8 md:py-14 ${isPoco ? 'bg-gradient-to-br from-yellow-400 to-yellow-500' : 'bg-gray-50'}`}>
        <div className="container mx-auto px-4 text-center">
          <h1 className={`text-2xl md:text-5xl font-light mb-1 md:mb-3 ${
            isPoco ? 'text-black font-semibold' : 'text-gray-900'
          }`}>
            {categoryTitles[category] || category}
          </h1>
          <p className={`font-light text-sm md:text-lg mb-1 ${
            isPoco ? 'text-black/80' : 'text-gray-500'
          }`}>
            {categoryDescriptions[category] || ''}
          </p>
          <p className={`font-light text-xs md:text-sm ${
            isPoco ? 'text-black/70' : 'text-gray-400'
          }`}>
            {categoryProducts.length} productos disponibles
          </p>
        </div>
      </div>

      <div className="container mx-auto px-3 md:px-4 py-4 md:py-12">
        {/* Filtros — compacto en móvil */}
        <div className="bg-white border-t border-b border-gray-200 py-3 mb-4 md:mb-10 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs md:text-sm text-gray-600 font-light">
            {categoryProducts.length} productos
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs md:text-sm text-gray-600 font-light hidden sm:inline">Ordenar por:</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="border border-gray-300 bg-white text-xs md:text-sm text-gray-900 px-2 md:px-4 py-1.5 md:py-2 focus:outline-none focus:ring-1 focus:ring-orange-500 cursor-pointer font-light rounded"
            >
              <option value="price-asc">Menor precio</option>
              <option value="price-desc">Mayor precio</option>
              <option value="name">A–Z</option>
            </select>
          </div>
        </div>

        {/* Grid — 2 columnas en móvil, 3 en tablet, 4 en desktop */}
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="animate-pulse bg-gray-100 rounded h-64 md:h-80" />
            ))}
          </div>
        ) : categoryProducts.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-6">
            {categoryProducts.map(product => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        ) : (
          <div className="text-center py-16 md:py-20">
            <Package className="w-16 h-16 md:w-24 md:h-24 mx-auto mb-4 text-gray-300" />
            <h3 className="text-xl md:text-2xl font-light text-gray-700 mb-2">
              No hay productos en esta categoría
            </h3>
            <p className="text-gray-500 font-light text-sm">
              Pronto agregaremos más productos. ¡Vuelve pronto!
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
