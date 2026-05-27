import { create } from 'zustand';
import { Product } from './ProductContext';

interface CompareState {
  items: Product[];
  addItem: (product: Product) => void;
  removeItem: (id: string) => void;
  clear: () => void;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

export const useCompareStore = create<CompareState>((set) => ({
  items: [],
  isOpen: false,
  addItem: (product) => set((state) => {
    if (state.items.find(i => i.id === product.id)) {
      return { ...state, isOpen: true }; // already added, just open
    }
    const newItems = [...state.items, product].slice(-2); // Keep max 2 items
    return { items: newItems, isOpen: true };
  }),
  removeItem: (id) => set((state) => {
    const newItems = state.items.filter(i => i.id !== id);
    return { items: newItems, isOpen: newItems.length > 0 };
  }),
  clear: () => set({ items: [], isOpen: false }),
  setIsOpen: (isOpen) => set({ isOpen })
}));
