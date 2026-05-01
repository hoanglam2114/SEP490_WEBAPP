import { create } from 'zustand';
import {
  clearAuthSession,
  getAuthToken,
  getAuthUser,
  setAuthSession,
  type AuthSessionUser,
} from '../services/authSession';

interface User {
  id: string;
  name: string;
  email: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  setAuth: (user: User, token: string) => void;
  logout: () => void;
  hydrateFromStorage: () => void;
}

function normalizeUser(user: AuthSessionUser | null): User | null {
  if (!user) {
    return null;
  }
  const id = String(user.id || user._id || user.userId || '');
  if (!id) {
    return null;
  }
  return {
    id,
    name: String(user.name || ''),
    email: String(user.email || ''),
  };
}

export const useAuthStore = create<AuthState>((set) => ({
  user: normalizeUser(getAuthUser()),
  token: getAuthToken(),
  setAuth: (user, token) => {
    setAuthSession(user, token);
    set({ user, token });
  },
  logout: () => {
    clearAuthSession();
    set({ user: null, token: null });
  },
  hydrateFromStorage: () => {
    set({
      user: normalizeUser(getAuthUser()),
      token: getAuthToken(),
    });
  },
}));
