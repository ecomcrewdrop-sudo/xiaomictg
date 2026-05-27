import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'supervisor' | 'user';
}

interface AuthStore {
  user: User | null;
  isAuthenticated: boolean;
  isUsingMockAuth: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
}

const mockUsers: Array<User & { password: string }> = [
  {
    id: '1',
    email: 'admin@mdm.com',
    password: 'admin123',
    name: 'Administrador MDM',
    role: 'admin',
  },
  {
    id: '2',
    email: 'supervisor@mdm.com',
    password: 'super123',
    name: 'Supervisor',
    role: 'supervisor',
  },
  {
    id: '3',
    email: 'user@mdm.com',
    password: 'user123',
    name: 'Usuario',
    role: 'user',
  },
];

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      isUsingMockAuth: true,

      login: async (email: string, password: string) => {
        await new Promise((resolve) => setTimeout(resolve, 800));

        const user = mockUsers.find(
          (u) => u.email === email && u.password === password
        );

        if (user) {
          const { password: _, ...userWithoutPassword } = user;
          set({ user: userWithoutPassword, isAuthenticated: true, isUsingMockAuth: true });
          return true;
        }

        throw new Error('Credenciales inválidas');
      },

      logout: () => {
        set({ user: null, isAuthenticated: false });
      },
    }),
    {
      name: 'mdm-auth-storage',
    }
  )
);
