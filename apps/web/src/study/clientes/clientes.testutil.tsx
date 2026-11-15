import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ToastProvider } from "@contable/design-system";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";

// Utilidades de las pruebas de caracterización de Clientes (Foco 5.1).
// Datos sintéticos rotulados «Sintético» y CUIT ficticios: no hay datos reales de clientes.

export const PERFIL_SINTETICO_COMPLETO = {
  functionalCurrency: "ARS",
  accountingStandard: "RTIC",
  fiscalYearEndMonth: 6,
  vatCondition: "RESPONSABLE_INSCRIPTO",
  iibbJurisdictions: [],
  province: "Tucumán",
  activity: "Comercio",
  legalForm: "S.A.",
  serviceStartDate: null,
};

export const CLIENTES_SINTETICOS = [
  {
    id: "c1",
    legalName: "Sintético Alfa S.A.",
    tradeName: null,
    cuit: "20000000060",
    cuitEnding: "0",
    status: "ACTIVE",
    profile: PERFIL_SINTETICO_COMPLETO,
  },
  {
    id: "c2",
    legalName: "Sintético Beta S.R.L.",
    tradeName: "Sintético Beta Comercial",
    cuit: "20000000001",
    cuitEnding: "1",
    status: "ACTIVE",
    profile: null,
  },
  {
    id: "c3",
    legalName: "Sintético Gamma S.A.",
    tradeName: null,
    cuit: "20000000052",
    cuitEnding: "2",
    status: "INACTIVE",
    profile: PERFIL_SINTETICO_COMPLETO,
  },
  {
    id: "c4",
    legalName: "Sintético Delta S.A.",
    tradeName: null,
    cuit: "20000000079",
    cuitEnding: "9",
    status: "ACTIVE",
    profile: { ...PERFIL_SINTETICO_COMPLETO, province: null, activity: null, accountingStandard: null },
  },
  {
    id: "c5",
    legalName: "Sintético Zeta S.A.",
    tradeName: null,
    cuit: "20000000117",
    cuitEnding: "7",
    status: "ACTIVE",
    profile: null,
  },
  {
    id: "c6",
    legalName: "Sintético sin CUIT",
    tradeName: null,
    cuit: "",
    cuitEnding: null,
    status: "ONBOARDING",
    profile: null,
  },
];

export const CATALOGO_JURISDICCIONES = [
  { id: "j1", code: "AR-T", name: "Provincia de Tucumán", kind: "PROVINCIAL", isActive: true },
  { id: "j2", code: "TUC", name: "Tucumán — Convenio Multilateral", kind: "PROVINCIAL", isActive: true },
];

export const CATALOGO_ACTIVIDADES = [
  { id: "a1", code: "COMERCIO", name: "Comercio", isActive: true },
  { id: "a2", code: "SERVICIOS", name: "Servicios", isActive: true },
];

export const CATALOGO_NORMAS = [
  { id: "n1", name: "RTIC", isActive: true },
  { id: "n2", name: "VENCER", isActive: false },
];

export const SESION_AUTENTICADA = {
  status: "authenticated" as const,
  me: null,
  portalContexts: [] as never[],
  error: null,
  refresh: async () => {},
};

export function contextoDePrueba(capacidades: string[], clientId: string | null = null): ClientContextValue {
  return {
    firmId: "firm-a",
    clientId,
    periodId: null,
    isReady: true,
    capabilities: new Set(capacidades),
    hasClientAccess: () => true,
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
  };
}

/** Respuesta de la API para las rutas que consulta la pantalla. */
export function respuestaApi(path: string, clientes: unknown[], contactos: unknown[] = []): Promise<unknown> {
  if (path === "/tax/jurisdictions?includeInactive=true") return Promise.resolve(CATALOGO_JURISDICCIONES);
  if (path.includes("/client-profile-catalogs/activities")) return Promise.resolve(CATALOGO_ACTIVIDADES);
  if (path.includes("/accounting-standards")) return Promise.resolve(CATALOGO_NORMAS);
  if (path.endsWith("/contacts")) return Promise.resolve(contactos);
  if (path.endsWith("/clients")) return Promise.resolve(clientes);
  return Promise.resolve(null);
}

function SondaDeUbicacion() {
  const { pathname, search } = useLocation();
  return (
    <>
      <output data-testid="current-path">{pathname}</output>
      <output data-testid="current-search">{search}</output>
    </>
  );
}

export function renderConRutas(entrada: string, pantalla: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[entrada]}>
          {pantalla}
          <SondaDeUbicacion />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

export function filasClave(): string[] {
  const tabla = screen.getByRole("table", { name: "Cartera de clientes" });
  return Array.from(tabla.querySelectorAll("tbody tr[data-row-key]")).map(
    (fila) => fila.getAttribute("data-row-key") ?? "",
  );
}

export function parametrosUrl(): URLSearchParams {
  return new URLSearchParams(screen.getByTestId("current-search").textContent ?? "");
}

export function rutaActual(): string {
  return screen.getByTestId("current-path").textContent ?? "";
}

/** Elige una fila por su CUIT formateado y devuelve el detalle abierto. */
export async function seleccionarCliente(cuit: string, nombre: string): Promise<HTMLElement> {
  const tabla = await screen.findByRole("table", { name: "Cartera de clientes" });
  fireEvent.click(within(tabla).getByText(cuit));
  return screen.findByRole("complementary", { name: `Detalle de ${nombre}` });
}
