import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import type { PortalContext } from "../lib/api";
import { useSession } from "../session/SessionContext";

export interface ClientContextValue {
  firmId: string | null;
  clientId: string | null;
  periodId: string | null;
  capabilities: ReadonlySet<string>;
  setFirmId: (id: string | null) => void;
  setClientId: (id: string | null) => void;
  setPeriodId: (id: string | null) => void;
}

const Context = createContext<ClientContextValue | null>(null);
const STORAGE_KEY = "contable.context.v2";
// G5: capacidades dedicadas de portal (PLAN §4.2). READONLY sólo recibe
// portal.results.read; el colaborador además sube documentos y responde pedidos.
const PORTAL_CAPABILITIES = [
  "client.read",
  "portal.results.read",
  "portal.documents.upload",
  "portal.requests.respond",
  "message.shared",
];

interface AvailablePeriod {
  periodId: string;
}

interface AvailableClient {
  clientId: string;
  periods: AvailablePeriod[];
  capabilities: string[];
}

interface AvailableFirm {
  firmId: string;
  clients: AvailableClient[];
  capabilities: string[];
}

interface SelectedContext {
  firmId: string | null;
  clientId: string | null;
  periodId: string | null;
}

type StoredContext = Partial<Record<keyof SelectedContext, string>>;

const EMPTY_SELECTION: SelectedContext = { firmId: null, clientId: null, periodId: null };

function readStoredContext(storageKey: string): StoredContext {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const candidate = parsed as Record<string, unknown>;
    return {
      firmId: typeof candidate.firmId === "string" ? candidate.firmId : undefined,
      clientId: typeof candidate.clientId === "string" ? candidate.clientId : undefined,
      periodId: typeof candidate.periodId === "string" ? candidate.periodId : undefined,
    };
  } catch {
    return {};
  }
}

function resolveSelection(availableFirms: AvailableFirm[], saved: StoredContext): SelectedContext {
  const firm =
    availableFirms.find((item) => item.firmId === saved.firmId) ??
    (availableFirms.length === 1 ? availableFirms[0] : undefined);
  if (!firm) return EMPTY_SELECTION;

  const client = firm.clients.find((item) => item.clientId === saved.clientId) ?? firm.clients[0];
  const period =
    client?.periods.find((item) => item.periodId === saved.periodId) ?? client?.periods[0];

  return {
    firmId: firm.firmId,
    clientId: client?.clientId ?? null,
    periodId: period?.periodId ?? null,
  };
}

function groupPortalContexts(portalContexts: PortalContext[]): AvailableFirm[] {
  const firms = new Map<string, AvailableFirm>();

  for (const context of portalContexts) {
    let firm = firms.get(context.firmId);
    if (!firm) {
      firm = { firmId: context.firmId, clients: [], capabilities: [] };
      firms.set(context.firmId, firm);
    }

    // G0-05 + G5: READONLY no recibe upload ni mensajes (PLAN §4.2).
    const clientCapabilities =
      context.role === "READONLY"
        ? ["client.read", "portal.results.read"]
        : [...PORTAL_CAPABILITIES];

    const existingClient = firm.clients.find((client) => client.clientId === context.clientId);
    if (!existingClient) {
      firm.clients.push({
        clientId: context.clientId,
        periods: context.periods.map((period) => ({ periodId: period.periodId })),
        capabilities: clientCapabilities,
      });
      continue;
    }

    const knownPeriods = new Set(existingClient.periods.map((period) => period.periodId));
    for (const period of context.periods) {
      if (!knownPeriods.has(period.periodId)) {
        existingClient.periods.push({ periodId: period.periodId });
        knownPeriods.add(period.periodId);
      }
    }
  }

  return [...firms.values()];
}

export function ClientContextProvider({ children }: { children: React.ReactNode }) {
  const { status, me, portalContexts } = useSession();
  const location = useLocation();
  const portal = location.pathname.startsWith("/portal");
  const storageKey = `${STORAGE_KEY}.${portal ? "portal" : "study"}`;
  const [selection, setSelection] = useState<SelectedContext>(EMPTY_SELECTION);
  const [hydratedStorageKey, setHydratedStorageKey] = useState<string | null>(null);

  const availableFirms = useMemo<AvailableFirm[]>(
    () =>
      portal
        ? groupPortalContexts(portalContexts)
        : (me?.firms ?? []).map((firm) => ({
            firmId: firm.firmId,
            capabilities: firm.capabilities,
            clients: firm.clients.map((client) => ({
              clientId: client.clientId,
              periods: client.periods.map((period) => ({ periodId: period.periodId })),
              capabilities: firm.capabilities,
            })),
          })),
    [portal, portalContexts, me],
  );

  useEffect(() => {
    if (status === "loading") return;
    if (status === "unauthenticated") {
      setSelection(EMPTY_SELECTION);
      setHydratedStorageKey(null);
      return;
    }

    setSelection(resolveSelection(availableFirms, readStoredContext(storageKey)));
    setHydratedStorageKey(storageKey);
  }, [availableFirms, status, storageKey]);

  useEffect(() => {
    if (status !== "authenticated" || hydratedStorageKey !== storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(selection));
    } catch {
      // La selección sigue funcionando aunque el navegador no permita persistencia local.
    }
  }, [selection, status, storageKey, hydratedStorageKey]);

  const setFirmId = useCallback(
    (next: string | null) => {
      const firm = availableFirms.find((item) => item.firmId === next);
      if (!firm) {
        setSelection(EMPTY_SELECTION);
        return;
      }

      const client = firm.clients[0];
      setSelection({
        firmId: firm.firmId,
        clientId: client?.clientId ?? null,
        periodId: client?.periods[0]?.periodId ?? null,
      });
    },
    [availableFirms],
  );

  const setClientId = useCallback(
    (next: string | null) => {
      setSelection((current) => {
        const firm = availableFirms.find((item) => item.firmId === current.firmId);
        const client = firm?.clients.find((item) => item.clientId === next);
        return {
          firmId: firm?.firmId ?? null,
          clientId: client?.clientId ?? null,
          periodId: client?.periods[0]?.periodId ?? null,
        };
      });
    },
    [availableFirms],
  );

  const setPeriodId = useCallback(
    (next: string | null) => {
      setSelection((current) => {
        const firm = availableFirms.find((item) => item.firmId === current.firmId);
        const client = firm?.clients.find((item) => item.clientId === current.clientId);
        return {
          firmId: firm?.firmId ?? null,
          clientId: client?.clientId ?? null,
          periodId: client?.periods.some((item) => item.periodId === next) ? next : null,
        };
      });
    },
    [availableFirms],
  );

  const capabilities = useMemo(() => {
    const firm = availableFirms.find((item) => item.firmId === selection.firmId);
    const client = firm?.clients.find((item) => item.clientId === selection.clientId);
    return new Set(client?.capabilities ?? firm?.capabilities ?? []);
  }, [availableFirms, selection.firmId, selection.clientId]);

  const value = useMemo<ClientContextValue>(
    () => ({
      ...selection,
      capabilities,
      setFirmId,
      setClientId,
      setPeriodId,
    }),
    [selection, capabilities, setFirmId, setClientId, setPeriodId],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useClientContext(): ClientContextValue {
  const value = useContext(Context);
  if (!value) throw new Error("useClientContext debe usarse dentro de ClientContextProvider");
  return value;
}
