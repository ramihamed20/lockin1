import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { apiRequest, refreshCsrfToken } from "../../api/client";
import type { SessionResponse, User } from "./types";

type Credentials = { email: string; password: string; remember_me: boolean };

type AuthValue = {
  user: User | null;
  status: "loading" | "authenticated" | "anonymous";
  login: (credentials: Credentials) => Promise<User>;
  logout: () => Promise<void>;
  updateUser: (user: User) => void;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthValue["status"]>("loading");

  useEffect(() => {
    const controller = new AbortController();
    void apiRequest<SessionResponse>("/auth/session", { signal: controller.signal })
      .then((response) => {
        setUser(response.user);
        setStatus("authenticated");
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("anonymous");
      });
    return () => controller.abort();
  }, []);

  const login = useCallback(async (credentials: Credentials) => {
    const response = await apiRequest<SessionResponse>("/auth/login", {
      method: "POST",
      body: credentials
    });
    await refreshCsrfToken();
    setUser(response.user);
    setStatus("authenticated");
    return response.user;
  }, []);

  const logout = useCallback(async () => {
    await apiRequest<void>("/auth/logout", { method: "POST" });
    setUser(null);
    setStatus("anonymous");
  }, []);

  const value = useMemo(
    () => ({ user, status, login, logout, updateUser: setUser }),
    [login, logout, status, user]
  );
  return <AuthContext value={value}>{children}</AuthContext>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthValue {
  const value = use(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}
