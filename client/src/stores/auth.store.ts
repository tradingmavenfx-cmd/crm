import { create } from 'zustand';
import { api, tokenStore } from '@/lib/api';

/**
 * Signing in needs the workspace slug, so it has to outlive the in-memory
 * store - otherwise a user who registers can never get back into their own
 * workspace after a reload or logout.
 */
const SLUG_KEY = 'crm_tenant_slug';

export const slugStore = {
  get: () =>
    typeof window !== 'undefined' ? localStorage.getItem(SLUG_KEY) : null,
  set: (slug: string) => localStorage.setItem(SLUG_KEY, slug),
};

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
  tenantSlug: string | null;
  loading: boolean;
  login: (email: string, password: string, tenantSlug: string) => Promise<void>;
  /** Resolves with the new workspace slug, which the caller must show. */
  register: (payload: RegisterPayload) => Promise<string>;
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
  tenantSlug: null,
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
      slugStore.set(data.tenantSlug);
      set({ user: data.user, tenantSlug: data.tenantSlug });
    } finally {
      set({ loading: false });
    }
  },

  register: async (payload) => {
    set({ loading: true });
    try {
      const { data } = await api.post('/auth/register', payload);
      tokenStore.set(data.tokens.accessToken, data.tokens.refreshToken);
      slugStore.set(data.tenantSlug);
      set({ user: data.user, tenantSlug: data.tenantSlug });
      return data.tenantSlug as string;
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
    if (!tokenStore.getAccess()) return;
    set((s) => ({ ...s, tenantSlug: s.tenantSlug ?? slugStore.get() }));

    // A reload leaves the store with a token but no user, so anything keyed
    // off the signed-in user (their name, their workspace) came back blank.
    api
      .get('/auth/me')
      .then(({ data }) => {
        slugStore.set(data.tenantSlug);
        set({ user: data.user, tenantSlug: data.tenantSlug });
      })
      .catch(() => {
        // An invalid token is handled by the API client's 401 flow.
      });
  },
}));
