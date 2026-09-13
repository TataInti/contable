// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../context/ClientContext";
import { moduleById } from "./moduleRegistry";
import { LegacyClientModuleRoute, StudyModuleGuard, StudyNotFound } from "./StudyRouteStates";

const contextMock = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));

vi.mock("../context/ClientContext", () => ({
  useClientContext: () => contextMock.current,
}));

function context(overrides: Partial<ClientContextValue> = {}): ClientContextValue {
  return {
    firmId: "firm-a",
    clientId: "client-a",
    periodId: "period-a",
    isReady: true,
    capabilities: new Set(["client.read"]),
    hasClientAccess: (id) => id === "client-a",
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
    ...overrides,
  };
}

describe("estados de rutas del estudio", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("muestra acceso restringido sin ocultar una URL directa", () => {
    contextMock.current = context();
    const module = moduleById("rentabilidad");
    if (!module) throw new Error("Módulo rentabilidad no encontrado");

    render(
      <MemoryRouter>
        <StudyModuleGuard module={module}>
          <p>Contenido de rentabilidad</p>
        </StudyModuleGuard>
      </MemoryRouter>,
    );

    expect(screen.getByText("No tenés acceso a esta sección")).toBeTruthy();
    expect(screen.queryByText("Contenido de rentabilidad")).toBeNull();
  });

  it("muestra estado no disponible para el asistente hasta que el piloto lo habilite", () => {
    contextMock.current = context({ capabilities: new Set(["ai.use"]) });
    const module = moduleById("asistente");
    if (!module) throw new Error("Módulo asistente no encontrado");

    render(
      <MemoryRouter>
        <StudyModuleGuard module={module}>
          <p>Contenido del asistente</p>
        </StudyModuleGuard>
      </MemoryRouter>,
    );

    expect(screen.getByText("Esta sección todavía no está disponible")).toBeTruthy();
    expect(screen.queryByText("Contenido del asistente")).toBeNull();
  });

  it("migra un enlace heredado sólo cuando el cliente pertenece al contexto", async () => {
    const setClientId = vi.fn();
    contextMock.current = context({ setClientId });

    render(
      <MemoryRouter initialEntries={["/clientes/client-a/rentabilidad"]}>
        <Routes>
          <Route
            path="/clientes/:clientId/rentabilidad"
            element={<LegacyClientModuleRoute to="/rentabilidad" />}
          />
          <Route path="/rentabilidad" element={<p>Ruta canónica</p>} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("Ruta canónica")).toBeTruthy());
    expect(setClientId).toHaveBeenCalledWith("client-a");
  });

  it("mantiene una URL desconocida visible en lugar de redirigirla al inicio", () => {
    contextMock.current = context();
    render(
      <MemoryRouter initialEntries={["/ruta-obsoleta"]}>
        <StudyNotFound />
      </MemoryRouter>,
    );

    expect(screen.getByText("Esta sección no existe")).toBeTruthy();
  });
});
