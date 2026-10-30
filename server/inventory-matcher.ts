/**
 * Módulo de matching inteligente de inventario y resolución de combos.
 *
 * Resuelve:
 * 1. Desglose de combos "Teléfono + Audífonos" (obsequios/regalos) para descontar ambos productos.
 * 2. Normalización de nombres de productos (manejo de GB, RAM, modelos 15C vs 15 C, etc.).
 * 3. Matching preciso contra la colección `inventory` sin colisiones entre celulares y accesorios.
 * 4. Descuento sincronizado de stock tanto en `inventory` como en el catálogo web `products`.
 */

export const ACCESSORY_WORDS = [
  'buds', 'audifonos', 'audifono', 'auricular', 'auriculares',
  'reloj', 'watch', 'band', 'parlante', 'sound', 'cargador',
  'cable', 'vidrio', 'forro', 'forros', 'power bank', 'soporte'
];

export const PHONE_SERIES = [
  'note', 'poco', 'redmi 12', 'redmi 13', 'redmi 14', 'redmi 15',
  'redmi 16', 'redmi 17', 'redmi a', 'redmi pad', 'xiaomi 12',
  'xiaomi 13', 'xiaomi 14', 'xiaomi 15', 'celular', 'telefono', 'movil'
];

/**
 * Devuelve la fecha actual en zona horaria de Colombia (America/Bogota) en formato YYYY-MM-DD.
 */
export function getFechaColombia(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(date);
}

/**
 * Normaliza texto para búsqueda tolerante a mayúsculas, tildes, espacios y variantes de almacenamiento.
 * Ej: "REDMI 15 C 256 GB 8 RAM " -> "redmi 15c 256gb 8ram"
 * Ej: "Redmi 15C 256GB/8RAM" -> "redmi 15c 256gb 8ram"
 */
export function normalizeInventoryText(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Quitar tildes
    .replace(/(\d+)\s+([a-z])\b/gi, '$1$2') // 15 c -> 15c, 5 g -> 5g
    .replace(/(\d+)\s*(gb|tb|ram)/gi, '$1$2') // 256 gb -> 256gb
    .replace(/(\d+)\s*\/\s*(\d+)/g, '$1 $2') // 256/8 -> 256 8
    .replace(/[+(),\-_/]/g, ' ') // Separadores a espacios
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Desglosa un nombre de producto compuesto en Producto Principal (ej. Teléfono)
 * y Producto Secundario / Combo / Obsequio (ej. Audífonos / Buds).
 */
export function parseCombo(fullProductName: string): { mainPart: string; giftPart: string } {
  if (!fullProductName) return { mainPart: '', giftPart: '' };

  let mainPart = fullProductName.trim();
  let giftPart = '';

  if (fullProductName.includes('+')) {
    const parts = fullProductName.split('+');
    mainPart = parts[0].trim();
    giftPart = parts.slice(1).join(' ').trim();
  } else if (/\bcombo\b/i.test(fullProductName)) {
    const parts = fullProductName.split(/\bcombo\b/i);
    mainPart = parts[0].trim();
    giftPart = parts.slice(1).join(' ').trim();
  }

  // Si giftPart contiene tokens de almacenamiento (ej. "Buds 6 play (obsequio) 512GB/8RAM"),
  // ese almacenamiento le pertenece al teléfono principal.
  const storageMatch = giftPart.match(/\b\d+\s*(?:gb|tb)(?:\s*\/\s*\d+\s*(?:gb|ram))?\b/i);
  if (storageMatch) {
    mainPart = `${mainPart} ${storageMatch[0]}`;
    giftPart = giftPart.replace(storageMatch[0], '').trim();
  }

  // Limpiar etiquetas decorativas de obsequio
  giftPart = giftPart.replace(/\((?:obsequio|regalo|incluido)\)/gi, '').trim();

  return { mainPart, giftPart };
}

/**
 * Determina si el texto corresponde a un teléfono / móvil / tablet.
 */
export function isPhone(text: string): boolean {
  const norm = normalizeInventoryText(text);
  const hasAccessory = ACCESSORY_WORDS.some(w => norm.includes(w));
  if (hasAccessory) return false;
  return PHONE_SERIES.some(s => norm.includes(s)) || /\b(celular|telefono|movil|tablet)\b/i.test(norm);
}

/**
 * Determina si el texto corresponde a un artículo de audio (buds, audífonos, parlante).
 */
export function isAudio(text: string): boolean {
  const norm = normalizeInventoryText(text);
  return ['buds', 'audifonos', 'audifono', 'auricular', 'auriculares', 'sound', 'parlante'].some(w => norm.includes(w));
}

export interface InventoryItemLike {
  id: string;
  producto: string;
  cantidad?: number;
  precioCompra?: number;
  precioVenta?: number;
  estado?: string;
  imei?: string;
  esPropio?: boolean;
  proveedor?: string;
  categoria?: string;
}

/**
 * Encuentra el mejor item disponible en el inventario para un texto de búsqueda dado,
 * considerando tokens de modelo, almacenamiento (GB), RAM y tipo de producto.
 */
export function findBestInventoryMatch(
  availableItems: InventoryItemLike[],
  searchTerm: string,
  kind: 'phone' | 'audio' | 'any' = 'any',
  excludeId: string | null = null
): InventoryItemLike | null {
  if (!searchTerm || searchTerm.trim().length < 2) return null;

  const normalized = normalizeInventoryText(searchTerm);
  const words = normalized.split(' ').filter(w => w.length >= 2 && !['con', 'para', 'del', 'las', 'los', 'de', 'el', 'la'].includes(w));

  let bestMatch: InventoryItemLike | null = null;
  let bestScore = 0;

  for (const item of availableItems) {
    if (excludeId && item.id === excludeId) continue;
    if ((item.cantidad || 0) < 1) continue;
    if (item.estado && item.estado !== 'disponible') continue;

    const itemNorm = normalizeInventoryText(item.producto);
    const itemWords = itemNorm.split(' ');

    if (kind === 'phone') {
      if (ACCESSORY_WORDS.some(w => itemNorm.includes(w))) continue;
      if (normalized.includes('note') && !itemNorm.includes('note')) continue;
      if (!normalized.includes('note') && itemNorm.includes('note')) continue;
      if (normalized.includes('poco') && !itemNorm.includes('poco')) continue;
      if (!normalized.includes('poco') && itemNorm.includes('poco')) continue;
    } else if (kind === 'audio') {
      if (!isAudio(itemNorm)) continue;
    }

    // Números de modelo (ej. "15c", "15", "17", "x8", "a7")
    const searchModels = normalized.match(/\b([a-z]?\d+[a-z]?)\b/g)?.filter(m => !m.endsWith('gb') && !m.endsWith('ram') && !m.endsWith('w') && !m.endsWith('mah')) || [];
    const itemModels = itemNorm.match(/\b([a-z]?\d+[a-z]?)\b/g)?.filter(m => !m.endsWith('gb') && !m.endsWith('ram') && !m.endsWith('w') && !m.endsWith('mah')) || [];

    if (searchModels.length > 0 && itemModels.length > 0) {
      const sharesModel = searchModels.some(sm => itemModels.includes(sm));
      if (!sharesModel) continue; // Model mismatch
    }

    let score = 0;
    for (const w of words) {
      if (itemWords.includes(w)) {
        score += 3;
      } else if (itemNorm.includes(w)) {
        score += 1;
      }
    }

    // Coincidencia de almacenamiento (GB / TB)
    const searchStorage = searchTerm.match(/\b\d+\s*(?:gb|tb)\b/i);
    const itemStorage = item.producto.match(/\b\d+\s*(?:gb|tb)\b/i);
    if (searchStorage && itemStorage) {
      const s1 = normalizeInventoryText(searchStorage[0]);
      const s2 = normalizeInventoryText(itemStorage[0]);
      if (s1 === s2) {
        score += 5;
      } else {
        continue; // Storage mismatch
      }
    }

    // Coincidencia de RAM
    const searchRam = searchTerm.match(/\b\d+\s*ram\b/i);
    const itemRam = item.producto.match(/\b\d+\s*ram\b/i);
    if (searchRam && itemRam) {
      const r1 = normalizeInventoryText(searchRam[0]);
      const r2 = normalizeInventoryText(itemRam[0]);
      if (r1 === r2) score += 3;
    }

    if (score > bestScore && score >= 3) {
      bestScore = score;
      bestMatch = item;
    }
  }

  return bestMatch;
}

/**
 * Descuenta la cantidad especificada de un item de inventario.
 * Si la cantidad llega a 0, lo marca como 'vendido'.
 */
export async function descontarItemInventario(
  db: any,
  invItemId: string,
  qty: number = 1,
  ventaId?: string
): Promise<{ success: boolean; newQty: number }> {
  if (!db || !invItemId) return { success: false, newQty: 0 };

  const item = await db.collection('inventory').findOne({ id: invItemId });
  if (!item) return { success: false, newQty: 0 };

  const currentCant = Number(item.cantidad || 1);
  const newCant = Math.max(0, currentCant - qty);

  if (newCant <= 0) {
    // Si la cantidad llega a 0 se elimina directamente del inventario (pedido explícito del dueño)
    await db.collection('inventory').deleteOne({ id: invItemId });
  } else {
    await db.collection('inventory').updateOne(
      { id: invItemId },
      {
        $set: {
          cantidad: newCant,
          updatedAt: new Date().toISOString()
        }
      }
    );
  }

  return { success: true, newQty: newCant };
}

/**
 * Descuenta la cantidad del stock en el catálogo web (`products`), para mantener
 * sincronizada la tienda cuando se venden unidades en la tienda física o por orden completada.
 */
export async function descontarStockCatalogo(
  db: any,
  productNameOrId: string,
  qty: number = 1
): Promise<void> {
  if (!db || !productNameOrId) return;

  try {
    // 1. Intentar por id exacto
    const byId = await db.collection('products').findOne({ id: productNameOrId });
    if (byId) {
      await db.collection('products').updateOne(
        { id: productNameOrId, stock: { $gte: qty } },
        { $inc: { stock: -qty } }
      );
      return;
    }

    // 2. Intentar por coincidencia de nombre
    const { mainPart } = parseCombo(productNameOrId);
    const norm = normalizeInventoryText(mainPart);
    const words = norm.split(' ').filter(w => w.length > 2);

    if (words.length > 0) {
      const regex = words.slice(0, 3).map(w => `(?=.*${w})`).join('');
      const prod = await db.collection('products').findOne({
        name: { $regex: regex, $options: 'i' },
        stock: { $gte: qty }
      });
      if (prod) {
        await db.collection('products').updateOne(
          { id: prod.id },
          { $inc: { stock: -qty } }
        );
      }
    }
  } catch (err) {
    console.error('[descontarStockCatalogo] Error:', err);
  }
}
