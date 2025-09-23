// hooks/use-admin-auth.ts
"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface User {
  id: string;
  email: string;
  name: string;
}

interface SessionData {
  success: boolean;
  authenticated: boolean;
  user?: User;
  expiresAt?: number;
  expiresIn?: number;
  error?: string;
}

export function useAdminAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const checkSession = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/auth/admin/session', {
        credentials: 'include',
        headers: { 'Cache-Control': 'no-cache' },
      });
      const data: SessionData = await response.json();
      if (data.authenticated && data.user) {
        setUser(data.user);
        setAuthenticated(true);
      } else {
        setUser(null);
        setAuthenticated(false);
      }
    } catch (error) {
      console.error('Session check failed:', error);
      setUser(null);
      setAuthenticated(false);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      const response = await fetch('/api/auth/admin/logout', {
        method: 'POST',
        credentials: 'include',
      });
      if (response.ok) {
        setUser(null);
        setAuthenticated(false);
        router.push('/admin/login');
      } else {
        console.error('Logout failed:', await response.json());
      }
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  useEffect(() => {
    checkSession();
  }, []);

  return { user, authenticated, loading, logout };
}