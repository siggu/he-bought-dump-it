import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { MeResponse } from "../../shared/protocol";
import { ApiError, api } from "./api";

interface AuthState {
  /** undefined: 확인 중, null: 비로그인 */
  me: MeResponse | null | undefined;
  setMe: (me: MeResponse | null) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      setMe(await api.me());
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null);
      else throw e;
    }
  }, []);

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setMe(null);
  }, []);

  useEffect(() => {
    refresh().catch(() => setMe(null));
  }, [refresh]);

  return <AuthContext.Provider value={{ me, setMe, refresh, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("AuthProvider가 필요합니다.");
  return ctx;
}

/** 로그인된 화면에서만 쓴다. */
export function useMe(): MeResponse {
  const { me } = useAuth();
  if (!me) throw new Error("로그인이 필요합니다.");
  return me;
}
