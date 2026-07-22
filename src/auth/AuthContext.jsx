import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi } from './authApi.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading');

  const refresh = useCallback(async ({ signal } = {}) => {
    try {
      const result = await authApi.session({ signal });
      setUser(result.user);
      setStatus(result.user ? 'authenticated' : 'guest');
      return result.user;
    } catch (error) {
      if (error?.name === 'AbortError') return null;
      setUser(null);
      setStatus('unavailable');
      return null;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    refresh({ signal: controller.signal });
    return () => controller.abort();
  }, [refresh]);

  const login = useCallback(async (credentials) => {
    const result = await authApi.login(credentials);
    setUser(result.user);
    setStatus('authenticated');
    return result.user;
  }, []);

  const register = useCallback(async (details) => {
    const result = await authApi.register(details);
    setUser(result.user);
    setStatus('authenticated');
    return result.user;
  }, []);

  const logout = useCallback(async () => {
    try { await authApi.logout(); }
    finally {
      setUser(null);
      setStatus('guest');
    }
  }, []);

  const updateProfile = useCallback(async (details) => {
    const result = await authApi.updateProfile(details);
    setUser(result.user);
    return result.user;
  }, []);

  const updateAvatar = useCallback(async (dataUrl) => {
    const result = await authApi.updateAvatar(dataUrl);
    setUser(result.user);
    return result.user;
  }, []);

  const removeAvatar = useCallback(async () => {
    const result = await authApi.removeAvatar();
    setUser(result.user);
    return result.user;
  }, []);

  const changePassword = useCallback((details) => authApi.changePassword(details), []);

  const value = useMemo(
    () => ({ user, status, login, register, logout, refresh, updateProfile, updateAvatar, removeAvatar, changePassword }),
    [user, status, login, register, logout, refresh, updateProfile, updateAvatar, removeAvatar, changePassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
