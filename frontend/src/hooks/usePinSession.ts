import { useState, useCallback } from 'react';
import { pinApi } from '../services/adminApiService';

const TOKEN_KEY = 'pin_token';

export function usePinSession() {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(TOKEN_KEY));

  const saveToken = useCallback((t: string) => {
    sessionStorage.setItem(TOKEN_KEY, t);
    setToken(t);
  }, []);

  const clearToken = useCallback(async () => {
    try { await pinApi.logout(); } catch { /* ignore */ }
    sessionStorage.removeItem(TOKEN_KEY);
    setToken(null);
  }, []);

  const isUnlocked = !!token;

  return { token, isUnlocked, saveToken, clearToken };
}
