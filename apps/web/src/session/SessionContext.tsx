import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, ApiError, type MeContext, type PortalContext } from "../lib/api";

export type SessionStatus = "loading" | "authenticated" | "unauthenticated" | "unavailable";

interface SessionValue {
  status: SessionStatus;
  me: MeContext | null;
  portalContexts: PortalContext[];
  error: ApiError | null;
  refresh: () => Promise<void>;
}

const Session = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [me, setMe] = useState<MeContext | null>(null);
  const [portalContexts, setPortalContexts] = useState<PortalContext[]>([]);
  const [error, setError] = useState<ApiError | null>(null);

  const refresh = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const [internal, portal] = await Promise.all([
        api.get<MeContext>("/me/contexts"),
        api.get<PortalContext[]>("/portal/contexts"),
      ]);
      setMe(internal);
      setPortalContexts(portal);
      setStatus("authenticated");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setMe(null);
        setPortalContexts([]);
        setStatus("unauthenticated");
        return;
      }
      const sessionError =
        error instanceof ApiError
          ? error
          : new ApiError("SESSION_UNAVAILABLE", "No se pudo validar tu sesión", 0);
      setError(sessionError);
      setStatus("unavailable");
      throw sessionError;
    }
  }, []);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  const value = useMemo(
    () => ({ status, me, portalContexts, error, refresh }),
    [status, me, portalContexts, error, refresh],
  );
  return <Session.Provider value={value}>{children}</Session.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(Session);
  if (!value) throw new Error("useSession debe usarse dentro de SessionProvider");
  return value;
}
