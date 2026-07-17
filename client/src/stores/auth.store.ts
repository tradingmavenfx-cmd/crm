import { create } from 'zustand';
import { api, tokenStore } from '@/lib/api';

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  tenantId: string;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string, tenantSlug: string) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
  hydrate: () => void;
}

interface RegisterPayload {
  organizationName: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: false,

  login: async (email, password, tenantSlug) => {
    set({ loading: true });
    try {
      const { data } = await api.post('/auth/login', {
        email,
        password,
        tenantSlug,
      });
      tokenStore.set(data.tokens.accessToken, data.tokens.refreshToken);
      set({ user: data.user });
    } finally {
      set({ loading: false });
    }
  },

  register: async (payload) => {
    set({ loading: true });
    try {
      const { data } = await api.post('/auth/register', payload);
      tokenStore.set(data.tokens.accessToken, data.tokens.refreshToken);
      set({ user: data.user });
    } finally {
      set({ loading: false });
    }
  },

  logout: async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // ignore network errors on logout
    }
    tokenStore.clear();
    set({ user: null });
  },

  hydrate: () => {
    // Token presence is enough to consider the session active on the client;
    // protected API calls will 401 -> refresh -> or redirect if invalid.
    if (tokenStore.getAccess()) {
      set((s) => ({ ...s }));
    }
  },
}));
