import { describe, it, expect } from 'vitest';
import {
  normalizeInventoryText,
  parseCombo,
  isPhone,
  isAudio,
  findBestInventoryMatch,
  InventoryItemLike
} from '../../server/inventory-matcher';

describe('inventory-matcher', () => {
  describe('normalizeInventoryText', () => {
    it('elimina tildes y normaliza espacios', () => {
      expect(normalizeInventoryText('Teléfono Móvil Óptimo')).toBe('telefono movil optimo');
    });

    it('unifica 15 C en 15c y 256 GB en 256gb', () => {
      expect(normalizeInventoryText('REDMI 15 C 256 GB 8 RAM')).toBe('redmi 15c 256gb 8ram');
      expect(normalizeInventoryText('Redmi 15C 256GB/8RAM')).toBe('redmi 15c 256gb 8ram');
    });
  });

  describe('parseCombo', () => {
    it('desglosa teléfonos con audífonos de obsequio', () => {
      const res = parseCombo('Redmi Note 17 Pro Max 5G + Buds 6 play (obsequio) 512GB/8RAM');
      expect(res.mainPart).toContain('Redmi Note 17 Pro Max 5G');
      expect(res.mainPart).toContain('512GB/8RAM');
      expect(res.giftPart).toBe('Buds 6 play');
    });

    it('soporta la palabra combo', () => {
      const res = parseCombo('Poco X6 Pro Combo Redmi Buds 5');
      expect(res.mainPart).toBe('Poco X6 Pro');
      expect(res.giftPart).toBe('Redmi Buds 5');
    });

    it('devuelve el producto intacto si no es combo', () => {
      const res = parseCombo('Cargador 33W');
      expect(res.mainPart).toBe('Cargador 33W');
      expect(res.giftPart).toBe('');
    });
  });

  describe('isPhone y isAudio', () => {
    it('detecta celulares y tablets', () => {
      expect(isPhone('Redmi Note 15 Pro 5G')).toBe(true);
      expect(isPhone('REDMI 15C 256 GB 8 RAM')).toBe(true);
      expect(isPhone('Poco X8 Pro Max')).toBe(true);
      expect(isPhone('Tablet Redmi Pad 2')).toBe(true);
      expect(isPhone('Redmi Buds 6 Play')).toBe(false);
      expect(isPhone('Cargador 120W')).toBe(false);
    });

    it('detecta audífonos y audio', () => {
      expect(isAudio('Redmi Buds 6 Play')).toBe(true);
      expect(isAudio('Audífonos Bluetooth')).toBe(true);
      expect(isAudio('Parlante Sound Party')).toBe(true);
      expect(isAudio('Redmi 15C')).toBe(false);
    });
  });

  describe('findBestInventoryMatch', () => {
    const mockInventory: InventoryItemLike[] = [
      { id: '1', producto: 'REDMI 15C 256 GB 8 RAM', cantidad: 2, estado: 'disponible' },
      { id: '2', producto: 'REDMI 15 C 256 GB 4 RAM', cantidad: 1, estado: 'disponible' },
      { id: '3', producto: 'Redmi Buds 6 Play', cantidad: 9, estado: 'disponible' },
      { id: '4', producto: 'Cargador 33W', cantidad: 3, estado: 'disponible' },
      { id: '5', producto: 'VIDRIO TEMPLADO', cantidad: 230, estado: 'disponible' },
      { id: '6', producto: 'Redmi 15', cantidad: 0, estado: 'vendido' }, // No disponible
    ];

    it('empareja celular con modelo, memoria y ram exactos', () => {
      const match = findBestInventoryMatch(mockInventory, 'Redmi 15C 256GB/8RAM', 'phone');
      expect(match).not.toBeNull();
      expect(match?.id).toBe('1');
    });

    it('discrimina variante de 4GB RAM vs 8GB RAM', () => {
      const match = findBestInventoryMatch(mockInventory, 'Redmi 15C 256GB/4RAM', 'phone');
      expect(match).not.toBeNull();
      expect(match?.id).toBe('2');
    });

    it('no empareja celular contra audífonos por llamarse Redmi', () => {
      const match = findBestInventoryMatch(mockInventory, 'Redmi Note 17', 'phone');
      // No existe Redmi Note 17 en el inventario mock, no debe devolver los Buds 6 Play
      expect(match).toBeNull();
    });

    it('empareja el obsequio/combo de audio correctamente', () => {
      const match = findBestInventoryMatch(mockInventory, 'Buds 6 play', 'audio');
      expect(match).not.toBeNull();
      expect(match?.id).toBe('3');
    });

    it('no selecciona productos con cantidad 0 o vendidos', () => {
      const match = findBestInventoryMatch(mockInventory, 'Redmi 15', 'phone');
      expect(match).toBeNull();
    });
  });
});
