// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../context/ClientContext";
import { STUDY_MODULES } from "../study/moduleRegistry";
import type { ReactNode } from "react";
import { StudyShell } from "./StudyShell";

const state = vi.hoisted(() => ({
  context: null as unknown as ClientContextValue,
  session: null as unknown,
}));

vi.mock("../context/ClientContext", () => ({
  useClientContext: () => state.context,
}));

vi.mock("../session/SessionContext", () => ({
  useSession: () => state.session,
}));

vi.mock("../lib/auth", () => ({ logout: vi.fn() }));

vi.mock("../ui/GuidedTour", () => ({
  GuidedTour: ({ children }: { children: (controls: { startTour: () => void }) => ReactNode }) =>
    children({ startTour: vi.fn() }),
}));

function renderShell(path: string, clientId: string | null = "client-a") {
  state.context = {
    firmId: "firm-a",
    clientId,
    periodId: "period-a",
    isReady: true,
    capabilities: new Set([
      "client.read",
      "tax.profile.read",
      "tax.rules.read",
      "tax.settlements.read",
      "profitability.read",
      "report.run",
      "ai.use",
      "firm.users.manage",
      "platform.modules.manage",
    ]),
    hasClientAccess: () => true,
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
  } as ClientContextValue;
  state.session = {
    status: "authenticated",
    me: {
      isPlatformAdmin: false,
      firms: [
        {
          firmId: "firm-a",
          firmName: "Estudio Demo",
          role: "OWNER",
          clients: [{ clientId: "client-a", clientName: "Cliente Demo", periods: [] }],
        },
      ],
    },
    portalContexts: [],
    error: null,
    refresh: vi.fn(),
  };

  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<StudyShell />}>
          <Route path="*" element={<p>Contenido de la sección</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("StudyShell", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("organiza la navegación en los tres bloques y conserva sus ítems esperados", () => {
    renderShell("/trabajo");
    const nav = screen.getByRole("navigation", { name: "Navegación del estudio" });
    const studyGroup = within(nav).getByRole("group", { name: "Estudio" });
    const clientGroup = within(nav).getByRole("group", { name: "Del cliente" });
    const settingsGroup = within(nav).getByRole("group", { name: "Ajustes del estudio" });

    expect(within(nav).getAllByRole("group")).toHaveLength(3);
    expect(
      within(studyGroup)
        .getAllByRole("link")
        .map((link) => link.textContent?.trim()),
    ).toEqual([
      "Inicio",
      "Clientes",
      "Bandeja documental",
      "Trabajo",
      "Liquidaciones",
      "Legajo",
      "Rentabilidad",
    ]);
    expect(
      within(clientGroup)
        .getAllByRole("link")
        .map((link) => link.textContent?.trim()),
    ).toEqual(["Configuración fiscal"]);
    expect(within(nav).queryByRole("link", { name: "Resumen del cliente" })).toBeNull();
    expect(within(studyGroup).getByRole("link", { name: "Trabajo" }).getAttribute("aria-current")).toBe(
      "page",
    );

    const settingsToggle = within(settingsGroup).getByRole("button", {
      name: "Ajustes del estudio",
    });
    expect(settingsToggle.getAttribute("aria-expanded")).toBe("false");
    expect(within(settingsGroup).queryByRole("link", { name: "Usuarios y accesos" })).toBeNull();
  });

  it("expande y vuelve a colapsar Ajustes del estudio", () => {
    renderShell("/trabajo");
    const settingsGroup = screen.getByRole("group", { name: "Ajustes del estudio" });
    const settingsToggle = within(settingsGroup).getByRole("button", {
      name: "Ajustes del estudio",
    });

    fireEvent.click(settingsToggle);
    expect(settingsToggle.getAttribute("aria-expanded")).toBe("true");
    expect(
      within(settingsGroup)
        .getAllByRole("link")
        .map((link) => link.textContent?.trim()),
    ).toEqual([
      "Usuarios y accesos",
      "Módulos de estudios",
      "Reglas fiscales",
      "Catálogos fiscales",
    ]);

    fireEvent.click(settingsToggle);
    expect(settingsToggle.getAttribute("aria-expanded")).toBe("false");
    expect(within(settingsGroup).queryByRole("link", { name: "Usuarios y accesos" })).toBeNull();
  });

  it("muestra el estado Elegí un cliente sin enlaces de secciones dependientes", () => {
    renderShell("/clientes", null);
    const nav = screen.getByRole("navigation", { name: "Navegación del estudio" });
    const clientGroup = within(nav).getByRole("group", { name: "Del cliente" });

    expect(within(clientGroup).getByText("Elegí un cliente")).toBeTruthy();
    expect(within(clientGroup).getByRole("link", { name: "Elegir cliente" })).toBeTruthy();
    expect(within(clientGroup).queryByRole("link", { name: "Configuración fiscal" })).toBeNull();
  });

  it("mantiene la ruta del Resumen del cliente aunque salga del menú", () => {
    const summaryModule = STUDY_MODULES.find((module) => module.id === "resumen-cliente");

    expect(summaryModule?.status).toBe("released");
    expect(summaryModule?.path).toBe("/resumen-cliente");
  });

  it.each([
    "/catalogos-fiscales",
    "/reglas-fiscales",
    "/administracion",
    "/administracion-plataforma",
  ])("oculta el contexto de cliente en %s", (path) => {
    renderShell(path);
    expect(document.querySelector("#context-bar")).toBeNull();
  });

  it("conserva el contexto en una pantalla que depende del cliente", () => {
    renderShell("/trabajo");
    expect(document.querySelector("#context-bar")).not.toBeNull();
    expect(screen.getByText("Cliente")).toBeTruthy();
    expect(screen.getByText("Período")).toBeTruthy();
  });

  it("presenta una sola tarjeta neutral y abre las dos opciones de ayuda", () => {
    renderShell("/catalogos-fiscales");
    const help = document.querySelector(".study__help") as HTMLDetailsElement;
    const summary = help.querySelector("summary");

    expect(help).not.toBeNull();
    expect(help.open).toBe(false);
    expect(help.querySelectorAll(":scope > summary")).toHaveLength(1);

    if (!summary) throw new Error("Falta el control de ayuda");
    fireEvent.click(summary);
    expect(help.open).toBe(true);
    expect(screen.getByRole("link", { name: "Ayuda paso a paso" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Recorrer el estudio" })).toBeTruthy();
  });
});
