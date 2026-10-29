import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { API_ORIGIN } from '../api-base';

/**
 * Portal del cliente del módulo de bloqueo.
 *
 * Se usa fetch y no axios porque axios usa XMLHttpRequest en el navegador y se
 * salta el interceptor de window.fetch de api-base.ts.
 *
 * Además las rutas ahora van con API_ORIGIN: antes eran relativas
 * ('/api/blocking/...'), que en producción apuntan a cPanel, donde no hay
 * backend — el backend está en Railway.
 *
 * PENDIENTE DE SEGURIDAD: fetchDevices se identifica mandando el objeto del
 * cliente en la cabecera Authorization. Eso no es autenticación, es una
 * afirmación: basta editar localStorage y poner otro correo para pedir los
 * equipos de otra persona. Cuando se implemente /api/blocking/client/* hay que
 * emitir un token firmado en el login, como se hizo con el panel de admin.
 */
const API_CLIENTE = `${API_ORIGIN}/api/blocking/client`;

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
          const res = await fetch(`${API_CLIENTE}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
          });

          // fetch no lanza en 4xx/5xx (axios sí lo hacía), así que el estado se
          // comprueba a mano. Se intenta leer el mensaje del servidor para
          // poder distinguir "credenciales malas" de "servicio caído".
          let cuerpo: any = null;
          try {
            const texto = await res.text();
            cuerpo = texto ? JSON.parse(texto) : null;
          } catch {
            /* respuesta sin JSON: se usa el mensaje genérico de abajo */
          }

          if (res.ok && cuerpo?.success) {
            set({ cliente: cuerpo.cliente, isAuthenticated: true, isLoading: false });
            await get().fetchDevices();
            return true;
          }

          set({
            isLoading: false,
            error: cuerpo?.error || (res.ok ? 'Credenciales inválidas' : 'Error al iniciar sesión'),
          });
          return false;
        } catch (error) {
          console.error('[blocking/cliente] login falló:', error);
          set({ isLoading: false, error: 'Error al iniciar sesión' });
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
          const res = await fetch(`${API_CLIENTE}/devices`, {
            headers: { Authorization: JSON.stringify(cliente) },
          });
          if (!res.ok) {
            console.error(`[blocking/cliente] GET /devices -> HTTP ${res.status}`);
            set({ isLoading: false });
            return;
          }
          set({ devices: await res.json(), isLoading: false });
        } catch (error) {
          console.error('[blocking/cliente] GET /devices falló:', error);
          set({ isLoading: false });
        }
      },
    }),
    {
      name: 'client-auth-storage',
    }
  )
);
