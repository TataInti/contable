// Entorno de las pruebas de caracterización de Usuarios y accesos (corte 6.1).
// Datos sintéticos «Demo» con correos @example.com y los mismos proveedores que
// la suite existente de la pantalla. Lo usan solo las pruebas K1 a K9.
import { ToastProvider } from "@contable/design-system";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import type { ClientContextValue } from "../../../context/ClientContext";
import { api } from "../../../lib/api";
import { StudyAdministracion } from "../../StudyAdministracion";

/** Marca una consulta que no responde (queda en carga). */
export const PENDIENTE = Symbol("consulta pendiente");

type Respuesta = unknown;

export interface RespuestasDemo {
  normas?: Respuesta;
  miembros?: Respuesta;
  perfil?: Respuesta;
  autorrevision?: Respuesta;
  membresias?: Respuesta;
  invitaciones?: Respuesta;
  clientes?: Respuesta;
  asignaciones?: Respuesta;
}

export function contextoDemo(
  capacidades: string[],
  clientId: string | null = "client-a",
): ClientContextValue {
  return {
    firmId: "firm-a",
    clientId,
    periodId: "period-a",
    isReady: true,
    capabilities: new Set(capacidades),
    hasClientAccess: (id) => id === "client-a",
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
  };
}

export const normasDemo = [
  { id: "n1", name: "Norma Demo Alfa", isActive: true },
  { id: "n2", name: "Norma Demo Beta", isActive: false },
];

export const perfilDemo = {
  legalName: "Estudio Demo SRL",
  displayName: "Estudio Demo",
  taxId: "30123456789",
  timezone: "America/Argentina/Buenos_Aires",
};

export const clientesDemo = [
  { id: "client-a", legalName: "Cliente Demo Alfa", cuit: "30111111119", status: "ACTIVE" },
  { id: "client-b", legalName: "Cliente Demo Beta", cuit: "30222222229", status: "ACTIVE" },
];

export const miembrosDemo = [
  {
    id: "m1",
    userId: "u1",
    role: "OWNER",
    status: "ACTIVE",
    acceptedAt: null,
    user: { name: "Titular Demo", emailNormalized: "titular@example.com", status: "ACTIVE" },
  },
  {
    id: "m2",
    userId: "u2",
    role: "REVIEWER",
    status: "ACTIVE",
    acceptedAt: null,
    user: { name: "Revisora Demo", emailNormalized: "revisora@example.com", status: "ACTIVE" },
  },
  {
    id: "m3",
    userId: "u3",
    role: "AUDITOR_READONLY",
    status: "SUSPENDED",
    acceptedAt: null,
    user: { name: "Auditor Demo", emailNormalized: "auditor@example.com", status: "SUSPENDED" },
  },
];

export const membresiaPortalDemo = {
  id: "p1",
  userId: "pu1",
  role: "READONLY",
  status: "ACTIVE",
  acceptedAt: "2026-11-01T00:00:00.000Z",
  revokedAt: null,
  user: { name: "Cliente Demo", emailNormalized: "cliente@example.com" },
};

function responder(valor: Respuesta): Promise<unknown> {
  if (valor === PENDIENTE) return new Promise(() => undefined);
  if (valor instanceof Error) return Promise.reject(valor);
  return Promise.resolve(valor);
}

/** Respuestas de la API por ruta. Lo que no se indica responde lista vacía, como en la suite existente. */
export function mockApiDemo(respuestas: RespuestasDemo = {}) {
  const de = <K extends keyof RespuestasDemo>(clave: K, predeterminado: Respuesta): Respuesta =>
    respuestas[clave] === undefined ? predeterminado : respuestas[clave];
  vi.mocked(api.get).mockImplementation(((ruta: string) => {
    if (ruta.includes("/settings/self-review"))
      return responder(de("autorrevision", { allowSelfReview: false }));
    if (ruta.includes("/accounting-standards")) return responder(de("normas", normasDemo));
    if (ruta.endsWith("/profile")) return responder(de("perfil", perfilDemo));
    if (ruta === "/firms/firm-a/clients") return responder(de("clientes", clientesDemo));
    if (ruta.includes("/assignments")) return responder(de("asignaciones", []));
    if (ruta.includes("/portal-invitations")) return responder(de("invitaciones", []));
    if (ruta.includes("/portal-memberships")) return responder(de("membresias", []));
    if (ruta.includes("/members")) return responder(de("miembros", []));
    return Promise.resolve(null);
  }) as never);
}

export function renderizarAdministracion() {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={cliente}>
      <ToastProvider>
        <MemoryRouter>
          <StudyAdministracion />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}
