import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import axios from 'axios';

export interface ClientUser {
  id?: string;
  email: string;
  nombre: string;
  telefono?: string;
  createdAt?: string;
}

interface ClientAuthStore {
  cliente: ClientUser | null;
  isAuthenticated: boolean;
  devices: any[];
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  fetchDevices: () => Promise<void>;
}

export const useClientAuthStore = create<ClientAuthStore>()(
  persist(
    (set, get) => ({
      cliente: null,
      isAuthenticated: false,
      devices: [],
      isLoading: false,
      error: null,

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null });
        try {
          const response = await axios.post('/api/blocking/client/login', { email, password });
          
          if (response.data.success) {
            set({ 
              cliente: response.data.cliente, 
              isAuthenticated: true,
              isLoading: false 
            });
            await get().fetchDevices();
            return true;
          }
          
          set({ isLoading: false, error: 'Credenciales inválidas' });
          return false;
        } catch (error: any) {
          set({ 
            isLoading: false, 
            error: error.response?.data?.error || 'Error al iniciar sesión' 
          });
          return false;
        }
      },

      logout: () => {
        set({ cliente: null, isAuthenticated: false, devices: [] });
      },

      fetchDevices: async () => {
        const { cliente } = get();
        if (!cliente) return;

        set({ isLoading: true });
        try {
          const response = await axios.get('/api/blocking/client/devices', {
            headers: { Authorization: JSON.stringify(cliente) }
          });
          set({ devices: response.data, isLoading: false });
        } catch (error) {
          console.error('Error fetching devices:', error);
          set({ isLoading: false });
        }
      },
    }),
    {
      name: 'client-auth-storage',
    }
  )
);
