"use client"
import React, { createContext, useState, useEffect, useContext } from "react";
import api from "@/lib/api/axios";
import { tokenStore } from "@/lib/api/token-store";
import { useRouter } from "next/navigation";

type AuthContextType = {
  accessToken: string | null;
  authReady: boolean;
  login: (token: string) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  // We can't use useRouter outside of a component, so we put the hook here
  const router = typeof window !== "undefined"
    ? require("next/navigation").useRouter()
    : null;

  useEffect(() => {
    console.log("refressh from the provider")
    async function restoreSession() {
      try {
        const res = await api.post(
          "/api/auth/refresh",
          {},
          { withCredentials: true }
        );
        if (res.data && res.data.accessToken) {
          setAccessToken(res.data.accessToken);
          tokenStore.set(res.data);
        } else {
          setAccessToken(null);
          tokenStore.clear();
          if (router) router.push("/login");
        }
      } catch {
        setAccessToken(null);
        tokenStore.clear();
        if (router) router.push("/login");
      } finally {
        setAuthReady(true);
      }
    }

    restoreSession();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        accessToken,
        authReady,
        login: setAccessToken,
        logout: () => setAccessToken(null),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

