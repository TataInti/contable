// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../context/ClientContext";
import { STUDY_MODULES } from "../study/moduleRegistry";
import type { ReactNode } from "react";
import { StudyShell } from "./StudyShell";
import { ContextBar } from "./ContextBar";
import { cambiarValor } from "../test/elegirOpcion";
import { api } from "../lib/api";

vi.mock("../lib/api", () => ({ api: { get: vi.fn().mockResolvedValue([]) } }));

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

interface OpcionesShell {
  clientes?: { clientId: string; clientName: string; periods: never[] }[];
  capacidades?: string[];
}

function renderShell(
  path: string,
  clientId: string | null = "client-a",
  opciones: OpcionesShell = {},
) {
  state.context = {
    firmId: "firm-a",
    clientId,
    periodId: "period-a",
    isReady: true,
    capabilities: new Set([
      "client.read",
      "tax.profile.read",
      "tax.rules.read",
      "tax.calendars.read",
      "tax.settlements.read",
      "profitability.read",
      "report.run",
      "ai.use",
      "firm.users.manage",
      "platform.modules.manage",
      ...(opciones.capacidades ?? []),
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
          clients: opciones.clientes ?? [
            { clientId: "client-a", clientName: "Cliente Demo", periods: [] },
          ],
        },
      ],
    },
    portalContexts: [],
    error: null,
    refresh: vi.fn(),
  };

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<StudyShell />}>
            <Route path="*" element={<p>Contenido de la sección</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("StudyShell", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("separa lo del estudio, lo del cliente y la configuración, cada uno con sus ítems", () => {
    renderShell("/trabajo");
    const nav = screen.getByRole("navigation", { name: "Navegación del estudio" });
    const studyGroup = within(nav).getByRole("group", { name: "Estudio" });
    const clientGroup = within(nav).getByRole("group", { name: "Cliente" });
    const settingsGroup = within(nav).getByRole("group", { name: "Configuración del estudio" });
    const labels = (group: HTMLElement) =>
      within(group).getAllByRole("link").map((link) => link.textContent?.trim());

    expect(within(nav).getAllByRole("group")).toHaveLength(3);
    expect(labels(studyGroup)).toEqual(["Inicio", "Clientes", "Pendientes para mí", "Panel de trabajo"]);
    // Dentro del cliente, el orden sigue el trabajo del mes.
    expect(labels(clientGroup)).toEqual([
      "Resumen",
      "Bandeja documental",
      "Trabajo",
      "Legajo",
      "Liquidaciones",
      "Rentabilidad",
      "Configuración fiscal",
    ]);
    // La configuración del estudio está siempre a la vista, sin desplegar.
    expect(labels(settingsGroup)).toEqual([
      "Usuarios y accesos",
      "Módulos de estudios",
      "Reglas fiscales",
      "Catálogos fiscales",
      "Calendarios fiscales",
    ]);
    expect(within(settingsGroup).queryByRole("button")).toBeNull();
    expect(within(clientGroup).getByRole("link", { name: "Trabajo" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("muestra en la navegación cuántas menciones siguen pendientes", async () => {
    vi.mocked(api.get).mockResolvedValue([{ id: "comment-1" }, { id: "comment-2" }] as never);
    renderShell("/trabajo");
    expect(await screen.findByRole("link", { name: "Pendientes para mí (2)" })).toBeTruthy();
  });

  it("elige el cliente desde el menú", () => {
    renderShell("/clientes", null);
    const switcher = screen.getByRole("combobox", { name: "Cliente en el que estás trabajando" });

    expect((switcher as HTMLSelectElement).value).toBe("");
    cambiarValor(switcher, "client-a");
    expect(state.context.setClientId).toHaveBeenCalledWith("client-a");
  });

  it("sin cliente elegido muestra las secciones del cliente, pero no navegan", () => {
    renderShell("/clientes", null);
    const clientGroup = screen.getByRole("group", { name: "Cliente" });

    expect(within(clientGroup).queryAllByRole("link")).toHaveLength(0);
    const disabled = within(clientGroup).getByText("Legajo").closest("[aria-disabled]");
    expect(disabled?.getAttribute("aria-disabled")).toBe("true");
    expect(disabled?.getAttribute("title")).toBe("Elegí un cliente para abrir esta sección");
    // Ya no hay un cartel de estado vacío adentro del menú.
    expect(within(clientGroup).queryByText("Elegí un cliente")).toBeNull();
  });

  it("mantiene la ruta del Resumen del cliente", () => {
    const summaryModule = STUDY_MODULES.find((module) => module.id === "resumen-cliente");

    expect(summaryModule?.status).toBe("released");
    expect(summaryModule?.path).toBe("/resumen-cliente");
  });

  it.each(["/trabajo", "/catalogos-fiscales", "/administracion", "/clientes"])(
    "no muestra la barra de contexto en %s: el cliente se elige en el menú",
    (path) => {
      renderShell(path);
      expect(document.querySelector("#context-bar")).toBeNull();
    },
  );

  it("no muestra la barra de período en Rentabilidad: su período sale de sus obligaciones fiscales", () => {
    renderShell("/rentabilidad");
    expect(document.querySelector("#context-bar")).toBeNull();
  });

  it("cuando una pantalla pide período, la barra muestra sólo el selector de período", () => {
    renderShell("/trabajo");
    render(
      <MemoryRouter>
        <ContextBar only="period" />
      </MemoryRouter>,
    );
    const bar = document.querySelector("#context-bar") as HTMLElement;

    expect(bar).not.toBeNull();
    expect(within(bar).getByText("Período")).toBeTruthy();
    expect(within(bar).queryByText("Cliente")).toBeNull();
    expect(within(bar).queryByText("Estudio")).toBeNull();
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
    expect(screen.getByRole("button", { name: "Ver recorrido" })).toBeTruthy();
  });

  // A27 D27-3: sin clientes, el selector del menú dice lo mismo que la barra de contexto.
  it("sin client.manage y sin clientes asignados, el selector del menú dice «Sin clientes asignados»", () => {
    renderShell("/trabajo", null, { clientes: [] });
    const selector = document.querySelector(".study__client-select") as HTMLSelectElement;

    expect(selector.disabled).toBe(true);
    expect(selector.getAttribute("placeholder")).toBe("Sin clientes asignados");
  });

  it("con client.manage y sin clientes, el selector del menú usa la misma frase, sin variantes", () => {
    renderShell("/trabajo", null, { clientes: [], capacidades: ["client.manage"] });
    const selector = document.querySelector(".study__client-select") as HTMLSelectElement;

    expect(selector.getAttribute("placeholder")).toBe("Sin clientes asignados");
  });
});
