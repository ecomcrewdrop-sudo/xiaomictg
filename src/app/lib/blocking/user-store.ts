import { create } from 'zustand';

export interface ClientUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  address?: string;
  createdAt: string;
  devicesCount: number;
}

interface UserStore {
  users: ClientUser[];
  addUser: (user: Omit<ClientUser, 'id' | 'createdAt' | 'devicesCount'>) => void;
  updateUser: (id: string, user: Partial<ClientUser>) => void;
  deleteUser: (id: string) => void;
  getUserById: (id: string) => ClientUser | undefined;
}

const mockUsers: ClientUser[] = [
  {
    id: '1',
    name: 'Juan Pérez',
    email: 'juan.perez@email.com',
    phone: '+1234567890',
    address: 'Calle 123, Bogotá',
    createdAt: '2026-02-15T10:00:00Z',
    devicesCount: 1,
  },
  {
    id: '2',
    name: 'María González',
    email: 'maria.gonzalez@email.com',
    phone: '+1234567891',
    address: 'Carrera 45, Medellín',
    createdAt: '2026-02-10T08:00:00Z',
    devicesCount: 1,
  },
  {
    id: '3',
    name: 'Carlos Rodríguez',
    email: 'carlos.rodriguez@email.com',
    phone: '+1234567892',
    createdAt: '2026-02-20T12:00:00Z',
    devicesCount: 1,
  },
  {
    id: '4',
    name: 'Ana Martínez',
    email: 'ana.martinez@email.com',
    phone: '+1234567893',
    address: 'Avenida 7, Cali',
    createdAt: '2026-01-05T16:00:00Z',
    devicesCount: 1,
  },
];

export const useUserStore = create<UserStore>((set, get) => ({
  users: mockUsers,

  addUser: (userData) => {
    const newUser: ClientUser = {
      ...userData,
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
      devicesCount: 0,
    };

    set((state) => ({
      users: [...state.users, newUser],
    }));
  },

  updateUser: (id, userData) => {
    set((state) => ({
      users: state.users.map((user) =>
        user.id === id ? { ...user, ...userData } : user
      ),
    }));
  },

  deleteUser: (id) => {
    set((state) => ({
      users: state.users.filter((user) => user.id !== id),
    }));
  },

  getUserById: (id) => {
    return get().users.find((user) => user.id === id);
  },
}));
